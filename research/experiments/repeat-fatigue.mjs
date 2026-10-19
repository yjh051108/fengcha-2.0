// 长程重复疲劳实验
// 用户假设：长程多轮里，重复的锚点会被「忽略」掉（habituation / 背景噪音化）
//
// 设计：把同一条锚点在 wire 里重复 N 次，N ∈ {1, 3, 8, 20, 50}
// 观察：We 效果是单调提升、饱和、还是**下降**
//
// 三种重复方式：
//   R_duplicate  完全相同的内容重复 N 次（最容易被忽略）
//   R_varied     每次轻微改写（同一个意思，不同措辞）
//   R_hybrid     第一次完整，之后用极短的「We need」提醒
//
// 判据：只统计 reasoning
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const A_FULL = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;

// 轻微改写版本（同义，措辞不同）
const A_VARIANTS = [
  `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. Every paragraph must begin with "We" or "Our".`,
  `Our reasoning is collective throughout. We begin with "We need" and keep every paragraph in the first person plural.`,
  `We think as a team. Each paragraph opens with "We" or "Our". We never write "Let me" or "I" in reasoning.`,
  `The reasoning stays plural: We need, We should, Our next step. Each new paragraph starts with "We".`,
  `We reason together. Never "Let me" — always "We need". Every paragraph begins with the collective voice.`,
  `We keep the first-person plural: every paragraph starts with "We" or "Our", and we open with "We need".`,
  `Collective voice throughout. Start each paragraph with "We". Never use singular pronouns in reasoning.`,
  `We work as one. Our reasoning opens with "We need" and every paragraph begins with "We" or "Our".`,
];

// 极短提醒
const A_SHORT = `We need. First-person plural only. Not "Let me".`;

const SKILL = { role: "user", content: "The following skills are available:\n- cosmic-doc: documentary builder\n- office: Office documents\n- genui: UI components" };
const TIME = { role: "user", content: "Current time: 2026-10-18T21:40:00+08:00 (Sunday)." };
const RC = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";

// 构造重复的锚点消息
function buildAnchorMessages(mode, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (mode === "duplicate") {
      out.push({ role: "user", content: `${RC}${A_FULL}` });
    } else if (mode === "varied") {
      out.push({ role: "user", content: `${RC}${A_VARIANTS[i % A_VARIANTS.length]}` });
    } else if (mode === "hybrid") {
      out.push({ role: "user", content: `${RC}${i === 0 ? A_FULL : A_SHORT}` });
    }
  }
  return out;
}

function buildMessages(mode, n, task) {
  const msgs = [{ role: "system", content: REAL_SYS }, { role: "user", content: task }];
  msgs.push(...buildAnchorMessages(mode, n));
  msgs.push(SKILL, TIME);
  return msgs;
}

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "这个动画的圆形扩散到上升云衔接很生硬，怎么改？",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把列表中的 0 移到末尾。输出代码。",
];

const MODES = ["duplicate", "varied", "hybrid"];
const NS = [1, 3, 8, 20, 50];
const REPS = 2;

const jobs = [];
for (const mode of MODES) for (const n of NS) for (const t of TASKS) for (let r = 0; r < REPS; r++)
  jobs.push({ mode, n, task: t.slice(0, 14), rep: r, messages: buildMessages(mode, n, t) });

console.log(`任务 ${jobs.length} = ${MODES.length} 模式 × ${NS.length} 重复次数 × ${TASKS.length} 任务 × ${REPS} 次`);
console.log("重复次数对应的 wire 长度（估算）:");
for (const n of NS) console.log(`  n=${String(n).padStart(2)}  ${buildMessages("duplicate", n, TASKS[0]).length} 条消息`);

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        try {
          const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: j.messages, max_tokens: 3000, reasoning_effort: "max", tools: TOOLS }) });
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1500 * (a + 1))); continue; }
          if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; ok = true; break; }
          const jj = await r.json(); const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { reasoning: m.reasoning_content ?? m.reasoning ?? "", content: m.content ?? "", promptTokens: jj.usage?.prompt_tokens } }; ok = true;
        } catch { if (a === 2) { out[my] = { ...j, res: { error: "net" } }; ok = true; } else await new Promise(x => setTimeout(x, 1200)); }
      }
      if (++done % 10 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(100, jobs.length) }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

function strip(t) { return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " "); }
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length + (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return { mode: r.mode, n: r.n, task: r.task, rep: r.rep, col, ind, ratio: tot ? col / tot : null, len: reason.length, promptTokens: r.res?.promptTokens, error: r.res?.error ?? null, head: reason.trim().slice(0, 50) };
});
fs.writeFileSync("./capbench/results/repeat-fatigue.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(88));
console.log("重复次数 → We 占比（检验疲劳/忽略效应）");
console.log("=".repeat(88));
console.log("模式".padEnd(12) + NS.map(n => `n=${n}`.padEnd(12)).join(""));
for (const mode of MODES) {
  const cells = NS.map(n => {
    const sub = ok.filter(r => r.mode === mode && r.n === n && r.ratio !== null);
    if (!sub.length) return "-".padEnd(12);
    const avg = sub.reduce((a, r) => a + r.ratio, 0) / sub.length;
    const we = sub.filter(r => r.ratio >= 0.85).length;
    return `${avg.toFixed(2)}(${we}/${sub.length})`.padEnd(12);
  });
  console.log(mode.padEnd(12) + cells.join(""));
}

console.log("\n=== 趋势判断 ===");
for (const mode of MODES) {
  const avgs = NS.map(n => {
    const sub = ok.filter(r => r.mode === mode && r.n === n && r.ratio !== null);
    return sub.length ? sub.reduce((a, r) => a + r.ratio, 0) / sub.length : null;
  });
  const valid = avgs.filter(x => x !== null);
  const first = valid[0], last = valid[valid.length - 1];
  const peak = Math.max(...valid);
  const peakIdx = avgs.indexOf(peak);
  const drop = last - peak;
  const trend = drop < -0.15 ? "★ 先升后降（疲劳）" : last >= peak - 0.05 ? "持续/饱和" : "波动";
  console.log(`  ${mode.padEnd(12)} 峰值=${peak.toFixed(3)}(n=${NS[peakIdx]})  末值=${last.toFixed(3)}  从峰值降=${drop.toFixed(3)}  ${trend}`);
}

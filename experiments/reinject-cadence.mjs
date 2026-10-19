// 多轮重注入节奏实验
// 真实 DSH 里 runtime-context 的注入形态：
//   - 每 turn 首个 step 注入一次（decision.messages 里 context 被 append 到 claimed 之后）
//   - 同一 turn 内后续 step（工具往返）默认不再重注入（firstAttempt 为 false）
// ⇒ 可调的杠杆：一次回复内（多 step / 多轮）重注入几次
//
// 变体：
//   T0 只第一轮注入（真实现状）
//   T1 每轮都注入（当前预设语义）
//   T2 每两轮注入一次
//   T3 只在轮次变长时才注入（模拟「衰减前补一次」）
//   T4 首轮注入 + 每隔 2 轮补一次（混合）
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;
const RC = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";
const RC_ANCHOR = { role: "user", content: `${RC}${ANCHOR}` };
const RC_EMPTY = { role: "user", content: `${RC}Current DSH file policy: danger-full-access.` };
const SKILL = { role: "user", content: "The following skills are available:\n- cosmic-doc: documentary builder\n- office: Office documents\n- genui: UI components" };
const TIME = { role: "user", content: "Current time: 2026-10-18T21:00:00+08:00 (Sunday)." };

// 6 轮对话（每轮一个独立问题，模拟多轮会话）
const TURNS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "再写一个函数，把整数转成二进制字符串。输出代码。",
  "上面两个函数哪个更容易出错？为什么？",
  "写一个函数，找出列表中出现次数最多的元素。输出代码。",
  "这个函数在列表为空时返回什么？",
  "总结你这几轮写的函数，它们的共同点是什么。",
];

// 构造一个完整会话的 messages（调用方给注入策略函数）
function buildMessages(strategy, upToTurn) {
  const out = [{ role: "system", content: REAL_SYS }];
  for (let i = 0; i <= upToTurn; i++) {
    out.push({ role: "user", content: TURNS[i] });
    // 决定这一轮是否注入锚点
    if (strategy(i, upToTurn)) {
      out.push(RC_ANCHOR);
      out.push(SKILL);
      out.push(TIME);
    } else {
      out.push(RC_EMPTY);
      out.push(SKILL);
      out.push(TIME);
    }
    // 模拟助手回复（简短，避免上下文爆炸）
    out.push({ role: "assistant", content: `已完成第 ${i + 1} 个请求。` });
  }
  return out;
}

const STRATEGIES = {
  "T0_only_first": (i) => i === 0,
  "T1_every_turn": () => true,
  "T2_every_2nd": (i) => i % 2 === 0,
  "T3_first_and_last": (i, last) => i === 0 || i === last,
  "T4_first_plus_every2": (i) => i === 0 || i % 2 === 0,
  "T5_none": () => false,
};

async function call(messages) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: "deepseek-v4.1-flash", messages, max_tokens: 3000, reasoning_effort: "max", tools: TOOLS }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1500 * (a + 1))); continue; }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      const j = await r.json();
      const m = j.choices?.[0]?.message ?? {};
      return { reasoning: m.reasoning_content ?? m.reasoning ?? "", content: m.content ?? "", usage: j.usage };
    } catch { await new Promise(x => setTimeout(x, 1200)); }
  }
  return { error: "exhausted" };
}

function strip(t) { return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " "); }
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length + (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

// 关键设计：不是从头跑到尾，而是对每个「第 N 轮」单独测
// 因为我们要看的是「到第 N 轮时语域有没有掉」，而不是重放整个会话
const CHECKPOINTS = [0, 2, 4, 5]; // 检查第 1、3、5、6 轮
const jobs = [];
for (const [sname, fn] of Object.entries(STRATEGIES)) {
  for (const cp of CHECKPOINTS) {
    jobs.push({ sname, cp, messages: buildMessages(fn, cp) });
  }
}
console.log(`任务 ${jobs.length}（${Object.keys(STRATEGIES).length} 策略 × ${CHECKPOINTS.length} 检查点）effort=max 并发=100`);

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      out[my] = { ...j, res: await call(j.messages) };
      if (++done % 6 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(100, jobs.length) }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    strategy: r.sname, checkpoint: r.cp,
    turnNo: r.cp + 1,
    col, ind, ratio: tot ? col / tot : null,
    len: reason.length, error: r.res?.error ?? null,
    head: reason.trim().slice(0, 60),
  };
});
fs.writeFileSync("./capbench/results/reinject-cadence.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(90));
console.log("重注入节奏 × 会话进度 → We 占比（只统计 reasoning）");
console.log("=".repeat(90));
const cps = [...new Set(ok.map(r => r.turnNo))].sort((a, b) => a - b);
console.log("策略".padEnd(24) + cps.map(c => `第${c}轮`.padEnd(12)).join("") + "  均值");
for (const sname of Object.keys(STRATEGIES)) {
  const sub = ok.filter(r => r.strategy === sname);
  const cells = cps.map(c => {
    const s = sub.find(r => r.turnNo === c);
    if (!s || s.ratio === null) return "-".padEnd(12);
    return `${s.ratio.toFixed(2)}${s.ratio >= 0.85 ? "★" : " "}`.padEnd(12);
  });
  const withR = sub.filter(r => r.ratio !== null);
  const avg = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  console.log(sname.padEnd(24) + cells.join("") + `  ${avg.toFixed(3)}`);
}

console.log("\n=== 纯 We 率（ratio>=0.85）===");
for (const sname of Object.keys(STRATEGIES)) {
  const sub = ok.filter(r => r.strategy === sname && r.ratio !== null);
  if (!sub.length) continue;
  const we = sub.filter(r => r.ratio >= 0.85).length;
  console.log(`  ${sname.padEnd(24)} ${we}/${sub.length} = ${((100 * we) / sub.length).toFixed(0)}%`);
}

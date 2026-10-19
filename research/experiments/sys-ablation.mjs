// System prompt 消融（真实 wire，effort=max，100 并发）
// 勘察发现：13k system 里 We/Our/Let's = 0 次，Let me/I/my = 0 次，通篇第二人称 "you"（11 段）
// ⇒ 假设：把 system 的地基从第二人称改成第一人称复数，比在尾部加锚点更根本
//
// 变体：
//  S0 基线（原样 13k）
//  S1 persona 段改写：You are a coding agent → We are a coding team
//  S2 system 全量 you→we 重写
//  S3 开头加一段 We 身份
//  S4 结尾加一段 We 身份
//  S5 开头+结尾
//  S6 全量 rewire（you→we）+ 尾部锚点
//  S7 基线 + 尾部锚点（当前 preset 现状，作为对照）
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

// 当前 preset 的锚点（段落级版）
const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;

const PERSONA_OLD = "You are a coding agent powered by the deepseek-v4.1-flash model.";
const PERSONA_NEW = "We are a coding team powered by the deepseek-v4.1-flash model. We work as one.";

// you → we 的保守重写（只改叙述性 you，不动工具名/代码块/引号内容）
function rewireYouToWe(sys) {
  return sys
    // 主语位置的 You
    .replace(/\bYou are\b/g, "We are")
    .replace(/\bYou can\b/g, "We can")
    .replace(/\bYou must\b/g, "We must")
    .replace(/\bYou should\b/g, "We should")
    .replace(/\bYou need\b/g, "We need")
    .replace(/\bYou have\b/g, "We have")
    .replace(/\bYou will\b/g, "We will")
    .replace(/\bYou may\b/g, "We may")
    .replace(/\bYou don't\b/g, "We don't")
    .replace(/\bYou do not\b/g, "We do not")
    // 一般 You 作主语（句子开头）
    .replace(/(^|[.!?]\s+)You\b/g, "$1We")
    // your → our
    .replace(/\byour\b/g, "our")
    .replace(/\byourself\b/g, "ourselves");
}

const WE_PARA = `We are a team that thinks and works as one. Every step we take, we take together — reading, deciding, and verifying as a single mind. Our reasoning is where that thinking happens, out loud and in the open.`;

const SYSTEM_VARIANTS = {
  S0_baseline: REAL_SYS,
  S1_persona_we: REAL_SYS.replace(PERSONA_OLD, PERSONA_NEW),
  S2_full_rewire: rewireYouToWe(REAL_SYS),
  S3_head_we: `${WE_PARA}\n\n${REAL_SYS}`,
  S4_tail_we: `${REAL_SYS}\n\n${WE_PARA}`,
  S5_head_tail_we: `${WE_PARA}\n\n${REAL_SYS}\n\n${WE_PARA}`,
  S6_rewire_plus_anchor: `${rewireYouToWe(REAL_SYS)}`,
  S7_baseline_plus_anchor: REAL_SYS,
};

// 哪些变体额外带尾部锚点
const WITH_ANCHOR = {
  S0_baseline: false,
  S1_persona_we: false,
  S2_full_rewire: false,
  S3_head_we: false,
  S4_tail_we: false,
  S5_head_tail_we: false,
  S6_rewire_plus_anchor: true,
  S7_baseline_plus_anchor: true,
};

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
];

const REPS = 2;
const CONCURRENCY = 100;

// 先看各变体的长度和 you/we 计数，确认变体确实生效
console.log("=== 变体勘察 ===");
for (const [name, sys] of Object.entries(SYSTEM_VARIANTS)) {
  const you = (sys.match(/\byou\b/gi) ?? []).length;
  const we = (sys.match(/\b(We|Our|we|our)\b/g) ?? []).length;
  console.log(`  ${name.padEnd(24)} ${String(sys.length).padStart(6)}字  you=${String(you).padStart(3)}  we/our=${String(we).padStart(3)}  anchor=${WITH_ANCHOR[name]}`);
}

const jobs = [];
for (const [sid, sys] of Object.entries(SYSTEM_VARIANTS)) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      const messages = [{ role: "system", content: sys }, { role: "user", content: t }];
      if (WITH_ANCHOR[sid]) {
        messages.push({ role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${ANCHOR}` });
      }
      jobs.push({ sid, task: t.slice(0, 16), rep: r, messages });
    }
  }
}
console.log(`\n任务 ${jobs.length}  effort=max  并发=${CONCURRENCY}`);

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0, err = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: j.messages, max_tokens: 4000, reasoning_effort: "max", tools: TOOLS }),
          });
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1500 * (attempt + 1))); continue; }
          if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; break; }
          const jj = await r.json();
          const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { content: m.content ?? "", reasoning: m.reasoning_content ?? m.reasoning ?? "", finish: jj.choices?.[0]?.finish_reason } };
          break;
        } catch (e) {
          if (attempt === 2) { out[my] = { ...j, res: { error: String(e) } }; err++; }
          else await new Promise(x => setTimeout(x, 1500));
        }
      }
      if (++done % 10 === 0) process.stdout.write(`    ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── 分析 ──────────────────────────────────────────────────────
function strip(t) {
  return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
}
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length +
    (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}
function sentProfile(t) {
  const s = strip(t);
  const sents = s.split(/(?<=[.!?:])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 12);
  if (sents.length < 3) return null;
  const n = sents.length;
  const bins = [[], [], []];
  sents.forEach((sent, i) => {
    const { col, ind } = colInd(sent);
    const tot = col + ind;
    if (tot === 0) return;
    bins[Math.min(2, Math.floor((i / n) * 3))].push(col / tot);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { b1: avg(bins[0]), b2: avg(bins[1]), b3: avg(bins[2]) };
}

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    sid: r.sid, task: r.task, rep: r.rep,
    col, ind, ratio: tot ? col / tot : null,
    len: reason.length, contentLen: (r.res?.content ?? "").length,
    prof: sentProfile(reason),
    head: reason.trim().slice(0, 70),
    error: r.res?.error ?? null,
  };
});
fs.writeFileSync("./capbench/results/sys-ablation.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`\n有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(96));
console.log("System prompt 消融（真实 wire, effort=max, 100 并发）");
console.log("=".repeat(96));
console.log("变体".padEnd(24), "纯We率".padEnd(9), "均We占比".padEnd(10), "首/中/尾".padEnd(20), "reason长".padEnd(9), "content长");
for (const sid of Object.keys(SYSTEM_VARIANTS)) {
  const sub = ok.filter(r => r.sid === sid);
  if (!sub.length) { console.log(`${sid.padEnd(24)} (no data)`); continue; }
  const withR = sub.filter(r => r.ratio !== null);
  const we = withR.filter(r => r.ratio >= 0.85).length;
  const avgR = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  const profs = sub.map(r => r.prof).filter(Boolean);
  const avg = (k) => profs.length ? profs.reduce((a, p) => a + (p[k] ?? 0), 0) / profs.length : null;
  const avgLen = Math.round(sub.reduce((a, r) => a + r.len, 0) / sub.length);
  const avgC = Math.round(sub.reduce((a, r) => a + r.contentLen, 0) / sub.length);
  console.log(
    sid.padEnd(24),
    `${((100 * we) / Math.max(1, withR.length)).toFixed(0)}%`.padEnd(9),
    avgR.toFixed(3).padEnd(10),
    `${avg("b1")?.toFixed(2) ?? "-"}/${avg("b2")?.toFixed(2) ?? "-"}/${avg("b3")?.toFixed(2) ?? "-"}`.padEnd(20),
    String(avgLen).padEnd(9),
    avgC
  );
}

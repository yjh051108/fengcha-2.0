// 决定性验证：P3（锚点最后）在「真实完整 wire」下是否仍然成立
// 之前的 P3 测试是 [sys, user+anchor]，没有 skill-catalog / time-context 跟在后面
// 真实 wire 是 [sys, user, rc(anchor), skill-catalog, time-context]
//
// 对比：
//   R0 真实现状：[sys, user, rc(anchor)] （锚点后无内容）—— 模拟
//   R1 真实完整：[sys, user, rc(anchor), skill-catalog, time-context] ← 真实现状
//   R2 锚点最后：[sys, user, rc(空), skill-catalog, time-context, rc(anchor)] ← 想要的结构
//   R3 无锚点：[sys, user, rc(空), skill-catalog, time-context]
//
// 若 R2 > R1 显著，则值得改框架；若差不多，则现状已够。
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;

const RC = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";
// 真实的 skill-catalog / time-context 文本（从真实会话提取）
const SKILL = `The following skills are available for use with the Skill tool:\n\n- animation-quality-gate: Validate Blender animation attempts before accepting them by rendering contact sheets, checking silhouette stability.\n- cosmic-doc: A cinematic documentary builder.\n- office: Create, edit, inspect, or convert Office documents.`;

const TIME = `Current time: 2026-10-18T20:50:00+08:00 (Sunday). Session started 45m ago.`;

// 构造真实完整顺序
function build(kind, task) {
  const SYS = { role: "system", content: REAL_SYS };
  const U = { role: "user", content: task };
  const rcAnchor = { role: "user", content: `${RC}${ANCHOR}` };
  const rcEmpty = { role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nCurrent DSH file policy: danger-full-access.` };
  const sk = { role: "user", content: SKILL };
  const ti = { role: "user", content: TIME };
  switch (kind) {
    case "R0_simple_current": return [SYS, U, rcAnchor];                    // 简化（之前测的 P2）
    case "R1_real_current": return [SYS, U, rcAnchor, sk, ti];              // 真实现状
    case "R2_anchor_last": return [SYS, U, rcEmpty, sk, ti, rcAnchor];      // 锚点最后
    case "R3_none": return [SYS, U, rcEmpty, sk, ti];                       // 无锚点
  }
}

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
  "这段代码有什么并发问题？\n```js\nlet n = 0;\nasync function inc(){ const v = n; await tick(); n = v + 1; }\n```",
];

const KINDS = ["R0_simple_current", "R1_real_current", "R2_anchor_last", "R3_none"];
const REPS = 2;
const jobs = [];
for (const kind of KINDS) for (const t of TASKS) for (let r = 0; r < REPS; r++) jobs.push({ kind, task: t.slice(0, 16), rep: r, messages: build(kind, t) });
console.log(`任务 ${jobs.length}  effort=max  并发=100`);

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
          const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: j.messages, max_tokens: 4000, reasoning_effort: "max", tools: TOOLS }) });
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1500 * (a + 1))); continue; }
          if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; ok = true; break; }
          const jj = await r.json(); const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { reasoning: m.reasoning_content ?? m.reasoning ?? "", content: m.content ?? "" } }; ok = true;
        } catch { if (a === 2) { out[my] = { ...j, res: { error: "net" } }; ok = true; } else await new Promise(x => setTimeout(x, 1200)); }
      }
      if (++done % 12 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
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
  return { kind: r.kind, task: r.task, rep: r.rep, col, ind, ratio: tot ? col / tot : null, len: reason.length, error: r.res?.error ?? null };
});
fs.writeFileSync("./capbench/results/real-wire-position.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(88));
console.log("真实完整 wire 下的锚点位置（只统计 reasoning）");
console.log("=".repeat(88));
console.log("结构".padEnd(26), "纯We率".padEnd(9), "均We占比".padEnd(11), "reason长");
for (const kind of KINDS) {
  const sub = ok.filter(r => r.kind === kind);
  if (!sub.length) continue;
  const withR = sub.filter(r => r.ratio !== null);
  const we = withR.filter(r => r.ratio >= 0.85).length;
  const avg = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  const avgLen = Math.round(sub.reduce((a, r) => a + r.len, 0) / sub.length);
  const label = kind === "R0_simple_current" ? "锚点后无内容(简化)" :
    kind === "R1_real_current" ? "锚点→skill→time(现状)" :
    kind === "R2_anchor_last" ? "skill→time→锚点(想要)" : "无锚点";
  console.log(kind.padEnd(26), `${((100 * we) / Math.max(1, withR.length)).toFixed(0)}%`.padEnd(9), avg.toFixed(3).padEnd(11), avgLen);
  console.log(`  → ${label}`);
}

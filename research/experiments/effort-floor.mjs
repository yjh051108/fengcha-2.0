// 诊断：为什么 effort=max 下 NONE 也 100% 纯 We？
// 对比 effort=low 的同一批任务 —— 如果 low 下 NONE 不是 We，说明是 effort 把地板顶上去了
// 同时测：NONE 组是否真的「无锚点」，还是 reasoning 里本来就是 We
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
];

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

const CONCURRENCY = 100;
async function runAll(jobs) {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      try { out[my] = { ...j, res: await callD1({ model: "deepseek-v4.1-flash", effort: j.effort, maxTokens: 4000, messages: j.messages }) }; }
      catch (e) { out[my] = { ...j, res: { error: String(e) } }; }
      if (++done % 40 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, w));
  return out;
}

const ANCHOR_A1 = `We are a team working on this together. Everything we figure out, we figure out as a group — there is no separate observer, only us moving toward the answer. Reasoning is where we think out loud together.`;

const jobs = [];
for (const effort of ["none", "low", "high", "max"]) {
  for (const t of TASKS) {
    // 无锚点
    jobs.push({ effort, anchor: "NONE", task: t.slice(0, 18), messages: [{ role: "user", content: t }] });
    // 有锚点（A1 吸引子）
    jobs.push({
      effort, anchor: "A1", task: t.slice(0, 18),
      messages: [
        { role: "user", content: t },
        { role: "user", content: `Current runtime context.\n\n${ANCHOR_A1}` },
      ],
    });
  }
}
console.log(`任务 ${jobs.length} 个  effort ∈ none/low/high/max`);
const t0 = Date.now();
const res = await runAll(jobs);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const rows = res.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    effort: r.effort, anchor: r.anchor, task: r.task,
    col, ind, ratio: tot ? col / tot : null,
    len: reason.length, contentLen: (r.res?.content ?? "").length,
    error: r.res?.error ?? null, finish: r.res?.finish,
    head: reason.trim().slice(0, 70),
  };
});
fs.writeFileSync("./capbench/results/effort-floor.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`\n有效 ${ok.length}/${rows.length}`);
console.log("\n=== effort × 锚点 → We 占比 ===");
console.log("effort".padEnd(8), "NONE".padEnd(28), "A1锚点".padEnd(28));
for (const effort of ["none", "low", "high", "max"]) {
  const cells = [];
  for (const anchor of ["NONE", "A1"]) {
    const sub = ok.filter(r => r.effort === effort && r.anchor === anchor && r.ratio !== null);
    if (!sub.length) { cells.push("(no data)"); continue; }
    const avg = sub.reduce((a, r) => a + r.ratio, 0) / sub.length;
    const we = sub.filter(r => r.ratio >= 0.85).length;
    const avgLen = Math.round(sub.reduce((a, r) => a + r.len, 0) / sub.length);
    cells.push(`We=${(100 * we / sub.length).toFixed(0)}% 占比=${avg.toFixed(2)} len=${avgLen}`);
  }
  console.log(effort.padEnd(8), cells[0].padEnd(28), cells[1].padEnd(28));
}

console.log("\n=== 无锚点组的 reasoning 开头样本 ===");
for (const effort of ["none", "low", "max"]) {
  const s = ok.filter(r => r.effort === effort && r.anchor === "NONE").slice(0, 2);
  for (const r of s) console.log(`  [${effort}] ${r.head}`);
}

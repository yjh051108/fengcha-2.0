// 验证加强版：目标1 的冠军方案 + 目标2 的「每轮刷新」机制
// 判断标准更严格：
//   目标1：首块必须 100% 纯 We（不只是 3/3，要 8 次以上）
//   目标2：多轮 8 轮，看每轮是否都恢复 + 是否逐轮衰减
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

function strip(t) {
  return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
}
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}
function label(t) {
  const { col, ind } = colInd(t);
  const tot = col + ind;
  if (tot === 0) return "NONE";
  const r = col / tot;
  return r >= 0.85 ? "WE" : r <= 0.15 ? "I" : "MIXED";
}
// 更细：块内按句子位置看 We 密度衰减
function sentenceProfile(t) {
  const s = strip(t);
  const sentences = s.split(/(?<=[.!?:])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 12);
  if (sentences.length < 3) return null;
  const bins = { first: [], mid: [], last: [] };
  const n = sentences.length;
  sentences.forEach((sent, i) => {
    const { col, ind } = colInd(sent);
    const tot = col + ind;
    if (tot === 0) return;
    const r = col / tot;
    if (i < n / 3) bins.first.push(r);
    else if (i < 2 * n / 3) bins.mid.push(r);
    else bins.last.push(r);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { first: avg(bins.first), mid: avg(bins.mid), last: avg(bins.last), n };
}

const BASE = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.`;

const WINNERS = {
  C0_base: BASE,
  C1_paragraph: `${BASE} Every paragraph must begin with "We" or "Our".`,
  C3_fence: `${BASE} Open with "We need" and close with a sentence starting "We".`,
  C6_combo: `${BASE} Every paragraph must begin with "We" or "Our". Open with "We need" and close with a sentence starting "We".`,
};

const TASKS = [
  "用 Python 写一个函数，判断一个整数是否是质数。输出代码。",
  "用 Python 写一个函数，把列表中的 0 全部移到末尾，保持其他元素顺序。输出代码。",
  "分析这个循环为什么慢：for i in range(len(a)): for j in range(len(a)): s += a[i]*a[j]",
  "设计一个简单的缓存淘汰策略，说明为什么选它。",
];

// ══════ 目标1：每个候选跑 8 次，看首块纯 We 率 ══════
console.log("=== 目标1（加强）：每候选 8 次 ===");
const REPS = 8;
const g1 = [];
for (const [cid, anchor] of Object.entries(WINNERS)) {
  const labels = [];
  const profiles = [];
  for (let r = 0; r < REPS; r++) {
    const t = TASKS[r % TASKS.length];
    const messages = [{ role: "user", content: t }, { role: "user", content: `Current runtime context.\n\n${anchor}` }];
    const res = await callD1({ model: "deepseek-v4.1-flash", effort: "low", maxTokens: 2200, messages })
      .catch((e) => ({ error: String(e) }));
    const reason = res?.reasoning ?? "";
    const lb = label(reason);
    labels.push(lb);
    const prof = sentenceProfile(reason);
    if (prof) profiles.push(prof);
    g1.push({ candidate: cid, rep: r, label: lb, len: reason.length, ...colInd(reason), head: reason.trim().slice(0, 70) });
  }
  const counts = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
  const avgFirst = profiles.length ? profiles.reduce((a, p) => a + (p.first ?? 0), 0) / profiles.length : null;
  const avgMid = profiles.length ? profiles.reduce((a, p) => a + (p.mid ?? 0), 0) / profiles.length : null;
  const avgLast = profiles.length ? profiles.reduce((a, p) => a + (p.last ?? 0), 0) / profiles.length : null;
  console.log(`  ${cid.padEnd(14)} ${JSON.stringify(counts).padEnd(30)} 句内We密度 首=${avgFirst?.toFixed(2)} 中=${avgMid?.toFixed(2)} 尾=${avgLast?.toFixed(2)}`);
}
fs.writeFileSync("./capbench/results/we-goal1b.json", JSON.stringify(g1, null, 1));

// ══════ 目标2：8 轮多轮，每轮刷新锚点 ══════
console.log("\n=== 目标2（加强）：8 轮，每轮重注入 ===");
const TURNS8 = [
  "用 Python 写一个函数判断回文。输出代码。",
  "再写一个函数统计词频。输出代码。",
  "这两个函数各有什么边界问题？",
  "写一个合并两个有序数组的函数。输出代码。",
  "写一个二分查找。输出代码。",
  "上面二分查找的边界为什么要那样写？",
  "写一个数组去重函数，保持顺序。输出代码。",
  "总结这几个函数的共同点。",
];

async function multiRun(anchor, label2) {
  const messages = [];
  const turns = [];
  for (let i = 0; i < TURNS8.length; i++) {
    messages.push({ role: "user", content: TURNS8[i] });
    if (anchor) messages.push({ role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}` });
    const res = await callD1({ model: "deepseek-v4.1-flash", effort: "low", maxTokens: 2200, messages })
      .catch((e) => ({ error: String(e) }));
    const reason = res?.reasoning ?? "";
    const content = res?.content ?? "";
    turns.push({ turn: i + 1, label: label(reason), ...colInd(reason), len: reason.length });
    messages.push({ role: "assistant", content: content || "(no content)" });
  }
  console.log(`  [${label2}] ${turns.map((t) => t.label[0]).join("")}`);
  return turns;
}

const m2 = {};
m2.C1 = await multiRun(WINNERS.C1_paragraph, "C1_paragraph");
m2.C6 = await multiRun(WINNERS.C6_combo, "C6_combo");
m2.none = await multiRun(null, "无锚点");
fs.writeFileSync("./capbench/results/we-goal2b.json", JSON.stringify(m2, null, 1));

console.log("\n=== 目标2 汇总（W=纯We M=混合 I=纯LetMe N=无）===");
for (const [k, turns] of Object.entries(m2)) {
  const we = turns.filter((t) => t.label === "WE").length;
  const mix = turns.filter((t) => t.label === "MIXED").length;
  const ii = turns.filter((t) => t.label === "I").length;
  console.log(`  ${k.padEnd(12)} WE=${we} MIX=${mix} I=${ii} / 8`);
  console.log(`    逐轮: ${turns.map((t) => `L${t.turn}:${t.label}(${t.col}/${t.ind})`).join(" ")}`);
}

// 深挖机制：为什么 We→I 是单向的？两种假说
// H-A「相变/棘轮」：两个亚稳态，I 是深阱，We 是浅阱，存在不对称势垒
// H-B「相位长度」：We 是规划期（短），I 是执行期（长）；规划短所以少见，执行长所以压倒
// 判别：如果 H-B 对，那么 (a) 块长应强烈预测标签 (b) 会话内首个块应更偏 We (c) 块级长度分布应双峰
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

function stripCode(t) {
  return String(t ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]{0,120}`/g, " ")
    .replace(/"[^"\n]{0,200}"/g, " ")
    .replace(/'[^'\n]{0,200}'/g, " ");
}
function counts(t) {
  const s = stripCode(t);
  const we = (s.match(/\bWe\b/g) ?? []).length;
  const our = (s.match(/\bOur\b/g) ?? []).length;
  const us = (s.match(/\bUs\b/g) ?? []).length;
  const lets = (s.match(/\bLet's\b/g) ?? []).length;
  const letme = (s.match(/\bLet me\b/g) ?? []).length;
  const iSing = (s.match(/\bI\b(?!['’])/g) ?? []).length;
  const iContr = (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length;
  const my = (s.match(/\bMy\b/g) ?? []).length;
  return { col: we + our + us + lets, ind: letme + iSing + iContr + my };
}
function cls(t) {
  const { col, ind } = counts(t);
  const tot = col + ind;
  if (tot === 0) return { label: "NONE", ratio: null };
  const r = col / tot;
  return { label: r >= 0.85 ? "WE" : r <= 0.15 ? "I" : "MIXED", ratio: r };
}

const allBlocks = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  let idx = 0;
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    if (r.trim().length < 30) continue;
    const c2 = cls(r);
    allBlocks.push({ sid, idx: idx++, len: r.length, ...c2, text: r });
  }
}

console.log(`总 reasoning blocks: ${allBlocks.length}`);

// ── (a) 块长 vs 标签 ─────────────────────────────────────────────
console.log("\n=== (a) 标签 × 块长 ===");
const byLabel = {};
for (const b of allBlocks) (byLabel[b.label] ??= []).push(b.len);
for (const [l, v] of Object.entries(byLabel).sort((a, b) => b[1].length - a[1].length)) {
  v.sort((x, y) => x - y);
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  console.log(
    `  ${l.padEnd(6)} n=${String(v.length).padStart(5)}  中位长度=${String(v[Math.floor(v.length / 2)]).padStart(6)}  均值=${String(Math.round(mean)).padStart(6)}  p90=${v[Math.floor(v.length * 0.9)]}`
  );
}

// 只看纯标签
const pureWE = allBlocks.filter((b) => b.label === "WE").map((b) => b.len).sort((a, b) => a - b);
const pureI = allBlocks.filter((b) => b.label === "I").map((b) => b.len).sort((a, b) => a - b);
const med = (a) => a[Math.floor(a.length / 2)];
console.log(`\n  纯 WE 中位长度 = ${med(pureWE)}   纯 I 中位长度 = ${med(pureI)}   倍数 = ${(med(pureI) / med(pureWE)).toFixed(1)}x`);

// ── (b) 会话内位置 vs 标签（首个块是否更偏 We）──────────────────
console.log("\n=== (b) 块在会话内的位置 × 语域 ===");
const posBuckets = { "1st": [], "2-4": [], "5-9": [], "10-19": [], "20-39": [], "40+": [] };
for (const b of allBlocks) {
  const i = b.idx;
  const key = i === 0 ? "1st" : i < 4 ? "2-4" : i < 9 ? "5-9" : i < 19 ? "10-19" : i < 39 ? "20-39" : "40+";
  if (b.label === "WE" || b.label === "I") posBuckets[key].push(b.label);
}
for (const [k, v] of Object.entries(posBuckets)) {
  if (!v.length) continue;
  const we = v.filter((x) => x === "WE").length;
  console.log(`  ${k.padEnd(6)} n=${String(v.length).padStart(5)}  We占比=${((100 * we) / v.length).toFixed(1)}%`);
}

// ── (c) 块长分布是否双峰 ────────────────────────────────────────
console.log("\n=== (c) 块长分布（log10 分箱，检验双峰）===");
const edges = [30, 100, 300, 1000, 3000, 10000, 30000, 1e9];
const lab = ["<100", "100-300", "300-1k", "1k-3k", "3k-10k", "10k-30k", "30k+"];
const weByBucket = lab.map((_, i) => []);
for (const b of allBlocks) {
  let bi = edges.findIndex((e, i) => b.len < e);
  if (bi < 0) bi = lab.length - 1;
  if (b.label === "WE" || b.label === "I") weByBucket[bi].push(b.label);
}
lab.forEach((l, i) => {
  const v = weByBucket[i];
  if (!v.length) return;
  const we = v.filter((x) => x === "WE").length;
  const bar = "█".repeat(Math.round((we / v.length) * 40));
  console.log(`  ${l.padEnd(10)} n=${String(v.length).padStart(5)}  We占比=${((100 * we) / v.length).toFixed(0).padStart(3)}% ${bar}`);
});

// ── 关键：块内是否真的从 We 开头、以 I 结尾 ─────────────────────
console.log("\n=== (d) 开头词 vs 结尾词的语域 ===");
const WE_START = /^\s*(We|Our|Let's)\b/i;
const I_START = /^\s*(Let me|I|I'm|I'll|I've)\b/i;
let mixedBlocks = 0, weStartIEnd = 0, iStartWeEnd = 0;
for (const b of allBlocks) {
  const t = stripCode(b.text);
  const first = t.trim().split(/\s+/).slice(0, 1).join(" ");
  const tail = t.trim().slice(-200);
  const startWE = WE_START.test(t);
  const startI = I_START.test(t);
  const tailCol = (tail.match(/\b(We|Our|Let's)\b/g) ?? []).length;
  const tailInd = (tail.match(/\b(Let me|I|I'm|I'll|My)\b/g) ?? []).length;
  if (startWE && tailInd > tailCol) weStartIEnd++;
  if (startI && tailCol > tailInd) iStartWeEnd++;
  if (startWE || startI) mixedBlocks++;
}
console.log(`  以 We/Let's 开头但结尾偏 I : ${weStartIEnd}`);
console.log(`  以 Let me/I 开头但结尾偏 We: ${iStartWeEnd}`);
console.log(`  → 单向下滑 ${weStartIEnd > iStartWeEnd * 2 ? "★ 确认（We开头→I结尾 远多于反向）" : "不成立"}`);

fs.writeFileSync("./capbench/results/mechanism.json", JSON.stringify({
  byLabel: Object.fromEntries(Object.entries(byLabel).map(([k, v]) => [k, v.length])),
  medWE: med(pureWE), medI: med(pureI),
  positionWe: Object.fromEntries(Object.entries(posBuckets).map(([k, v]) => [k, v.length ? v.filter(x => x === "WE").length / v.length : null])),
  weStartIEnd, iStartWeEnd,
}, null, 1));

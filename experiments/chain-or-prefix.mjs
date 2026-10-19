// 决定性检验：「We need」到底是「一条思维链」还是「一个开场白」？
// 这决定了两种语域的性质完全不同
//
// 若它是思维链：集体词应散布在整块，且块内位置分布均匀
// 若它是开场白：集体词高度集中在块首，之后迅速消失
//
// 同时检验你的核心直觉：We 和 Let me 的语义映射是否贴反了
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

function stripCode(t) {
  return String(t ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]{0,120}`/g, " ")
    .replace(/"[^"\n]{0,200}"/g, " ")
    .replace(/'[^'\n]{0,200}'/g, " ");
}
function colInd(t) {
  const s = stripCode(t);
  const col =
    (s.match(/\bWe\b/g) ?? []).length +
    (s.match(/\bOur\b/g) ?? []).length +
    (s.match(/\bUs\b/g) ?? []).length +
    (s.match(/\bLet's\b/g) ?? []).length;
  const ind =
    (s.match(/\bLet me\b/g) ?? []).length +
    (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length +
    (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}
function label(t) {
  const { col, ind } = colInd(t);
  const tot = col + ind;
  if (tot === 0) return "NONE";
  const r = col / tot;
  return r >= 0.85 ? "WE" : r <= 0.15 ? "I" : "MIXED";
}

// 收集块
const blocks = [];
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
    if (r.trim().length < 50) continue;
    blocks.push({ sid, idx: idx++, len: r.length, label: label(r), text: r });
  }
}
console.log(`blocks: ${blocks.length}`);

// ── 检验 1：集体词在块内的位置分布 ──────────────────────────────
// 把每个块按长度分成 10 段，统计每段的集体词占比
console.log("\n=== 检验1：集体词/个体词在块内的位置分布（全部 WE 块）===");
const weBlocks = blocks.filter((b) => b.label === "WE" && b.len >= 200);
console.log(`  WE 块数（len>=200）: ${weBlocks.length}`);
const segCol = new Array(10).fill(0);
const segInd = new Array(10).fill(0);
for (const b of weBlocks) {
  const n = b.text.length;
  for (let s = 0; s < 10; s++) {
    const seg = b.text.slice(Math.floor((n * s) / 10), Math.floor((n * (s + 1)) / 10));
    const c = colInd(seg);
    segCol[s] += c.col;
    segInd[s] += c.ind;
  }
}
console.log("  段位置:      " + Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(6)).join(""));
console.log("  集体词数:    " + segCol.map((x) => String(x).padStart(6)).join(""));
console.log("  个体词数:    " + segInd.map((x) => String(x).padStart(6)).join(""));
const totalCol = segCol.reduce((a, b) => a + b, 0);
console.log(`  前 10% 段占全部集体词的: ${((100 * segCol[0]) / totalCol).toFixed(1)}%`);
const firstHalf = segCol.slice(0, 5).reduce((a, b) => a + b, 0);
console.log(`  前 50% 段占全部集体词的: ${((100 * firstHalf) / totalCol).toFixed(1)}%`);
console.log(`  → ${(segCol[0] / totalCol) > 0.35 ? "★ 开场白现象：集体词高度集中在开头" : "思维链现象：集体词分布较均匀"}`);

// ── 检验 2：同样对 I 块做位置分布 ───────────────────────────────
console.log("\n=== 检验2：个体词在 I 块内的位置分布 ===");
const iBlocks = blocks.filter((b) => b.label === "I" && b.len >= 200);
console.log(`  I 块数（len>=200）: ${iBlocks.length}`);
const iSegInd = new Array(10).fill(0);
const iSegCol = new Array(10).fill(0);
for (const b of iBlocks) {
  const n = b.text.length;
  for (let s = 0; s < 10; s++) {
    const seg = b.text.slice(Math.floor((n * s) / 10), Math.floor((n * (s + 1)) / 10));
    const c = colInd(seg);
    iSegInd[s] += c.ind;
    iSegCol[s] += c.col;
  }
}
console.log("  段位置:      " + Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(6)).join(""));
console.log("  个体词数:    " + iSegInd.map((x) => String(x).padStart(6)).join(""));
console.log("  集体词数:    " + iSegCol.map((x) => String(x).padStart(6)).join(""));
const totInd = iSegInd.reduce((a, b) => a + b, 0);
console.log(`  个体词在前 10% 段: ${((100 * iSegInd[0]) / totInd).toFixed(1)}%   前 50%: ${((100 * iSegInd.slice(0, 5).reduce((a, b) => a + b, 0)) / totInd).toFixed(1)}%`);
console.log(`  → ${(iSegInd[0] / totInd) > 0.35 ? "★ I 也是开场白现象" : "I 更像贯穿全程的思维链"}`);

// ── 检验 3：块首 40 字符是否足以预测整块标签 ────────────────────
console.log("\n=== 检验3：只看块首 40 字符能否预测整块语域 ===");
let agree = 0, total = 0;
for (const b of blocks) {
  if (b.label !== "WE" && b.label !== "I") continue;
  const head = b.text.slice(0, 40);
  const headLabel = label(head);
  if (headLabel !== "WE" && headLabel !== "I") continue;
  total++;
  if (headLabel === b.label) agree++;
}
console.log(`  可判定块数: ${total}`);
console.log(`  块首预测整块准确率: ${((100 * agree) / total).toFixed(1)}%`);
console.log(`  → ${agree / total > 0.9 ? "★ 语域完全由开头决定（开场白性质）" : "整块语域会演化"}`);

// ── 检验 4：WE 块里，集体词之后模型用什么语域 ────────────────────
console.log("\n=== 检验4：WE 块中，去掉第一句之后是什么语域 ===");
let afterWeCol = 0, afterWeInd = 0;
let counted = 0;
for (const b of weBlocks) {
  const s = stripCode(b.text);
  const firstSentenceEnd = s.search(/[.!?]\s/);
  if (firstSentenceEnd < 0 || firstSentenceEnd > 400) continue;
  const rest = s.slice(firstSentenceEnd + 1);
  if (rest.length < 100) continue;
  const c = colInd(rest);
  afterWeCol += c.col;
  afterWeInd += c.ind;
  counted++;
}
console.log(`  分析了 ${counted} 个 WE 块的首句之后内容`);
console.log(`  首句之后: 集体词 ${afterWeCol}, 个体词 ${afterWeInd}`);
console.log(`  之后集体占比: ${((100 * afterWeCol) / (afterWeCol + afterWeInd || 1)).toFixed(1)}%`);
console.log(`  → ${afterWeCol / (afterWeCol + afterWeInd) < 0.3 ? "★ 首句之后迅速转为个体/无主语句（开场白确证）" : "集体语域持续"}`);

// ── 检验 5：语域 vs 内容类型的相关性（We 真的=高执行力吗）───────
console.log("\n=== 检验5：WE 块与 I 块的内容特征对比 ===");
const feats = (list) => {
  const f = { codeBlocks: 0, toolMentions: 0, questionMarks: 0, numbers: 0, n: list.length };
  for (const b of list) {
    if (/```/.test(b.text)) f.codeBlocks++;
    if (/\b(tool|call|invoke|read|write|edit|run)\b/i.test(b.text)) f.toolMentions++;
    if (/\?/.test(b.text)) f.questionMarks++;
    f.numbers += (b.text.match(/\d+/g) ?? []).length;
  }
  return f;
};
const fWE = feats(weBlocks), fI = feats(iBlocks);
const pct = (x, n) => ((100 * x) / n).toFixed(1) + "%";
console.log(`  特征              WE(n=${fWE.n})      I(n=${fI.n})`);
console.log(`  含代码块          ${pct(fWE.codeBlocks, fWE.n).padStart(8)}      ${pct(fI.codeBlocks, fI.n).padStart(8)}`);
console.log(`  提及工具动作      ${pct(fWE.toolMentions, fWE.n).padStart(8)}      ${pct(fI.toolMentions, fI.n).padStart(8)}`);
console.log(`  含问号            ${pct(fWE.questionMarks, fWE.n).padStart(8)}      ${pct(fI.questionMarks, fI.n).padStart(8)}`);
console.log(`  平均数字个数      ${(fWE.numbers / fWE.n).toFixed(1).padStart(8)}      ${(fI.numbers / fI.n).toFixed(1).padStart(8)}`);

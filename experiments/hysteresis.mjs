// 验证你的观察：单向棘轮（hysteresis）
// 你的三个断言：
//   ① 会话要么全 We 要么全 Let me（双峰，不是连续漂移）
//   ② We → Let me 可以发生，但跨过去就回不去
//   ③ Let me → We 从来不发生
// 数据源：生产语料（305 个真实会话），免费，零 API
//
// 同时测「块内漂移」：单个 reasoning block 内部是否从 We 开始、向 Let me 滑落
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

// ── 统一分类器（与 route-test 同口径）─────────────────────────────
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

function classifyBlock(t) {
  const { col, ind } = counts(t);
  const total = col + ind;
  if (total === 0) return { label: "NONE", ratio: null, col, ind };
  const ratio = col / total;
  const label = ratio >= 0.85 ? "WE" : ratio <= 0.15 ? "I" : "MIXED";
  return { label, ratio, col, ind };
}

// 句级分类（用于块内漂移）
function classifySegments(t) {
  const s = stripCode(t);
  // 按句切分
  const segs = s.split(/(?<=[.!?:])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 6);
  return segs.map((seg) => {
    const c = counts(seg);
    const tot = c.col + c.ind;
    return { len: seg.length, col: c.col, ind: c.ind, total: tot, ratio: tot ? c.col / tot : null };
  });
}

// ── 收集所有 reasoning block（带会话/轮次顺序）────────────────────
const sessions = [];
for (const k of Object.keys(RAW)) {
  const entry = RAW[k];
  const ev = entry?.events;
  if (!Array.isArray(ev)) continue;
  const blocks = [];
  let turn = 0;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind !== "runtime-context") turn++;
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    if (r.trim().length < 30) continue;
    const cls = classifyBlock(r);
    blocks.push({ turn, len: r.length, ...cls, text: r });
  }
  if (blocks.length >= 3) {
    sessions.push({ id: entry.path?.split("\\").slice(-2)[0] ?? "?", blocks });
  }
}

console.log(`可用会话（>=3 reasoning blocks）: ${sessions.length}`);

// ── ① 会话级双峰性：会话平均 ratio 的分布 ────────────────────────
console.log("\n=== ① 会话级语域分布（检验「全 We 或 全 I」双峰）===");
const sessStats = [];
for (const s of sessions) {
  const withR = s.blocks.filter((b) => b.ratio !== null);
  if (withR.length < 3) continue;
  const meanRatio = withR.reduce((a, b) => a + b.ratio, 0) / withR.length;
  const weFrac = s.blocks.filter((b) => b.label === "WE").length / s.blocks.length;
  const iFrac = s.blocks.filter((b) => b.label === "I").length / s.blocks.length;
  sessStats.push({ id: s.id, n: withR.length, meanRatio, weFrac, iFrac });
}
const bins = new Array(10).fill(0);
for (const s of sessStats) bins[Math.min(9, Math.floor(s.meanRatio * 10))]++;
console.log("会话平均 We 占比 直方图 [0-.1 ... .9-1]:");
console.log("  " + bins.join("  "));
const pureWe = sessStats.filter((s) => s.weFrac >= 0.9).length;
const pureI = sessStats.filter((s) => s.iFrac >= 0.9).length;
const mixed = sessStats.length - pureWe - pureI;
console.log(`  纯 We 会话: ${pureWe} (${(100 * pureWe / sessStats.length).toFixed(0)}%)`);
console.log(`  纯 I  会话: ${pureI} (${(100 * pureI / sessStats.length).toFixed(0)}%)`);
console.log(`  混合  会话: ${mixed} (${(100 * mixed / sessStats.length).toFixed(0)}%)`);
console.log(`  → ${pureWe + pureI > sessStats.length * 0.5 ? "双峰确认：多数会话锁定单一语域" : "非双峰：存在大量混合会话"}`);

// ── ② 单向棘轮：跨块转移动态 ────────────────────────────────────
console.log("\n=== ② 跨块转移矩阵（检验单向棘轮）===");
const trans = {};
let weToI = 0, iToWe = 0, weToWe = 0, iToI = 0;
for (const s of sessions) {
  let prev = null;
  for (const b of s.blocks) {
    if (b.label === "MIXED" || b.label === "NONE") continue;
    if (prev) {
      const key = `${prev}→${b.label}`;
      trans[key] = (trans[key] ?? 0) + 1;
      if (prev === "WE" && b.label === "I") weToI++;
      if (prev === "I" && b.label === "WE") iToWe++;
      if (prev === "WE" && b.label === "WE") weToWe++;
      if (prev === "I" && b.label === "I") iToI++;
    }
    prev = b.label;
  }
}
console.log(`  We → We : ${weToWe}`);
console.log(`  We → I  : ${weToI}   ← 你说的「越过去」`);
console.log(`  I  → I  : ${iToI}`);
console.log(`  I  → We : ${iToWe}   ← 你说的「从来不发生」`);
console.log(`  转移频率:`);
console.log(`    P(I | We) = ${(weToI / (weToI + weToWe || 1)).toFixed(4)}`);
console.log(`    P(We | I) = ${(iToWe / (iToWe + iToI || 1)).toFixed(4)}`);
const asymmetry = iToWe + weToI > 0 ? (iToWe - weToI) / (iToWe + weToI) : null;
console.log(`  不对称度 = ${asymmetry?.toFixed(3)}  (-1=完全单向 We→I, 0=对称)`);

// ── ③ 块内漂移：单个 block 内部是否从 We 开始向 I 滑落 ───────────
console.log("\n=== ③ 块内漂移（单个 block 内部的位置-语域曲线）===");
const posBins = { early: [], mid: [], late: [] };
let blocksAnalyzed = 0;
for (const s of sessions) {
  for (const b of s.blocks) {
    if (b.len < 400) continue;
    const segs = classifySegments(b.text).filter((x) => x.total > 0);
    if (segs.length < 4) continue;
    blocksAnalyzed++;
    const n = segs.length;
    const third = Math.floor(n / 3);
    const avg = (arr) => (arr.length ? arr.reduce((a, x) => a + x.ratio, 0) / arr.length : null);
    const e = avg(segs.slice(0, third));
    const m = avg(segs.slice(third, 2 * third));
    const l = avg(segs.slice(2 * third));
    if (e !== null) posBins.early.push(e);
    if (m !== null) posBins.mid.push(m);
    if (l !== null) posBins.late.push(l);
  }
}
const avgOf = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`  分析了 ${blocksAnalyzed} 个长 block`);
console.log(`  块首 1/3 平均 We 占比: ${avgOf(posBins.early).toFixed(3)}`);
console.log(`  块中 1/3 平均 We 占比: ${avgOf(posBins.mid).toFixed(3)}`);
console.log(`  块尾 1/3 平均 We 占比: ${avgOf(posBins.late).toFixed(3)}`);
const drop = avgOf(posBins.early) - avgOf(posBins.late);
console.log(`  块内落差 = ${drop.toFixed(3)}  ${drop > 0.15 ? "★ 块内存在 We→I 的单向下滑" : "块内无明显下滑"}`);

fs.writeFileSync(
  "./capbench/results/hysteresis.json",
  JSON.stringify({ sessStats, trans, posBins: { early: posBins.early.length, mid: posBins.mid.length, late: posBins.late.length } }, null, 1)
);

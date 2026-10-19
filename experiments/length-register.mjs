// 核对矛盾：受控实验说「长思考→Let me」(r=-0.759)，生产语料却说 r=+0.076
// 必须查清楚谁对，否则「谁是规划谁是执行」整个结论是空的
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
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length +
    (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

const pear = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

// ── 生产语料：按会话分组，检验 within-session vs between-session ──
const sessions = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const blocks = [];
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    if (r.trim().length < 100) continue;
    const { col, ind } = counts(r);
    const tot = col + ind;
    if (tot === 0) continue;
    blocks.push({ len: r.length, ratio: col / tot, col, ind });
  }
  if (blocks.length >= 2) sessions.push({ sid: k, blocks });
}
const all = sessions.flatMap((s) => s.blocks);
console.log(`生产语料：${sessions.length} 会话 / ${all.length} 块`);

console.log("\n=== A. 生产语料总体相关 ===");
console.log(`  Pearson(len, We占比) = ${pear(all.map(b => b.len), all.map(b => b.ratio)).toFixed(3)}`);

// 会话内去均值（消除会话级差异）
const withinX = [], withinY = [];
for (const s of sessions) {
  const mx = s.blocks.reduce((a, b) => a + b.len, 0) / s.blocks.length;
  const my = s.blocks.reduce((a, b) => a + b.ratio, 0) / s.blocks.length;
  for (const b of s.blocks) { withinX.push(b.len - mx); withinY.push(b.ratio - my); }
}
console.log(`  会话内去均值后 Pearson = ${pear(withinX, withinY).toFixed(3)}  ← 这才是「同一任务里思考越长越怎样」`);

// 会话级（每会话一个点）
const sessX = sessions.map(s => s.blocks.reduce((a, b) => a + b.len, 0) / s.blocks.length);
const sessY = sessions.map(s => s.blocks.reduce((a, b) => a + b.ratio, 0) / s.blocks.length);
console.log(`  会话级 Pearson = ${pear(sessX, sessY).toFixed(3)}  ← 这是「会话平均思考越长越怎样」`);

// ── 受控实验数据：重新拆 within-task / between-task ──────────────
const CTRL = JSON.parse(fs.readFileSync("./capbench/results/route-fix.json", "utf8"));
const ctrl = CTRL.filter((r) => r.ratio !== null && r.len > 0);
console.log(`\n=== B. controlled exp (n=${ctrl.length}) ===`);
console.log(`  总体 Pearson(len, ratio) = ${pear(ctrl.map(r => r.len), ctrl.map(r => r.ratio)).toFixed(3)}`);

// 按 taskId 分组去均值
const byTask = {};
for (const r of ctrl) (byTask[r.taskId] ??= []).push(r);
const tx = [], ty = [];
for (const [tid, rs] of Object.entries(byTask)) {
  if (rs.length < 2) continue;
  const mx = rs.reduce((a, b) => a + b.len, 0) / rs.length;
  const my = rs.reduce((a, b) => a + b.ratio, 0) / rs.length;
  for (const r of rs) { tx.push(r.len - mx); ty.push(r.ratio - my); }
}
console.log(`  任务内去均值后 Pearson = ${pear(tx, ty).toFixed(3)}  (n=${tx.length})`);
const taskX = Object.values(byTask).map(rs => rs.reduce((a, b) => a + b.len, 0) / rs.length);
const taskY = Object.values(byTask).map(rs => rs.reduce((a, b) => a + b.ratio, 0) / rs.length);
console.log(`  任务级 Pearson = ${pear(taskX, taskY).toFixed(3)}  (n=${taskX.length} 个任务)  ← 这才是「不同任务间」的效应`);

console.log("\n  每个任务的平均值：");
for (const [tid, rs] of Object.entries(byTask)) {
  const ml = Math.round(rs.reduce((a, b) => a + b.len, 0) / rs.length);
  const mr = (rs.reduce((a, b) => a + b.ratio, 0) / rs.length).toFixed(2);
  console.log(`    ${tid.padEnd(4)} len=${String(ml).padStart(6)} ratio=${mr} n=${rs.length}`);
}

// ── C. 关键：生产语料里，长的块是否只是因为「任务长」而不是「语域」 ──
console.log("\n=== C. 生产语料：按块在会话内的位置分层，看长度-语域关系 ===");
const buckets = { "第1块": [], "第2-4块": [], "第5块+": [] };
for (const s of sessions) {
  s.blocks.forEach((b, i) => {
    const k = i === 0 ? "第1块" : i < 4 ? "第2-4块" : "第5块+";
    buckets[k].push(b);
  });
}
for (const [k, v] of Object.entries(buckets)) {
  if (v.length < 10) continue;
  console.log(`  ${k} n=${String(v.length).padStart(4)}  中位长度=${v.map(b => b.len).sort((a, b) => a - b)[Math.floor(v.length / 2)]}  平均We占比=${(v.reduce((a, b) => a + b.ratio, 0) / v.length).toFixed(3)}  长度-语域相关=${pear(v.map(b => b.len), v.map(b => b.ratio)).toFixed(3)}`);
}

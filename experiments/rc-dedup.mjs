// 验证：真实 DSH 里 runtime-context 到底每轮注入一次，还是只在内容变化时注入？
// 代码证据：RuntimeContextProjection.project() 有 `if (this.retained?.text === snapshot) return;`
// ⇒ 内容不变则跳过
//
// 数据验证：统计每个会话里 runtime-context 消息数 vs turn 数
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

const ANCHOR_RE = /open (every|our) reasoning (block|with)|We always open our reasoning/;

let sessions = 0;
const rows = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";

  let turns = 0;
  let rcCount = 0;
  let anchCount = 0;
  let asstCount = 0;
  const rcTexts = new Set();

  for (const e of ev) {
    if (e.type === "turn/start") turns++;
    if (e.type === "assistant/message") asstCount++;
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      rcCount++;
      const txt = (Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join("");
      rcTexts.add(txt);
      if (ANCHOR_RE.test(txt)) anchCount++;
    }
  }
  if (turns >= 2) {
    sessions++;
    rows.push({ sid, turns, rcCount, anchCount, asstCount, distinctRc: rcTexts.size });
  }
}

console.log(`多轮会话（turn>=2）: ${sessions}\n`);

// 按照「rcCount / turns」分组
console.log("=== runtime-context 注入次数 vs turn 数 ===");
const withRc = rows.filter(r => r.rcCount > 0);
console.log(`有 runtime-context 的会话: ${withRc.length}`);
const ratioBins = { "1次/turn（每轮都注入）": 0, "少于每轮": 0, "多于每轮": 0 };
for (const r of withRc) {
  const ratio = r.rcCount / r.turns;
  if (Math.abs(ratio - 1) < 0.15) ratioBins["1次/turn（每轮都注入）"]++;
  else if (ratio < 1) ratioBins["少于每轮"]++;
  else ratioBins["多于每轮"]++;
}
console.log(JSON.stringify(ratioBins, null, 1));

// 关键：含锚点的多轮会话
console.log("\n=== 含锚点的多轮会话（看锚点注入了几次）===");
const anchored = rows.filter(r => r.anchCount > 0);
console.log(`含锚点多轮会话: ${anchored.length}`);
console.log("会话                     turns  rc次数  锚点次数  不同rc内容");
for (const r of anchored.slice(0, 25)) {
  console.log(`${r.sid.slice(0, 22).padEnd(24)} ${String(r.turns).padStart(4)} ${String(r.rcCount).padStart(6)} ${String(r.anchCount).padStart(8)} ${String(r.distinctRc).padStart(10)}`);
}

// 统计：锚点次数 / turn 数
if (anchored.length) {
  const ratios = anchored.map(r => r.anchCount / r.turns);
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  console.log(`\n锚点注入率（锚点次数/turn数）: 均值 ${avg.toFixed(3)}`);
  console.log(`  说明：1.0 = 每轮都注入；<1 = 有轮次没注入`);
  const buckets = { "1.0（每轮）": 0, "0.5-1.0": 0, "0.2-0.5": 0, "<0.2": 0 };
  for (const x of ratios) {
    if (x >= 0.99) buckets["1.0（每轮）"]++;
    else if (x >= 0.5) buckets["0.5-1.0"]++;
    else if (x >= 0.2) buckets["0.2-0.5"]++;
    else buckets["<0.2"]++;
  }
  console.log("  分布:", JSON.stringify(buckets, null, 1));
}

// 另一个角度：rc 的不同内容数 —— 若锚点是常量且其他上下文也不变，distinctRc 应很小
console.log("\n=== 不同 runtime-context 内容数（检验去重）===");
const allRc = rows.filter(r => r.rcCount > 0);
const distinctStats = allRc.map(r => ({ turns: r.turns, rc: r.rcCount, distinct: r.distinctRc }));
const avgDistinct = distinctStats.reduce((a, b) => a + b.distinct, 0) / distinctStats.length;
const avgRc = distinctStats.reduce((a, b) => a + b.rc, 0) / distinctStats.length;
const avgTurns = distinctStats.reduce((a, b) => a + b.turns, 0) / distinctStats.length;
console.log(`  平均 turn=${avgTurns.toFixed(1)}  rc消息数=${avgRc.toFixed(1)}  不同内容数=${avgDistinct.toFixed(1)}`);
console.log(`  → ${avgDistinct < avgRc * 0.7 ? "★ 存在去重：不同内容数显著少于注入次数" : "去重不明显"}`);

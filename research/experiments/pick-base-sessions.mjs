// 从真实会话里挑选「底座」：全程 Let me 的长会话
// 用途：把真实 wire 原样取出，然后只改锚点，测「已经陷入 Let me 的上下文能否被拉回 We」
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

function strip(t) { return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " "); }
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length + (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

const candidates = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";

  // 收集 assistant reasoning 块 + 用户消息
  const blocks = [];
  const userMsgs = [];
  for (const e of ev) {
    if (e.type === "user/message" && !e.data?.source?.kind) {
      const txt = (Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join("");
      if (txt.trim()) userMsgs.push(txt);
    }
    if (e.type === "assistant/message") {
      const c = e.data?.message?.content ?? e.data?.content;
      if (!Array.isArray(c)) continue;
      const r = c.filter(x => x.type === "reasoning").map(x => x.text ?? "").join("\n");
      const txt = c.filter(x => x.type === "text").map(x => x.text ?? "").join("\n");
      if (r.trim().length >= 50) blocks.push({ reasoning: r, content: txt, ...colInd(r) });
    }
  }
  if (blocks.length < 8) continue;
  const withCnt = blocks.filter(b => b.col + b.ind > 0);
  if (!withCnt.length) continue;
  const meanRatio = withCnt.reduce((a, b) => a + b.col / (b.col + b.ind), 0) / withCnt.length;
  const letMeRate = withCnt.filter(b => b.ind > b.col).length / withCnt.length;

  candidates.push({
    sid, blocks: blocks.length, userMsgs: userMsgs.length,
    meanRatio, letMeRate,
    totalInd: blocks.reduce((a, b) => a + b.ind, 0),
    totalCol: blocks.reduce((a, b) => a + b.col, 0),
  });
}

candidates.sort((a, b) => a.meanRatio - b.meanRatio);

console.log("=== 全程 Let me 的候选会话（按 We 占比升序）===");
console.log("会话                          块数  用户消息  We占比   LetMe率  总individual");
for (const c of candidates.slice(0, 15)) {
  console.log(`${c.sid.slice(0, 28).padEnd(30)} ${String(c.blocks).padStart(4)} ${String(c.userMsgs).padStart(8)} ${c.meanRatio.toFixed(3).padStart(7)} ${(c.letMeRate * 100).toFixed(0).padStart(7)}% ${String(c.totalInd).padStart(12)}`);
}

fs.writeFileSync("./capbench/results/base-sessions.json", JSON.stringify(candidates.filter(c => c.meanRatio < 0.2).slice(0, 20), null, 1));
console.log(`\n已保存 ${Math.min(20, candidates.filter(c => c.meanRatio < 0.2).length)} 个低 We 会话作为底座候选`);

// 决定性检验：「We → Let me」是「衰减/失控」还是「阶段推进」？
// 两者预测完全相反：
//   衰减说：We 占比随时间单调下降，且下降后质量变差
//   阶段说：会话先规划(We)后执行(Let me)，这是正常流程，不是失败
//
// 判别指标：
//   (a) 以 We 开头的会话，后续是否转向 I（阶段推进）
//   (b) 转向后是否出现更多工具调用（执行标志）—— 若是，则转向是功能性的
//   (c) We 块的内容是否更像「提问/审视」，I 块更像「动手/结论」
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
function label(t) {
  const { col, ind } = counts(t);
  const tot = col + ind;
  if (tot === 0) return "NONE";
  const r = col / tot;
  return r >= 0.85 ? "WE" : r <= 0.15 ? "I" : "MIXED";
}

// 提取完整会话：块序列 + 每块之后是否有工具调用
const sessions = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  const blocks = [];
  let pendingTools = 0;
  let cursor = null;
  for (const e of ev) {
    if (e.type === "tool/result" || e.type === "tool/call" || e.type === "tool_use") {
      if (cursor !== null) cursor.toolsAfter++;
    }
    if (e.type === "assistant/message") {
      const c = e.data?.message?.content ?? e.data?.content;
      if (!Array.isArray(c)) continue;
      const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
      const hasToolCall = c.some((x) => x.type === "tool_use" || x.type === "tool-call");
      if (r.trim().length < 50) continue;
      cursor = { label: label(r), len: r.length, toolsAfter: 0, hasToolCall, text: r };
      blocks.push(cursor);
    }
  }
  if (blocks.length >= 2) sessions.push({ sid, blocks });
}
console.log(`会话数（>=2块）: ${sessions.length}`);

// ── (a) 以 We 开头的会话，后续走向 ─────────────────────────────
console.log("\n=== (a) 以 WE 开头的会话，后续块序列 ===");
const weStart = sessions.filter((s) => s.blocks[0].label === "WE");
console.log(`  以 WE 开头的会话: ${weStart.length}`);
const patterns = {};
for (const s of weStart) {
  const seq = s.blocks.slice(0, 8).map((b) => b.label[0]).join("");
  patterns[seq] = (patterns[seq] ?? 0) + 1;
}
const topPatterns = Object.entries(patterns).sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [p, n] of topPatterns) console.log(`    ${p.padEnd(12)} × ${n}`);
// 首块 WE 之后，第 2 块是什么
const second = weStart.filter((s) => s.blocks[1]).map((s) => s.blocks[1].label);
const secondCounts = second.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
console.log(`  第2块分布: ${JSON.stringify(secondCounts)}`);
const transToI = (secondCounts.I ?? 0) / second.length;
console.log(`  WE 开头后第2块转 I 的比例: ${(100 * transToI).toFixed(1)}%`);

// ── (b) 转向执行后，工具调用是否增加 ───────────────────────────
console.log("\n=== (b) WE 块 vs I 块 之后紧跟工具调用的比例 ===");
const allBlocks = sessions.flatMap((s) => s.blocks);
for (const lab of ["WE", "I"]) {
  const sub = allBlocks.filter((b) => b.label === lab);
  const withTool = sub.filter((b) => b.toolsAfter > 0).length;
  const avgTools = sub.reduce((a, b) => a + b.toolsAfter, 0) / (sub.length || 1);
  console.log(`  ${lab.padEnd(3)} n=${String(sub.length).padStart(5)}  其后有工具调用=${((100 * withTool) / sub.length).toFixed(1)}%  平均工具数=${avgTools.toFixed(2)}`);
}

// ── (c) 内容特征：We 更像提问/审视，I 更像动手/结论 ─────────────
console.log("\n=== (c) 内容特征（We 是规划态还是执行态？）===");
const feat = (list) => {
  const n = list.length;
  const p = (f) => ((100 * list.filter(f).length) / n).toFixed(1) + "%";
  return {
    n,
    问号: p((b) => /\?/.test(b.text)),
    代码块: p((b) => /```/.test(b.text)),
    工具动词: p((b) => /\b(run|call|invoke|execute|write|edit|read|check|verify|inspect)\b/i.test(b.text)),
    第一人称动作: p((b) => /\b(let me|I'll|I will|I'm going to)\b/i.test(b.text)),
    规划词: p((b) => /\b(plan|first|then|next|should|need to|approach|strategy)\b/i.test(b.text)),
    结论词: p((b) => /\b(done|complete|result|answer|output|final)\b/i.test(b.text)),
  };
};
const fWE = feat(allBlocks.filter((b) => b.label === "WE"));
const fI = feat(allBlocks.filter((b) => b.label === "I"));
console.log("  特征            WE        I");
for (const k of ["问号", "代码块", "工具动词", "第一人称动作", "规划词", "结论词"]) {
  console.log(`  ${k.padEnd(14)} ${fWE[k].padStart(8)}  ${fI[k].padStart(8)}`);
}
console.log(`  (WE n=${fWE.n}, I n=${fI.n})`);

// ── (d) 按轮次看：同一会话内跨「用户轮」的语域走向 ──────────────
console.log("\n=== (d) 会话内跨用户轮的语域（用户每问一次算一轮）===");
const multiTurn = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  let turn = -1;
  const turns = {};
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind !== "runtime-context") turn++;
    if (e.type !== "assistant/message" || turn < 0) continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    if (r.trim().length < 50) continue;
    (turns[turn] ??= []).push(label(r));
  }
  const ks = Object.keys(turns).map(Number).sort((a, b) => a - b);
  if (ks.length >= 3) multiTurn.push(ks.map((t) => turns[t]));
}
console.log(`  多轮会话数(>=3轮): ${multiTurn.length}`);
for (let t = 0; t < 5; t++) {
  const vals = multiTurn.filter((s) => s[t]).map((s) => s[t]);
  const all = vals.flat();
  if (!all.length) continue;
  const we = all.filter((x) => x === "WE").length;
  console.log(`  第${t + 1}轮: n=${String(all.length).padStart(4)}  We占比=${((100 * we) / all.length).toFixed(1)}%`);
}

// 三合一审计（只做风插锚点会话）：
//  A. we/let me 分布是否已合理
//  B. 是否开头英文（reasoning + content 分开看）
//  C. 给出预设改动的数据依据
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

const cjkN = (s) => (String(s).match(/[\u4e00-\u9fff]/g) ?? []).length;
const latN = (s) => (String(s).match(/[A-Za-z]/g) ?? []).length;

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
// 语言判定
function langHead(s, n = 40) {
  const t = String(s ?? "").trim().slice(0, n);
  const c = cjkN(t), l = latN(t);
  if (c + l === 0) return "OTHER";
  const r = c / (c + l);
  if (r > 0.5) return "ZH";
  if (r < 0.1) return "EN";
  return "MIX";
}
function langBody(s) {
  const c = cjkN(s), l = latN(s);
  if (c + l === 0) return "OTHER";
  const r = c / (c + l);
  return r > 0.5 ? "ZH" : r < 0.1 ? "EN" : "MIX";
}

// 只收集锚点会话
const ANCHOR_RE = /open (every|our) reasoning (block|with)|We always open our reasoning/;
const sessions = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  let anchored = false;
  let anchorText = null;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data?.content) ? e.data.content : []).map((x) => x.text ?? "").join("");
      if (ANCHOR_RE.test(txt)) {
        anchored = true;
        const m = txt.match(/We (open every|always open our)[\s\S]{0,400}/);
        if (m && !anchorText) anchorText = m[0];
      }
    }
  }
  if (!anchored) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  const blocks = [];
  let turn = -1;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind !== "runtime-context") turn++;
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    const txt = c.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    if (r.trim().length >= 40) {
      blocks.push({
        kind: "reasoning", turn, len: r.length, label: label(r),
        head: langHead(r), body: langBody(r),
        firstWord: (r.trim().match(/^[A-Za-z\u4e00-\u9fff']+/) ?? [""])[0],
        text: r,
      });
    }
    if (txt.trim().length >= 80) {
      blocks.push({
        kind: "content", turn, len: txt.length, label: null,
        head: langHead(txt), body: langBody(txt),
        firstWord: (txt.trim().match(/^[A-Za-z\u4e00-\u9fff']+/) ?? [""])[0],
        text: txt,
      });
    }
  }
  sessions.push({ sid, blocks, anchorText });
}

console.log(`风插（锚点）会话: ${sessions.length}`);
const reas = sessions.flatMap((s) => s.blocks.filter((b) => b.kind === "reasoning"));
const cont = sessions.flatMap((s) => s.blocks.filter((b) => b.kind === "content"));
console.log(`  reasoning 块: ${reas.length}   content 块: ${cont.length}`);

// ══════════════════ A. we/let me 分布 ══════════════════
console.log("\n" + "=".repeat(60));
console.log("A. we / let me 分布是否合理");
console.log("=".repeat(60));
const lab = reas.reduce((a, b) => ((a[b.label] = (a[b.label] ?? 0) + 1), a), {});
for (const [k, v] of Object.entries(lab).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(6)} ${String(v).padStart(4)}  (${((100 * v) / reas.length).toFixed(1)}%)`);
}
const wePct = (100 * (lab.WE ?? 0)) / reas.length;
const iPct = (100 * (lab.I ?? 0)) / reas.length;
console.log(`  → We ${wePct.toFixed(1)}%  /  Let me ${iPct.toFixed(1)}%  /  混合 ${((100 * (lab.MIXED ?? 0)) / reas.length).toFixed(1)}%`);

// 首块是否 We 开头（锚点是否真的生效）
console.log("\n  锚点是否在首块生效：");
const firstBlocks = sessions.map((s) => s.blocks.find((b) => b.kind === "reasoning")).filter(Boolean);
let firstWe = 0, firstWeNeed = 0;
for (const b of firstBlocks) {
  if (b.label === "WE") firstWe++;
  if (/^\s*We\b/i.test(b.text.trim())) firstWeNeed++;
}
console.log(`    首块 WE 语域: ${firstWe}/${firstBlocks.length} = ${((100 * firstWe) / firstBlocks.length).toFixed(1)}%`);
console.log(`    首块以 "We" 开头: ${firstWeNeed}/${firstBlocks.length} = ${((100 * firstWeNeed) / firstBlocks.length).toFixed(1)}%`);

// 逐块位置
console.log("\n  按块在会话内的位置：");
const pos = { "第1": [], "第2-4": [], "第5-9": [], "第10+": [] };
for (const s of sessions) {
  let i = 0;
  for (const b of s.blocks) {
    if (b.kind !== "reasoning") continue;
    const k2 = i === 0 ? "第1" : i < 4 ? "第2-4" : i < 9 ? "第5-9" : "第10+";
    pos[k2].push(b.label);
    i++;
  }
}
for (const [k2, v] of Object.entries(pos)) {
  if (!v.length) continue;
  const we = v.filter((x) => x === "WE").length;
  const ii = v.filter((x) => x === "I").length;
  console.log(`    ${k2.padEnd(6)} n=${String(v.length).padStart(4)}  We=${((100 * we) / v.length).toFixed(1).padStart(5)}%  I=${((100 * ii) / v.length).toFixed(1).padStart(5)}%`);
}

// ══════════════════ B. 是否开头英文 ══════════════════
console.log("\n" + "=".repeat(60));
console.log("B. 是否开头英文");
console.log("=".repeat(60));
for (const [name, list] of [["reasoning", reas], ["content", cont]]) {
  const h = list.reduce((a, b) => ((a[b.head] = (a[b.head] ?? 0) + 1), a), {});
  const body = list.reduce((a, b) => ((a[b.body] = (a[b.body] ?? 0) + 1), a), {});
  console.log(`\n  [${name}] n=${list.length}`);
  console.log(`    开头语言: ${JSON.stringify(h)}`);
  console.log(`    主体语言: ${JSON.stringify(body)}`);
  const enHead = ((100 * (h.EN ?? 0)) / list.length).toFixed(1);
  console.log(`    → 开头英文: ${enHead}%`);
  const sw = list.filter((b) => b.head === "EN" && b.body === "ZH").length;
  console.log(`    → 开头英文但主体中文: ${sw} (${((100 * sw) / list.length).toFixed(1)}%)`);
}

// 开头英文的首词统计
console.log("\n  reasoning 开头前 3 词高频：");
const op = {};
for (const b of reas) {
  const w = b.text.trim().slice(0, 40).replace(/\n/g, " ").split(/\s+/).slice(0, 3).join(" ").toLowerCase();
  op[w] = (op[w] ?? 0) + 1;
}
for (const [k2, v] of Object.entries(op).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${String(v).padStart(4)} × "${k2}"`);
}

// 中文用户的会话里，content 开头英文的比例
console.log("\n  content 开头英文的样本（前 5 条）：");
for (const b of cont.filter((x) => x.head === "EN").slice(0, 5)) {
  console.log(`    · ${b.text.slice(0, 110).replace(/\n/g, " ⏎ ")}`);
}

// 锚点文本是否含语言指令
console.log("\n" + "=".repeat(60));
console.log("C. 锚点原文是否含语言相关指令");
console.log("=".repeat(60));
const anchors = [...new Set(sessions.map((s) => s.anchorText).filter(Boolean))];
for (const a of anchors) {
  console.log(`  ── ${a.slice(0, 300).replace(/\n/g, " ")}`);
  console.log(`     含中文约束: ${/中文|Chinese|用中文/.test(a)}`);
  console.log(`     含语言约束: ${/language|中文|English/i.test(a)}`);
}

fs.writeFileSync("./capbench/results/audit-fengcha.json", JSON.stringify({
  sessions: sessions.length, reasoning: reas.length, content: cont.length,
  labels: lab, firstWeRate: firstWe / firstBlocks.length,
  reasonHeadLang: reas.reduce((a, b) => ((a[b.head] = (a[b.head] ?? 0) + 1), a), {}),
  contentHeadLang: cont.reduce((a, b) => ((a[b.head] = (a[b.head] ?? 0) + 1), a), {}),
  pos: Object.fromEntries(Object.entries(pos).map(([k2, v]) => [k2, { n: v.length, we: v.filter(x => x === "WE").length }])),
}, null, 1));

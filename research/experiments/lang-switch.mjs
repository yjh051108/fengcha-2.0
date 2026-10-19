// 语言切换诊断：为什么汇报会先说英文再说中文？
// 候选机制：
//  H1 锚点开场（英文 "We need"）把开头锁成英文，之后切回中文
//  H2 汇报模板本身（"We need to..." + 状态词）是英文惯用式
//  H3 工具结果英文 → 上下文被英文污染
//  H4 与锚点无关，模型对「汇报」这个动作默认英文起手
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

const CJK = /[\u4e00-\u9fff]/;
const cjkCount = (s) => (String(s).match(/[\u4e00-\u9fff]/g) ?? []).length;
const asciiLetters = (s) => (String(s).match(/[A-Za-z]/g) ?? []).length;

// 判定「开头是英文」：前 30 个非空白字符里 CJK 占比 < 10%
function headLang(t) {
  const s = String(t ?? "").trim().slice(0, 60);
  if (!s) return "EMPTY";
  const cjk = cjkCount(s);
  const letters = asciiLetters(s);
  if (cjk === 0 && letters === 0) return "OTHER";
  if (cjk === 0) return "EN";
  if (letters === 0) return "ZH";
  return cjk / (cjk + letters) < 0.1 ? "EN" : cjk / (cjk + letters) > 0.5 ? "ZH" : "MIXED";
}
// 判定整段主体语言
function bodyLang(t) {
  const s = String(t ?? "");
  const cjk = cjkCount(s);
  const letters = asciiLetters(s);
  if (cjk + letters === 0) return "OTHER";
  const r = cjk / (cjk + letters);
  if (r > 0.5) return "ZH";
  if (r < 0.1) return "EN";
  return "MIXED";
}
// 开头英文、后面中文 = 切换
function isSwitch(t) {
  return headLang(t) === "EN" && bodyLang(t) === "ZH";
}

// 收集：reasoning 块 与 content 块（用户看到的汇报）
const reasoning = [];
const contents = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  // 该会话是否带锚点
  let anchored = false;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data?.content) ? e.data.content : [])
        .map((x) => x.text ?? "").join("");
      if (/open (every|our) reasoning (block|with)/.test(txt)) anchored = true;
    }
  }
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    const txt = c.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    if (r.trim().length >= 40) {
      reasoning.push({ sid, anchored, len: r.length, head: headLang(r), body: bodyLang(r), switch: isSwitch(r), text: r });
    }
    if (txt.trim().length >= 30) {
      contents.push({ sid, anchored, len: txt.length, head: headLang(txt), body: bodyLang(txt), switch: isSwitch(txt), text: txt });
    }
  }
}

console.log(`reasoning 块: ${reasoning.length}   content 块: ${contents.length}`);
console.log(`带锚点会话的 reasoning: ${reasoning.filter(r => r.anchored).length}`);
console.log(`带锚点会话的 content:   ${contents.filter(r => r.anchored).length}`);

// ── 1. 开头语言 vs 主体语言 的交叉表 ────────────────────────────
console.log("\n=== 1. reasoning：开头语言 × 主体语言 ===");
const cross = {};
for (const r of reasoning) {
  const k = `${r.head}→${r.body}`;
  cross[k] = (cross[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(cross).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}  (${((100 * v) / reasoning.length).toFixed(1)}%)`);
}
const switchRate = reasoning.filter((r) => r.switch).length / reasoning.length;
console.log(`  英文起头→中文主体（切换）: ${(100 * switchRate).toFixed(2)}%`);

console.log("\n=== 2. content（用户可见汇报）：开头语言 × 主体语言 ===");
const crossC = {};
for (const r of contents) {
  const k = `${r.head}→${r.body}`;
  crossC[k] = (crossC[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(crossC).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(5)}  (${((100 * v) / contents.length).toFixed(1)}%)`);
}
const switchRateC = contents.filter((r) => r.switch).length / contents.length;
console.log(`  英文起头→中文主体（切换）: ${(100 * switchRateC).toFixed(2)}%`);

// ── 3. 锚点 vs 非锚点 的切换率 ──────────────────────────────────
console.log("\n=== 3. 锚点是否导致切换 ===");
for (const [name, list] of [["reasoning", reasoning], ["content", contents]]) {
  for (const anch of [true, false]) {
    const sub = list.filter((r) => r.anchored === anch);
    if (!sub.length) continue;
    const sw = sub.filter((r) => r.switch).length;
    const enHead = sub.filter((r) => r.head === "EN").length;
    console.log(`  ${name.padEnd(10)} anchored=${String(anch).padEnd(5)} n=${String(sub.length).padStart(5)}  英文起头=${((100 * enHead) / sub.length).toFixed(1).padStart(5)}%  切换=${((100 * sw) / sub.length).toFixed(1).padStart(5)}%`);
  }
}

// ── 4. 切换块的样本：看它们开头到底怎么写的 ────────────────────
console.log("\n=== 4. 切换块样本（前 6 条，各取前 160 字符）===");
for (const r of reasoning.filter((x) => x.switch).slice(0, 6)) {
  console.log(`  ── [${r.sid.slice(0, 18)}] ${r.text.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
}

// ── 5. 开头是英文但很短就切：切点在哪 ──────────────────────────
console.log("\n=== 5. 切换的切点（英文前缀长度）===");
const cutPoints = [];
for (const r of reasoning.filter((x) => x.switch)) {
  const t = r.text;
  const idx = t.search(/[\u4e00-\u9fff]/);
  if (idx > 0) cutPoints.push(idx);
}
if (cutPoints.length) {
  cutPoints.sort((a, b) => a - b);
  const med = cutPoints[Math.floor(cutPoints.length / 2)];
  console.log(`  n=${cutPoints.length}  中位切点=${med} 字符  p25=${cutPoints[Math.floor(cutPoints.length * 0.25)]}  p75=${cutPoints[Math.floor(cutPoints.length * 0.75)]}`);
  console.log(`  切点分布（<20 / 20-60 / 60-200 / >200）:`,
    [cutPoints.filter(x => x < 20).length, cutPoints.filter(x => x >= 20 && x < 60).length,
     cutPoints.filter(x => x >= 60 && x < 200).length, cutPoints.filter(x => x >= 200).length].join(" / "));
}

// ── 6. 切换块的开头动词：是不是 "We need to ..." 式 ─────────────
console.log("\n=== 6. 切换块的开头前 8 个词（统计高频起手）===");
const openers = {};
for (const r of reasoning.filter((x) => x.switch)) {
  const head = r.text.trim().slice(0, 60).replace(/\n/g, " ");
  const w = head.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
  openers[w] = (openers[w] ?? 0) + 1;
}
for (const [k, v] of Object.entries(openers).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(v).padStart(4)} × "${k}"`);
}

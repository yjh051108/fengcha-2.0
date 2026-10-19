// 精确归因：content 开头英文，是不是锚点文本直接造成的？
// 假设：锚点强制用 "We need" / "Let me" 开头，而这些短语是英文，
//      于是中文汇报的开头被强行拉成英文，之后才切回中文
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));
const ANCHOR_RE = /open (every|our) reasoning (block|with)|We always open our reasoning/;

const cjkN = (s) => (String(s).match(/[\u4e00-\u9fff]/g) ?? []).length;
const latN = (s) => (String(s).match(/[A-Za-z]/g) ?? []).length;
function langHead(s, n = 40) {
  const t = String(s ?? "").trim().slice(0, n);
  const c = cjkN(t), l = latN(t);
  if (c + l === 0) return "OTHER";
  const r = c / (c + l);
  return r > 0.5 ? "ZH" : r < 0.1 ? "EN" : "MIX";
}
function langBody(s) {
  const c = cjkN(s), l = latN(s);
  if (c + l === 0) return "OTHER";
  return c / (c + l) > 0.5 ? "ZH" : "EN";
}

// 收集 content，区分锚点/非锚点
const cont = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  let anchored = false;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data?.content) ? e.data.content : []).map((x) => x.text ?? "").join("");
      if (ANCHOR_RE.test(txt)) anchored = true;
    }
  }
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const txt = c.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    if (txt.trim().length < 80) continue;
    cont.push({ sid, anchored, text: txt, head: langHead(txt), body: langBody(txt) });
  }
}

const anchored = cont.filter((c) => c.anchored);
console.log(`content 总数: ${cont.length}  其中锚点会话: ${anchored.length}`);

// ── 1. 开头英文的成因分类 ─────────────────────────────────────
// 把开头 60 字符按「是不是锚点短语」分类
function openerClass(t) {
  const h = String(t ?? "").trim().slice(0, 80).toLowerCase();
  if (/^(we need|we should|we have|we now|we can|we'll|we will)\b/.test(h)) return "We-短语";
  if (/^(let me|let's|now let me|now i)\b/.test(h)) return "Let me-短语";
  if (/^(the|this|that|it|there|here|a|an)\b/.test(h) && /^[a-z]/.test(h)) return "英文散文";
  if (/^[\u4e00-\u9fff]/.test(h)) return "中文";
  if (/^[#*\-|`>]/.test(h)) return "标记开头";
  return "其他";
}

console.log("\n=== 1. content 开头分类（锚点组 vs 非锚点组）===");
for (const [name, list] of [["锚点", anchored], ["非锚点", cont.filter((c) => !c.anchored)]]) {
  if (!list.length) continue;
  const cls = {};
  for (const c of list) cls[openerClass(c.text)] = (cls[openerClass(c.text)] ?? 0) + 1;
  console.log(`\n  [${name}] n=${list.length}`);
  for (const [k2, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k2.padEnd(12)} ${String(v).padStart(4)}  ${((100 * v) / list.length).toFixed(1)}%`);
  }
}

// ── 2. 锚点短语开头 → 后面是否转中文 ───────────────────────────
console.log("\n=== 2. 以锚点短语开头的内容，其后语言走向 ===");
const anchorPhraseOpened = anchored.filter((c) => {
  const cls = openerClass(c.text);
  return cls === "We-短语" || cls === "Let me-短语";
});
console.log(`  锚点会话里以 We/Let me 短语开头的 content: ${anchorPhraseOpened.length} / ${anchored.length}`);
// 计算：去掉开头第一句后，剩下的语言
for (const c of anchorPhraseOpened) {
  const t = c.text.trim();
  const m = t.match(/^[\s\S]{0,200}?[.!?]\s/);
  if (!m) continue;
}
let afterZh = 0, afterEn = 0, afterMix = 0;
for (const c of anchorPhraseOpened) {
  const t = c.text.trim();
  const idx = t.search(/[.!?]\s/);
  if (idx < 0 || idx > 300) continue;
  const rest = t.slice(idx + 1);
  if (rest.length < 40) continue;
  const l = langBody(rest);
  if (l === "ZH") afterZh++;
  else if (l === "EN") afterEn++;
  else afterMix++;
}
console.log(`  首句之后: 中文 ${afterZh} / 英文 ${afterEn} / 混合 ${afterMix}`);
console.log(`  → 首句英文但后文转中文: ${((100 * afterZh) / (afterZh + afterEn + afterMix || 1)).toFixed(1)}%`);

// ── 3. 对比：如果开头是中文，后面会不会变英文 ───────────────────
console.log("\n=== 3. 中文开头的 content，后面会不会变英文 ===");
const zhOpened = anchored.filter((c) => openerClass(c.text) === "中文");
let zhStay = 0, zhToEn = 0;
for (const c of zhOpened) {
  const t = c.text.trim();
  const idx = t.search(/[.!?]\s/);
  const rest = idx > 0 && idx < 400 ? t.slice(idx + 1) : t;
  if (rest.length < 40) continue;
  if (langBody(rest) === "EN") zhToEn++;
  else zhStay++;
}
console.log(`  中文开头 n=${zhOpened.length}  之后保持中文/混合=${zhStay}  之后转英文=${zhToEn}`);

// ── 4. 关键：锚点会话 vs 非锚点，中文汇报占比 ────────────────────
console.log("\n=== 4. 锚点组 vs 非锚点组：中文汇报占比 ===");
for (const [name, list] of [["锚点", anchored], ["非锚点", cont.filter((c) => !c.anchored)]]) {
  if (!list.length) continue;
  const zh = list.filter((c) => c.body === "ZH").length;
  const en = list.filter((c) => c.body === "EN").length;
  console.log(`  ${name.padEnd(4)} n=${String(list.length).padStart(4)}  中文主体=${((100 * zh) / list.length).toFixed(1)}%  英文主体=${((100 * en) / list.length).toFixed(1)}%`);
}

// ── 5. 实例：锚点短语开头的英文汇报 ───────────────────────────
console.log("\n=== 5. 实例：锚点会话中以英文短语开头的汇报（前 6 条）===");
for (const c of anchorPhraseOpened.slice(0, 6)) {
  console.log(`\n  [${c.sid.slice(0, 20)}] ${c.text.slice(0, 180).replace(/\n/g, " ⏎ ")}`);
}

// ── 6. reasoning 全英文这件事，是否影响 content ────────────────
console.log("\n=== 6. reasoning 是否全程英文（锚点组）===");
const reasLangs = { EN: 0, ZH: 0, MIX: 0, OTHER: 0 };
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  let anchored = false;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data?.content) ? e.data.content : []).map((x) => x.text ?? "").join("");
      if (ANCHOR_RE.test(txt)) anchored = true;
    }
  }
  if (!anchored) continue;
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const r = c.filter((x) => x.type === "reasoning").map((x) => x.text ?? "").join("\n");
    if (r.trim().length < 40) continue;
    reasLangs[langBody(r)] = (reasLangs[langBody(r)] ?? 0) + 1;
  }
}
console.log(`  reasoning 主体语言: ${JSON.stringify(reasLangs)}`);
console.log(`  → reasoning 几乎全英文，这本身不是问题（思考用英文是正常的）`);
console.log(`  → 问题是 content（用户看到的）60.5% 英文开头`);

// 定位真因：切到英文的段落里到底有什么？
// 假设：英文切换由「内容里有标识符/代码/数值」触发，而不是语言习惯
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

const cjkN = (s) => (String(s).match(/[\u4e00-\u9fff]/g) ?? []).length;
const latN = (s) => (String(s).match(/[A-Za-z]/g) ?? []).length;
function segLang(s) {
  const c = cjkN(s), l = latN(s);
  if (c + l < 6) return null;
  const r = c / (c + l);
  return r > 0.5 ? "ZH" : r < 0.1 ? "EN" : "MIX";
}
function segment(text) {
  return String(text ?? "")
    .split(/\n{2,}|\n(?=\s*(?:[-*+]|\d+[.)]|#{1,6})\s)|\n/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12);
}

// 收集长 content 块
const blocks = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const txt = c.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    if (txt.trim().length < 200) continue;
    blocks.push({ sid, text: txt });
  }
}
console.log(`长 content 块: ${blocks.length}`);

// ── 特征：对一个段落，判断它含什么 ─────────────────────────────
function features(s) {
  return {
    代码块: /```/.test(s),
    行内代码: /`[^`]+`/.test(s),
    标识符: /\b[a-z]+[A-Z]\w*|\b[a-z]+_[a-z_]+\b|\b[A-Z_]{3,}\b/.test(s),  // camelCase / snake_case / CONST
    路径: /[A-Za-z]:[\\/]|\/[\w.-]+\/|\b[\w-]+\.(mjs|js|ts|json|yml|yaml|py|md)\b/.test(s),
    数值算式: /\d+\s*[+\-*/=]\s*\d+|\b\d+\.\d+\b|=\s*\d+/.test(s),
    英文句子: /^[A-Z][a-z]+\s+[a-z]+\s+[a-z]+/m.test(s),
    中文标点: /[，。、：；！？「」【】]/.test(s),
    英文标点密集: (s.match(/[,.;:()]/g) ?? []).length > s.length * 0.03,
  };
}

// 对每个块，分段后按语言归类，统计各类段的特征分布
const byLang = { ZH: [], EN: [], MIX: [] };
for (const b of blocks) {
  for (const seg of segment(b.text)) {
    const l = segLang(seg);
    if (!l) continue;
    byLang[l].push({ seg, f: features(seg) });
  }
}
console.log(`\n=== 各语言段的特征占比 ===`);
const feats = ["代码块", "行内代码", "标识符", "路径", "数值算式", "英文句子", "中文标点", "英文标点密集"];
console.log(`特征            ZH(n=${byLang.ZH.length})    EN(n=${byLang.EN.length})   MIX(n=${byLang.MIX.length})`);
for (const f of feats) {
  const p = (list) => ((100 * list.filter((x) => x.f[f]).length) / list.length).toFixed(1).padStart(6) + "%";
  console.log(`  ${f.padEnd(14)} ${p(byLang.ZH)}    ${p(byLang.EN)}    ${p(byLang.MIX)}`);
}

// ── 关键：把代码特征排除后，还剩多少纯英文散文段 ────────────────
console.log("\n=== 纯英文散文段（不含代码/标识符/路径/算式）===");
const pureEn = byLang.EN.filter((x) => !x.f.代码块 && !x.f.行内代码 && !x.f.标识符 && !x.f.路径 && !x.f.数值算式);
console.log(`  EN 段总数: ${byLang.EN.length}`);
console.log(`  纯英文散文: ${pureEn.length} (${((100 * pureEn.length) / byLang.EN.length).toFixed(1)}%)`);
console.log(`  含技术内容: ${byLang.EN.length - pureEn.length} (${((100 * (byLang.EN.length - pureEn.length)) / byLang.EN.length).toFixed(1)}%)`);
console.log(`\n  纯英文散文样本（前 8 条）:`);
for (const x of pureEn.slice(0, 8)) console.log(`    · ${x.seg.slice(0, 100).replace(/\n/g, " ")}`);

// ── 另一个角度：看英文段是否在「状态汇报」这类固定动作里 ────────
console.log("\n=== 英文段的实际内容抽样（前 10 条，每类）===");
console.log("  [含技术内容]");
for (const x of byLang.EN.filter((x) => x.f.标识符 || x.f.代码块 || x.f.行内代码 || x.f.路径).slice(0, 6)) {
  console.log(`    · ${x.seg.slice(0, 120).replace(/\n/g, " ")}`);
}
console.log("  [纯散文]");
for (const x of pureEn.slice(0, 6)) {
  console.log(`    · ${x.seg.slice(0, 120).replace(/\n/g, " ")}`);
}

// ── 会议：中文块里出现英文段时，前后段是什么语言 ────────────────
console.log("\n=== 英文段的前后邻居语言（检验是否「夹在中文里」）===");
const neighbors = { "ZH_EN_ZH": 0, "ZH_EN_other": 0, "other": 0 };
for (const b of blocks) {
  const segs = segment(b.text).map((s) => ({ s, l: segLang(s) })).filter((x) => x.l);
  for (let i = 1; i < segs.length - 1; i++) {
    if (segs[i].l !== "EN") continue;
    if (segs[i - 1].l === "ZH" && segs[i + 1].l === "ZH") neighbors["ZH_EN_ZH"]++;
    else if (segs[i - 1].l === "ZH" || segs[i + 1].l === "ZH") neighbors["ZH_EN_other"]++;
    else neighbors["other"]++;
  }
}
console.log(`  ${JSON.stringify(neighbors)}`);
const tot = neighbors.ZH_EN_ZH + neighbors.ZH_EN_other + neighbors.other;
console.log(`  英文段夹在中文之间: ${((100 * neighbors.ZH_EN_ZH) / tot).toFixed(1)}%`);

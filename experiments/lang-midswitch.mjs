// 重测：段内语言来回切（中→英→中），而不是「开头英文」
// 你的描述更像：汇报开始时中文，中途整段变英文，之后又回中文
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

const CJK = /[\u4e00-\u9fff]/g;
const LAT = /[A-Za-z]/g;
const cjkN = (s) => (String(s).match(CJK) ?? []).length;
const latN = (s) => (String(s).match(LAT) ?? []).length;

// 片段语言：中文占比 > 0.5 = ZH；< 0.1 = EN；否则 MIX
function segLang(s) {
  const c = cjkN(s), l = latN(s);
  if (c + l < 6) return null; // 太短不计
  const r = c / (c + l);
  if (r > 0.5) return "ZH";
  if (r < 0.1) return "EN";
  return "MIX";
}

// 把文本切成段：按空行、标题、列表项、句号
function segment(text) {
  const t = String(text ?? "");
  const parts = t
    .split(/\n{2,}|\n(?=\s*(?:[-*+]|\d+[.)]|#{1,6})\s)|\n/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 12);
  return parts;
}

// 压缩连续同类，得到语言序列
function langSequence(text) {
  const segs = segment(text);
  const seq = [];
  for (const s of segs) {
    const l = segLang(s);
    if (!l || l === "MIX") continue;
    if (!seq.length || seq[seq.length - 1] !== l) seq.push(l);
  }
  return seq;
}

// 收集 content（用户看到的汇报）
const contents = [];
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  let anchored = false;
  const lastTime = ev[ev.length - 1]?.time ?? 0;
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data?.content) ? e.data.content : []).map((x) => x.text ?? "").join("");
      if (/open (every|our) reasoning (block|with)|We always open our reasoning/.test(txt)) anchored = true;
    }
  }
  for (const e of ev) {
    if (e.type !== "assistant/message") continue;
    const c = e.data?.message?.content ?? e.data?.content;
    if (!Array.isArray(c)) continue;
    const txt = c.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    if (txt.trim().length < 200) continue;
    const seq = langSequence(txt);
    contents.push({ sid, anchored, t: e.time ?? 0, lastTime, len: txt.length, seq, text: txt });
  }
}

contents.sort((a, b) => a.t - b.t);
console.log(`长 content 块（>=200 字符）: ${contents.length}`);
console.log(`时间范围: ${new Date(contents[0]?.t ?? 0).toISOString().slice(0, 10)} ~ ${new Date(contents[contents.length - 1]?.t ?? 0).toISOString().slice(0, 10)}`);

// ── 1. 语言序列分布 ───────────────────────────────────────────
console.log("\n=== 1. 语言序列分布（压缩后）===");
const seqCount = {};
for (const c of contents) {
  const s = c.seq.join("→") || "(none)";
  seqCount[s] = (seqCount[s] ?? 0) + 1;
}
const sorted = Object.entries(seqCount).sort((a, b) => b[1] - a[1]);
for (const [s, n] of sorted.slice(0, 15)) {
  console.log(`  ${s.padEnd(20)} ${String(n).padStart(5)}  (${((100 * n) / contents.length).toFixed(1)}%)`);
}

// ── 2. 含 ZH→EN→ZH 的块（你描述的模式）──────────────────────
console.log("\n=== 2. ZH→EN→ZH 模式（中→英→中）===");
const zhezh = contents.filter((c) => c.seq.join(",").includes("ZH,EN,ZH"));
const anySwitch = contents.filter((c) => c.seq.length >= 2);
console.log(`  含来回切的块: ${zhezh.length} / ${contents.length} = ${((100 * zhezh.length) / contents.length).toFixed(2)}%`);
console.log(`  任何切换（seq 长度>=2）: ${anySwitch.length} / ${contents.length} = ${((100 * anySwitch.length) / contents.length).toFixed(1)}%`);

// ── 3. 按时间：最近的会话是否更严重 ─────────────────────────
console.log("\n=== 3. 按会话时间分组（看是否近期变差）===");
const byMonth = {};
for (const c of contents) {
  const d = new Date(c.t);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  (byMonth[key] ??= []).push(c);
}
for (const [k, v] of Object.entries(byMonth).sort()) {
  const sw = v.filter((c) => c.seq.length >= 2).length;
  const z = v.filter((c) => c.seq.join(",").includes("ZH,EN,ZH")).length;
  console.log(`  ${k} n=${String(v.length).padStart(4)}  有任何切换=${((100 * sw) / v.length).toFixed(1).padStart(5)}%  中英中=${((100 * z) / v.length).toFixed(1).padStart(5)}%`);
}

// ── 4. 锚点 vs 非锚点 ────────────────────────────────────────
console.log("\n=== 4. 锚点影响 ===");
for (const anch of [true, false]) {
  const sub = contents.filter((c) => c.anchored === anch);
  if (!sub.length) continue;
  const sw = sub.filter((c) => c.seq.length >= 2).length;
  const z = sub.filter((c) => c.seq.join(",").includes("ZH,EN,ZH")).length;
  console.log(`  anchored=${String(anch).padEnd(5)} n=${String(sub.length).padStart(4)}  切换率=${((100 * sw) / sub.length).toFixed(1)}%  中英中=${((100 * z) / sub.length).toFixed(1)}%`);
}

// ── 5. 实例：把切换的段落摘出来看 ───────────────────────────
console.log("\n=== 5. 实例：ZH→EN→ZH 的实际内容（前 3 例）===");
for (const c of zhezh.slice(0, 3)) {
  console.log(`\n  ── [${c.sid.slice(0, 20)}] seq=${c.seq.join("→")} len=${c.len}`);
  const segs = segment(c.text);
  let shown = 0;
  for (const s of segs) {
    const l = segLang(s);
    if (!l) continue;
    if (shown++ >= 6) break;
    console.log(`     [${l}] ${s.slice(0, 110).replace(/\n/g, " ")}`);
  }
}

// ── 6. 英文段落在切换块里的位置 ──────────────────────────────
console.log("\n=== 6. 切换块中英文段的位置分布 ===");
const posBins = { 开头: 0, 中段: 0, 结尾: 0 };
for (const c of zhezh) {
  const segs = segment(c.text).map(s => ({ s, l: segLang(s) })).filter(x => x.l);
  if (segs.length < 3) continue;
  const enIdx = segs.map((x, i) => (x.l === "EN" ? i : -1)).filter(i => i >= 0);
  for (const i of enIdx) {
    const r = i / segs.length;
    if (r < 0.34) posBins.开头++;
    else if (r < 0.67) posBins.中段++;
    else posBins.结尾++;
  }
}
console.log(`  ${JSON.stringify(posBins)}`);

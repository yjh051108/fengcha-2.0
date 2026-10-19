// 生成发布用图表（纯 SVG，无依赖）
import fs from "node:fs";
import path from "node:path";

const OUT = "../docs/charts";
fs.mkdirSync(OUT, { recursive: true });

const W = 720;
let uid = 0;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 横向条形图 */
function barChart({ title, subtitle, rows, max, unit = "", note = "", color = "#2f6fed" }) {
  const uid0 = ++uid;
  const rowH = 34;
  const padTop = 78;
  const padBottom = note ? 56 : 34;
  const H = padTop + rows.length * rowH + padBottom;
  const labelW = 190;
  const barMax = W - labelW - 90;
  const m = max ?? Math.max(...rows.map((r) => r.value)) * 1.08;

  const bars = rows
    .map((r, i) => {
      const y = padTop + i * rowH;
      const w = Math.max(2, (r.value / m) * barMax);
      const c = r.color ?? color;
      const valText = `${r.value}${unit}`;
      return `
    <text x="${labelW - 10}" y="${y + 17}" text-anchor="end" font-size="13" fill="#222">${esc(r.label)}</text>
    <rect x="${labelW}" y="${y + 5}" width="${w}" height="22" rx="3" fill="${c}" opacity="${r.dim ? 0.45 : 0.9}"/>
    <text x="${labelW + w + 8}" y="${y + 20}" font-size="13" fill="#333" font-weight="600">${esc(valText)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t${uid0}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text id="t${uid0}" x="20" y="32" font-size="17" font-weight="700" fill="#111">${esc(title)}</text>
  ${subtitle ? `<text x="20" y="54" font-size="12.5" fill="#666">${esc(subtitle)}</text>` : ""}
  <line x1="${labelW}" y1="${padTop - 6}" x2="${labelW}" y2="${padTop + rows.length * rowH}" stroke="#e3e6ea"/>
  ${bars}
  ${note ? `<text x="20" y="${H - 22}" font-size="11.5" fill="#888">${esc(note)}</text>` : ""}
</svg>`;
}

/** 分组柱状图（多系列） */
function groupedChart({ title, subtitle, groups, series, max, unit = "", note = "" }) {
  const uid1 = ++uid;
  const padTop = 104, padBottom = note ? 70 : 46, padL = 60, padR = 30;
  const H = 430;
  const chartW = W - padL - padR;
  const chartH = H - padTop - padBottom;
  const m = max ?? Math.max(...series.flatMap((s) => s.values)) * 1.12;
  const gW = chartW / groups.length;
  const bW = (gW * 0.7) / series.length;

  const palette = ["#2f6fed", "#e8730c", "#16a34a", "#9333ea", "#dc2626"];
  let bars = "";
  let axis = "";
  // y 轴刻度
  for (let i = 0; i <= 4; i++) {
    const v = (m / 4) * i;
    const y = padTop + chartH - (v / m) * chartH;
    axis += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#eef0f3"/>
    <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#888">${v.toFixed(v < 10 ? 2 : 0)}</text>`;
  }
  groups.forEach((g, gi) => {
    const gx = padL + gi * gW;
    series.forEach((s, si) => {
      const v = s.values[gi];
      const h = Math.max(1, (v / m) * chartH);
      const x = gx + gW * 0.15 + si * bW;
      const y = padTop + chartH - h;
      bars += `<rect x="${x}" y="${y}" width="${bW * 0.86}" height="${h}" rx="2" fill="${s.color ?? palette[si % palette.length]}"/>
      <text x="${x + (bW * 0.86) / 2}" y="${y - 5}" text-anchor="middle" font-size="10.5" fill="#444" font-weight="600">${v}${unit}</text>`;
    });
    bars += `<text x="${gx + gW / 2}" y="${padTop + chartH + 20}" text-anchor="middle" font-size="12" fill="#333">${esc(g)}</text>`;
  });
  // 图例
  const legend = series
    .map((s, si) => {
      const lx = padL + si * 150;
      const ly = padTop - 26;
      return `<rect x="${lx}" y="${ly - 9}" width="12" height="12" rx="2" fill="${s.color ?? palette[si % palette.length]}"/>
      <text x="${lx + 18}" y="${ly + 1}" font-size="11.5" fill="#444">${esc(s.label)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t${uid1}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <text id="t${uid1}" x="20" y="30" font-size="17" font-weight="700" fill="#111">${esc(title)}</text>
  ${subtitle ? `<text x="20" y="51" font-size="12.5" fill="#666">${esc(subtitle)}</text>` : ""}
  ${legend}
  ${axis}
  ${bars}
  ${note ? `<text x="20" y="${H - 14}" font-size="11.5" fill="#888">${esc(note)}</text>` : ""}
</svg>`;
}

// ── 图 1：句子类型消融 ────────────────────────────────────────────
const ablation = JSON.parse(fs.readFileSync("../data/ablation-realwire.json", "utf8"));
function agg(rows, key) {
  const sub = rows.filter((r) => r[key] && !r.error && r.ratio !== null);
  const by = {};
  for (const r of sub) (by[r[key]] ??= []).push(r.ratio);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}
const aByAnchor = agg(ablation, "anchor");
const CHART1 = barChart({
  title: "图 1｜锚点句子类型：形式指令 vs 吸引子",
  subtitle: "真实 wire（13k system + 152 tools）· effort=max · n=90 · 指标=推理块中 We 类词占比",
  rows: [
    { label: "F1 每段以 We 开头", value: +aByAnchor["F1_paragraph"].toFixed(3), color: "#16a34a" },
    { label: "F2 每句以 We 开头", value: +aByAnchor["F2_sentence"].toFixed(3), color: "#16a34a" },
    { label: "C0 块级约束（旧版）", value: +aByAnchor["C0_base"].toFixed(3), color: "#2f6fed", dim: true },
    { label: "A1 团队身份（吸引子）", value: +aByAnchor["A1_identity"].toFixed(3), color: "#dc2626" },
    { label: "A2 一体思考（吸引子）", value: +aByAnchor["A2_stance"].toFixed(3), color: "#dc2626" },
    { label: "A4 工作方式（吸引子）", value: +aByAnchor["A4_workstyle"].toFixed(3), color: "#dc2626" },
    { label: "无锚点", value: +aByAnchor["NONE"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：形式指令有效（绿），吸引子写法与无锚点几乎无差异（红 vs 灰）。",
});

// ── 图 2：快照内部位置 ────────────────────────────────────────────
const snap = JSON.parse(fs.readFileSync("../data/snapshot-position.json", "utf8"));
const sByPos = agg(snap, "pos");
const CHART2 = barChart({
  title: "图 2｜锚点在同一 runtime-context 快照内的位置",
  subtitle: "快照总长约 1,280 字，其余段落每步变化 · effort=max · 每位置 n=10",
  rows: [
    { label: "头 + 尾各一份（采用）", value: +sByPos["both"].toFixed(3), color: "#16a34a" },
    { label: "前部 1/4", value: +sByPos["early"].toFixed(3), color: "#2f6fed" },
    { label: "开头", value: +sByPos["head"].toFixed(3), color: "#2f6fed" },
    { label: "中间", value: +sByPos["mid"].toFixed(3), color: "#2f6fed", dim: true },
    { label: "末尾（旧版 order 10000）", value: +sByPos["tail"].toFixed(3), color: "#dc2626" },
    { label: "无锚点", value: +sByPos["none"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：旧版把锚点放在快照末尾，是所有有效位置里最差的；改到头尾各一份后提升约 44%。",
});

// ── 图 3：system prompt 侧全部无效 ───────────────────────────────
const sys = JSON.parse(fs.readFileSync("../data/sys-ablation.json", "utf8"));
const sBySid = agg(sys, "sid");
const CHART3 = barChart({
  title: "图 3｜改 system prompt 是否有用（全部无效）",
  subtitle: "真实 wire · effort=max · 每变体 n=10 · 指标同上",
  rows: [
    { label: "S7 基线 + 尾部锚点", value: +sBySid["S7_baseline_plus_anchor"].toFixed(3), color: "#16a34a" },
    { label: "S6 全量 you→we + 锚点", value: +sBySid["S6_rewire_plus_anchor"].toFixed(3), color: "#e8730c" },
    { label: "S5 头尾插入 We 段", value: +sBySid["S5_head_tail_we"].toFixed(3), color: "#dc2626" },
    { label: "S2 全量 you→we 重写", value: +sBySid["S2_full_rewire"].toFixed(3), color: "#dc2626" },
    { label: "S4 末尾插 We 段", value: +sBySid["S4_tail_we"].toFixed(3), color: "#dc2626" },
    { label: "S3 开头插 We 段", value: +sBySid["S3_head_we"].toFixed(3), color: "#dc2626" },
    { label: "S1 persona 改 We 身份", value: +sBySid["S1_persona_we"].toFixed(3), color: "#dc2626" },
    { label: "S0 基线（无锚点）", value: +sBySid["S0_baseline"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：只有近场锚点（S7）有效；system prompt 侧所有改法都停留在基线水平。",
});

// ── 图 4：wire 层位置（不要挪到最后）────────────────────────────
const rwp = JSON.parse(fs.readFileSync("../data/real-wire-position.json", "utf8"));
const rByKind = agg(rwp, "kind");
const CHART4 = barChart({
  title: "图 4｜锚点在整条 wire 里的位置（别再往后挪）",
  subtitle: "真实完整 wire：system → user → runtime-context → skill-catalog → time-context · n=12/组",
  rows: [
    { label: "锚点 → skill → time（现状）", value: +rByKind["R1_real_current"].toFixed(3), color: "#16a34a" },
    { label: "锚点后无内容（简化）", value: +rByKind["R0_simple_current"].toFixed(3), color: "#2f6fed", dim: true },
    { label: "skill → time → 锚点（最后）", value: +rByKind["R2_anchor_last"].toFixed(3), color: "#dc2626" },
    { label: "无锚点", value: +rByKind["R3_none"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：把锚点挪到 wire 最末尾反而变差。当前默认追加位置已是最优。",
});

// ── 图 5：多轮重注入节奏 ─────────────────────────────────────────
const ri = JSON.parse(fs.readFileSync("../data/reinject-cadence.json", "utf8"));
function aggCadence(rows) {
  const by = {};
  for (const r of rows) {
    if (r.error || r.ratio === null) continue;
    (by[r.strategy] ??= []).push(r.ratio);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length]));
}
const cad = aggCadence(ri);
const CHART5 = barChart({
  title: "图 5｜锚点重注入节奏（多轮 6 轮会话）",
  subtitle: "真实 wire · effort=max · 每策略 n=4–5 个检查点",
  rows: [
    { label: "每轮都注入（现状）", value: +cad["T1_every_turn"].toFixed(3), color: "#16a34a" },
    { label: "首轮 + 每隔 2 轮", value: +cad["T4_first_plus_every2"].toFixed(3), color: "#2f6fed" },
    { label: "首轮 + 最后一轮", value: +cad["T3_first_and_last"].toFixed(3), color: "#2f6fed", dim: true },
    { label: "每隔 2 轮", value: +cad["T2_every_2nd"].toFixed(3), color: "#e8730c" },
    { label: "只第一轮", value: +cad["T0_only_first"].toFixed(3), color: "#dc2626" },
    { label: "完全不注入", value: +cad["T5_none"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：每轮注入显著优于只注入一次；当前架构天然每步重算快照，无需额外机制。",
});

// ── 图 6：真实 Let me 底座上能否拉回 ─────────────────────────────
const rba = JSON.parse(fs.readFileSync("../data/real-base-anchor.json", "utf8"));
const rByVar = agg(rba, "variant");
const CHART6 = barChart({
  title: "图 6｜已深陷 Let me 的真实长会话能否拉回",
  subtitle: "底座：真实会话（562 个推理块，We 占比 0.005，100% Let me）· effort=max · 每变体 n=4–6",
  rows: [
    { label: "末尾锚点 ×2", value: +rByVar["B5_tail_twice"].toFixed(3), color: "#16a34a" },
    { label: "清洗历史 + 锚点", value: +rByVar["B3_clean_history"].toFixed(3), color: "#e8730c" },
    { label: "头尾各一份", value: +rByVar["B2_head_tail"].toFixed(3), color: "#16a34a" },
    { label: "末尾锚点（现状）", value: +rByVar["B1_tail"].toFixed(3), color: "#2f6fed" },
    { label: "示范消息 + 锚点", value: +rByVar["B4_demo"].toFixed(3), color: "#2f6fed", dim: true },
    { label: "不加锚点", value: +rByVar["B0_none"].toFixed(3), color: "#9aa1ab" },
  ],
  max: 1,
  note: "结论：锚点可从深陷状态拉回；且「多注入」没有出现疲劳衰减。样本小，仅方向可信。",
});

// ── 图 7：语域块长度分布（回答「谁更长」）─────────────────────────
const CHART7 = groupedChart({
  title: "图 7｜语域块长度：We 并不比 Let me 短",
  subtitle: "生产语料 6,807 个推理块（无锚点会话，按块内语域占比分类）· 单位=字符",
  groups: ["p25", "中位数", "p75"],
  series: [
    { label: "纯 We 块 (n=662)", values: [703, 2271, 5889], color: "#2f6fed" },
    { label: "纯 Let me 块 (n=4,930)", values: [626, 1906, 5201], color: "#e8730c" },
    { label: "混合块 (n=653)", values: [1200, 3603, 7200], color: "#9333ea" },
  ],
  max: 7500,
  note: "We 块中位长度 2,271 > Let me 块 1,906（1.19 倍）。「Let me 更长」的印象在块级数据中不成立。",
});

// ── 图 8：锚点前后对比（真实生产语料）───────────────────────────
const CHART8 = groupedChart({
  title: "图 8｜锚点在生产语料中的实际效果",
  subtitle: "305 个真实会话 / 122,366 事件 · 分组依据=运行时上下文中是否含锚点原文",
  groups: ["「We need」开头率", "We 类词占比"],
  series: [
    { label: "无锚点 (n=6,541 块)", values: [0.49, 17.5], color: "#9aa1ab" },
    { label: "有锚点 (n=402 块)", values: [21.4, 30.8], color: "#2f6fed" },
  ],
  max: 100,
  unit: "%",
  note: "这是自然观察（非随机对照），n=12 个带锚点会话，选择偏差无法排除。",
});

const files = {
  "fig1-sentence-type.svg": CHART1,
  "fig2-snapshot-position.svg": CHART2,
  "fig3-system-prompt.svg": CHART3,
  "fig4-wire-position.svg": CHART4,
  "fig5-reinjection.svg": CHART5,
  "fig6-real-base.svg": CHART6,
  "fig7-length.svg": CHART7,
  "fig8-production.svg": CHART8,
};
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log("wrote", name, svg.length, "bytes");
}

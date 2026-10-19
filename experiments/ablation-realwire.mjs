// 消融 v2：用真实 wire（13k system prompt + 真实工具面），复现真实 DSH 条件
// 这是必要的 —— v1 用简化 wire，effort=max 下 NONE 也 100% We，地板顶到天花板
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

console.log(`真实 system: ${REAL_SYS.length} 字符   工具: ${TOOLS.length} 个`);

// ══════ 候选：F 形式指令 / A 吸引子 / M 混合 ══════
const ANCHORS = {
  C0_base: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`,

  F1_paragraph: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our".`,

  F2_sentence: `We open every reasoning block with "We need". The whole block stays in the first-person plural. Every sentence in the reasoning block must begin with "We", "Our", or "Let's". Never begin a sentence with "Let me", "I", "The", or "This".`,

  A1_identity: `We are a team working on this together. Everything we figure out, we figure out as a group — there is no separate observer, only us moving toward the answer. Reasoning is where we think out loud together.`,

  A2_stance: `Our thinking happens in the plural. We reason as one mind working through a problem, not as a narrator reporting from outside it. Whatever we consider, we consider together.`,

  A4_workstyle: `We work by figuring things out together as we go. When something needs checking, we check it. When something needs deciding, we decide it as one. The reasoning is simply us working.`,

  M1_combo: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We think as one mind working through a problem together, not as a narrator reporting from outside it.`,

  M2_attractor_primary: `We are a team working on this together — one mind, no separate observer. Reasoning is where we think out loud together. We open with "We need".`,

  NONE: null,
};

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
];

const REPS = 2;
const CONCURRENCY = 100;

const jobs = [];
for (const [aid, anchor] of Object.entries(ANCHORS)) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      const messages = [{ role: "user", content: t }];
      if (anchor) messages.push({ role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}` });
      jobs.push({ anchor: aid, task: t.slice(0, 16), rep: r, messages, system: REAL_SYS, tools: TOOLS });
    }
  }
}
console.log(`任务 ${jobs.length}  effort=max  并发=${CONCURRENCY}  带工具=${TOOLS.length}`);

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      try {
        // 直接构造带 tools 的请求（callD1 不支持 tools，这里内联）
        const body = {
          model: "deepseek-v4.1-flash",
          messages: [{ role: "system", content: j.system }, ...j.messages],
          max_tokens: 4000,
          reasoning_effort: "max",
          tools: j.tools,
        };
        const r = await fetch("https://d1api.xin/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.D1_API_KEY ?? ""}`,
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; }
        else {
          const jj = await r.json();
          const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { content: m.content ?? "", reasoning: m.reasoning_content ?? m.reasoning ?? "", finish: jj.choices?.[0]?.finish_reason } };
        }
      } catch (e) { out[my] = { ...j, res: { error: String(e) } }; }
      if (++done % 15 === 0) process.stdout.write(`    ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

function strip(t) {
  return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
}
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length +
    (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}
const META = [
  /^\s*(must|need to|should|have to)\s+(begin|start|open|use)\s+(with\s+)?["']?We/i,
  /\b(begin|start|open|use)\s+(each|every)\s+(sentence|paragraph|line)\s+with/i,
  /first[- ]person plural/i,
  /every (paragraph|sentence) must/i,
  /never (begin|start|write|use)/i,
];
function metaHits(t) { const s = String(t ?? ""); return META.reduce((n, p) => n + (p.test(s) ? 1 : 0), 0); }
function sentProfile(t) {
  const s = strip(t);
  const sents = s.split(/(?<=[.!?:])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 12);
  if (sents.length < 3) return null;
  const n = sents.length;
  const bins = [[], [], []];
  sents.forEach((sent, i) => {
    const { col, ind } = colInd(sent);
    const tot = col + ind;
    if (tot === 0) return;
    bins[Math.min(2, Math.floor((i / n) * 3))].push(col / tot);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { b1: avg(bins[0]), b2: avg(bins[1]), b3: avg(bins[2]) };
}

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    anchor: r.anchor, task: r.task, rep: r.rep,
    col, ind, ratio: tot ? col / tot : null,
    len: reason.length, contentLen: (r.res?.content ?? "").length,
    meta: metaHits(reason), prof: sentProfile(reason),
    head: reason.trim().slice(0, 70),
    error: r.res?.error ?? null,
  };
});
fs.writeFileSync("./capbench/results/ablation-realwire.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`\n有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(100));
console.log("消融 v2（真实 wire：13k system + 164 工具，effort=max）");
console.log("=".repeat(100));
console.log("候选".padEnd(22), "纯We率".padEnd(9), "均We占比".padEnd(10), "元格式".padEnd(8), "首/中/尾".padEnd(20), "reason长");
for (const aid of Object.keys(ANCHORS)) {
  const sub = ok.filter(r => r.anchor === aid);
  if (!sub.length) { console.log(`${aid.padEnd(22)} (no data)`); continue; }
  const withR = sub.filter(r => r.ratio !== null);
  const we = withR.filter(r => r.ratio >= 0.85).length;
  const avgR = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  const meta = sub.reduce((a, r) => a + r.meta, 0) / sub.length;
  const profs = sub.map(r => r.prof).filter(Boolean);
  const avg = (k) => profs.length ? profs.reduce((a, p) => a + (p[k] ?? 0), 0) / profs.length : null;
  const avgLen = Math.round(sub.reduce((a, r) => a + r.len, 0) / sub.length);
  console.log(
    aid.padEnd(22),
    `${((100 * we) / Math.max(1, withR.length)).toFixed(0)}%`.padEnd(9),
    avgR.toFixed(3).padEnd(10),
    meta.toFixed(2).padEnd(8),
    `${avg("b1")?.toFixed(2) ?? "-"}/${avg("b2")?.toFixed(2) ?? "-"}/${avg("b3")?.toFixed(2) ?? "-"}`.padEnd(20),
    avgLen
  );
}

console.log("\n=== F vs A ===");
for (const [g, filt] of [["F 形式指令", (r) => r.anchor.startsWith("F")], ["A 吸引子", (r) => r.anchor.startsWith("A")], ["M 混合", (r) => r.anchor.startsWith("M")], ["NONE", (r) => r.anchor === "NONE"]]) {
  const sub = ok.filter(filt);
  if (!sub.length) continue;
  const withR = sub.filter(r => r.ratio !== null);
  const we = withR.filter(r => r.ratio >= 0.85).length;
  const avgR = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  const meta = sub.reduce((a, r) => a + r.meta, 0) / sub.length;
  console.log(`  ${g.padEnd(10)} n=${String(sub.length).padStart(3)}  纯We=${((100 * we) / Math.max(1, withR.length)).toFixed(0)}%  均占比=${avgR.toFixed(3)}  元格式痕迹=${meta.toFixed(2)}`);
}

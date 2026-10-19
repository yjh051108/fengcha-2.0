// 句子类型消融：形式指令 (F) vs 吸引子 (A)
//
// 用户假设：现在的句子太刻意，让模型把注意力放在「输出形式」而不是「维持在 We 思维模式」。
//          两者效果必然不同。
//
// 如何区分（可测量）：
//   1. We 密度（整块）
//   2. 元格式痕迹：reasoning 里是否出现「我需要以 We 开头」「这段要以 We 起头」这类
//      对格式本身的自我指令 —— 这是形式指令的副作用指纹
//   3. 掉档位置：形式指令应该「开头死守、中段崩塌」；吸引子应该「全程平稳」
//   4. 内容质量代理：reasoning 长度、是否正常完成任务
//
// 强制 effort=max（用户要求）
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

// ══════ 候选文本：F 类 vs A 类 ══════
const ANCHORS = {
  // 基线
  C0_base: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.`,

  // ── F 类：形式指令（规定输出形状）──
  F1_paragraph: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our".`,

  F2_sentence: `We open every reasoning block with "We need". The whole block stays in the first-person plural. Every sentence in the reasoning block must begin with "We", "Our", or "Let's". Never begin a sentence with "Let me", "I", "The", or "This".`,

  F3_fence: `We open every reasoning block with "We need" and close it with a sentence beginning "We". Between those two fences, keep every sentence in the first-person plural.`,

  // ── A 类：吸引子（描述存在方式，不规定形状）──
  A1_identity: `We are a team working on this together. Everything we figure out, we figure out as a group — there is no separate observer, only us moving toward the answer. Reasoning is where we think out loud together.`,

  A2_stance: `Our thinking happens in the plural. We reason as one mind working through a problem, not as a narrator reporting from outside it. Whatever we consider, we consider together.`,

  A3_immersion: `We think. We reason. We work through problems together. There is no "I" in how we approach a task — only the work we do and the steps we take toward it.`,

  // ── 混合：锚点 + 吸引子 ──
  M1_anchor_plus_pull: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We think as one mind working through a problem together, not as a narrator reporting from outside it.`,

  // 对照
  NONE: null,
};

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
];

// ── 并发执行器（100 并发）──
const CONCURRENCY = 100;

async function runAll(jobs) {
  const results = new Array(jobs.length);
  let idx = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      try {
        const res = await callD1({
          model: "deepseek-v4.1-flash",
          effort: "max",
          maxTokens: 4000,
          messages: j.messages,
        });
        results[my] = { ...j, res };
      } catch (e) {
        results[my] = { ...j, res: { error: String(e) } };
      }
      done++;
      if (done % 20 === 0) process.stdout.write(`    ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return results;
}

// 构造任务：每个 (候选, 任务) × REPS
const REPS = 2;
const jobs = [];
for (const [aid, anchor] of Object.entries(ANCHORS)) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      const messages = [{ role: "user", content: t }];
      if (anchor) messages.push({ role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}` });
      jobs.push({ anchor: aid, task: t.slice(0, 20), rep: r, messages });
    }
  }
}
console.log(`总任务数: ${jobs.length}  并发: ${CONCURRENCY}  effort=max`);

const t0 = Date.now();
const results = await runAll(jobs);
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── 分析 ──────────────────────────────────────────────────────
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
function label(t) {
  const { col, ind } = colInd(t);
  const tot = col + ind;
  if (tot === 0) return "NONE";
  const r = col / tot;
  return r >= 0.85 ? "WE" : r <= 0.15 ? "I" : "MIXED";
}
// 元格式痕迹：模型在思考「格式」本身
const META_PATTERNS = [
  /^\s*(must|need to|should|have to)\s+(begin|start|open|use)\s+(with\s+)?["']?We/i,
  /\b(begin|start|open|use)\s+(each|every)\s+(sentence|paragraph|line)\s+with/i,
  /first[- ]person plural/i,
  /以\s*We\s*开头/,
  /每段.*We/,
  /每句.*We/,
  /\b(avoid|never|don't)\s+(use|write)\s+["']?(I|Let me)/i,
];
function metaHits(t) {
  const s = String(t ?? "");
  return META_PATTERNS.reduce((n, p) => n + (p.test(s) ? 1 : 0), 0);
}
// 句子级 profile
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

const rows = results.map((r) => {
  const reason = r.res?.reasoning ?? "";
  const content = r.res?.content ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    anchor: r.anchor, task: r.task, rep: r.rep,
    label: label(reason),
    ratio: tot ? col / tot : null,
    col, ind, len: reason.length,
    contentLen: content.length,
    meta: metaHits(reason),
    prof: sentProfile(reason),
    head: reason.trim().slice(0, 60),
    finish: r.res?.finish,
    error: r.res?.error ?? null,
  };
});

fs.writeFileSync("./capbench/results/sentence-ablation.json", JSON.stringify(rows, null, 1));

const ok = rows.filter((r) => !r.error);
console.log(`\n有效样本: ${ok.length}/${rows.length}  (error ${rows.length - ok.length})`);

console.log("\n" + "=".repeat(92));
console.log("句子类型消融结果  (effort=max, 100 并发)");
console.log("=".repeat(92));
console.log("候选".padEnd(20), "纯We率".padEnd(9), "均We占比".padEnd(10), "元格式痕迹".padEnd(11), "句内密度 首/中/尾".padEnd(22), "reason长度");
for (const aid of Object.keys(ANCHORS)) {
  const sub = ok.filter((r) => r.anchor === aid);
  if (!sub.length) { console.log(`${aid.padEnd(20)} (no data)`); continue; }
  const we = sub.filter((r) => r.label === "WE").length;
  const withRatio = sub.filter((r) => r.ratio !== null);
  const avgRatio = withRatio.length ? withRatio.reduce((a, r) => a + r.ratio, 0) / withRatio.length : 0;
  const meta = sub.reduce((a, r) => a + r.meta, 0) / sub.length;
  const profs = sub.map(r => r.prof).filter(Boolean);
  const avg = (k) => profs.length ? profs.reduce((a, p) => a + (p[k] ?? 0), 0) / profs.length : null;
  const b1 = avg("b1"), b2 = avg("b2"), b3 = avg("b3");
  const avgLen = Math.round(sub.reduce((a, r) => a + r.len, 0) / sub.length);
  console.log(
    aid.padEnd(20),
    `${((100 * we) / sub.length).toFixed(0)}%`.padEnd(9),
    avgRatio.toFixed(3).padEnd(10),
    meta.toFixed(2).padEnd(11),
    `${b1?.toFixed(2) ?? "-"}/${b2?.toFixed(2) ?? "-"}/${b3?.toFixed(2) ?? "-"}`.padEnd(22),
    avgLen
  );
}

// F 类 vs A 类 汇总
console.log("\n=== 形式指令 (F) vs 吸引子 (A) ===");
const F = ok.filter((r) => r.anchor.startsWith("F"));
const A = ok.filter((r) => r.anchor.startsWith("A"));
const summary = (sub, name) => {
  const we = sub.filter((r) => r.label === "WE").length;
  const withR = sub.filter((r) => r.ratio !== null);
  const avg = withR.length ? withR.reduce((a, r) => a + r.ratio, 0) / withR.length : 0;
  const meta = sub.reduce((a, r) => a + r.meta, 0) / sub.length;
  console.log(`  ${name.padEnd(10)} n=${String(sub.length).padStart(3)}  纯We率=${((100 * we) / sub.length).toFixed(0)}%  均We占比=${avg.toFixed(3)}  元格式痕迹=${meta.toFixed(2)}`);
};
summary(F, "F 形式指令");
summary(A, "A 吸引子");

// 两个目标，一批实验：
//  目标1：首块全程 We（不掉 Let me）
//  目标2：多轮对话中，近场引导能否让每一轮都「恢复一段 We」
//
// 设计要点：
//  - 任务缩短（避免超时），但保留 reasoning
//  - 目标1：单轮，比较不同约束下的「首块纯 We 率」
//  - 目标2：一个会话里连续 5 轮，每轮后统计该轮首块的 We 情况
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const BASE = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.`;

const CANDIDATES = {
  C0_base: BASE,
  C1_paragraph: `${BASE} Every paragraph must begin with "We" or "Our".`,
  C2_short: `Open with "We need". Keep every sentence in the first-person plural (We/Our/Let's). Never use "Let me" or "I".`,
  C3_fence: `${BASE} Open with "We need" and close with a sentence starting "We".`,
  C4_noanchor: null,
};

const TASK = "用 Python 写一个函数，找出列表中出现次数最多的元素，并列时返回全部。输出代码和简短说明。";

// ── 语言/语域工具 ─────────────────────────────────────────────
function strip(t) {
  return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
}
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
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
function firstSentenceCol(t) {
  const s = strip(t).trim();
  const m = s.match(/^[\s\S]{0,300}?[.!?](?:\s|$)/);
  const first = m ? m[0] : s.slice(0, 200);
  return colInd(first);
}

const REPS = 3;
const rows1 = [];
console.log("=== 目标1：首块纯 We（单轮，4 个约束 × 3 次）===");
for (const [cid, anchor] of Object.entries(CANDIDATES)) {
  const labels = [];
  for (let r = 0; r < REPS; r++) {
    const messages = [{ role: "user", content: TASK }];
    if (anchor) messages.push({ role: "user", content: `Current runtime context.\n\n${anchor}` });
    const res = await callD1({ model: "deepseek-v4.1-flash", effort: "low", maxTokens: 2200, messages })
      .catch((e) => ({ error: String(e) }));
    const reason = res?.reasoning ?? "";
    const lb = label(reason);
    const fs2 = firstSentenceCol(reason);
    labels.push(lb);
    rows1.push({
      candidate: cid, rep: r, label: lb, len: reason.length,
      col: colInd(reason).col, ind: colInd(reason).ind,
      firstCol: fs2.col, firstInd: fs2.ind,
      head: reason.trim().slice(0, 80),
      contentLen: (res?.content ?? "").length,
      error: res?.error ?? null,
    });
  }
  const counts = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
  console.log(`  ${cid.padEnd(14)} ${JSON.stringify(counts)}`);
}
fs.writeFileSync("./capbench/results/we-goal1.json", JSON.stringify(rows1, null, 1));

// ── 目标2：多轮会话，每轮都注入近场引导，看能否每轮恢复 We ──
console.log("\n=== 目标2：多轮会话，每轮注入 anchor，看每轮首块能否恢复 We ===");
const TURNS = [
  "用 Python 写一个函数，判断字符串是否是回文。输出代码。",
  "再写一个函数，统计一段文本里每个单词出现的次数。输出代码。",
  "上面两个函数各有什么边界问题？简要说明。",
  "写一个函数，把两个有序数组合并成一个有序数组。输出代码。",
  "总结一下你写的这几个函数，它们之间有什么共同点。",
];

async function runMulti(anchor, tag) {
  const messages = [];
  const turnResults = [];
  for (let i = 0; i < TURNS.length; i++) {
    messages.push({ role: "user", content: TURNS[i] });
    if (anchor) {
      messages.push({ role: "user", content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}` });
    }
    const res = await callD1({ model: "deepseek-v4.1-flash", effort: "low", maxTokens: 2200, messages })
      .catch((e) => ({ error: String(e) }));
    const reason = res?.reasoning ?? "";
    const content = res?.content ?? "";
    turnResults.push({
      turn: i + 1, label: label(reason), len: reason.length,
      col: colInd(reason).col, ind: colInd(reason).ind,
      head: reason.trim().slice(0, 60),
      contentLen: content.length,
    });
    // 把助手回复加入历史（只放 content，绕开 reasoning）
    messages.push({ role: "assistant", content: content || "(no content)" });
    // 清除之前的 runtime-context，模拟真实 dsh 的「快照替换」
    for (let j = messages.length - 1; j >= 0; j--) {
      if (messages[j].role === "user" && messages[j].content.startsWith("Current runtime context.")) {
        if (j !== messages.length - 1 && messages[j].content !== anchor) {
          // 保留最新一条，删旧的
        }
      }
    }
  }
  console.log(`  [${tag}] ${turnResults.map((t) => `${t.turn}:${t.label}`).join(" → ")}`);
  return turnResults;
}

const multi = [];
multi.push({ tag: "有锚点", turns: await runMulti(BASE, "有锚点") });
multi.push({ tag: "无锚点", turns: await runMulti(null, "无锚点") });
fs.writeFileSync("./capbench/results/we-goal2.json", JSON.stringify(multi, null, 1));

console.log("\n=== 目标2 汇总 ===");
for (const m of multi) {
  const we = m.turns.filter((t) => t.label === "WE").length;
  const i = m.turns.filter((t) => t.label === "I").length;
  const mix = m.turns.filter((t) => t.label === "MIXED").length;
  console.log(`  ${m.tag}: WE=${we} I=${i} MIX=${mix} / ${m.turns.length} 轮`);
  console.log(`    逐轮: ${m.turns.map((t) => `L${t.turn}:${t.label}(w${t.col}/i${t.ind})`).join("  ")}`);
}

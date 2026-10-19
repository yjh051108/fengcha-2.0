// 核心目标：让模型按「任务形式」自动路由到 we-need / let-me 两种思维链
// 已知矛盾：E34 说「固定 persona 下任务不能翻转语域（无自路由）」
//           E35 说「会话内 build vs inspect 有 Δ=+0.42」
// 这个矛盾必须解决 —— 它决定了路由能力到底能不能稳定
//
// 本轮设计要点（针对前两轮的缺陷）：
//  1. 任务形式必须是「结构性差异」，不是措辞差异
//  2. 每格 n 足够大（前两轮 n=2/3 根本没有统计效力）
//  3. 同时测「轮内稳定性」和「跨任务可预测性」
//  4. 记录每块的语域分类，看是否存在真实双峰（而非连续漂移）

import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 语域分类器（统一口径，只此一份）──────────────────────────────
export function classify(reasoning) {
  const t = String(reasoning ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]{0,120}`/g, " ")
    .replace(/"[^"\n]{0,200}"/g, " ")
    .replace(/'[^'\n]{0,200}'/g, " ");
  const we = (t.match(/\bWe\b/g) ?? []).length;
  const our = (t.match(/\bOur\b/g) ?? []).length;
  const us = (t.match(/\bUs\b/g) ?? []).length;
  const lets = (t.match(/\bLet's\b/g) ?? []).length;
  const letme = (t.match(/\bLet me\b/g) ?? []).length;
  const iSing = (t.match(/\bI\b(?!['’])/g) ?? []).length;
  const iContr = (t.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length;
  const my = (t.match(/\bMy\b/g) ?? []).length;
  const col = we + our + us + lets;
  const ind = letme + iSing + iContr + my;
  const total = col + ind;
  const ratio = total === 0 ? null : col / total;
  let label;
  if (total === 0) label = "NONE";
  else if (ratio >= 0.85) label = "WE";
  else if (ratio <= 0.15) label = "I";
  else label = "MIXED";
  const firstWord = (t.trim().match(/^[A-Za-z']+/) ?? [""])[0];
  return { label, firstWord, col, ind, ratio, we, our, lets, letme, iSing };
}

// ── 任务形式：结构性差异，不是措辞差异 ────────────────────────────
// BUILD = 要产出新东西（写/造/实现）→ 理应 We need（规划态）
// INSPECT = 要读并报告已有东西（查/审/诊断）→ 理应 Let me（逐步态）
export const TASK_FORMS = {
  build: [
    {
      id: "b1",
      q: "Write a Python function that merges two sorted lists into one sorted list. Output only the code.",
    },
    {
      id: "b2",
      q: "Create a JSON schema for a user profile with fields: id, name, email, tags. Output only the JSON.",
    },
    {
      id: "b3",
      q: "Implement a rate limiter in TypeScript using a token bucket. Output only the code.",
    },
    {
      id: "b4",
      q: "Design a database table for storing blog comments with threading support. Output the CREATE TABLE statement only.",
    },
  ],
  inspect: [
    {
      id: "i1",
      q: "Here is a function:\n```python\ndef f(xs):\n    return [x for x in xs if x > 0]\n```\nWhat does it return for xs=[-1,0,2,3]? Output only the result.",
    },
    {
      id: "i2",
      q: "Given this config:\n```json\n{\"retries\": 3, \"timeout\": 30}\n```\nIs retries a number or a string? Output only number or string.",
    },
    {
      id: "i3",
      q: "Review this code for bugs:\n```js\nfunction sum(a){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return s; }\n```\nWhat happens when a is empty? Output only the value returned.",
    },
    {
      id: "i4",
      q: "What is the time complexity of binary search on n elements? Output only the complexity.",
    },
  ],
};

// ── 4 种 persona × 2 种任务形式 × 每格 6 次 ──────────────────────
const PERSONAS = {
  none: null,
  engineer: "You are a helpful software engineer assistant.",
  spec: "You are a precise software architect who writes specifications before acting.",
  neutral: "You are an assistant.",
};

async function runOne(personaText, task, idx) {
  const messages = [];
  if (personaText) messages.push({ role: "system", content: personaText });
  messages.push({ role: "user", content: task.q });
  const body = { model: "deepseek-v4.1-flash", messages, max_tokens: 3000, reasoning_effort: "low" };
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) { await sleep(1500 * (a + 1)); continue; }
      const j = await r.json();
      const m = j.choices?.[0]?.message ?? {};
      const reasoning = m.reasoning_content ?? m.reasoning ?? "";
      return { reasoning, content: m.content ?? "", cls: classify(reasoning) };
    } catch { await sleep(1500 * (a + 1)); }
  }
  return { reasoning: "", content: "", cls: classify(""), error: true };
}

const rows = [];
for (const [pk, ptext] of Object.entries(PERSONAS)) {
  for (const [form, tasks] of Object.entries(TASK_FORMS)) {
    for (const task of tasks) {
      for (let rep = 0; rep < 2; rep++) {
        const r = await runOne(ptext, task, rep);
        rows.push({
          persona: pk, form, taskId: task.id, rep,
          label: r.cls.label, firstWord: r.cls.firstWord,
          ratio: r.cls.ratio, col: r.cls.col, ind: r.cls.ind,
          len: r.reasoning.length, error: r.error ?? false,
        });
        await sleep(120);
      }
    }
    const sub = rows.filter((r) => r.persona === pk && r.form === form);
    const we = sub.filter((r) => r.label === "WE").length;
    const i = sub.filter((r) => r.label === "I").length;
    const mix = sub.filter((r) => r.label === "MIXED").length;
    const none = sub.filter((r) => r.label === "NONE").length;
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    console.log(
      `  ${pk.padEnd(9)} ${form.padEnd(8)} n=${sub.length} WE=${we} I=${i} MIX=${mix} NONE=${none} avgRatio=${avg(sub.filter((x) => x.ratio !== null).map((x) => x.ratio)).toFixed(2)} avgLen=${Math.round(avg(sub.map((x) => x.len)))}`
    );
  }
}

fs.writeFileSync("./capbench/results/route-grid.json", JSON.stringify(rows, null, 1));

console.log("\n=== 自路由判定（同一 persona 下 build vs inspect）===");
for (const pk of Object.keys(PERSONAS)) {
  const b = rows.filter((r) => r.persona === pk && r.form === "build" && r.ratio !== null);
  const i = rows.filter((r) => r.persona === pk && r.form === "inspect" && r.ratio !== null);
  const rb = b.reduce((a, x) => a + x.ratio, 0) / (b.length || 1);
  const ri = i.reduce((a, x) => a + x.ratio, 0) / (i.length || 1);
  console.log(`  ${pk.padEnd(9)} build=${rb.toFixed(3)} inspect=${ri.toFixed(3)} Δ=${(rb - ri).toFixed(3)}  ${Math.abs(rb - ri) > 0.2 ? "★ 有自路由" : "✗ 无自路由"}`);
}

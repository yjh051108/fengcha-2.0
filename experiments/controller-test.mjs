// 最终验证：语域控制器
// 目标：让「任务形式 → 语域」变成可控的，而不是碰运气
//
// 已确认的事实（来自前几轮）：
//   1. 块首 40 字符预测整块语域 = 98.9%  → 语域在开头就锁定，之后自洽
//   2. P(I|We)=0.0861  P(We|I)=0.0105    → We→I 是单向棘轮，你观察对了
//   3. 同一任务重复 6 次 purity=100%      → 任务级是确定的，不是随机
//   4. P1「先给两句话计划」把 build 从 I 拉到 We（b4: 0.01→0.95）
//
// 所以控制器要做的不是「求模型」，而是：在开头把语域定死
import { callD1 } from "../runner.mjs";
import { classify } from "./route-test.mjs";
import fs from "node:fs";

const REPS = 3;

// 6 个任务，build/inspect 各 4，全部是硬题（避免太简单导致语域不稳）
const TASKS = [
  { form: "build", id: "B1", q: "Write a Python LRU cache class with O(1) get/put. Output only code." },
  { form: "build", id: "B3", q: "Design a URL shortener: give the database schema and the API endpoints. Output only the design." },
  { form: "inspect", id: "I1", q: "```python\ndef g(a):\n    return a if a else []\n```\nWhat does g(0) return? Output only the value." },
  { form: "inspect", id: "I2", q: "```sql\nSELECT * FROM t WHERE a = NULL;\n```\nHow many rows does this return? Output only the number or a word." },
  { form: "inspect", id: "I3", q: "Code:\n```js\nconst x = [3,1,2].sort();\n```\nWhat is x[0]? Output only the value." },
  { form: "inspect", id: "I4", q: "A loop runs n times and inside does a binary search over n. What is the complexity? Output only the complexity." },
];

// 三种策略
const STRATEGIES = {
  // 基线
  baseline: { prefix: null },

  // 控制器：按任务形式注入开场句（把语域在开头定死）
  controller: {
    prefix: {
      build: "We need to plan the implementation first, then produce it.",
      inspect: "We need to inspect the given input first, then report.",
    },
  },

  // 反向控制器：需要深挖时强制 Let me
  deep: {
    prefix: {
      build: "Let me work through this carefully step by step.",
      inspect: "Let me work through this carefully step by step.",
    },
  },
};

function buildPrompt(strategy, task) {
  const cfg = STRATEGIES[strategy];
  if (!cfg.prefix) return task.q;
  const p = typeof cfg.prefix === "string" ? cfg.prefix : cfg.prefix[task.form];
  return `${p}\n\n${task.q}`;
}

const rows = [];
for (const strategy of Object.keys(STRATEGIES)) {
  console.log(`\n--- ${strategy} ---`);
  for (const t of TASKS) {
    const labels = [], ratios = [], lens = [];
    for (let r = 0; r < REPS; r++) {
      const res = await callD1({
        model: "deepseek-v4.1-flash",
        system: null,
        user: buildPrompt(strategy, t),
        effort: "low",
        maxTokens: 3500,
      });
      const cls = classify(res.reasoning ?? "");
      labels.push(cls.label);
      if (cls.ratio !== null) ratios.push(cls.ratio);
      lens.push((res.reasoning ?? "").length);
      rows.push({
        strategy, form: t.form, taskId: t.id, rep: r,
        label: cls.label, ratio: cls.ratio, firstWord: cls.firstWord,
        len: (res.reasoning ?? "").length,
        contentLen: (res.content ?? "").length,
      });
    }
    const counts = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
    const purity = Math.max(...Object.values(counts)) / labels.length;
    const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
    const meanLen = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
    console.log(
      `  ${t.form.padEnd(7)} ${t.id} purity=${(purity * 100).toFixed(0).padStart(3)}% ratio=${avgRatio === null ? "n/a" : avgRatio.toFixed(2)} len=${String(meanLen).padStart(5)} ${JSON.stringify(counts)}`
    );
  }
}

fs.writeFileSync("./capbench/results/controller.json", JSON.stringify(rows, null, 1));

// ── 汇总 ──────────────────────────────────────────────────────
console.log("\n" + "=".repeat(70));
console.log("控制器效果汇总");
console.log("=".repeat(70));
for (const strategy of Object.keys(STRATEGIES)) {
  console.log(`\n【${strategy}】`);
  for (const form of ["build", "inspect"]) {
    const sub = rows.filter((r) => r.strategy === strategy && r.form === form);
    const we = sub.filter((r) => r.label === "WE").length;
    const i = sub.filter((r) => r.label === "I").length;
    const none = sub.filter((r) => r.label === "NONE").length;
    const mix = sub.filter((r) => r.label === "MIXED").length;
    const withR = sub.filter((r) => r.ratio !== null);
    const avgRatio = withR.length ? withR.reduce((a, x) => a + x.ratio, 0) / withR.length : 0;
    // 任务级纯度
    const byTask = {};
    for (const r of sub) (byTask[r.taskId] ??= []).push(r.label);
    const purities = Object.values(byTask).map((ls) => {
      const c = ls.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
      return Math.max(...Object.values(c)) / ls.length;
    });
    const avgPur = purities.reduce((a, b) => a + b, 0) / purities.length;
    console.log(
      `  ${form.padEnd(7)} We=${String(we).padStart(2)} I=${String(i).padStart(2)} MIX=${String(mix).padStart(2)} NONE=${String(none).padStart(2)} | 平均We占比=${avgRatio.toFixed(2)} | 任务级纯度=${(avgPur * 100).toFixed(0)}%`
    );
  }
}

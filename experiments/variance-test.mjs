// 定位不稳定性：build 侧为什么一半 We 一半 I？
// 假设 H1：build 任务的思考长度决定语域（长思考 → I，短思考 → We）
// 假设 H2：build 任务的内容类型决定语域（代码 vs 设计）
// 假设 H3：纯随机（同题同 prompt 重复跑，结果抖动）
//
// 判据：同一 task 重复 N 次，看结果是否一致
//   一致 → 由任务内容决定（可路由）
//   抖动 → 随机（不可路由，需要外部约束）
import { callD1 } from "../runner.mjs";
import { classify } from "./route-test.mjs";
import fs from "node:fs";

const REPEATS = 8;

const TASKS = [
  // build 侧（上一轮不稳定的一侧）
  { form: "build", id: "b1", q: "Write a Python function that merges two sorted lists into one sorted list. Output only the code." },
  { form: "build", id: "b2", q: "Create a JSON schema for a user profile with fields: id, name, email, tags. Output only the JSON." },
  { form: "build", id: "b3", q: "Implement a rate limiter in TypeScript using a token bucket. Output only the code." },
  { form: "build", id: "b4", q: "Design a database table for storing blog comments with threading support. Output the CREATE TABLE statement only." },
  // 对照：inspect 侧（上一轮稳定 100% We）
  { form: "inspect", id: "i1", q: "Here is a function:\n```python\ndef f(xs):\n    return [x for x in xs if x > 0]\n```\nWhat does it return for xs=[-1,0,2,3]? Output only the result." },
  { form: "inspect", id: "i3", q: "Review this code for bugs:\n```js\nfunction sum(a){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return s; }\n```\nWhat happens when a is empty? Output only the value returned." },
];

const rows = [];
for (const t of TASKS) {
  const labels = [];
  const ratios = [];
  const lens = [];
  for (let r = 0; r < REPEATS; r++) {
    const res = await callD1({
      model: "deepseek-v4.1-flash",
      system: null,
      user: t.q,
      effort: "low",
      maxTokens: 3000,
    });
    const cls = classify(res.reasoning ?? "");
    rows.push({
      form: t.form, taskId: t.id, rep: r,
      label: cls.label, ratio: cls.ratio, len: (res.reasoning ?? "").length,
      firstWord: cls.firstWord, col: cls.col, ind: cls.ind,
      head: (res.reasoning ?? "").slice(0, 90),
    });
    labels.push(cls.label);
    if (cls.ratio !== null) ratios.push(cls.ratio);
    lens.push((res.reasoning ?? "").length);
  }
  const counts = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sd = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
  };
  console.log(
    `${t.form.padEnd(7)} ${t.id.padEnd(3)} ${JSON.stringify(counts).padEnd(34)} ratio=${mean(ratios).toFixed(2)}±${sd(ratios).toFixed(2)} len=${Math.round(mean(lens))}`
  );
}

fs.writeFileSync("./capbench/results/route-variance.json", JSON.stringify(rows, null, 1));

console.log("\n=== 稳定性判定 ===");
for (const t of TASKS) {
  const sub = rows.filter((r) => r.taskId === t.id);
  const labels = sub.map((r) => r.label);
  const uniq = [...new Set(labels)];
  const purity = Math.max(...uniq.map((u) => labels.filter((l) => l === u).length)) / labels.length;
  const verdict = purity === 1 ? "锁定" : purity >= 0.75 ? "偏向" : "抖动";
  console.log(`${t.form.padEnd(7)} ${t.id.padEnd(3)} 纯度=${(purity * 100).toFixed(0)}% ${verdict}  分布=${JSON.stringify(labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {}))}`);
}

// 语域 vs 思考长度 的相关性
const withR = rows.filter((r) => r.ratio !== null && r.len > 0);
if (withR.length > 5) {
  const xs = withR.map((r) => r.len);
  const ys = withR.map((r) => r.ratio);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const r = num / Math.sqrt(dx * dy);
  console.log(`\n语域 vs 思考长度 Pearson r = ${r.toFixed(3)}  (n=${withR.length})`);
  console.log(r < -0.4 ? "  → 长思考倾向 I 语域（长度是语域的强预测因子）" : "  → 长度不是语域的主因");
}

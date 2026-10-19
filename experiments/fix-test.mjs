// 成品原型：稳定性验证
// 假设：语域由「思考长度」主导（r=-0.759），短思考→We，长思考→I
// 那么路由稳定的办法就是：在任务入口显式定档，而不是求模型自己选
//
// 三种策略对比：
//   P0 基线：什么都不做，让模型自己决定
//   P1 长度定档：按任务形式在 prompt 里指定「先给 3 行以内的计划」/「逐步执行」
//   P2 effort 定档：用 reasoning_effort 控制思考长度
//   P3 组合：effort + 长度提示
//
// 判据：同一任务重复 6 次，语域纯度（purity）= 最高类占比
import { callD1 } from "../runner.mjs";
import { classify } from "./route-test.mjs";
import fs from "node:fs";

const REPEATS = 6;

const TASKS = [
  { form: "build", id: "b1", want: "WE", q: "Write a Python function that merges two sorted lists into one sorted list. Output only the code." },
  { form: "build", id: "b3", want: "WE", q: "Implement a rate limiter in TypeScript using a token bucket. Output only the code." },
  { form: "build", id: "b4", want: "WE", q: "Design a database table for storing blog comments with threading support. Output the CREATE TABLE statement only." },
  { form: "inspect", id: "i1", want: "WE", q: "Here is a function:\n```python\ndef f(xs):\n    return [x for x in xs if x > 0]\n```\nWhat does it return for xs=[-1,0,2,3]? Output only the result." },
  { form: "inspect", id: "i3", want: "WE", q: "Review this code for bugs:\n```js\nfunction sum(a){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]; return s; }\n```\nWhat happens when a is empty? Output only the value returned." },
];

// 目标：两种语域各归其位
const PLANS = {
  // 基线
  P0: () => ({ prefix: "", effort: "low" }),

  // P1 长度定档：强制先给极短计划（把思考压短 → 拉回 We）
  P1: (t) => ({
    prefix: "First state the plan in at most 2 short sentences, then produce the output.",
    effort: "low",
  }),

  // P2 effort 定档：低 effort = 短思考
  P2: () => ({ prefix: "", effort: "none" }),

  // P3 组合
  P3: (t) => ({
    prefix: "First state the plan in at most 2 short sentences. Then produce the output.",
    effort: "none",
  }),

  // P4 反向：强制长思考（应当把语域推向 I）
  P4: () => ({ prefix: "", effort: "high" }),
};

const rows = [];
for (const [pk, mk] of Object.entries(PLANS)) {
  for (const t of TASKS) {
    const cfg = mk(t);
    const labels = [];
    const lens = [];
    for (let r = 0; r < REPEATS; r++) {
      const user = cfg.prefix ? `${cfg.prefix}\n\n${t.q}` : t.q;
      const res = await callD1({
        model: "deepseek-v4.1-flash",
        system: null,
        user,
        effort: cfg.effort,
        maxTokens: 3000,
      });
      const cls = classify(res.reasoning ?? "");
      labels.push(cls.label);
      lens.push((res.reasoning ?? "").length);
      rows.push({
        plan: pk, form: t.form, taskId: t.id, rep: r,
        label: cls.label, ratio: cls.ratio,
        len: (res.reasoning ?? "").length,
        contentLen: (res.content ?? "").length,
      });
    }
    const counts = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
    const purity = Math.max(...Object.values(counts)) / labels.length;
    const avgLen = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
    const sub = rows.filter((r) => r.plan === pk && r.taskId === t.id && r.ratio !== null);
    const avgRatio = sub.length ? (sub.reduce((a, x) => a + x.ratio, 0) / sub.length) : 0;
    console.log(
      `  ${pk} ${t.form.padEnd(7)} ${t.id.padEnd(3)} purity=${(purity * 100).toFixed(0)}% ratio=${avgRatio.toFixed(2)} len=${String(avgLen).padStart(5)} ${JSON.stringify(counts)}`
    );
  }
}

fs.writeFileSync("./capbench/results/route-fix.json", JSON.stringify(rows, null, 1));

console.log("\n=== 各策略的稳定性（全任务平均纯度）===");
for (const pk of Object.keys(PLANS)) {
  const byTask = {};
  for (const r of rows.filter((x) => x.plan === pk)) {
    (byTask[r.taskId] ??= []).push(r.label);
  }
  const purities = Object.entries(byTask).map(([tid, labels]) => {
    const c = labels.reduce((a, l) => ((a[l] = (a[l] ?? 0) + 1), a), {});
    return Math.max(...Object.values(c)) / labels.length;
  });
  const avgPur = purities.reduce((a, b) => a + b, 0) / purities.length;
  const sub = rows.filter((x) => x.plan === pk && x.ratio !== null);
  const weFrac = sub.filter((x) => x.label === "WE").length / sub.length;
  console.log(`${pk}  平均纯度=${(avgPur * 100).toFixed(0)}%  We占比=${(weFrac * 100).toFixed(0)}%  平均思考长度=${Math.round(sub.reduce((a, x) => a + x.len, 0) / sub.length)}`);
}

// 关键实验：思考-输出预算竞争 —— 这是我在本项目中发现的唯一稳定故障模式
// 假设：reasoning 与 content 共享 max_tokens 预算。当任务触发长思考时，
// reasoning 吃光预算 -> content 为空 -> 任务失败（而模型其实想对了）
//
// 这是可被工程手段修复的：提高 max_tokens / 降低 effort / 结构化约束思考长度
import { callD1, sleep } from "./runner.mjs";
import { grade } from "./grade.mjs";
import fs from "node:fs";

const WORK = "..";
const MODEL = "deepseek-v4.1-flash";

// 一组会触发长思考的题 + 一组短思考的题
const TRIGGERS = [
  {
    id: "bigmod",
    q: "Compute 2024^2024 mod 1000000007. Output just the integer.",
    compute: () => {
      const MOD = 1000000007n;
      let r = 1n, b = 2024n, e = 2024n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    },
    tolerance: "exact",
  },
  {
    id: "sqrt2",
    q: "Give the square root of 2 to 30 decimal places, truncated. Output just the number.",
    compute: () => (Math.sqrt(2).toFixed(30)),
    tolerance: "num_0", // 宽松：只判前 15 位
  },
  {
    id: "easy_sum",
    q: "What is 12 + 30? Output just the integer.",
    compute: () => "42",
    tolerance: "exact",
  },
  {
    id: "easy_word",
    q: "What is the capital of France? Output just the city name.",
    compute: () => "Paris",
    tolerance: "exact",
  },
];

// 设计：在 max_tokens ∈ {500, 1000, 2000, 4000, 8000, 16000} 下测成功率
// 若成功率随预算上升 -> 证明是预算竞争而非能力不足
const BUDGETS = [500, 1000, 2000, 4000, 8000, 16000];
const EFFORTS = ["low", "max"];

const rows = [];
for (const effort of EFFORTS) {
  for (const t of TRIGGERS) {
    for (const mt of BUDGETS) {
      const res = await callD1({ model: MODEL, system: null, user: t.q, effort, maxTokens: mt });
      let pass = false, parsed = null;
      if (!res.error) {
        if (t.tolerance === "num_0") {
          const m = (res.content ?? "").match(/\d+\.\d+/);
          pass = !!m && m[0].startsWith("1.41421356237309");
          parsed = m ? m[0].slice(0, 20) : null;
        } else {
          const g = grade(t, res.content, WORK);
          pass = g.pass; parsed = g.parsed;
        }
      }
      rows.push({
        effort, taskId: t.id, maxTokens: mt,
        pass, parsed: String(parsed).slice(0, 40),
        contentLen: (res.content ?? "").length,
        reasoningLen: (res.reasoning ?? "").length,
        finish: res.finish, error: res.error ?? null,
        usage: res.usage,
      });
      console.log(
        `  effort=${effort.padEnd(3)} ${t.id.padEnd(10)} mt=${String(mt).padStart(5)} pass=${pass ? "Y" : "n"} content=${String((res.content ?? "").length).padStart(5)} reasoning=${String((res.reasoning ?? "").length).padStart(6)} finish=${res.finish}`
      );
      await sleep(120);
    }
  }
}
fs.writeFileSync("./capbench/results/p7-budget.json", JSON.stringify(rows, null, 1));

// 分析
console.log("\n=== 预算-成功率 ===");
const byEff = {};
for (const r of rows) (byEff[r.effort] ??= []).push(r);
for (const [e, v] of Object.entries(byEff)) {
  console.log(`\neffort=${e}`);
  for (const mt of BUDGETS) {
    const s = v.filter((x) => x.maxTokens === mt);
    if (!s.length) continue;
    const pass = s.filter((x) => x.pass).length;
    const empty = s.filter((x) => x.contentLen === 0).length;
    const avgR = Math.round(s.reduce((a, b) => a + b.reasoningLen, 0) / s.length);
    console.log(`  mt=${String(mt).padStart(5)}  pass=${pass}/${s.length}  empty_content=${empty}/${s.length}  avg_reasoning=${avgR}`);
  }
}

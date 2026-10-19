// 计划 5：区分度验证 —— 基准必须能把不同能力的模型分开
// 如果所有模型都 100%，说明基准没用；如果有梯度，说明基准有效，且 v4.1-flash 确实已饱和
import { runLong, longSummary, saveLong } from "./longrunner.mjs";
import { LONG_TASKS } from "./longtasks.mjs";

const MODELS = ["deepseek-v4.1-flash", "glm-5.3-flash", "kimi-k3"];

const runs = [];
for (const model of MODELS) {
  for (const t of LONG_TASKS) {
    process.stdout.write(`  ${model} / ${t.id} ... `);
    const r = await runLong({ variant: { id: "bare", system: null }, model, effort: "none", taskId: t.id });
    runs.push(r);
    const pass = r.steps.filter((s) => s.pass).length;
    console.log(`${pass}/${r.steps.length}  firstFail=${r.steps.find((s) => !s.pass)?.step ?? "-"}`);
  }
}
const f = saveLong("p5-discrimination", runs);
console.log(`saved -> ${f}`);
console.log("\n=== SUMMARY ===");
for (const s of longSummary(runs)) console.log(JSON.stringify(s));

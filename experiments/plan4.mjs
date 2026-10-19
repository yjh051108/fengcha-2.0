// 计划 4：多步长任务 —— 检验「衰减」是否真实损害能力
import { runLong, longSummary, saveLong } from "./longrunner.mjs";
import { LONG_TASKS } from "./longtasks.mjs";

const MODEL = "deepseek-v4.1-flash";
const VARIANTS = {
  bare: null,
  eng: "You are a helpful software engineer assistant.",
  // 约束复述：每步都重复关键规则（模拟"近场重注入"）
  restate: "You are a helpful software engineer assistant. IMPORTANT: before answering, silently re-read ALL formatting rules stated in the user message and obey them exactly. Never use markdown unless explicitly asked.",
};

const runs = [];
for (const [vid, system] of Object.entries(VARIANTS)) {
  for (const t of LONG_TASKS) {
    process.stdout.write(`  ${vid} / ${t.id} ... `);
    const r = await runLong({ variant: { id: vid, system }, model: MODEL, effort: "low", taskId: t.id });
    runs.push(r);
    const pass = r.steps.filter((s) => s.pass).length;
    console.log(`${pass}/${r.steps.length}  firstFail=${r.steps.find((s) => !s.pass)?.step ?? "-"}`);
  }
}

const f = saveLong("p4-longtasks", runs);
console.log(`\nsaved -> ${f}`);
console.log("\n=== DECAY SUMMARY ===");
for (const s of longSummary(runs)) console.log(JSON.stringify(s));

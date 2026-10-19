// 计划 2：用校准后的 v2 基准重测基线与 effort
import { runPlan, report } from "./runCells.mjs";
import { TASKS } from "./tasks.mjs";

const MODEL = "deepseek-v4.1-flash";
const ALL = TASKS.map((t) => t.id);
const cells = [];
for (const [vid, system] of [
  ["bare", null],
  ["eng", "You are a helpful software engineer assistant."],
]) {
  for (const effort of ["none", "low", "max"]) {
    cells.push({
      id: `p2|${vid}|${effort}`,
      variant: { id: vid, system },
      model: MODEL,
      effort,
      taskIds: ALL,
    });
  }
}
await runPlan("p2-v2baseline", cells);
report("p2-v2baseline");

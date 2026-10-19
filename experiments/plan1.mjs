// 计划 1：基线 + effort 扫描
import { runPlan, report } from "./runCells.mjs";
import { TASKS } from "./tasks.mjs";

const MODEL = "deepseek-v4.1-flash";
const ALL = TASKS.map((t) => t.id);
const cells = [];
for (const [vid, system] of [
  ["bare", null],
  ["eng", "You are a helpful software engineer assistant."],
]) {
  for (const effort of ["none", "low", "medium", "high", "max"]) {
    cells.push({
      id: `p1|${vid}|${effort}`,
      variant: { id: vid, system },
      model: MODEL,
      effort,
      taskIds: ALL,
    });
  }
}
await runPlan("p1-baseline", cells);
report("p1-baseline");

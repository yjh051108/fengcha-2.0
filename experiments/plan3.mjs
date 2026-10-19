// 计划 3：硬题基线（先确认这些题有区分度，再谈提升）
import { runPlan, report } from "./runCells.mjs";
import { HARD } from "./hard.mjs";

const IDS = HARD.map((t) => t.id);
const MODEL = "deepseek-v4.1-flash";

const cells = [];
for (const [vid, system] of [
  ["bare", null],
  ["eng", "You are a helpful software engineer assistant."],
]) {
  for (const effort of ["none", "low"]) {
    cells.push({ id: `p3|${vid}|${effort}`, variant: { id: vid, system }, model: MODEL, effort, taskIds: IDS, maxTokens: 8000 });
  }
}
await runPlan("p3-hardbase", cells);
report("p3-hardbase");

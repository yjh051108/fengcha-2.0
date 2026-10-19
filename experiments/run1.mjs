// 第一轮：基线与 effort 扫描
// 问题：在 deepseek-v4.1-flash 上，effort 对 pass 率值多少？
// 这是整个项目从未测过的维度（35 个实验全固定 effort=max）
import { runCell, summarize, save } from "./runner.mjs";
import { TASKS } from "./tasks.mjs";

const MODEL = "deepseek-v4.1-flash";
const ALL_IDS = TASKS.map((t) => t.id);

const VARIANTS = {
  bare: null, // 无 system
  handoff: "You are a helpful software engineer assistant.",
};

const EFFORTS = ["none", "low", "medium", "high", "max"];

const rows = [];
for (const [vid, system] of Object.entries(VARIANTS)) {
  for (const effort of EFFORTS) {
    process.stdout.write(`  ${vid} / effort=${effort} ... `);
    const r = await runCell({
      variant: { id: vid, system },
      model: MODEL,
      effort,
      taskIds: ALL_IDS,
      reps: 1,
      maxTokens: 6000,
      concurrency: 5,
    });
    rows.push(...r);
    const pass = r.filter((x) => x.pass).length;
    console.log(`${pass}/${r.length}  errors=${r.filter((x) => x.error).length}`);
  }
}

const f = save("r1-baseline", rows);
console.log(`\nsaved -> ${f}`);
console.log("\n=== SUMMARY ===");
for (const s of summarize(rows)) console.log(JSON.stringify(s));

// 计划 6：v4 难题的过检率标定
import { runCell, summarize } from "./runner.mjs";
import { V4 } from "./v4.mjs";
import { save, sleep } from "./runner.mjs";
import fs from "node:fs";
import path from "node:path";

const IDS = V4.map((t) => t.id);
const OUT = "../data";

// v4 任务不在 runner 注册表里，所以直接内联跑
import { callD1 } from "./runner.mjs";
import { grade } from "./grade.mjs";

const WORK = "..";
const MODEL = "deepseek-v4.1-flash";

const rows = [];
let idx = 0;
async function worker() {
  while (true) {
    const my = idx++;
    if (my >= V4.length) return;
    const t = V4[my];
    const res = await callD1({ model: MODEL, system: null, user: t.q, effort: "low", maxTokens: 6000 });
    const g = res.error ? { pass: false, parsed: res.error } : grade(t, res.content, WORK);
    rows.push({
      taskId: t.id, pass: !!g.pass, detail: String(g.parsed).slice(0, 200),
      contentLen: (res.content ?? "").length, reasoningLen: (res.reasoning ?? "").length,
      error: res.error ?? null,
    });
    console.log(`  ${t.id.padEnd(20)} pass=${g.pass}  want=${t.compute()}  got=${String(g.parsed).slice(0, 40)}`);
    await sleep(150);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "p6-v4calib.json"), JSON.stringify(rows, null, 1));
const pass = rows.filter((r) => r.pass).length;
console.log(`\n=== v4 过检率: ${pass}/${rows.length} = ${(100 * pass / rows.length).toFixed(1)}% ===`);

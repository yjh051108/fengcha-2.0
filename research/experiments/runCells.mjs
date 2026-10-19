// 增量落盘 + 可续跑的实验执行器
// 用法：node runCells.mjs <planName>
// 每个 cell 完成后立刻 append 到 results/<planName>.jsonl，中断后重跑会跳过已完成的 cell
import fs from "node:fs";
import path from "node:path";
import { runCell, summarize } from "./runner.mjs";

const WORK = "..";
const OUT = path.join(WORK, "results");

export function loadDone(plan) {
  const f = path.join(OUT, `${plan}.jsonl`);
  if (!fs.existsSync(f)) return new Set();
  const done = new Set();
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.__cell__) done.add(j.__cell__);
    } catch {}
  }
  return done;
}

export function appendCell(plan, cellId, rows) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `${plan}.jsonl`);
  fs.appendFileSync(f, JSON.stringify({ __cell__: cellId, n: rows.length }) + "\n");
  for (const r of rows) fs.appendFileSync(f, JSON.stringify(r) + "\n");
}

export function loadRows(plan) {
  const f = path.join(OUT, `${plan}.jsonl`);
  if (!fs.existsSync(f)) return [];
  const rows = [];
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (!j.__cell__) rows.push(j);
    } catch {}
  }
  return rows;
}

/** cells: [{id, variant, model, effort, taskIds, reps, maxTokens}] */
export async function runPlan(plan, cells, { concurrency = 5 } = {}) {
  const done = loadDone(plan);
  console.log(`plan=${plan} total cells=${cells.length} already done=${done.size}`);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (done.has(c.id)) {
      console.log(`  [${i + 1}/${cells.length}] SKIP ${c.id} (done)`);
      continue;
    }
    const t0 = Date.now();
    const rows = await runCell({
      variant: c.variant,
      model: c.model,
      effort: c.effort,
      taskIds: c.taskIds,
      reps: c.reps ?? 1,
      maxTokens: c.maxTokens ?? 6000,
      concurrency,
    });
    appendCell(plan, c.id, rows);
    const pass = rows.filter((x) => x.pass).length;
    const errs = rows.filter((x) => x.error).length;
    const ms = Date.now() - t0;
    console.log(`  [${i + 1}/${cells.length}] ${c.id}  ${pass}/${rows.length}  err=${errs}  ${(ms / 1000).toFixed(1)}s`);
  }
  return loadRows(plan);
}

export function report(plan) {
  const rows = loadRows(plan);
  console.log(`\nrows=${rows.length}`);
  for (const s of summarize(rows)) console.log(JSON.stringify(s));
  return rows;
}

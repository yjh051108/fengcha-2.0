// 多步长任务运行器 v2
import fs from "node:fs";
import path from "node:path";
import { LONG_TASKS } from "./longtasks.mjs";
import { callD1, sleep } from "./runner.mjs";

const OUT = "../data";

export async function runLong({ variant, model, effort, taskId, maxTokens = 3000 }) {
  const task = LONG_TASKS.find((t) => t.id === taskId);
  const messages = [];
  if (variant.system) messages.push({ role: "system", content: variant.system });
  const steps = [];
  for (let i = 0; i < task.steps; i++) {
    messages.push({ role: "user", content: task.q(i) });
    const res = await callD1({ model, effort, maxTokens, messages });
    if (res.error) {
      steps.push({ step: i + 1, pass: false, reason: "api_error:" + res.error.slice(0, 120), content: "" });
      break;
    }
    const content = res.content ?? "";
    const g = task.grade(content, i);
    steps.push({
      step: i + 1,
      pass: !!g.pass,
      reason: g.reason,
      content: content.slice(0, 300),
      contentLen: content.length,
      reasoningLen: (res.reasoning ?? "").length,
      finish: res.finish,
    });
    messages.push({ role: "assistant", content });
    await sleep(100);
  }
  return { taskId, variant: variant.id, model, effort: effort ?? "default", steps };
}

export function longSummary(runs) {
  const out = [];
  for (const r of runs) {
    const n = r.steps.length;
    const pass = r.steps.filter((s) => s.pass).length;
    const mid = Math.floor(n / 2);
    const rate = (a) => (a.length ? a.filter((s) => s.pass).length / a.length : null);
    const f = rate(r.steps.slice(0, mid));
    const s = rate(r.steps.slice(mid));
    out.push({
      key: `${r.variant}|${r.model}|${r.effort}|${r.taskId}`,
      n,
      pass,
      overall: +(pass / n).toFixed(3),
      firstHalf: f === null ? null : +f.toFixed(3),
      secondHalf: s === null ? null : +s.toFixed(3),
      decay: f !== null && s !== null ? +(s - f).toFixed(3) : null,
      firstFail: r.steps.find((x) => !x.pass)?.step ?? null,
    });
  }
  return out;
}

export function saveLong(name, runs) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(runs, null, 1));
  return f;
}

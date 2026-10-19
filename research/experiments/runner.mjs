// 能力基准运行器：给定 prompt 变体 × 模型 × effort × 任务 × 重复，产出 pass 率
// 只用 d1 通道
import fs from "node:fs";
import path from "node:path";
import { TASKS } from "./tasks.mjs";
import { HARD } from "./hard.mjs";
import { grade } from "./grade.mjs";

const REGISTRY = new Map([...TASKS, ...HARD].map((t) => [t.id, t]));

const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";
const WORK = "..";
const OUT = path.join(WORK, "results");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callD1({ model, system, user, effort, maxTokens = 4000, temperature, messages: prebuilt }) {
  const messages = prebuilt ? [...prebuilt] : [];
  if (!prebuilt) {
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
  }
  const body = { model, messages, max_tokens: maxTokens };
  if (effort) body.reasoning_effort = effort;
  if (temperature !== undefined) body.temperature = temperature;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
      });
      if (r.status === 429 || r.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const j = await r.json();
      if (!r.ok) return { error: `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 300)}` };
      const msg = j.choices?.[0]?.message ?? {};
      const content = msg.content ?? "";
      const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
      return {
        content,
        reasoning,
        finish: j.choices?.[0]?.finish_reason,
        usage: j.usage,
        model: j.model,
      };
    } catch (e) {
      await sleep(2000 * (attempt + 1));
      if (attempt === 4) return { error: String(e.message ?? e) };
    }
  }
  return { error: "exhausted retries" };
}

export async function runCell({ variant, model, effort, taskIds, reps = 1, maxTokens = 4000, concurrency = 4 }) {
  const tasks = taskIds.map((id) => REGISTRY.get(id)).filter(Boolean);
  const jobs = [];
  for (const t of tasks) for (let r = 0; r < reps; r++) jobs.push({ t, r });

  const rows = [];
  let idx = 0;
  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const { t, r } = jobs[my];
      const res = await callD1({
        model,
        system: variant.system,
        user: t.q,
        effort,
        maxTokens,
      });
      let pass = false,
        detail = "";
      if (res.error) detail = res.error;
      else {
        const g = grade(t, res.content, WORK);
        pass = !!g.pass;
        detail = typeof g.parsed === "string" ? g.parsed.slice(0, 200) : JSON.stringify(g.parsed);
      }
      rows.push({
        variantId: variant.id,
        model,
        effort: effort ?? "default",
        taskId: t.id,
        kind: t.kind,
        rep: r,
        pass,
        detail,
        finish: res.finish,
        contentLen: (res.content ?? "").length,
        reasoningLen: (res.reasoning ?? "").length,
        reasoningHead: (res.reasoning ?? "").slice(0, 200),
        error: res.error ?? null,
      });
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows;
}

export function summarize(rows) {
  const by = {};
  for (const r of rows) {
    const k = `${r.variantId}|${r.model}|${r.effort}`;
    (by[k] ??= []).push(r);
  }
  const out = [];
  for (const [k, v] of Object.entries(by)) {
    const n = v.length;
    const pass = v.filter((x) => x.pass).length;
    const byKind = {};
    for (const r of v) {
      (byKind[r.kind] ??= []).push(r.pass);
    }
    const kinds = {};
    for (const [kk, vv] of Object.entries(byKind)) kinds[kk] = +(vv.filter(Boolean).length / vv.length).toFixed(3);
    out.push({
      key: k,
      n,
      pass,
      rate: +(pass / n).toFixed(4),
      byKind: kinds,
      meanContentLen: Math.round(v.reduce((s, x) => s + x.contentLen, 0) / n),
      meanReasoningLen: Math.round(v.reduce((s, x) => s + x.reasoningLen, 0) / n),
      errors: v.filter((x) => x.error).length,
    });
  }
  return out.sort((a, b) => b.rate - a.rate);
}

export function save(name, rows) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify(rows, null, 1));
  return f;
}

// 用正确字段 prompt_cache_hit_tokens 精确测三种位置的缓存代价
import fs from "node:fs";

const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";
const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;
const RC = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";

async function call(messages) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", messages, max_tokens: 20, tools: TOOLS }),
  });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const j = await r.json();
  const u = j.usage ?? {};
  const prompt = u.prompt_tokens ?? 0;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  return { prompt, hit, miss: prompt - hit, hitRate: prompt ? hit / prompt : 0 };
}

const SYS = { role: "system", content: REAL_SYS };
const TASK_A = "用 Python 写一个函数，判断整数是否为质数。输出代码。";
const TASK_B = "用 Python 写一个函数，计算斐波那契第 n 项。输出代码。";

// 变体构造：给定任务文本
function build(pos, task) {
  switch (pos) {
    case "P4_none": return [SYS, { role: "user", content: task }];
    case "P1_before": return [SYS, { role: "user", content: RC + ANCHOR }, { role: "user", content: task }];
    case "P2_after": return [SYS, { role: "user", content: task }, { role: "user", content: RC + ANCHOR }];
    case "P3_tail": return [SYS, { role: "user", content: `${task}\n\n${RC}${ANCHOR}` }];
    case "P3_head": return [SYS, { role: "user", content: `${RC}${ANCHOR}\n\n${task}` }];
    case "P0_sys": return [{ role: "system", content: `${REAL_SYS}\n\n${ANCHOR}` }, { role: "user", content: task }];
  }
}

const POS = ["P4_none", "P0_sys", "P1_before", "P2_after", "P3_head", "P3_tail"];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log("=== 每位置：先打一次建立缓存，再打同一任务（测命中），再换任务（测跨任务命中）===\n");
const out = {};
for (const pos of POS) {
  // 建立缓存（用 TASK_A）
  await call(build(pos, TASK_A));
  await sleep(350);
  // 同任务再打
  const same = await call(build(pos, TASK_A));
  await sleep(350);
  // 换任务
  const diff = await call(build(pos, TASK_B));
  await sleep(350);
  out[pos] = { same, diff };
  console.log(`${pos.padEnd(12)} 同任务: prompt=${String(same.prompt).padStart(5)} hit=${String(same.hit).padStart(5)} (${(100*same.hitRate).toFixed(1)}%)   换任务: prompt=${String(diff.prompt).padStart(5)} hit=${String(diff.hit).padStart(5)} (${(100*diff.hitRate).toFixed(1)}%)`);
}

fs.writeFileSync("./capbench/results/cache-real.json", JSON.stringify(out, null, 1));

console.log("\n" + "=".repeat(92));
console.log("缓存命中对比（多轮对话场景下，每轮用户消息都不同）");
console.log("=".repeat(92));
const base = out["P4_none"].diff;
console.log("位置".padEnd(14), "换任务时 hit".padEnd(14), "hit率".padEnd(9), "相对无锚点多算".padEnd(14), "说明");
for (const pos of POS) {
  const d = out[pos].diff;
  const extra = d.miss - base.miss;
  const note = pos === "P2_after" ? "锚点是最后一条，前缀可缓存" :
    pos === "P3_tail" ? "锚点拼进用户消息尾部" :
    pos === "P1_before" ? "锚点在用户消息之前" :
    pos === "P0_sys" ? "锚点在 system 里" :
    pos === "P3_head" ? "锚点拼进用户消息头部" : "基准";
  console.log(pos.padEnd(14), String(d.hit).padEnd(14), `${(100 * d.hitRate).toFixed(1)}%`.padEnd(9), String(extra).padEnd(14), note);
}

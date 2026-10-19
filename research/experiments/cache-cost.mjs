// 缓存破坏量测算
// 关键：缓存按「前缀 token」逐字节匹配。锚点拼进用户消息尾部时，
//       消息序列里 system + tools 仍在前，用户消息是最后一段。
//       ⇒ 破坏的只是「用户消息这一条」，不是整个 13k。
//
// 要算清楚三件事：
//   1. 用户消息本身有多少 token（这部分会 miss）
//   2. 锚点加了多少 token
//   3. 锚点造成的「每轮都不同」有多严重 —— 取决于用户消息内容变不变
//
// 用 d1 的 usage.prompt_tokens_details.cached_tokens 实测缓存命中
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;
const RC_PREFIX = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";

const TASK = "用 Python 写一个函数，判断整数是否为二阶魔方状态。输出代码。";
const TASK2 = "用 Python 写一个函数，计算斐波那契数列的第 n 项。输出代码。";

async function call(messages, tag) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", messages, max_tokens: 800, reasoning_effort: "max", tools: TOOLS }),
  });
  if (!r.ok) return { tag, error: `HTTP ${r.status}` };
  const j = await r.json();
  const u = j.usage ?? {};
  return {
    tag,
    prompt: u.prompt_tokens,
    cached: u.prompt_tokens_details?.cached_tokens ?? 0,
    completion: u.completion_tokens,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

const SYS = { role: "system", content: REAL_SYS };

// 各种位置的消息
const variants = {
  "P4_none": [SYS, { role: "user", content: TASK }],
  "P1_before": [SYS, { role: "user", content: RC_PREFIX + ANCHOR }, { role: "user", content: TASK }],
  "P2_after": [SYS, { role: "user", content: TASK }, { role: "user", content: RC_PREFIX + ANCHOR }],
  "P3_inside_tail": [SYS, { role: "user", content: `${TASK}\n\n${RC_PREFIX}${ANCHOR}` }],
};

console.log("=== 第一轮（冷启动，同一条内容连打两次看缓存）===\n");
const results = [];
for (const [name, msgs] of Object.entries(variants)) {
  // 每条打两次：第一次建立缓存，第二次命中
  const a = await call(msgs, name + "#1");
  await new Promise(r => setTimeout(r, 500));
  const b = await call(msgs, name + "#2");
  results.push(a, b);
  console.log(`${name.padEnd(16)} #1 prompt=${String(a.prompt).padStart(5)} cached=${String(a.cached).padStart(5)}   #2 prompt=${String(b.prompt).padStart(5)} cached=${String(b.cached).padStart(5)}`);
}

// 第二轮：换一个不同的问题，测「用户消息变了」时缓存还剩多少
console.log("\n=== 第二轮（换问题，测用户消息变化时的缓存保留）===\n");
const results2 = [];
for (const [name, msgs] of Object.entries(variants)) {
  const msgs2 = JSON.parse(JSON.stringify(msgs));
  // 把最后一条 user 里的问题换掉
  const last = msgs2[msgs2.length - 1];
  last.content = last.content.replace(TASK, TASK2);
  const c = await call(msgs2, name + "#change");
  results2.push(c);
  const first = results.find(r => r.tag === name + "#2");
  console.log(`${name.padEnd(16)} prompt=${String(c.prompt).padStart(5)} cached=${String(c.cached).padStart(5)}   （上轮同内容 cached=${String(first?.cached).padStart(5)}）`);
}

// 第三轮：锚点内容变一个字，测「锚点自身变化」的代价
console.log("\n=== 第三轮（锚点内容变一个词，测锚点变化代价）===\n");
const ANCHOR2 = ANCHOR.replace("We open every", "We begin every");
for (const name of ["P1_before", "P2_after", "P3_inside_tail"]) {
  const msgs = JSON.parse(JSON.stringify(variants[name]));
  // 替换锚点
  for (const m of msgs) if (m.content.includes(ANCHOR)) m.content = m.content.replace(ANCHOR, ANCHOR2);
  const d = await call(msgs, name + "#anchorchange");
  const base = results.find(r => r.tag === name + "#2");
  console.log(`${name.padEnd(16)} prompt=${String(d.prompt).padStart(5)} cached=${String(d.cached).padStart(5)}   （锚点未变时 cached=${String(base?.cached).padStart(5)}）`);
}

fs.writeFileSync("./capbench/results/cache-cost.json", JSON.stringify({ results, results2 }, null, 1));

// ── 汇总 ──────────────────────────────────────────────────────
console.log("\n" + "=".repeat(80));
console.log("缓存成本汇总");
console.log("=".repeat(80));
const get = (tag) => results.find(r => r.tag === tag) ?? {};
for (const name of Object.keys(variants)) {
  const a = get(name + "#1"), b = get(name + "#2");
  const miss = (b.prompt ?? 0) - (b.cached ?? 0);
  const hitRate = b.prompt ? (100 * (b.cached ?? 0)) / b.prompt : 0;
  console.log(`  ${name.padEnd(16)} prompt=${b.prompt}  cached=${b.cached}  命中率=${hitRate.toFixed(1)}%  实际计算=${miss} token`);
}

console.log("\n=== 各变体相对「无锚点」多算多少 token ===");
const base = get("P4_none#2");
for (const name of Object.keys(variants)) {
  const b = get(name + "#2");
  const extra = (b.prompt - (b.cached ?? 0)) - (base.prompt - (base.cached ?? 0));
  console.log(`  ${name.padEnd(16)} 多算 ${String(extra).padStart(5)} token  （锚点裸长度 ${String((RC_PREFIX + ANCHOR).length).padStart(4)} 字符）`);
}

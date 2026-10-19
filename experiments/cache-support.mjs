// 确认 d1 是否支持 prompt caching（决定我们能不能用实测说话）
// 若支持：快速连打相同前缀，应出现 cached_tokens > 0
import fs from "node:fs";

const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";
const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

async function call(messages, tag) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", messages, max_tokens: 20, tools: TOOLS }),
  });
  if (!r.ok) return { tag, error: `HTTP ${r.status}` };
  const j = await r.json();
  const u = j.usage ?? {};
  return {
    tag,
    prompt: u.prompt_tokens,
    cached: u.prompt_tokens_details?.cached_tokens ?? 0,
    details: u.prompt_tokens_details,
    raw: JSON.stringify(u).slice(0, 200),
  };
}

const SYS = { role: "system", content: REAL_SYS };
const msgs = [SYS, { role: "user", content: "What is 2+2? Answer with one number." }];

console.log("=== 连打 6 次完全相同请求（间隔 200ms），看 cached_tokens ===");
for (let i = 0; i < 6; i++) {
  const r = await call(msgs, `run${i}`);
  console.log(`  #${i}  prompt=${r.prompt}  cached=${r.cached}  details=${JSON.stringify(r.details)}`);
  await new Promise(x => setTimeout(x, 200));
}

console.log("\n=== 同一前缀、不同尾部问题（各打 2 次）===");
for (const q of ["What is 3+3?", "What is 4+4?", "What is 3+3?"]) {
  const r = await call([SYS, { role: "user", content: q }], q);
  console.log(`  "${q}"  prompt=${r.prompt}  cached=${r.cached}`);
  await new Promise(x => setTimeout(x, 200));
}

// 对照：短 system（看看是不是长 prompt 才触发缓存）
console.log("\n=== 对照：短 system 的重复请求 ===");
const SHORT = { role: "system", content: "You are a helpful assistant." };
for (let i = 0; i < 3; i++) {
  const r = await call([SHORT, { role: "user", content: "What is 2+2? Answer with one number." }], `short${i}`);
  console.log(`  #${i}  prompt=${r.prompt}  cached=${r.cached}`);
  await new Promise(x => setTimeout(x, 200));
}

// 看看 usage 对象里到底有什么字段
console.log("\n=== usage 完整结构（最后一次）===");
const r = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: msgs, max_tokens: 20, tools: TOOLS }),
});
const j = await r.json();
console.log(JSON.stringify(j.usage, null, 1));

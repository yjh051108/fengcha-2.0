// 真实会话改造实验：拿"全程 Let me"的真实长会话当底座，只改锚点
// 这是真正的长程疲劳测试 —— 上下文里已经有几十上百个真实 Let me 的 reasoning 块
//
// 设计：
//   底座 = 真实会话的 wire（system + 真实历史 + skill/time）
//   变量 = 末尾锚点怎么加
//
// 变体：
//   B0 原样（不加锚点）—— 基线，应该还是 Let me
//   B1 末尾加一次完整锚点（现状做法）
//   B2 末尾加锚点 + 开头也加（头尾）
//   B3 末尾加锚点，且把所有历史 reasoning 里的 Let me/I 改写成 We（"清洗历史"）
//   B4 历史末尾追加一条 assistant 的 We 示范（few-shot）
//
// 判据：最后一条 reasoning 的语域（只统计 reasoning）
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));
const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;
const RC = "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n";

// 从真实会话提取 wire（真用户消息 + assistant content，不含 reasoning）
function extractWire(sidPart) {
  for (const k of Object.keys(RAW)) {
    const ev = RAW[k]?.events;
    if (!Array.isArray(ev)) continue;
    const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
    if (!sid.includes(sidPart)) continue;
    const wire = [];
    for (const e of ev) {
      if (e.type === "user/message" && !e.data?.source?.kind) {
        const txt = (Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join("");
        if (txt.trim()) wire.push({ role: "user", content: txt });
      }
      if (e.type === "assistant/message") {
        const c = e.data?.message?.content ?? e.data?.content;
        if (!Array.isArray(c)) continue;
        const txt = c.filter(x => x.type === "text").map(x => x.text ?? "").join("\n");
        if (txt.trim()) wire.push({ role: "assistant", content: txt });
      }
    }
    return { sid, wire, events: ev.length };
  }
  return null;
}

// 选几个不同大小的底座
const bases = ["3641a1f4", "9555b90a", "b4fc7bcb"].map(extractWire).filter(Boolean);
for (const b of bases) console.log(`底座 ${b.sid.slice(0, 24)}: wire ${b.wire.length} 条消息`);

// 取每个底座最后 N 条历史（控制长度）
function trimHistory(wire, maxMsgs) {
  const h = wire.slice(-maxMsgs);
  // 保证最后一条是 assistant（这样下一轮才是新 user）
  return h;
}

// 构造实验消息
function buildMessages(wire, variant) {
  const msgs = [{ role: "system", content: REAL_SYS }];
  // 历史
  const hist = trimHistory(wire, 40);
  for (const m of hist) msgs.push(m);

  switch (variant) {
    case "B0_none":
      break;
    case "B1_tail":
      msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
      break;
    case "B2_head_tail":
      msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
      // 头尾：头放在历史之前
      msgs.splice(1, 0, { role: "user", content: `${RC}${ANCHOR}` });
      break;
    case "B3_clean_history": {
      // 把历史 assistant 内容里的 Let me/I 改写成 We（模拟"清洗"）
      const cleaned = msgs.map(m => {
        if (m.role !== "assistant") return m;
        return { ...m, content: m.content.replace(/\bLet me\b/g, "We need to").replace(/\bI'll\b/g, "We'll").replace(/\bI\b/g, "we") };
      });
      cleaned.push({ role: "user", content: `${RC}${ANCHOR}` });
      return cleaned;
    }
    case "B4_demo": {
      // 在历史后加一条 We 示范 assistant 消息
      msgs.push({ role: "assistant", content: "We need to keep working on this. We'll take the next step." });
      msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
      break;
    }
    case "B5_tail_twice":
      msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
      msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
      break;
  }

  // 新的一轮用户消息（让模型继续工作）
  msgs.push({ role: "user", content: "继续。接下来这一步我们/我该做什么？简短回答。" });
  return msgs;
}

const VARIANTS = ["B0_none", "B1_tail", "B2_head_tail", "B3_clean_history", "B4_demo", "B5_tail_twice"];

function strip(t) { return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " "); }
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length + (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

const jobs = [];
for (const b of bases) {
  for (const v of VARIANTS) {
    for (let r = 0; r < 2; r++) {
      jobs.push({ base: b.sid.slice(0, 20), variant: v, rep: r, messages: buildMessages(b.wire, v) });
    }
  }
}
console.log(`\n任务 ${jobs.length} = ${bases.length} 底座 × ${VARIANTS.length} 变体 × 2 次`);
console.log("消息长度示例:", buildMessages(bases[0].wire, "B1_tail").length, "条");

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        try {
          const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: j.messages, max_tokens: 2000, reasoning_effort: "max", tools: TOOLS }) });
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 2000 * (a + 1))); continue; }
          if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; ok = true; break; }
          const jj = await r.json(); const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { reasoning: m.reasoning_content ?? m.reasoning ?? "", content: m.content ?? "" } }; ok = true;
        } catch { if (a === 2) { out[my] = { ...j, res: { error: "net" } }; ok = true; } else await new Promise(x => setTimeout(x, 1500)); }
      }
      if (++done % 6 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: 20 }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return { base: r.base, variant: r.variant, rep: r.rep, col, ind, ratio: tot ? col / tot : null, len: reason.length, error: r.res?.error ?? null, head: reason.trim().slice(0, 80) };
});
fs.writeFileSync("./capbench/results/real-base-anchor.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(80));
console.log("真实 Let-me 底座 + 锚点变体 → 新 reasoning 语域");
console.log("=".repeat(80));
console.log("变体".padEnd(20), "纯We率".padEnd(10), "均We占比".padEnd(11), "n");
for (const v of VARIANTS) {
  const sub = ok.filter(r => r.variant === v && r.ratio !== null);
  if (!sub.length) continue;
  const we = sub.filter(r => r.ratio >= 0.85).length;
  const avg = sub.reduce((a, r) => a + r.ratio, 0) / sub.length;
  const label = v === "B0_none" ? "不加锚点" : v === "B1_tail" ? "末尾锚点(现状)" : v === "B2_head_tail" ? "头尾各一份" : v === "B3_clean_history" ? "清洗历史+锚点" : v === "B4_demo" ? "示范消息+锚点" : "末尾锚点×2";
  console.log(v.padEnd(20), `${((100 * we) / sub.length).toFixed(0)}%`.padEnd(10), avg.toFixed(3).padEnd(11), sub.length);
  console.log(`  → ${label}`);
}

console.log("\n=== 样本（B0 vs B1）===");
for (const v of ["B0_none", "B1_tail"]) {
  const s = ok.filter(r => r.variant === v).slice(0, 2);
  for (const r of s) console.log(`  [${v}] ratio=${r.ratio?.toFixed(2)} ${r.head}`);
}

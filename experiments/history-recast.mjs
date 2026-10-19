// 「历史重铸」实验：把历史里所有 Let me → We need to
// 用户想法：不靠锚点指令，直接把模型看到的"过去"改写成 We，让它以为一直都是 We
//
// 变体：
//   H0 原样（基线）
//   H1 只重铸 reasoning（但 reasoning 一般不进 wire，这里模拟"若进"）
//   H2 重铸 assistant content
//   H3 重铸 assistant content + user 内容
//   H4 重铸 assistant content，但只改 "Let me"（不动 I）
//   H5 重铸 assistant content，并且同时加锚点
//
// 关键：真实会话的 assistant content 里到底有多少 Let me / I？
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
    return { sid, wire };
  }
  return null;
}

const bases = ["3641a1f4", "9555b90a", "b4fc7bcb"].map(extractWire).filter(Boolean);

// 先统计：真实 wire 里 assistant content 有多少 Let me / I
console.log("=== 底座勘察：assistant content 里的第一人称 ===");
for (const b of bases) {
  const asst = b.wire.filter(m => m.role === "assistant");
  const text = asst.map(m => m.content).join("\n");
  const letme = (text.match(/\bLet me\b/gi) ?? []).length;
  const ills = (text.match(/\bI'll\b/gi) ?? []).length;
  const ising = (text.match(/\bI\b(?!['’])/g) ?? []).length;
  const my = (text.match(/\bMy\b/gi) ?? []).length;
  console.log(`  ${b.sid.slice(0, 22)}: wire=${b.wire.length}条 assistant=${asst.length}条  内容${text.length}字`);
  console.log(`    Let me=${letme}  I'll=${ills}  I=${ising}  My=${my}`);
}

// 重铸函数
function rewrite(text, mode) {
  if (mode === "letme_only") {
    return text.replace(/\bLet me\b/gi, "We need to");
  }
  if (mode === "full") {
    return text
      .replace(/\bLet me\b/gi, "We need to")
      .replace(/\bLet's\b/gi, "We")
      .replace(/\bI'll\b/gi, "We'll")
      .replace(/\bI'm\b/gi, "We're")
      .replace(/\bI've\b/gi, "We've")
      .replace(/\bI\b(?!['’])/g, "we")
      .replace(/\bMy\b/gi, "Our")
      .replace(/\bmy\b/g, "our");
  }
  if (mode === "aggressive") {
    // 连 user 内容里的也改（会破坏语义，看会怎样）
    return text
      .replace(/\bLet me\b/gi, "We need to")
      .replace(/\bI'll\b/gi, "We'll")
      .replace(/\bI'm\b/gi, "We're")
      .replace(/\bI've\b/gi, "We've")
      .replace(/\bI\b(?!['’])/g, "we")
      .replace(/\bMy\b/gi, "Our");
  }
  return text;
}

function buildMessages(wire, variant) {
  const msgs = [{ role: "system", content: REAL_SYS }];
  const hist = wire.slice(-40);

  let processed = hist.map(m => ({ ...m }));
  switch (variant) {
    case "H0_none":
      break;
    case "H1_letme_only":
      processed = processed.map(m => m.role === "assistant" ? { ...m, content: rewrite(m.content, "letme_only") } : m);
      break;
    case "H2_full":
      processed = processed.map(m => m.role === "assistant" ? { ...m, content: rewrite(m.content, "full") } : m);
      break;
    case "H3_aggressive":
      processed = processed.map(m => ({ ...m, content: rewrite(m.content, "aggressive") }));
      break;
    case "H4_full_plus_anchor":
      processed = processed.map(m => m.role === "assistant" ? { ...m, content: rewrite(m.content, "full") } : m);
      break;
  }

  msgs.push(...processed);
  if (variant === "H4_full_plus_anchor" || variant === "H5_anchor_only") {
    msgs.push({ role: "user", content: `${RC}${ANCHOR}` });
  }
  msgs.push({ role: "user", content: "继续。接下来这一步该做什么？简短回答。" });
  return msgs;
}

const VARIANTS = ["H0_none", "H1_letme_only", "H2_full", "H3_aggressive", "H4_full_plus_anchor", "H5_anchor_only"];

function strip(t) { return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " "); }
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length + (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}

const jobs = [];
for (const b of bases) for (const v of VARIANTS) for (let r = 0; r < 3; r++)
  jobs.push({ base: b.sid.slice(0, 18), variant: v, rep: r, messages: buildMessages(b.wire, v) });

console.log(`\n任务 ${jobs.length} = ${bases.length} 底座 × ${VARIANTS.length} 变体 × 3 次`);

// 先看一个重铸样例
const sample = buildMessages(bases[0].wire, "H2_full");
const sampleAsst = sample.filter(m => m.role === "assistant").slice(0, 2);
console.log("\n=== 重铸样例（H2_full）===");
for (const m of sampleAsst) console.log(`  → ${m.content.slice(0, 120).replace(/\n/g, " ")}`);

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
  return { base: r.base, variant: r.variant, rep: r.rep, col, ind, ratio: tot ? col / tot : null, len: reason.length, error: r.res?.error ?? null, head: reason.trim().slice(0, 70) };
});
fs.writeFileSync("./capbench/results/history-recast.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`有效 ${ok.length}/${rows.length}`);
console.log("\n" + "=".repeat(84));
console.log("历史重铸 → 新 reasoning 语域");
console.log("=".repeat(84));
console.log("变体".padEnd(24), "纯We率".padEnd(10), "均We占比".padEnd(11), "n");
for (const v of VARIANTS) {
  const sub = ok.filter(r => r.variant === v && r.ratio !== null);
  if (!sub.length) continue;
  const we = sub.filter(r => r.ratio >= 0.85).length;
  const avg = sub.reduce((a, r) => a + r.ratio, 0) / sub.length;
  const label = { H0_none: "原样", H1_letme_only: "只改 Let me→We need to", H2_full: "全量重铸", H3_aggressive: "连 user 也改", H4_full_plus_anchor: "全量重铸+锚点", H5_anchor_only: "只加锚点" }[v];
  console.log(v.padEnd(24), `${((100 * we) / sub.length).toFixed(0)}%`.padEnd(10), avg.toFixed(3).padEnd(11), sub.length);
  console.log(`  → ${label}`);
}

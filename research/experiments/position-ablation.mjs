// 位置消融：锚点放在哪里最近场？
// 用户问题：能不能放到「用户消息后面」作为最近场引导？
//
// 关键：消息顺序决定注意力权重。候选位置（从远到近）：
//   P0 system 末尾（内嵌）
//   P1 user 之前（runtime-context 作为独立 user 消息，当前 preset 的做法）
//   P2 user 之后（锚点紧跟在用户问题后面，全 wire 最后一条消息）← 用户想要的位置
//   P3 user 内部末尾（拼进同一条 user 消息的尾部，真·最近场）
//   P4 完全没有锚点（对照）
//
// 判据：reasoning 的纯 We 率 / 均 We 占比 / 首中尾密度（严格只算 reasoning）
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const REAL_SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8").trim();
const RAW_TOOLS = JSON.parse(fs.readFileSync(`${BASE}/real-tools.json`, "utf8"));
const TOOLS = RAW_TOOLS.map((t) => (t.type === "function" ? t : { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
const KEY = process.env.D1_API_KEY ?? "";
const URL = "https://d1api.xin/v1/chat/completions";

const ANCHOR = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. Every paragraph must begin with "We" or "Our". This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;

const TASKS = [
  "用 Python 写一个函数，判断整数是否为质数。输出代码。",
  "分析这段代码的复杂度：for i in range(n): for j in range(i, n): s += a[j]",
  "设计一个简单的限流器，说明你的选择和理由。",
  "这段 SQL 为什么可能返回错误结果？SELECT * FROM t WHERE a != NULL;",
  "用 Python 写一个函数，把嵌套列表展平。输出代码。",
  "这段代码有什么并发问题？\n```js\nlet n = 0;\nasync function inc(){ const v = n; await tick(); n = v + 1; }\n```",
];

// 构造不同位置的 messages
function buildMessages(pos, task) {
  const SYS = { role: "system", content: REAL_SYS };
  const RC_WRAP = (a) => `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${a}`;
  switch (pos) {
    case "P0_sys_tail":
      return [{ role: "system", content: `${REAL_SYS}\n\n${ANCHOR}` }, { role: "user", content: task }];
    case "P1_before_user":
      return [SYS, { role: "user", content: RC_WRAP(ANCHOR) }, { role: "user", content: task }];
    case "P2_after_user":
      return [SYS, { role: "user", content: task }, { role: "user", content: RC_WRAP(ANCHOR) }];
    case "P3_inside_user_tail":
      return [SYS, { role: "user", content: `${task}\n\n${RC_WRAP(ANCHOR)}` }];
    case "P3b_inside_user_head":
      return [SYS, { role: "user", content: `${RC_WRAP(ANCHOR)}\n\n${task}` }];
    case "P4_none":
      return [SYS, { role: "user", content: task }];
    default:
      throw new Error("unknown pos");
  }
}

const REPS = 3;
const CONCURRENCY = 100;
const POSITIONS = ["P0_sys_tail", "P1_before_user", "P2_after_user", "P3_inside_user_tail", "P3b_inside_user_head", "P4_none"];

const jobs = [];
for (const pos of POSITIONS) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      jobs.push({ pos, task: t.slice(0, 16), rep: r, messages: buildMessages(pos, t) });
    }
  }
}
console.log(`任务 ${jobs.length}  effort=max  并发=${CONCURRENCY}  位置=${POSITIONS.length} × 任务=${TASKS.length} × reps=${REPS}`);

async function runAll() {
  const out = new Array(jobs.length);
  let idx = 0, done = 0;
  async function w() {
    while (true) {
      const my = idx++;
      if (my >= jobs.length) return;
      const j = jobs[my];
      let placed = false;
      for (let attempt = 0; attempt < 3 && !placed; attempt++) {
        try {
          const r = await fetch(URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
            body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: j.messages, max_tokens: 4000, reasoning_effort: "max", tools: TOOLS }),
          });
          if (r.status === 429 || r.status >= 500) { await new Promise(x => setTimeout(x, 1200 * (attempt + 1))); continue; }
          if (!r.ok) { out[my] = { ...j, res: { error: `HTTP ${r.status}` } }; placed = true; break; }
          const jj = await r.json();
          const m = jj.choices?.[0]?.message ?? {};
          out[my] = { ...j, res: { content: m.content ?? "", reasoning: m.reasoning_content ?? m.reasoning ?? "", finish: jj.choices?.[0]?.finish_reason } };
          placed = true;
        } catch (e) {
          if (attempt === 2) { out[my] = { ...j, res: { error: String(e) } }; placed = true; }
          else await new Promise(x => setTimeout(x, 1200));
        }
      }
      if (++done % 12 === 0) process.stdout.write(`    ${done}/${jobs.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, w));
  return out;
}

const t0 = Date.now();
const results = await runAll();
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ── 严格分析：只算 reasoning ──────────────────────────────────
function strip(t) {
  return String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
}
function colInd(t) {
  const s = strip(t);
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length +
    (s.match(/\bUs\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length +
    (s.match(/\bI(?:'m|'ll|'ve|'d)\b/g) ?? []).length + (s.match(/\bMy\b/g) ?? []).length;
  return { col, ind };
}
function sentProfile(t) {
  const s = strip(t);
  const sents = s.split(/(?<=[.!?:])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 12);
  if (sents.length < 3) return null;
  const n = sents.length;
  const bins = [[], [], []];
  sents.forEach((sent, i) => {
    const { col, ind } = colInd(sent);
    const tot = col + ind;
    if (tot === 0) return;
    bins[Math.min(2, Math.floor((i / n) * 3))].push(col / tot);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { b1: avg(bins[0]), b2: avg(bins[1]), b3: avg(bins[2]) };
}

const rows = results.map(r => {
  const reason = r.res?.reasoning ?? "";
  const content = r.res?.content ?? "";
  const { col, ind } = colInd(reason);
  const tot = col + ind;
  return {
    pos: r.pos, task: r.task, rep: r.rep,
    // 只统计 reasoning
    reasonCol: col, reasonInd: ind, reasonRatio: tot ? col / tot : null,
    reasonLen: reason.length,
    // content 单独记（不进 We 统计）
    contentLen: content.length,
    prof: sentProfile(reason),
    head: reason.trim().slice(0, 70),
    error: r.res?.error ?? null,
  };
});
fs.writeFileSync("./capbench/results/position-ablation.json", JSON.stringify(rows, null, 1));

const ok = rows.filter(r => !r.error);
console.log(`\n有效 ${ok.length}/${rows.length}`);

console.log("\n" + "=".repeat(100));
console.log("锚点位置消融（只统计 reasoning · 真实 wire · effort=max · 100 并发）");
console.log("=".repeat(100));
console.log("位置".padEnd(22), "纯We率".padEnd(9), "均We占比".padEnd(10), "首/中/尾".padEnd(20), "reason长".padEnd(9), "(content长)");
for (const pos of POSITIONS) {
  const sub = ok.filter(r => r.pos === pos);
  if (!sub.length) { console.log(`${pos.padEnd(22)} (no data)`); continue; }
  const withR = sub.filter(r => r.reasonRatio !== null);
  const we = withR.filter(r => r.reasonRatio >= 0.85).length;
  const avgR = withR.length ? withR.reduce((a, r) => a + r.reasonRatio, 0) / withR.length : 0;
  const profs = sub.map(r => r.prof).filter(Boolean);
  const avg = (k) => profs.length ? profs.reduce((a, p) => a + (p[k] ?? 0), 0) / profs.length : null;
  const avgLen = Math.round(sub.reduce((a, r) => a + r.reasonLen, 0) / sub.length);
  const avgC = Math.round(sub.reduce((a, r) => a + r.contentLen, 0) / sub.length);
  console.log(
    pos.padEnd(22),
    `${((100 * we) / Math.max(1, withR.length)).toFixed(0)}%`.padEnd(9),
    avgR.toFixed(3).padEnd(10),
    `${avg("b1")?.toFixed(2) ?? "-"}/${avg("b2")?.toFixed(2) ?? "-"}/${avg("b3")?.toFixed(2) ?? "-"}`.padEnd(20),
    String(avgLen).padEnd(9),
    `(${avgC})`
  );
}

console.log("\n=== 排序（按均 We 占比）===");
const ranked = POSITIONS.map(pos => {
  const sub = ok.filter(r => r.pos === pos && r.reasonRatio !== null);
  const avg = sub.length ? sub.reduce((a, r) => a + r.reasonRatio, 0) / sub.length : 0;
  const we = sub.filter(r => r.reasonRatio >= 0.85).length;
  return { pos, avg, weRate: sub.length ? we / sub.length : 0, n: sub.length };
}).sort((a, b) => b.avg - a.avg);
for (const r of ranked) console.log(`  ${r.pos.padEnd(22)} 均占比=${r.avg.toFixed(3)}  纯We=${(100 * r.weRate).toFixed(0)}%  n=${r.n}`);

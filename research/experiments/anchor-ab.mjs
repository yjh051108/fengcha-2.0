// 锚点文本 A/B：按真实 wire 位置测（runtime-context 是追加在 user 之后的独立消息）
// 验证目标：
//   1. 汇报语言是否切回中文（主目标）
//   2. 首块是否仍以 We 开头（不能牺牲路由）
//   3. 技术实体是否保留原样（不能开始翻译变量名）
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const ANCHORS = {
  V0_current: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`,

  V1_zh_min: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.

When reporting to the user, write in Chinese.`,

  V2_zh_entities: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.

When reporting to the user, write in Chinese (中文). Keep code, identifiers, file paths, and command lines verbatim — never translate them.`,

  V3_zh_first: `当向用户汇报时，请用中文书写。代码、标识符、文件路径和命令行保持原样，不要翻译。

We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.`,

  V4_bilingual: `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block.

用户可见的汇报一律用中文。代码、标识符、路径、命令保持原样。`,

  // 对照：完全不放锚点
  NONE: null,
};

const TASKS = [
  { id: "t1_build", q: "用 Python 写一个函数，把嵌套字典里所有 None 值替换成空字符串，递归处理。输出代码。" },
  { id: "t2_inspect", q: "下面这个函数有什么 bug？\n```js\nfunction sum(a){let s=0;for(let i=0;i<=a.length;i++)s+=a[i];return s;}\n```\n请说明问题。" },
  { id: "t3_report", q: "这是一个 Python 项目，结构如下：\n- src/main.py (入口)\n- src/utils.py (工具函数)\n- tests/test_main.py\n- README.md\n请总结这是什么类型的项目，以及你会怎么组织下一步工作。" },
];

const REPS = 3;
const rows = [];

for (const [aid, anchor] of Object.entries(ANCHORS)) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      // 真实位置：user 先，runtime-context 后（独立消息）
      const messages = [{ role: "user", content: t.q }];
      if (anchor) {
        messages.push({
          role: "user",
          content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}`,
        });
      }
      const res = await callD1({
        model: "deepseek-v4.1-flash",
        effort: "low",
        maxTokens: 2500,
        messages,
      }).catch((e) => ({ error: String(e) }));
      rows.push({
        anchor: aid, task: t.id, rep: r,
        content: res?.content ?? "",
        reasoning: res?.reasoning ?? "",
        error: res?.error ?? null,
      });
    }
  }
  process.stdout.write(`  ${aid} `);
}
console.log();

fs.writeFileSync("./capbench/results/anchor-ab.json", JSON.stringify(rows, null, 1));
console.log(`saved ${rows.length} rows`);

// ── 分析 ──────────────────────────────────────────────────────
const cjkN = (s) => (String(s).match(/[\u4e00-\u9fff]/g) ?? []).length;
const latN = (s) => (String(s).match(/[A-Za-z]/g) ?? []).length;
function langBody(s) {
  const c = cjkN(s), l = latN(s);
  if (c + l === 0) return "OTHER";
  return c / (c + l) > 0.5 ? "ZH" : "EN";
}
function headLang(s, n = 40) {
  const t = String(s ?? "").trim().slice(0, n);
  const c = cjkN(t), l = latN(t);
  if (c + l === 0) return "OTHER";
  const r = c / (c + l);
  return r > 0.5 ? "ZH" : r < 0.1 ? "EN" : "MIX";
}
function colInd(t) {
  const s = String(t ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,120}`/g, " ");
  const col = (s.match(/\bWe\b/g) ?? []).length + (s.match(/\bOur\b/g) ?? []).length + (s.match(/\bLet's\b/g) ?? []).length;
  const ind = (s.match(/\bLet me\b/g) ?? []).length + (s.match(/\bI\b(?!['’])/g) ?? []).length;
  return { col, ind };
}

console.log("\n" + "=".repeat(78));
console.log("锚点 A/B 结果（真实 runtime-context 位置）");
console.log("=".repeat(78));
console.log("锚点".padEnd(18), "content中文".padEnd(11), "content首字中文".padEnd(14), "reason首字We".padEnd(13), "reason全英文".padEnd(11), "变量名保留");

for (const aid of Object.keys(ANCHORS)) {
  const sub = rows.filter((r) => r.anchor === aid && !r.error);
  if (!sub.length) { console.log(`${aid.padEnd(18)} (no data)`); continue; }
  const zh = sub.filter((r) => langBody(r.content) === "ZH").length;
  const zhHead = sub.filter((r) => headLang(r.content) === "ZH").length;
  const weHead = sub.filter((r) => /^\s*We\b/i.test(r.reasoning.trim())).length;
  const enReas = sub.filter((r) => langBody(r.reasoning) === "EN").length;
  // 变量名保留：content 里出现 python/sum/a.length 这类原样 token
  const kept = sub.filter((r) => /\b(python|sum|a\.length|None|README|src\/main\.py|def |function )/.test(r.content)).length;
  const f = (x) => `${((100 * x) / sub.length).toFixed(0)}%`;
  console.log(
    aid.padEnd(18),
    f(zh).padEnd(11),
    f(zhHead).padEnd(14),
    f(weHead).padEnd(13),
    f(enReas).padEnd(11),
    f(kept)
  );
}

console.log("\n=== 样本：每个锚点的第一条汇报开头 ===");
for (const aid of Object.keys(ANCHORS)) {
  const r = rows.find((x) => x.anchor === aid && x.task === "t2_inspect" && x.rep === 0);
  if (!r) continue;
  console.log(`\n[${aid}]`);
  console.log(`  content: ${r.content.slice(0, 150).replace(/\n/g, " ⏎ ")}`);
  console.log(`  reasoning 首词: ${r.reasoning.trim().slice(0, 60).replace(/\n/g, " ")}`);
}

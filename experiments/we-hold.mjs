// 目标：能不能让 We 语域「全程不掉」？
// 现状（风插真实会话）：首块 We 78.3% 开头，但整块纯 We 只有 13.0%，第10+块只剩 4.7%
//
// 六种候选约束，从弱到强：
//   C0 现状（基线）
//   C1 段落级：每段以 We 开头
//   C2 句级：每个句子都以 We/Our/Let's 起头
//   C3 禁止式强化：重复禁令 + 给出替代写法示例
//   C4 自检式：写完后自查，若出现 Let me/I 则重写
//   C5 机械式：要求每条 reasoning 以 "We" 开头且以 "We" 结尾（首尾围栏）
//
// 判据：同一任务重复 4 次，测
//   · 整块纯 We 率（不是开头率）
//   · 块内 We 占比
//   · 是否出现质量问题（回答变短/变差）
import { callD1 } from "../runner.mjs";
import fs from "node:fs";

const BASE = `We open every reasoning block with "We need". The whole block stays in the first-person plural: We, Our, Let's. We never write "Let me", "I", "I'll", "I've", or "my" anywhere inside a reasoning block. This holds for inspection work too: when we read, diagnose, or verify, we say "We need to check" rather than "Let me check".`;

const CANDIDATES = {
  C0_base: BASE,

  C1_paragraph: `${BASE}

In addition: every paragraph of the reasoning block must begin with "We" or "Our". If a paragraph would begin with anything else, rewrite that paragraph so it begins with "We".`,

  C2_sentence: `${BASE}

Every sentence in the reasoning block must begin with "We", "Our", or "Let's". Never begin a sentence with "Let me", "I", "The", "This", or a bare verb.`,

  C3_ban_examples: `${BASE}

Prohibited openings (never write these): "Let me", "I'll", "I need", "I should", "Now I", "The". Required openings: "We need", "We should", "We can", "We'll", "Our next step".`,

  C4_selfcheck: `${BASE}

After drafting the reasoning block, check it: if any sentence contains "Let me", "I ", "I'", or "My ", rewrite that sentence in the first-person plural before continuing. Do this check at the end of every reasoning block.`,

  C5_fence: `${BASE}

Structural requirement: the reasoning block must open with a sentence starting "We need" and close with a sentence starting "We". Between those two fences, keep every sentence in the first-person plural.`,
};

const TASKS = [
  { id: "k1", q: "用 Python 写一个函数，找出列表中出现次数最多的元素，若有并列返回全部。输出代码和说明。" },
  { id: "k2", q: "分析这段代码的性能问题并给出优化方案：\n```python\nresult = []\nfor i in range(len(a)):\n    for j in range(len(b)):\n        if a[i] == b[j]: result.append((a[i], j))\n```" },
  { id: "k3", q: "设计一个短链接服务的核心表结构和三个主要接口，说明索引选择和容量估算。" },
  { id: "k4", q: "这段 SQL 为什么慢？怎么改？\n```sql\nSELECT * FROM orders WHERE DATE(created_at) = '2026-01-01' AND status != 'cancelled';\n```" },
];

const REPS = 3;
const rows = [];

for (const [cid, anchor] of Object.entries(CANDIDATES)) {
  for (const t of TASKS) {
    for (let r = 0; r < REPS; r++) {
      const messages = [
        { role: "user", content: t.q },
        {
          role: "user",
          content: `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${anchor}`,
        },
      ];
      const res = await callD1({
        model: "deepseek-v4.1-flash",
        effort: "low",
        maxTokens: 3000,
        messages,
      }).catch((e) => ({ error: String(e) }));
      rows.push({
        candidate: cid, task: t.id, rep: r,
        content: res?.content ?? "",
        reasoning: res?.reasoning ?? "",
        error: res?.error ?? null,
        finish: res?.finish,
      });
    }
  }
  process.stdout.write(` ${cid}`);
}
console.log();

fs.writeFileSync("./capbench/results/we-hold.json", JSON.stringify(rows, null, 1));
console.log(`saved ${rows.length} rows`);

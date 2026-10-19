#!/usr/bin/env node
// 数据脱敏：把实验数据里可能含真实对话/输出原文的字段剥离，仅保留聚合指标
// 处理对象：data/*.json
// 规则：
//   - 删除字段：content / reasoning / head / text / snippet / output / prompt / tail
//   - 保留字段：anchor / variant / pos / sid / task / rep / col / ind / ratio / len /
//               contentLen / reasoningLen / meta / prof / error / finish / promptTokens 等
import fs from "node:fs";
import path from "node:path";

const DIR = process.argv[2] || "data";
const DROP = new Set(["content", "reasoning", "head", "text", "snippet", "output", "prompt", "tail", "raw", "body", "reasoningText"]);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      out[k] = scrub(val);
    }
    return out;
  }
  return v;
}

let total = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
  const p = path.join(DIR, f);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    console.log(`  跳过（非 JSON）: ${f}`);
    continue;
  }
  const before = JSON.stringify(data).length;
  const cleaned = scrub(data);
  const after = JSON.stringify(cleaned).length;
  fs.writeFileSync(p, JSON.stringify(cleaned, null, 1));
  total++;
  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  if (pct > 0) console.log(`  ${f.padEnd(32)} ${before} → ${after}  (-${pct}%)`);
  else console.log(`  ${f.padEnd(32)} 无需处理`);
}
console.log(`\n处理 ${total} 个文件`);

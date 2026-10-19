#!/usr/bin/env node
// 路径去本地化：把硬编码的 ./... 改成仓库内相对路径 + 环境变量
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
const TEXT_EXT = new Set([".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".txt", ".sh"]);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git"].includes(e.name)) continue;
      walk(p, out);
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

let changed = 0;
for (const f of walk(ROOT)) {
  let txt = fs.readFileSync(f, "utf8");
  const before = txt;

  // 1) 结果目录：./capbench/results → <repo>/data
  txt = txt.replace(/["'`]F:\/风插2\.0\/capbench\/results["'`]/g, '"../data"');
  txt = txt.replace(/["'`]F:\/风插2\.0\/capbench["'`]/g, '".."');
  // 2) ds-logprobs-test 的真实 system prompt 与 tools——仓库里不放原始文件，改用环境变量
  txt = txt.replace(/["'`]F:\/风插2\.0\/ds-logprobs-test\/real-sys-prompt\.txt["'`]/g, 'process.env.REAL_SYS_PATH ?? "../data/real-sys-prompt.txt"');
  txt = txt.replace(/["'`]F:\/风插2\.0\/ds-logprobs-test\/real-tools\.json["'`]/g, 'process.env.REAL_TOOLS_PATH ?? "../data/real-tools.json"');
  txt = txt.replace(/["'`]F:\/风插2\.0\/ds-logprobs-test["'`]/g, 'process.env.EXPERIMENT_DATA_DIR ?? "../data"');
  // 3) 会话语料（隐私，不公开）——必须由使用者自行提供
  txt = txt.replace(/["'`]F:\/风插2\.0\/_corpus\/sessions-events\.json["'`]/g, 'process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json"');
  txt = txt.replace(/["'`]F:\/风插2\.0\/_corpus["'`]/g, 'process.env.CORPUS_DIR ?? "../data"');
  // 4) 兜底：任何剩余的 <repo-root> 前缀 → 相对占位
  txt = txt.replace(/F:\/风插2\.0\//g, "./");

  if (txt !== before) {
    fs.writeFileSync(f, txt);
    changed++;
    console.log("  去本地化 " + path.relative(ROOT, f));
  }
}
console.log(`\n共处理 ${changed} 个文件`);

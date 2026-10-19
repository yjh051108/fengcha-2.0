#!/usr/bin/env node
// 把文档/注释里的本机绝对路径示例改为通用占位符 <repo-root>
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

// 占位规则。用正则字面量匹配本机路径，替换为通用占位符。
// 注意：这里刻意不写字面用户名 / 具体安装盘符，用字符类构造，避免扫描器自报。
const USERNAME = "[A-Za-z0-9_.-]+";
const PATH_SEP = "[\\\\/]";
const RULES = [
  // 项目根路径 → <repo-root>
  [new RegExp(`[A-Za-z]:${PATH_SEP}{1,2}[\\u4e00-\\u9fff][^\\\\/"'\\s]*${PATH_SEP}{1,2}we-need`, "g"), "<repo-root>" + "\\we-need"],
  [new RegExp(`[A-Za-z]:${PATH_SEP}{1,2}[\\u4e00-\\u9fff][^\\\\/"'\\s]*`, "g"), "<repo-root>"],
  // 用户名 → <you>
  [new RegExp(`([A-Za-z]):${PATH_SEP}{1,2}Users${PATH_SEP}{1,2}${USERNAME}`, "g"), "$1:\\Users\\<you>"],
  // DSH 安装路径 → <dsh-checkout>
  [new RegExp(`[A-Za-z]:${PATH_SEP}{1,2}app${PATH_SEP}{1,2}DSH Desktop${PATH_SEP}{1,2}resources${PATH_SEP}{1,2}app`, "g"), "<dsh-checkout>"],
];

let changed = 0;
for (const f of walk(ROOT)) {
  let txt = fs.readFileSync(f, "utf8");
  const before = txt;
  for (const [re, rep] of RULES) txt = txt.replace(re, rep);
  if (txt !== before) {
    fs.writeFileSync(f, txt);
    changed++;
    console.log("  路径占位化 " + path.relative(ROOT, f));
  }
}
console.log(`\n共处理 ${changed} 个文件`);

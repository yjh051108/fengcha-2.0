#!/usr/bin/env node
// 会话 ID 匿名化：把真实 session UUID 换成稳定的假名 s001/s002...
// 保留「同一 ID 前后一致」，但不暴露任何真实标识。
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
const TEXT_EXT = new Set([".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".txt"]);
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

// 匹配 session-xxxx 或裸 UUID
const RE = /(?:session-)?([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/g;
const map = new Map();
let counter = 0;
const alias = (full) => {
  if (!map.has(full)) map.set(full, `session-s${String(++counter).padStart(3, "0")}`);
  return map.get(full);
};

let changed = 0;
for (const f of walk(ROOT)) {
  const txt = fs.readFileSync(f, "utf8");
  const before = txt;
  const out = txt.replace(RE, (m) => alias(m));
  if (out !== before) {
    fs.writeFileSync(f, out);
    changed++;
    console.log("  匿名化 " + path.relative(ROOT, f));
  }
}
console.log(`\n共处理 ${changed} 个文件，生成 ${map.size} 个假名`);

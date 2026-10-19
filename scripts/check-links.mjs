#!/usr/bin/env node
// 链接校验：检查所有 Markdown 里的相对链接 / 图片是否真实存在
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".git"].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

let broken = 0, checked = 0;
for (const f of walk(ROOT)) {
  const txt = fs.readFileSync(f, "utf8");
  const dir = path.dirname(f);
  // [label](target) 和 ![alt](target)
  const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(txt))) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (target.startsWith("<") && target.endsWith(">")) continue;
    checked++;
    const clean = decodeURIComponent(target.split("#")[0]);
    if (!clean) continue;
    const abs = path.resolve(dir, clean);
    if (!fs.existsSync(abs)) {
      broken++;
      console.log(`✗ 断链  ${path.relative(ROOT, f)}  →  ${target}`);
    }
  }
  // HTML img src
  const re2 = /<img[^>]+src=["']([^"']+)["']/g;
  while ((m = re2.exec(txt))) {
    const target = m[1];
    if (/^(https?:|data:)/.test(target)) continue;
    checked++;
    const abs = path.resolve(dir, decodeURIComponent(target.split("#")[0]));
    if (!fs.existsSync(abs)) {
      broken++;
      console.log(`✗ 断链(img)  ${path.relative(ROOT, f)}  →  ${target}`);
    }
  }
}
console.log(`\n检查 ${checked} 个链接，断链 ${broken} 个`);
process.exit(broken > 0 ? 1 : 0);

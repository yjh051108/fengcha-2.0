#!/usr/bin/env node
// 发布前清洗：把硬编码密钥替换为环境变量读取，并报告残留
// 用法：node clean-secrets.mjs <目标目录> [--verify]
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2];
const VERIFY_ONLY = process.argv.includes("--verify");
if (!ROOT) {
  console.error("用法: node clean-secrets.mjs <dir> [--verify]");
  process.exit(1);
}

const KEY_RE = /sk-[A-Za-z0-9]{20,}/g;
const TEXT_EXT = new Set([".mjs", ".js", ".ts", ".json", ".md", ".yml", ".yaml", ".txt", ".sh", ".jsonl"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, out);
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT);
const found = new Map(); // file -> Set(keys)

for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  const keys = [...new Set(txt.match(KEY_RE) ?? [])];
  if (keys.length) found.set(f, keys);
}

if (VERIFY_ONLY) {
  if (found.size === 0) {
    console.log("✓ 未发现硬编码密钥");
    process.exit(0);
  }
  console.log(`✗ 发现 ${found.size} 个文件仍含密钥：`);
  for (const [f, keys] of found) {
    console.log(`  ${path.relative(ROOT, f)}  (${keys.length} 个)`);
    for (const k of keys) console.log(`    ${k.slice(0, 8)}...${k.slice(-4)}`);
  }
  process.exit(1);
}

// ── 清洗 ──────────────────────────────────────────────────────────
// 策略：按「文件类型」替换为对应语言的「从环境变量读取」写法。
// 只处理 .mjs/.js（脚本），其他类型直接替换为占位符。
let changed = 0;
for (const [f, keys] of found) {
  const ext = path.extname(f).toLowerCase();
  let txt = fs.readFileSync(f, "utf8");
  const before = txt;

  if (ext === ".mjs" || ext === ".js") {
    // 常见模式 1: const KEY = "sk-xxx";  ->  const KEY = process.env.D1_API_KEY ?? "";
    txt = txt.replace(
      /(const|let|var)\s+([A-Z_]*KEY[A-Z_]*)\s*=\s*["']sk-[A-Za-z0-9]{20,}["']\s*;?/g,
      (_m, decl, name) => `${decl} ${name} = process.env.D1_API_KEY ?? "";`
    );
    // 常见模式 2: Authorization: `Bearer sk-xxx`  /  "Bearer sk-xxx"
    txt = txt.replace(
      /(Bearer\s+)sk-[A-Za-z0-9]{20,}/g,
      (_m, pre) => `${pre}\${process.env.D1_API_KEY ?? ""}`
    );
    // 兜底：任何残留的裸 key 字面量 -> 空串
    txt = txt.replace(/"sk-[A-Za-z0-9]{20,}"/g, '""').replace(/'sk-[A-Za-z0-9]{20,}'/g, '""');
  } else if (ext === ".sh") {
    txt = txt.replace(/sk-[A-Za-z0-9]{20,}/g, "${D1_API_KEY}");
  } else {
    // .md / .json / .txt / .yml：直接替换为占位符
    txt = txt.replace(KEY_RE, "sk-REDACTED");
  }

  if (txt !== before) {
    fs.writeFileSync(f, txt);
    changed++;
    console.log(`  清洗 ${path.relative(ROOT, f)}  (${keys.length} 个 key)`);
  }
}

console.log(`\n共清洗 ${changed} 个文件`);

// ── 复查 ──────────────────────────────────────────────────────────
const still = [];
for (const f of walk(ROOT)) {
  const txt = fs.readFileSync(f, "utf8");
  if (KEY_RE.test(txt)) still.push(path.relative(ROOT, f));
}
if (still.length) {
  console.log(`\n⚠ 仍有残留：`);
  for (const f of still) console.log("  " + f);
  process.exit(1);
}
console.log("✓ 复查通过：无硬编码密钥残留");

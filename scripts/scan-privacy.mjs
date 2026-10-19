#!/usr/bin/env node
// 发布前隐私扫描：找出路径、用户名、会话 ID、可能的私人内容
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || ".";
const TEXT_EXT = new Set([".mjs", ".js", ".json", ".md", ".yml", ".yaml", ".txt", ".sh", ".jsonl"]);
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

// 规则表。注意：不要把真实用户名写进规则（否则扫描器会自报）。
// 用户名位置用字符类匹配，不写字面值。
const RULES = [
  { name: "Windows 用户目录（真实用户名）", re: /\b[A-Za-z]:\\{1,2}Users\\{1,2}(?!<)[A-Za-z0-9_.-]{2,}(?![>])/g, sev: "high" },
  { name: "绝对路径 F:/D:/C:", re: /(?:\b[FD]:[\\/])/g, sev: "medium" },
  { name: "DSH 会话 ID", re: /session-[0-9a-f]{8}-[0-9a-f]{4}/g, sev: "medium" },
  { name: "中文项目路径", re: /[FD]:[\\/][\u4e00-\u9fff][^\s"']*/g, sev: "high" },
  { name: "邮箱", re: /[\w.+-]+@[\w-]+\.[\w.]+/g, sev: "medium" },
  { name: "IP 地址", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, sev: "low" },
  { name: "手机号", re: /\b1[3-9]\d{9}\b/g, sev: "high" },
  { name: "Bearer token 残留", re: /Bearer\s+(?!\$\{|process\.env)[A-Za-z0-9._-]{20,}/g, sev: "high" },
  { name: "内网/本机 URL", re: /https?:\/\/(?:127\.0\.0\.1|localhost|192\.168\.|10\.)\d*[^\s"')]*/g, sev: "low" },
];

const files = walk(ROOT);
const hits = [];
for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const m = [...new Set(txt.match(rule.re) ?? [])];
    if (m.length) hits.push({ file: path.relative(ROOT, f), rule: rule.name, sev: rule.sev, samples: m.slice(0, 3) });
  }
}

if (!hits.length) {
  console.log("✓ 未发现敏感路径/标识");
  process.exit(0);
}
const order = { high: 0, medium: 1, low: 2 };
hits.sort((a, b) => order[a.sev] - order[b.sev] || a.file.localeCompare(b.file));

let high = 0;
console.log("严重度  规则                    文件                                   样例");
for (const h of hits) {
  if (h.sev === "high") high++;
  console.log(
    `${h.sev.toUpperCase().padEnd(7)} ${h.rule.padEnd(24)} ${h.file.padEnd(40)} ${h.samples.join(" | ").slice(0, 60)}`
  );
}
console.log(`\n共 ${hits.length} 处（high ${high} 处）`);
process.exit(high > 0 ? 1 : 0);

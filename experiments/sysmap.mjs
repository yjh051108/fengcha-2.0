// 勘察：真实 system prompt 的结构 + 已知「工程/代码」吸引子到底在哪
// 目的：找出可消融的段落，而不是漫无目的地改
import fs from "node:fs";

const BASE = process.env.EXPERIMENT_DATA_DIR ?? "../data";
const SYS = fs.readFileSync(`${BASE}/real-sys-prompt.txt`, "utf8");

console.log(`总长度: ${SYS.length} 字符\n`);

// 按段落切
const paras = SYS.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
console.log(`段落数: ${paras.length}\n`);

// 每个段落的长度 + 前 70 字符
console.log("=== 段落清单 ===");
paras.forEach((p, i) => {
  const head = p.replace(/\n/g, " ⏎ ").slice(0, 80);
  console.log(`[${String(i).padStart(2)}] ${String(p.length).padStart(5)}字  ${head}`);
});

// 搜索关键吸引子词
console.log("\n=== 集体/个体语域词在 system prompt 中的分布 ===");
const patterns = {
  "We/Our/Let's": /\b(We|Our|Let's)\b/g,
  "Let me/I/my": /\b(Let me|I|I'm|I'll|I've|My)\b/g,
  "you (第二人称)": /\byou\b/gi,
  "engineer/coding": /\b(engineer|coding|developer|programmer|software)\b/gi,
  "team/we together": /\b(team|together|collaborat)\b/gi,
};
for (const [name, re] of Object.entries(patterns)) {
  const m = SYS.match(re);
  console.log(`  ${name.padEnd(20)} ${String(m?.length ?? 0).padStart(4)} 次`);
}

// 逐段落统计语域词
console.log("\n=== 各段落的语域词密度（找出谁在推 We / 谁在推 I）===");
console.log("段落  长度    We/Our   Let me/I   you   摘要");
for (let i = 0; i < paras.length; i++) {
  const p = paras[i];
  const we = (p.match(/\b(We|Our|Let's)\b/g) ?? []).length;
  const ind = (p.match(/\b(Let me|I|I'm|I'll|I've|My)\b/g) ?? []).length;
  const you = (p.match(/\byou\b/gi) ?? []).length;
  const head = p.replace(/\n/g, " ").slice(0, 42);
  if (we || ind || you)
    console.log(`${String(i).padStart(3)}  ${String(p.length).padStart(5)}  ${String(we).padStart(6)}  ${String(ind).padStart(8)}  ${String(you).padStart(4)}   ${head}`);
}

// 找「工程师」相关段落
console.log("\n=== 含 engineer/coding/software 的段落（已知吸引子）===");
paras.forEach((p, i) => {
  if (/\b(engineer|coding|developer|programmer|software agent)\b/i.test(p)) {
    console.log(`\n[${i}] ${p.length}字:`);
    console.log(`  ${p.replace(/\n/g, " ⏎ ").slice(0, 300)}`);
  }
});

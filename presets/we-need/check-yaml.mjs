#!/usr/bin/env node
// 发布前自检：确保 patch / 插件 / 预设命名 / 作用域都符合预期
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPILED = process.env.DSH_COMPILED || "C:/Users/<you>/.dsh/profiles/desktop/cordis.yml";

let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { fail++; console.log("  \x1b[31m✗\x1b[0m " + m); };
const wrn = (m) => { warn++; console.log("  \x1b[33m!\x1b[0m " + m); };

console.log("\n=== 1. 文件完整性 ===");
const required = ["package.json", "cordis.patch.yml", "lib/index.js", "README.md", "install.sh", "build-presets.mjs"];
for (const f of required) {
  fs.existsSync(path.join(HERE, f)) ? ok(f) : bad("缺文件: " + f);
}
for (const f of ["fig1-sentence-type.svg", "fig2-snapshot-position.svg", "fig7-length.svg"]) {
  fs.existsSync(path.join(HERE, "charts", f)) ? ok("charts/" + f) : bad("缺图表: charts/" + f);
}

console.log("\n=== 2. 回退备份 ===");
const archiveDir = path.join(HERE, "archive");
const backups = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];
const needBackup = "cordis.patch.yml.bak-before-headtail";
backups.includes(needBackup) ? ok("archive/" + needBackup) : bad("缺回退备份: archive/" + needBackup);

console.log("\n=== 3. YAML 结构 ===");
const yamlText = fs.readFileSync(path.join(HERE, "cordis.patch.yml"), "utf8");
const cleaned = yamlText.replace(/!!js /g, "");
let doc;
try {
  const { parse } = await import("yaml").catch(() => ({ parse: null }));
  if (parse) doc = parse(cleaned);
} catch { /* ignore */ }
if (!doc) {
  // 无 yaml 依赖时用正则粗检
  wrn("未加载 yaml 解析器，改用结构检查");
}
const presetIds = [...yamlText.matchAll(/^ {8}id: (fengcha-[\w-]+)$/gm)].map(m => m[1]);
presetIds.length === 2 ? ok("发现 2 个 preset: " + presetIds.join(", ")) : bad("preset 数量异常: " + presetIds.length);

console.log("\n=== 4. 预设命名 ===");
const NAME_STD = "name: 风插标准";
const NAME_PTC = "name: 风插 PTC";
yamlText.includes(NAME_STD) ? ok("存在「风插标准」") : bad("缺「风插标准」");
yamlText.includes(NAME_PTC) ? ok("存在「风插 PTC」") : bad("缺「风插 PTC」");
if (yamlText.includes("风插 · 路由") || yamlText.includes("风插 · PTC")) {
  bad("仍残留旧命名（风插 · 路由 / 风插 · PTC）");
} else ok("无旧命名残留");

console.log("\n=== 5. 锚点配置 ===");
const anchorBlocks = [...yamlText.matchAll(/- id: fengcha-anchor[\s\S]{0,340}?(?=\n {6,10}- id: )/g)].map(m => m[0]);
anchorBlocks.length === 2 ? ok("2 处锚点注册") : bad("锚点注册数量: " + anchorBlocks.length);
for (const [i, b] of anchorBlocks.entries()) {
  const mode = /mode: (head\+tail)/.exec(b)?.[1];
  const head = /headOrder: (\d+)/.exec(b)?.[1];
  const tail = /tailOrder: (\d+)/.exec(b)?.[1];
  const hs = /headSlot: '([^']+)'/.exec(b)?.[1];
  const ts = /tailSlot: '([^']+)'/.exec(b)?.[1];
  if (mode === "head+tail" && head === "1" && tail === "10000") ok(`锚点[${i}] mode/order 正确`);
  else bad(`锚点[${i}] 配置异常 mode=${mode} head=${head} tail=${tail}`);
  if (hs && ts && hs !== ts) ok(`锚点[${i}] slot 名隔离: ${hs} / ${ts}`);
  else bad(`锚点[${i}] slot 名未隔离或缺失`);
}
const slotPairs = new Set([...yamlText.matchAll(/headSlot: '([^']+)'/g)].map(m => m[1]));
slotPairs.size === 2 ? ok("两 preset 的 headSlot 互不相同") : bad("headSlot 有重名");

console.log("\n=== 6. 作用域：插件只出现在 preset 内 ===");
// 统计 fengcha-anchor 出现位置：必须都在 plugins: 列表下（缩进 >= 6）
const anchorLines = yamlText.split("\n").map((l, i) => ({ l, i })).filter(x => x.l.includes("id: fengcha-anchor"));
let scopeOk = true;
for (const { l, i } of anchorLines) {
  const indent = l.match(/^ */)[0].length;
  if (indent < 6) { bad(`第 ${i + 1} 行 anchor 缩进 ${indent}，可能在 preset 之外`); scopeOk = false; }
}
if (scopeOk) ok(`${anchorLines.length} 处 anchor 都在 preset plugins 内（缩进 ≥ 6）`);
// 确认没有顶层 / insert 之外挂载
if (/^- id: fengcha-anchor/m.test(yamlText)) bad("发现顶层 anchor 挂载（会全局生效）");
else ok("无顶层 anchor 挂载");

console.log("\n=== 7. 插件 API 自检 ===");
const { pathToFileURL } = await import("node:url");
const mod = await import(pathToFileURL(path.join(HERE, "lib/index.js")).href);
const calls = [];
const fakeCtx = {
  systemPrompt: { context(o) { calls.push(o); return () => {}; } },
  effect(fn) { fn(); return () => {}; },
};
mod.apply(fakeCtx, { mode: "head+tail", headSlot: "a:h", tailSlot: "a:t", headOrder: 1, tailOrder: 10000 });
calls.length === 2 ? ok("head+tail 注册 2 条 context") : bad("注册条数=" + calls.length);
calls[0]?.order === 1 && calls[1]?.order === 10000 ? ok("order 正确 (1 / 10000)") : bad("order 异常");
calls[0]?.text === calls[1]?.text ? ok("头尾文本一致（常量）") : bad("头尾文本不一致");
const exported = Object.keys(mod);
exported.includes("apply") && exported.includes("name") ? ok("导出 apply / name") : bad("导出缺项: " + exported.join(","));
const textLen = calls[0]?.text?.length ?? 0;
textLen > 300 && textLen < 500 ? ok(`锚点文本长度 ${textLen} 字符`) : wrn(`锚点文本长度 ${textLen} 字符（预期 300-500）`);
if (/Every paragraph must begin with/i.test(calls[0]?.text ?? "")) ok("含段落级形式约束");
else bad("缺段落级形式约束");

console.log("\n=== 8. README 关键声明 ===");
const readme = fs.readFileSync(path.join(HERE, "README.md"), "utf8");
const checks = [
  [/不是「找到了能直接实现思维链的吸引子」|不是.*吸引子/, "明确定性为硬指令而非吸引子"],
  [/暂不明确是否有实际效果提升/, "效果声明：未证明提升"],
  [/暂不明确是否存在负面作用/, "效果声明：未证明负面"],
  [/只是增多|只是增多 `We need` 风格思维链/, "声明只是增多思维链"],
  [/待补充/, "含证据不足标注"],
  [/archive\/cordis\.patch\.yml\.bak-before-headtail/, "回退说明指向指定备份"],
];
for (const [re, label] of checks) re.test(readme) ? ok(label) : bad("README 缺: " + label);

console.log("\n=== 9. install.sh 可执行 ===");
try {
  const st = fs.statSync(path.join(HERE, "install.sh"));
  st.size > 1000 ? ok(`install.sh ${st.size} 字节`) : bad("install.sh 过短");
} catch { bad("install.sh 不可读"); }
if (/bak-before-headtail/.test(fs.readFileSync(path.join(HERE, "install.sh"), "utf8"))) ok("install.sh 回退指向正确备份");
else bad("install.sh 回退路径不对");

console.log(`\n${"=".repeat(50)}`);
if (fail === 0) {
  console.log(`\x1b[32m全部通过\x1b[0m（警告 ${warn} 项）`);
  process.exit(0);
} else {
  console.log(`\x1b[31m失败 ${fail} 项\x1b[0m（警告 ${warn} 项）`);
  process.exit(1);
}

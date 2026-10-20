#!/usr/bin/env node
// 发布前自检：确保这个 Git 仓库可以直接作为 DSH 插件包被安装
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let fail = 0, warn = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { fail++; console.log("  \x1b[31m✗\x1b[0m " + m); };
const wrn = (m) => { warn++; console.log("  \x1b[33m!\x1b[0m " + m); };

console.log("\n=== 1. DSH 可安装性（最关键）===");
const pkgPath = path.join(HERE, "package.json");
if (!fs.existsSync(pkgPath)) {
  bad("缺 package.json —— DSH 无法把这个仓库当插件装");
} else {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); }
  catch (e) { bad("package.json 解析失败: " + e.message); }

  if (pkg) {
    pkg.name ? ok("name = " + pkg.name) : bad("缺 name");
    pkg.version ? ok("version = " + pkg.version) : bad("缺 version");

    // DSH 的判定：typeof dsh.bundle === "object" && dsh.bundle !== null
    const bundle = typeof pkg.dsh?.bundle === "object" && pkg.dsh.bundle !== null;
    bundle
      ? ok("已声明 dsh.bundle —— DSH 会认它为组合包")
      : bad("未声明 dsh.bundle —— DSH 会报「这个包没有声明组合包」");

    const patch = pkg.dsh?.bundle?.patch;
    if (!patch) bad("dsh.bundle.patch 未指定");
    else if (!fs.existsSync(path.join(HERE, patch))) bad("patch 文件不存在: " + patch);
    else ok("patch 文件存在: " + patch);

    if (pkg.private === true) bad("private: true —— pnpm 会拒绝安装，必须删掉");
    else ok("无 private 标记（可被 pnpm 安装）");
  }
}

console.log("\n=== 2. 包内容完整性 ===");
const required = ["cordis.patch.yml", "lib/index.js", "README.md", "LICENSE"];
for (const f of required) {
  fs.existsSync(path.join(HERE, f)) ? ok(f) : bad("缺文件: " + f);
}
for (const f of ["fig1-sentence-type.svg", "fig2-snapshot-position.svg", "fig7-length.svg"]) {
  fs.existsSync(path.join(HERE, "docs", "charts", f)) ? ok("docs/charts/" + f) : bad("缺图表: " + f);
}
fs.existsSync(path.join(HERE, "archive", "cordis.patch.yml.bak-before-headtail"))
  ? ok("archive/cordis.patch.yml.bak-before-headtail（回退点）")
  : bad("缺回退备份");

console.log("\n=== 3. YAML 结构与预设 ===");
const yamlText = fs.readFileSync(path.join(HERE, "cordis.patch.yml"), "utf8");
const presetIds = [...yamlText.matchAll(/^ {8}id: (fengcha-[\w-]+)$/gm)].map((m) => m[1]);
const EXPECTED_PRESETS = 3;
presetIds.length === EXPECTED_PRESETS
  ? ok(`${EXPECTED_PRESETS} 个 preset: ` + presetIds.join(", "))
  : bad(`preset 数量异常: ${presetIds.length}（预期 ${EXPECTED_PRESETS}）`);
// preset id 必须唯一
new Set(presetIds).size === presetIds.length ? ok("preset id 无重复") : bad("preset id 有重复: " + presetIds.join(", "));

console.log("\n=== 4. 预设命名 ===");
for (const n of ["风插标准", "风插 PTC", "风插 匠人"]) {
  yamlText.includes(`name: ${n}`) ? ok(`存在「${n}」`) : bad(`缺「${n}」`);
}
if (yamlText.includes("风插 · 路由") || yamlText.includes("风插 · PTC")) bad("残留旧命名");
else ok("无旧命名残留");

console.log("\n=== 5. 锚点配置 ===");
const anchorBlocks = [...yamlText.matchAll(/- id: fengcha-anchor[\s\S]{0,340}?(?=\n {6,10}- id: )/g)].map((m) => m[0]);
anchorBlocks.length === presetIds.length
  ? ok(`${anchorBlocks.length} 处锚点注册（每预设一处）`)
  : bad(`锚点注册数量 ${anchorBlocks.length} 与预设数 ${presetIds.length} 不一致`);
for (const [i, b] of anchorBlocks.entries()) {
  const mode = /mode: (head\+tail)/.exec(b)?.[1];
  const head = /headOrder: (\d+)/.exec(b)?.[1];
  const tail = /tailOrder: (\d+)/.exec(b)?.[1];
  const hs = /headSlot: '([^']+)'/.exec(b)?.[1];
  const ts = /tailSlot: '([^']+)'/.exec(b)?.[1];
  if (mode === "head+tail" && head === "1" && tail === "10000") ok(`锚点[${i}] mode/order 正确`);
  else bad(`锚点[${i}] 配置异常`);
  if (hs && ts && hs !== ts) ok(`锚点[${i}] slot 隔离: ${hs} / ${ts}`);
  else bad(`锚点[${i}] slot 未隔离`);
}

console.log("\n=== 5b. 补丁内自引用包名必须等于 package.json 的 name ===");
{
  const pkgName = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).name;
  const referenced = [...new Set([...yamlText.matchAll(/name:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]))];
  // 统计出现次数（要去重前后各算一次：referenced 是去重后的名字列表）
  const selfRefs = referenced.filter((n) => n === pkgName);
  const selfCount = [...yamlText.matchAll(new RegExp(`name:\\s*['"]${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`, "g"))].length;
  const staleLocal = referenced.filter((n) => n.startsWith("@local/"));
  selfRefs.length >= 1 && selfCount >= 2
    ? ok(`补丁引用了自身包名 ${pkgName}（${selfCount} 处）`)
    : bad(`补丁里只有 ${selfCount} 处引用自身包名 ${pkgName} —— 预设挂载会报「缺包」并失败`);
  if (staleLocal.length) bad("补丁里仍有 @local/* 旧包名: " + staleLocal.join(", "));
  else ok("无 @local/* 残留");
}

console.log("\n=== 5c. 补丁引用的所有包是否可解析 ===");
{
  const pkgName = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).name;
  const names = [...new Set([...yamlText.matchAll(/name:\s*['"]([^'"][^'"]*)['"]/g)].map((m) => m[1]))];
  // DSH 从 profile 的 node_modules 解析；官方包作 peer 由 DSH app 提供。
  // 判据：取包根（前两段），忽略 /tools 之类子路径导出。
  const profileModules = path.join(process.env.USERPROFILE || process.env.HOME || "", ".dsh", "profiles", "desktop", "node_modules");
  const appModules = "D:/app/DSH Desktop/resources/app/node_modules";
  const unresolvable = [];
  for (const n of names) {
    if (n === pkgName) continue;
    if (!n.startsWith("@")) continue; // 非 scoped 的第三方名不在此校验
    const pkgRoot = n.split("/").slice(0, 2).join("/");
    const okHere =
      fs.existsSync(path.join(profileModules, pkgRoot)) ||
      fs.existsSync(path.join(appModules, pkgRoot));
    if (!okHere) unresolvable.push(n);
  }
  unresolvable.length === 0
    ? ok(`补丁引用的 ${names.length - 1} 个外部包全部可解析`)
    : wrn("以下包在当前环境解析不到（若它们确实该由 DSH 提供，可忽略）: " + unresolvable.join(", "));
}

console.log("\n=== 6. 作用域：只作用于 preset 内 ===");
const anchorLines = yamlText.split("\n").map((l, i) => ({ l, i })).filter((x) => x.l.includes("id: fengcha-anchor"));
let scopeOk = true;
for (const { l, i } of anchorLines) {
  const indent = l.match(/^ */)[0].length;
  if (indent < 6) { bad(`第 ${i + 1} 行 anchor 缩进 ${indent}，可能在 preset 之外`); scopeOk = false; }
}
if (scopeOk) ok(`${anchorLines.length} 处 anchor 都在 preset plugins 内`);
if (/^- id: fengcha-anchor/m.test(yamlText)) bad("发现顶层 anchor 挂载（会全局生效）");
else ok("无顶层 anchor 挂载");

console.log("\n=== 7. 插件运行时自检 ===");
try {
  const mod = await import(pathToFileURL(path.join(HERE, "lib/index.js")).href);
  const calls = [];
  const fakeCtx = {
    systemPrompt: { context(o) { calls.push(o); return () => {}; } },
    effect(fn) { fn(); return () => {}; },
  };
  mod.apply(fakeCtx, { mode: "head+tail", headSlot: "a:h", tailSlot: "a:t", headOrder: 1, tailOrder: 10000 });
  calls.length === 2 ? ok("head+tail 注册 2 条 context") : bad("注册条数=" + calls.length);
  calls[0]?.order === 1 && calls[1]?.order === 10000 ? ok("order 正确 (1 / 10000)") : bad("order 异常");
  const textLen = calls[0]?.text?.length ?? 0;
  textLen > 300 && textLen < 500 ? ok(`锚点文本 ${textLen} 字符`) : wrn(`锚点文本 ${textLen} 字符`);
  if (/Every paragraph must begin with/i.test(calls[0]?.text ?? "")) ok("含段落级形式约束");
  else bad("缺段落级形式约束");
  if (typeof mod.apply === "function") ok("导出 apply"); else bad("缺 apply 导出");
} catch (e) {
  bad("插件加载失败: " + e.message);
}

console.log("\n=== 8. README 关键声明 ===");
const readme = fs.readFileSync(path.join(HERE, "README.md"), "utf8");
const checks = [
  [/让模型在思考时更多说|We need/, "有通俗的开篇说明"],
  [/不保证让模型变聪明|不能保证答得/i, "明确不保证能力提升"],
  [/没测正确率|没测.*正确率|一个都没测|完全没测能力/, "声明未测能力"],
  [/不能保证没有副作用|是否有负面作用/, "声明未证明无负面"],
  [/Apache/, "许可声明"],
];
for (const [re, label] of checks) (re.test(readme) ? ok(label) : bad("README 缺: " + label));

console.log("\n=== 9. 仓库体积（Git 安装不应过大）===");
function du(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    t += e.isDirectory() ? du(p) : fs.statSync(p).size;
  }
  return t;
}
const bytes = du(HERE);
const mb = (bytes / 1024 / 1024).toFixed(1);
bytes < 20 * 1024 * 1024 ? ok(`仓库 ${mb} MB（< 20 MB，适合 Git 安装）`) : wrn(`仓库 ${mb} MB，Git 安装可能变慢`);

console.log("\n" + "=".repeat(52));
if (fail === 0) {
  console.log(`\x1b[32m全部通过\x1b[0m（警告 ${warn} 项）`);
  process.exit(0);
} else {
  console.log(`\x1b[31m失败 ${fail} 项\x1b[0m（警告 ${warn} 项）`);
  process.exit(1);
}

#!/usr/bin/env node
// 每小时轮询一次，跑完写日志再睡 1h。前台常驻（由外部 nohup / 计划任务托管）。
// 单次模式：node watch-loop.mjs --once
//
// 用法：
//   node scripts/watch-loop.mjs                 # 常驻，每 1h 一轮
//   node scripts/watch-loop.mjs --once          # 只跑一轮就退出
//   node scripts/watch-loop.mjs --interval 3600 # 自定义间隔（秒）
//   node scripts/watch-loop.mjs --repo owner/name
//
// 日志：<repo-root>/logs/watch-<owner>-<name>.log（追加）
// 状态：由 watch-repo.mjs 维护 .watch-state-*.json
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const getArg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);

const REPO = getArg("--repo", "yjh051108/fengcha-2.0");
const INTERVAL = Number(getArg("--interval", "3600")); // 秒
const ONCE = has("--once");
const SCRIPT = path.join(HERE, "watch-repo.mjs");

const [OWNER, NAME] = REPO.split("/");
const LOG_DIR = path.join(HERE, "..", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, `watch-${OWNER}-${NAME}.log`);

function log(line) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const text = `[${ts}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, text + "\n");
  } catch (e) {
    console.error("写日志失败:", e.message);
  }
}

/** 跑一轮；返回是否有新增 */
function runOnce() {
  const r = spawnSync(process.execPath, [SCRIPT, "--repo", REPO], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  if (out) for (const line of out.split("\n")) if (line.trim()) log(line);
  if (err) log("STDERR: " + err.slice(0, 500));
  // watch-repo.mjs 用 10 表示有新增
  return r.status === 10;
}

if (ONCE) {
  const hasNew = runOnce();
  process.exit(hasNew ? 10 : 0);
}

log(`=== 启动轮询循环：${REPO}，间隔 ${INTERVAL}s ===`);
log(`日志: ${LOG_FILE}`);

let round = 0;
async function forever() {
  while (true) {
    round++;
    log(`--- 第 ${round} 轮 ---`);
    let hasNew = false;
    try {
      hasNew = runOnce();
    } catch (e) {
      log("轮询异常: " + String(e.message ?? e).slice(0, 300));
    }
    if (hasNew) {
      log("🔔 本轮有新增/变化，见上方明细。");
    }
    const next = new Date(Date.now() + INTERVAL * 1000);
    log(`下一轮: ${next.toISOString().replace("T", " ").slice(0, 19)}（${INTERVAL}s 后）`);
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
  }
}

forever().catch((e) => {
  log("循环崩溃: " + String(e?.stack ?? e).slice(0, 800));
  process.exit(1);
});

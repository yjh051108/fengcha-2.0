#!/usr/bin/env node
// 仓库轮询：拉一次 issue / PR 快照，与上次比对，只输出新增与变化。
// 纯定时进程：跑一轮就退出（配合操作系统计划任务或外部循环）。
//
// 用法：
//   node scripts/watch-repo.mjs                          # 默认仓库，单次轮询
//   node scripts/watch-repo.mjs --repo owner/name        # 指定仓库
//   node scripts/watch-repo.mjs --state open             # 只看 open（默认 all）
//   node scripts/watch-repo.mjs --json                   # 机器可读输出
//   node scripts/watch-repo.mjs --reset                  # 清空基线快照
//
// 退出码：
//   0 = 无新增
//   10 = 有新增 issue 或 PR（便于外部循环据此提醒）
//   1 = 出错
//
// 状态文件：同目录下 .watch-state-<owner>-<repo>.json

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── 参数 ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const hasFlag = (name) => argv.includes(name);

const REPO = getArg("--repo", "yjh051108/fengcha-2.0");
const STATE = getArg("--state", "all");
const AS_JSON = hasFlag("--json");
const RESET = hasFlag("--reset");
const QUIET_NOCHANGE = hasFlag("--quiet");

const [OWNER, NAME] = REPO.split("/");
if (!OWNER || !NAME) {
  console.error(`仓库格式错误: ${REPO}（应为 owner/name）`);
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, `.watch-state-${OWNER}-${NAME}.json`);

// ── gh 调用 ───────────────────────────────────────────────────────
function gh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    const msg = String(e.stderr || e.message || e).slice(0, 400);
    throw new Error(msg);
  }
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

// ── 拉取 ──────────────────────────────────────────────────────────
function fetchIssues() {
  // GitHub 的 issues 列表会把 PR 也算进去，需按 pull_request 字段过滤
  const raw = ghJson([
    "api",
    `repos/${OWNER}/${NAME}/issues?state=${STATE}&per_page=100&sort=created&direction=desc`,
  ]);
  return raw
    .filter((x) => !x.pull_request)
    .map((x) => ({
      kind: "issue",
      number: x.number,
      title: x.title,
      state: x.state,
      user: x.user?.login ?? "?",
      createdAt: x.created_at,
      updatedAt: x.updated_at,
      comments: x.comments ?? 0,
      labels: (x.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
      url: x.html_url,
    }));
}

function fetchPulls() {
  const raw = ghJson([
    "api",
    `repos/${OWNER}/${NAME}/pulls?state=${STATE}&per_page=100&sort=created&direction=desc`,
  ]);
  return raw.map((x) => ({
    kind: "pr",
    number: x.number,
    title: x.title,
    state: x.state,
    user: x.user?.login ?? "?",
    createdAt: x.created_at,
    updatedAt: x.updated_at,
    draft: !!x.draft,
    merged: !!x.merged_at,
    labels: (x.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
    url: x.html_url,
    head: x.head?.ref,
    base: x.base?.ref,
  }));
}

// ── 状态 ──────────────────────────────────────────────────────────
function loadState() {
  if (RESET || !fs.existsSync(STATE_FILE)) return { seen: {}, lastRun: null };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { seen: {}, lastRun: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

// ── 主流程 ────────────────────────────────────────────────────────
function main() {
  const startedAt = new Date();
  let issues, pulls;
  try {
    issues = fetchIssues();
    pulls = fetchPulls();
  } catch (e) {
    console.error(`[watch] 拉取失败: ${e.message}`);
    process.exit(1);
  }

  const state = loadState();
  const seen = state.seen ?? {};

  const fresh = [];      // 从未见过
  const changed = [];    // 见过但状态/标题/评论数变了

  for (const item of [...issues, ...pulls]) {
    const key = `${item.kind}#${item.number}`;
    const sig = JSON.stringify({
      t: item.title,
      s: item.state,
      u: item.updatedAt,
      c: item.comments ?? 0,
      m: item.merged ?? false,
      d: item.draft ?? false,
    });
    const prev = seen[key];
    if (!prev) {
      fresh.push(item);
      seen[key] = { sig, firstSeen: startedAt.toISOString() };
    } else if (prev.sig !== sig) {
      changed.push({ ...item, prevSig: prev.sig });
      seen[key] = { ...prev, sig };
    }
  }

  const summary = {
    repo: REPO,
    checkedAt: startedAt.toISOString(),
    totals: { issues: issues.length, pulls: pulls.length },
    fresh: fresh.map(({ kind, number, title, state: st, user, url }) => ({ kind, number, title, state: st, user, url })),
    changed: changed.map(({ kind, number, title, state: st, user, url }) => ({ kind, number, title, state: st, user, url })),
  };

  // 输出
  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const stamp = startedAt.toISOString().replace("T", " ").slice(0, 19);
    console.log(`[watch] ${REPO}  @ ${stamp}`);
    console.log(`[watch] issue ${issues.length} · PR ${pulls.length}`);

    if (fresh.length === 0 && changed.length === 0) {
      if (!QUIET_NOCHANGE) console.log("[watch] 无新增，无变化。");
    }
    if (fresh.length) {
      console.log(`\n[watch] 🔔 新增 ${fresh.length} 条：`);
      for (const x of fresh) {
        const tag = x.kind === "issue" ? "ISSUE" : x.draft ? "DRAFT-PR" : "PR";
        console.log(`  [${tag}] #${x.number}  ${x.title}`);
        console.log(`          by ${x.user} · ${x.state} · ${x.url}`);
      }
    }
    if (changed.length) {
      console.log(`\n[watch] ✏️  有更新 ${changed.length} 条：`);
      for (const x of changed) {
        const tag = x.kind === "issue" ? "ISSUE" : "PR";
        console.log(`  [${tag}] #${x.number}  ${x.title}  → ${x.state}`);
        console.log(`          ${x.url}`);
      }
    }
  }

  state.lastRun = startedAt.toISOString();
  state.seen = seen;
  saveState(state);

  // 退出码：有新增就返回 10，便于外部循环/计划任务据此触发提醒
  process.exit(fresh.length + changed.length > 0 ? 10 : 0);
}

main();

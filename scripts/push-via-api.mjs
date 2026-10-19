#!/usr/bin/env node
// 通过 GitHub API 推送（绕开被阻的 git-over-HTTPS）
// 用 Git Data API：blob -> tree -> commit -> 更新 ref
// 用法：node scripts/push-via-api.mjs <owner> <repo> [branch] [commitMsgFile]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [owner, repo, branch = "main", msgFile] = process.argv.slice(2);
if (!owner || !repo) {
  console.error("用法: node push-via-api.mjs <owner> <repo> [branch] [commitMsgFile]");
  process.exit(1);
}

const TMP = path.join(process.cwd(), "_api_payload.json");

/** 调 gh api。有 body 时写临时文件并自动加 --input。 */
function gh(args, body) {
  let finalArgs = [...args];
  if (body !== undefined) {
    fs.writeFileSync(TMP, body);
    finalArgs = [...finalArgs, "--input", TMP];
  }
  try {
    return execFileSync("gh", finalArgs, {
      encoding: "utf8",
      maxBuffer: 200 * 1024 * 1024,
    }).trim();
  } finally {
    if (body !== undefined) {
      try { fs.unlinkSync(TMP); } catch {}
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function walk(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, rel));
    else out.push({ rel, abs });
  }
  return out;
}

const files = walk(".");
console.log(`文件数: ${files.length}`);

// 1) 上传 blob
const blobs = [];
let i = 0;
for (const f of files) {
  i++;
  const b64 = fs.readFileSync(f.abs).toString("base64");
  let sha = null;
  for (let attempt = 0; attempt < 4 && !sha; attempt++) {
    try {
      const res = gh(
        ["api", "-X", "POST", `repos/${owner}/${repo}/git/blobs`],
        JSON.stringify({ content: b64, encoding: "base64" })
      );
      sha = JSON.parse(res).sha;
    } catch (e) {
      if (attempt === 3) {
        throw new Error(`blob 失败 ${f.rel}: ${String(e.stderr || e.message).slice(0, 300)}`);
      }
      await sleep(1000 * (attempt + 1));
    }
  }
  blobs.push({ path: f.rel, sha, mode: "100644", type: "blob" });
  if (i % 25 === 0 || i === files.length) process.stdout.write(`  blob ${i}/${files.length}\n`);
}
console.log(`✓ blob 完成 ${blobs.length}`);

// 2) tree
const tree = JSON.parse(
  gh(["api", "-X", "POST", `repos/${owner}/${repo}/git/trees`], JSON.stringify({ tree: blobs }))
);
console.log(`✓ tree ${tree.sha}`);

// 3) 取父提交
let parentSha = null;
try {
  parentSha = JSON.parse(gh(["api", `repos/${owner}/${repo}/git/ref/heads/${branch}`])).object.sha;
  console.log(`  父提交 ${parentSha}`);
} catch {
  console.log("  无父提交（首个提交）");
}

// 4) commit
const message =
  msgFile && fs.existsSync(msgFile)
    ? fs.readFileSync(msgFile, "utf8").trim()
    : "风插 2.0: DSH 推理语域锚定预设";
const commit = JSON.parse(
  gh(
    ["api", "-X", "POST", `repos/${owner}/${repo}/git/commits`],
    JSON.stringify({ message, tree: tree.sha, parents: parentSha ? [parentSha] : [] })
  )
);
console.log(`✓ commit ${commit.sha}`);

// 5) 更新 ref
if (parentSha) {
  gh(
    ["api", "-X", "PATCH", `repos/${owner}/${repo}/git/refs/heads/${branch}`],
    JSON.stringify({ sha: commit.sha, force: true })
  );
  console.log(`✓ 更新 ${branch}`);
} else {
  gh(
    ["api", "-X", "POST", `repos/${owner}/${repo}/git/refs`],
    JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
  );
  console.log(`✓ 创建 ${branch}`);
}

console.log(`\n完成: https://github.com/${owner}/${repo}`);

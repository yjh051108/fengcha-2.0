// 定位真因：turn 的第一个 step 是否特殊？
// 观察：截图里第二条用户消息（新 turn 首步）掉了锚点
// 假设 H1：新 turn 首 step 的 runtime-context 被判定"内容相同"而跳过（去重）
// 假设 H2：新 turn 首 step 的 messages 顺序不同（用户消息在前，rc 在后），但锚点太远
// 假设 H3：锚点在 turn 之间被"替换"而非"追加"，导致注意力衰减
//
// 验证方式：看真实会话里 turn 边界处的 rc 内容变化
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));
const ANCHOR_RE = /open (every|our) reasoning (block|with)|We always open our reasoning|paragraph must begin/;

for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  if (!sid.includes("807ac7dd") && !sid.includes("069b47a6")) continue;

  console.log("\n" + "=".repeat(72));
  console.log("会话", sid);

  // 按 turn 分组，看每个 turn 里的 rc 内容
  let curTurn = -1, curStep = -1;
  const byTurn = {};
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === "turn/start") curTurn = e.data?.turn ?? curTurn + 1;
    if (e.type === "step/start") curStep = e.data?.step ?? curStep + 1;
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      const txt = (Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join("");
      const hasAnchor = ANCHOR_RE.test(txt);
      const len = txt.length;
      (byTurn[curTurn] ??= []).push({ step: curStep, hasAnchor, len, seq: i });
    }
  }

  for (const [t, list] of Object.entries(byTurn)) {
    console.log(`\n  turn ${t}: ${list.length} 次 rc 注入`);
    console.log(`    含锚点: ${list.filter(x => x.hasAnchor).length}/${list.length}`);
    console.log(`    首 5 次: ${list.slice(0, 5).map(x => `step${x.step}(锚${x.hasAnchor ? "✓" : "✗"},${x.len}字)`).join(" ")}`);
    // 锚点是否在第一个 step 就出现
    const first = list[0];
    console.log(`    该 turn 首个 rc: step${first?.step} 含锚点=${first?.hasAnchor} 长度=${first?.len}`);
  }
  break;
}

// 更关键：检查锚点内容是否真的每步都不同（若相同则去重会跳过）
console.log("\n\n=== 关键：锚点段落是否每步都变？===");
for (const k of Object.keys(RAW)) {
  const ev = RAW[k]?.events;
  if (!Array.isArray(ev)) continue;
  const sid = RAW[k].path?.split("\\").slice(-2)[0] ?? "?";
  if (!sid.includes("069b47a6")) continue;
  const rcTexts = [];
  for (const e of ev) {
    if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
      rcTexts.push((Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join(""));
    }
  }
  console.log(`rc 消息 ${rcTexts.length} 条`);
  // 提取锚点段落
  const anchorSegs = rcTexts.map(t => {
    const m = t.match(/We open every reasoning block[\s\S]{0,500}/);
    return m ? m[0] : null;
  }).filter(Boolean);
  console.log(`含锚点的 ${anchorSegs.length} 条`);
  const uniqueAnchors = new Set(anchorSegs);
  console.log(`锚点段落的不同版本数: ${uniqueAnchors.size}`);
  // 前 3 条锚点的差异
  const arr = [...uniqueAnchors];
  for (let i = 0; i < Math.min(3, arr.length); i++) {
    console.log(`  版本${i}: ${arr[i].slice(0, 120).replace(/\n/g, " ")}...`);
  }
  // 整条 rc 是否都不同
  const uniqueAll = new Set(rcTexts);
  console.log(`整条 rc 的不同版本数: ${uniqueAll.size} / ${rcTexts.length}`);
  break;
}

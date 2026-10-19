// 弄清 turn / step / runtime-context 的真实对应关系
// 数据：session-069b47a6 turn=3 但 rc=124 —— 说明 turn 计数口径和我以为的不同
import fs from "node:fs";

const RAW = JSON.parse(fs.readFileSync(process.env.SESSIONS_CORPUS ?? "../data/sessions-events.json", "utf8"));

for (const target of ["069b47a6", "807ac7dd"]) {
  for (const k of Object.keys(RAW)) {
    if (!RAW[k].path?.includes(target)) continue;
    const ev = RAW[k].events;
    console.log("\n" + "=".repeat(70));
    console.log("会话:", target, " 事件数:", ev.length);

    // 事件类型统计
    const types = {};
    for (const e of ev) types[e.type] = (types[e.type] ?? 0) + 1;
    console.log("事件类型:", JSON.stringify(types, null, 1));

    // 找出 user/message 的 source.kind 分布
    const kinds = {};
    for (const e of ev) {
      if (e.type !== "user/message") continue;
      const kd = e.data?.source?.kind ?? "(plain user)";
      kinds[kd] = (kinds[kd] ?? 0) + 1;
    }
    console.log("user/message 的 source.kind:", JSON.stringify(kinds, null, 1));

    // 关键：真实用户消息（非 runtime-context / skill-catalog / time-context）有几条
    const realUser = ev.filter(e => e.type === "user/message" && !e.data?.source?.kind);
    console.log(`真实用户消息数: ${realUser.length}`);
    for (const e of realUser.slice(0, 6)) {
      const txt = (Array.isArray(e.data.content) ? e.data.content : []).map(x => x.text ?? "").join("");
      console.log(`  · ${txt.slice(0, 80).replace(/\n/g, " ")}`);
    }

    // step/start 计数
    const steps = ev.filter(e => e.type === "step/start").length;
    const turns = ev.filter(e => e.type === "turn/start").length;
    const asst = ev.filter(e => e.type === "assistant/message").length;
    console.log(`turn/start=${turns}  step/start=${steps}  assistant/message=${asst}`);

    // runtime-context 出现在哪些位置（按 step 分）
    const rcByStep = {};
    let curStep = -1;
    for (const e of ev) {
      if (e.type === "step/start") curStep = e.data?.step ?? curStep + 1;
      if (e.type === "user/message" && e.data?.source?.kind === "runtime-context") {
        rcByStep[curStep] = (rcByStep[curStep] ?? 0) + 1;
      }
    }
    console.log("每 step 的 runtime-context 数:", JSON.stringify(rcByStep));
    break;
  }
}

// 关键判定：故障是「prompt 可修」还是「必须 API 层修」？
// 上一步已证 prompt 完全无效（16/16 全空）。现在测唯一剩下的手段：
//   1. 提高 max_tokens 到远超思考需求
//   2. 降低 effort（减少思考量）
//   3. 换思考较短的模型
// 哪个能救回来，哪个就是正确的工程方案
import { callD1 } from "./runner.mjs";
import fs from "node:fs";

const TASKS = [
  {
    id: "bigmod",
    q: "Compute 2024^2024 mod 1000000007. Output just the integer.",
    answer: (() => {
      const MOD = 1000000007n;
      let r = 1n, b = 2024n, e = 2024n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    })(),
  },
  {
    id: "pow500",
    q: "What is 3^500 mod 1000000007? Output just the integer.",
    answer: (() => {
      const MOD = 1000000007n;
      let r = 1n, b = 3n, e = 500n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    })(),
  },
];

const CONFIGS = [
  { model: "deepseek-v4.1-flash", effort: "low", maxTokens: 4000 },
  { model: "deepseek-v4.1-flash", effort: "low", maxTokens: 16000 },
  { model: "deepseek-v4.1-flash", effort: "none", maxTokens: 4000 },
  { model: "deepseek-v4.1-flash", effort: "max", maxTokens: 32000 },
  { model: "deepseek-v4.1-flash", effort: "max", maxTokens: 64000 },
  { model: "glm-5.3-flash", effort: "none", maxTokens: 4000 },
  { model: "kimi-k3", effort: "none", maxTokens: 4000 },
  { model: "deepseek-v4-pro", effort: "low", maxTokens: 4000 },
];

const rows = [];
for (const cfg of CONFIGS) {
  for (const t of TASKS) {
    const t0 = Date.now();
    const res = await callD1({ ...cfg, system: null, user: t.q });
    const content = res.content ?? "";
    const pass = content.replace(/[, _]/g, "").includes(t.answer);
    const secs = Math.round((Date.now() - t0) / 1000);
    rows.push({
      ...cfg, taskId: t.id, pass,
      contentLen: content.length,
      reasoningLen: (res.reasoning ?? "").length,
      finish: res.finish, error: res.error ?? null, secs,
    });
    console.log(
      `  ${cfg.model.padEnd(20)} effort=${String(cfg.effort).padEnd(4)} mt=${String(cfg.maxTokens).padStart(5)} ${t.id.padEnd(7)} ${pass ? "PASS" : "fail"} content=${String(content.length).padStart(5)} reason=${String((res.reasoning ?? "").length).padStart(6)} ${res.finish} ${secs}s`
    );
  }
}
fs.writeFileSync("./capbench/results/p9-fix.json", JSON.stringify(rows, null, 1));

console.log("\n=== 哪种配置能救回来 ===");
const byCfg = {};
for (const r of rows) {
  const k = `${r.model}|effort=${r.effort}|mt=${r.maxTokens}`;
  (byCfg[k] ??= []).push(r);
}
for (const [k, v] of Object.entries(byCfg)) {
  const p = v.filter((x) => x.pass).length;
  console.log(`${p === v.length ? "✅" : "❌"} ${k.padEnd(48)} pass=${p}/${v.length} empty=${v.filter((x) => x.contentLen === 0).length}`);
}

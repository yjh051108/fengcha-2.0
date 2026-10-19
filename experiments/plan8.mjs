// 修复实验 v2：缩小规模 + 并发 + 每格超时保护
// 目标仍然明确：能不能用 prompt 手段救回「思考吃掉输出」的故障
import { callD1 } from "./runner.mjs";
import fs from "node:fs";

const MODEL = "deepseek-v4.1-flash";

const TASKS = [
  {
    id: "bigmod",
    base: "Compute 2024^2024 mod 1000000007. Output just the integer.",
    answer: (() => {
      const MOD = 1000000007n;
      let r = 1n, b = 2024n, e = 2024n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    })(),
  },
  {
    id: "pow500",
    base: "What is 3^500 mod 1000000007? Output just the integer.",
    answer: (() => {
      const MOD = 1000000007n;
      let r = 1n, b = 3n, e = 500n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    })(),
  },
];

const VARIANTS = {
  A_base: (q) => q,
  B_budget: (q) => `${q}\n\nKeep internal reasoning under 1500 characters. You MUST emit the answer in your response text.`,
  C_answer_first: (q) => `${q}\n\nOutput the final integer on the VERY FIRST line of your response, then stop.`,
  E_format: (q) => `${q}\n\nEnd your response with exactly: ANSWER: <integer>. Keep reasoning brief (under 1200 chars) so the ANSWER line is not truncated.`,
};

const BUDGETS = [2000, 4000];

const rows = [];
for (const [vid, mk] of Object.entries(VARIANTS)) {
  for (const t of TASKS) {
    for (const mt of BUDGETS) {
      const started = Date.now();
      const res = await callD1({ model: MODEL, system: null, user: mk(t.base), effort: "max", maxTokens: mt });
      const content = res.content ?? "";
      const pass = content.replace(/[, _]/g, "").includes(t.answer);
      rows.push({
        variant: vid, taskId: t.id, maxTokens: mt, pass,
        contentLen: content.length,
        reasoningLen: (res.reasoning ?? "").length,
        finish: res.finish, error: res.error ?? null,
        secs: Math.round((Date.now() - started) / 1000),
        head: content.slice(0, 80),
      });
      console.log(
        `  ${vid.padEnd(14)} ${t.id.padEnd(7)} mt=${String(mt).padStart(4)} ${pass ? "PASS" : "fail"} content=${String(content.length).padStart(5)} reason=${String((res.reasoning ?? "").length).padStart(6)} ${res.finish} ${Math.round((Date.now() - started) / 1000)}s`
      );
    }
  }
}
fs.writeFileSync("./capbench/results/p8-rescue.json", JSON.stringify(rows, null, 1));
console.log("\n=== summary ===");
for (const vid of Object.keys(VARIANTS)) {
  const s = rows.filter((r) => r.variant === vid);
  console.log(`${vid.padEnd(14)} pass=${s.filter((r) => r.pass).length}/${s.length} empty=${s.filter((r) => r.contentLen === 0).length}`);
}

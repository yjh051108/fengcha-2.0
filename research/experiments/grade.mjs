// 判分器 v2：数值题答案一律由 task.compute() 现算，不再读手写的 task.answer
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function extractCode(text) {
  const blocks = [...(text ?? "").matchAll(/```(?:js|javascript|jsx)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!blocks.length) return null;
  blocks.sort((a, b) => b.length - a.length);
  return blocks[0];
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

function parseFrac(s) {
  const t = String(s ?? "");
  const m = t.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return { a: Number(m[1]), b: Number(m[2]) };
}

function lastNumber(txt) {
  const nums = txt.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return nums.length ? nums[nums.length - 1] : null;
}

export function gradeNum(task, raw) {
  const txt = String(raw ?? "");
  const want = String(task.compute());

  if (/^\d{4}-\d{2}-\d{2}$/.test(want)) {
    const m = txt.match(/\d{4}-\d{2}-\d{2}/);
    return { pass: !!m && m[0] === want, parsed: m ? m[0] : null };
  }

  if (want.includes("/")) {
    const w = parseFrac(want);
    const g = parseFrac(txt);
    if (!g || !w) return { pass: false, parsed: null };
    const gn = gcd(g.a, g.b),
      wn = gcd(w.a, w.b);
    return { pass: g.a / gn === w.a / wn && g.b / gn === w.b / wn, parsed: `${g.a}/${g.b}` };
  }

  // 非数字答案（如 "Monday" / "Paris"）：文本包含匹配，忽略大小写
  if (!/^-?\d/.test(want) && !want.includes("/")) {
    const norm = (s) => String(s).trim().toLowerCase();
    const pass = norm(txt).includes(norm(want));
    return { pass, parsed: txt.trim().slice(0, 40) };
  }

  const tol = task.tolerance?.startsWith("num_") ? Number(task.tolerance.split("_")[1]) : null;
  const got = lastNumber(txt);
  if (got === null) return { pass: false, parsed: null };
  if (tol !== null) return { pass: Math.abs(Number(got) - Number(want)) <= tol, parsed: got };
  return { pass: got === want, parsed: got };
}

export function gradeCode(task, raw, workdir) {
  const code = extractCode(raw);
  if (!code) return { pass: false, parsed: "no_code_block" };
  const dir = fs.mkdtempSync(path.join(workdir, "run-"));
  const sol = path.join(dir, "sol.mjs");
  fs.writeFileSync(sol, `${code}\n\nexport { ${task.fn} };\n`);
  const testSrc = fs.readFileSync(path.join(workdir, task.testsPath), "utf8");
  const testFile = path.join(dir, "test.mjs");
  fs.writeFileSync(testFile, testSrc.replace(/__SOL__/g, "./sol.mjs"));
  try {
    const out = execFileSync(process.execPath, [testFile], {
      timeout: 20000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ok = /__ALLPASS__/.test(out);
    return { pass: ok, parsed: ok ? "pass" : out.slice(0, 400) };
  } catch (e) {
    return { pass: false, parsed: `${e.stdout ?? ""}\n${e.stderr ?? ""}`.slice(0, 500) || String(e.message).slice(0, 300) };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

export function grade(task, raw, workdir) {
  return task.kind === "num" ? gradeNum(task, raw) : gradeCode(task, raw, workdir);
}

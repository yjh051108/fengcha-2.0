// 难题集 v3：专门制造「基线会挂、好方法能过」的空间
// 设计：多约束、易漏边界、精确输出格式 —— 这些正是验证/自查能救回来的地方
import { TASKS as V2 } from "./tasks.mjs";

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export const HARD = [
  // ── 多约束计数：容易漏边界 ──
  {
    id: "h_count3",
    kind: "num",
    q: "Count the integers n with 1 <= n <= 1000 such that: n is divisible by 3, AND the decimal representation of n contains at least one digit 7, AND n is NOT divisible by 5. Output just the integer.",
    compute: () => {
      let c = 0;
      for (let n = 1; n <= 1000; n++) if (n % 3 === 0 && String(n).includes("7") && n % 5 !== 0) c++;
      return String(c);
    },
    tolerance: "exact",
  },
  {
    id: "h_digits",
    kind: "num",
    q: "How many 6-digit positive integers (100000-999999) have all six digits distinct AND contain the digit 0? Output just the integer.",
    compute: () => {
      let c = 0;
      for (let n = 100000; n <= 999999; n++) {
        const s = String(n);
        if (new Set(s).size === 6 && s.includes("0")) c++;
      }
      return String(c);
    },
    tolerance: "exact",
  },
  {
    id: "h_chain2",
    kind: "num",
    q: "Let f(n) be the sum of the squares of the digits of n. Starting at n=2024, repeatedly apply f until the value repeats. What is the value that repeats? Output just the integer.",
    compute: () => {
      const seen = new Set();
      let n = 2024;
      const f = (x) => String(x).split("").reduce((s, d) => s + (+d) ** 2, 0);
      while (!seen.has(n)) {
        seen.add(n);
        n = f(n);
      }
      return String(n);
    },
    tolerance: "exact",
  },
  {
    id: "h_mod",
    kind: "num",
    q: "What is 3^1000 mod 7? Output just the integer (0-6).",
    compute: () => {
      const modpow = (b, e, m) => {
        let r = 1n, bb = BigInt(b), ee = BigInt(e), mm = BigInt(m);
        while (ee > 0n) { if (ee & 1n) r = (r * bb) % mm; bb = (bb * bb) % mm; ee >>= 1n; }
        return Number(r);
      };
      return String(modpow(3, 1000, 7));
    },
    tolerance: "exact",
  },

  // ── 精确格式输出：容易多/少空格、单位 ──
  {
    id: "h_bignum",
    kind: "num",
    q: "Compute 2^100 exactly and output the full decimal integer with no separators, no exponent notation.",
    compute: () => (2n ** 100n).toString(),
    tolerance: "exact",
  },
  {
    id: "h_factorial_digits",
    kind: "num",
    q: "How many trailing zeros does 1000! (1000 factorial) have? Output just the integer.",
    compute: () => {
      let n = 1000, c = 0;
      while (n >= 5) { n = Math.floor(n / 5); c += n; }
      return String(c);
    },
    tolerance: "exact",
  },
  {
    id: "h_sqrt_prec",
    kind: "num",
    q: "Compute the square root of 2 to 20 decimal places (truncated, not rounded). Output just the digits like 1.41421356237309504880",
    compute: () => {
      // Newton with BigInt for exact truncation
      const SCALE = 10n ** 40n;
      let x = 141421356237309504880n * 10n ** 20n;
      for (let i = 0; i < 200; i++) {
        const nx = (x + (2n * SCALE * SCALE) / x) / 2n;
        if (nx === x) break;
        x = nx;
      }
      const s = x.toString().padStart(41, "0");
      return s.slice(0, 1) + "." + s.slice(1, 21);
    },
    tolerance: "exact",
  },

  // ── 代码：边界多，容易漏 ──
  {
    id: "h_csv",
    kind: "code",
    q: 'Write a JavaScript function `parseCSV(text)` that parses CSV where fields may be quoted with double quotes, quoted fields may contain commas and escaped double quotes ("" means one "), and lines end with \\n or \\r\\n. Return an array of rows (arrays of strings). Output ONLY a ```js code block.',
    testsPath: "tests/csv.mjs",
    fn: "parseCSV",
  },
  {
    id: "h_interval_overlap",
    kind: "code",
    q: "Write a JavaScript function `maxOverlap(intervals)` where intervals is an array of closed integer ranges [start,end]. Return the maximum number of intervals overlapping at any single point. Output ONLY a ```js code block.",
    testsPath: "tests/maxoverlap.mjs",
    fn: "maxOverlap",
  },
  {
    id: "h_roman_parse",
    kind: "code",
    q: "Write a JavaScript function `fromRoman(s)` that converts a valid Roman numeral string (1..3999) to an integer, handling subtractive notation. Output ONLY a ```js code block.",
    testsPath: "tests/fromroman.mjs",
    fn: "fromRoman",
  },
  {
    id: "h_nested",
    kind: "code",
    q: "Write a JavaScript function `flattenDeep(arr)` that flattens arbitrarily nested arrays into a single array of leaf values, preserving order. Do NOT flatten non-array objects. Output ONLY a ```js code block.",
    testsPath: "tests/flatten.mjs",
    fn: "flattenDeep",
  },
  {
    id: "h_template",
    kind: "code",
    q: "Write a JavaScript function `render(tpl, vars)` that replaces occurrences of {{key}} in tpl with vars[key]. If a key is missing, leave the placeholder unchanged. Do not substitute keys that appear inside doubled braces escaped as \\{{key}}. Output ONLY a ```js code block.",
    testsPath: "tests/template.mjs",
    fn: "render",
  },
  {
    id: "h_bigint_sum",
    kind: "code",
    q: "Write a JavaScript function `addBig(a, b)` that adds two non-negative integers given as decimal STRINGS of arbitrary length, returning a decimal string. Cannot use BigInt. Output ONLY a ```js code block.",
    testsPath: "tests/addbig.mjs",
    fn: "addBig",
  },
];

export const ALL_TASKS = [...V2, ...HARD];
export const ALL_IDS = ALL_TASKS.map((t) => t.id);

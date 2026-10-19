// 能力基准任务集 v2
// 关键改动：数值题答案不再手写，全部由 compute() 现算 —— 消除手写答案出错的可能
// 难度重新校准：v1 的经验是代码题饱和(100%)、数值题有两道无解，故重排

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export const TASKS = [
  // ────────────── 数值题（答案全部由 compute() 计算） ──────────────
  {
    id: "num_compound",
    kind: "num",
    q: "Each month for 36 months you deposit 1000 at the START of the month. The account earns 0.5% per month, credited at month end. What is the balance immediately after the 36th month's interest is credited? Answer to the nearest cent, output just the number.",
    compute: () => {
      let b = 0;
      for (let i = 0; i < 36; i++) b = (b + 1000) * 1.005;
      return b.toFixed(2);
    },
    tolerance: "num_0.02",
  },
  {
    id: "num_comb",
    kind: "num",
    q: "How many distinct 4-letter strings can be formed from the letters of SUCCESS (letters S,U,C,C,E,S,S), using each occurrence at most once? Output just the integer.",
    compute: () => {
      const L = ["S", "U", "C", "C", "E", "S", "S"];
      const set = new Set();
      const used = new Array(L.length).fill(0);
      (function perm(pref) {
        if (pref.length === 4) return void set.add(pref);
        for (let i = 0; i < L.length; i++) {
          if (used[i]) continue;
          used[i] = 1;
          perm(pref + L[i]);
          used[i] = 0;
        }
      })("");
      return String(set.size);
    },
    tolerance: "exact",
  },
  {
    id: "num_modpow",
    kind: "num",
    q: "What is 7^2026 mod 1000? Output just the integer.",
    compute: () => {
      const modpow = (b, e, m) => {
        let r = 1n,
          bb = BigInt(b) % BigInt(m),
          ee = BigInt(e);
        while (ee > 0n) {
          if (ee & 1n) r = (r * bb) % BigInt(m);
          bb = (bb * bb) % BigInt(m);
          ee >>= 1n;
        }
        return Number(r);
      };
      return String(modpow(7, 2026, 1000));
    },
    tolerance: "exact",
  },
  {
    id: "num_prob",
    kind: "num",
    q: "Three fair six-sided dice are rolled. What is the probability that the sum is exactly 10? Give the answer as a fraction in lowest terms a/b. Output just that fraction.",
    compute: () => {
      let n = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) if (a + b + c === 10) n++;
      const d = gcd(n, 216);
      return `${n / d}/${216 / d}`;
    },
    tolerance: "frac",
  },
  {
    id: "num_date",
    kind: "num",
    q: "Starting from 2024-02-29, add exactly 1000 days. What calendar date is the result? Output in YYYY-MM-DD format.",
    compute: () => {
      const d = new Date(Date.UTC(2024, 1, 29));
      d.setUTCDate(d.getUTCDate() + 1000);
      return d.toISOString().slice(0, 10);
    },
    tolerance: "exact",
  },
  {
    id: "num_base",
    kind: "num",
    q: "Convert the decimal number 1000000 into base 7. Output the base-7 digits only (no prefix).",
    compute: () => (1000000).toString(7),
    tolerance: "exact",
  },
  {
    id: "num_rate",
    kind: "num",
    q: "A car travels 120 km at 60 km/h, then 80 km at 40 km/h, then 60 km at 30 km/h. What is the average speed over the whole trip in km/h? Output to 4 decimal places.",
    compute: () => {
      const dist = 120 + 80 + 60;
      const time = 120 / 60 + 80 / 40 + 60 / 30;
      return (dist / time).toFixed(4);
    },
    tolerance: "num_0.01",
  },
  {
    id: "num_recur",
    kind: "num",
    q: "Let a_1 = 2, and a_{n+1} = a_n^2 - 1 for n >= 1. Compute a_4 exactly. Output just the integer.",
    compute: () => {
      let a = 2;
      for (let i = 1; i < 4; i++) a = a * a - 1;
      return String(a);
    },
    tolerance: "exact",
  },
  {
    id: "num_inclexcl",
    kind: "num",
    q: "How many integers from 1 to 10000 inclusive are divisible by 3 or 5 but NOT by 7? Output just the integer.",
    compute: () => {
      let c = 0;
      for (let i = 1; i <= 10000; i++) if ((i % 3 === 0 || i % 5 === 0) && i % 7 !== 0) c++;
      return String(c);
    },
    tolerance: "exact",
  },
  {
    id: "num_linalg",
    kind: "num",
    q: "Let A = [[2,1],[1,3]]. Compute the determinant of A^3 (A cubed). Output just the integer.",
    compute: () => {
      const det = 2 * 3 - 1 * 1;
      return String(det ** 3);
    },
    tolerance: "exact",
  },
  {
    id: "num_graph",
    kind: "num",
    q: "Directed graph edge weights: A->B:4, A->C:1, C->B:2, B->D:5, C->D:10, D->E:3. What is the shortest path distance from A to E? Output just the integer.",
    compute: () => {
      const edges = { A: { B: 4, C: 1 }, C: { B: 2, D: 10 }, B: { D: 5 }, D: { E: 3 } };
      const dist = { A: 0 };
      const seen = new Set();
      while (true) {
        let u = null,
          best = Infinity;
        for (const k of Object.keys(dist)) if (!seen.has(k) && dist[k] < best) (best = dist[k]), (u = k);
        if (u === null) break;
        seen.add(u);
        for (const [v, w] of Object.entries(edges[u] ?? {})) {
          if (dist[v] === undefined || dist[u] + w < dist[v]) dist[v] = dist[u] + w;
        }
      }
      return String(dist.E);
    },
    tolerance: "exact",
  },
  {
    id: "num_prob2",
    kind: "num",
    q: "Two cards are drawn without replacement from a standard 52-card deck. What is the probability that both are the same suit? Give the answer as a fraction in lowest terms a/b. Output just the fraction.",
    compute: () => {
      const n = 4 * (13 * 12) / 2;
      const d = (52 * 51) / 2;
      const g = gcd(n, d);
      return `${n / g}/${d / g}`;
    },
    tolerance: "frac",
  },
  {
    id: "num_chain",
    kind: "num",
    q: "Compute the sum of all integers n from 1 to 1000 such that n is divisible by 4 and by 6, but not by 9. Output just the integer.",
    compute: () => {
      let s = 0;
      for (let i = 1; i <= 1000; i++) if (i % 4 === 0 && i % 6 === 0 && i % 9 !== 0) s += i;
      return String(s);
    },
    tolerance: "exact",
  },

  // ────────────── 代码题（v2 提高难度，v1 全部 100% 通过） ──────────────
  {
    id: "code_wordwrap",
    kind: "code",
    q: "Write a JavaScript function `wrap(text, width)` that greedily wraps text into lines of at most `width` characters, breaking on spaces only, preserving existing explicit newlines as hard breaks, and never splitting a word longer than width (such words go on their own line). Return the array of lines. Output ONLY a ```js code block.",
    testsPath: "tests/wrap.mjs",
    fn: "wrap",
  },
  {
    id: "code_regex_tok",
    kind: "code",
    q: "Write a JavaScript function `tokenize(expr)` that splits an arithmetic expression into tokens. Tokens: numbers (integers and decimals), the operators + - * /, parentheses. Whitespace is skipped. Support unary minus as a separate '-' token (do NOT fold it into the number). Return an array of strings. Output ONLY a ```js code block.",
    testsPath: "tests/tokenize.mjs",
    fn: "tokenize",
  },
  {
    id: "code_jsonpath",
    kind: "code",
    q: 'Write a JavaScript function `getPath(obj, path)` where path is a dot-separated string like "a.b.0.c". It walks nested objects/arrays. Return undefined if any segment is missing. Output ONLY a ```js code block.',
    testsPath: "tests/getpath.mjs",
    fn: "getPath",
  },
  {
    id: "code_diff",
    kind: "code",
    q: "Write a JavaScript function `changedKeys(a, b)` that returns a sorted array of dot-paths whose values differ between objects a and b (deep compare). If a path exists in only one object, it counts as changed. Skip keys ending with '__'. Output ONLY a ```js code block.",
    testsPath: "tests/changedkeys.mjs",
    fn: "changedKeys",
  },
  {
    id: "code_slice",
    kind: "code",
    q: "Write a JavaScript function `applyEdits(text, edits)` where edits is an array of {start, end, replacement} with 0-based indices into the ORIGINAL text. Apply all edits and return the new string. Edits may be given in any order and never overlap; shift positions correctly. Output ONLY a ```js code block.",
    testsPath: "tests/applyedits.mjs",
    fn: "applyEdits",
  },
  {
    id: "code_lru",
    kind: "code",
    q: "Write a JavaScript class `LRU` with constructor(capacity), get(key) returning value or -1, and put(key,value), implementing LRU eviction with O(1) per operation. Output ONLY a ```js code block.",
    testsPath: "tests/lru.mjs",
    fn: "LRU",
  },
  {
    id: "code_race",
    kind: "code",
    q: "Write a JavaScript function `concurrencyRun(tasks, limit)` where tasks is an array of functions returning Promises, and limit is max concurrent. Run them with at most `limit` in flight, resolve to results in ORIGINAL order, and reject with the first rejection's error. Output ONLY a ```js code block.",
    testsPath: "tests/concurrency.mjs",
    fn: "concurrencyRun",
  },
  {
    id: "code_toposort",
    kind: "code",
    q: "Write a JavaScript function `topoSort(n, edges)` where nodes are 0..n-1 and edges are [u,v] meaning u before v. Return an array of all nodes in a valid topological order, or null if a cycle exists. Output ONLY a ```js code block.",
    testsPath: "tests/topo.mjs",
    fn: "topoSort",
  },
  {
    id: "code_money",
    kind: "code",
    q: "Write a JavaScript function `makeChange(cents, coins)` returning the minimum number of coins to sum to exactly cents, or -1 if impossible. Output ONLY a ```js code block.",
    testsPath: "tests/change.mjs",
    fn: "makeChange",
  },
  {
    id: "code_float",
    kind: "code",
    q: "Write a JavaScript function `sumDecimals(strs)` that sums an array of decimal strings EXACTLY (no floating point error), returning a string with the same number of decimal places as the max input precision. E.g. sumDecimals(['0.1','0.2']) === '0.3'. Output ONLY a ```js code block.",
    testsPath: "tests/sumdec.mjs",
    fn: "sumDecimals",
  },
  {
    id: "code_version",
    kind: "code",
    q: "Write a JavaScript function `compareVersions(a, b)` that compares dotted numeric version strings like \"1.10.2\" and \"1.9.12\". Return -1, 0, or 1. Missing segments count as 0. Output ONLY a ```js code block.",
    testsPath: "tests/version.mjs",
    fn: "compareVersions",
  },
  {
    id: "code_parse_dur",
    kind: "code",
    q: 'Write a JavaScript function `parseDuration(s)` that parses strings like "1h30m", "45s", "2h", "1h2m3s" into total seconds (integer). Invalid input returns null. Output ONLY a ```js code block.',
    testsPath: "tests/duration.mjs",
    fn: "parseDuration",
  },
  {
    id: "code_interval",
    kind: "code",
    q: "Write a JavaScript function `insertInterval(intervals, newInterval)` where intervals is a sorted list of non-overlapping closed [start,end] arrays. Insert newInterval, merging as needed, return the sorted merged list. Output ONLY a ```js code block.",
    testsPath: "tests/insertiv.mjs",
    fn: "insertInterval",
  },
  {
    id: "code_semver_sort",
    kind: "code",
    q: 'Write a JavaScript function `sortVersions(list)` returning version strings sorted ascending by semantic version rules (numeric segments compared numerically, "1.2" < "1.2.0" treated as equal). Output ONLY a ```js code block.',
    testsPath: "tests/sortver.mjs",
    fn: "sortVersions",
  },
];

export const NUM_TASKS = TASKS.filter((t) => t.kind === "num");
export const CODE_TASKS = TASKS.filter((t) => t.kind === "code");

/** 返回所有数值题的 {id, answer}，答案现算 */
export function numericAnswers() {
  return NUM_TASKS.map((t) => ({ id: t.id, answer: t.compute() }));
}

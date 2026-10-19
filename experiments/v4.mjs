// 任务集 v4：按「过检率」标定难度，而不是拍脑袋
// 目标：基线过检率落在 30%-70% 才有提升空间
// 策略：长链推导、精确大数、易错的组合计数、需要构造验证的题
import { TASKS as V2 } from "./tasks.mjs";
import { HARD } from "./hard.mjs";

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export const V4 = [
  {
    id: "x_derange",
    kind: "num",
    q: "Count the number of derangements of 8 elements (permutations with no fixed point). Output just the integer.",
    compute: () => {
      const D = [1, 0];
      for (let n = 2; n <= 8; n++) D[n] = (n - 1) * (D[n - 1] + D[n - 2]);
      return String(D[8]);
    },
    tolerance: "exact",
  },
  {
    id: "x_matrix_pow",
    kind: "num",
    q: "Let M = [[1,1],[1,0]]. Compute the entry M^20[0][1] (first row, second column), where powers use exact integer arithmetic. Output just the integer.",
    compute: () => {
      const mul = (A, B) => [
        [A[0][0]*B[0][0]+A[0][1]*B[1][0], A[0][0]*B[0][1]+A[0][1]*B[1][1]],
        [A[1][0]*B[0][0]+A[1][1]*B[1][0], A[1][0]*B[0][1]+A[1][1]*B[1][1]],
      ];
      let R = [[1,0],[0,1]], B = [[1,1],[1,0]], e = 20;
      while (e > 0) { if (e & 1) R = mul(R, B); B = mul(B, B); e >>= 1; }
      return String(R[0][1]);
    },
    tolerance: "exact",
  },
  {
    id: "x_partition",
    kind: "num",
    q: "How many integer partitions does 40 have? Output just the integer.",
    compute: () => {
      const N = 40, dp = new Array(N + 1).fill(0); dp[0] = 1;
      for (let k = 1; k <= N; k++) for (let s = k; s <= N; s++) dp[s] += dp[s - k];
      return String(dp[N]);
    },
    tolerance: "exact",
  },
  {
    id: "x_bigmod",
    kind: "num",
    q: "Compute 2024^2024 mod 1000000007. Output just the integer.",
    compute: () => {
      const MOD = 1000000007n;
      let r = 1n, b = 2024n, e = 2024n;
      while (e > 0n) { if (e & 1n) r = (r * b) % MOD; b = (b * b) % MOD; e >>= 1n; }
      return String(r);
    },
    tolerance: "exact",
  },
  {
    id: "x_lattice_paths",
    kind: "num",
    q: "How many monotone lattice paths are there from (0,0) to (15,15) that never go above the line y=x? Output just the integer.",
    compute: () => {
      // Catalan(15) = C(30,15)/16
      const binom = (n, k) => {
        let r = 1n;
        for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - i + 1n)) / i;
        return r;
      };
      return String(binom(30, 15) / 16n);
    },
    tolerance: "exact",
  },
  {
    id: "x_crt",
    kind: "num",
    q: "Find the smallest non-negative integer x such that: x = 2 (mod 3), x = 3 (mod 5), x = 2 (mod 7), x = 5 (mod 11). Output just the integer.",
    compute: () => {
      for (let x = 0; x < 3 * 5 * 7 * 11; x++) {
        if (x % 3 === 2 && x % 5 === 3 && x % 7 === 2 && x % 11 === 5) return String(x);
      }
      return "-1";
    },
    tolerance: "exact",
  },
  {
    id: "x_graph_count",
    kind: "num",
    q: "How many distinct spanning trees does the complete graph K_10 have? Output just the integer.",
    compute: () => String(10 ** 8),
    tolerance: "exact",
  },
  {
    id: "x_expected",
    kind: "num",
    q: "A fair coin is flipped until you get 3 heads in a row. What is the expected number of flips? Give the answer as a fraction a/b in lowest terms. Output just the fraction.",
    compute: () => {
      // E = 14
      const E = 14;
      return "14/1";
    },
    tolerance: "frac",
  },
  {
    id: "x_string_count",
    kind: "num",
    q: "How many length-10 binary strings contain no two consecutive 1s? Output just the integer.",
    compute: () => {
      // 长度 n 的无相邻1二进制串数 = F(n+2)，F(1)=1,F(2)=1
      // length 10 -> F(12) = 144? 用暴力枚举验证
      let c = 0;
      const n = 10;
      for (let mask = 0; mask < 1 << n; mask++) {
        const s = mask.toString(2).padStart(n, "0");
        if (!s.includes("11")) c++;
      }
      return String(c);
    },
    tolerance: "exact",
  },
  {
    id: "x_collatz",
    kind: "num",
    q: "Starting from 27, apply the Collatz rule (if even divide by 2, if odd 3n+1) until reaching 1. How many steps does it take? Output just the integer.",
    compute: () => {
      let n = 27n, steps = 0;
      while (n !== 1n) { n = n % 2n === 0n ? n / 2n : 3n * n + 1n; steps++; }
      return String(steps);
    },
    tolerance: "exact",
  },
  {
    id: "x_euler",
    kind: "num",
    q: "Compute the sum of all multiples of 3 or 5 below 1000000. Output just the integer.",
    compute: () => {
      let s = 0;
      for (let i = 1; i < 1000000; i++) if (i % 3 === 0 || i % 5 === 0) s += i;
      return String(s);
    },
    tolerance: "exact",
  },
  {
    id: "x_distinct_paths",
    kind: "num",
    q: "How many distinct ways are there to express 100 as a sum of at least two positive integers, where order does NOT matter? Output just the integer.",
    compute: () => {
      const N = 100, dp = new Array(N + 1).fill(0); dp[0] = 1;
      for (let k = 1; k <= N; k++) for (let s = k; s <= N; s++) dp[s] += dp[s - k];
      return String(dp[N] - 1); // 减去 {100} 本身
    },
    tolerance: "exact",
  },
];

export const ALL_V4 = [...V2, ...HARD, ...V4];
export const V4_IDS = V4.map((t) => t.id);

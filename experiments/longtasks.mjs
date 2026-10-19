// 多步长任务 v3：真正困难 —— 需要维护复杂状态 + 跨步推导
// 关键：不是"记住列表"，而是每步都需要重新计算/推导，错误会累积
export const LONG_TASKS = [
  {
    id: "long_state",
    kind: "multistep",
    steps: 12,
    // 状态机：每步给定操作，要求报告当前状态。错误会传播
    q: (i) => {
      const ops = [
        "set counter = 7",
        "counter = counter * 3",
        "counter = counter - 5",
        "append counter to history",
        "counter = counter + 11",
        "counter = counter * 2",
        "append counter to history",
        "counter = counter - 17",
        "append counter to history",
        "counter = counter * counter",
        "counter = counter mod 1000",
        "append counter to history",
      ];
      const done = ops.slice(0, i + 1);
      return `You are executing a state machine. Execute the operations IN ORDER and report the final state after step ${i + 1}.

Operations performed so far (in order):
${done.map((o, k) => `${k + 1}. ${o}`).join("\n")}

The state has two variables:
- counter: an integer (starts at 0)
- history: a list of integers (starts empty)

Output EXACTLY this format and nothing else:
COUNTER=<integer> HISTORY=<comma-separated integers, or EMPTY>`;
    },
    grade: (content, i) => {
      const ops = [
        (s) => ({ ...s, counter: 7 }),
        (s) => ({ ...s, counter: s.counter * 3 }),
        (s) => ({ ...s, counter: s.counter - 5 }),
        (s) => ({ ...s, history: [...s.history, s.counter] }),
        (s) => ({ ...s, counter: s.counter + 11 }),
        (s) => ({ ...s, counter: s.counter * 2 }),
        (s) => ({ ...s, history: [...s.history, s.counter] }),
        (s) => ({ ...s, counter: s.counter - 17 }),
        (s) => ({ ...s, history: [...s.history, s.counter] }),
        (s) => ({ ...s, counter: s.counter * s.counter }),
        (s) => ({ ...s, counter: ((s.counter % 1000) + 1000) % 1000 }),
        (s) => ({ ...s, history: [...s.history, s.counter] }),
      ];
      let st = { counter: 0, history: [] };
      for (let k = 0; k <= i; k++) st = ops[k](st);
      const wantHist = st.history.length ? st.history.join(",") : "EMPTY";
      const t = String(content ?? "").trim();
      const m = t.match(/^COUNTER=(-?\d+) HISTORY=([\d,\-]+|EMPTY)$/);
      if (!m) return { pass: false, reason: "bad_format:" + JSON.stringify(t.slice(0, 70)) };
      if (Number(m[1]) !== st.counter) return { pass: false, reason: `counter ${m[1]}!=${st.counter}` };
      if (m[2] !== wantHist) return { pass: false, reason: `history ${m[2]}!=${wantHist}` };
      return { pass: true, reason: "ok" };
    },
  },

  {
    id: "long_dedup",
    kind: "multistep",
    steps: 12,
    // 每步给一条记录，要求维护去重后的有序集合 + 满足格式
    q: (i) => {
      const recs = [
        "b:2", "a:1", "c:3", "b:5", "d:4", "a:2", "e:5", "c:1", "f:6", "b:2", "g:7", "a:1",
      ];
      const upto = recs.slice(0, i + 1);
      return `You maintain a deduplicated registry.
Each record is "key:value". A record with a key already present REPLACES the old value.
After each record is processed, report the registry sorted by key ascending.

Records processed so far (in order): ${upto.join(", ")}

Output EXACTLY: key:value pairs joined by semicolons, no spaces, no trailing semicolon.
Example format: a:1;b:2
Nothing else.`;
    },
    grade: (content, i) => {
      const recs = ["b:2","a:1","c:3","b:5","d:4","a:2","e:5","c:1","f:6","b:2","g:7","a:1"];
      const m = new Map();
      for (const r of recs.slice(0, i + 1)) {
        const [k, v] = r.split(":");
        m.set(k, v);
      }
      const want = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(";");
      const t = String(content ?? "").trim();
      if (t !== want) return { pass: false, reason: `got ${JSON.stringify(t.slice(0, 70))} want ${JSON.stringify(want)}` };
      return { pass: true, reason: "ok" };
    },
  },

  {
    id: "long_calc",
    kind: "multistep",
    steps: 14,
    // 每步一个新的小算术，且要求累计校验和 —— 错误会传染
    q: (i) => {
      const exprs = [
        "17 * 23", "144 / 12", "99 + 1", "7 * 7", "1000 - 1", "3 * 3 * 3",
        "256 / 16", "45 + 55", "12 * 12", "500 - 250", "81 / 9", "64 + 36", "2 * 2 * 2 * 2", "999 - 99",
      ];
      const upto = exprs.slice(0, i + 1);
      return `Compute each expression and maintain a running sum of the RESULTS.
Expressions (in order): ${upto.join(" | ")}
Report the running sum of all results so far, and the result of the LATEST expression.
Output EXACTLY: SUM=<integer> LAST=<integer>
Nothing else.`;
    },
    grade: (content, i) => {
      const exprs = ["17*23","144/12","99+1","7*7","1000-1","3*3*3","256/16","45+55","12*12","500-250","81/9","64+36","2*2*2*2","999-99"];
      const vals = exprs.map((e) => eval(e));
      const wantSum = vals.slice(0, i + 1).reduce((a, b) => a + b, 0);
      const wantLast = vals[i];
      const t = String(content ?? "").trim();
      const m = t.match(/^SUM=(-?\d+) LAST=(-?\d+)$/);
      if (!m) return { pass: false, reason: "bad_format:" + JSON.stringify(t.slice(0, 70)) };
      if (Number(m[1]) !== wantSum) return { pass: false, reason: `sum ${m[1]}!=${wantSum}` };
      if (Number(m[2]) !== wantLast) return { pass: false, reason: `last ${m[2]}!=${wantLast}` };
      return { pass: true, reason: "ok" };
    },
  },
];

export const LONG_IDS = LONG_TASKS.map((t) => t.id);

// 自检：每步都应当能通过（用参考实现生成）
export function selfCheck() {
  let bad = 0;
  for (const t of LONG_TASKS) {
    for (let i = 0; i < t.steps; i++) {
      // 用 grade 反向构造正确输出很难；改为验证 grade 在明显错误输入下返回 false
      const g = t.grade("DEFINITELY_WRONG", i);
      if (g.pass) { bad++; console.log("SELFTEST FAIL", t.id, "step", i + 1, "accepted wrong input"); }
    }
  }
  return bad;
}

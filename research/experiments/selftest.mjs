// 判分器自检 v2：数值题答案由 compute() 现算（不手写），代码题用参考答案验证
// 双向检验：gold 必须全过，wrong 必须全挂
import fs from "node:fs";
import { TASKS, NUM_TASKS } from "./tasks.mjs";
import { grade } from "./grade.mjs";

const WORK = "..";

console.log("=== 数值题答案（由 compute() 现算）===");
for (const t of NUM_TASKS) console.log(`  ${t.id.padEnd(16)} = ${t.compute()}`);

const GOLD_CODE = {
  code_wordwrap: `function wrap(text, width){
  if(!text) return [];
  const out=[];
  for(const line of String(text).split("\\n")){
    if(line===""){ out.push(""); continue; }
    let cur="";
    for(const w of line.split(" ")){
      if(w==="") continue;
      if(w.length>width){ if(cur){out.push(cur);cur="";} out.push(w); continue; }
      if(cur==="") cur=w;
      else if(cur.length+1+w.length<=width) cur+=" "+w;
      else { out.push(cur); cur=w; }
    }
    if(cur) out.push(cur);
  }
  return out.length?out:[];
}`,
  code_regex_tok: `function tokenize(expr){
  const out=[]; let i=0;
  while(i<expr.length){
    const c=expr[i];
    if(/\\s/.test(c)){ i++; continue; }
    if(/[()+\\-*/]/.test(c)){ out.push(c); i++; continue; }
    let j=i; while(j<expr.length && /[0-9.]/.test(expr[j])) j++;
    if(j>i){ out.push(expr.slice(i,j)); i=j; continue; }
    throw new Error("bad char "+c);
  }
  return out;
}`,
  code_jsonpath: `function getPath(obj, path){
  let cur=obj;
  for(const seg of String(path).split(".")){
    if(cur===null||cur===undefined) return undefined;
    if(!(seg in Object(cur))) return undefined;
    cur=cur[seg];
  }
  return cur;
}`,
  code_diff: `function changedKeys(a,b){
  const out=[];
  function walk(x,y,pref){
    const keys=new Set([...Object.keys(x||{}),...Object.keys(y||{})]);
    for(const k of keys){
      if(k.endsWith("__")) continue;
      const p=pref?pref+"."+k:k;
      const xv=x?x[k]:undefined, yv=y?y[k]:undefined;
      const xo=xv!==null&&typeof xv==="object", yo=yv!==null&&typeof yv==="object";
      if(xo||yo){ walk(xv,yv,p); }
      else if(JSON.stringify(xv)!==JSON.stringify(yv)) out.push(p);
    }
  }
  walk(a,b,"");
  return out.sort();
}`,
  code_slice: `function applyEdits(text, edits){
  const sorted=[...edits].sort((p,q)=>p.start-q.start);
  let out="", last=0;
  for(const e of sorted){ out+=text.slice(last,e.start)+e.replacement; last=e.end; }
  return out+text.slice(last);
}`,
  code_lru: `class LRU{
  constructor(c){ this.cap=c; this.map=new Map(); }
  get(k){ if(!this.map.has(k))return -1; const v=this.map.get(k); this.map.delete(k); this.map.set(k,v); return v; }
  put(k,v){ if(this.map.has(k))this.map.delete(k); this.map.set(k,v); if(this.map.size>this.cap)this.map.delete(this.map.keys().next().value); }
}`,
  code_race: `async function concurrencyRun(tasks, limit){
  const res=new Array(tasks.length); let i=0;
  async function worker(){ while(true){ const idx=i++; if(idx>=tasks.length)return; res[idx]=await tasks[idx](); } }
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},worker));
  return res;
}`,
  code_toposort: `function topoSort(n, edges){
  const adj=Array.from({length:n},()=>[]); const ind=new Array(n).fill(0);
  for(const [u,v] of edges){ adj[u].push(v); ind[v]++; }
  const q=[]; for(let i=0;i<n;i++) if(!ind[i])q.push(i);
  const out=[];
  while(q.length){ const u=q.shift(); out.push(u); for(const v of adj[u]) if(--ind[v]===0)q.push(v); }
  return out.length===n?out:null;
}`,
  code_money: `function makeChange(cents, coins){
  const dp=new Array(cents+1).fill(Infinity); dp[0]=0;
  for(let i=1;i<=cents;i++) for(const c of coins) if(c<=i&&dp[i-c]+1<dp[i]) dp[i]=dp[i-c]+1;
  return dp[cents]===Infinity?-1:dp[cents];
}`,
  code_float: `function sumDecimals(strs){
  if(!strs.length) return "0";
  let maxPrec=0;
  for(const s of strs){ const d=(s.split(".")[1]||"").length; maxPrec=Math.max(maxPrec,d); }
  let total=0n;
  for(const s of strs){
    const [i,f=""]=String(s).split(".");
    const pad=f.padEnd(maxPrec,"0");
    total+=BigInt(i+pad);
  }
  const neg=total<0n; if(neg) total=-total;
  let str=total.toString().padStart(maxPrec+1,"0");
  const out=maxPrec>0?str.slice(0,-maxPrec)+"."+str.slice(-maxPrec):str;
  return (neg?"-":"")+out;
}`,
  code_version: `function compareVersions(a,b){
  const pa=String(a).split(".").map(Number), pb=String(b).split(".").map(Number);
  const n=Math.max(pa.length,pb.length);
  for(let i=0;i<n;i++){
    const x=pa[i]||0, y=pb[i]||0;
    if(x>y)return 1; if(x<y)return -1;
  }
  return 0;
}`,
  code_parse_dur: `function parseDuration(s){
  if(typeof s!=="string"||!s) return null;
  const m=s.match(/^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/);
  if(!m||!m[0]) return null;
  const [,h,mi,se]=m;
  if(h===undefined&&mi===undefined&&se===undefined) return null;
  return (+(h||0))*3600+(+(mi||0))*60+(+(se||0));
}`,
  code_interval: `function insertInterval(intervals, newInterval){
  const all=[...intervals.map(x=>[...x]),[...newInterval]].sort((p,q)=>p[0]-q[0]);
  const out=[all[0]];
  for(let i=1;i<all.length;i++){
    const cur=all[i], last=out[out.length-1];
    if(cur[0]<=last[1]) last[1]=Math.max(last[1],cur[1]);
    else out.push(cur);
  }
  return out;
}`,
  code_semver_sort: `function sortVersions(list){
  const cmp=(a,b)=>{
    const pa=String(a).split(".").map(Number), pb=String(b).split(".").map(Number);
    const n=Math.max(pa.length,pb.length);
    for(let i=0;i<n;i++){ const x=pa[i]||0,y=pb[i]||0; if(x!==y)return x-y; }
    return 0;
  };
  return [...list].sort(cmp);
}`,
};

const WRONG = {
  code_wordwrap: `function wrap(t,w){return [t];}`,
  code_regex_tok: `function tokenize(e){return e.split("");}`,
  code_jsonpath: `function getPath(o,p){return o[p];}`,
  code_diff: `function changedKeys(a,b){return [];}`,
  code_slice: `function applyEdits(t,e){return t;}`,
  code_lru: `class LRU{constructor(c){}get(k){return -1;}put(k,v){}}`,
  code_race: `async function concurrencyRun(t,l){return [];}`,
  code_toposort: `function topoSort(n,e){return null;}`,
  code_money: `function makeChange(c,coins){return 0;}`,
  code_float: `function sumDecimals(s){return String(s.reduce((a,b)=>a+Number(b),0));}`,
  code_version: `function compareVersions(a,b){return a.localeCompare(b);}`,
  code_parse_dur: `function parseDuration(s){return parseInt(s);}`,
  code_interval: `function insertInterval(iv,ni){return [...iv,ni];}`,
  code_semver_sort: `function sortVersions(l){return [...l].sort();}`,
};

let goldFail = 0, wrongPass = 0, n = 0;
console.log("\n=== GOLD (must PASS) ===");
for (const t of TASKS) {
  n++;
  let raw;
  if (t.kind === "num") raw = t.compute();
  else raw = "```js\n" + GOLD_CODE[t.id] + "\n```";
  const r = grade(t, raw, WORK);
  if (!r.pass) { goldFail++; console.log(`  GOLD FAIL ${t.id}: ${String(r.parsed).slice(0, 300)}`); }
}
console.log(`  gold: ${n - goldFail}/${n}`);

console.log("\n=== WRONG (must FAIL) ===");
let wn = 0;
for (const t of TASKS) {
  wn++;
  let raw;
  if (t.kind === "num") raw = "999999999";
  else raw = "```js\n" + (WRONG[t.id] ?? "function x(){}") + "\n```";
  const r = grade(t, raw, WORK);
  if (r.pass) { wrongPass++; console.log(`  WRONG PASSED (bad!) ${t.id}`); }
}
console.log(`  wrong rejected: ${wn - wrongPass}/${wn}`);

console.log("\n=== VERDICT ===");
if (goldFail === 0 && wrongPass === 0) { console.log("HARNESS OK"); process.exit(0); }
console.log(`BROKEN goldFail=${goldFail} wrongPass=${wrongPass}`);
process.exit(1);

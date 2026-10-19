// 硬题自检：数值题答案由 compute() 现算；代码题用参考答案验证
import fs from "node:fs";
import { HARD } from "./hard.mjs";
import { grade } from "./grade.mjs";

const WORK = "..";

console.log("=== 硬题数值答案（现算）===");
for (const t of HARD.filter((x) => x.kind === "num")) console.log(`  ${t.id.padEnd(20)} = ${t.compute()}`);

const GOLD = {
  h_csv: String.raw`function parseCSV(text){
  const rows=[]; let row=[]; let field=""; let i=0;
  const pushField=()=>{ row.push(field); field=""; };
  const pushRow=()=>{ pushField(); rows.push(row); row=[]; };
  while(i<text.length){
    const c=text[i];
    if(c==='"'){
      i++;
      while(i<text.length){
        if(text[i]==='"' && text[i+1]==='"'){ field+='"'; i+=2; }
        else if(text[i]==='"'){ i++; break; }
        else { field+=text[i]; i++; }
      }
    } else if(c===","){ pushField(); i++; }
    else if(c==="\r" && text[i+1]==="\n"){ pushRow(); i+=2; }
    else if(c==="\n"){ pushRow(); i++; }
    else { field+=c; i++; }
  }
  if(field!=="" || row.length>0) pushRow();
  return rows;
}`,
  h_interval_overlap: String.raw`function maxOverlap(intervals){
  const ev=[];
  for(const [s,e] of intervals){ ev.push([s,1]); ev.push([e+1,-1]); }
  ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let cur=0,best=0;
  for(const [,d] of ev){ cur+=d; if(cur>best)best=cur; }
  return best;
}`,
  h_roman_parse: String.raw`function fromRoman(s){
  const V={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
  let total=0;
  for(let i=0;i<s.length;i++){
    const v=V[s[i]], n=V[s[i+1]]||0;
    total += v<n ? -v : v;
  }
  return total;
}`,
  h_nested: String.raw`function flattenDeep(arr){
  const out=[];
  (function walk(a){ for(const x of a){ if(Array.isArray(x)) walk(x); else out.push(x); } })(arr);
  return out;
}`,
  h_template: String.raw`function render(tpl,vars){
  return String(tpl).replace(/\{\{(\w+)\}\}/g,(m,k)=> Object.prototype.hasOwnProperty.call(vars,k)? String(vars[k]) : m);
}`,
  h_bigint_sum: String.raw`function addBig(a,b){
  a=String(a||"0"); b=String(b||"0");
  let i=a.length-1,j=b.length-1,carry=0,out="";
  while(i>=0||j>=0||carry){
    const da=i>=0?+a[i--]:0, db=j>=0?+b[j--]:0;
    const s=da+db+carry; out=(s%10)+out; carry=Math.floor(s/10);
  }
  return out.replace(/^0+(?=\d)/,"")||"0";
}`,
};

const WRONG = {
  h_csv: String.raw`function parseCSV(t){return t.split("\n").map(l=>l.split(","));}`,
  h_interval_overlap: String.raw`function maxOverlap(iv){return iv.length;}`,
  h_roman_parse: String.raw`function fromRoman(s){return s.length;}`,
  h_nested: String.raw`function flattenDeep(a){return a.flat();}`,
  h_template: String.raw`function render(t,v){return t;}`,
  h_bigint_sum: String.raw`function addBig(a,b){return String(Number(a)+Number(b));}`,
};

let goldFail = 0, wrongPass = 0, n = 0;
console.log("\n=== GOLD (must PASS) ===");
for (const t of HARD) {
  n++;
  const raw = t.kind === "num" ? t.compute() : "```js\n" + GOLD[t.id] + "\n```";
  const r = grade(t, raw, WORK);
  if (!r.pass) { goldFail++; console.log(`  GOLD FAIL ${t.id}: ${String(r.parsed).slice(0, 300)}`); }
}
console.log(`  gold: ${n - goldFail}/${n}`);

console.log("\n=== WRONG (must FAIL) ===");
let wn = 0;
for (const t of HARD) {
  wn++;
  const raw = t.kind === "num" ? "12345" : "```js\n" + (WRONG[t.id] ?? "function x(){}") + "\n```";
  const r = grade(t, raw, WORK);
  if (r.pass) { wrongPass++; console.log(`  WRONG PASSED (bad!) ${t.id}`); }
}
console.log(`  wrong rejected: ${wn - wrongPass}/${wn}`);

console.log("\n=== VERDICT ===");
if (goldFail === 0 && wrongPass === 0) { console.log("HARD HARNESS OK"); process.exit(0); }
console.log(`BROKEN goldFail=${goldFail} wrongPass=${wrongPass}`);
process.exit(1);

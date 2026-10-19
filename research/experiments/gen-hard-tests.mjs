import fs from "node:fs";
const T = {};

T["csv.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.parseCSV;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cases=[
 ["a,b\nc,d",[["a","b"],["c","d"]]],
 ['a,"b,c",d',[["a","b,c","d"]]],
 ['a,"he said ""hi"""',[["a",'he said "hi"']]],
 ["a,b\r\nc,d",[["a","b"],["c","d"]]],
 ["x",[["x"]]],
 ['"a","b"',[["a","b"]]],
];
let bad=0;
for(const [t,want] of cases){let got;try{got=f(t);}catch(e){got="ERR:"+e.message;}
 if(!eq(got,want)){bad++;console.log("FAIL",JSON.stringify(t),"want",JSON.stringify(want),"got",JSON.stringify(got));}}
if(bad===0)console.log("__ALLPASS__");
`;

T["maxoverlap.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.maxOverlap;
const cases=[
 [[[1,3],[2,5],[3,4]],2],
 [[[1,2],[3,4]],1],
 [[],0],
 [[[1,1],[1,1]],2],
 [[[0,10],[2,3],[4,5]],3],
];
let bad=0;
for(const [a,want] of cases){let got;try{got=f(a.map(x=>[...x]));}catch(e){got="ERR:"+e.message;}
 if(got!==want){bad++;console.log("FAIL",JSON.stringify(a),"want",want,"got",got);}}
if(bad===0)console.log("__ALLPASS__");
`;

T["fromroman.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.fromRoman;
const cases=[["I",1],["IV",4],["IX",9],["XIV",14],["MCMXCIV",1994],["MMMCMXCIX",3999],["XL",40],["XC",90]];
let bad=0;
for(const [s,want] of cases){let got;try{got=f(s);}catch(e){got="ERR:"+e.message;}
 if(got!==want){bad++;console.log("FAIL",s,"want",want,"got",got);}}
if(bad===0)console.log("__ALLPASS__");
`;

T["flatten.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.flattenDeep;
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cases=[
 [[1,[2,[3,[4]]]],[1,2,3,4]],
 [[[],[1]],[1]],
 [[1,2,3],[1,2,3]],
 [[[[[]]]],[]],
 [[{a:1},[2]],[{a:1},2]],
 [[[1,[2]],[3,[[4]]]],[1,2,3,4]],
];
let bad=0;
for(const [a,want] of cases){let got;try{got=f(a);}catch(e){got="ERR:"+e.message;}
 if(!eq(got,want)){bad++;console.log("FAIL",JSON.stringify(a),"want",JSON.stringify(want),"got",JSON.stringify(got));}}
if(bad===0)console.log("__ALLPASS__");
`;

T["template.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.render;
const cases=[
 ["Hello {{name}}",{name:"Bob"},"Hello Bob"],
 ["{{a}}{{b}}",{a:"x",b:"y"},"xy"],
 ["{{missing}}",{},"{{missing}}"],
 ["no vars",{},"no vars"],
 ["{{a}} and {{a}}",{a:"z"},"z and z"],
];
let bad=0;
for(const [t,v,want] of cases){let got;try{got=f(t,v);}catch(e){got="ERR:"+e.message;}
 if(got!==want){bad++;console.log("FAIL",JSON.stringify(t),"want",want,"got",got);}}
if(bad===0)console.log("__ALLPASS__");
`;

T["addbig.mjs"] = String.raw`
const M=await import("__SOL__");const f=M.addBig;
const cases=[
 [["1","2"],"3"],
 [["999","1"],"1000"],
 [["12345678901234567890","98765432109876543210"],"111111111011111111100"],
 [["0","0"],"0"],
 [["5",""],"5"],
];
let bad=0;
for(const [a,want] of cases){let got;try{got=f(a[0],a[1]);}catch(e){got="ERR:"+e.message;}
 if(String(got)!==want){bad++;console.log("FAIL",JSON.stringify(a),"want",want,"got",got);}}
if(bad===0)console.log("__ALLPASS__");
`;

for (const [k, v] of Object.entries(T)) fs.writeFileSync(`tests/${k}`, v.trim() + "\n");
console.log("wrote", Object.keys(T).length, "hard tests");

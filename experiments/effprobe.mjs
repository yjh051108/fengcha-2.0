import { callD1 } from "./runner.mjs";
const q="What is 17*23? Output just the integer.";
for (const effort of [undefined,"minimal","low","medium","high","max","none"]) {
  const r = await callD1({model:"deepseek-v4.1-flash",system:null,user:q,effort,maxTokens:2000});
  console.log(String(effort).padEnd(9), "err="+(r.error?r.error.slice(0,80):"no"), "content="+JSON.stringify((r.content||"").slice(0,60)), "reasonLen="+(r.reasoning||"").length, "tok="+JSON.stringify(r.usage?.completion_tokens));
  await new Promise(r=>setTimeout(r,300));
}

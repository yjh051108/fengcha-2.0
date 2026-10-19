import { callD1 } from "./runner.mjs";
import { TASKS } from "./tasks.mjs";
import { grade } from "./grade.mjs";
const t = TASKS.find(x=>x.id==="code_roman");
for (const effort of ["none","max"]) {
  const r = await callD1({model:"deepseek-v4.1-flash", system:null, user:t.q, effort, maxTokens:3000});
  console.log("effort="+effort, "error="+(r.error||"none"), "contentLen="+(r.content||"").length, "reasoningLen="+(r.reasoning||"").length, "finish="+r.finish);
  if(!r.error){ const g=grade(t,r.content,".."); console.log("   pass="+g.pass, "detail="+String(g.parsed).slice(0,120)); }
}

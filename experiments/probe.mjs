const KEY = process.env.D1_API_KEY ?? "";
const URL="https://d1api.xin/v1/chat/completions";
async function call(body){
  const t0=Date.now();
  const r=await fetch(URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${KEY}`},body:JSON.stringify(body)});
  const t=Date.now()-t0;
  const txt=await r.text();
  return {status:r.status, ms:t, body:txt.slice(0,600)};
}
console.log("=== models endpoint ===");
try{
  const r=await fetch("https://d1api.xin/v1/models",{headers:{Authorization:`Bearer ${KEY}`}});
  console.log(r.status,(await r.text()).slice(0,800));
}catch(e){console.log("models err",e.message);}
console.log("\n=== minimal chat ===");
console.log(JSON.stringify(await call({model:"deepseek-v4.1-flash",messages:[{role:"user",content:"Reply with exactly: OK"}],max_tokens:50}),null,1));

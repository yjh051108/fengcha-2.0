const KEY = process.env.D1_API_KEY ?? "";
const r=await fetch("https://d1api.xin/v1/models",{headers:{Authorization:`Bearer ${KEY}`}});
const j=await r.json();
console.log(j.data.map(m=>m.id).join("\n"));

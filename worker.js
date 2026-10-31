export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);
    return new Response("Not found", {status:404});
  },
  async scheduled(event, env) { await checkNotify(env); }
}

async function handleApi(req, env){
  const url=new URL(req.url); const db=env.DB;
  const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
  if(req.method==="OPTIONS") return new Response("",{headers:cors});

  if(url.pathname==="/api/events"){
    if(req.method==="GET"){ const {results}=await db.prepare("SELECT * FROM events ORDER BY datum ASC").all(); return json(results,cors); }
    if(req.method==="POST"){ const b=await req.json(); b.id=crypto.randomUUID(); b.created_at=Date.now();
      await db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?)").bind(b.id,b.type,b.fach,b.datum,b.beschreibung||"",b.created_at).run();
      await sendPushToAll(env, `${b.type}: ${b.fach}`, b.beschreibung||b.datum); return json(b,cors); }
  }
  if(url.pathname.startsWith("/api/events/")){
    const id=url.pathname.split("/").pop();
    if(req.method==="PUT"){ const b=await req.json(); await db.prepare("UPDATE events SET type=?,fach=?,datum=?,beschreibung=? WHERE id=?").bind(b.type,b.fach,b.datum,b.beschreibung,id).run();
      await sendPushToAll(env, `Geändert: ${b.type} ${b.fach}`, b.beschreibung); return json({ok:true},cors); }
    if(req.method==="DELETE"){ await db.prepare("DELETE FROM events WHERE id=?").bind(id).run();
      await sendPushToAll(env, `Gelöscht`, `Ein Termin wurde gelöscht`); return json({ok:true},cors); }
  }
  if(url.pathname==="/api/subscribe" && req.method==="POST"){
    const s=await req.json(); await db.prepare("INSERT OR REPLACE INTO subs VALUES (?,?,?)").bind(s.endpoint,s.keys.p256dh,s.keys.auth).run(); return json({ok:true},cors);
  }
  if(url.pathname==="/api/latest"){ const {results}=await db.prepare("SELECT * FROM events WHERE datum >= date('now') ORDER BY datum ASC LIMIT 10").all(); return json(results,cors); }
  return json({error:"404"},cors,404);
}
function json(d,c,s=200){ return new Response(JSON.stringify(d),{status:s,headers:{...c,"Content-Type":"application/json"}}) }

async function checkNotify(env){
  const db=env.DB; const today=new Date().toISOString().slice(0,10);
  const t1=new Date(); t1.setDate(t1.getDate()+1); const t2=new Date(); t2.setDate(t2.getDate()+2);
  const s1=t1.toISOString().slice(0,10); const s2=t2.toISOString().slice(0,10);
  const {results}=await db.prepare("SELECT * FROM events WHERE datum IN (?,?,?)").bind(today,s1,s2).all();
  for(const e of results){ const when=e.datum===s1?"MORGEN":e.datum===s2?"IN 2 TAGEN":"HEUTE"; await sendPushToAll(env, `${when}: ${e.type} ${e.fach}`, e.beschreibung); }
}

async function sendPushToAll(env, title, body){
  const {results}=await env.DB.prepare("SELECT * FROM subs").all(); if(!results.length) return;
  const payload=JSON.stringify({title,body});
  for(const sub of results){ try{ await sendPush(env, sub, payload); }catch(e){} }
}
async function sendPush(env, sub, payload){
  // VAPID JWT
  const aud=new URL(sub.endpoint).origin;
  const exp=Math.floor(Date.now()/1000)+43200;
  const header={alg:"ES256",typ:"JWT"}; const body={aud,exp,sub:env.VAPID_SUBJECT};
  const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""));
  const toSign=enc(new TextEncoder().encode(JSON.stringify(header)))+"."+enc(new TextEncoder().encode(JSON.stringify(body)));
  const keyData=base64ToBuf(env.VAPID_PRIVATE_KEY); const pubData=base64ToBuf(env.VAPID_PUBLIC_KEY);
  const jwk={kty:"EC",crv:"P-256",x:enc(pubData.slice(1,33)),y:enc(pubData.slice(33,65)),d:enc(keyData)};
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(toSign));
  const jwt=toSign+"."+enc(sig);
  // Simple push without encryption (triggers SW, SW fetches title from payload via our custom header hack)
  await fetch(sub.endpoint,{method:"POST",headers:{"TTL":"60","Content-Length":"0","Authorization":"vapid t="+jwt+", k="+env.VAPID_PUBLIC_KEY}});
}
function base64ToBuf(b64){ b64=b64.replace(/-/g,"+").replace(/_/g,"/"); const s=atob(b64); const buf=new Uint8Array(s.length); for(let i=0;i<s.length;i++) buf[i]=s.charCodeAt(i); return buf; }

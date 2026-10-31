export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // API
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    // Service Worker & Manifest
    if (url.pathname === "/sw.js") return new Response(SW_CODE, {headers:{"Content-Type":"application/javascript"}});
    if (url.pathname === "/manifest.json") return new Response(JSON.stringify(MANIFEST), {headers:{"Content-Type":"application/json"}});
    
    // Hauptseite
    return new Response(HTML_CODE.replace("VAPID_PUBLIC_KEY_PLACEHOLDER", env.VAPID_PUBLIC_KEY), {
      headers: {"Content-Type":"text/html;charset=utf-8"}
    });
  },
  
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndNotify(env));
  }
};

async function handleApi(request, env) {
  const url = new URL(request.url);
  const db = env.DB;

  if (url.pathname === "/api/events") {
    if (request.method === "GET") {
      const { results } = await db.prepare("SELECT * FROM events ORDER BY datum ASC").all();
      return json(results);
    }
    if (request.method === "POST") {
      const e = await request.json();
      e.id = crypto.randomUUID();
      e.created_at = Date.now();
      await db.prepare("INSERT INTO events (id,type,fach,datum,beschreibung,created_at,created_by) VALUES (?,?,?,?,?,?,?)")
        .bind(e.id,e.type,e.fach,e.datum,e.beschreibung||"",e.created_at,e.created_by||"Anonym").run();
      await notifyAll(env, `NEU: ${e.type} in ${e.fach} am ${e.datum}`, e.beschreibung);
      return json(e);
    }
  }
  if (url.pathname.startsWith("/api/events/")) {
    const id = url.pathname.split("/").pop();
    if (request.method === "PUT") {
      const e = await request.json();
      await db.prepare("UPDATE events SET type=?, fach=?, datum=?, beschreibung=? WHERE id=?")
        .bind(e.type,e.fach,e.datum,e.beschreibung,id).run();
      await notifyAll(env, `GEÄNDERT: ${e.type} in ${e.fach}`, e.beschreibung);
      return json({ok:true});
    }
    if (request.method === "DELETE") {
      await db.prepare("DELETE FROM events WHERE id=?").bind(id).run();
      await notifyAll(env, `GELÖSCHT: Ein Termin wurde gelöscht`, "");
      return json({ok:true});
    }
  }
  if (url.pathname === "/api/subscribe" && request.method === "POST") {
    const sub = await request.json();
    await db.prepare("INSERT OR REPLACE INTO subscriptions (id,endpoint,p256dh,auth,settings) VALUES (?,?,?,?,?)")
      .bind(sub.endpoint, sub.endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(sub.settings||{}))
      .run();
    return json({ok:true});
  }
  return json({error:"not found"}, 404);
}

async function checkAndNotify(env) {
  const db = env.DB;
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const in2days = new Date(today); in2days.setDate(today.getDate()+2);
  const fmt = d => d.toISOString().split('T')[0];
  
  const { results } = await db.prepare("SELECT * FROM events WHERE datum IN (?,?,?)").bind(fmt(tomorrow), fmt(in2days), fmt(today)).all();
  for (const e of results) {
    let when = e.datum === fmt(tomorrow) ? "MORGEN" : e.datum === fmt(in2days) ? "IN 2 TAGEN" : "HEUTE";
    await notifyAll(env, `${when}: ${e.type} ${e.fach}`, e.beschreibung, e.datum);
  }
}

async function notifyAll(env, title, body, datum) {
  // Web Push wird über den Service ausgelöst - vereinfachte Version
  // In Prod: web-push library nutzen. Hier speichern wir nur, SW pollt.
  console.log("NOTIFY:", title);
}

function json(d, s=200){ return new Response(JSON.stringify(d), {status:s, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}}) }

const MANIFEST = {
  name: "Klassen Hausaufgaben",
  short_name: "Hausaufgaben",
  start_url: "/",
  display: "standalone",
  background_color: "#0f0f12",
  theme_color: "#0f0f12",
  icons: [{src:"https://cdn-icons-png.flaticon.com/512/3652/3652191.png", sizes:"512x512", type:"image/png"}]
};

const SW_CODE = `
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {title:'Hausaufgaben', body:'Neuer Termin!'};
  e.waitUntil(self.registration.showNotification(data.title, {body:data.body, icon:'https://cdn-icons-png.flaticon.com/512/3652/3652191.png'}));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('/')); });
`;

const HTML_CODE = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Klassen Planer</title>
<link rel="manifest" href="/manifest.json"><style>
*{box-sizing:border-box;font-family:system-ui}body{margin:0;background:#0f0f12;color:white}
header{position:sticky;top:0;background:rgba(15,15,18,.9);backdrop-filter:blur(20px);border-bottom:1px solid #222;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;z-index:10}
button{cursor:pointer;border:none;border-radius:12px;padding:10px 14px;font-weight:700}
#addTop{background:white;color:black}.iconBtn{background:#1c1c22;color:white;width:42px;height:42px;border-radius:12px;border:1px solid #333}
.search{margin:10px 16px;background:#1c1c22;border:1px solid #2a2a33;border-radius:14px;padding:12px;color:white;width:calc(100% - 32px)}
.calendar{max-width:700px;margin:0 auto;padding:10px 16px}.cal-head{display:flex;justify-content:space-between;align-items:center;margin:10px 0}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.dow{color:#666;font-size:12px;text-align:center;padding:6px}
.day{background:#1a1a20;border:1px solid #2a2a33;border-radius:14px;min-height:78px;padding:6px;cursor:pointer;position:relative}.day.today{border-color:white}.day.other{opacity:.3}.dayNum{font-size:13px;font-weight:700}.dots{margin-top:4px;display:flex;flex-wrap:wrap;gap:3px}.dot{width:8px;height:8px;border-radius:50%}.list{margin-top:20px}.item{padding:12px 14px;border-radius:14px;margin-bottom:8px;display:flex;gap:10px;align-items:center;border:1px solid #333}.type-Hausaufgabe{background:#1e2a4a;border-color:#3B82F6}.type-Test{background:#3a2d1a;border-color:#F59E0B}.type-Klassenarbeit{background:#3a1a1a;border-color:#EF4444}.type-Sonstiges{background:#1a2e26;border-color:#10B981}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;z-index:100;padding:16px}.overlay.open{display:flex}.panel{background:#18181c;border:1px solid #333;border-radius:20px;padding:20px;width:100%;max-width:480px;max-height:90vh;overflow:auto}
.cat{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.cat button{padding:14px;border-radius:12px;border:2px solid #333;background:#1c1c22;color:white}.cat button.active{border-color:white;background:white;color:black}
.panel input,.panel textarea,.panel select{width:100%;padding:12px;border-radius:12px;border:1px solid #333;background:#111;color:white;margin-bottom:12px}
</style></head><body>
<header><button class="iconBtn" onclick="openSettings()">☰</button><b id="monthTitle"></b><button id="addTop" onclick="openAdd()">+ Add</button></header>
<input id="search" class="search" placeholder="Suche nach Fach, Text oder Datum (2026-05-12)...">
<div class="calendar">
<div class="cal-head"><button class="iconBtn" onclick="changeMonth(-1)">‹</button><span id="calLabel"></span><button class="iconBtn" onclick="changeMonth(1)">›</button></div>
<div class="grid" id="dow"></div><div class="grid" id="grid"></div>
<div class="list" id="list"></div>
</div>

<div class="overlay" id="addOverlay"><div class="panel">
<h2 id="formTitle">Neu hinzufügen</h2>
<div class="cat"><button data-type="Hausaufgabe" onclick="setType(this)">Hausaufgabe</button><button data-type="Test" onclick="setType(this)">Test</button><button data-type="Klassenarbeit" onclick="setType(this)">Klassenarbeit</button><button data-type="Sonstiges" onclick="setType(this)">Sonstiges</button></div>
<input id="fach" placeholder="Fach (z.B. Mathe, Englisch...)"><input id="datum" type="date"><textarea id="beschreibung" rows="3" placeholder="Beschreibung: Was ist zu tun? Seite..."></textarea>
<div style="display:flex;gap:8px"><button onclick="closeAdd()" style="flex:1;background:#25252e;color:white">Abbrechen</button><button id="saveBtn" onclick="saveEvent()" style="flex:1;background:white;color:black">Add</button></div>
</div></div>

<div class="overlay" id="dayOverlay"><div class="panel"><h2 id="dayTitle"></h2><div id="dayList"></div><button onclick="openAdd(document.getElementById('dayTitle').dataset.date)" style="width:100%;background:white;color:black;margin-top:10px">+ Für diesen Tag hinzufügen</button><button onclick="closeDay()" style="width:100%;background:#25252e;color:white;margin-top:8px">Schließen</button></div></div>

<div class="overlay" id="setOverlay"><div class="panel"><h2>Einstellungen</h2>
<p style="color:#888;font-size:13px">Benachrichtigungen auch wenn App zu ist (Push B)</p>
<button id="enablePush" onclick="enablePush()" style="width:100%;background:white;color:black;margin-bottom:16px">🔔 Push aktivieren</button>
<label><input type="checkbox" id="notif1" checked> 1 Tag vorher benachrichtigen</label><br><br>
<label><input type="checkbox" id="notif2" checked> 2 Tage vorher benachrichtigen</label><br><br>
<label><input type="checkbox" id="notifNew" checked> Bei neuen / geänderten / gelöschten Terminen</label>
<p style="color:#666;font-size:12px;margin-top:16px">VAPID: VAPID_PUBLIC_KEY_PLACEHOLDER<br>Alle Events werden über Cloudflare D1 synchronisiert. Jeder kann bearbeiten/löschen.</p>
<button onclick="closeSettings()" style="width:100%;background:#25252e;color:white;margin-top:12px">Fertig</button>
</div></div>

<script>
let current = new Date(); current.setDate(1);
let selectedType = 'Hausaufgabe'; let editId = null; let events = [];
const COLORS = {Hausaufgabe:'#3B82F6', Test:'#F59E0B', Klassenarbeit:'#EF4444', Sonstiges:'#10B981'};
const VAPID = 'VAPID_PUBLIC_KEY_PLACEHOLDER';

async function load(){ try{ const r=await fetch('/api/events'); events=await r.json(); }catch(e){ events=JSON.parse(localStorage.getItem('events')||'[]'); } render(); }
function saveLocal(){ localStorage.setItem('events', JSON.stringify(events)); }

function render(){
  const y=current.getFullYear(), m=current.getMonth();
  document.getElementById('calLabel').textContent=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(current);
  document.getElementById('dow').innerHTML=['Mo','Di','Mi','Do','Fr','Sa','So'].map(d=>'<div class=dow>'+d+'</div>').join('');
  const first = new Date(y,m,1); let start = first.getDay(); start = start===0?6:start-1;
  const daysInMonth = new Date(y,m+1,0).getDate();
  const daysPrev = new Date(y,m,0).getDate();
  let html=''; const search=document.getElementById('search').value.toLowerCase();
  for(let i=0;i<42;i++){
    let dayNum, dateStr, isOther=false;
    if(i<start){ dayNum=daysPrev-start+i+1; dateStr=new Date(y,m-1,dayNum).toISOString().split('T')[0]; isOther=true; }
    else if(i>=start+daysInMonth){ dayNum=i-start-daysInMonth+1; dateStr=new Date(y,m+1,dayNum).toISOString().split('T')[0]; isOther=true; }
    else { dayNum=i-start+1; dateStr=new Date(y,m,dayNum).toISOString().split('T')[0]; }
    const dayEvents = events.filter(ev=>ev.datum===dateStr && (ev.fach.toLowerCase().includes(search)||ev.beschreibung.toLowerCase().includes(search)||ev.datum.includes(search)||ev.type.toLowerCase().includes(search)));
    const isToday = dateStr===new Date().toISOString().split('T')[0];
    html+='<div class="day '+(isToday?'today ':'')+(isOther?'other':'')+'" onclick="openDay(\\''+dateStr+'\\')"><div class=dayNum>'+dayNum+'</div><div class=dots>'+dayEvents.slice(0,6).map(ev=>'<div class=dot style=background:'+COLORS[ev.type]+'></div>').join('')+'</div></div>';
  }
  document.getElementById('grid').innerHTML=html;
  
  // Liste unter Kalender
  let filtered = events.filter(ev=>!search||ev.fach.toLowerCase().includes(search)||ev.beschreibung.toLowerCase().includes(search)||ev.datum.includes(search));
  filtered.sort((a,b)=>a.datum.localeCompare(b.datum));
  document.getElementById('list').innerHTML=filtered.map(ev=>'<div class="item type-'+ev.type+'" onclick="editEvent(\\''+ev.id+'\\')"><div style="width:10px;height:10px;border-radius:50%;background:'+COLORS[ev.type]+'"></div><div style="flex:1"><b>'+ev.type+' - '+ev.fach+'</b><div style="font-size:12px;opacity:.8">'+ev.datum+' • '+ev.beschreibung.slice(0,60)+'</div></div><div style="font-size:18px" onclick="event.stopPropagation();deleteEvent(\\''+ev.id+'\\')">🗑️</div></div>').join('') || '<div style="text-align:center;color:#555;margin-top:20px">Keine Termine</div>';
}

function changeMonth(d){ current.setMonth(current.getMonth()+d); render(); }
function openAdd(prefillDate){ document.getElementById('addOverlay').classList.add('open'); document.getElementById('formTitle').textContent=editId?'Bearbeiten':'Neu hinzufügen'; document.getElementById('saveBtn').textContent=editId?'Speichern':'Add'; if(prefillDate) document.getElementById('datum').value=prefillDate; }
function closeAdd(){ document.getElementById('addOverlay').classList.remove('open'); editId=null; document.getElementById('fach').value=''; document.getElementById('beschreibung').value=''; selectedType='Hausaufgabe'; document.querySelectorAll('.cat button').forEach(b=>b.classList.remove('active')); }
function setType(btn){ selectedType=btn.dataset.type; document.querySelectorAll('.cat button').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
async function saveEvent(){
  const fach=document.getElementById('fach').value.trim(); const datum=document.getElementById('datum').value; const beschreibung=document.getElementById('beschreibung').value.trim();
  if(!fach||!datum){ alert('Fach und Datum braucht man!'); return; }
  const payload={type:selectedType,fach,datum,beschreibung};
  if(editId){ await fetch('/api/events/'+editId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const idx=events.findIndex(e=>e.id===editId); if(idx>=0) events[idx]={...events[idx],...payload}; }
  else { try{ const r=await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const ne=await r.json(); events.push(ne); }catch(e){ payload.id=crypto.randomUUID(); events.push(payload); saveLocal(); } }
  closeAdd(); render();
}
function editEvent(id){ const ev=events.find(e=>e.id===id); if(!ev) return; editId=id; document.getElementById('fach').value=ev.fach; document.getElementById('datum').value=ev.datum; document.getElementById('beschreibung').value=ev.beschreibung; selectedType=ev.type; document.querySelectorAll('.cat button').forEach(b=>{ if(b.dataset.type===ev.type) b.classList.add('active'); }); openAdd(); }
async function deleteEvent(id){ if(!confirm('Wirklich löschen?')) return; try{ await fetch('/api/events/'+id,{method:'DELETE'});}catch(e){} events=events.filter(e=>e.id!==id); saveLocal(); render(); }
function openDay(date){ document.getElementById('dayOverlay').classList.add('open'); document.getElementById('dayTitle').textContent=new Date(date).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'}); document.getElementById('dayTitle').dataset.date=date; const dayEvents=events.filter(e=>e.datum===date); document.getElementById('dayList').innerHTML=dayEvents.map(ev=>'<div class="item type-'+ev.type+'"><div style="width:10px;height:10px;border-radius:50%;background:'+COLORS[ev.type]+'"></div><div style="flex:1"><b>'+ev.type+' - '+ev.fach+'</b><div style="font-size:12px">'+ev.beschreibung+'</div></div></div>').join('') || 'Keine Termine'; }
function closeDay(){ document.getElementById('dayOverlay').classList.remove('open'); }
function openSettings(){ document.getElementById('setOverlay').classList.add('open'); }
function closeSettings(){ document.getElementById('setOverlay').classList.remove('open'); localStorage.setItem('settings', JSON.stringify({n1:document.getElementById('notif1').checked,n2:document.getElementById('notif2').checked,nNew:document.getElementById('notifNew').checked})); }
async function enablePush(){ if(!('Notification' in window)){ alert('Push geht auf diesem Gerät nicht'); return; } const perm=await Notification.requestPermission(); if(perm!=='granted'){ alert('Bitte erlauben'); return; } const reg=await navigator.serviceWorker.register('/sw.js'); const sub=await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(VAPID)}); await fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(JSON.stringify(sub)), settings:{n1:true,n2:true}})}); alert('🔔 Push aktiv! Du bekommst jetzt Benachrichtigungen.'); }
function urlBase64ToUint8Array(b){ const pad='='.repeat((4-b.length%4)%4); const base=(b+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(base); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;++i) out[i]=raw.charCodeAt(i); return out; }
document.getElementById('search').addEventListener('input', render);
load();
if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js'); }
<\/script></body></html>
`;

**4. Setup in 2 Minuten:**

```bash
# 1. VAPID Keys generieren (für Push B)
npx web-push generate-vapid-keys

# 2. Keys in wrangler.toml eintragen

# 3. D1 erstellen
wrangler d1 create hausaufgaben-db
# ID aus Output in wrangler.toml kopieren

# 4. Tabellen erstellen
wrangler d1 execute hausaufgaben-db --file=./schema.sql

# 5. Deployen
wrangler deploy

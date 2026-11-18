// Gewel server. No dependencies. Node 22+ for relay publishing (18+ for everything else). Run: node server.js
const dns=require("dns").promises,net=require("net"),http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto"),NS=require("./nostr.js");
try{for(const l of fs.readFileSync(path.join(__dirname,".env"),"utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,"")}}catch(e){}
const PORT=process.env.PORT||3000,DATA=process.env.DATA_DIR||path.join(__dirname,"data"),MAX=8*1024*1024;
const RELAYS=(process.env.RELAYS??"wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net").split(",").map(s=>s.trim()).filter(Boolean);
fs.mkdirSync(DATA,{recursive:true});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const HEX=/^[0-9a-f]{64}$/,tag=(e,n)=>(e.tags.find(t=>t[0]===n)||[])[1]||"",sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const fresh=e=>Math.abs(Date.now()/1000-e.created_at)<600;
async function validate(e,buf){
  if(!await NS.check(e))return"Signature is not valid.";if(e.kind!==1||e.content.length>300)return"This is not a Gewel story.";
  if(!e.tags.every(t=>Array.isArray(t)&&t.length>=1&&t.length<=3&&t.every(x=>typeof x==="string"&&x.length<=200))||e.tags.length>12)return"Bad tags.";
  for(const[k,n]of[["title",90],["topic",80],["lang",20],["author",40]])if(!tag(e,k)||tag(e,k).length>n)return`Field ${k} is missing or too long.`;
  if(tag(e,"enc")&&(tag(e,"enc")!=="aes-256-gcm"||!tag(e,"iv")||!tag(e,"xp")))return"Private story fields are incomplete.";
  return tag(e,"x")===sha(buf)?null:"Audio does not match its fingerprint."}
/* Optional durable storage in Neon Postgres over HTTP (no dependencies). Files stay the working copy; every write is mirrored to the database and restored at startup. */
const DBURL=process.env.DATABASE_URL||"",SAFE=/^[\w.-]{1,200}$/;
async function dbq(query,params=[]){const u=new URL(DBURL),hosts=[u.hostname,u.hostname.replace("-pooler","")].filter((h,i,a)=>a.indexOf(h)===i);let err;
  for(const h of hosts){try{const r=await fetch((process.env.NEON_HTTP_BASE||"https://"+h)+"/sql",{method:"POST",headers:{"content-type":"application/json","neon-connection-string":DBURL},body:JSON.stringify({query,params}),signal:AbortSignal.timeout(30000)});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||"The database returned status "+r.status);return j.rows||[]}catch(e){err=e}}throw new Error("Database request failed: "+(err&&err.message||"unknown"))}
async function put(file,data){fs.writeFileSync(file,data);if(DBURL)await dbq("INSERT INTO gewel_files(name,data) VALUES($1,decode($2,'base64')) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data,updated=now()",[path.basename(file),Buffer.from(data).toString("base64")])}
async function drop(file){fs.rmSync(file,{force:true});if(DBURL)await dbq("DELETE FROM gewel_files WHERE name=$1",[path.basename(file)])}
async function hydrate(){await dbq("CREATE TABLE IF NOT EXISTS gewel_files (name text PRIMARY KEY, data bytea NOT NULL, updated timestamptz DEFAULT now())");
  for(const{name}of await dbq("SELECT name FROM gewel_files")){if(!SAFE.test(name))continue;const[row]=await dbq("SELECT encode(data,'base64') AS data FROM gewel_files WHERE name=$1",[name]);if(row)fs.writeFileSync(path.join(DATA,name),Buffer.from(row.data,"base64"))}}
const CAP=(+process.env.STORE_CAP_MB||300)*1024*1024,idx=new Map(),lnmap=new Map();
function loadAll(){for(const f of fs.readdirSync(DATA)){try{const r=JSON.parse(fs.readFileSync(path.join(DATA,f)));if(f.startsWith("ln-"))lnmap.set(f.slice(3,-5),r.address);else if(r.event)idx.set(r.event.id,r)}catch(e){}}}
const byPk=k=>[...idx.values()].filter(r=>r.event.pubkey===k).map(r=>r.event).sort((a,b)=>b.created_at-a.created_at);
/* publish each story to public Nostr relays and record the real answer from each */
const relayStat=new Map();
function publish(ev,list=RELAYS){const st={};relayStat.set(ev.id,st);
  if(typeof WebSocket==="undefined"){for(const r of list)st[r]="needs Node 22 or newer";return}
  for(const url of list){st[url]="sending";const fail=m=>{if(st[url]==="sending")st[url]=m};
    try{const ws=new WebSocket(url),t=setTimeout(()=>{fail("timed out");try{ws.close()}catch(e){}},8000);
      ws.onopen=()=>ws.send(JSON.stringify(["EVENT",ev]));
      ws.onmessage=m=>{try{const a=JSON.parse(m.data);if(a[0]==="OK"&&a[1]===ev.id){st[url]=a[2]?"accepted":"refused: "+String(a[3]).slice(0,80);clearTimeout(t);ws.close()}}catch(e){}};
      ws.onerror=()=>fail("could not connect");ws.onclose=()=>fail("closed without an answer")}catch(e){fail("could not connect")}}}
/* Lightning tips through a storyteller's Lightning address (LNURL-pay) */
const LOCAL=process.env.ALLOW_LOCAL_LNURL==="1",LNA=/^[a-z0-9._+-]{1,64}@[a-z0-9.-]{3,100}(:\d{2,5})?$/i,UNIT={"":1e11,m:1e8,u:1e5,n:100,p:0.1};
function priv(ip){if(net.isIPv4(ip)){const[a,b]=ip.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===192&&b===168)||(a===172&&b>=16&&b<=31)||(a===100&&b>=64&&b<=127)}const l=ip.toLowerCase();return l==="::1"||l==="::"||l.startsWith("fc")||l.startsWith("fd")||l.startsWith("fe80")||l.startsWith("::ffff:")}
async function lget(u){const x=new URL(u);if(!LOCAL){if(x.protocol!=="https:")throw new Error("Wallet host must use https.");const{address}=await dns.lookup(x.hostname);if(priv(address))throw new Error("Wallet host is not allowed.")}
  const r=await fetch(u,{redirect:"error",signal:AbortSignal.timeout(6000)});if(!r.ok)throw new Error("Wallet host returned an error.");const t=await r.text();if(t.length>20000)throw new Error("Wallet reply is too large.");return JSON.parse(t)}
/* AI transcript and translation through the Gemini API. The key lives only in the server environment. */
const KEY=process.env.GEMINI_API_KEY||"",MODEL=process.env.GEMINI_MODEL||"gemini-3.8-flash",GBASE=process.env.GEMINI_BASE||"https://generativelanguage.googleapis.com",AIMAX=+(process.env.AI_DAILY_MAX||100);let aiDay="",aiN=0;
const aiFile=id=>path.join(DATA,"ai-"+id+".json"),aiOf=id=>{try{return JSON.parse(fs.readFileSync(aiFile(id)))}catch(e){return null}};
const PROMPT='Transcribe this audio exactly as spoken, in the language spoken. Then translate it into English and into French. If you are unsure of a word, write [unclear]. Reply only with JSON: {"language":"...","transcript":"...","english":"...","french":"..."}';
/* relays chosen by the storyteller, checked before the server connects to them */
async function cleanRelays(h){const l=String(h||"").split(",").map(s=>s.trim()).filter(Boolean);if(!l.length)return RELAYS;if(l.length>5)throw new Error("Choose at most 5 relays.");
  for(const u of l){let x;try{x=new URL(u)}catch(e){throw new Error("Bad relay address: "+u.slice(0,60))}if(!(x.protocol==="wss:"||(LOCAL&&x.protocol==="ws:")))throw new Error("Relay addresses must start with wss://");
    if(!LOCAL){let a;try{a=(await dns.lookup(x.hostname)).address}catch(e){throw new Error("Could not find the relay "+x.hostname)}if(priv(a))throw new Error("That relay address is not allowed.")}}return l}
/* Bitcoin timestamps: the story's note id (a SHA-256 digest) is submitted to OpenTimestamps calendar servers */
const CALS=(process.env.OTS_CALENDARS??"https://alice.btc.calendar.opentimestamps.org,https://bob.btc.calendar.opentimestamps.org").split(",").map(s=>s.trim()).filter(Boolean);
const otsFile=id=>path.join(DATA,"ots-"+id+".json"),otsOf=id=>{try{return JSON.parse(fs.readFileSync(otsFile(id)))}catch(e){return null}};
const serial=e=>JSON.stringify([0,e.pubkey,e.created_at,e.kind,e.tags,e.content]);
const MAGIC=Buffer.concat([Buffer.from([0]),Buffer.from("OpenTimestamps"),Buffer.from([0,0]),Buffer.from("Proof"),Buffer.from([0,0xbf,0x89,0xe2,0xe8,0x84,0xe8,0x92,0x94])]);
async function stamp(ev){const digest=Buffer.from(ev.id,"hex"),errs=[];for(const cal of CALS){try{const r=await fetch(cal+"/digest",{method:"POST",headers:{accept:"application/vnd.opentimestamps.v1","content-type":"application/x-www-form-urlencoded","user-agent":"gewel"},body:digest,signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error("status "+r.status);const b=Buffer.from(await r.arrayBuffer());if(!b.length||b.length>10000)throw new Error("unexpected reply");
    await put(otsFile(ev.id),JSON.stringify({status:"pending",calendar:cal,at:new Date().toISOString(),proof:b.toString("base64")}));return}catch(e){errs.push(new URL(cal).host+": "+e.message)}}
  await put(otsFile(ev.id),JSON.stringify({status:"failed",at:new Date().toISOString(),error:errs.join("; ")}))}
const interactionText=j=>{if(typeof j.output_text==="string")return j.output_text;const t=[];(function w(x){if(!x||typeof x!=="object")return;if(typeof x.text==="string"&&(!x.type||x.type==="text"))t.push(x.text);for(const v of Object.values(x))w(v)})(j.outputs||j.output||j.steps||[]);return t.join("")};
const SCHEMA={type:"object",properties:{language:{type:"string"},transcript:{type:"string"},english:{type:"string"},french:{type:"string"}},required:["language","transcript","english","french"]};
/* audio with HTTP Range support: iPhones refuse to play audio from a server that ignores Range requests */
function serveAudio(req,res,buf,type){const h={"content-type":type,"accept-ranges":"bytes","x-content-type-options":"nosniff","cache-control":"private, max-age=3600"},g=String(req.headers.range||"").match(/^bytes=(\d*)-(\d*)$/);
  if(g&&(g[1]||g[2])){const n=buf.length,a=g[1]===""?Math.max(0,n-Number(g[2])):Number(g[1]),b=g[1]===""||g[2]===""?n-1:Math.min(Number(g[2]),n-1);
    if(a>b||a>=n){res.writeHead(416,{"content-range":"bytes */"+n});return res.end()}
    res.writeHead(206,{...h,"content-range":`bytes ${a}-${b}/${n}`,"content-length":b-a+1});return res.end(buf.subarray(a,b+1))}
  res.writeHead(200,{...h,"content-length":buf.length});res.end(buf)}
const hits=new Map();const limited=ip=>{const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<36e5);a.push(n);hits.set(ip,a);return a.length>40};
const send=(res,c,body,type="application/json")=>{res.writeHead(c,{"content-type":type,"x-content-type-options":"nosniff","referrer-policy":"no-referrer",
  "content-security-policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; media-src 'self' blob:"});res.end(body)};
const json=(res,c,o)=>send(res,c,JSON.stringify(o));
const body=async(req,max)=>{const ch=[];let n=0;for await(const c of req){n+=c.length;if(n>max)throw Object.assign(new Error("Too large."),{code:413});ch.push(c)}return Buffer.concat(ch)};
const DRUM='<svg viewBox="0 0 48 56" width="34" height="40" aria-hidden="true"><path fill="#E3A31B" d="M6 6H42L29 28L42 50H6L19 28Z"/><rect x="6" y="1" width="36" height="3" fill="#E3A31B"/></svg>';
async function page(r){const e=r.event,sig=await NS.check(e);let audio=false;try{audio=sha(fs.readFileSync(path.join(DATA,e.id+".bin")))===tag(e,"x")}catch(x){}
  const tips=lnmap.has(e.pubkey),ai=aiOf(e.id),ot=otsOf(e.id);
  const otsLine=ot&&ot.status==="pending"?`Bitcoin timestamp: requested from ${esc(new URL(ot.calendar).host)} on ${esc(ot.at.slice(0,10))}, pending until Bitcoin confirms it (usually a few hours). Gewel does not check the confirmation. Files: <a href="/ots/${e.id}.txt">event text</a> and <a href="/ots/${e.id}.txt.ots">.ots proof</a>. Check them with the OpenTimestamps tool (<code>ots upgrade</code>, then <code>ots verify</code>).`:ot?"Bitcoin timestamp: the calendar servers could not be reached.":"Bitcoin timestamp: not requested.";
  return`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tag(e,"title"))} – Gewel</title>
<style>body{margin:0;font:19px/1.6 Georgia,serif;background:#F4F3EC;color:#14201A}main{max-width:700px;margin:0 auto;padding:24px 20px 64px}header{background:#123524;padding:14px 20px}header a{color:#F4F3EC;font:800 26px Arial,sans-serif;text-decoration:none;display:flex;gap:10px;align-items:center;max-width:700px;margin:0 auto}
h1{font:800 clamp(30px,6vw,46px)/1.05 Arial,sans-serif;margin:.4em 0}audio{width:100%}.ok{color:#123524;font-weight:700;border-left:6px solid #E3A31B;padding-left:12px}.bad{color:#B23A2A;font-weight:700;border-left:6px solid #B23A2A;padding-left:12px}.back{display:inline-block;padding:10px 4px;font:700 17px Arial,sans-serif;color:#123524}.m{color:#55625A;font-size:16px}code{word-break:break-all;font-size:14px}input{font:18px Georgia;padding:10px;width:8em}button{font:800 17px Arial;background:#E3A31B;border:0;padding:12px 20px;cursor:pointer}</style>
<header><a href="/">${DRUM}Gewel</a></header><main><p><a class="back" href="/" onclick="if(history.length>1){history.back();return false}">← Back</a> &nbsp; <a class="back" href="/#verify">Check another proof</a></p><h1>${esc(tag(e,"title"))}</h1><p class="m">${esc(tag(e,"topic"))}, ${esc(tag(e,"lang"))}. Recorded by ${esc(tag(e,"author"))} on ${new Date(e.created_at*1000).toISOString().slice(0,10)}.</p>
${tag(e,"enc")?"<p class=\"m\">This story is private. Its audio is encrypted and only the storyteller can play it.</p>":audio?`<audio controls src="/api/audio/${e.id}"></audio>`:""}
<p class="${sig?"ok":"bad"}">${sig?"The Nostr signature is valid for this story.":"The signature does not match this story."}</p>
<p class="${audio?"ok":"bad"}">${audio?"The audio matches the signed fingerprint.":"The stored audio does not match the signed fingerprint."}</p>
${ai?`<h2>AI transcript and translations</h2><p class="m">Made by a machine (${esc(ai.model)}), not by the storyteller. It may contain errors and is not covered by the signature.</p><p class="m">Language: ${esc(ai.language)}</p><p>${esc(ai.transcript)}</p><h3>English</h3><p>${esc(ai.english)}</p><h3>Français</h3><p>${esc(ai.french)}</p>`:""}
${tips?`<h2>Send sats to ${esc(tag(e,"author"))}</h2><form id="tf"><label>Amount in sats <input id="a" type="number" min="1" value="500"></label> <button>Get invoice</button></form><div id="o" aria-live="polite"></div><script>document.getElementById("tf").onsubmit=async e=>{e.preventDefault();const o=document.getElementById("o");o.textContent="Asking the wallet…";try{const r=await fetch("/api/tip/${e.id}?sats="+document.getElementById("a").value);const j=await r.json();if(!r.ok)throw new Error(j.error);o.innerHTML='<p>Pay this invoice with any Lightning wallet. Gewel cannot see whether it was paid.</p><textarea readonly rows="4" style="width:100%">'+j.invoice+'</textarea><p><a href="lightning:'+j.invoice+'">Open in my wallet</a></p>'}catch(x){o.textContent="Could not get an invoice: "+x.message}}</script>`:""}
<p class="m">Nostr author <code>${NS.enc("npub",e.pubkey)}</code><br>Note id <code>${e.id}</code><br>Fingerprint <code>${esc(tag(e,"x"))}</code><br>${otsLine} Signed does not mean true; this is the storyteller’s own account.</p></main></html>`}
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,"http://x"),p=u.pathname;let m;
  const ip=process.env.TRUST_PROXY==="1"?((req.headers["x-forwarded-for"]||"").split(",").pop().trim()||req.socket.remoteAddress):req.socket.remoteAddress;
  try{
    if(req.method==="GET"&&(p==="/"||p==="/index.html")){let h=fs.readFileSync(path.join(__dirname,"public/index.html"),"utf8");if(process.env.DEMO_NOTICE)h=h.replace('<main id="app">',`<p class="notice">${esc(process.env.DEMO_NOTICE)}</p><main id="app">`);return send(res,200,h,"text/html; charset=utf-8")}
    if(req.method==="GET"&&p==="/nostr.js")return send(res,200,fs.readFileSync(path.join(__dirname,"nostr.js")),"text/javascript; charset=utf-8");
    if(req.method==="GET"&&(m=p.match(/^\/s\/([0-9a-f]{64})$/))){const r=idx.get(m[1]);return r?send(res,200,await page(r),"text/html; charset=utf-8"):send(res,404,"Story not found","text/plain")}
    if(req.method==="GET"&&(m=p.match(/^\/api\/audio\/([0-9a-f]{64})$/))){const r=idx.get(m[1]);return r?serveAudio(req,res,fs.readFileSync(path.join(DATA,m[1]+".bin")),r.mime):json(res,404,{error:"Not found."})}
    if(req.method==="GET"&&(m=p.match(/^\/api\/relays\/([0-9a-f]{64})$/)))return json(res,200,relayStat.get(m[1])||{});
    if(req.method==="GET"&&(m=p.match(/^\/api\/ots\/([0-9a-f]{64})$/))){const o=otsOf(m[1]);return json(res,200,o?{status:o.status,calendar:o.calendar,at:o.at,error:o.error}:{})}
    if(req.method==="GET"&&(m=p.match(/^\/ots\/([0-9a-f]{64})\.txt(\.ots)?$/))){const r=idx.get(m[1]),o=otsOf(m[1]);if(!r)return send(res,404,"Not found","text/plain");res.setHeader("content-disposition",`attachment; filename="${m[1]}.txt${m[2]||""}"`);
      if(!m[2])return send(res,200,serial(r.event),"text/plain; charset=utf-8");if(!o||o.status!=="pending")return send(res,404,"No timestamp proof yet","text/plain");
      return send(res,200,Buffer.concat([MAGIC,Buffer.from([1,0x08]),Buffer.from(m[1],"hex"),Buffer.from(o.proof,"base64")]),"application/octet-stream")}
    if(req.method==="GET"&&p==="/api/wall")return json(res,200,{stories:[...idx.values()].map(r=>r.event).filter(e=>tag(e,"wall")==="1"&&!tag(e,"enc")).sort((a,b)=>b.created_at-a.created_at).slice(0,200)});
    if(req.method==="GET"&&p==="/api/stories"){const k=u.searchParams.get("pk")||"";return HEX.test(k)?json(res,200,{stories:byPk(k)}):json(res,400,{error:"Bad public key."})}
    if(req.method==="POST"&&p==="/api/stories"){if(limited(ip))return json(res,429,{error:"Too many uploads. Try again in an hour."});
      const buf=await body(req,MAX);let ev;try{ev=JSON.parse(Buffer.from(req.headers["x-event"]||"","base64").toString())}catch(e){return json(res,400,{error:"Event header is not valid."})}
      const bad=await validate(ev,buf);if(bad)return json(res,400,{error:bad});if(idx.has(ev.id))return json(res,409,{error:"This story is already saved."});
      let rl;try{rl=await cleanRelays(req.headers["x-relays"])}catch(e){return json(res,400,{error:e.message})}
      const ct=String(req.headers["content-type"]||"").split(";")[0].trim().toLowerCase(),mime=(/^audio\/[a-z0-9.+-]{1,30}$/i.test(ct)||(tag(ev,"enc")&&ct==="application/octet-stream"))?ct:"audio/webm",rec={event:ev,mime,size:buf.length,received:new Date().toISOString()};if([...idx.values()].reduce((t,r)=>t+(r.size||0),0)+buf.length>CAP)return json(res,507,{error:"This server has reached its storage limit. Try again later."});
      try{await put(path.join(DATA,ev.id+".bin"),buf);await put(path.join(DATA,ev.id+".json"),JSON.stringify(rec))}catch(e){for(const x of[".bin",".json"])await drop(path.join(DATA,ev.id+x)).catch(()=>{});return json(res,502,{error:"Could not save to the database. Try again."})}
      idx.set(ev.id,rec);publish(ev,rl);stamp(ev).catch(()=>{});
      return json(res,201,{id:ev.id,url:"/s/"+ev.id})}
    if(req.method==="POST"&&p==="/api/delete"){let ev;try{ev=JSON.parse(await body(req,4096))}catch(e){return json(res,400,{error:"Bad request."})}
      const id=ev&&Array.isArray(ev.tags)&&(ev.tags.find(t=>t[0]==="e")||[])[1],r=idx.get(id);
      if(!await NS.check(ev)||ev.kind!==5||!fresh(ev))return json(res,403,{error:"A fresh signed deletion is required."});if(!r)return json(res,404,{error:"Not found."});
      if(r.event.pubkey!==ev.pubkey)return json(res,403,{error:"Only the author can delete this story."});
      for(const f of[path.join(DATA,id+".json"),path.join(DATA,id+".bin"),aiFile(id),otsFile(id)])await drop(f);idx.delete(id);publish(ev);return json(res,200,{deleted:true})}
    if(req.method==="GET"&&(m=p.match(/^\/api\/ai\/([0-9a-f]{64})$/)))return json(res,200,aiOf(m[1])||{});
    if(req.method==="POST"&&(m=p.match(/^\/api\/ai\/([0-9a-f]{64})$/))){
      if(!KEY)return json(res,503,{error:"AI help is not set up on this server. Add GEMINI_API_KEY to the .env file and restart."});
      if(limited(ip))return json(res,429,{error:"Too many requests."});const r=idx.get(m[1]);if(!r||tag(r.event,"enc"))return json(res,404,{error:"AI help is only available for public stories."});
      const buf=await body(req,12*1024*1024);let ev;try{ev=JSON.parse(Buffer.from(req.headers["x-event"]||"","base64").toString())}catch(e){return json(res,400,{error:"Bad request."})}
      if(!await NS.check(ev)||ev.kind!==27235||!fresh(ev)||tag(ev,"e")!==m[1]||tag(ev,"x")!==sha(buf)||ev.pubkey!==r.event.pubkey)return json(res,403,{error:"Only the storyteller can ask for this, with a fresh signature."});
      const day=new Date().toISOString().slice(0,10);if(aiDay!==day){aiDay=day;aiN=0}if(aiN>=AIMAX)return json(res,429,{error:"The daily AI limit has been reached. Try tomorrow."});aiN++;
      try{const b64=buf.toString("base64"),HD={"content-type":"application/json","x-goog-api-key":KEY},call=(u,b)=>fetch(GBASE+u,{method:"POST",headers:HD,signal:AbortSignal.timeout(90000),body:JSON.stringify(b)});
        let g=await call("/v1beta/interactions",{model:MODEL,input:[{type:"text",text:PROMPT},{type:"audio",data:b64,mime_type:"audio/wav"}],response_format:SCHEMA}),mode="interactions";
        if(!g.ok&&[400,404,405].includes(g.status)){const g2=await call(`/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,{contents:[{parts:[{text:PROMPT},{inline_data:{mime_type:"audio/wav",data:b64}}]}],generationConfig:{responseMimeType:"application/json"}});if(g2.ok){g=g2;mode="generateContent"}}
        if(!g.ok){const ej=await g.json().catch(()=>({}));throw new Error("Gemini returned status "+g.status+(ej.error&&ej.error.message?": "+String(ej.error.message).slice(0,200):""))}
        const j=await g.json(),txt=mode==="interactions"?interactionText(j):(j.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("");if(!txt)throw new Error("Gemini sent a reply in an unexpected shape (keys: "+Object.keys(j).slice(0,8).join(", ")+")");
        const o=JSON.parse(txt),c=v=>typeof v==="string"?v.slice(0,20000):"";
        const out={language:c(o.language).slice(0,60),transcript:c(o.transcript),english:c(o.english),french:c(o.french),model:MODEL,created:new Date().toISOString()};
        if(!out.transcript)throw new Error("Gemini returned no transcript.");await put(aiFile(m[1]),JSON.stringify(out));return json(res,200,out)}
      catch(e){return json(res,502,{error:e.message.startsWith("Gemini")?e.message:"Could not read Gemini’s answer."})}}
    if(req.method==="GET"&&p==="/api/ln")return json(res,200,{enabled:lnmap.has(u.searchParams.get("pk")||"")});
    if(req.method==="POST"&&p==="/api/ln"){if(limited(ip))return json(res,429,{error:"Too many requests."});let ev;try{ev=JSON.parse(await body(req,2048))}catch(e){return json(res,400,{error:"Bad request."})}
      if(!await NS.check(ev)||ev.kind!==30078||tag(ev,"d")!=="gewel-lightning")return json(res,403,{error:"Signature is not valid."});if(!fresh(ev))return json(res,400,{error:"Request expired. Try again."});
      if(ev.content&&!LNA.test(ev.content))return json(res,400,{error:"Enter a Lightning address like name@wallet.com, or leave it empty to turn tips off."});
      const f=path.join(DATA,"ln-"+ev.pubkey+".json");if(ev.content){await put(f,JSON.stringify({address:ev.content}));lnmap.set(ev.pubkey,ev.content)}else{await drop(f);lnmap.delete(ev.pubkey)}
      return json(res,200,{enabled:!!ev.content})}
    if(req.method==="GET"&&(m=p.match(/^\/api\/tip\/([0-9a-f]{64})$/))){const r=idx.get(m[1]),addr=r&&lnmap.get(r.event.pubkey);if(!r)return json(res,404,{error:"Not found."});if(!addr)return json(res,404,{error:"This storyteller has not turned on tips."});
      if(limited(ip))return json(res,429,{error:"Too many requests."});const sats=Number(u.searchParams.get("sats"));if(!Number.isInteger(sats)||sats<1||sats>21e6)return json(res,400,{error:"Enter a whole number of sats."});
      try{const[name,host]=addr.split("@"),d=await lget((LOCAL?"http://":"https://")+host+"/.well-known/lnurlp/"+encodeURIComponent(name));
        if(d.tag!=="payRequest"||typeof d.callback!=="string")throw new Error("Not a Lightning address.");const ms=sats*1000;
        if(ms<d.minSendable||ms>d.maxSendable)return json(res,400,{error:`This wallet accepts ${Math.ceil(d.minSendable/1000)} to ${Math.floor(d.maxSendable/1000)} sats.`});
        const cb=new URL(d.callback);cb.searchParams.set("amount",ms);const iv=await lget(cb.href),pr=String(iv.pr||"").toLowerCase(),mm=pr.match(/^lnbc(\d+)([munp]?)1[02-9ac-hj-np-z]+$/);
        if(!mm||Math.round(mm[1]*UNIT[mm[2]])!==ms)throw new Error("The wallet returned an invoice for a different amount.");return json(res,200,{invoice:pr,sats})}catch(e){return json(res,502,{error:e.message})}}
    json(res,404,{error:"Not found."});
  }catch(e){json(res,e.code===413?413:500,{error:e.code===413?"Too large.":"Server error."})}
});
(async()=>{try{if(DBURL){await hydrate();console.log("Stories restored from the database.")}loadAll();server.listen(PORT,()=>console.log("Gewel on http://localhost:"+PORT))}catch(e){console.error("Could not start:",e.message);process.exit(1)}})();

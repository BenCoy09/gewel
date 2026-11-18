// Run: node test.js  (own server on port 3911, temp data folder, mock wallet on 3912)
const {spawn}=require("child_process"),assert=require("assert"),N=require("./nostr.js"),crypto=require("crypto");
const TMP=require("os").tmpdir()+"/gewel-test-"+Date.now(),B="http://localhost:3911",b64=s=>Buffer.from(s).toString("base64");
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const http=require("http"),WSK=N.genKey();
function miniRelay(port,wsk){const store=[],subs=[],M=(f,e)=>(!f.kinds||f.kinds.includes(e.kind))&&(!f.authors||f.authors.includes(e.pubkey))&&(!f["#e"]||e.tags.some(x=>x[0]==="e"&&f["#e"].includes(x[1])));
  const put=e=>{store.push(e);for(const s of subs)for(const[id,f]of Object.entries(s.f))if(M(f,e))s.out(["EVENT",id,e])};
  async function wallet(e){if(e.kind!==23194)return;const rq=JSON.parse(await N.nip04dec(wsk,e.pubkey,e.content));let r;
    if(rq.method==="get_balance")r={result:{balance:250000}};else if(rq.method==="make_invoice")r={result:{invoice:"lnbc"+rq.params.amount/1e5+"u1pqzqzqzqzqz"}};
    else if(rq.method==="pay_invoice"&&/^lnbc/.test(rq.params.invoice))r={result:{preimage:"ab".repeat(32)}};else r={error:{code:"OTHER",message:"Invoice not accepted"}};
    put(await N.event(wsk,23195,[["e",e.id],["p",e.pubkey]],await N.nip04enc(wsk,e.pubkey,JSON.stringify(r))))}
  const srv=http.createServer().on("upgrade",(req,sock)=>{sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "+crypto.createHash("sha1").update(req.headers["sec-websocket-key"]+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")+"\r\n\r\n");
    const s={f:{},out:a=>{const p=Buffer.from(JSON.stringify(a));sock.write(Buffer.concat([Buffer.from(p.length<126?[0x81,p.length]:[0x81,126,p.length>>8,p.length&255]),p]))}};subs.push(s);let buf=Buffer.alloc(0);
    sock.on("data",d=>{buf=Buffer.concat([buf,d]);for(;;){if(buf.length<2)return;const op=buf[0]&15;let len=buf[1]&127,o=2;if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);o=4}if(buf.length<o+4+len)return;
      const mk=buf.subarray(o,o+4),pl=Buffer.from(buf.subarray(o+4,o+4+len).map((b,i)=>b^mk[i%4]));buf=buf.subarray(o+4+len);if(op===8)return sock.end();if(op!==1)continue;
      const a=JSON.parse(pl);if(a[0]==="REQ"){s.f[a[1]]=a[2];for(const e of store)if(M(a[2],e))s.out(["EVENT",a[1],e]);s.out(["EOSE",a[1]])}
      if(a[0]==="EVENT"){s.out(["OK",a[1].id,true,""]);put(a[1]);wallet(a[1])}}});sock.on("error",()=>{})}).listen(port);return srv}
const relay=miniRelay(3913,WSK);let seen={};const otsSeen=[];
const cal=http.createServer(async(q,r)=>{const ch=[];for await(const d of q)ch.push(d);otsSeen.push({url:q.url,body:Buffer.concat(ch),accept:q.headers.accept});r.end(crypto.randomBytes(40))}).listen(3915);
let gemMode="interactions";const GJ=JSON.stringify({language:"Wolof",transcript:"Bés bu rafet la",english:"It was a beautiful day",french:"C’était une belle journée"});
const gem=http.createServer(async(q,r)=>{let b="";for await(const d of q)b+=d;seen={url:q.url,key:q.headers["x-goog-api-key"],body:JSON.parse(b)};r.setHeader("content-type","application/json");
  if(q.url==="/v1beta/interactions"){if(gemMode==="fallback"){r.statusCode=404;return r.end(JSON.stringify({error:{message:"model not found"}}))}return r.end(JSON.stringify({outputs:[{type:"text",text:GJ}]}))}
  r.end(JSON.stringify({candidates:[{content:{parts:[{text:GJ}]}}]}))}).listen(3914);
const mock=require("http").createServer((q,r)=>{const u=new URL(q.url,"http://x");r.setHeader("content-type","application/json");
  if(u.pathname==="/.well-known/lnurlp/tester")return r.end(JSON.stringify({tag:"payRequest",callback:"http://localhost:3912/cb",minSendable:1000,maxSendable:5000000,metadata:"[]"}));
  if(u.pathname==="/cb"){const sats=+u.searchParams.get("amount")/1000;return r.end(JSON.stringify({pr:"lnbc"+(sats===777?1:sats/100)+"u1pqzqzqzqzqz"}))}
  r.statusCode=404;r.end("{}")}).listen(3912);
(async()=>{
  const s=spawn("node",["server.js"],{cwd:__dirname,env:{...process.env,PORT:3911,DATA_DIR:TMP,ALLOW_LOCAL_LNURL:"1",GEMINI_API_KEY:"testkey",OTS_CALENDARS:"http://localhost:3915",GEMINI_BASE:"http://localhost:3914",RELAYS:"ws://localhost:1,ws://localhost:3913"}});await new Promise(r=>setTimeout(r,700));
  try{
    /* crypto against published vectors */
    const sk3="0".repeat(63)+"3";assert.equal(N.pubkey(sk3),"f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9","BIP-340 public key vector");
    assert(await N.verify("e907831f80848d1069a5371b402410364bdf1c5f8307b0084c55f1ce2dca821525f66a4a85ea8b71e482a74f382d2ce5ebeee8fdb2172f477df4900d310536c0",new Uint8Array(32),N.pubkey(sk3)),"BIP-340 signature vector");
    assert.equal(N.enc("nsec","67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa"),"nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5","NIP-19 nsec vector");
    const A2=N.genKey(),B2=N.genKey();assert.equal(N.ecdh(A2,N.pubkey(B2)),N.ecdh(B2,N.pubkey(A2)),"ECDH is symmetric");
    assert.equal(await N.nip04dec(B2,N.pubkey(A2),await N.nip04enc(A2,N.pubkey(B2),"hello wallet")),"hello wallet","NIP-04 round trip");
    const data=crypto.randomBytes(5000),sl=await N.seal(A2,data);assert(Buffer.from(await N.open(A2,sl.ct,sl.iv)).equals(data),"sealed audio opens with its key");
    await assert.rejects(()=>N.open(B2,sl.ct,sl.iv),"sealed audio does not open with another key");const bt=Uint8Array.from(sl.ct);bt[3]^=1;await assert.rejects(()=>N.open(A2,bt,sl.iv),"tampered ciphertext is rejected");
    const uri="nostr+walletconnect://"+N.pubkey(WSK)+"?relay="+encodeURIComponent("ws://localhost:3913")+"&secret="+N.genKey();
    assert.equal((await N.nwc(uri,"get_balance")).balance,250000,"NWC balance through a relay");
    assert(/^lnbc1u1/.test((await N.nwc(uri,"make_invoice",{amount:100000})).invoice),"NWC invoice");
    assert.equal((await N.nwc(uri,"pay_invoice",{invoice:"lnbc1u1pqzqzqzqzqz"})).preimage.length,64,"NWC payment");
    await assert.rejects(()=>N.nwc(uri,"pay_invoice",{invoice:"bad"}),/Invoice not accepted/,"NWC wallet error surfaces");
    await assert.rejects(()=>N.nwc("nostr+walletconnect://abc?relay=wss://x&secret=1","get_balance"),/valid wallet connection/,"bad NWC string refused");
    /* server */
    const sk=N.genKey(),pk=N.pubkey(sk),audio=crypto.randomBytes(2048);
    const mk=(t)=>N.event(sk,1,[["title","Market day, January 1994"],["topic","1994 devaluation of the CFA franc"],["lang","Wolof"],["author","Test"],["x",sha(audio)],["t","gewel"],...(t||[])],"Market day (voice story on Gewel)");
    const post=(ev,buf,ct="audio/webm",extra={})=>fetch(B+"/api/stories",{method:"POST",headers:{...extra,"content-type":ct,"x-event":b64(JSON.stringify(ev))},body:buf});
    const ev=await mk();assert.equal((await post(ev,audio)).status,201,"valid story accepted");
    assert.equal((await post(ev,audio)).status,409,"duplicate refused");
    assert.equal((await post(await mk([["z","1"]]),Buffer.concat([audio,Buffer.from("x")]))).status,400,"altered audio refused");
    assert.equal((await post({...ev,content:"edited"},audio)).status,400,"edited event refused");
    assert.equal((await post(await N.event(sk,7,[["title","a"]],"x"),audio)).status,400,"wrong event kind refused");
    assert.equal((await (await fetch(B+"/api/stories?pk="+pk)).json()).stories.length,1,"history restored by public key");
    const html=await (await fetch(B+"/s/"+ev.id)).text();assert(html.includes("Nostr signature is valid")&&html.includes("matches the signed fingerprint")&&html.includes("npub1"),"public page verifies");
    await new Promise(r=>setTimeout(r,1500));const rl=await (await fetch(B+"/api/relays/"+ev.id)).json();assert(Object.values(rl).join().includes("could not connect")&&Object.values(rl).includes("accepted"),"relay failure reported honestly: "+JSON.stringify(rl));
    /* relays chosen by the storyteller */
    const rv=await mk([["r","1"]]);assert.equal((await post(rv,audio,"audio/webm",{"x-relays":"http://evil.example"})).status,400,"non-wss relay refused");
    assert.equal((await post(await mk([["r","2"]]),audio,"audio/webm",{"x-relays":"ws://localhost:3913,wss://a.example,wss://b.example,wss://c.example,wss://d.example,wss://e.example"})).status,400,"more than 5 relays refused");
    const cv=await mk([["r","3"]]);assert.equal((await post(cv,audio,"audio/webm",{"x-relays":"ws://localhost:3913"})).status,201,"story with chosen relay accepted");
    await new Promise(r=>setTimeout(r,1200));const cr=await (await fetch(B+"/api/relays/"+cv.id)).json();assert.deepEqual(Object.keys(cr),["ws://localhost:3913"],"only the chosen relay is used");assert.equal(cr["ws://localhost:3913"],"accepted","chosen relay accepted the note");
    /* Bitcoin timestamp request (OpenTimestamps calendar) */
    const od=await (await fetch(B+"/api/ots/"+cv.id)).json();assert.equal(od.status,"pending","timestamp requested");
    const sent=otsSeen.find(x=>x.body.toString("hex")===cv.id);assert(sent&&sent.url==="/digest"&&sent.accept.includes("opentimestamps"),"the note id is sent to the calendar as a 32-byte digest");
    const txt=await (await fetch(B+"/ots/"+cv.id+".txt")).text();assert.equal(sha(txt),cv.id,"event text hashes to the note id, so the proof file matches");
    const otsb=Buffer.from(await (await fetch(B+"/ots/"+cv.id+".txt.ots")).arrayBuffer());assert(otsb.subarray(0,31).toString("latin1").includes("OpenTimestamps")&&otsb.includes(Buffer.from(cv.id,"hex")),".ots file has the header and the digest");
    assert((await (await fetch(B+"/s/"+cv.id)).text()).includes("pending until Bitcoin confirms"),"public page says pending, not confirmed");
    const wev=await mk([["wall","1"]]);assert.equal((await post(wev,audio)).status,201,"public wall story accepted");
    const pe=await N.event(sk,1,[["title","Private one"],["topic","Savings circle (tontine)"],["lang","Wolof"],["author","Test"],["enc","aes-256-gcm"],["iv",sl.iv],["xp",sha(data)],["mime","audio/webm"],["x",sha(sl.ct)],["t","gewel"],["wall","1"]],"Private one");
    assert.equal((await post(pe,Buffer.from(sl.ct),"application/octet-stream")).status,201,"private story accepted");
    const ph=await (await fetch(B+"/s/"+pe.id)).text();assert(ph.includes("This story is private")&&!ph.includes("<audio"),"private page shows no player");
    const wall=(await (await fetch(B+"/api/wall")).json()).stories.map(e=>e.id);assert(wall.includes(wev.id)&&!wall.includes(pe.id)&&!wall.includes(ev.id),"wall lists only public, opted-in stories");
    assert.equal((await post({...pe,tags:pe.tags.filter(x=>x[0]!=="iv")},Buffer.from(sl.ct),"application/octet-stream")).status,400,"incomplete private story refused");
    const wav=crypto.randomBytes(3000),aiReq=async(k,id,body=wav,tx)=>fetch(B+"/api/ai/"+id,{method:"POST",headers:{"content-type":"audio/wav","x-event":b64(JSON.stringify(await N.event(k,27235,[["e",id],["x",tx||sha(body)]],"gewel-ai")))},body});
    const ar=await aiReq(sk,wev.id);assert.equal(ar.status,200,"AI transcript made");const aj=await ar.json();assert(aj.transcript&&aj.french&&aj.english,"AI result has transcript and translations");
    assert(seen.url==="/v1beta/interactions"&&seen.key==="testkey"&&seen.body.model==="gemini-3.8-flash"&&seen.body.input[1].type==="audio"&&seen.body.input[1].mime_type==="audio/wav"&&seen.body.response_format.type==="object","request uses the Interactions API with the key in a header and audio inline");
    gemMode="fallback";const fb=await aiReq(sk,cv.id);assert.equal(fb.status,200,"falls back to generateContent when the Interactions endpoint is not found");assert(seen.url.includes(":generateContent"),"fallback used the generateContent endpoint");gemMode="interactions";
    /* audio served with Range support (iPhone) and content-type parameters stripped */
    const full=await fetch(B+"/api/audio/"+wev.id);assert.equal(full.headers.get("accept-ranges"),"bytes","audio advertises byte ranges");
    const r1=await fetch(B+"/api/audio/"+wev.id,{headers:{range:"bytes=0-9"}});assert.equal(r1.status,206,"range request gets 206");assert.equal(r1.headers.get("content-range"),"bytes 0-9/"+audio.length,"content-range is correct");assert(Buffer.from(await r1.arrayBuffer()).equals(audio.subarray(0,10)),"range bytes are correct");
    const r2=await fetch(B+"/api/audio/"+wev.id,{headers:{range:"bytes=-5"}});assert.equal(r2.status,206,"suffix range works");assert(Buffer.from(await r2.arrayBuffer()).equals(audio.subarray(audio.length-5)),"suffix bytes are correct");
    assert.equal((await fetch(B+"/api/audio/"+wev.id,{headers:{range:"bytes=999999-"}})).status,416,"out-of-range request gets 416");
    const mv=await mk([["m","1"]]);assert.equal((await post(mv,audio,"audio/mp4;codecs=mp4a.40.2")).status,201,"iPhone-style content type accepted");assert.equal((await fetch(B+"/api/audio/"+mv.id)).headers.get("content-type"),"audio/mp4","codec parameters are stripped so the browser can play it");
    assert((await (await fetch(B+"/s/"+wev.id)).text()).includes("Made by a machine"),"AI text is labelled on the public page");
    assert.equal((await aiReq(N.genKey(),wev.id)).status,403,"only the author can request AI help");
    assert.equal((await aiReq(sk,wev.id,wav,"0".repeat(64))).status,403,"signature must match the audio sent");
    assert.equal((await aiReq(sk,pe.id)).status,404,"private stories cannot use AI help");
    /* Lightning address and tips */
    const ln=(c,k)=>N.event(k||sk,30078,[["d","gewel-lightning"]],c).then(e=>fetch(B+"/api/ln",{method:"POST",body:JSON.stringify(e)}));
    assert.equal((await ln("not an address")).status,400,"malformed address refused");
    const bad=await N.event(sk,30078,[["d","gewel-lightning"]],"tester@localhost:3912");bad.content="evil@localhost:3912";assert.equal((await fetch(B+"/api/ln",{method:"POST",body:JSON.stringify(bad)})).status,403,"edited request refused");
    const old=await N.event(sk,30078,[["d","gewel-lightning"]],"tester@localhost:3912");old.created_at-=9000;assert.equal((await fetch(B+"/api/ln",{method:"POST",body:JSON.stringify(old)})).status,403,"stale request refused");
    assert.equal((await ln("tester@localhost:3912")).status,200,"signed address saved");
    const tip=await (await fetch(B+"/api/tip/"+ev.id+"?sats=500")).json();assert(/^lnbc5u1/.test(tip.invoice),"invoice has the right amount");
    assert.equal((await fetch(B+"/api/tip/"+ev.id+"?sats=10000")).status,400,"amount above wallet limit refused");
    assert.equal((await fetch(B+"/api/tip/"+ev.id+"?sats=777")).status,502,"mismatched invoice refused");
    /* deletion (NIP-09) */
    const del=(k)=>N.event(k,5,[["e",ev.id]],"").then(e=>fetch(B+"/api/delete",{method:"POST",body:JSON.stringify(e)}));
    assert.equal((await del(N.genKey())).status,403,"another key cannot delete");
    assert.equal((await del(sk)).status,200,"author can delete");
    assert.equal((await fetch(B+"/s/"+ev.id)).status,404,"story gone");
    /* durable storage in Neon (against a mock of its HTTP SQL endpoint) */
    const DBU="postgres://user:secretpw@localhost:3916/db",files=new Map();let failInsert=false;
    const neon=http.createServer(async(q,r)=>{let b="";for await(const d of q)b+=d;r.setHeader("content-type","application/json");
      if(q.url!=="/sql"||q.headers["neon-connection-string"]!==DBU){r.statusCode=401;return r.end(JSON.stringify({message:"unauthorized"}))}
      const j=JSON.parse(b);let rows=[];if(/^INSERT/i.test(j.query)){if(failInsert){r.statusCode=500;return r.end(JSON.stringify({message:"boom"}))}files.set(j.params[0],j.params[1])}
      else if(/^DELETE/i.test(j.query))files.delete(j.params[0]);else if(/^SELECT name FROM/i.test(j.query))rows=[...files.keys()].map(name=>({name}));else if(/^SELECT encode/i.test(j.query))rows=[{data:files.get(j.params[0])}];
      r.end(JSON.stringify({command:"X",rowCount:rows.length,rows,fields:[]}))}).listen(3916);
    const dir=n=>require("os").tmpdir()+"/gewel-db-"+n+"-"+Date.now(),dA=dir("a"),dB=dir("b");
    const boot=(port,d)=>spawn("node",["server.js"],{cwd:__dirname,env:{...process.env,PORT:port,DATA_DIR:d,DATABASE_URL:DBU,NEON_HTTP_BASE:"http://localhost:3916",RELAYS:"",OTS_CALENDARS:"http://localhost:3915"}});
    const up=async p=>{for(let i=0;i<40;i++){try{await fetch("http://localhost:"+p+"/api/wall");return}catch(e){await new Promise(r=>setTimeout(r,200))}}throw new Error("database-backed server did not start")};
    const sA=boot(3920,dA);try{await up(3920);
      const dev=await N.event(sk,1,[["title","DB one"],["topic","t"],["lang","Wolof"],["author","Test"],["x",sha(audio)],["t","gewel"]],"DB one");
      const pA=(e)=>fetch("http://localhost:3920/api/stories",{method:"POST",headers:{"content-type":"audio/webm","x-event":b64(JSON.stringify(e))},body:audio});
      assert.equal((await pA(dev)).status,201,"story saved with the database on");assert(files.has(dev.id+".json")&&files.has(dev.id+".bin"),"story files mirrored to the database");assert(Buffer.from(files.get(dev.id+".bin"),"base64").equals(audio),"database holds the exact audio");
      failInsert=true;const dev2=await N.event(sk,1,[["title","DB two"],["topic","t"],["lang","Wolof"],["author","Test"],["x",sha(audio)],["t","gewel"]],"DB two");
      assert.equal((await pA(dev2)).status,502,"a failed database write is reported, not hidden");failInsert=false;
      assert.equal((await (await fetch("http://localhost:3920/api/stories?pk="+pk)).json()).stories.length,1,"the failed story was not kept");
      const sB=boot(3921,dB);try{await up(3921);
        assert.equal((await (await fetch("http://localhost:3921/api/stories?pk="+pk)).json()).stories.length,1,"a fresh server with an empty disk restores the story");
        assert(Buffer.from(await (await fetch("http://localhost:3921/api/audio/"+dev.id)).arrayBuffer()).equals(audio),"restored audio is identical");
        assert((await (await fetch("http://localhost:3921/s/"+dev.id)).text()).includes("signature is valid"),"restored story still verifies");
        const del=await N.event(sk,5,[["e",dev.id]],"");assert.equal((await fetch("http://localhost:3921/api/delete",{method:"POST",body:JSON.stringify(del)})).status,200,"delete works on the restored server");
        assert(!files.has(dev.id+".json")&&!files.has(dev.id+".bin"),"delete removes the database copy too, so it cannot come back")}finally{sB.kill()}
    }finally{sA.kill();neon.close();for(const d of[dA,dB])require("fs").rmSync(d,{recursive:true,force:true})}
    console.log("ALL TESTS PASSED");
  }catch(e){console.error("FAILED:",e.message);process.exitCode=1}finally{s.kill();mock.close();relay.close();gem.close();cal.close();setTimeout(()=>process.exit(process.exitCode||0),200);require("fs").rmSync(TMP,{recursive:true,force:true})}
})();

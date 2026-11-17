// Nostr toolkit with no dependencies. Runs in Node and in the browser.
// BIP-340 Schnorr on secp256k1, NIP-01 events, NIP-19 bech32 keys (nsec / npub).
(function(g){
const P=2n**256n-2n**32n-977n,N=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,
G=[0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n];
const C=g.crypto||require("crypto").webcrypto,te=new TextEncoder();
const mod=(a,m=P)=>((a%m)+m)%m;
const hex=b=>[...b].map(x=>x.toString(16).padStart(2,"0")).join(""),unhex=h=>Uint8Array.from(h.match(/../g)||[],x=>parseInt(x,16));
const n2b=n=>unhex(n.toString(16).padStart(64,"0")),b2n=b=>BigInt("0x"+(hex(b)||"0"));
const cat=(...a)=>{const o=new Uint8Array(a.reduce((s,x)=>s+x.length,0));let i=0;for(const x of a){o.set(x,i);i+=x.length}return o};
const H=async b=>new Uint8Array(await C.subtle.digest("SHA-256",b));
const T=async(t,...d)=>{const h=await H(te.encode(t));return H(cat(h,h,...d))};
function inv(a,m=P){let r0=m,r1=mod(a,m),t0=0n,t1=1n;while(r1){const q=r0/r1;[r0,r1]=[r1,r0-q*r1];[t0,t1]=[t1,t0-q*t1]}return mod(t0,m)}
function pow(b,e,m=P){let r=1n;b=mod(b,m);while(e>0n){if(e&1n)r=r*b%m;b=b*b%m;e>>=1n}return r}
function add(p,q){if(!p)return q;if(!q)return p;const[x1,y1]=p,[x2,y2]=q;let l;
  if(x1===x2){if(mod(y1+y2)===0n)return null;l=mod(3n*x1*x1*inv(2n*y1))}else l=mod((y2-y1)*inv(x2-x1));
  const x=mod(l*l-x1-x2);return[x,mod(l*(x1-x)-y1)]}
function mul(k,p=G){let r=null;while(k>0n){if(k&1n)r=add(r,p);p=add(p,p);k>>=1n}return r}
const pubkey=sk=>hex(n2b(mul(BigInt("0x"+sk))[0]));
async function sign(m,sk){const d0=BigInt("0x"+sk);if(d0<1n||d0>=N)throw new Error("bad key");const Q=mul(d0),d=Q[1]%2n?N-d0:d0,px=n2b(Q[0]);
  const t=d^b2n(await T("BIP0340/aux",C.getRandomValues(new Uint8Array(32))));const k0=b2n(await T("BIP0340/nonce",n2b(t),px,m))%N;if(!k0)throw new Error("bad nonce");
  const R=mul(k0),k=R[1]%2n?N-k0:k0,e=b2n(await T("BIP0340/challenge",n2b(R[0]),px,m))%N;return hex(cat(n2b(R[0]),n2b(mod(k+e*d,N))))}
async function verify(sig,m,pk){try{if(!/^[0-9a-f]{128}$/.test(sig)||!/^[0-9a-f]{64}$/.test(pk))return false;
  const x=BigInt("0x"+pk),r=BigInt("0x"+sig.slice(0,64)),s=BigInt("0x"+sig.slice(64));if(x>=P||r>=P||s>=N)return false;
  const c=mod(x**3n+7n),y=pow(c,(P+1n)/4n);if(mod(y*y)!==c)return false;
  const e=b2n(await T("BIP0340/challenge",n2b(r),n2b(x),m))%N,R=add(mul(s),mul(N-e,[x,y%2n?P-y:y]));return!!R&&R[1]%2n===0n&&R[0]===r}catch(e){return false}}
const eid=async e=>hex(await H(te.encode(JSON.stringify([0,e.pubkey,e.created_at,e.kind,e.tags,e.content]))));
async function event(sk,kind,tags,content){const e={pubkey:pubkey(sk),created_at:Math.floor(Date.now()/1000),kind,tags,content};e.id=await eid(e);e.sig=await sign(unhex(e.id),sk);return e}
async function check(e){try{return!!e&&typeof e.content==="string"&&Array.isArray(e.tags)&&Number.isInteger(e.kind)&&Number.isInteger(e.created_at)&&/^[0-9a-f]{64}$/.test(e.id||"")&&e.id===await eid(e)&&await verify(e.sig,unhex(e.id),e.pubkey)}catch(x){return false}}
const CH="qpzry9x8gf2tvdw0s3jn54khce6mua7l",GEN=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
const poly=v=>{let c=1;for(const x of v){const b=c>>25;c=((c&0x1ffffff)<<5)^x;GEN.forEach((q,i)=>{if((b>>i)&1)c^=q})}return c};
const hx=h=>[...h].map(c=>c.charCodeAt(0)>>5).concat(0,[...h].map(c=>c.charCodeAt(0)&31));
const words=b=>{let a=0,n=0,o=[];for(const x of b){a=(a<<8)|x;n+=8;while(n>=5){n-=5;o.push((a>>n)&31)}a&=(1<<n)-1}if(n)o.push((a<<(5-n))&31);return o};
const bytes=w=>{let a=0,n=0,o=[];for(const v of w){a=(a<<5)|v;n+=5;if(n>=8){n-=8;o.push((a>>n)&255)}a&=(1<<n)-1}return Uint8Array.from(o)};
function bech(hrp,b){const d=words(b),m=poly(hx(hrp).concat(d,[0,0,0,0,0,0]))^1;return hrp+"1"+d.concat([0,1,2,3,4,5].map(i=>(m>>(5*(5-i)))&31)).map(x=>CH[x]).join("")}
function unbech(s){s=s.toLowerCase();const i=s.lastIndexOf("1"),hrp=s.slice(0,i),d=[...s.slice(i+1)].map(c=>CH.indexOf(c));if(i<1||d.includes(-1)||poly(hx(hrp).concat(d))!==1)throw new Error("bad key");return{hrp,bytes:bytes(d.slice(0,-6))}}
const b64=b=>btoa(String.fromCharCode(...b)),ub64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const lift=pk=>{const x=BigInt("0x"+pk),c=mod(x**3n+7n),y=pow(c,(P+1n)/4n);if(mod(y*y)!==c)throw new Error("bad key");return[x,y%2n?P-y:y]};
const ecdh=(sk,pk)=>hex(n2b(mul(BigInt("0x"+sk),lift(pk))[0]));
const k04=(sk,pk)=>C.subtle.importKey("raw",unhex(ecdh(sk,pk)),"AES-CBC",false,["encrypt","decrypt"]);
async function nip04enc(sk,pk,text){const iv=C.getRandomValues(new Uint8Array(16));return b64(new Uint8Array(await C.subtle.encrypt({name:"AES-CBC",iv},await k04(sk,pk),te.encode(text))))+"?iv="+b64(iv)}
async function nip04dec(sk,pk,s){const[c,i]=s.split("?iv=");return new TextDecoder().decode(await C.subtle.decrypt({name:"AES-CBC",iv:ub64(i)},await k04(sk,pk),ub64(c)))}
const ak=async(sk,use)=>C.subtle.deriveKey({name:"HKDF",hash:"SHA-256",salt:new Uint8Array(32),info:te.encode("gewel-audio-v1")},await C.subtle.importKey("raw",unhex(sk),"HKDF",false,["deriveKey"]),{name:"AES-GCM",length:256},false,[use]);
async function seal(sk,bytes){const iv=C.getRandomValues(new Uint8Array(12));return{iv:b64(iv),ct:new Uint8Array(await C.subtle.encrypt({name:"AES-GCM",iv},await ak(sk,"encrypt"),bytes))}}
async function openSeal(sk,ct,iv){return new Uint8Array(await C.subtle.decrypt({name:"AES-GCM",iv:ub64(iv)},await ak(sk,"decrypt"),ct))}
/* Nostr Wallet Connect (NIP-47) client, NIP-04 encryption only */
async function nwc(uri,method,params={},WS=g.WebSocket){
  const u=new URL(uri.trim().replace(/^nostr\+walletconnect:\/\//,"https://")),wpk=u.hostname,sk=u.searchParams.get("secret"),relay=u.searchParams.get("relay")||"";
  if(!/^[0-9a-f]{64}$/.test(wpk)||!/^[0-9a-f]{64}$/.test(sk||"")||!/^(wss:\/\/|ws:\/\/localhost)/.test(relay))throw new Error("That is not a valid wallet connection string.");
  const req=await event(sk,23194,[["p",wpk]],await nip04enc(sk,wpk,JSON.stringify({method,params})));
  return new Promise((res,rej)=>{let ws;const done=(f,v)=>{clearTimeout(t);try{ws.close()}catch(e){}f(v)},t=setTimeout(()=>done(rej,new Error("The wallet did not answer in time.")),25000);
    try{ws=new WS(relay)}catch(e){return done(rej,new Error("Could not connect to the wallet relay."))}
    ws.onerror=()=>done(rej,new Error("Could not connect to the wallet relay."));
    ws.onopen=()=>{ws.send(JSON.stringify(["REQ","r",{kinds:[23195],authors:[wpk],"#e":[req.id]}]));ws.send(JSON.stringify(["EVENT",req]))};
    ws.onmessage=async m=>{try{const a=JSON.parse(m.data);if(a[0]==="OK"&&a[1]===req.id&&!a[2])return done(rej,new Error("The relay refused the request: "+a[3]));
      if(a[0]==="EVENT"&&a[2].kind===23195&&a[2].pubkey===wpk&&await check(a[2])){const r=JSON.parse(await nip04dec(sk,wpk,a[2].content));if(r.error)return done(rej,new Error(r.error.message||r.error.code));done(res,r.result)}}catch(e){done(rej,new Error("Could not read the wallet reply."))}}})}
const X={P,N,G,mod,mul,hex,unhex,H,pubkey,sign,verify,event,check,bech,unbech,ecdh,nip04enc,nip04dec,seal,open:openSeal,nwc,
  enc:(hrp,h)=>bech(hrp,unhex(h)),dec:s=>{const o=unbech(s);return{hrp:o.hrp,hex:hex(o.bytes)}},
  genKey:()=>{for(;;){const k=hex(C.getRandomValues(new Uint8Array(32))),n=BigInt("0x"+k);if(n>0n&&n<N)return k}}};
if(typeof module!=="undefined")module.exports=X;else g.Nostr=X;
})(typeof globalThis!=="undefined"?globalThis:this);

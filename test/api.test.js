// Run: node test/api.test.js   (no network; fake Upstash + fake Google)
process.env.UPSTASH_REDIS_REST_URL='http://fake-redis';process.env.UPSTASH_REDIS_REST_TOKEN='t';process.env.SESSION_SECRET='s3cret';process.env.GOOGLE_CLIENT_ID='cid.apps.googleusercontent.com';
const kv=new Map();const exp=new Map();
const H=k=>{let h=kv.get(k);if(!h){h=new Map();kv.set(k,h)}return h};
function cmd(a){const [c,...r]=a;const C=c.toUpperCase();
 switch(C){
 case'GET':return kv.has(r[0])&&typeof kv.get(r[0])==='string'?kv.get(r[0]):null;
 case'SET':{if(r.includes('NX')&&kv.has(r[0]))return null;kv.set(r[0],r[1]);return'OK'}
 case'SETNX':if(kv.has(r[0]))return 0;kv.set(r[0],r[1]);return 1;
 case'HSET':{const h=H(r[0]);for(let i=1;i<r.length;i+=2)h.set(r[i],r[i+1]);return 1}
 case'HGET':return(kv.get(r[0])instanceof Map&&kv.get(r[0]).get(r[1]))??null;
 case'HMGET':return r.slice(1).map(f=>(kv.get(r[0])instanceof Map&&kv.get(r[0]).get(f))??null);
 case'HGETALL':{const h=kv.get(r[0]);return h instanceof Map?[...h].flat():[]}
 case'ZADD':{const z=kv.get('z'+r[0])||new Map();z.set(r[2],+r[1]);kv.set('z'+r[0],z);return 1}
 case'ZREVRANGE':{const z=[...(kv.get('z'+r[0])||new Map())].sort((a,b)=>b[1]-a[1]).slice(+r[1],+r[2]+1);return r[3]?z.flatMap(([k,v])=>[k,String(v)]):z.map(x=>x[0])}
 case'ZREVRANK':{const z=[...(kv.get('z'+r[0])||new Map())].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);const i=z.indexOf(r[1]);return i<0?null:i}
 case'LPUSH':{const l=kv.get(r[0])||[];l.unshift(r[1]);kv.set(r[0],l);return l.length}
 case'LRANGE':{const l=kv.get(r[0]);return Array.isArray(l)?l.slice(+r[1],+r[2]+1):[]}
 case'LTRIM':{const l=kv.get(r[0]);if(Array.isArray(l))kv.set(r[0],l.slice(+r[1],+r[2]+1));return'OK'}
 case'DEL':kv.delete(r[0]);return 1;
 case'INCR':{const v=(+kv.get(r[0])||0)+1;kv.set(r[0],String(v));return v}
 case'EXPIRE':return 1;
 case'SADD':{const s=kv.get(r[0])||new Set();s.add(r[1]);kv.set(r[0],s);return 1}
 case'SMEMBERS':return[...(kv.get(r[0])||[])];
 case'SCARD':return(kv.get(r[0])||new Set()).size;
 case'SISMEMBER':return(kv.get(r[0])||new Set()).has(r[1])?1:0;
 }throw new Error('cmd '+C)}
const people={tokA:{sub:'1',name:'Doris',aud:process.env.GOOGLE_CLIENT_ID,iss:'accounts.google.com',email_verified:'true'},tokB:{sub:'2',name:'Bạn B',aud:process.env.GOOGLE_CLIENT_ID,iss:'accounts.google.com',email_verified:'true'},tokEvil:{sub:'9',name:'X',aud:'other',iss:'accounts.google.com'}};
global.fetch=async(url,opt)=>{
 if(String(url).startsWith('http://fake-redis')){if(opt.headers.Authorization!=='Bearer t')return{ok:false,status:401,json:async()=>({error:'no'})};try{return{ok:true,json:async()=>({result:cmd(JSON.parse(opt.body))})}}catch(e){return{ok:false,status:500,json:async()=>({error:e.message})}}}
 const t=new URL(url).searchParams.get('id_token');const p=people[t];return p?{ok:true,json:async()=>p}:{ok:false,json:async()=>({})}};
const mods={auth:require('../api/auth'),save:require('../api/save'),score:require('../api/score'),friends:require('../api/friends'),config:require('../api/config')};
async function call(m,method,body,cookie){return new Promise(async res=>{const r={headers:{},setHeader(k,v){this.headers[k]=v},end(s){res({status:this.statusCode,json:JSON.parse(s),headers:this.headers})}};await mods[m]({method,headers:{cookie:cookie||''},body},r)})}
const cookieOf=r=>(r.headers['Set-Cookie']||'').split(';')[0];
let fail=0;const ok=(c,n)=>{console.log((c?'PASS ':'FAIL ')+n);if(!c)fail++};
(async()=>{
 ok((await call('config','GET')).json.clientId===process.env.GOOGLE_CLIENT_ID,'config exposes client id');
 ok((await call('auth','POST',{credential:'tokEvil'})).status===401,'wrong audience rejected');
 ok((await call('auth','POST',{credential:'nope'})).status===401,'bad token rejected');
 const a=await call('auth','POST',{credential:'tokA'});const ca=cookieOf(a);ok(a.status===200&&/^[A-Z0-9]{6}$/.test(a.json.user.code),'login A + friend code');
 const a2=await call('auth','POST',{credential:'tokA'});ok(a2.json.user.code===a.json.user.code,'same code on re-login');
 ok((await call('auth','GET',null,ca)).json.user.name==='Doris','GET /auth session');
 ok((await call('auth','GET',null,ca.slice(0,-3)+'xxx')).json.user===null,'tampered cookie = logged out');
 ok((await call('save','GET')).status===401,'save needs login');
 ok((await call('save','GET',null,ca)).json.save===null,'empty cloud save');
 const p1=await call('save','PUT',{data:{cash:100,day:3},baseUpdatedAt:0},ca);ok(p1.status===200,'save PUT');
 ok((await call('save','GET',null,ca)).json.save.data.day===3,'save GET roundtrip');
 const stale=await call('save','PUT',{data:{cash:1},baseUpdatedAt:0},ca);ok(stale.status===409&&stale.json.save.data.day===3,'stale overwrite → 409 with server copy');
 ok((await call('save','PUT',{data:{cash:5,day:4},baseUpdatedAt:p1.json.updatedAt},ca)).status===200,'fresh overwrite ok');
 ok((await call('save','PUT',{data:{big:'x'.repeat(210000)},force:true},ca)).status===413,'oversize rejected');
 const sc=await call('score','POST',{cash:9e12,assets:10,level:4,day:7,rep:3.5,cart:'banhmi',deco:{a:1}},ca);ok(sc.status===200&&sc.json.wealth===5e9+10,'score capped');
 ok((await call('score','POST',{cash:1},ca)).status===429,'score rate limited');
 const b=await call('auth','POST',{credential:'tokB'});const cb=cookieOf(b);await call('score','POST',{cash:50,level:1,day:1},cb);
 const lb=await call('score','GET',null,ca);ok(lb.json.rows.length===2&&lb.json.rows[0].name==='Doris'&&lb.json.me===1,'leaderboard order + my rank');
 ok((await call('friends','POST',{code:'ZZZZZZ'},ca)).status===404,'bad friend code');
 ok((await call('friends','POST',{code:a.json.user.code},ca)).status===400,'cannot add self');
 ok((await call('friends','POST',{visit:'g2'},ca)).status===403,'visit non-friend blocked');
 const add=await call('friends','POST',{code:b.json.user.code},ca);ok(add.status===200&&add.json.friend.name==='Bạn B','add friend');
 ok((await call('friends','GET',null,cb)).json.friends[0].name==='Doris','friendship is mutual');
 const v1=await call('friends','POST',{visit:'g2'},ca);ok(v1.json.bonus===5,'first visit bonus');
 ok((await call('friends','POST',{visit:'g2'},ca)).json.bonus===0,'second visit same day no bonus');
 const g1=await call('friends','POST',{gift:b.json.user.uid},ca);ok(g1.status===200,'send gift');
 ok((await call('friends','POST',{gift:b.json.user.uid},ca)).status===429,'gift once per day');
 const gl=await call('friends','GET',null,cb);ok(gl.json.gifts.length===1&&gl.json.gifts[0].from==='Doris','gift arrives');
 const gc=await call('friends','POST',{claim:1},cb);ok(gc.json.total===20,'claim gift');
 ok((await call('friends','GET',null,cb)).json.gifts.length===0,'gifts cleared');
 ok((await call('auth','DELETE',null,ca)).status===200,'logout');
 const er=await call('auth','POST',{email:'Doris@Mail.com',password:'abc123',mode:'register',name:'Doris E'});ok(er.status===200&&er.json.user.via==='email'&&/^[A-Z0-9]{6}$/.test(er.json.user.code),'email register');
 ok((await call('auth','POST',{email:'doris@mail.com',password:'abc123',mode:'register'})).status===409,'email duplicate blocked');
 const el=await call('auth','POST',{email:'doris@mail.com',password:'abc123',mode:'login'});ok(el.status===200&&el.json.user.uid===er.json.user.uid,'email login (case-insensitive)');
 ok((await call('auth','POST',{email:'doris@mail.com',password:'wrong12',mode:'login'})).status===401,'email wrong password');
 ok((await call('auth','POST',{email:'bad',password:'abc123',mode:'login'})).status===400,'email format checked');
 ok((await call('auth','GET',null,cookieOf(el))).json.user.name==='Doris E','email session works');
 ok((await call('auth','POST',{fbToken:'x'})).status===503,'facebook off without app id');
 ok((await call('config','GET')).json.fbAppId==='','config: fb hidden');
 console.log(fail?fail+' FAILED':'ALL PASSED');process.exit(fail?1:0)})();

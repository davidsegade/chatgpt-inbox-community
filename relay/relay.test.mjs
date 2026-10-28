import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createRelay} from './server.mjs';
import receiver from '../relay-client.cjs';
const require=createRequire(import.meta.url);
const {recoverDelivery}=require('../identity.cjs');
const digest=v=>createHash('sha256').update(v).digest('base64url');
async function fixture(t,options={}){
 // Reserve an ephemeral listener, then use its actual port as OAuth issuer.
 const net=await import('node:net');const reserve=net.createServer();await new Promise(r=>reserve.listen(options.reuseOrigin?Number(new URL(options.reuseOrigin).port):0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://127.0.0.1:${port}`,server=createRelay({origin,...options});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const post=async(path,b,token)=>fetch(origin+path,{method:'POST',headers:{Connection:'close','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(b),redirect:'manual'});
 async function pair(){return (await post('/pair',{folders:['Inbox']})).json();}
 async function authorize(pairing,{verifier='x'.repeat(43),redirect='https://chatgpt.com/connector/oauth/callback',wrongVerifier=false,scope='inbox',clientId}={}){
  const registration=clientId?{client_id:clientId}:await(await post('/register',{redirect_uris:[redirect]})).json();
  const query=new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:digest(verifier),scope,resource:origin+'/mcp',state:'test-state'});
  const page=await(await fetch(origin+'/authorize?'+query,{headers:{Connection:'close'}})).text();const nonce=page.match(/name="nonce" value="([^"]+)"/)?.[1];assert.ok(nonce,page);
  const consent=await post('/authorize',{nonce,pair_code:pairing.pair_code});if(consent.status!==302)return {consent};
  const location=new URL(consent.headers.get('location'));assert.equal(location.searchParams.get('state'),'test-state');
  const grant={grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:redirect,resource:origin+'/mcp',code:location.searchParams.get('code'),code_verifier:wrongVerifier?'y'.repeat(43):verifier};
  const response=await post('/token',grant);return {response,grant,...await response.json()};
 }
 async function client(token){const c=new Client({name:'beta-test',version:'1'});await c.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Connection:'close',Authorization:'Bearer '+token}}}));t.after(()=>c.close());return c;}
 return {origin,server,post,pair,authorize,client};
}
const unpack=r=>JSON.parse(r.content[0].text);
const note={carpeta:'Inbox',titulo:'Árbol',contenido:'# Hola 👋',clave:'request-0001'};

test('HTTP OAuth + MCP SDK + plugin compilado → nota verificada → recibo; reintento de ACK',async t=>{
 const f=await fixture(t),p=await f.pair(),session=await f.authorize(p);assert.equal(session.response.status,200);const c=await f.client(session.access_token);
 const tools=await c.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['consultar_estado','crear_nota','listar_carpetas']);
 assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['Inbox']);
 const queued=unpack(await c.callTool({name:'crear_nota',arguments:note}));assert.equal(queued.state,'queued');
 assert.equal(unpack(await c.callTool({name:'crear_nota',arguments:note})).id,queued.id);
 assert.equal((await c.callTool({name:'crear_nota',arguments:{...note,contenido:'different'}})).isError,true);
 // Run the actual bundled plugin with an in-memory Obsidian API adapter.
 const files=new Map();class TFile{constructor(path){this.path=path;}}class TFolder{}
 let failAck=true;const saved=[];const notices=[];
 const api={Modal:class{},FuzzySuggestModal:class{},PluginSettingTab:class{},Setting:class{},SecretComponent:class{},TFile,TFolder,Notice:class{constructor(v){notices.push(v);}},Plugin:class{async saveData(d){saved.push(d);}},requestUrl:async r=>{
  if(r.url.endsWith('/receipt')&&failAck){failAck=false;throw Error('network interrupted');}
  const response=await fetch(r.url,{method:r.method,headers:r.headers,body:r.body});return {status:response.status,json:await response.json(),headers:{}};
 }};
 const mod={exports:{}};vm.runInNewContext(readFileSync(new URL('../main.js',import.meta.url),'utf8'),{module:mod,exports:mod.exports,require:()=>api,AbortController,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,URL,Date,window:{setTimeout,clearTimeout},document:{hidden:false}});
 const plugin=new mod.exports.default();plugin.app={secretStorage:{getSecret:()=>p.plugin_token},vault:{configDir:'.obsidian',getAbstractFileByPath:path=>files.has(path)?new TFile(path):path.endsWith('.md')?null:new TFolder(),read:async f=>files.get(f.path),create:async(path,content)=>{assert.equal(files.has(path),false);files.set(path,content);},createFolder:async()=>{}}};
 plugin.settings={...plugin.settings,enabled:true,transport:'relay',relay:f.origin,boundRelay:f.origin,roots:['Inbox']};
 await plugin.poll(true);assert.ok(files.get('Inbox/Árbol.md').startsWith(note.contenido));assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:queued.id}})).state,'queued');
 await plugin.poll(true);assert.equal(files.size,1);assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:queued.id}})).state,'delivered');assert.ok(!JSON.stringify(saved).includes(p.plugin_token));
 assert.deepEqual((await(await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).json()).jobs,[]);
});

test('OAuth form preserves same-origin Origin without leaking the authorization URL cross-origin',async t=>{
 const f=await fixture(t),p=await f.pair();
 const redirect='https://chatgpt.com/connector/oauth/callback',verifier='b'.repeat(43);
 const registration=await(await f.post('/register',{redirect_uris:[redirect]})).json();
 const query=new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:digest(verifier),scope:'inbox',resource:f.origin+'/mcp',state:'browser-state'});
 const page=await fetch(f.origin+'/authorize?'+query);
 // no-referrer makes browser form POSTs send Origin: null (Fetch §3.2).
 // same-origin retains the actual origin on this form and suppresses Referer
 // when the browser follows the external OAuth callback.
 assert.equal(page.headers.get('referrer-policy'),'same-origin');
 assert.equal(page.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'");
 const trickyRedirect="https://other.example/callback;script-src?x='unsafe-inline'";
 const other=await(await f.post('/register',{redirect_uris:[trickyRedirect]})).json();
 const otherQuery=new URLSearchParams(query);otherQuery.set('client_id',other.client_id);otherQuery.set('redirect_uri',trickyRedirect);
 const otherPage=await fetch(f.origin+'/authorize?'+otherQuery);
 assert.equal(otherPage.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' https://other.example; frame-ancestors 'none'; base-uri 'none'",'CSP includes only the validated callback origin, never URI path/query or another client');
 const oddRedirect="https://odd.example;script-src'unsafe-inline'/callback";
 const odd=await(await f.post('/register',{redirect_uris:[oddRedirect]})).json();
 const oddQuery=new URLSearchParams(query);oddQuery.set('client_id',odd.client_id);oddQuery.set('redirect_uri',oddRedirect);
 const oddPage=await fetch(f.origin+'/authorize?'+oddQuery);
 assert.equal(oddPage.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' https://odd.example%3Bscript-src%27unsafe-inline%27; frame-ancestors 'none'; base-uri 'none'",'unusual URL hostnames cannot inject CSP separators');
 const nonce=(await page.text()).match(/name="nonce" value="([^"]+)"/)[1];
 const consent=origin=>fetch(f.origin+'/authorize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce,pair_code:p.pair_code}),redirect:'manual'});
 for(const origin of ['null','https://evil.example','https://chatgpt.com']){
  const rejected=await consent(origin);assert.equal(rejected.status,403);assert.deepEqual(await rejected.json(),{error:'Origin rejected'});
 }
 const approved=await consent(f.origin);assert.equal(approved.status,302);
 const location=new URL(approved.headers.get('location'));assert.equal(location.origin,'https://chatgpt.com');assert.equal(location.searchParams.get('state'),'browser-state');assert.equal(location.searchParams.get('iss'),f.origin);
 const grant={grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:redirect,resource:f.origin+'/mcp',code:location.searchParams.get('code'),code_verifier:verifier};
 const token=await f.post('/token',grant);assert.equal(token.status,200);
 assert.equal((await consent(f.origin)).status,400,'nonce is single-use');
 assert.equal((await f.post('/token',grant)).status,400,'code is single-use');
 const c=await f.client((await token.json()).access_token);
 assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['Inbox']);
});

test('conflicto, carpeta revocada, fallo de escritura y nota borrada jamás confirman entrega',async()=>{
 const job={version:1,id:'job-1',path:'Inbox/a.md',content:'new'};const ledger={};let acknowledged=false;
 await receiver.receiveRelay([job],['Inbox'],'.obsidian',ledger,{read:async()=> 'local',create:async()=>assert.fail()},async()=>{},async(_,state)=>{assert.equal(state,'conflict');acknowledged=true;});assert.equal(acknowledged,true);assert.deepEqual(ledger,{});
 await assert.rejects(receiver.receiveRelay([job],['Other'],'.obsidian',{}, {},async()=>{},async()=>assert.fail()));
 await assert.rejects(receiver.receiveRelay([job],['Inbox'],'.obsidian',{}, {read:async()=>null,create:async()=>{throw Error('disk full');}},async()=>{},async()=>assert.fail()),/disk full/);
 let content=null;const l={};const vault={read:async()=>content,create:async(_,v)=>content=v};await receiver.receiveRelay([job],['Inbox'],'.obsidian',l,vault,async()=>{},async()=>{});content=null;await assert.rejects(receiver.receiveRelay([job],['Inbox'],'.obsidian',l,vault,async()=>{},async()=>assert.fail()),/verificar/);
});

test('aislamiento entre usuarios, roles, revocación y rechazo de rutas',async t=>{
 const f=await fixture(t),p=await f.pair(),other=await f.pair(),s=await f.authorize(p),s2=await f.authorize(other),c=await f.client(s.access_token),c2=await f.client(s2.access_token);
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},s.access_token)).status,401);
 assert.equal((await f.post('/mcp',{},p.plugin_token)).status,401);
 const j=unpack(await c.callTool({name:'crear_nota',arguments:note}));assert.equal((await c2.callTool({name:'consultar_estado',arguments:{id:j.id}})).isError,true);
 for(const patch of[{titulo:'../bad'},{carpeta:'Other'},{titulo:'.obsidian'},{titulo:'CON'}])assert.equal((await c.callTool({name:'crear_nota',arguments:{...note,...patch,clave:'invalid-0001'}})).isError,true);
 assert.equal((await f.post('/plugin/revoke',{},p.plugin_token)).status,200);assert.equal((await f.post('/mcp',{},s.access_token)).status,401);
});

test('OAuth: código un solo uso, PKCE, redirect exacto, CSRF, token y pairing caducados',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time});const p=await f.pair();const bad=await f.authorize(p,{wrongVerifier:true});assert.equal(bad.response.status,400);
 assert.equal((await f.authorize(p)).consent.status,400);
 const fresh=await f.pair(),s=await f.authorize(fresh);assert.equal((await f.post('/token',s.grant)).status,400);
 assert.equal((await f.post('/authorize',{nonce:'fake',pair_code:fresh.pair_code})).status,400);
 const expired=await f.pair();time+=300001;assert.equal((await f.authorize(expired)).consent.status,400);
 time+=3600001;assert.equal((await f.post('/mcp',{},s.access_token)).status,401);
 assert.equal((await f.post('/register',{redirect_uris:['https://good.example/callback#bad']})).status,400);
 assert.equal((await fetch(f.origin+'/authorize?'+new URLSearchParams({client_id:s.grant.client_id,redirect_uri:'https://evil.example'}))).status,400);
});

test('cola caduca sin plugin, recibos no inventados, límites y reinicio',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time,ttl:1000,maxJobs:1}),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 const j=unpack(await c.callTool({name:'crear_nota',arguments:note}));assert.equal((await c.callTool({name:'crear_nota',arguments:{...note,clave:'request-0002'}})).isError,true);
 assert.equal((await f.post('/plugin/receipt',{id:'invented',state:'delivered'},p.plugin_token)).status,400);
 time+=1001;assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'expired');assert.equal((await f.post('/plugin/receipt',{id:j.id,state:'delivered'},p.plugin_token)).status,409);
 const restarted=await fixture(t);assert.equal((await restarted.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,401);
});

test('Lite escapa Unicode, rechaza traversal, títulos con rutas y enlaces largos',()=>{
 const uri=receiver.liteURI('Mi bóveda','Inbox','Árbol','# Hola & más');const parsed=new URL(uri);assert.equal(parsed.searchParams.get('content'),'# Hola & más');assert.equal(parsed.searchParams.get('file'),'Inbox/Árbol');assert.ok(!parsed.searchParams.has('overwrite'));
 for(const title of['../escape','folder/note','CON'])assert.throws(()=>receiver.liteURI('Vault','Inbox',title,'a'));
 assert.throws(()=>receiver.liteURI('Vault','Inbox','note','a'.repeat(9000)),/largo/);
 assert.throws(()=>receiver.liteURI('Vault','.config-personalizada','nota','contenido','.config-personalizada'));
 assert.ok(receiver.liteURI('Vault','Inbox','nota','contenido','.config-personalizada').startsWith('obsidian://'));
 for(const url of['http://public.example','https://user:pass@host','https://host/path'])assert.throws(()=>receiver.relayOrigin(url));
});


test('Host/Origin, descubrimiento, cuota global y retirada de permisos',async t=>{
 const f=await fixture(t,{maxQueuedBytes:30});
 const challenge=await f.post('/mcp',{});assert.equal(challenge.status,401);assert.match(challenge.headers.get('www-authenticate'),/resource_metadata/);
 const http=await import('node:http');const badHost=await new Promise((resolve,reject)=>{http.get(f.origin+'/health',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(badHost,403);
 assert.equal((await fetch(f.origin+'/health',{headers:{Origin:'https://evil.example'}})).status,403);
 const externalOrigin='https://chatgpt.com';
 const reg=await fetch(f.origin+'/register',{method:'POST',headers:{Origin:externalOrigin,'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://chatgpt.com/connector/oauth/callback']})});
 assert.equal(reg.status,201,'OAuth dynamic registration accepts external client origin');
 const token=await fetch(f.origin+'/token',{method:'POST',headers:{Origin:externalOrigin,'Content-Type':'application/json'},body:JSON.stringify({})});
 assert.equal(token.status,400,'OAuth token endpoint reaches grant validation, not Origin rejection');
 for(const path of ['/pair','/authorize','/plugin/poll','/mcp']){const res=await fetch(f.origin+path,{method:'POST',headers:{Origin:externalOrigin,'Content-Type':'application/json'},body:'{}'});assert.equal(res.status,403,path+' still rejects foreign origins');}
 const p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 assert.equal((await c.callTool({name:'crear_nota',arguments:{...note,contenido:'x'.repeat(31)}})).isError,true);
 const j=unpack(await c.callTool({name:'crear_nota',arguments:note}));
 assert.deepEqual((await(await f.post('/plugin/poll',{folders:['Other']},p.plugin_token)).json()).jobs,[]);
 assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'blocked');
 assert.equal((await f.post('/plugin/receipt',{id:j.id,state:'delivered'},p.plugin_token)).status,409);
 const resumed=await(await f.post('/plugin/poll',{folders:['*'],defaultFolder:'Cartera'},p.plugin_token)).json();
 assert.equal(resumed.jobs.length,1);assert.equal(resumed.jobs[0].id,j.id);
 const implicit=unpack(await c.callTool({name:'crear_nota',arguments:{titulo:'Default',contenido:'x',clave:'default-scope-123'}}));
 assert.equal(implicit.path,'Cartera/Default.md');
 const nested=unpack(await c.callTool({name:'crear_nota',arguments:{carpeta:'Cartera/Sub',titulo:'Nested',contenido:'x',clave:'nested-scope-123'}}));
 assert.equal(nested.path,'Cartera/Sub/Nested.md');
 const listed=unpack(await c.callTool({name:'listar_carpetas',arguments:{}}));assert.equal(listed.ambito,'boveda_actual');assert.equal(listed.destino_por_defecto,'Cartera');
});

test('durable store preserves OAuth tokens and job receipts across relay restarts',async t=>{
 const store={state:null,async load(){return this.state?structuredClone(this.state):null},async save(s){this.state=structuredClone(s)}};
 const f=await fixture(t,{storage:store}),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 const j=unpack(await c.callTool({name:'crear_nota',arguments:note}));assert.equal(j.state,'queued');
 await f.server.shutdown();const restarted=await fixture(t,{storage:store,reuseOrigin:f.origin});
 const polling=await restarted.post('/plugin/poll',{folders:['Inbox']},p.plugin_token);
 assert.equal(polling.status,200);assert.equal((await polling.json()).jobs[0].id,j.id);
 const c2=await restarted.client(s.access_token);
 assert.equal(unpack(await c2.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'queued');
 assert.equal((await restarted.post('/plugin/receipt',{id:j.id,state:'delivered'},p.plugin_token)).status,200);
 await restarted.server.shutdown();const final=await fixture(t,{storage:store,reuseOrigin:f.origin}),c3=await final.client(s.access_token);
 assert.equal(unpack(await c3.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'delivered');
 assert.equal((await final.post('/plugin/revoke',{},p.plugin_token)).status,200);
 await final.server.shutdown();const last=await fixture(t,{storage:store,reuseOrigin:f.origin});
 assert.equal((await last.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,401);
 assert.equal((await last.post('/mcp',{},s.access_token)).status,401);
});

test('durable storage failure does not return unpersisted pairing credentials',async t=>{
 const f=await fixture(t,{storage:{async load(){return null},async save(){throw Error('database unavailable')}}});
 const res=await f.post('/pair',{folders:['Inbox']});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'Durable storage unavailable'});
});

test('una ruta fuera de las carpetas permitidas no se lee en la bóveda (relay)',async()=>{
 const job={version:1,id:'relay-scope',path:'Privado/Secreto.md',content:'secreto'};
 const ledger=Object.create(null);let read=false;
 await assert.rejects(receiver.receiveRelay([job],['Inbox'],'.obsidian',ledger,
  {read:async()=>{read=true;return null;},create:async()=>assert.fail()},
  async()=>{},async()=>assert.fail(),
  j=>recoverDelivery(j,ledger,async()=>{read=true;return null;},['Inbox'],'.obsidian')),
  /Ruta fuera de la lista permitida/);
 assert.equal(read,false);assert.deepEqual(Object.keys(ledger),[]);
});

test('el ámbito de la bóveda manda aunque el relay amplíe el suyo',async t=>{
 const f=await fixture(t),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 // The plugin channel may widen the relay scope, but the plugin keeps its own
 // folder authorization: an unauthorized note is never opened.
 await f.post('/plugin/poll',{folders:['*']},p.plugin_token);
 assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['*']);
 const job={version:1,id:'scope-widen',path:'Privado/Secreto.md',content:'secreto'};
 const ledger=Object.create(null);let read=false;
 await assert.rejects(receiver.receiveRelay([job],['Inbox'],'.obsidian',ledger,
  {read:async()=>{read=true;return null;},create:async()=>assert.fail()},
  async()=>{},async()=>assert.fail(),
  j=>recoverDelivery(j,ledger,async()=>{read=true;return null;},['Inbox'],'.obsidian')),
  /Ruta fuera de la lista permitida/);
 assert.equal(read,false);
});

test('el emparejamiento anónimo no agota la tabla de dispositivos',async t=>{
 const f=await fixture(t,{maxDevices:3,maxUnpaired:2});
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,201);
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,201);
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,429);
});

test('un dispositivo sin autorizar caduca pronto y libera su sitio',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time,maxDevices:2,maxUnpaired:5,unpairedTtl:60000});
 const p=await f.pair();
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,200);
 time+=60001;
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,401);
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,201);
});

test('el dispositivo autorizado caduca y su token deja de servir',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time}),p=await f.pair(),s=await f.authorize(p);
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,200);
 time+=7*86400000+1;
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,401);
 assert.equal((await f.post('/mcp',{},s.access_token)).status,401);
});

test('un fallo de carga del almacén responde 503 sin tumbar el relay',async t=>{
 const f=await fixture(t,{storage:{async load(){throw Error('db unreachable')},async save(){}}});
 const res=await f.post('/pair',{folders:['Inbox']});
 assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'Durable storage unavailable'});
 assert.equal((await fetch(f.origin+'/health')).status,503);
});

test('un fallo de escritura no inutiliza el relay para siempre',async t=>{
 let time=Date.now(),fail=true;
 const store={state:null,async load(){return this.state?structuredClone(this.state):null},async save(s){if(fail)throw Error('database unavailable');this.state=structuredClone(s);}};
 const f=await fixture(t,{storage:store,now:()=>time});
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,503);
 fail=false;time+=6000;
 const ok=await f.post('/pair',{folders:['Inbox']});
 assert.equal(ok.status,201);assert.ok((await ok.json()).plugin_token);
});

test('la depuración persiste y borra el contenido caducado del almacén',async t=>{
 let time=Date.now();
 const store={state:null,async load(){return this.state?structuredClone(this.state):null},async save(s){this.state=structuredClone(s);}};
 const f=await fixture(t,{storage:store,now:()=>time,ttl:1000});
 const p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 await c.callTool({name:'crear_nota',arguments:note});
 assert.ok(JSON.stringify(store.state).includes('Hola'));
 time+=1001;
 assert.equal((await fetch(f.origin+'/health')).status,200);
 assert.ok(!JSON.stringify(store.state).includes('Hola'),'el contenido caducado no permanece en el almacén');
});

test('las rutas anónimas tienen su propio límite de peticiones',async t=>{
 const f=await fixture(t);let last;
 for(let i=0;i<25;i++)last=await f.post('/pair',{folders:['Inbox']});
 assert.equal(last.status,429);
 assert.equal((await fetch(f.origin+'/health')).status,200);
 assert.equal((await fetch(f.origin+'/.well-known/oauth-authorization-server')).status,200);
});

test('el esquema de autorización acepta minúsculas',async t=>{
 const f=await fixture(t),p=await f.pair();
 const res=await fetch(f.origin+'/plugin/poll',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'bearer '+p.plugin_token},body:JSON.stringify({folders:['Inbox']})});
 assert.equal(res.status,200);
});

test('el canje de código rechaza cliente, redirección, recurso y verificador incorrectos',async t=>{
 const f=await fixture(t),redirect='https://chatgpt.com/connector/oauth/callback',verifier='x'.repeat(43);
 for(const patch of[{client_id:'otro'},{redirect_uri:'https://evil.example/cb'},{resource:'https://otro.example/mcp'},{code_verifier:'z'.repeat(43)},{grant_type:'refresh_token'}]){
  const p=await f.pair();
  const registration=await(await f.post('/register',{redirect_uris:[redirect]})).json();
  const query=new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:digest(verifier),scope:'inbox',resource:f.origin+'/mcp',state:'st'});
  const page=await(await fetch(f.origin+'/authorize?'+query)).text();const nonce=page.match(/name="nonce" value="([^"]+)"/)[1];
  const consent=await f.post('/authorize',{nonce,pair_code:p.pair_code});
  const code=new URL(consent.headers.get('location')).searchParams.get('code');
  const grant={grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:redirect,resource:f.origin+'/mcp',code,code_verifier:verifier,...patch};
  assert.equal((await f.post('/token',grant)).status,400);
 }
});

test('la página de autorización rechaza parámetros OAuth inválidos',async t=>{
 const f=await fixture(t),p=await f.pair(),redirect='https://chatgpt.com/connector/oauth/callback';
 const registration=await(await f.post('/register',{redirect_uris:[redirect]})).json();
 const base={client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:digest('x'.repeat(43)),scope:'inbox',resource:f.origin+'/mcp',state:'st'};
 for(const patch of[{code_challenge_method:'plain'},{response_type:'token'},{scope:'otro'},{resource:'https://otro.example/mcp'},{code_challenge:'corto'},{state:'x'.repeat(2049)},{redirect_uri:'https://evil.example/cb'}]){
  const res=await fetch(f.origin+'/authorize?'+new URLSearchParams({...base,...patch}));
  assert.equal(res.status,400);
 }
});

test('una cola grande de un dispositivo no bloquea a los demás',async t=>{
 const f=await fixture(t,{maxQueuedBytes:100,maxDeviceQueuedBytes:40});
 const p1=await f.pair(),p2=await f.pair();
 const s1=await f.authorize(p1),c1=await f.client(s1.access_token);
 const s2=await f.authorize(p2),c2=await f.client(s2.access_token);
 const big=await c1.callTool({name:'crear_nota',arguments:{...note,contenido:'x'.repeat(60),clave:'nota-grande-01'}});
 assert.equal(big.isError,true);
 const small=await c2.callTool({name:'crear_nota',arguments:{...note,contenido:'ok',clave:'nota-pequena-1'}});
 assert.equal(unpack(small).state,'queued');
});

test('un recibo caducado no bloquea la cola del dispositivo',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time,ttl:1000,maxJobs:1}),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 const first=unpack(await c.callTool({name:'crear_nota',arguments:note}));
 assert.equal(first.state,'queued');
 time+=1001;
 await fetch(f.origin+'/health');
 const second=unpack(await c.callTool({name:'crear_nota',arguments:{...note,clave:'request-0009'}}));
 assert.equal(second.state,'queued');
});

test('un ledger conocido no permite leer fuera del ámbito revocado',async()=>{
 const job={version:1,id:'known-revoked',path:'Private/secret.md',content:'x'};
 const {digest}=require('../core.cjs');const ledger={[job.id]:await digest(JSON.stringify([job.path,job.content]))};
 await assert.rejects(receiver.receiveRelay([job],['Inbox'],'.obsidian',ledger,
  {read:async()=>assert.fail('unauthorized read'),create:async()=>assert.fail()},async()=>assert.fail(),async()=>assert.fail(),
  j=>recoverDelivery(j,ledger,async()=>assert.fail(),['Inbox'],'.obsidian')),/permitida/);
});

test('fallos durables revierten notas, recibos y revocación sin contaminar el siguiente snapshot',async t=>{
 let time=Date.now(),fail=false;
 const store={state:null,async load(){return structuredClone(this.state)},async save(s){if(fail)throw Error('offline');this.state=structuredClone(s);}};
 const f=await fixture(t,{storage:store,now:()=>time}),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 fail=true;
 assert.equal((await c.callTool({name:'crear_nota',arguments:note})).isError,true);
 assert.equal(JSON.stringify(store.state).includes(note.contenido),false);
 fail=false;time+=6000;
 const j=unpack(await c.callTool({name:'crear_nota',arguments:note}));assert.equal(j.state,'queued');
 fail=true;
 assert.equal((await f.post('/plugin/receipt',{id:j.id,state:'delivered'},p.plugin_token)).status,503);
 assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'queued');
 assert.equal((await fetch(f.origin+'/health')).status,503);
 fail=false;time+=6000;
 const polled=await(await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).json();
 assert.equal(polled.jobs[0].content,note.contenido);
 assert.equal((await f.post('/plugin/receipt',{id:j.id,state:'delivered'},p.plugin_token)).status,200);
 fail=true;
 assert.equal((await f.post('/plugin/revoke',{},p.plugin_token)).status,503);
 fail=false;time+=6000;
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,200);
 assert.equal((await f.post('/plugin/revoke',{},p.plugin_token)).status,200);
 assert.equal((await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).status,401);
});

test('solo Bearer autentica; X-Forwarded-For no evade el límite por defecto',async t=>{
 const f=await fixture(t,{maxUnpaired:100,maxDevices:100}),p=await f.pair();
 const raw=await fetch(f.origin+'/plugin/poll',{method:'POST',headers:{Authorization:p.plugin_token,'Content-Type':'application/json'},body:'{"folders":["Inbox"]}'});
 assert.equal(raw.status,401);
 let last;
 for(let i=0;i<20;i++)last=await fetch(f.origin+'/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${i}`},body:'{"folders":["Inbox"]}'});
 assert.equal(last.status,429);
});


test('retirar la última carpeta bloquea la cola y restaurarla reanuda sin ampliar permisos',async t=>{
 const f=await fixture(t),p=await f.pair(),s=await f.authorize(p),c=await f.client(s.access_token);
 const job=unpack(await c.callTool({name:'crear_nota',arguments:note}));
 const revoked=await f.post('/plugin/poll',{folders:[]},p.plugin_token);assert.equal(revoked.status,200);assert.deepEqual((await revoked.json()).jobs,[]);
 assert.equal(unpack(await c.callTool({name:'consultar_estado',arguments:{id:job.id}})).state,'blocked');
 assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,[]);
 assert.equal((await c.callTool({name:'crear_nota',arguments:{...note,clave:'scope-removed-0001'}})).isError,true);
 const restored=await(await f.post('/plugin/poll',{folders:['Inbox']},p.plugin_token)).json();assert.equal(restored.jobs.length,1);assert.equal(restored.jobs[0].id,job.id);assert.equal(restored.jobs[0].content,note.contenido);
 assert.equal((await f.post('/pair',{folders:[]})).status,400);
});

test('refresh rotates after access expiry, binds client/resource/scope and preserves DCR across days',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time}),p=await f.pair(),s=await f.authorize(p,{scope:'offline_access inbox'});
 assert.ok(s.refresh_token);assert.equal(s.scope,'inbox offline_access');
 const meta=await(await fetch(f.origin+'/.well-known/oauth-authorization-server')).json();
 assert.ok(meta.grant_types_supported.includes('refresh_token'));assert.ok(meta.scopes_supported.includes('offline_access'));
 const grant={grant_type:'refresh_token',client_id:s.grant.client_id,resource:f.origin+'/mcp',refresh_token:s.refresh_token};
 for(const patch of [{client_id:'another-client'},{resource:'https://evil.example/mcp'},{scope:'inbox administrator'}]){
  const r=await f.post('/token',{...grant,...patch});assert.equal(r.status,400);
 }
 time+=2*86400000;
 assert.equal((await f.post('/mcp',{},s.access_token)).status,401);
 const refreshed=await f.post('/token',grant);assert.equal(refreshed.status,200);const next=await refreshed.json();
 assert.notEqual(next.access_token,s.access_token);assert.notEqual(next.refresh_token,s.refresh_token);
 assert.equal(next.scope,'inbox offline_access');
 const c=await f.client(next.access_token);assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['Inbox']);
 const narrowed=await f.post('/token',{...grant,refresh_token:next.refresh_token,scope:'inbox'});assert.equal(narrowed.status,200);const narrow=await narrowed.json();assert.equal(narrow.scope,'inbox');
 const broaden=await f.post('/token',{...grant,refresh_token:narrow.refresh_token,scope:'inbox offline_access'});assert.equal(broaden.status,400);assert.equal((await broaden.json()).error,'invalid_scope');
 assert.equal((await f.post('/token',{...grant,refresh_token:narrow.refresh_token})).status,200,'invalid scope does not consume refresh');
});

test('refresh replay revokes its entire grant durably and leaves another device connected',async t=>{
 const store={state:null,async load(){return this.state},async save(s){this.state=structuredClone(s)}};
 const f=await fixture(t,{storage:store}),p=await f.pair(),s=await f.authorize(p),other=await f.pair(),s2=await f.authorize(other);
 const grant={grant_type:'refresh_token',client_id:s.grant.client_id,resource:f.origin+'/mcp',refresh_token:s.refresh_token};
 const rotated=await(await f.post('/token',grant)).json();
 assert.equal((await f.post('/token',grant)).status,400);
 assert.equal((await f.post('/mcp',{},rotated.access_token)).status,401);
 assert.equal((await f.post('/token',{...grant,refresh_token:rotated.refresh_token})).status,400);
 await f.server.shutdown();const restarted=await fixture(t,{storage:store,reuseOrigin:f.origin});
 assert.equal((await restarted.post('/mcp',{},rotated.access_token)).status,401);
 assert.equal((await restarted.post('/token',{...grant,resource:restarted.origin+'/mcp',refresh_token:rotated.refresh_token})).status,400);
 const c=await restarted.client(s2.access_token);assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['Inbox']);
 const dump=JSON.stringify(store.state);for(const raw of [s.access_token,s.refresh_token,rotated.refresh_token,p.plugin_token])assert.ok(!dump.includes(raw),'only credential hashes are persisted');
});

test('refresh survives storage restore, failed rotation rolls back, revoke invalidates it',async t=>{
 let time=Date.now(),broken=false;
 const store={state:null,async load(){return this.state},async save(s){if(broken)throw Error('write unavailable');this.state=structuredClone(s)}};
 const f=await fixture(t,{storage:store,now:()=>time}),p=await f.pair(),s=await f.authorize(p);
 const grant={grant_type:'refresh_token',client_id:s.grant.client_id,resource:f.origin+'/mcp',refresh_token:s.refresh_token};
 broken=true;assert.equal((await f.post('/token',grant)).status,503);
 broken=false;time+=5001;
 await f.server.shutdown();const restored=await fixture(t,{storage:store,now:()=>time,reuseOrigin:f.origin});
 const response=await restored.post('/token',grant);assert.equal(response.status,200);const refreshed=await response.json();
 assert.equal((await restored.post('/plugin/revoke',{},p.plugin_token)).status,200);
 assert.equal((await restored.post('/token',{...grant,refresh_token:refreshed.refresh_token})).status,400);
 assert.equal((await restored.post('/mcp',{},refreshed.access_token)).status,401);
});

test('refresh has absolute 30-day lifetime and seven-day inactivity expiry',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time}),p=await f.pair(),s=await f.authorize(p);
 const grant={grant_type:'refresh_token',client_id:s.grant.client_id,refresh_token:s.refresh_token};
 for(let day=0;day<6;day++){
  time+=5*86400000;const r=await f.post('/token',grant);
  if(day<5){assert.equal(r.status,200);grant.refresh_token=(await r.json()).refresh_token;}
  else assert.equal(r.status,400,'rotation cannot extend the absolute lifetime');
 }
 let idle=Date.now();const inactive=await fixture(t,{now:()=>idle}),p2=await inactive.pair(),s2=await inactive.authorize(p2);
 idle+=7*86400000+1;
 assert.equal((await inactive.post('/token',{grant_type:'refresh_token',client_id:s2.grant.client_id,refresh_token:s2.refresh_token})).status,400);
});

test('startup lease contention recovers automatically; no request waits behind startup',async t=>{
 let available=false,attempts=0,closed=false;
 const store={healthy:false,async load(){attempts++;if(!available)throw Object.assign(Error('Another relay owns this database'),{code:'RELAY_LEASE_BUSY'});this.healthy=true;return null;},async save(){},async close(){closed=true;}};
 const f=await fixture(t,{storage:store,startupLeaseWaitMs:5000,startupLeaseRetryMs:5});
 assert.equal((await fetch(f.origin+'/health')).status,503);
 assert.equal((await f.post('/pair',{folders:['Inbox']})).status,503);
 available=true;assert.equal(await f.server.startup,true);assert.ok(attempts>=2);
 assert.equal((await fetch(f.origin+'/health')).status,200);assert.equal((await f.post('/pair',{folders:['Inbox']})).status,201);
 // A later leased-session loss must not retry and resurrect a stale writer.
 store.healthy=false;const loaded=attempts;assert.equal((await fetch(f.origin+'/health')).status,503);assert.equal(attempts,loaded);assert.equal(closed,false);
});

test('startup only retries lease contention, times out and cancels cleanly on shutdown',async t=>{
 let attempts=0;
 const failed=await fixture(t,{startupLeaseWaitMs:100,storage:{async load(){attempts++;throw Error('database permission denied')},async save(){}}});
 assert.equal(await failed.server.startup,false);assert.equal(attempts,1);assert.equal((await fetch(failed.origin+'/health')).status,503);
 let loads=0;
 const busy=()=>({async load(){loads++;throw Object.assign(Error('busy'),{code:'RELAY_LEASE_BUSY'})},async save(){}});
 const timed=await fixture(t,{storage:busy(),startupLeaseWaitMs:15,startupLeaseRetryMs:5});
 assert.equal(await timed.server.startup,false);assert.ok(loads>1);assert.equal((await fetch(timed.origin+'/health')).status,503);
 // Use a separate listener: fixture cleanup may close an already closed server.
 const waiting=await fixture(t,{storage:busy(),startupLeaseWaitMs:120000,startupLeaseRetryMs:60000});
 await waiting.server.shutdown();assert.equal(await waiting.server.startup,false);
});

test('refresh and new access tokens cannot cross issuer origins after restoring a database',async t=>{
 const store={state:null,async load(){return structuredClone(this.state)},async save(s){this.state=structuredClone(s)}};
 const f=await fixture(t,{storage:store}),p=await f.pair(),s=await f.authorize(p);
 const otherIssuer=await fixture(t,{storage:store});
 assert.equal((await otherIssuer.post('/mcp',{},s.access_token)).status,401);
 for(const resource of [f.origin+'/mcp',otherIssuer.origin+'/mcp']){
  assert.equal((await otherIssuer.post('/token',{grant_type:'refresh_token',client_id:s.grant.client_id,resource,refresh_token:s.refresh_token})).status,400);
 }
});

test('legacy version-1 snapshots keep existing access tokens until expiry and require consent for refresh',async t=>{
 let time=Date.now();const store={state:null,async load(){return structuredClone(this.state)},async save(s){this.state=structuredClone(s)}};
 const f=await fixture(t,{storage:store,now:()=>time}),p=await f.pair(),s=await f.authorize(p);
 await f.server.shutdown();
 for(const[,d]of store.state.devices)for(const[,grant]of d.accessTokens)for(const key of Object.keys(grant))if(!['hash','expires'].includes(key))delete grant[key];
 const restored=await fixture(t,{storage:store,now:()=>time,reuseOrigin:f.origin}),c=await restored.client(s.access_token);
 assert.deepEqual(unpack(await c.callTool({name:'listar_carpetas',arguments:{}})).carpetas,['Inbox']);
 assert.equal((await restored.post('/token',{grant_type:'refresh_token',client_id:s.grant.client_id,refresh_token:s.refresh_token})).status,400);
 time+=3600001;assert.equal((await restored.post('/mcp',{},s.access_token)).status,401);
});

test('graceful shutdown finishes an in-flight durable write before releasing storage',async t=>{
 let unlock,started,closed=false;const writing=new Promise(r=>started=r);
 const store={async load(){return null},async save(){started();await new Promise(r=>unlock=r);},async close(){closed=true;}};
 const f=await fixture(t,{storage:store});
 const pending=f.post('/pair',{folders:['Inbox']});await writing;
 const shutdown=f.server.shutdown();assert.equal(f.server.shutdown(),shutdown,'repeated shutdown uses the same drain');assert.equal(closed,false);
 unlock();const response=await pending;assert.equal(response.status,201);await response.json();await shutdown;
 assert.equal(closed,true);
});


test('registered DCR client remains valid when first linking or reconnecting after token expiry',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time});
 const redirect='https://chatgpt.com/connector/oauth/callback';
 const registered=await(await f.post('/register',{redirect_uris:[redirect]})).json();
 time+=2*86400000;
 const first=await f.authorize(await f.pair(),{clientId:registered.client_id});assert.equal(first.response.status,200);
 time+=31*86400000;
 const reconnect=await f.authorize(await f.pair(),{clientId:registered.client_id});assert.equal(reconnect.response.status,200);
});

function compiledReceiver(f,pair,{saved,alterResponse,interceptRequest}={}){
 const files=new Map(),snapshots=[],requests=[];const document={hidden:false};
 class TFile{constructor(path){this.path=path;this.extension='md';}}class TFolder{constructor(path){this.path=path;}}
 const api={apiVersion:'1.14.5',Modal:class{},FuzzySuggestModal:class{},PluginSettingTab:class{},Setting:class{},SecretComponent:class{},TFile,TFolder,Notice:class{},Plugin:class{
  async loadData(){return saved??{};}async saveData(data){snapshots.push(JSON.parse(JSON.stringify(data)));}
  registerEvent(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}registerInterval(){}registerDomEvent(){}
 },requestUrl:async request=>{
  requests.push(request);const intercepted=interceptRequest?.(request);if(intercepted)return intercepted;const response=await fetch(request.url,{method:request.method,headers:request.headers,body:request.body});
  const result={status:response.status,json:await response.json(),headers:{}};
  return alterResponse?alterResponse(request,result):result;
 }};
 const mod={exports:{}};vm.runInNewContext(readFileSync(new URL('../main.js',import.meta.url),'utf8'),{module:mod,exports:mod.exports,require:()=>api,AbortController,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,URL,Date,document,window:{setTimeout,clearTimeout,setInterval:()=>1}});
 const plugin=new mod.exports.default();plugin.manifest={version:'0.4.4'};plugin.app={secretStorage:{getSecret:()=>pair.plugin_token},workspace:{onLayoutReady:()=>{}},vault:{configDir:'.obsidian',getName:()=> 'Disposable',on:()=>({}),getAbstractFileByPath:path=>files.has(path)?new TFile(path):path.endsWith('.md')?null:new TFolder(path),read:async file=>files.get(file.path),create:async(path,content)=>{assert.equal(files.has(path),false);files.set(path,content);},createFolder:async()=>{}}};
 plugin.settings={...plugin.settings,enabled:true,transport:'relay',relay:f.origin,boundRelay:f.origin,roots:['Inbox'],defaultFolder:'Inbox'};
 return {plugin,files,snapshots,requests,document};
}
test('nota de prueba autenticada: ámbito, idempotencia, separación de dispositivos y capacidad',async t=>{
 const f=await fixture(t,{maxJobs:1}),pair=await f.pair(),session=await f.authorize(pair),other=await f.pair();
 const key='connection-test-contract-12345678',path=`Inbox/Prueba de conexión-${key}.md`;
 assert.equal((await f.post('/plugin/test',{key,path})).status,401);
 assert.equal((await f.post('/plugin/test',{key,path},session.access_token)).status,401);
 assert.equal((await f.post('/plugin/test',{key,path:'Private/Prueba de conexión-'+key+'.md'},pair.plugin_token)).status,400);
 const created=await f.post('/plugin/test',{key,path},pair.plugin_token);assert.equal(created.status,200);const job=await created.json();assert.equal(job.state,'queued');assert.equal(job.path,path);assert.equal(job.content,undefined);
 assert.equal((await(await f.post('/plugin/test',{key,path},pair.plugin_token)).json()).id,job.id);
 assert.equal((await f.post('/plugin/test',{key,path:'Inbox/Sub/Prueba de conexión-'+key+'.md'},pair.plugin_token)).status,409);
 const anotherKey='connection-test-contract-87654321';assert.equal((await f.post('/plugin/test',{key:anotherKey,path:`Inbox/Prueba de conexión-${anotherKey}.md`},pair.plugin_token)).status,429);
 const otherJob=await(await f.post('/plugin/test',{key,path},other.plugin_token)).json();assert.notEqual(otherJob.id,job.id);
 const blocked=await(await f.post('/plugin/poll',{folders:[]},pair.plugin_token)).json();assert.equal(blocked.counts.blocked,1);assert.deepEqual(blocked.jobs,[]);
});
test('prueba completa con plugin compilado distingue fallo de recibo, recupera la misma nota y verifica recibo real',async t=>{
 const f=await fixture(t),pair=await f.pair();await f.authorize(pair);let failAck=true;
 const h=compiledReceiver(f,pair,{alterResponse:(request,result)=>{
  if(request.url.endsWith('/receipt')&&failAck){failAck=false;throw Error('simulated response loss after server commit');}return result;
 }});
 assert.equal(await h.plugin.testDelivery(),'delivered','the receipt query recovers an ACK response lost after commit');
 assert.equal(h.files.size,1);assert.equal(h.plugin.deliveryTest.state,'delivered');
 const raw=JSON.stringify(h.snapshots);assert.ok(!raw.includes(pair.plugin_token));assert.ok(h.snapshots.some(snapshot=>snapshot.history.some(entry=>entry.state==='Guardada sin recibo'&&entry.receiptPending)));
 const key=h.plugin.deliveryTest.key;const response=await f.post('/plugin/test',{key,path:h.plugin.deliveryTest.path},pair.plugin_token);assert.equal((await response.json()).state,'delivered');
 assert.ok(h.requests.filter(request=>request.url.endsWith('/plugin/test')).length>=2);
});
test('un recibo que todavía no llegó mantiene la misma clave al reintentar y no duplica la nota',async t=>{
 const f=await fixture(t),pair=await f.pair();await f.authorize(pair);let dropAck=true;
 const h=compiledReceiver(f,pair);const realRequest=h.plugin.relayRequest.bind(h.plugin);
 h.plugin.relayRequest=async(path,body,...rest)=>{if(path==='/plugin/receipt'&&dropAck){dropAck=false;throw Error('offline before request');}return realRequest(path,body,...rest);};
 assert.equal(await h.plugin.testDelivery(),'queued');const firstKey=h.plugin.deliveryTest.key;assert.equal(h.plugin.history[0].state,'Guardada sin recibo');assert.equal(h.files.size,1);
 assert.equal(await h.plugin.testDelivery(),'delivered');assert.equal(h.plugin.deliveryTest.key,firstKey);assert.equal(h.files.size,1);assert.equal(h.plugin.history[0].state,'Importada');assert.equal(h.plugin.history[0].receiptPending,false);
});
test('comprobar conexión detecta autorización pendiente y una prueba no afirma entrega sin archivo local',async t=>{
 const f=await fixture(t),pair=await f.pair();const h=compiledReceiver(f,pair);
 await assert.rejects(h.plugin.checkConnection(),error=>error.code==='pairing-pending');assert.equal(h.files.size,0);
 await f.authorize(pair);assert.equal(await h.plugin.testDelivery(),'delivered');const old={...h.plugin.deliveryTest};
 h.files.clear();h.plugin.deliveryTest={...old,state:'unknown'};
 await assert.rejects(h.plugin.testDelivery(),error=>error.code==='configuration');assert.notEqual(h.plugin.deliveryTest.state,'delivered','UI cannot show a confirmed test before local verification');assert.equal(h.files.size,0,'a deleted confirmed note is not silently recreated');
});
test('test durable falla sin dejar una nota fantasma en el siguiente snapshot',async t=>{
 let state=null,failSave=false;const storage={healthy:true,load:async()=>state,save:async snapshot=>{if(failSave)throw Error('disk unavailable');state=structuredClone(snapshot);},close:async()=>{}};
 const f=await fixture(t,{storage});await f.server.startup;const pair=await f.pair();await f.authorize(pair);failSave=true;
 const key='connection-test-durable-12345678',path=`Inbox/Prueba de conexión-${key}.md`;
 assert.equal((await f.post('/plugin/test',{key,path},pair.plugin_token)).status,503);assert.equal(state.devices[0][1].jobs.length,0);
});

test('relay anterior informa de prueba no disponible y mantiene la recepción normal',async t=>{
 const f=await fixture(t),pair=await f.pair();const session=await f.authorize(pair);
 const h=compiledReceiver(f,pair,{interceptRequest:request=>request.url.endsWith('/plugin/test')?{status:404,json:{error:'Not found'},headers:{}}:null});
 await assert.rejects(h.plugin.testDelivery(),error=>error.code==='relay-update');assert.equal(h.files.size,0);
 const client=await f.client(session.access_token);await client.callTool({name:'crear_nota',arguments:note});await h.plugin.poll(true);
 assert.equal(h.files.size,1);assert.equal(h.plugin.history[0].state,'Importada');
});

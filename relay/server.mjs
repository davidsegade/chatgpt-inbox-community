import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {PgSnapshotStore} from './storage.mjs';
import core from '../core.cjs';
const {safePath,parseJob}=core;
const random=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const redirectOK=u=>{try{const x=new URL(u);return !x.hash&&!x.username&&!x.password&&(x.protocol==='https:'||(x.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(x.hostname)));}catch{return false;}};
// URL parsing permits CSP separators in unusual hostnames; encode them too.
const cspOrigin=u=>encodeURI(new URL(u).origin).replace(/[';,]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const TOKEN_TTL=3600000,REFRESH_TTL=30*86400000,MAX_REFRESH_ROTATIONS=1024,PAIR_CODE_TTL=300000,DEVICE_TTL=7*86400000,RATE_WINDOW=60000,SAVE_RETRY=5000;
const oauthScope=value=>{
 if(typeof value!=='string')return null;
 const scopes=[...new Set(value.trim().split(/\s+/))];
 return scopes.includes('inbox')&&scopes.every(s=>['inbox','offline_access'].includes(s))?scopes.sort().join(' '):null;
};
export function createRelay({origin,now=Date.now,ttl=86400000,maxDevices=100,maxUnpaired=10,maxJobs=100,maxQueuedBytes=16777216,maxDeviceQueuedBytes=1048576,unpairedTtl=3600000,trustProxy=false,storage=null,startupLeaseWaitMs=120000,startupLeaseRetryMs=250}={}){
  const base=new URL(origin);if(base.pathname!=='/'||base.search||base.hash||base.username||base.password||!redirectOK(origin))throw Error('HTTPS origin required (HTTP only loopback)');origin=base.origin;
  const devices=new Map(),clients=new Map(),transactions=new Map(),codes=new Map(),rates=new Map();
  const fail=(status,message)=>Object.assign(Error(message),{status});
  // Authorization transactions are ephemeral and are never persisted: an
  // unauthenticated discovery request must not rewrite the durable state.
  const snapshot=()=>{const ids=new Map([...devices].map(([id,d])=>[d,id]));
   return structuredClone({version:1,devices:[...devices].map(([id,d])=>[id,{...d,jobs:[...d.jobs],accessTokens:[...(d.accessTokens||new Map())]}]),clients:[...clients],
    codes:[...codes].map(([id,c])=>[id,{...c,device:undefined,deviceId:ids.get(c.device)}])});};
  const restore=state=>{if(!state)return;state=structuredClone(state);if(state.version!==1)throw Error('Unsupported storage version');
   devices.clear();clients.clear();codes.clear();
   for(const[id,d]of state.devices||[])devices.set(id,{...d,jobs:new Map(d.jobs),accessTokens:new Map(d.accessTokens||[])});
   for(const[id,v]of state.clients||[]){delete v.expires;clients.set(id,v);}
   for(const[id,v]of state.codes||[]){const d=devices.get(v.deviceId);if(d)codes.set(id,{...v,device:d});}};
  let loaded=!storage,loadFailed=false,saveFault=false,retryAt=0,lastSave=Promise.resolve(),committed={version:1,devices:[],clients:[],codes:[]};
  const startupAbort=new AbortController();
  // Only initial lease contention may retry. Once loaded, a lost session stays
  // terminal: reacquiring it could overwrite another process's newer snapshot.
  const ready=storage?Promise.resolve().then(async()=>{
   const deadline=Date.now()+startupLeaseWaitMs;
   while(!startupAbort.signal.aborted){
    try{const state=await storage.load();restore(state);committed=snapshot();loaded=true;return;}
    catch(e){
     if(e.code!=='RELAY_LEASE_BUSY'||Date.now()>=deadline)throw e;
     await delay(Math.max(1,Math.min(startupLeaseRetryMs,deadline-Date.now())),undefined,{signal:startupAbort.signal});
    }
   }
  }).catch(()=>{loadFailed=true;}):Promise.resolve();
  const persist=()=>{if(!storage)return Promise.resolve();
   if(saveFault&&now()<retryAt){restore(committed);transactions.clear();return Promise.reject(fail(503,'Durable storage unavailable'));}
   const state=snapshot();
   const p=lastSave.then(()=>storage.save(state)).then(()=>{committed=state;saveFault=false;}).catch(()=>{restore(committed);transactions.clear();saveFault=true;retryAt=now()+SAVE_RETRY;throw fail(503,'Durable storage unavailable');});
   lastSave=p.catch(()=>{});return p;};
  function sweep(){const t=now();let changed=false;
   for(const[k,d]of devices){
    for(const[cid,tok]of d.accessTokens||[])if(Math.max(tok.expires,Math.min(tok.refreshExpires||0,tok.refreshIdleExpires??Infinity))<=t){d.accessTokens.delete(cid);changed=true;}
    if(d.expires<t){devices.delete(k);changed=true;continue;}
    for(const j of d.jobs.values()){if(j.expires<t){if(j.state==='queued'||j.state==='blocked')j.state='expired';if(j.content!==undefined){delete j.content;changed=true;}}if(j.expires+ttl<t){d.jobs.delete(j.id);changed=true;}}
   }
   for(const[k,v]of codes)if(v.expires<t){codes.delete(k);changed=true;}
   for(const[k,v]of rates)if(v.expires<t)rates.delete(k);
   for(const[k,v]of transactions)if(v.expires<t){transactions.delete(k);}
   if(rates.size>20000){for(const[k,v]of rates)if(v.expires<t)rates.delete(k);while(rates.size>20000)rates.delete(rates.keys().next().value);}
   return changed;}
  async function sweepAndPersist(){if(!sweep())return;try{await persist();}catch{/* The next route reports the storage fault. */}}
  // Behind a reverse proxy every socket shares one address, so the first
  // forwarded address identifies the client when the deployment sets one.
  const clientKey=req=>{const fwd=req.headers['x-forwarded-for'];const addr=trustProxy&&typeof fwd==='string'&&fwd.length?fwd.split(',')[0].trim():req.socket.remoteAddress;return addr||'unknown';};
  function rate(req,limit=120,key){const k=limit+'|'+String(key??clientKey(req));let r=rates.get(k);if(!r){r={count:0,expires:now()+RATE_WINDOW};rates.set(k,r);}if(++r.count>limit)throw fail(429,'Too many requests');}
  function auth(req,role){const raw=req.headers.authorization;const token=typeof raw==='string'?(/^Bearer\s+(\S+)$/i.exec(raw)?.[1]||''):'';const h=hash(token||'');
   for(const d of devices.values()){
    if(role==='plugin'){if(equal(h,d.pluginHash))return d;continue;}
    for(const t of d.accessTokens.values())if(equal(h,t.hash)&&t.expires>now()&&(!t.resource||t.resource===origin+'/mcp'))return d;
   }
   throw fail(401,'Unauthorized');}
  function folders(v,allowEmpty=false){if(!Array.isArray(v)||(!allowEmpty&&!v.length)||v.length>50)throw fail(400,allowEmpty?'Choose 0–50 folders':'Choose 1–50 folders');return [...new Set(v.map(p=>p==='*'?'*':safePath(p,false)))];}
  const json=async(res,status,v,persistState=true)=>{if(persistState)await persist();res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(v));};
  async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>140000)throw fail(413,'Body too large');chunks.push(c);}const raw=Buffer.concat(chunks).toString('utf8');try{return req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw||'{}');}catch{throw fail(400,'Invalid body');}}
  function receipt(j){return {id:j.id,path:j.path,state:j.state,created:j.created,expires:j.expires,...(j.confirmed?{confirmed:j.confirmed}:{})};}
  function mintTokens(device,clientId,{scope,resource,refreshExpires=now()+REFRESH_TTL,usedRefreshHashes=[]}){
   if(!device.accessTokens.has(clientId)&&device.accessTokens.size>=10)throw fail(429,'Too many OAuth clients for this device');
   const token=random(),refresh=random(),expires=Math.min(now()+TOKEN_TTL,refreshExpires);
   device.accessTokens.set(clientId,{hash:hash(token),expires,refreshHash:hash(refresh),refreshExpires,refreshIdleExpires:now()+DEVICE_TTL,usedRefreshHashes,scope,resource});
   device.expires=Math.max(device.expires,Math.min(now()+DEVICE_TTL,refreshExpires));
   // DCR clients must remain valid throughout their authorized connections.
   const client=clients.get(clientId);if(client)delete client.expires;
   return {access_token:token,token_type:'Bearer',expires_in:Math.floor((expires-now())/1000),refresh_token:refresh,scope};
  }
  async function mcp(req,res,d){
   const server=new McpServer({name:'chatgpt-inbox',version:'0.4.1'},{instructions:'Primero listar_carpetas. crear_nota solo en carpetas autorizadas. queued NO significa entregada. Usa consultar_estado; solo delivered confirma escritura verificada por el plugin. Nunca prometas entrega sin ese recibo.'});
   const result=v=>({content:[{type:'text',text:JSON.stringify(v)}]});
   server.registerTool('listar_carpetas',{description:'Lista carpetas autorizadas y última conexión de Obsidian. Usa antes de crear una nota.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>result({carpetas:d.folders,ambito:d.folders.includes('*')?'boveda_actual':'carpetas',destino_por_defecto:d.defaultFolder||'ChatGPT Inbox',plugin_seen:d.seen??null}));
   server.registerTool('crear_nota',{description:'Crea una nota Markdown nueva. Devuelve queued; confirma con consultar_estado. Reutiliza clave para reintentar la misma petición.',inputSchema:{carpeta:z.string().max(800).optional(),titulo:z.string().min(1).max(120),contenido:z.string().max(60000),clave:z.string().regex(/^[a-zA-Z0-9-]{8,100}$/)},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async({carpeta,titulo,contenido,clave})=>{
    try{carpeta=carpeta??d.defaultFolder??'ChatGPT Inbox';safePath(carpeta,false);if(!d.folders.some(root=>root==='*'||carpeta===root||carpeta.startsWith(root+'/')))throw Error('Carpeta no autorizada');const title=titulo.normalize('NFC');if(title.includes('/')||title.includes('\\'))throw Error('Título inválido');const path=safePath(`${carpeta}/${title.replace(/\.md$/,'')}.md`),signature=hash(JSON.stringify([path,contenido]));
     const old=[...d.jobs.values()].find(j=>j.key===clave);if(old){if(old.signature!==signature)throw Error('Clave reutilizada con contenido distinto');return result(receipt(old));}
     // Only live jobs count against the queue so an expired receipt never locks
     // the user out of creating notes.
     const live=[...d.jobs.values()].filter(j=>j.expires>now());if(live.length>=maxJobs)throw Error('Cola llena');
     const size=Buffer.byteLength(contenido);
     const deviceBytes=live.reduce((n,j)=>n+Buffer.byteLength(j.content||''),0);
     if(deviceBytes+size>maxDeviceQueuedBytes)throw Error('Relay sin capacidad temporal');
     let queuedBytes=size;for(const device of devices.values())for(const job of device.jobs.values())queuedBytes+=Buffer.byteLength(job.content||'');
     if(queuedBytes>maxQueuedBytes)throw Error('Relay sin capacidad temporal');
     const id=randomBytes(16).toString('hex'),job=parseJob(JSON.stringify({version:1,id,path,content:contenido}),d.folders,'.obsidian');const j={...job,key:clave,signature,state:'queued',created:now(),expires:now()+ttl};d.jobs.set(id,j);await persist();return result(receipt(j));
    }catch(e){return {...result({error:e.message}),isError:true};}
   });
   server.registerTool('consultar_estado',{description:'Consulta recibo. Solo delivered indica que Obsidian confirmó la nota; queued, conflict y expired no son entrega.',inputSchema:{id:z.string().min(1).max(100)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const j=d.jobs.get(id);return j?result(receipt(j)):{...result({error:'Desconocida o recibo caducado'}),isError:true};});
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});res.on('close',()=>{void transport.close();void server.close();});await server.connect(transport);await transport.handleRequest(req,res,await body(req));
  }
  const handler=async(req,res)=>{try{
   if(!loaded||loadFailed||storage?.healthy===false)throw fail(503,'Durable storage unavailable');await sweepAndPersist();if(req.headers.host!==base.host)throw fail(403,'Host rejected');const u=new URL(req.url,origin),path=u.pathname;if(req.headers.origin&&req.headers.origin!==origin&&!((path==='/register'||path==='/token')&&req.method==='POST'))throw fail(403,'Origin rejected');
   if(path==='/health'&&req.method==='GET'){const degraded=saveFault||storage?.healthy===false;return await json(res,degraded?503:200,{ok:!degraded,storage:storage?(degraded?'degraded':'postgres'):'ephemeral',version:'0.4.1'},false);}
   if(path==='/.well-known/oauth-protected-resource'||path==='/.well-known/oauth-protected-resource/mcp')return await json(res,200,{resource:origin+'/mcp',authorization_servers:[origin],scopes_supported:['inbox']},false);
   if(path==='/.well-known/oauth-authorization-server')return await json(res,200,{issuer:origin,authorization_response_iss_parameter_supported:true,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['inbox','offline_access']},false);
   if(path==='/register'&&req.method==='POST'){rate(req,30);if(clients.size>=1000)throw fail(429,'Registration full');const b=await body(req);if(!Array.isArray(b.redirect_uris)||!b.redirect_uris.length||b.redirect_uris.length>5||!b.redirect_uris.every(redirectOK))throw fail(400,'Invalid redirect');const id=random();clients.set(id,{redirects:b.redirect_uris});return await json(res,201,{client_id:id,redirect_uris:b.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});}
   if(path==='/pair'&&req.method==='POST'){rate(req,20);
    // Pairing is unauthenticated, so an unpaired device must not occupy the
    // table for days: it is short lived and separately capped.
    const unpaired=[...devices.values()].filter(d=>!(d.accessTokens.size>0)).length;
    if(devices.size>=maxDevices||unpaired>=maxUnpaired)throw fail(429,'Pairing full');
    const b=await body(req),roots=folders(b.folders),id=random(),token=random(),code=random();
    devices.set(id,{pluginHash:hash(token),pairHash:hash(code),pairExpires:now()+PAIR_CODE_TTL,folders:roots,defaultFolder:safePath(b.defaultFolder??'ChatGPT Inbox',false),jobs:new Map(),accessTokens:new Map(),expires:now()+unpairedTtl});
    return await json(res,201,{plugin_token:token,pair_code:code,expires_in:300});}
   if(path==='/authorize'&&req.method==='GET'){
    rate(req,60);
    const b=Object.fromEntries(u.searchParams),client=clients.get(b.client_id);if(!client||!client.redirects.includes(b.redirect_uri)||b.response_type!=='code'||b.code_challenge_method!=='S256'||! /^[A-Za-z0-9_-]{43}$/.test(b.code_challenge||'')||!oauthScope(b.scope)||b.resource!==origin+'/mcp'||(b.state?.length??0)>2048)throw fail(400,'Invalid OAuth request');if(transactions.size>=1000)throw fail(429,'Authorization full');const nonce=random();transactions.set(nonce,{...b,scope:oauthScope(b.scope),expires:now()+PAIR_CODE_TTL});
    // no-referrer makes browser form POSTs send Origin: null (Fetch §3.2).
    // Keep the form same-origin while hiding the authorization URL from the callback.
    // Chromium checks form-action across redirects too: allow only this validated
    // client callback origin, never an arbitrary wildcard or unescaped URI.
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; form-action 'self' ${cspOrigin(b.redirect_uri)}; frame-ancestors 'none'; base-uri 'none'`,'Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});return res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>Conectar ChatGPT Inbox</title><h1>Conectar tu bóveda</h1><p>Solicitante: ${escape(b.client_id.slice(0,12))}. Continúa solo si acabas de añadir este relay en ChatGPT.</p><p>Autorizas crear notas en las carpetas elegidas y consultar sus recibos. No permite leer tu bóveda. La conexión puede renovarse automáticamente durante un máximo de 30 días y caduca tras 7 días sin renovar. Puedes revocarla en Obsidian.</p><form method="post" action="/authorize"><input type="hidden" name="nonce" value="${nonce}"><label>Código mostrado por Obsidian <input name="pair_code" required autocomplete="off"></label><button>Autorizar conexión</button></form></html>`);}
   if(path==='/authorize'&&req.method==='POST'){rate(req,60);const b=await body(req),tx=transactions.get(b.nonce);transactions.delete(b.nonce);if(!tx)throw fail(400,'Expired authorization');let device;for(const d of devices.values())if(d.pairExpires>now()&&equal(d.pairHash,hash(b.pair_code||'')))device=d;if(!device)throw fail(400,'Invalid or expired pairing code');delete device.pairHash;delete device.pairExpires;const code=random();codes.set(hash(code),{...tx,device,expires:now()+60000});const dest=new URL(tx.redirect_uri);dest.searchParams.set('code',code);dest.searchParams.set('iss',origin);if(tx.state)dest.searchParams.set('state',tx.state);await persist();res.writeHead(302,{Location:dest.href,'Cache-Control':'no-store'});return res.end();}
   if(path==='/token'&&req.method==='POST'){
    rate(req,60);const b=await body(req);
    if(b.grant_type==='refresh_token'){
     if(typeof b.refresh_token!=='string'||typeof b.client_id!=='string')throw fail(400,'invalid_grant');
     const fingerprint=hash(b.refresh_token);
     for(const device of devices.values()){
      const grant=device.accessTokens.get(b.client_id);
      if(!grant?.refreshHash||Math.min(grant.refreshExpires,grant.refreshIdleExpires??Infinity)<=now()||grant.resource!==origin+'/mcp'||!clients.has(b.client_id))continue;
      if(b.resource!==undefined&&b.resource!==grant.resource)throw fail(400,'invalid_grant');
      const used=grant.usedRefreshHashes||[];
      if(used.some(v=>equal(v,fingerprint))){
       // Reusing a rotated token invalidates the entire client grant, not
       // another device/client. Persist revocation before reporting failure.
       device.accessTokens.delete(b.client_id);await persist();throw fail(400,'invalid_grant');
      }
      if(!equal(grant.refreshHash,fingerprint))continue;
      const scope=b.scope===undefined?grant.scope:oauthScope(b.scope);
      if(!scope||scope.split(' ').some(v=>!grant.scope.split(' ').includes(v)))throw fail(400,'invalid_scope');
      if(used.length>=MAX_REFRESH_ROTATIONS){device.accessTokens.delete(b.client_id);await persist();throw fail(400,'invalid_grant');}
      const tokens=mintTokens(device,b.client_id,{...grant,scope,usedRefreshHashes:[...used,fingerprint]});
      return await json(res,200,tokens);
     }
     throw fail(400,'invalid_grant');
    }
    if(b.grant_type!=='authorization_code')throw fail(400,'unsupported_grant_type');
    const c=codes.get(hash(b.code||''));codes.delete(hash(b.code||''));
    if(!c||c.expires<=now()||![...devices.values()].includes(c.device)||b.client_id!==c.client_id||b.redirect_uri!==c.redirect_uri||b.resource!==origin+'/mcp'||! /^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier||'')||!equal(hash(b.code_verifier),c.code_challenge))throw fail(400,'invalid_grant');
    return await json(res,200,mintTokens(c.device,c.client_id,{scope:c.scope,resource:c.resource}));
   }
   if(path==='/mcp'&&req.method==='POST'){const d=auth(req,'writer');rate(req,120,'device:'+d.pluginHash);return await mcp(req,res,d);}
   if(path==='/plugin/revoke'&&req.method==='POST'){const d=auth(req,'plugin');rate(req,120,'device:'+d.pluginHash);for(const[k,v]of devices)if(v===d)devices.delete(k);return await json(res,200,{revoked:true});}
   if(path==='/plugin/poll'&&req.method==='POST'){const d=auth(req,'plugin');rate(req,120,'device:'+d.pluginHash);const b=await body(req);const roots=folders(b.folders,true),destination=safePath(b.defaultFolder??d.defaultFolder??'ChatGPT Inbox',false);d.folders=roots;d.defaultFolder=destination;d.seen=now();for(const j of d.jobs.values())if((j.state==='queued'||j.state==='blocked')&&j.expires>now()){j.state=d.folders.some(root=>root==='*'||j.path.startsWith(root+'/'))?'queued':'blocked';}return await json(res,200,{jobs:[...d.jobs.values()].filter(j=>j.state==='queued').slice(0,10).map(j=>({version:1,id:j.id,path:j.path,content:j.content}))});}
   if(path==='/plugin/receipt'&&req.method==='POST'){const d=auth(req,'plugin');rate(req,120,'device:'+d.pluginHash);const b=await body(req),j=d.jobs.get(b.id);if(!j||!['delivered','conflict'].includes(b.state))throw fail(400,'Invalid receipt');if(j.state===b.state)return await json(res,200,receipt(j));if(j.state!=='queued')throw fail(409,'Terminal receipt');j.state=b.state;j.confirmed=now();delete j.content;return await json(res,200,receipt(j));}
   throw fail(404,'Not found');
  }catch(e){if(res.headersSent){res.end();return;}const status=e.status||400;if(status===401)res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="inbox"`);const message=status===503?'Durable storage unavailable':status>=500?'Error interno':e.message;
   try{await json(res,status,{error:message},false);}
   catch{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Durable storage unavailable'}));}else res.end();}}};
  // Serialize state transitions, including cleanup, so failed commits can roll
  // back without losing another request. Only one process may own this store.
  let queue=Promise.resolve();
  const serial=task=>{const run=queue.then(task);queue=run.catch(()=>{});return run;};
  const server=http.createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:16384},(req,res)=>{void serial(()=>handler(req,res));});
  const cleanup=setInterval(()=>{void serial(async()=>{if(loaded&&!loadFailed)await sweepAndPersist();});},1000);cleanup.unref();
  let closeStorage=Promise.resolve();
  server.on('close',()=>{clearInterval(cleanup);startupAbort.abort();closeStorage=ready.then(()=>queue).then(()=>storage?.close?.());closeStorage.catch(()=>{});});
  let shutdownTask;
  server.shutdown=()=>shutdownTask??=(async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await closeStorage;})();
  server.startup=ready.then(()=>loaded&&!loadFailed);
  return server;
 }
 if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||8787);
  if(process.env.REQUIRE_DURABLE==='true'&&!process.env.DATABASE_URL)throw Error('DATABASE_URL required when REQUIRE_DURABLE=true');
  process.on('unhandledRejection',e=>{console.error('Unhandled relay rejection:',e?.message||e);});
  const storage=process.env.DATABASE_URL?new PgSnapshotStore(process.env.DATABASE_URL):null;
  const num=(name,fallback)=>Number.isFinite(Number(process.env[name]))?Number(process.env[name]):fallback;
  const server=createRelay({trustProxy:process.env.TRUST_PROXY==='true',origin:process.env.PUBLIC_ORIGIN||'http://127.0.0.1:'+port,storage,maxDevices:num('MAX_DEVICES',100),maxJobs:num('MAX_JOBS',100)}).listen(port,process.env.HOST||'127.0.0.1',()=>console.log('Inbox relay listening on '+port+'; storage='+(storage?'postgres':'ephemeral')));
  server.startup.then(ok=>{if(!ok)console.error('Relay storage startup failed; refusing requests.');});
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void server.shutdown().then(()=>process.exit(0),()=>process.exit(1));});
 }

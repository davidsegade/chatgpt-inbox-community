// Explicit opt-in: a local, disposable database with a restricted relay role.
// Never run this against a hosted database or the private plugin's database.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {PgSnapshotStore} from './storage.mjs';
const adminURL=process.env.TEST_ADMIN_DATABASE_URL,relayURL=process.env.TEST_DATABASE_URL;
for(const value of [adminURL,relayURL]){
 if(!value)throw Error('Provide TEST_ADMIN_DATABASE_URL and TEST_DATABASE_URL for a disposable local database');
 const u=new URL(value);
 if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!/^\/chatgpt_inbox_test_[a-z0-9_]+$/.test(u.pathname))throw Error('Only loopback chatgpt_inbox_test_* databases are allowed');
}
const role=new URL(relayURL).username;
if(!/^relay_test_[a-z0-9_]+$/.test(role))throw Error('Restricted test role required');
const unpack=r=>JSON.parse(r.content[0].text);
const digest=s=>createHash('sha256').update(s).digest('base64url');
const note={carpeta:'Inbox',titulo:'Postgres real',contenido:'# Persistencia real 👋',clave:'postgres-note-001'};

test('PostgreSQL real: proceso, crash, roles, fallo durable, lease y retención',async t=>{
 const db=new pg.Client({connectionString:adminURL});await db.connect();t.after(()=>db.end());
 const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const origin=`http://127.0.0.1:${port}`;let child,client;
 const stop=async(signal='SIGKILL')=>{if(client){await client.close();client=null;}if(child){const p=child;child=null;p.kill(signal);const [code]=await once(p,'exit');if(signal==='SIGTERM')assert.equal(code,0,'graceful shutdown exits successfully');}};
 t.after(()=>stop());
 const start=async(expected=200)=>{
  child=spawn(process.execPath,['relay/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DATABASE_URL:relayURL,REQUIRE_DURABLE:'true',PUBLIC_ORIGIN:origin,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let diagnostics='';child.stderr.on('data',b=>diagnostics+=b);child.stdout.resume();
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('Relay exited: '+diagnostics);
   try{const r=await fetch(origin+'/health');if(r.status===expected)return;}catch{}
   await delay(50);
  }
  throw Error('Relay did not become ready: '+diagnostics);
 };
 const post=(path,body,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),redirect:'manual'});
 const connect=async token=>{client=new Client({name:'postgres-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));};
 const rights=async enabled=>db.query(`${enabled?'GRANT':'REVOKE'} INSERT, UPDATE ON chatgpt_inbox.relay_snapshot ${enabled?'TO':'FROM'} ${role}`);
 const state=async()=>(await db.query('SELECT state FROM chatgpt_inbox.relay_snapshot WHERE id=1')).rows[0]?.state;
 // A successor must wait for the initial owner without loading stale data.
 const initialOwner=new PgSnapshotStore(relayURL);await initialOwner.load();
 await start(503);assert.equal((await fetch(origin+'/health')).status,503);
 await initialOwner.close();
 let recovered=false;for(let i=0;i<100;i++){if((await fetch(origin+'/health')).status===200){recovered=true;break;}await delay(25);}
 assert.equal(recovered,true,'the same process recovers when the previous owner releases the lease');
 const pair=await(await post('/pair',{folders:['Inbox']})).json();assert.ok(pair.plugin_token);
 assert.ok(!JSON.stringify(await state()).includes(pair.plugin_token));
 await stop();await start(); // Pairing is recovered after a real SIGKILL.
 const redirect='https://chatgpt.com/connector/oauth/callback',verifier='x'.repeat(43);
 const registration=await(await post('/register',{redirect_uris:[redirect]})).json();
 const query=new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:digest(verifier),scope:'inbox',resource:origin+'/mcp',state:'postgres-state'});
 const page=await(await fetch(origin+'/authorize?'+query)).text();const nonce=page.match(/name="nonce" value="([^"]+)"/)[1];
 const consent=await post('/authorize',{nonce,pair_code:pair.pair_code});assert.equal(consent.status,302);
 const location=new URL(consent.headers.get('location'));assert.equal(location.searchParams.get('iss'),origin);
 await stop();await start(); // Persisted authorization code survives restart.
 const tokenResponse=await post('/token',{grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:redirect,resource:origin+'/mcp',code:location.searchParams.get('code'),code_verifier:verifier});
 assert.equal(tokenResponse.status,200);const session=await tokenResponse.json();let token=session.access_token,refresh=session.refresh_token;assert.ok(refresh);
 await stop('SIGTERM');
 const leaseAfterShutdown=new PgSnapshotStore(relayURL);await leaseAfterShutdown.load();await leaseAfterShutdown.close();
 await start();
 const renew=()=>post('/token',{grant_type:'refresh_token',client_id:registration.client_id,resource:origin+'/mcp',refresh_token:refresh});
 let renewal=await renew();assert.equal(renewal.status,200);let renewed=await renewal.json();token=renewed.access_token;refresh=renewed.refresh_token;
 assert.ok(!JSON.stringify(await state()).includes(refresh),'refresh tokens are only stored as hashes');
 await connect(token);
 const j=unpack(await client.callTool({name:'crear_nota',arguments:note}));assert.equal(j.state,'queued');
 await stop();await start();await connect(token);
 const jobs=(await(await post('/plugin/poll',{folders:['Inbox']},pair.plugin_token)).json()).jobs;
 assert.equal(jobs[0].id,j.id);assert.equal(jobs[0].content,note.contenido);
 assert.ok(!JSON.stringify(await state()).includes(token));
 // A second store is refused before it can load/write a stale snapshot.
 const rival=new PgSnapshotStore(relayURL);await assert.rejects(rival.load(),/Another relay/);await rival.close();
 // Real SQL permission failure during enqueue and ACK must not become success.
 await rights(false);
 assert.equal((await renew()).status,503,'a failed rotation must not consume the persisted refresh token');
 assert.equal((await client.callTool({name:'crear_nota',arguments:{...note,titulo:'Must not persist',clave:'postgres-failed-02'}})).isError,true);
 assert.equal((await post('/plugin/receipt',{id:j.id,state:'delivered'},pair.plugin_token)).status,503);
 assert.equal(unpack(await client.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'queued');
 assert.equal((await fetch(origin+'/health')).status,503);
 await rights(true);await stop();await start();
 renewal=await renew();assert.equal(renewal.status,200);renewed=await renewal.json();token=renewed.access_token;refresh=renewed.refresh_token;await connect(token);
 assert.equal((await state()).devices[0][1].jobs.length,1);
 assert.equal((await post('/plugin/receipt',{id:j.id,state:'delivered'},pair.plugin_token)).status,200);
 await stop();await start();await connect(token);
 assert.equal(unpack(await client.callTool({name:'consultar_estado',arguments:{id:j.id}})).state,'delivered');
 assert.ok(!JSON.stringify(await state()).includes(note.contenido));
 await rights(false);assert.equal((await post('/plugin/revoke',{},pair.plugin_token)).status,503);
 await rights(true);await stop();await start();
 assert.equal((await post('/plugin/poll',{folders:['Inbox']},pair.plugin_token)).status,200);
 // Verify cleanup of pending content in the actual JSONB snapshot after restart.
 await connect(token);await client.callTool({name:'crear_nota',arguments:{...note,titulo:'Expires',clave:'postgres-expire-03'}});
 await stop();const stored=await state();for(const[,d]of stored.devices)for(const[,job]of d.jobs)if(job.state==='queued')job.expires=Date.now()-1000;
 await db.query('UPDATE chatgpt_inbox.relay_snapshot SET state=$1',[JSON.stringify(stored)]);await start();
 assert.ok(!JSON.stringify(await state()).includes(note.contenido));
 assert.equal((await post('/plugin/revoke',{},pair.plugin_token)).status,200);
 await stop();await start();assert.equal((await post('/plugin/poll',{folders:['Inbox']},pair.plugin_token)).status,401);
 // The runtime role must have no privilege on another schema and no PUBLIC grant.
 const publicGrants=await db.query("SELECT count(*)::int AS count FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='chatgpt_inbox' AND a.grantee=0 AND a.privilege_type='USAGE'");assert.equal(publicGrants.rows[0].count,0);
 // Loss of the leased connection is terminal; it cannot silently reacquire and overwrite.
 await stop();await start();
 const backends=await db.query('SELECT pid FROM pg_stat_activity WHERE usename=$1',[role]);assert.equal(backends.rows.length,1);
 await db.query('SELECT pg_terminate_backend($1)',[backends.rows[0].pid]);await delay(50);
 assert.equal((await fetch(origin+'/health')).status,503);
 assert.equal((await post('/pair',{folders:['Inbox']})).status,503);
 await stop();const store=new PgSnapshotStore(relayURL);await store.load();
 const pid=(await store.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await db.query('SELECT pg_terminate_backend($1)',[pid]);await delay(50);
 await assert.rejects(store.save(await state()),/session unavailable/);await store.close();
 await db.query(`REVOKE SELECT ON chatgpt_inbox.relay_snapshot FROM ${role}`);
 await start(503);assert.equal((await post('/pair',{folders:['Inbox']})).status,503);
 await db.query(`GRANT SELECT ON chatgpt_inbox.relay_snapshot TO ${role}`);await stop();await start();
 console.log('Verified PostgreSQL '+(await db.query('SHOW server_version')).rows[0].server_version+'; real lease handover, SIGTERM shutdown, SIGKILL restarts, refresh rotation/rollback, restricted role, failed saves, exclusive lease, expiry, connection loss.');
});

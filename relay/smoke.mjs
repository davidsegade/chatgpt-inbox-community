// Explicitly opt in: node relay/smoke.mjs https://YOUR-STAGING-RELAY
// Creates and revokes one synthetic test inbox; never reads a real vault.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import receiver from '../relay-client.cjs';
const origin=receiver.relayOrigin(process.argv[2]);
const post=(path,b,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(b),redirect:'manual'});
const value=async r=>{assert.ok(r.ok,`HTTP ${r.status}`);return r.json();};
const p=await value(await post('/pair',{folders:['Beta Smoke']}));let client;
try{
 const redirect='http://127.0.0.1:9191/callback',verifier=randomBytes(32).toString('base64url');
 const registration=await value(await post('/register',{redirect_uris:[redirect]}));
 const q=new URLSearchParams({client_id:registration.client_id,redirect_uri:redirect,response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:'inbox offline_access',resource:origin+'/mcp',state:'synthetic-smoke'});
 const page=await(await fetch(origin+'/authorize?'+q)).text(),nonce=page.match(/name="nonce" value="([^"]+)"/)?.[1];assert.ok(nonce);
 const consent=await post('/authorize',{nonce,pair_code:p.pair_code});assert.equal(consent.status,302);
 const code=new URL(consent.headers.get('location')).searchParams.get('code');
 const session=await value(await post('/token',{grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:redirect,resource:origin+'/mcp',code,code_verifier:verifier}));
 const renewed=await value(await post('/token',{grant_type:'refresh_token',client_id:registration.client_id,resource:origin+'/mcp',refresh_token:session.refresh_token}));assert.notEqual(renewed.refresh_token,session.refresh_token);assert.equal((await post('/mcp',{},session.access_token)).status,401);
 client=new Client({name:'inbox-staging-smoke',version:'0.4.1'});await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+renewed.access_token}}}));
 const tools=await client.listTools();assert.equal(tools.tools.length,3);
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError);return JSON.parse(result.content[0].text);};
 assert.deepEqual((await call('listar_carpetas',{})).carpetas,['Beta Smoke']);
 const queued=await call('crear_nota',{carpeta:'Beta Smoke',titulo:'Synthetic HTTPS',contenido:'# Synthetic beta test',clave:'smoke-'+randomBytes(8).toString('hex')});assert.equal(queued.state,'queued');
 const jobs=await value(await post('/plugin/poll',{folders:['Beta Smoke']},p.plugin_token));
 const files=new Map();await receiver.receiveRelay(jobs.jobs,['Beta Smoke'],'.obsidian',{}, {read:async path=>files.get(path)??null,create:async(path,body)=>files.set(path,body)},async()=>{},async(id,state)=>{await value(await post('/plugin/receipt',{id,state},p.plugin_token));});
 const receipt=await call('consultar_estado',{id:queued.id});assert.equal(receipt.state,'delivered');
 console.log(JSON.stringify({origin,tools:tools.tools.map(t=>t.name),state:receipt.state,verification:'HTTPS + OAuth + MCP SDK + receiver with in-memory test vault; not a ChatGPT/Obsidian UI test'}));
}finally{await client?.close();await value(await post('/plugin/revoke',{},p.plugin_token));}

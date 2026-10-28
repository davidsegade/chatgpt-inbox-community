const {test}=require('node:test');const a=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {webcrypto}=require('node:crypto');
test('plugin compilado: GitHub GET → bóveda, reintento, conflicto, secreto y suspensión',async()=>{
 const files=new Map(),calls=[],notices=[];let saved;let responseStatus=200;
 class TFile{constructor(path){this.path=path}}class TFolder{}
 const payload={version:1,id:'integration-1',path:'ChatGPT Inbox/Pruebas/iPhone.md',content:'# Prueba real de contrato'};
 const sha='a'.repeat(40);
 const api={Modal:class{},FuzzySuggestModal:class{},Plugin:class{saveData(d){saved=JSON.parse(JSON.stringify(d));return Promise.resolve();}},PluginSettingTab:class{},Setting:class{},SecretComponent:class{},TFile,TFolder,Notice:class{constructor(s){notices.push(s)}},requestUrl:async req=>{calls.push(req);return {status:responseStatus,headers:{},json:req.url.includes('/contents/')?[{type:'file',name:'test.json',sha,size:100}]:{encoding:'base64',size:100,content:Buffer.from(JSON.stringify(payload)).toString('base64')}};}};
 const module={exports:{}};const document={hidden:false};
 vm.runInNewContext(fs.readFileSync('main.js','utf8'),{module,exports:module.exports,require:n=>{a.equal(n,'obsidian');return api;},AbortController,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,atob,document,window:{setTimeout,clearTimeout},Date,console});
 const p=new module.exports.default();
 p.app={secretStorage:{getSecret:()=> 'fixture-not-real-token'},vault:{configDir:'.obsidian',getName:()=> 'Bóveda de prueba',getAbstractFileByPath:path=>files.has(path)?new TFile(path):path.endsWith('.md')?null:new TFolder(),read:async f=>files.has(f.path)?files.get(f.path):null,create:async(path,body)=>{a.equal(files.has(path),false);files.set(path,body);},createFolder:async()=>{}}};
 p.settings.transport='github';p.settings.enabled=true;p.settings.repository='davidsegade/obsidian-chatgpt-test';
  payload.path='Cartera/Prueba.md';await p.poll(true);a.equal(files.size,0);a.equal(p.history[0].state,'Bloqueada');
 p.settings.wholeVault=true;await p.permissionsChanged();a.ok(files.get(payload.path).startsWith(payload.content));a.ok(saved.ledger[payload.id]);a.ok(!JSON.stringify(saved).includes('fixture-not-real-token'));
 await p.poll(true);a.equal(files.size,1);
 payload.id='integration-2';payload.content='otra';await p.poll(true);a.ok(files.get(payload.path).startsWith('# Prueba real de contrato'));a.equal(saved.ledger[payload.id],undefined);a.match(p.status,/1 pendiente/);
 document.hidden=true;const n=calls.length;await p.poll(true);a.equal(calls.length,n);document.hidden=false;
 responseStatus=429;await p.poll(true);a.match(p.status,/429/);await p.poll(true);a.equal(calls.length,n+1);
 a.ok(calls.every(r=>r.method==='GET'&&r.url.startsWith('https://api.github.com/repos/davidsegade/obsidian-chatgpt-test/')));
});
function harness(data={},requestHook,options={}){
 const saved=[],requests=[],tabs=[],document={hidden:true},navigator={onLine:true},listeners=new Map(),intervals=[];
 const clock={now:Date.now()};class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}let layout;
 const module={exports:{}};
 class Folder{constructor(path){this.path=path;this.children=[];}}
 class File{constructor(path){this.path=path;this.extension='md';}}
 const api={Modal:class{},FuzzySuggestModal:class{},TFolder:Folder,TFile:File,PluginSettingTab:class{},Setting:class{},SecretComponent:class{},Notice:class{},Plugin:class{
  loadData(){return Promise.resolve(data);}saveData(d){saved.push(d);return Promise.resolve();}
  registerEvent(){}addRibbonIcon(){}addCommand(){}addSettingTab(tab){tabs.push(tab);}registerInterval(id){intervals.push(id);}registerDomEvent(target,event,callback){listeners.set(event,callback);}
 },requestUrl:async r=>{requests.push(r);return requestHook?await requestHook(r):{status:200,json:[{type:'file',name:'a.json',sha:'a'.repeat(40),size:100}],headers:{}};}};
 vm.runInNewContext(fs.readFileSync('main.js','utf8'),{module,exports:module.exports,require:()=>api,AbortController,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,atob,URL,document,navigator,window:{setInterval:callback=>{intervals.push(callback);return 1;},setTimeout:options.setTimeout??setTimeout,clearTimeout:options.clearTimeout??clearTimeout},Date:ClockDate});
 const p=new module.exports.default();p.app={vault:{configDir:'.obsidian',getName:()=> 'Bóveda de prueba',on:()=>({})},secretStorage:{getSecret:()=> 'test-token'},workspace:{onLayoutReady:cb=>layout=cb}};
 return {p,saved,requests,tabs,Folder,File,document,navigator,listeners,clock,intervals};
}
test('migración 0.1 conserva ajustes, ledger y recepción pausada',async()=>{
 const old={settings:{enabled:false,roots:['Mis notas'],secret:'existing-secret',interval:300},ledger:{old:'hash'}};
 const {p,saved}=harness(old);await p.onload();a.equal(p.settings.enabled,false);a.deepEqual(Array.from(p.settings.roots),['Mis notas']);a.equal(p.settings.secret,'existing-secret');a.equal(p.ledger.old,'hash');await p.persist();a.equal(saved[0].ledger.old,'hash');a.equal(saved[0].history.length,0);
});
test('historial conserva importación original al deduplicar y limita a 100',()=>{
 const {p}=harness();p.record({source:'a.json',path:'a.md',state:'Importada'});const first=p.history[0];p.record({source:'a.json',path:'a.md',state:'Ya entregada'});a.equal(p.history[0],first);
 for(let i=0;i<110;i++)p.record({source:i+'.json',state:'Bloqueada'});a.equal(p.history.length,100);a.equal(p.history[0].source,'10.json');
});
test('probar conexión no importa ni activa ni persiste credenciales',async()=>{
  const {p,requests,saved}=harness({settings:{repository:'davidsegade/obsidian-chatgpt-test'}});await p.onload();a.equal(await p.checkConnection(),1);a.equal(p.settings.enabled,false);a.equal(saved.length,0);a.equal(requests.length,1);a.equal(requests[0].method,'GET');
  p.app.secretStorage.getSecret=()=>null;await a.rejects(p.checkConnection(),/Vincula/);
});
test('persistencia serializada conserva el último estado tras guardados simultáneos',async()=>{
 const {p,saved}=harness();p.settings.interval=60;const one=p.persist();p.settings.interval=300;const two=p.persist();await Promise.all([one,two]);a.equal(saved[0].settings.interval,60);a.equal(saved[1].settings.interval,300);a.ok(!JSON.stringify(saved).includes('test-token'));
});
function navigationHarness(filePresent=true,settingsSupported=true,fail=false){
 const calls=[],notices=[];class TFile{}const file=new TFile();const leaf={openFile:async(f,opts)=>{a.equal(f,file);a.equal(opts.active,true);calls.push('open');if(fail)throw Error('view failed');}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync('navigation.cjs','utf8'),{module:mod,exports:mod.exports,require:()=>({TFile,Notice:class{constructor(s){notices.push(s);}}})});
 const app={vault:{getAbstractFileByPath:()=>filePresent?file:null},workspace:{getLeaf:()=>leaf,revealLeaf:async()=>calls.push('reveal'),setActiveLeaf:()=>calls.push('focus')}};
 if(settingsSupported)app.setting={close:()=>calls.push('settings-close')};
 return {calls,notices,open:()=>mod.exports.openInboxNote(app,'Árbol/Nota con espacios.md',()=>calls.push('inbox-close'))};
}
test('abrir nota cierra bandeja y ajustes antes de abrir y enfocar archivo exacto',async()=>{
 const h=navigationHarness();a.equal(await h.open(),true);a.deepEqual(h.calls,['inbox-close','settings-close','open','reveal','focus']);
});
test('nota movida no crea archivos ni cierra la bandeja',async()=>{const h=navigationHarness(false);a.equal(await h.open(),false);a.deepEqual(h.calls,[]);});
test('sin API de cierre de ajustes abre archivo e informa cómo verlo',async()=>{const h=navigationHarness(true,false);a.equal(await h.open(),true);a.deepEqual(h.calls,['inbox-close','open','reveal','focus']);a.match(h.notices[0],/ajustes/);});
test('error al abrir no deja promesa rechazada y muestra diagnóstico',async()=>{const h=navigationHarness(true,true,true);await h.open();a.match(h.notices[0],/No se pudo abrir/);});

test('credencial de relay queda ligada al origen emparejado',async()=>{
 const {p,requests}=harness();p.settings.transport='relay';p.settings.relay='https://new.example';p.settings.boundRelay='https://original.example';
 await a.rejects(p.relayRequest('/plugin/poll',{}),error=>error.code==='reconnect');a.equal(requests.length,0);
});


test('una ruta fuera de las carpetas permitidas no se abre nunca en la bóveda',async()=>{
 const files=new Map(),touched=[];
 class TFile{constructor(path){this.path=path}}class TFolder{}
 const payload={version:1,id:'scope-1',path:'Privado/Secreto.md',content:'contenido privado'};
 const sha='a'.repeat(40);
 const api={Modal:class{},FuzzySuggestModal:class{},Plugin:class{saveData(){return Promise.resolve();}},PluginSettingTab:class{},Setting:class{},SecretComponent:class{},TFile,TFolder,Notice:class{constructor(s){}},requestUrl:async req=>({status:200,headers:{},json:req.url.includes('/contents/')?[{type:'file',name:'test.json',sha,size:100}]:{encoding:'base64',size:100,content:Buffer.from(JSON.stringify(payload)).toString('base64')}})};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync('main.js','utf8'),{module,exports:module.exports,require:n=>{a.equal(n,'obsidian');return api;},AbortController,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,atob,document:{hidden:false},window:{setTimeout,clearTimeout},Date,console});
 const p=new module.exports.default();
 p.app={secretStorage:{getSecret:()=>'fixture-not-real-token'},vault:{configDir:'.obsidian',getName:()=>'Bóveda de prueba',getAbstractFileByPath:path=>{touched.push(path);return files.has(path)?new TFile(path):path.endsWith('.md')?null:new TFolder();},read:async f=>{touched.push(f.path);return files.get(f.path)??null;},create:async(path,body)=>{files.set(path,body);},createFolder:async()=>{}}};
 p.settings.transport='github';p.settings.enabled=true;p.settings.repository='owner/repo';
 await p.poll(true);
 // The request is outside the authorized scope: it is blocked and the note is
 // never opened, so the plugin cannot be used to probe the vault.
 a.equal(files.size,0);a.equal(p.history[0].state,'Bloqueada');
 a.deepEqual(touched,[],'no se abre ninguna ruta no autorizada: '+touched.join(','));
});

test('migración no amplía permisos y conserva destino por defecto independiente',async()=>{
 const {p}=harness({settings:{roots:['Cartera'],enabled:false},ledger:{done:'hash'}});await p.onload();
 a.equal(p.settings.wholeVault,false);a.equal(p.settings.defaultFolder,'ChatGPT Inbox');a.deepEqual(Array.from(p.permittedRoots()),['Cartera']);
 p.settings.wholeVault=true;a.deepEqual(Array.from(p.permittedRoots()),['*']);a.equal(p.ledger.done,'hash');
});
test('cambiar permisos persiste y reintenta; si hay importación en curso solicita reintento posterior',async()=>{
 const {p,saved}=harness();let calls=0;p.poll=async manual=>{a.equal(manual,true);calls++;};
 p.settings.enabled=true;await p.permissionsChanged();a.equal(calls,1);a.equal(saved.length,1);
 p.running=true;await p.permissionsChanged();a.equal(calls,1);a.equal(p.retryPermissions,true);
});

test('relay: pausar o descargar durante el sondeo impide tocar la bóveda',async()=>{
 for(const state of ['paused','stopped']){
  const {p}=harness();p.settings.enabled=true;
  let complete;const response=new Promise(r=>complete=r);
  p.relayRequest=async()=>response;
  p.app.vault={configDir:'.obsidian',getAbstractFileByPath:()=>a.fail('unexpected vault access')};
  const run=p.pollRelay();
  if(state==='paused')p.settings.enabled=false;else p.stopped=true;
  complete({jobs:[{version:1,id:'pause',path:'ChatGPT Inbox/a.md',content:'x'}]});
  await run;a.equal(Object.keys(p.ledger).length,0);
 }
});


test('cambiar el relay durante emparejamiento no vincula su token a otro origen',async()=>{
 const {p}=harness({},async()=>{p.settings.relay='https://changed.example';return {status:201,json:{plugin_token:'test-only',pair_code:'test-code'}};});
 let stored=false;p.app.secretStorage={getSecret:()=>null,setSecret:()=>stored=true};p.settings.relay='https://original.example';
 await a.rejects(p.pairRelay(),error=>error.code==='reconnect');a.equal(stored,false);a.equal(p.settings.boundRelay,'');
});

test('cambiar el nombre del secreto exige emparejar y revoca el secreto anterior',async()=>{
 const {p,requests}=harness({},async r=>({status:200,json:r.url.endsWith('/pair')?{plugin_token:'new-test-token',pair_code:'code'}:{revoked:true}}));
 p.settings.relay=p.settings.boundRelay='https://relay.example';p.settings.boundRelaySecret='old-secret';p.settings.relaySecret='new-secret';
 p.app.secretStorage={getSecret:id=>id==='old-secret'?'old-test-token':null,setSecret:()=>{}};
 await a.rejects(p.relayRequest('/plugin/poll',{}),error=>error.code==='reconnect');a.equal(requests.length,0);
 p.deliveryTest={key:'connection-test-old-12345678',path:'ChatGPT Inbox/Prueba de conexión-connection-test-old-12345678.md',relay:p.settings.relay,secret:'old-secret',state:'unknown'};
 await p.pairRelay();a.equal(p.deliveryTest,null,'a new device grant must start a fresh test sequence');a.equal(requests[0].headers.Authorization,'Bearer old-test-token');a.equal(requests[0].url,'https://relay.example/plugin/revoke');a.equal(requests[1].headers.Authorization,undefined);a.equal(p.settings.boundRelaySecret,'new-secret');
});

test('datos locales dañados no inyectan tipos, historial ni claves de prototipo',async()=>{
 const {p}=harness(JSON.parse('{"settings":{"enabled":"yes","wholeVault":1,"interval":-1,"roots":[42,"../private","Allowed"]},"ledger":{"__proto__":"bad","ok":"hash"},"history":[null,{"source":1},{"source":"ok","state":"Importada","time":1}]}'));
 await p.onload();a.equal(p.settings.enabled,false);a.equal(p.settings.wholeVault,false);a.equal(p.settings.interval,120);
 a.deepEqual(Array.from(p.settings.roots),['Allowed']);a.equal(Object.getPrototypeOf(p.ledger),null);a.equal(p.ledger.ok,'hash');a.equal(p.history.length,1);
});
test('respuesta de relay inválida no toca la bóveda ni guarda credenciales',async()=>{
 for(const response of [null,[],{jobs:[{version:1,id:'x',path:23,content:'x'}]},{jobs:'bad'}]){
  const {p}=harness({},async()=>({status:200,json:response}));p.settings.relay=p.settings.boundRelay='https://relay.example';p.settings.enabled=true;
  p.app.vault.getAbstractFileByPath=()=>a.fail('No vault access before validation');
  await a.rejects(p.pollRelay());
 }
});
test('buscar nota solo recorre árboles autorizados y excluye configuración personalizada',async()=>{
 const {p,Folder,File}=harness();const allowed=new Folder('Allowed'),privateFolder=new Folder('Private'),config=new Folder('Allowed/config');
 const target=new File('Allowed/note.md');allowed.children=[target,config];config.children=[new File('Allowed/config/secret.md')];
 p.settings.roots=['Allowed'];let reads=[];
 p.app.vault={configDir:'Allowed/config',getAbstractFileByPath:path=>path==='Allowed'?allowed:privateFolder,cachedRead:async file=>{reads.push(file.path);return 'content';},getMarkdownFiles:()=>a.fail('No global enumeration')};
 const {digest}=require('./core.cjs');const entry={source:'x',state:'Importada',time:1,contentHash:await digest('content')};
 a.equal(await p.resolveNote(entry),target);a.deepEqual(reads,['Allowed/note.md']);
});
test('ajustes declarativos exponen búsqueda y actualizan mediante API pública',async()=>{
 const {p,tabs}=harness();await p.onload();const tab=tabs[0];const definitions=tab.getSettingDefinitions();
 a.ok(definitions.some(d=>d.type==='group'&&d.heading==='Carpetas permitidas'&&d.items.some(item=>item.name==='Destino por defecto')));
 a.ok(definitions.some(d=>d.name==='Importar solicitudes'));
 a.equal(Object.hasOwn(Object.getPrototypeOf(tab),'display'),false);
});

test('revocar permiso durante creación de carpetas GitHub impide escribir la nota',async()=>{
 const job={version:1,id:'revoke-in-flight',path:'Allowed/new/a.md',content:'text'};
 const {p,document}=harness({},async request=>({status:200,headers:{},json:request.url.includes('/contents/')?[{type:'file',name:'a.json',sha:'a'.repeat(40),size:100}]:{encoding:'base64',size:100,content:Buffer.from(JSON.stringify(job)).toString('base64')}}));
 document.hidden=false;p.settings.transport='github';p.settings.repository='owner/repo';p.settings.enabled=true;p.settings.roots=['Allowed'];
 p.app.vault={configDir:'.obsidian',getAbstractFileByPath:()=>null,createFolder:async()=>{p.settings.roots=[];},create:async()=>a.fail('Revoked note must not be written')};
 await p.poll(true);a.equal(p.history[0].state,'Bloqueada');a.equal(p.ledger[job.id],undefined);
});

const settle=async p=>{for(let i=0;i<30;i++){await new Promise(resolve=>setImmediate(resolve));if(!p.running)return;}a.fail('receiver did not settle');};
test('sin internet no hace solicitudes; volver online respeta una sola recepción',async()=>{
 const h=harness({settings:{enabled:true,transport:'github',repository:'owner/repo'}},async()=>({status:200,json:[],headers:{}}));await h.p.onload();h.document.hidden=false;h.navigator.onLine=false;
 await h.p.poll(true);a.equal(h.requests.length,0);a.equal(h.p.receptionSummary().label,'Sin conexión');
 h.navigator.onLine=true;h.listeners.get('online')();h.listeners.get('focus')();await settle(h.p);a.equal(h.requests.length,1);a.ok(h.p.lastSuccess);
 h.listeners.get('focus')();await settle(h.p);a.equal(h.requests.length,1,'focus cannot bypass the configured interval');
 h.clock.now+=120001;h.listeners.get('focus')();await settle(h.p);a.equal(h.requests.length,2);
});
test('fallos transitorios tienen backoff; el intervalo no impide el reintento al minuto',async()=>{
 let failure=true;const h=harness({},async()=>({status:failure?503:200,json:[],headers:{}}));h.document.hidden=false;h.p.settings.transport='github';h.p.settings.repository='owner/repo';h.p.settings.enabled=true;
 await h.p.poll();a.equal(h.p.failureCode,'server');a.equal(h.p.nextRetry,h.clock.now+60000);
 h.clock.now+=59999;await h.p.poll();a.equal(h.requests.length,1);
 failure=false;h.clock.now++;await h.p.poll();a.equal(h.requests.length,2);a.equal(h.p.failures,0);a.equal(h.p.failureCode,null);
});
test('una solicitud que excede el timeout no bloquea el receptor ni entrega datos tardíos',async()=>{
 let expire,complete;const h=harness({},()=>new Promise(resolve=>complete=resolve),{setTimeout:callback=>{expire=callback;return 1;},clearTimeout:()=>{}});
 h.document.hidden=false;h.p.settings.enabled=true;h.p.settings.transport='github';h.p.settings.repository='owner/repo';
 const polling=h.p.poll(true);expire();await polling;a.equal(h.p.running,false);a.equal(h.p.failureCode,'timeout');
 complete({status:200,json:[{type:'file',name:'late.json',sha:'a'.repeat(40),size:100}],headers:{}});await settle(h.p);a.equal(h.requests.length,1);a.equal(h.p.history.length,0);
});
test('suspender en mitad de un sondeo no lee ni escribe; reanudar reintenta sin duplicados',async()=>{
 let finish,first=true;const payload={version:1,id:'resume-1',path:'ChatGPT Inbox/a.md',content:'resume'};
 const h=harness({settings:{enabled:true,transport:'github',repository:'owner/repo'}},async request=>{
  if(first){first=false;return new Promise(resolve=>finish=resolve);}
  return {status:200,headers:{},json:request.url.includes('/contents/')?[{type:'file',name:'a.json',sha:'a'.repeat(40),size:100}]:{encoding:'base64',size:100,content:Buffer.from(JSON.stringify(payload)).toString('base64')}};
 });await h.p.onload();h.document.hidden=false;const files=new Map();let reads=0;
 h.p.app.vault={configDir:'.obsidian',getAbstractFileByPath:path=>{reads++;return files.has(path)?new h.File(path):null;},createFolder:async()=>{},create:async(path,content)=>{a.equal(files.has(path),false);files.set(path,content);},read:async file=>files.get(file.path)};
 const run=h.p.poll();h.document.hidden=true;h.listeners.get('visibilitychange')();finish({status:200,json:[{type:'file',name:'a.json',sha:'a'.repeat(40),size:100}],headers:{}});await run;
 a.equal(reads,0);a.equal(files.size,0);a.equal(h.p.lastSuccess,0);
 h.document.hidden=false;h.listeners.get('visibilitychange')();await settle(h.p);a.equal(files.size,1);a.ok(h.p.lastSuccess);
 h.clock.now+=120001;await h.p.poll();a.equal(files.size,1);
});
test('el diagnóstico excluye rutas, notas, direcciones, credenciales y errores originales',()=>{
 const h=harness();h.p.settings={...h.p.settings,repository:'PRIVATE-REPO',relay:'https://PRIVATE-SERVER.example',secret:'PRIVATE-SECRET-ID',roots:['PRIVATE-FOLDER']};
 h.p.history=[{source:'PRIVATE-SOURCE',path:'PRIVATE-PATH',state:'Guardada sin recibo',receiptPending:true,time:1,detail:'PRIVATE-CONTENT'}];
 const report=JSON.stringify(h.p.diagnosticReport());a.doesNotMatch(report,/PRIVATE/);a.equal(JSON.parse(report).history.receiptPending,1);a.equal(JSON.parse(report).scope.folderCount,1);
});
test('se conserva la clave de una prueba interrumpida tras guardar y reiniciar',async()=>{
 const key='connection-test-test-12345678';const h=harness({deliveryTest:{key,path:`ChatGPT Inbox/Prueba de conexión-${key}.md`,relay:'https://relay.example',secret:'id-only',state:'unknown'}});
 await h.p.onload();a.equal(h.p.deliveryTest.key,key);await h.p.persist();a.equal(h.saved[0].deliveryTest.key,key);
});

test('cambiar de modo durante un sondeo invalida el resultado y no toca la bóveda',async()=>{
 let complete;const h=harness({},()=>new Promise(resolve=>complete=resolve));h.document.hidden=false;h.p.settings.enabled=true;h.p.settings.transport='github';h.p.settings.repository='owner/repo';
 h.p.app.vault.getAbstractFileByPath=()=>a.fail('stale transport must not read vault');
 const run=h.p.poll(true);h.p.settings.transport='lite';complete({status:200,json:[{type:'file',name:'a.json',sha:'a'.repeat(40),size:100}],headers:{}});
 await new Promise(resolve=>setImmediate(resolve));
 // The blob request must be fenced too, before following the stale listing.
 if(h.requests.length>1)complete({status:200,json:{encoding:'base64',size:100,content:Buffer.from(JSON.stringify({version:1,id:'old-mode',path:'ChatGPT Inbox/a.md',content:'stale'})).toString('base64')},headers:{}});
 await run;a.equal(h.p.lastSuccess,0);a.equal(Object.keys(h.p.ledger).length,0);
});

test('un fallo de autorización pide intervención y no se reintenta automáticamente cada foco',async()=>{
 let status=401;const h=harness({},async()=>({status,json:[],headers:{}}));h.document.hidden=false;h.p.settings.enabled=true;h.p.settings.transport='github';h.p.settings.repository='owner/repo';
 await h.p.poll(true);a.equal(h.p.receptionSummary().label,'Requiere reconectar');h.clock.now+=900000;await h.p.poll();a.equal(h.requests.length,1);
 status=200;await h.p.poll(true);a.equal(h.requests.length,2);a.equal(h.p.failureCode,null);
});

test('fallar al guardar no expone el error original ni bloquea guardados posteriores',async()=>{
 const {p,saved}=harness();const save=p.saveData.bind(p);p.saveData=()=>Promise.reject(Error('PRIVATE FILESYSTEM DETAIL'));
 await a.rejects(p.persist(),error=>error.code==='storage'&&!error.message.includes('PRIVATE'));
 p.saveData=save;p.settings.interval=300;await p.persist();a.equal(saved[0].settings.interval,300);
});

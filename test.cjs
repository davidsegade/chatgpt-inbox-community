const {test}=require('node:test');const a=require('node:assert/strict');const c=require('./core.cjs');
const roots=['ChatGPT Inbox','Proyectos'];
const job=(extra={})=>({version:1,id:'test-1',path:'ChatGPT Inbox/a.md',content:'# Hola',...extra});
for(const p of ['../a.md','/a.md','a/../b.md','a//b.md','a\\b.md','.obsidian/a.md','a/.git/b.md','a/%2e%2e/b.md','a/x:foo.md','a/a.md ','a/CON.md','a/\u0000.md','a/e\u0301.md','a/a.txt'])test('rechaza '+JSON.stringify(p),()=>a.throws(()=>c.safePath(p)));
test('rutas arbitrarias y Unicode NFC',()=>a.equal(c.safePath('Proyectos/Árbol/Nota válida.md'),'Proyectos/Árbol/Nota válida.md'));
test('límite de carpeta exacto',()=>a.throws(()=>c.parseJob(JSON.stringify(job({path:'Proyectos-extra/a.md'})),roots,'.obsidian')));
test('protege configDir personalizado sin distinguir mayúsculas',()=>a.throws(()=>c.parseJob(JSON.stringify(job({path:'Proyectos/Config/a.md'})),roots,'proyectos/config')));
test('lista vacía bloquea',()=>a.throws(()=>c.parseJob(JSON.stringify(job()),[],'.obsidian')));
test('límite UTF8',()=>a.throws(()=>c.parseJob(JSON.stringify(job({content:'🦉'.repeat(40000)})),roots,'.obsidian')));
test('rechaza instrucciones de sobrescritura y versión desconocida',()=>{a.throws(()=>c.parseJob(JSON.stringify({...job(),overwrite:true}),roots,'.obsidian'));a.throws(()=>c.parseJob(JSON.stringify(job({version:2})),roots,'.obsidian'));});
function vault(){const files=new Map();return {files,read:async p=>files.get(p)??null,create:async(p,v)=>{if(files.has(p))throw Error('exists');files.set(p,v);}};}
test('creación y repetición tras reinicio',async()=>{const v=vault(),l={};a.equal(await c.deliver(job(),l,v),'creada');a.equal(await c.deliver(job(),JSON.parse(JSON.stringify(l)),v),'duplicada');a.equal(v.files.size,1);});
test('conflicto conserva archivo y solicitud pendiente',async()=>{const v=vault(),l={};v.files.set(job().path,'local');a.match(await c.deliver(job(),l,v),/conflicto/);a.equal(v.files.get(job().path),'local');a.equal(Object.keys(l).length,0);});
test('recuperación tras fallo guardando ledger',async()=>{const v=vault();await c.deliver(job(),{},v);a.equal(await c.deliver(job(),{},v),'ya presente');});
test('ID reutilizado se bloquea incluso con otra ruta',async()=>{const v=vault(),l={};await c.deliver(job(),l,v);await a.rejects(c.deliver(job({path:'Proyectos/b.md'}),l,v),/ID reutilizado/);a.equal(v.files.size,1);});
test('fallo al crear no confirma entrega',async()=>{const l={};await a.rejects(c.deliver(job(),l,{read:async()=>null,create:async()=>{throw Error('offline');}}));a.equal(Object.keys(l).length,0);});
test('no recrea nota borrada después de entrega confirmada',async()=>{const v=vault(),l={};await c.deliver(job(),l,v);v.files.clear();a.equal(await c.deliver(job(),l,v),'duplicada');a.equal(v.files.size,0);});
test('carrera entre existencia y creación nunca sobrescribe',async()=>{const l={};let local='local';await a.rejects(c.deliver(job(),l,{read:async()=>null,create:async()=>{throw Error('exists');}}));a.equal(local,'local');a.equal(Object.keys(l).length,0);});


test('bóveda completa permite raíz y subcarpetas sin exponer configuración ni rutas inseguras',()=>{
 for(const path of ['Nota.md','Cartera/Nota.md','Árbol/Sub/Nota.md'])a.equal(c.allowed(path,['*'],'.config'),true);
 a.equal(c.allowed('config/secret.md',['*'],'config'),false);
 for(const path of ['../fuera.md','/absoluta.md','.obsidian/secret.md','Cartera/../fuera.md'])a.throws(()=>c.parseJob(JSON.stringify({version:1,id:'scope',path,content:'x'}),['*'],'.config'));
 a.equal(c.allowed('Cartera/Nota.md',['ChatGPT Inbox'],'.obsidian'),false);
});

test('la carpeta de configuración se protege por coincidencia exacta y por prefijo',()=>{
 a.equal(c.allowed('config.md',['*'],'config.md'),false);
 a.equal(c.allowed('Config/Sub/x.md',['*'],'config/sub'),false);
 a.equal(c.allowed('configuracion/x.md',['*'],'config'),true);
 a.throws(()=>c.parseJob(JSON.stringify(job({path:'config.md'})),['*'],'config.md'),/Ruta fuera de la lista permitida/);
});

test('el contenido con un identificador reservado se rechaza',()=>{
 a.throws(()=>c.parseJob(JSON.stringify(job({content:'<!-- chatgpt-inbox-note:'+'a'.repeat(64)+' -->'})),roots,'.obsidian'),/reservado/);
 a.throws(()=>c.parseJob(JSON.stringify(job({content:'texto\n<!-- chatgpt-inbox-note:zz -->'})),roots,'.obsidian'),/reservado/);
});

test('el sobre se valida sin el ámbito y el ámbito se exige aparte',()=>{
 const raw=JSON.stringify(job({path:'Proyectos-extra/a.md'}));
 // The envelope only checks structure, size, safe path and the config folder.
 a.equal(c.parseEnvelope(raw,'.obsidian').path,'Proyectos-extra/a.md');
 // The folder scope is a separate, explicit authorization step.
 a.throws(()=>c.parseJob(raw,roots,'.obsidian'),/Ruta fuera de la lista permitida/);
 a.throws(()=>c.authorize('Proyectos-extra/a.md',roots,'.obsidian'),/Ruta fuera de la lista permitida/);
 a.doesNotThrow(()=>c.authorize('ChatGPT Inbox/a.md',roots,'.obsidian'));
 a.throws(()=>c.parseEnvelope(JSON.stringify(job({path:'ChatGPT Inbox/a.md'})),'ChatGPT Inbox'),/Ruta fuera de la lista permitida/);
});

test('SHA-256 portable coincide con los vectores oficiales y con WebCrypto',async()=>{
 a.equal(c.sha256Hex(''),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
 a.equal(c.sha256Hex('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 a.equal(c.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),'248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
 for(const text of['','abc','ñ'.repeat(1000),'x'.repeat(5000)])a.equal(await c.digest(text),c.sha256Hex(text));
 // Without a secure context WebCrypto is unavailable: delivery must still work.
 const real=globalThis.crypto.subtle;Object.defineProperty(globalThis.crypto,'subtle',{value:undefined,configurable:true});
 try{a.equal(await c.digest('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');}
 finally{Object.defineProperty(globalThis.crypto,'subtle',{value:real,configurable:true});}
});

test('el identificador de secreto solo admite minúsculas, números y guiones',()=>{
 a.equal(c.secretId(' chatgpt-inbox-relay '),'chatgpt-inbox-relay');
 for(const bad of['','ChatGPT Inbox','con espacio','guion_guajo','acentúado'])a.throws(()=>c.secretId(bad),/minúsculas/);
 a.ok(/^[a-z0-9-]+$/.test(c.secretId('chatgpt-inbox-'+c.randomToken())));
});

test('el token aleatorio tiene forma de identificador utilizable',()=>{
 const token=c.randomToken();a.match(token,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
 a.notEqual(token,c.randomToken());
});

test('sin fuente aleatoria segura se rechaza generar identificadores',()=>{
 const vm=require('node:vm'),fs=require('node:fs');const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('./core.cjs'),'utf8'),{module:mod,exports:mod.exports,TextEncoder,Uint8Array});
 a.throws(()=>mod.exports.randomToken(),/aleatorio seguro/);
});

test('sobres JSON primitivos, arrays y campos no tipados se rechazan',()=>{
 for(const value of [null,1,[],{version:1,id:'x',path:23,content:'text'},{version:1,id:'x',path:'Allowed/a.md',content:[] }])a.throws(()=>c.parseJob(JSON.stringify(value),['Allowed'],'.obsidian'));
});

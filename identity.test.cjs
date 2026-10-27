const {test}=require('node:test');const a=require('node:assert/strict');const {digest}=require('./core.cjs');const {locateIdentity,stamp,stripIdentity,noteIdentity}=require('./identity.cjs');
function files(map){return {files:Object.keys(map).map(path=>({path})),read:async f=>map[f.path]};}
test('identidad abre nota movida, renombrada y editada sin eventos ni ruta actual',async()=>{
 const id=await noteIdentity('one');const f=files({'Otro directorio/Nuevo nombre.md':stamp('Contenido editado',id)});
 a.equal((await locateIdentity({path:'Original.md',noteId:id},f.files,f.read)).path,'Otro directorio/Nuevo nombre.md');
});
test('no abre un archivo ajeno que ocupa la ruta antigua',async()=>{
 const id=await noteIdentity('one');const f=files({'Original.md':'texto ajeno','Movida.md':stamp('editada',id)});
 a.equal((await locateIdentity({path:'Original.md',noteId:id},f.files,f.read)).path,'Movida.md');
});
test('reinicio: identidad persiste serializada y sigue localizando tras edición',async()=>{
 const id=await noteIdentity('restart');const entry=JSON.parse(JSON.stringify({path:'a.md',noteId:id}));const f=files({'b.md':stamp('editada después',id)});a.equal((await locateIdentity(entry,f.files,f.read)).path,'b.md');
});
test('copias con la misma identidad se bloquean para no abrir una al azar',async()=>{
 const id=await noteIdentity('copy');const f=files({'a.md':stamp('a',id),'b.md':stamp('b',id)});await a.rejects(locateIdentity({noteId:id},f.files,f.read),/varias copias/);
});
test('recupera nota antigua movida por huella original sin modificarla',async()=>{
 const hash=await digest(JSON.stringify(['Original.md','texto original']));const f=files({'Otra/Nueva.md':'texto original'});a.equal((await locateIdentity({path:'Original.md',legacyHash:hash},f.files,f.read)).path,'Otra/Nueva.md');
});
test('contenido igual con otra identidad no se confunde',async()=>{
 const f=files({'otra.md':stamp('igual',await noteIdentity('other'))});await a.rejects(locateIdentity({noteId:await noteIdentity('wanted'),contentHash:await digest('igual')},f.files,f.read),/No se encuentra/);
});
test('nota borrada no crea nada ni abre un sustituto',async()=>{await a.rejects(locateIdentity({noteId:await noteIdentity('deleted')},[],async()=>''),/No se encuentra/);});
test('comentario añadido se retira exactamente para deduplicar',async()=>{for(const text of ['hola','hola\n','hola\n\n',''])a.equal(stripIdentity(stamp(text,'a'.repeat(64))),text);});
test('notas antiguas editadas sin identidad no se adivinan',async()=>{const f=files({'a.md':'otro texto'});await a.rejects(locateIdentity({contentHash:await digest('original')},f.files,f.read),/No se encuentra/);});


test('recuperación con ledger antiguo exige identidad y contenido originales y no crea archivos',async()=>{
 const {recoverDelivery,noteIdentity,stamp}=require('./identity.cjs');
 const job={version:1,id:'recovery-1',path:'Cartera/Nota.md',content:'original'};
 const id=await noteIdentity(job.id),ledger=Object.create(null),roots=['Cartera'];
 a.equal(await recoverDelivery(job,ledger,async()=>stamp(job.content,id),roots,'.obsidian'),true);
 a.ok(ledger[job.id]);a.equal(await recoverDelivery(job,ledger,async()=>{throw Error('No debería leer una entrega registrada');},roots,'.obsidian'),true);
 await a.rejects(recoverDelivery({...job,content:'ID reutilizado'},ledger,async()=>null,roots,'.obsidian'),/reutilizado/);
 for(const existing of [null,job.content,stamp(job.content,'a'.repeat(64)),stamp('editado',id),stamp(stamp(job.content,id),id)]){
  const old=Object.create(null);a.equal(await recoverDelivery(job,old,async()=>existing,roots,'.obsidian'),false);a.equal(Object.keys(old).length,0);
 }
});

test('la recuperación nunca lee una ruta fuera de las carpetas permitidas',async()=>{
 const {recoverDelivery,noteIdentity,stamp}=require('./identity.cjs');
 const job={version:1,id:'recovery-scope',path:'Privado/Nota.md',content:'secreto'};
 let read=false;const ledger=Object.create(null);
 // The destination is outside the authorized scope: it must be rejected before
 // the vault is opened, and the ledger must stay untouched.
 await a.rejects(recoverDelivery(job,ledger,async()=>{read=true;return stamp(job.content,await noteIdentity(job.id));},['Cartera'],'.obsidian'),/Ruta fuera de la lista permitida/);
 a.equal(read,false);a.deepEqual(Object.keys(ledger),[]);
 // A recorded delivery is recognised from the ledger without opening the vault.
 const known={version:1,id:'known',path:'Privado/Nota.md',content:'secreto'};
 const done=Object.create(null);await recoverDelivery(known,done,async()=>{read=true;return null;},['Cartera'],'.obsidian').catch(()=>{});
 a.equal(read,false);
});

test('dos identidades distintas en la misma nota invalidan la recuperación',async()=>{
 const {recoverDelivery,noteIdentity,stamp}=require('./identity.cjs');
 const job={version:1,id:'two-markers',path:'Cartera/Nota.md',content:'original'};
 const both=stamp(stamp(job.content,await noteIdentity(job.id)),'b'.repeat(64));
 const ledger=Object.create(null);
 a.equal(await recoverDelivery(job,ledger,async()=>both,['Cartera'],'.obsidian'),false);
 a.deepEqual(Object.keys(ledger),[]);
});

test('la huella original se comprueba contra la ruta original de la entrega',async()=>{
 const {locateIdentity}=require('./identity.cjs');const {digest}=require('./core.cjs');
 const hash=await digest(JSON.stringify(['Carpeta/Origen.md','texto']));
 const f=files({'Otra/Nueva.md':'texto'});
 a.equal((await locateIdentity({path:'Otra/Nueva.md',originalPath:'Carpeta/Origen.md',legacyHash:hash},f.files,f.read)).path,'Otra/Nueva.md');
});

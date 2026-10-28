const {test}=require('node:test');const a=require('node:assert/strict');
const {withDeadline,ReceptionError,retryDelay,historyPresentation,failureText}=require('./reception.cjs');
test('un timeout libera la espera y una respuesta tardía no ejecuta continuaciones',async()=>{
 let expire,complete,continued=false,cleared=0;
 const pending=new Promise(resolve=>complete=resolve);
 const result=withDeadline(pending,20,{setTimeout:callback=>{expire=callback;return 1;},clearTimeout:()=>cleared++}).then(()=>continued=true);
 expire();await a.rejects(result,error=>error instanceof ReceptionError&&error.code==='timeout');
 complete('late');await new Promise(resolve=>setImmediate(resolve));a.equal(continued,false);a.equal(cleared,1);
});
test('respuestas tempranas cancelan el timer y errores mantienen un tipo seguro',async()=>{
 let cleared=0;const timers={setTimeout:()=>1,clearTimeout:()=>cleared++};
 a.equal(await withDeadline(Promise.resolve(4),20,timers),4);
 await a.rejects(withDeadline(Promise.reject('private network error'),20,timers),ReceptionError);a.equal(cleared,2);
});
test('reintentos automáticos crecen de un minuto hasta un máximo de quince',()=>{
 a.deepEqual([1,2,3,4,5,10].map(retryDelay),[60000,120000,240000,480000,900000,900000]);
});
test('una nota local sin recibo no se presenta como entregada ni como conflicto',()=>{
 a.equal(historyPresentation('Guardada sin recibo').label,'Esperando confirmación');a.match(historyPresentation('Guardada sin recibo').help,/sin duplicarla/);
 a.equal(historyPresentation('Importada').label,'Entregada');a.match(historyPresentation('Conflicto',true).help,/Falta comunicar/);
 a.equal(historyPresentation('Bloqueada').label,'Requiere revisión');
});
test('mensajes distinguen autorización pendiente y relay antiguo sin exponer respuestas',()=>{
 a.match(failureText('pairing-pending'),/falta autorizar/);a.match(failureText('relay-update'),/recepción normal sigue disponible/);
});
test('suspender libera inmediatamente la espera y quita su timer aunque el socket siga abierto',async()=>{
 let complete,cleared=0;const controller=new AbortController();const pending=new Promise(resolve=>complete=resolve);
 const result=withDeadline(pending,20000,{setTimeout:()=>1,clearTimeout:()=>cleared++},controller.signal);
 controller.abort(new ReceptionError('background'));await a.rejects(result,error=>error.code==='background');a.equal(cleared,1);
 complete('late');await new Promise(resolve=>setImmediate(resolve));
});

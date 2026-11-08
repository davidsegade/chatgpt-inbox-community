'use strict';
const OP_TAG=/\n?<!-- chatgpt-inbox-op:([a-f0-9]{64}):([a-f0-9]{64}) -->\n?/g;
function clean(text){
 const suffix=/\n(?:(?:<!-- chatgpt-inbox-note:[a-f0-9]{64} -->|<!-- chatgpt-inbox-op:[a-f0-9]{64}:[a-f0-9]{64} -->)\n?)+$/;
 return text.replace(suffix,'').replace(/\n?<!-- chatgpt-inbox-note:([a-f0-9]{64}) -->\n?/g,'').replace(OP_TAG,'');
}
async function sha(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function parse(raw,roots,configDir,safePath,allowed){
 const j=JSON.parse(raw);
 if(!j||j.version!==2||!['update','trash'].includes(j.operation)||typeof j.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(j.id)||typeof j.expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(j.expectedHash))throw Error('Solicitud de cambio no válida');
 const keys=['version','id','operation','path','expectedHash',...(j.operation==='update'?['content']:[])];
 if(Object.keys(j).some(k=>!keys.includes(k))||keys.some(k=>!Object.prototype.hasOwnProperty.call(j,k)))throw Error('Campos de cambio no válidos');
 if(j.operation==='update'&&(typeof j.content!=='string'||j.content.includes('<!-- chatgpt-inbox-')))throw Error('Contenido de edición no válido');
 safePath(j.path);if(!allowed(j.path,roots,configDir))throw Error('Ruta fuera de la lista permitida');
 return j;
}
async function execute(j,ledger,driver,save,hashText=sha){
 const hash=await hashText(JSON.stringify([j.version,j.id,j.operation,j.path,j.expectedHash,j.content??null]));
 const previous=Object.prototype.hasOwnProperty.call(ledger,j.id)?ledger[j.id]:null;
 if(previous&&previous.hash!==hash)throw Error('ID reutilizado con otra operación');
 if(previous?.state==='applied'||previous?.state==='conflict')return {...previous,replayed:true};
 const opId=await hashText(j.id),basename=j.path.split('/').pop();
 const backupPath=`.trash/chatgpt-inbox/${j.operation}/${opId}/${basename}`;
 const marker=`<!-- chatgpt-inbox-op:${opId}:${hash} -->`;
 const finish=async(state,detail)=>{const r={hash,state,operation:j.operation,path:j.path,backupPath,time:Date.now(),detail};ledger[j.id]=r;await save();return r;};
 const raw=await driver.read(j.path);
 const backup=await driver.read(backupPath);
 if(j.operation==='update'&&raw?.includes(marker))return finish('applied','Edición ya aplicada; recuperado el recibo.');
 if(j.operation==='trash'&&raw===null&&backup!==null&&await hashText(clean(backup))===j.expectedHash)return finish('applied','Nota encontrada en la papelera; recuperado el recibo.');
 if(raw===null)return finish('conflict','No se encuentra la nota en la ruta indicada. No se modifica nada.');
 if(await hashText(clean(raw))!==j.expectedHash)return finish('conflict','La nota ha cambiado desde la solicitud. Se conserva la versión actual.');
 ledger[j.id]={hash,state:'pending',operation:j.operation,path:j.path,backupPath,time:Date.now()};await save();
 if(backup!==null&&backup!==raw)return finish('conflict','Existe otra copia en el destino de recuperación. No se modifica nada.');
 if(j.operation==='update'){
  if(backup===null)await driver.backup(backupPath,raw);
  const identities=[...raw.matchAll(/<!-- chatgpt-inbox-note:[a-f0-9]{64} -->/g)].map(m=>m[0]);
  const operations=[...raw.matchAll(/<!-- chatgpt-inbox-op:[a-f0-9]{64}:[a-f0-9]{64} -->/g)].map(m=>m[0]);
  const next=j.content+'\n'+[...identities,...operations,marker].join('\n')+'\n';
  const ok=await driver.compareAndUpdate(j.path,raw,next);
  if(!ok)return finish('conflict','La nota cambió durante la edición. Se conserva la versión actual.');
 }else{
  if(backup!==null)return finish('conflict','La nota y su copia de papelera existen a la vez. No se elimina ninguna.');
  const ok=await driver.compareAndTrash(j.path,raw,backupPath);
  if(!ok)return finish('conflict','La nota cambió antes de moverla a la papelera. Se conserva.');
 }
 return finish('applied',j.operation==='update'?'Nota actualizada; copia anterior guardada en la papelera.':'Nota movida a la papelera recuperable.');
}
module.exports={clean,sha,parse,execute};

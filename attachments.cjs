'use strict';
const MAX_TOTAL=20*1024*1024,MAX_CHUNK=256*1024,MAX_FILES=32;
async function hashBytes(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function parse(raw,roots,configDir,safePath,allowed){
 const j=JSON.parse(raw),exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(o,k));
 if(!j||j.version!==3||j.operation!=='attachments'||typeof j.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(j.id))throw Error('Solicitud de adjuntos no válida');
 if(!exact(j,['version','id','operation','files',...(Object.prototype.hasOwnProperty.call(j,'note')?['note']:[])]))throw Error('Campos de adjuntos no válidos');
 if(!Array.isArray(j.files)||j.files.length<1||j.files.length>MAX_FILES)throw Error('Se permiten de 1 a 32 adjuntos por solicitud');
 let total=0;const paths=new Set();
 const checkPath=(p,markdown=false)=>{safePath(p,markdown);if(!allowed(p,roots,configDir,markdown))throw Error('Carpeta de adjunto no autorizada');const key=p.toLocaleLowerCase();if(paths.has(key))throw Error('Destinos repetidos');paths.add(key);};
 for(const f of j.files){
  if(!exact(f,['path','size','sha256','chunks'])||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_TOTAL||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||!Array.isArray(f.chunks)||f.chunks.length>Math.ceil(MAX_TOTAL/MAX_CHUNK))throw Error('Adjunto no válido o demasiado grande');
  checkPath(f.path);total+=f.size;let size=0;
  for(const c of f.chunks){if(!exact(c,['sha','size'])||typeof c.sha!=='string'||!/^[a-f0-9]{40}$/.test(c.sha)||!Number.isSafeInteger(c.size)||c.size<1||c.size>MAX_CHUNK)throw Error('Fragmento de adjunto no válido');size+=c.size;}
  if(size!==f.size)throw Error('El tamaño de los fragmentos no coincide');
 }
 if(total>MAX_TOTAL)throw Error('Máximo 20 MiB de adjuntos por solicitud');
 if(j.note){if(!exact(j.note,['path','content'])||typeof j.note.content!=='string'||j.note.content.includes('<!-- chatgpt-inbox-'))throw Error('Nota de adjuntos no válida');checkPath(j.note.path,true);}
 return j;
}
async function execute(j,ledger,driver,save,clean,stamp,noteIdentity,hashData=hashBytes){
 const hash=await hashData(new TextEncoder().encode(JSON.stringify(j)));
 const previous=Object.prototype.hasOwnProperty.call(ledger,j.id)?ledger[j.id]:null;
 if(previous&&previous.hash!==hash)throw Error('ID de adjuntos reutilizado con otro contenido');
 if(previous&&['applied','conflict'].includes(previous.state))return {...previous,replayed:true};
 const finish=async(state,detail)=>{const r={hash,state,time:Date.now(),files:j.files.map(f=>({path:f.path,size:f.size,sha256:f.sha256})),notePath:j.note?.path,detail};ledger[j.id]=r;await save();return r;};
 ledger[j.id]={hash,state:'pending',time:Date.now()};await save();
 for(const f of j.files){
  const existing=await driver.read(f.path);
  if(existing!==null){if(existing.byteLength!==f.size||await hashData(existing)!==f.sha256)return finish('conflict','Ya existe un archivo diferente en '+f.path);continue;}
  const data=new Uint8Array(f.size);let offset=0;
  for(const chunk of f.chunks){const part=await driver.download(chunk);if(!(part instanceof Uint8Array)||part.byteLength!==chunk.size)throw Error('Descarga incompleta de un adjunto');data.set(part,offset);offset+=part.byteLength;}
  if(await hashData(data)!==f.sha256)throw Error('El adjunto descargado no coincide con su huella');
  try{await driver.create(f.path,data);}catch(e){const raced=await driver.read(f.path);if(raced===null||raced.byteLength!==f.size||await hashData(raced)!==f.sha256)throw e;}
  const written=await driver.read(f.path);if(written===null||written.byteLength!==f.size||await hashData(written)!==f.sha256)throw Error('No se pudo verificar el adjunto guardado');
 }
 if(j.note){
  const existing=await driver.readNote(j.note.path);
  if(existing!==null&&clean(existing)!==j.note.content)return finish('conflict','Los adjuntos están guardados, pero la nota de destino ya contiene otro texto.');
  if(existing===null){const text=stamp(j.note.content,await noteIdentity(j.id));try{await driver.createNote(j.note.path,text);}catch(e){const raced=await driver.readNote(j.note.path);if(raced===null||clean(raced)!==j.note.content)throw e;}}
 }
 return finish('applied','Adjuntos recibidos y verificados'+(j.note?'; nota con enlaces creada.':'.'));
}
module.exports={MAX_TOTAL,MAX_CHUNK,MAX_FILES,hashBytes,parse,execute};

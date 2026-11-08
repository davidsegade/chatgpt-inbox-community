import {App,TFile,TFolder} from 'obsidian';
import {isRecord,safePath,sha256Bytes} from './core';
import {MutationDriver,MutationReceipt} from './operations.cjs';
import {AttachmentDriver,AttachmentReceipt,MAX_CHUNK} from './attachments.cjs';
export type Guard=(path:string,markdown?:boolean)=>void;
export function loadMutationReceipts(input:unknown):Record<string,MutationReceipt>{
 const out:Record<string,MutationReceipt>=Object.create(null) as Record<string,MutationReceipt>;
 if(!isRecord(input))return out;
 for(const [id,r] of Object.entries(input)){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!isRecord(r)||typeof r.hash!=='string'||!/^[a-f0-9]{64}$/.test(r.hash)||(r.state!=='pending'&&r.state!=='applied'&&r.state!=='conflict')||(r.operation!=='update'&&r.operation!=='trash')||typeof r.path!=='string'||typeof r.backupPath!=='string'||typeof r.time!=='number'||!Number.isFinite(r.time))continue;
  out[id]={hash:r.hash,state:r.state,operation:r.operation,path:r.path,backupPath:r.backupPath,time:r.time,...(typeof r.detail==='string'?{detail:r.detail}:{})};
 }return out;
}
export function loadAttachmentReceipts(input:unknown):Record<string,AttachmentReceipt>{
 const out:Record<string,AttachmentReceipt>=Object.create(null) as Record<string,AttachmentReceipt>;
 if(!isRecord(input))return out;
 for(const [id,r] of Object.entries(input)){
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!isRecord(r)||typeof r.hash!=='string'||!/^[a-f0-9]{64}$/.test(r.hash)||(r.state!=='pending'&&r.state!=='applied'&&r.state!=='conflict')||typeof r.time!=='number'||!Number.isFinite(r.time))continue;
  out[id]={hash:r.hash,state:r.state,time:r.time,...(typeof r.notePath==='string'?{notePath:r.notePath}:{}),...(typeof r.detail==='string'?{detail:r.detail}:{})};
 }return out;
}
async function parents(app:App,path:string,guard:()=>void,hidden=false){
 const parts=path.split('/');parts.pop();let folder='';
 for(const part of parts){guard();folder=folder?folder+'/'+part:part;
  if(hidden){if(!await app.vault.adapter.exists(folder)){try{await app.vault.adapter.mkdir(folder);}catch(e){if(!await app.vault.adapter.exists(folder))throw e;}}}
  else{const old=app.vault.getAbstractFileByPath(folder);if(old&&!(old instanceof TFolder))throw Error('Una carpeta es un archivo');if(!old){try{await app.vault.createFolder(folder);}catch(e){if(!(app.vault.getAbstractFileByPath(folder) instanceof TFolder))throw e;}}}
 }
}
export function mutationDriver(app:App,target:string,guard:Guard):MutationDriver{
 const vault=app.vault;
 const protect=()=>guard(target);
 return {
  read:async path=>{protect();if(path.startsWith('.trash/chatgpt-inbox/'))return await vault.adapter.exists(path)?vault.adapter.read(path):null;guard(path);const file=vault.getAbstractFileByPath(path);if(!file)return null;if(!(file instanceof TFile))throw Error('El destino no es una nota');return vault.read(file);},
  backup:async(path,raw)=>{protect();await parents(app,path,protect,true);protect();if(await vault.adapter.exists(path)){if(await vault.adapter.read(path)!==raw)throw Error('Conflicto en copia de recuperación');return;}protect();await vault.adapter.write(path,raw);},
  compareAndUpdate:async(path,expected,next)=>{guard(path);const file=vault.getAbstractFileByPath(path);if(!(file instanceof TFile))return false;let matched=false;await vault.process(file,current=>{guard(path);if(file.path!==path||current!==expected)return current;matched=true;return next;});return matched;},
  compareAndTrash:async(path,expected,destination)=>{guard(path);await parents(app,destination,protect,true);guard(path);const file=vault.getAbstractFileByPath(path);if(!(file instanceof TFile)||await vault.read(file)!==expected)return false;if(await vault.adapter.exists(destination))throw Error('Destino de papelera ocupado');guard(path);if(file.path!==path||await vault.read(file)!==expected)return false;guard(path);if(file.path!==path)return false;await vault.rename(file,destination);return true;}
 };
}
export function attachmentDriver(app:App,guard:Guard,getBlob:(sha:string)=>Promise<unknown>):AttachmentDriver{
 const vault=app.vault;
 return {
  read:async path=>{guard(path,false);const f=vault.getAbstractFileByPath(path);if(!f)return null;if(!(f instanceof TFile))throw Error('Destino de adjunto ocupado');return new Uint8Array(await vault.readBinary(f));},
  create:async(path,data)=>{guard(path,false);await parents(app,path,()=>guard(path,false));guard(path,false);const copy=new Uint8Array(data.byteLength);copy.set(data);await vault.createBinary(path,copy.buffer);},
  download:async chunk=>{const b=await getBlob(chunk.sha);if(!isRecord(b)||b.encoding!=='base64'||b.size!==chunk.size||typeof b.content!=='string'||b.content.length>MAX_CHUNK*2)throw Error('Fragmento de adjunto inválido');const encoded=b.content.replace(/\s/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw Error('Codificación de adjunto inválida');return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));},
  readNote:async path=>{guard(path);const f=vault.getAbstractFileByPath(path);if(!f)return null;if(!(f instanceof TFile))throw Error('Destino de nota ocupado');return vault.read(f);},
  createNote:async(path,text)=>{guard(path);await parents(app,path,()=>guard(path));guard(path);await vault.create(path,text);}
 };
}
export async function hashData(data:Uint8Array){return sha256Bytes(data);}
export interface RestoreEntry {path?:string;originalPath?:string;backupPath?:string;restoredPath?:string}
export async function restoreCopy(app:App,entry:RestoreEntry,guard:Guard,clean:(s:string)=>string,persist:()=>Promise<void>){
 const path=entry.originalPath??entry.path;if(!path||!entry.backupPath||!/^\.trash\/chatgpt-inbox\/(?:update|trash)\/[a-f0-9]{64}\/[^/]+\.md$/.test(entry.backupPath))throw Error('No hay copia recuperable');safePath(path);guard(path);
 if(entry.restoredPath){guard(entry.restoredPath);const existing=app.vault.getAbstractFileByPath(entry.restoredPath);if(existing instanceof TFile)return existing;}
 if(!await app.vault.adapter.exists(entry.backupPath))throw Error('La copia ya no está en la papelera');const raw=await app.vault.adapter.read(entry.backupPath);let destination=path;
 if(app.vault.getAbstractFileByPath(path)){const slash=path.lastIndexOf('/'),parent=slash<0?'':path.slice(0,slash+1),name=path.slice(slash+1,-3).slice(0,45);let n=1;do{destination=parent+name+' (recuperada '+n+++').md';}while(app.vault.getAbstractFileByPath(destination));}
 safePath(destination);guard(destination);await parents(app,destination,()=>guard(destination));guard(destination);const file=await app.vault.create(destination,clean(raw));entry.restoredPath=destination;await persist();return file;
}

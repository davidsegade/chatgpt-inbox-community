import {authorize,digest,Job,Ledger,LocalVault} from './core';
export interface IdentityEntry {path?:string; noteId?:string; contentHash?:string; legacyHash?:string; originalPath?:string}
const tag=/\n?<!-- chatgpt-inbox-note:([a-f0-9]{64}) -->\n?/g;
export function stripIdentity(text:string){return text.replace(tag,'');}
export function markers(text:string):string[]{return [...text.matchAll(/<!-- chatgpt-inbox-note:([a-f0-9]{64}) -->/g)].map(m=>m[1]);}
export async function noteIdentity(id:string){return digest('chatgpt-inbox:v1:'+id);}
export function stamp(text:string,id:string){return text+`\n<!-- chatgpt-inbox-note:${id} -->\n`;}
export interface Candidate {path:string}
export async function locateIdentity<T extends Candidate>(entry:IdentityEntry,files:T[],read:(file:T)=>Promise<string>):Promise<T>{
  const identified:T[]=[],legacy:T[]=[];
  for(const file of files){
    const text=await read(file);
    if(entry.noteId&&markers(text).includes(entry.noteId)){identified.push(file);continue;}
    // Never bind a different identity merely because its prose is identical.
    if(markers(text).length)continue;
    if(entry.contentHash&&await digest(text)===entry.contentHash)legacy.push(file);
    else if(entry.legacyHash&&await digest(JSON.stringify([entry.originalPath??entry.path,text]))===entry.legacyHash)legacy.push(file);
  }
  const matches=identified.length?identified:legacy;
  if(matches.length>1)throw Error('Hay varias copias de esta nota. No se abrirá una al azar.');
  if(!matches.length)throw Error('No se encuentra esta nota. Puede haberse borrado o ser una nota antigua editada antes de tener identidad.');
  return matches[0];
}

// A stale data.json from another device must not turn a verified delivery back
// into a write request. Recovery only reads; it never grants permission to create.
// A recorded delivery is recognised from the ledger without touching the vault,
// but recovering a lost ledger entry needs the expected identity, the exact
// original content and a destination inside the authorized scope: recovery must
// never widen the folder permissions to read a note the user did not authorize.
export async function recoverDelivery(job:Job,ledger:Ledger,read:LocalVault['read'],roots:string[],configDir:string):Promise<boolean>{
  const hash=await digest(JSON.stringify([job.path,job.content]));
  const previous=Object.prototype.hasOwnProperty.call(ledger,job.id)?ledger[job.id]:undefined;
  if(previous){if(previous!==hash)throw Error('ID reutilizado con contenido distinto');return true;}
  authorize(job.path,roots,configDir);
  const existing=await read(job.path);
  if(existing===null)return false;
  const ids=markers(existing);
  if(ids.length!==1||ids[0]!==await noteIdentity(job.id)||stripIdentity(existing)!==job.content)return false;
  ledger[job.id]=hash;
  return true;
}

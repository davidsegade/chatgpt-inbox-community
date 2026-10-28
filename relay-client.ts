import {authorize,deliver,parseEnvelope,parseJob,Ledger,LocalVault,Job} from './core';
export function relayOrigin(value:string){const u=new URL(value);if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('Usa una URL HTTPS del relay (HTTP solo en localhost).');return u.origin;}
export async function receiveRelay(jobs:unknown,roots:string[],configDir:string,ledger:Ledger,vault:LocalVault,persist:()=>Promise<void>,ack:(id:string,state:string)=>Promise<void>,recover?:(job:Job)=>Promise<boolean>){
  if(!Array.isArray(jobs)||jobs.length>10)throw Error('Respuesta del relay inválida');
  for(const raw of jobs){
   // The envelope is validated before anything is read and the folder scope is
   // enforced before any write. The recovery callback applies the same scope to
   // its own read, so an unauthorized destination is never opened.
   const job=parseEnvelope(JSON.stringify(raw),configDir);
   authorize(job.path,roots,configDir);
   const recovered=recover?await recover(job):false;
   if(!recovered)authorize(job.path,roots,configDir);
   const result=recovered?'duplicada':await deliver(job,ledger,vault);const conflict=result.startsWith('conflicto');
   // Persist deduplication before acknowledging. On retries verify the actual file,
   // since a previous delivery may have been deleted or edited by the user.
   if(!conflict&&(await vault.read(job.path))!==job.content)throw Error('No se pudo verificar la nota escrita');
   await persist();await ack(job.id,conflict?'conflict':'delivered');
  }
}
export function liteURI(vault:string,folder:string,title:string,content:string,configDir=''){
  const path=`${folder}/${title.normalize('NFC').replace(/\.md$/,'')}`;
  parseJob(JSON.stringify({version:1,id:'lite',path:path+'.md',content}),[folder],configDir);
  if(title.includes('/')||title.includes('\\'))throw Error('Título inválido');
  const uri=`obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path)}&content=${encodeURIComponent(content)}`;
  if(uri.length>8000)throw Error('Enlace demasiado largo para Lite; usa relay o guarda un archivo Markdown.');return uri;
}

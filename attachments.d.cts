export interface AttachmentFile {path:string;size:number;sha256:string;chunks:{sha:string;size:number}[]}
export interface AttachmentJob {version:3;id:string;operation:'attachments';files:AttachmentFile[];note?:{path:string;content:string}}
export interface AttachmentReceipt {hash:string;state:'pending'|'applied'|'conflict';time:number;files?:{path:string;size:number;sha256:string}[];notePath?:string;detail?:string;replayed?:boolean}
export interface AttachmentDriver {read(path:string):Promise<Uint8Array|null>;create(path:string,data:Uint8Array):Promise<void>;download(chunk:{sha:string;size:number}):Promise<Uint8Array>;readNote(path:string):Promise<string|null>;createNote(path:string,text:string):Promise<void>}
export const MAX_CHUNK:number;
export function parse(raw:string,roots:string[],configDir:string,safePath:(value:unknown,markdown?:boolean)=>string,allowed:(path:string,roots:string[],configDir:string,markdown?:boolean)=>boolean):AttachmentJob;
export function execute(job:AttachmentJob,ledger:Record<string,AttachmentReceipt>,driver:AttachmentDriver,save:()=>Promise<void>,clean:(s:string)=>string,stamp:(s:string,id:string)=>string,noteIdentity:(id:string)=>Promise<string>,hashData?:(data:Uint8Array)=>Promise<string>):Promise<AttachmentReceipt>;

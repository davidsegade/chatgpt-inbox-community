export type MutationJob={version:2;id:string;path:string;expectedHash:string}&({operation:'update';content:string}|{operation:'trash'});
export interface MutationReceipt {hash:string;state:'pending'|'applied'|'conflict';operation:'update'|'trash';path:string;backupPath:string;time:number;detail?:string;replayed?:boolean}
export interface MutationDriver {read(path:string):Promise<string|null>;backup(path:string,raw:string):Promise<void>;compareAndUpdate(path:string,expected:string,next:string):Promise<boolean>;compareAndTrash(path:string,expected:string,destination:string):Promise<boolean>}
export function parse(raw:string,roots:string[],configDir:string,safePath:(value:unknown,markdown?:boolean)=>string,allowed:(path:string,roots:string[],configDir:string,markdown?:boolean)=>boolean):MutationJob;
export function execute(job:MutationJob,ledger:Record<string,MutationReceipt>,driver:MutationDriver,save:()=>Promise<void>,hashText?:(text:string)=>Promise<string>):Promise<MutationReceipt>;
export function clean(text:string):string;

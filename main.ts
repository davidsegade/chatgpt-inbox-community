import {ReceptionError,failureText,retryDelay,withDeadline,FailureCode} from './reception';
import {Plugin,PluginSettingTab,SecretComponent,Notice,requestUrl,TFile,TFolder,SettingDefinitionItem,apiVersion} from 'obsidian';
import {SetupModal,InboxModal,InstructionsModal,DiagnosticsModal,folderDefinitions} from './ui';
import {allowed,MAX_BYTES,bytes,safePath,parseEnvelope,deliver,Ledger,digest,randomToken,secretId,authorize,isRecord,Job,inConfigDir,CONNECTION_TEST_CONTENT} from './core';
import {noteIdentity,stamp,stripIdentity,locateIdentity,recoverDelivery,markers} from './identity';
import {sourcePath,inboxPath} from './source';
import {relayOrigin,receiveRelay} from './relay-client';
interface Settings { enabled:boolean; wholeVault:boolean; defaultFolder:string; roots:string[]; secret:string; interval:number; repository:string; branch:string; transport: string; relay:string; relaySecret:string; boundRelay:string; boundRelaySecret:string }
const defaults:Settings={enabled:false,wholeVault:false,defaultFolder:'ChatGPT Inbox',roots:['ChatGPT Inbox'],secret:'chatgpt-inbox-community-github-read',interval:120,repository:'',branch:'main',transport:'relay',relay:'',relaySecret:'chatgpt-inbox-community-relay',boundRelay:'',boundRelaySecret:''};
export interface DeliveryTest {key:string;path:string;relay:string;secret:string;state:string;id?:string}
export interface HistoryEntry {receiptPending?:boolean; source:string; path?:string; state:string; detail?:string; time:number; noteId?:string; contentHash?:string; legacyHash?:string; originalPath?:string }

function isHistoryEntry(value:unknown):value is HistoryEntry {
  if(!isRecord(value)||typeof value.source!=='string'||typeof value.state!=='string'||typeof value.time!=='number'||!Number.isFinite(value.time))return false;
  if(value.receiptPending!==undefined&&typeof value.receiptPending!=='boolean')return false;
  return ['path','detail','noteId','contentHash','legacyHash','originalPath'].every(key=>value[key]===undefined||typeof value[key]==='string');
}
function relayJobs(value:unknown,configDir:string):Job[]{
  if(!Array.isArray(value)||value.length>10)throw Error('Respuesta del relay inválida');
  return value.map((job:unknown)=>parseEnvelope(JSON.stringify(job),configDir));
}
function requiredJob(jobs:Job[],match:(job:Job)=>boolean):Job{
  const job=jobs.find(match);if(!job)throw Error('Solicitud del relay ausente');return job;
}
interface GithubEntry {type:string;name:string;sha:string;size:number}
function githubListing(value:unknown):GithubEntry[]{
  if(!Array.isArray(value)||value.length>=1000)throw Error('Bandeja inválida o llena (máximo 999 entradas).');
  return value.map((entry:unknown)=>{
    if(!isRecord(entry)||typeof entry.type!=='string'||typeof entry.name!=='string')throw Error('Entrada de GitHub inválida');
    // Only JSON files are fetched. Other listing items need no blob metadata.
    if(entry.type!=='file'||!entry.name.endsWith('.json'))return {type:entry.type,name:entry.name,sha:'',size:0};
    if(typeof entry.sha!=='string'||typeof entry.size!=='number'||!Number.isFinite(entry.size)||entry.size<0)throw Error('Referencia de GitHub inválida');
    return {type:entry.type,name:entry.name,sha:entry.sha,size:entry.size};
  });
}

export default class Inbox extends Plugin {
  settings:Settings={...defaults,roots:[...defaults.roots]}; ledger:Ledger=Object.create(null) as Ledger; running=false; retryPermissions=false; stopped=false; last=0; retryAfter=0; status='Sin comprobar'; issues:string[]=[]; history:HistoryEntry[]=[]; private saveQueue:Promise<void>=Promise.resolve();
  lastSuccess=0; nextRetry=0; failures=0; failureCode:FailureCode|null=null; testing=false; deliveryTest:DeliveryTest|null=null;
  private epoch=0; private resumePending=false; private retryContext=''; private pendingRequests=new Set<AbortController>();
  async onload(){
    const raw:unknown=await this.loadData();
    const data=isRecord(raw)?raw:{};
    const settings=isRecord(data.settings)?data.settings:{};
    this.settings={...defaults,roots:[...defaults.roots],...(data.settings?{transport:'github'}:{})};
    for(const key of ['defaultFolder','secret','repository','branch','transport','relay','relaySecret','boundRelay','boundRelaySecret'] as const){
      if(typeof settings[key]==='string')this.settings[key]=settings[key];
    }
    for(const key of ['enabled','wholeVault'] as const)if(typeof settings[key]==='boolean')this.settings[key]=settings[key];
    if(typeof settings.interval==='number'&&Number.isFinite(settings.interval)&&settings.interval>=60&&settings.interval<=86400)this.settings.interval=settings.interval;
    if(Array.isArray(settings.roots))this.settings.roots=settings.roots.filter((root:unknown):root is string=>{
      try{safePath(root,false);return true;}catch{return false;}
    });
    if(!settings.relaySecret)this.settings.relaySecret='chatgpt-inbox-community-'+randomToken();
    this.ledger=Object.create(null) as Ledger;
    if(isRecord(data.ledger))for(const [key,value] of Object.entries(data.ledger))if(typeof value==='string')this.ledger[key]=value;
    this.history=Array.isArray(data.history)?data.history.filter(isHistoryEntry).slice(-100):[];
    const test=data.deliveryTest;
    if(isRecord(test)&&['key','path','relay','secret','state'].every(key=>typeof test[key]==='string')&&typeof test.key==='string'&&typeof test.path==='string'&&typeof test.relay==='string'&&typeof test.secret==='string'&&typeof test.state==='string'){
      try{safePath(test.path);if(/^[a-zA-Z0-9-]{8,100}$/.test(test.key)&&['queued','delivered','conflict','expired','blocked','unknown'].includes(test.state))this.deliveryTest={key:test.key,path:test.path,relay:test.relay,secret:test.secret,state:test.state,...(typeof test.id==='string'?{id:test.id}:{})};}catch{/* Discard an invalid test request without changing folder permissions. */}
    }
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{
      let changed=false;
      for(const entry of this.history){if(entry.path===oldPath||entry.path?.startsWith(oldPath+'/')){entry.path=file.path+entry.path.slice(oldPath.length);changed=true;}}
      if(changed)void this.persist().catch(()=>new Notice('No se pudo actualizar el historial de rutas.'));
    }));
    this.addRibbonIcon('inbox','Bandeja de ChatGPT Community',()=>new InboxModal(this).open());
    this.addCommand({id:'inbox',name:'Abrir bandeja',callback:()=>new InboxModal(this).open()});
    this.addCommand({id:'setup',name:'Configurar paso a paso',callback:()=>new SetupModal(this).open()});
    this.addSettingTab(new InboxSettings(this.app,this));
    this.addCommand({id:'import',name:'Recibir ahora',callback:()=>void this.poll(true)});
    this.app.workspace.onLayoutReady(()=>void this.poll());
    this.registerInterval(window.setInterval(()=>{if(Date.now()>=Math.max(this.nextRetry,this.retryAfter)&&(this.failureCode||Date.now()-this.last>=Math.max(60,this.settings.interval)*1000)) void this.poll();},15000));
    this.registerDomEvent(document,'visibilitychange',()=>{if(document.hidden)this.suspendReception();else this.resumeReception();});
    this.registerDomEvent(window,'focus',()=>this.resumeReception());
    this.registerDomEvent(window,'online',()=>this.resumeReception());
    this.registerDomEvent(window,'offline',()=>{this.epoch++;this.cancelRequests('network');this.failureCode='network';this.notifyUpdate();});
  }
  onunload(){this.stopped=true;this.epoch++;this.cancelRequests('background');}
  suspendReception(){this.epoch++;this.cancelRequests('background');if(this.running){this.resumePending=true;this.last=0;}this.notifyUpdate();}
  resumeReception(){if(this.stopped||document.hidden)return;if(this.running){this.resumePending=true;return;}void this.poll();}
  private connectionKey(){return JSON.stringify([this.settings.transport,this.settings.relay,this.settings.relaySecret,this.settings.repository,this.settings.branch,this.settings.secret]);}
  private active(epoch=this.epoch,context?:string){if(this.stopped||document.hidden||epoch!==this.epoch||(context!==undefined&&context!==this.connectionKey()))throw new ReceptionError('background');}
  private applyFailure(error:unknown){
    const failure=error instanceof ReceptionError?error:new ReceptionError('configuration');
    this.failureCode=failure.code;this.status=failureText(failure.code)+(failure.httpStatus?` (HTTP ${failure.httpStatus})`:'');
    if(['network','timeout','server'].includes(failure.code)){this.failures++;this.nextRetry=Date.now()+retryDelay(this.failures);}
    else{this.nextRetry=0;this.failures=0;if(failure.code==='background')this.last=0;}
  }
  private cancelRequests(code:FailureCode){for(const request of this.pendingRequests)request.abort(new ReceptionError(code));}
  private async request(options:Parameters<typeof requestUrl>[0]){
    const controller=new AbortController();this.pendingRequests.add(controller);
    try{return await withDeadline(requestUrl(options),20000,window,controller.signal);}catch(error){throw error instanceof ReceptionError?error:new ReceptionError('network');}
    finally{this.pendingRequests.delete(controller);}
  }
  private destination(){
    try{const folder=safePath(this.settings.defaultFolder,false);authorize(folder+'/Prueba.md',this.permittedRoots(),this.app.vault.configDir);return folder;}catch{throw new ReceptionError('configuration');}
  }
  setupChecks(){
    let destination=false;try{this.destination();destination=true;}catch{/* Display a corrective action instead of granting permission. */}
    let connected=false;
    if(this.settings.transport==='relay'){
      try{connected=relayOrigin(this.settings.relay)===this.settings.boundRelay&&(!this.settings.boundRelaySecret||this.settings.boundRelaySecret===this.settings.relaySecret)&&!!this.app.secretStorage?.getSecret(this.settings.relaySecret);}catch{/* Missing origin. */}
    }else if(this.settings.transport==='github')connected=!!this.settings.repository&&!!this.app.secretStorage?.getSecret(this.settings.secret);
    else connected=this.settings.transport==='lite';
    return [{name:'Carpeta de destino autorizada',ok:destination,help:'En el paso 2, permite la carpeta que has elegido como destino por defecto.'},
      {name:'Conexión de este dispositivo',ok:connected,help:this.settings.transport==='relay'?'En el paso 1, configura el relay y obtén el código de conexión.':'En el paso 1, comprueba el modo de conexión.'}];
  }
  receptionSummary(){
    if(this.running)return {label:'Comprobando',help:'Se comprueban las solicitudes y sus recibos.'};
    if(this.settings.transport==='lite')return {label:'Modo Lite',help:'Abre el enlace en Obsidian. Este modo no ofrece recibo remoto.'};
    if(document.hidden)return {label:'En segundo plano',help:'La recepción continúa al volver a Obsidian. iOS no permite prometer recepción en segundo plano.'};
    if(!this.settings.enabled)return {label:'Recepción pausada',help:'Abre configurar para comprobar y activar este dispositivo.'};
    if(typeof navigator!=='undefined'&&navigator.onLine===false)return {label:'Sin conexión',help:failureText('network')};
    if(this.failureCode)return {label:['reconnect','pairing-pending'].includes(this.failureCode)?'Requiere reconectar':this.failureCode==='configuration'?'Requiere configuración':this.failureCode==='storage'?'Requiere revisión':'Esperando reintento',help:failureText(this.failureCode)};
    return {label:this.lastSuccess?'Conexión comprobada':'Lista para comprobar',help:this.lastSuccess?'La conexión respondió. Solo el historial confirma las notas entregadas.':'Pulsa recibir ahora para comprobar solicitudes.'};
  }
  diagnosticReport(){
    const counts={delivered:0,receiptPending:0,conflict:0,blocked:0};
    for(const entry of this.history){if(entry.state==='Importada'||entry.state==='Ya entregada')counts.delivered++;if(entry.receiptPending||entry.state==='Guardada sin recibo')counts.receiptPending++;if(entry.state==='Conflicto')counts.conflict++;if(entry.state==='Bloqueada')counts.blocked++;}
    return {schema:1,pluginVersion:this.manifest?.version??'unknown',obsidianVersion:apiVersion??'unknown',transport:['relay','github','lite'].includes(this.settings.transport)?this.settings.transport:'unknown',enabled:this.settings.enabled,checking:this.running,foreground:!document.hidden,online:typeof navigator==='undefined'?null:navigator.onLine,lastAttempt:this.last||null,lastSuccess:this.lastSuccess||null,nextRetry:Math.max(this.nextRetry,this.retryAfter)||null,failure:this.failureCode,scope:{wholeVault:this.settings.wholeVault,folderCount:this.settings.roots.length},history:counts};
  }
  async testDelivery(){
    if(this.testing||this.running)throw new ReceptionError('configuration');
    if(this.settings.transport!=='relay'||!this.settings.enabled)throw new ReceptionError('configuration');
    this.active();const folder=this.destination(),origin=relayOrigin(this.settings.relay),secret=this.settings.relaySecret;
    this.testing=true;this.notifyUpdate();
    try{
      const previous=this.deliveryTest;
      if(!previous||previous.relay!==origin||previous.secret!==secret||previous.path.slice(0,previous.path.lastIndexOf('/'))!==folder||['delivered','conflict','expired'].includes(previous.state)){
        const key='connection-test-'+randomToken();this.deliveryTest={key,path:`${folder}/Prueba de conexión-${key}.md`,relay:origin,secret,state:'unknown'};
      }
      const test=this.deliveryTest;if(!test)throw new ReceptionError('configuration');
      // Persist the retry key before sending: a timed-out response must never
      // cause a second test note on retry or after restarting the plugin.
      await this.persist();
      const checkTest=()=>{this.active();if(this.settings.transport!=='relay'||relayOrigin(this.settings.relay)!==origin||this.settings.relaySecret!==secret||!this.settings.enabled)throw new ReceptionError('configuration');authorize(test.path,this.permittedRoots(),this.app.vault.configDir);};
      await this.checkConnection();checkTest();
      let result=await this.relayRequest('/plugin/test',{key:test.key,path:test.path});
      if(typeof result.id!=='string'||(typeof result.state!=='string'||!['queued','delivered','conflict','expired','blocked'].includes(result.state))||result.path!==test.path)throw new ReceptionError('server');
      test.id=result.id;test.state=result.state==='delivered'?'unknown':result.state;await this.persist();
      if(result.state==='queued'){
        await this.poll(true);
        checkTest();result=await this.relayRequest('/plugin/test',{key:test.key,path:test.path});
        if(result.id!==test.id||result.path!==test.path||(typeof result.state!=='string'||!['queued','delivered','conflict','expired','blocked'].includes(result.state)))throw new ReceptionError('server');
        test.state=result.state==='delivered'?'unknown':result.state;await this.persist();
      }
      checkTest();
      if(result.state==='delivered'){
        const file=this.app.vault.getAbstractFileByPath(test.path);
        if(!(file instanceof TFile))throw new ReceptionError('configuration');
        const text=await this.app.vault.read(file);checkTest();
        const identity=await noteIdentity(test.id??'');checkTest();const ids=markers(text);
        if(stripIdentity(text)!==CONNECTION_TEST_CONTENT||ids.length!==1||ids[0]!==identity)throw new ReceptionError('configuration');
        test.state='delivered';await this.persist();
        const entry=this.history.find(item=>item.source===test.id);if(entry?.receiptPending){this.record({...entry,state:'Importada',receiptPending:false});await this.persist();}
      }
      return test.state;
    }finally{this.testing=false;this.notifyUpdate();}
  }
  permittedRoots(){return this.settings.wholeVault?['*']:this.settings.roots;}
  async permissionsChanged(){await this.persist();this.last=0;if(this.settings.enabled){if(this.running)this.retryPermissions=true;else await this.poll(true);}}
  private updateListeners=new Set<()=>void>();
  onUpdate(listener:()=>void){this.updateListeners.add(listener);return ()=>{this.updateListeners.delete(listener);};}
  private notifyUpdate(){for(const listener of this.updateListeners){try{listener();}catch{/* A view failure must not change delivery state. */}}}
  async persist(){
    const snapshot={settings:{...this.settings,roots:[...this.settings.roots]},ledger:{...this.ledger},history:this.history.map(entry=>({...entry})),deliveryTest:this.deliveryTest?{...this.deliveryTest}:null};
    const save=this.saveQueue.catch(()=>{}).then(()=>this.saveData(snapshot)).catch(()=>{throw new ReceptionError('storage');});this.saveQueue=save;await save;
  }
  record(entry:Omit<HistoryEntry,'time'>){
    const old=this.history.find(h=>h.source===entry.source);
    if(old&&entry.state==='Bloqueada'&&(old.state==='Importada'||old.state==='Ya entregada'))return;
    if(old&&entry.state==='Ya entregada'&&(old.state==='Importada'||old.state==='Ya entregada')){old.noteId??=entry.noteId;old.contentHash??=entry.contentHash;old.legacyHash??=entry.legacyHash;old.originalPath??=entry.originalPath;return;}
    this.history=this.history.filter(h=>h.source!==entry.source);
    this.history.push({...entry,time:Date.now()});this.history=this.history.slice(-100);this.notifyUpdate();
  }
  async resolveNote(entry:HistoryEntry){
    const candidates=new Set<TFile>();
    const visit=(folder:TFolder)=>{for(const file of folder.children){
      try{
        if(file instanceof TFolder){safePath(file.path,false);if(!inConfigDir(file.path,this.app.vault.configDir))visit(file);}
        else if(file instanceof TFile&&file.extension==='md'&&allowed(file.path,this.permittedRoots(),this.app.vault.configDir))candidates.add(file);
      }catch{/* Invalid or protected paths are never read. */}
    }};
    const roots=this.settings.wholeVault?[this.app.vault.getRoot()]:this.settings.roots.map(root=>this.app.vault.getAbstractFileByPath(root));
    for(const root of roots)if(root instanceof TFolder)visit(root);
    const file=await locateIdentity(entry,[...candidates],f=>{authorize(f.path,this.permittedRoots(),this.app.vault.configDir);return this.app.vault.cachedRead(f);});
    entry.path=file.path;await this.persist();return file;
  }
  repoPath(){return sourcePath(this.settings.repository,this.settings.branch);}
  async relayRequest(path:string,body:unknown,anonymous=false):Promise<Record<string,unknown>>{
    const origin=relayOrigin(this.settings.relay);
    if(!anonymous&&this.settings.boundRelay!==origin)throw new ReceptionError('reconnect');
    const credential=this.settings.relaySecret;
    if(!anonymous&&this.settings.boundRelaySecret&&this.settings.boundRelaySecret!==credential)throw new ReceptionError('reconnect');
    const token=this.app.secretStorage?.getSecret(credential);
    if(!anonymous&&!token)throw new ReceptionError('reconnect');
    const r=await this.request({url:origin+path,method:'POST',headers:{'Content-Type':'application/json',...(!anonymous?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),throw:false});
    if(origin!==relayOrigin(this.settings.relay)||credential!==this.settings.relaySecret)throw new ReceptionError('reconnect');
    if(r.status<200||r.status>=300){
      if(r.status===429)this.retryAfter=Date.now()+60000;
      throw new ReceptionError(path==='/plugin/test'&&r.status===404?'relay-update':r.status===401||r.status===403?'reconnect':r.status===429?'rate-limit':r.status>=500?'server':'configuration',r.status);
    }
    const data:unknown=r.json;
    if(!isRecord(data))throw Error('Respuesta del relay inválida');
    return data;
  }
  async pairRelay(){
    if(!this.app.secretStorage)throw Error('Se necesita Obsidian 1.14.5 o posterior.');
    this.destination();this.settings.roots.forEach(r=>safePath(r,false));
    const secret=secretId(this.settings.relaySecret),origin=relayOrigin(this.settings.relay);
    const oldSecret=this.settings.boundRelaySecret||secret;
    if(this.settings.boundRelay&&this.app.secretStorage.getSecret(oldSecret)){
      const old=await this.request({url:relayOrigin(this.settings.boundRelay)+'/plugin/revoke',method:'POST',headers:{Authorization:`Bearer ${this.app.secretStorage.getSecret(oldSecret)}`},throw:false});
      if(![200,401].includes(old.status))throw Error('No se pudo revocar el emparejamiento anterior.');
    }
    if(origin!==relayOrigin(this.settings.relay)||secret!==this.settings.relaySecret)throw Error('La conexión cambió durante el emparejamiento.');
    const b=await this.relayRequest('/pair',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder},true);
    if(typeof b.plugin_token!=='string'||typeof b.pair_code!=='string')throw Error('Respuesta de emparejamiento inválida');
    this.app.secretStorage.setSecret(secret,b.plugin_token);
    this.settings.boundRelay=origin;this.settings.boundRelaySecret=secret;this.failureCode=null;this.failures=0;this.nextRetry=0;this.retryAfter=0;this.last=0;
    await this.persist();return b.pair_code;
  }
  async revokeRelay(){await this.relayRequest('/plugin/revoke',{});this.app.secretStorage.setSecret(secretId(this.settings.relaySecret),'');this.settings.enabled=false;await this.persist();}
  async pollRelay(){
    const epoch=this.epoch,context=this.connectionKey();
    const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});
    const jobs=relayJobs(data.jobs,this.app.vault.configDir);
    if(this.stopped||!this.settings.enabled)return;
    const guard=(path:string)=>{this.active(epoch,context);if(!this.settings.enabled)throw new ReceptionError('background');authorize(path,this.permittedRoots(),this.app.vault.configDir);};
    await receiveRelay(jobs,this.permittedRoots(),this.app.vault.configDir,this.ledger,{
      read:async path=>{guard(path);const f=this.app.vault.getAbstractFileByPath(path);if(!f)return null;if(!(f instanceof TFile))throw Error('Destino no es un archivo');return stripIdentity(await this.app.vault.read(f));},
      create:async(path,content)=>{
        guard(path);
        const parts=path.split('/');parts.pop();let current='';
        for(const part of parts){current=current?current+'/'+part:part;const f=this.app.vault.getAbstractFileByPath(current);if(f&&!(f instanceof TFolder))throw Error('Carpeta ocupada');if(!f)await this.app.vault.createFolder(current);}
        const text=stamp(content,await noteIdentity(requiredJob(jobs,j=>j.path===path).id));guard(path);
        await this.app.vault.create(path,text);
      }
    },()=>this.persist(),async(id,state)=>{
      const job=requiredJob(jobs,j=>j.id===id);
      const entry={source:id,path:job.path,originalPath:job.path,noteId:await noteIdentity(id),contentHash:await digest(job.content),legacyHash:this.ledger[id]};
      // Local verification and a remote receipt are different milestones.
      this.record({...entry,state:state==='delivered'?'Guardada sin recibo':'Conflicto',receiptPending:true});await this.persist();
      this.active(epoch,context);const receipt=await this.relayRequest('/plugin/receipt',{id,state});
      if(receipt.id!==id||receipt.state!==state)throw new ReceptionError('server');
      this.record({...entry,state:state==='delivered'?'Importada':'Conflicto',receiptPending:false});await this.persist();
    },job=>recoverDelivery(job,this.ledger,async path=>{guard(path);const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?this.app.vault.read(f):null;},this.permittedRoots(),this.app.vault.configDir));
    const count=(name:string)=>{const value=isRecord(data.counts)?data.counts[name]:0;return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0;};
    const remaining=Math.max(0,count('queued')-jobs.length),blocked=count('blocked');
    this.status=`${jobs.length} solicitud(es) procesada(s). ${remaining} todavía en cola. ${blocked} esperando permiso de carpeta. ${new Date().toLocaleString()}`;
  }
  async checkConnection(){
    this.destination();
    if(this.settings.transport==='relay'){const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});if(data.writerConnected===false)throw new ReceptionError('pairing-pending');return relayJobs(data.jobs,this.app.vault.configDir).length;}

    const token=this.app.secretStorage?.getSecret(this.settings.secret);
    if(!token)throw Error('Vincula un secreto de GitHub en este dispositivo.');
    const listing=githubListing((await this.get(inboxPath(this.settings.branch),token)).json);
    if(!Array.isArray(listing)||listing.length>=1000)throw Error('Bandeja inválida o llena (máximo 999 entradas).');
    return listing.filter((e:{type:string;name:string})=>e.type==='file'&&e.name.endsWith('.json')).length;
  }
  async get(path:string,token:string){
    // Only GET to a fixed GitHub API origin. Never use remote download_url.
    const r=await this.request({url:`https://api.github.com/${this.repoPath()}/${path}`,method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},throw:false});
    if(r.status!==200){
      if(r.status===403||r.status===429){const reset=Number(r.headers['x-ratelimit-reset'])*1000; this.retryAfter=Math.max(Date.now()+60000,Number.isFinite(reset)?reset:0);}
      throw new ReceptionError(r.status===401?'reconnect':r.status===403||r.status===429?'rate-limit':r.status>=500?'server':'configuration',r.status);
    }
    return r;
  }
  async poll(manual=false){
    if(this.running||this.stopped||document.hidden)return;
    const context=this.connectionKey();
    if(context!==this.retryContext){this.retryContext=context;this.nextRetry=0;this.retryAfter=0;this.failures=0;this.failureCode=null;}
    if(typeof navigator!=='undefined'&&navigator.onLine===false){this.failureCode='network';this.status=failureText('network');this.notifyUpdate();return;}
    if(!manual&&this.failureCode&&['reconnect','configuration','pairing-pending','relay-update','storage'].includes(this.failureCode))return;
    if(!manual&&(Date.now()<this.nextRetry||(!this.failureCode&&this.last>0&&Date.now()-this.last<Math.max(60,this.settings.interval)*1000)))return;
    if(this.settings.transport==='lite'){this.status='Modo Lite: abre un enlace para crear cada nota.';return;}
    if(Date.now()<this.retryAfter){this.status='El servidor pide esperar. Próximo intento: '+new Date(this.retryAfter).toLocaleTimeString();if(manual)new Notice(this.status);return;}
    if(!this.settings.enabled){this.status='Recepción pausada. Actívala en Configurar.';if(manual)new Notice(this.status);return;}
    const epoch=this.epoch;this.running=true;this.issues=[];this.last=Date.now();this.notifyUpdate();let imported=0;let problems=0;let delivered=0;
    try{
      if(this.settings.transport==='relay'){await this.pollRelay();this.active(epoch,context);this.lastSuccess=Date.now();this.failureCode=null;this.failures=0;this.nextRetry=0;if(manual)new Notice(this.status);return;}
      this.repoPath();
      if(!this.app.secretStorage) throw Error('Se necesita Obsidian 1.14.5 o posterior');
      const token=this.app.secretStorage.getSecret(this.settings.secret);
      if(!token)throw Error('Selecciona un secreto con token GitHub de solo lectura');
      this.settings.roots.forEach(r=>safePath(r,false));
      const guard=(path:string)=>{this.active(epoch,context);if(!this.settings.enabled)throw new ReceptionError('background');authorize(path,this.permittedRoots(),this.app.vault.configDir);};
      const listing=githubListing((await this.get(inboxPath(this.settings.branch),token)).json);this.active(epoch,context);
      if(!Array.isArray(listing)||listing.length>=1000)throw Error('Cola inválida o llena; archiva solicitudes antiguas en GitHub');
      for(const entry of listing){
        if(this.stopped||!this.settings.enabled)break;
        if(entry.type!=='file'||!entry.name.endsWith('.json'))continue;
        try{
          if(!/^[a-f0-9]{40}$/.test(entry.sha)||entry.size>MAX_BYTES)throw Error('Tamaño o referencia no válidos');
          const rawBlob:unknown=(await this.get(`git/blobs/${entry.sha}`,token)).json;
          const blob=isRecord(rawBlob)?rawBlob:{};
          if(blob.encoding!=='base64'||typeof blob.size!=='number'||blob.size<0||blob.size>MAX_BYTES||typeof blob.content!=='string'||blob.content.length>MAX_BYTES*1.5)throw Error('Blob inválido');
          const raw=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
          if(bytes(raw)>MAX_BYTES)throw Error('Solicitud demasiado grande');
          if(this.stopped||!this.settings.enabled)break;
          // Validate the envelope and config-path protection before any local read.
          // The folder scope is enforced inside the recovery step, so a path the
          // user never authorized is never opened in the vault.
          const job=parseEnvelope(raw,this.app.vault.configDir);
          const recovered=await recoverDelivery(job,this.ledger,async p=>{guard(p);const f=this.app.vault.getAbstractFileByPath(p);return f instanceof TFile?this.app.vault.read(f):null;},this.permittedRoots(),this.app.vault.configDir);
          const identity=await noteIdentity(job.id);
          const result=recovered?'duplicada':await deliver(job,this.ledger,{
            read:async p=>{guard(p);const f=this.app.vault.getAbstractFileByPath(p);if(!f)return null;if(!(f instanceof TFile))throw Error('El destino es una carpeta');return stripIdentity(await this.app.vault.read(f));},
            create:async(p,content)=>{
              guard(p);
              const parts=p.split('/');parts.pop();let folder='';
              for(const part of parts){folder=folder?folder+'/'+part:part;const f=this.app.vault.getAbstractFileByPath(folder);if(f&&!(f instanceof TFolder))throw Error('Una carpeta es un archivo');if(!f){try{await this.app.vault.createFolder(folder);}catch(e){if(!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder))throw e;}}}
              // Vault.create refuses existing files; never modify or delete vault content.
              guard(p);await this.app.vault.create(p,stamp(content,identity));
            }
          });
          if(result.startsWith('conflicto')){problems++;this.issues.push(`${job.path}: conflicto; conserva la nota local. Usa otra ruta y un ID nuevo en GitHub.`);} else if(result==='creada')imported++; else delivered++;
          this.record({source:entry.name,path:job.path,originalPath:job.path,noteId:identity,contentHash:await digest(job.content),legacyHash:this.ledger[job.id],state:result.startsWith('conflicto')?'Conflicto':result==='creada'?'Importada':'Ya entregada',detail:result.startsWith('conflicto')?'La nota local se conserva. Envía otra ruta.':undefined});
          await this.persist();
        }catch{problems++;this.record({source:entry.name,state:'Bloqueada',detail:'Revisa carpeta permitida, formato, tamaño, ID y conexión.'});await this.persist();this.issues.push(`${entry.name}: bloqueada por ruta, formato, ID, tamaño o error de lectura/escritura.`);} // Never log tokens, remote content or server bodies.
      }
      this.active(epoch,context);this.lastSuccess=Date.now();this.failureCode=null;this.failures=0;this.nextRetry=0;
      this.status=`${imported} nueva(s), ${delivered} ya entregada(s), ${problems} pendiente(s). ${new Date().toLocaleString()}`;
      if(manual||imported||problems)new Notice(this.status);
    }catch(e){this.applyFailure(epoch!==this.epoch||document.hidden||this.stopped?new ReceptionError('background'):e);if(manual)new Notice(this.status);}
    finally{this.running=false;this.notifyUpdate();if(this.retryPermissions){this.retryPermissions=false;void this.poll(true);}else if(this.resumePending){this.resumePending=false;if(!document.hidden&&!this.stopped)void this.poll();}}
  }
}
class InboxSettings extends PluginSettingTab {
  constructor(app:Inbox['app'],private plugin:Inbox){super(app,plugin);}
  getSettingDefinitions():SettingDefinitionItem[]{
    const p=this.plugin;
    return [
      {name:'Empezar aquí',desc:'Tres pasos: conexión, carpetas y recepción.',render:row=>{row.addButton(b=>b.setButtonText('Configurar paso a paso').setCta().onClick(()=>new SetupModal(p).open()));}},
      {name:'Tus notas recibidas',render:row=>{row.addButton(b=>b.setButtonText('Abrir bandeja').onClick(()=>new InboxModal(p).open())).addButton(b=>b.setButtonText('Instrucción para ChatGPT').onClick(()=>new InstructionsModal(p).open()));}},
      {name:'Importar solicitudes',desc:'Solo crea notas nuevas en el ámbito autorizado. Obsidian debe estar abierto.',render:row=>{row.addToggle(t=>t.setValue(p.settings.enabled).onChange(async value=>{p.settings.enabled=value;await p.persist();}));}},
      {name:'Repositorio GitHub',visible:()=>p.settings.transport==='github',render:row=>{row.addText(t=>t.setPlaceholder('usuario/mi-inbox').setValue(p.settings.repository).onChange(async value=>{p.settings.repository=value.trim();await p.persist();}));}},
      {name:'Rama',visible:()=>p.settings.transport==='github',render:row=>{row.addText(t=>t.setValue(p.settings.branch).onChange(async value=>{p.settings.branch=value.trim();await p.persist();}));}},
      {name:'Token de solo lectura',desc:'Solo este repositorio, Contents: Read-only. Se configura por dispositivo.',visible:()=>p.settings.transport==='github',render:row=>{row.addComponent(c=>new SecretComponent(this.app,c).setValue(p.settings.secret).onChange(async value=>{p.settings.secret=value??'';await p.persist();}));}},
      {type:'group',heading:'Carpetas permitidas',items:folderDefinitions(p,()=>this.update())},
      {name:'Intervalo (segundos)',desc:'Mínimo 60. Solo con Obsidian abierto y activo.',render:row=>{row.addText(t=>t.setValue(String(p.settings.interval)).onChange(async value=>{const n=Number(value);if(Number.isFinite(n)&&n>=60&&n<=86400){p.settings.interval=n;await p.persist();}}));}},
      ...p.issues.map(issue=>({name:issue})),
      {name:'Diagnóstico de recepción',desc:'Revisa un informe sin notas, rutas ni credenciales. No se envía automáticamente.',render:row=>{row.addButton(b=>b.setButtonText('Ver diagnóstico').onClick(()=>new DiagnosticsModal(p).open()));}},
      {name:'Comprobar ahora',desc:p.status,render:row=>{row.addButton(b=>b.setButtonText('Comprobar').onClick(async()=>{await p.poll(true);this.update();}));}}
    ];
  }
}

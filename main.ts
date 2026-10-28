import {Plugin,PluginSettingTab,SecretComponent,Notice,requestUrl,TFile,TFolder,SettingDefinitionItem} from 'obsidian';
import {SetupModal,InboxModal,InstructionsModal,folderControls} from './ui';
import {allowed,MAX_BYTES,bytes,safePath,parseEnvelope,deliver,Ledger,digest,randomToken,secretId,authorize,isRecord,Job,inConfigDir} from './core';
import {noteIdentity,stamp,stripIdentity,locateIdentity,recoverDelivery} from './identity';
import {sourcePath,inboxPath} from './source';
import {relayOrigin,receiveRelay} from './relay-client';
interface Settings { enabled:boolean; wholeVault:boolean; defaultFolder:string; roots:string[]; secret:string; interval:number; repository:string; branch:string; transport: string; relay:string; relaySecret:string; boundRelay:string; boundRelaySecret:string }
const defaults:Settings={enabled:false,wholeVault:false,defaultFolder:'ChatGPT Inbox',roots:['ChatGPT Inbox'],secret:'chatgpt-inbox-community-github-read',interval:120,repository:'',branch:'main',transport:'relay',relay:'',relaySecret:'chatgpt-inbox-community-relay',boundRelay:'',boundRelaySecret:''};
export interface HistoryEntry { source:string; path?:string; state:string; detail?:string; time:number; noteId?:string; contentHash?:string; legacyHash?:string; originalPath?:string }

function isHistoryEntry(value:unknown):value is HistoryEntry {
  if(!isRecord(value)||typeof value.source!=='string'||typeof value.state!=='string'||typeof value.time!=='number'||!Number.isFinite(value.time))return false;
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
    this.registerInterval(window.setInterval(()=>{if(Date.now()-this.last>=Math.max(60,this.settings.interval)*1000) void this.poll();},15000));
    this.registerDomEvent(document,'visibilitychange',()=>{if(!document.hidden) void this.poll();});
    this.registerDomEvent(window,'focus',()=>void this.poll());
    this.registerDomEvent(window,'online',()=>void this.poll());
  }
  onunload(){this.stopped=true;}
  permittedRoots(){return this.settings.wholeVault?['*']:this.settings.roots;}
  async permissionsChanged(){await this.persist();this.last=0;if(this.settings.enabled){if(this.running)this.retryPermissions=true;else await this.poll(true);}}
  private updateListeners=new Set<()=>void>();
  onUpdate(listener:()=>void){this.updateListeners.add(listener);return ()=>{this.updateListeners.delete(listener);};}
  private notifyUpdate(){for(const listener of this.updateListeners){try{listener();}catch{/* A view failure must not change delivery state. */}}}
  async persist(){
    const snapshot={settings:{...this.settings,roots:[...this.settings.roots]},ledger:{...this.ledger},history:this.history.map(entry=>({...entry}))};
    const save=this.saveQueue.catch(()=>{}).then(()=>this.saveData(snapshot));this.saveQueue=save;await save;
  }
  record(entry:Omit<HistoryEntry,'time'>){
    const old=this.history.find(h=>h.source===entry.source);
    if(old&&entry.state==='Bloqueada'&&(old.state==='Importada'||old.state==='Ya entregada'))return;
    if(old&&entry.state==='Ya entregada'&&(old.state==='Importada'||old.state==='Ya entregada')){old.noteId??=entry.noteId;old.contentHash??=entry.contentHash;old.legacyHash??=entry.legacyHash;old.originalPath??=entry.originalPath;return;}
    this.history=this.history.filter(h=>h.source!==entry.source);
    this.history.push({...entry,time:Date.now()});this.history=this.history.slice(-100);
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
    if(!anonymous&&this.settings.boundRelay!==origin)throw Error('La dirección del relay cambió. Vuelve a emparejar antes de enviar credenciales.');
    const credential=this.settings.relaySecret;
    if(!anonymous&&this.settings.boundRelaySecret&&this.settings.boundRelaySecret!==credential)throw Error('El secreto del relay cambió. Vuelve a emparejar.');
    const token=this.app.secretStorage?.getSecret(credential);
    if(!anonymous&&!token)throw Error('Empareja este dispositivo con el relay.');
    const r=await requestUrl({url:origin+path,method:'POST',headers:{'Content-Type':'application/json',...(!anonymous?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),throw:false});
    if(origin!==relayOrigin(this.settings.relay)||credential!==this.settings.relaySecret)throw Error('La conexión cambió durante la solicitud. Vuelve a intentarlo.');
    if(r.status<200||r.status>=300)throw Error(`Relay HTTP ${r.status}. Revisa conexión o vuelve a emparejar.`);
    const data:unknown=r.json;
    if(!isRecord(data))throw Error('Respuesta del relay inválida');
    return data;
  }
  async pairRelay(){
    if(!this.app.secretStorage)throw Error('Se necesita Obsidian 1.14.5 o posterior.');
    this.settings.roots.forEach(r=>safePath(r,false));
    const secret=secretId(this.settings.relaySecret),origin=relayOrigin(this.settings.relay);
    const oldSecret=this.settings.boundRelaySecret||secret;
    if(this.settings.boundRelay&&this.app.secretStorage.getSecret(oldSecret)){
      const old=await requestUrl({url:relayOrigin(this.settings.boundRelay)+'/plugin/revoke',method:'POST',headers:{Authorization:`Bearer ${this.app.secretStorage.getSecret(oldSecret)}`},throw:false});
      if(![200,401].includes(old.status))throw Error('No se pudo revocar el emparejamiento anterior.');
    }
    if(origin!==relayOrigin(this.settings.relay)||secret!==this.settings.relaySecret)throw Error('La conexión cambió durante el emparejamiento.');
    const b=await this.relayRequest('/pair',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder},true);
    if(typeof b.plugin_token!=='string'||typeof b.pair_code!=='string')throw Error('Respuesta de emparejamiento inválida');
    this.app.secretStorage.setSecret(secret,b.plugin_token);
    this.settings.boundRelay=origin;this.settings.boundRelaySecret=secret;
    await this.persist();return b.pair_code;
  }
  async revokeRelay(){await this.relayRequest('/plugin/revoke',{});this.app.secretStorage.setSecret(secretId(this.settings.relaySecret),'');this.settings.enabled=false;await this.persist();}
  async pollRelay(){
    const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});
    const jobs=relayJobs(data.jobs,this.app.vault.configDir);
    if(this.stopped||!this.settings.enabled)return;
    const guard=(path:string)=>{if(this.stopped||!this.settings.enabled)throw Error('Recepción pausada');authorize(path,this.permittedRoots(),this.app.vault.configDir);};
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
      await this.relayRequest('/plugin/receipt',{id,state});
      const job=requiredJob(jobs,j=>j.id===id);
      this.record({source:id,path:job.path,originalPath:job.path,noteId:await noteIdentity(id),contentHash:await digest(job.content),legacyHash:this.ledger[id],state:state==='delivered'?'Importada':'Conflicto'});await this.persist();
    },job=>recoverDelivery(job,this.ledger,async path=>{guard(path);const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?this.app.vault.read(f):null;},this.permittedRoots(),this.app.vault.configDir));
    this.status=`Relay comprobado. ${jobs.length} solicitud(es) procesada(s). ${new Date().toLocaleString()}`;
  }
  async checkConnection(){
    if(this.settings.transport==='relay'){const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});return relayJobs(data.jobs,this.app.vault.configDir).length;}

    const token=this.app.secretStorage?.getSecret(this.settings.secret);
    if(!token)throw Error('Vincula un secreto de GitHub en este dispositivo.');
    const listing=githubListing((await this.get(inboxPath(this.settings.branch),token)).json);
    if(!Array.isArray(listing)||listing.length>=1000)throw Error('Bandeja inválida o llena (máximo 999 entradas).');
    return listing.filter((e:{type:string;name:string})=>e.type==='file'&&e.name.endsWith('.json')).length;
  }
  async get(path:string,token:string){
    // Only GET to a fixed GitHub API origin. Never use remote download_url.
    const r=await requestUrl({url:`https://api.github.com/${this.repoPath()}/${path}`,method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},throw:false});
    if(r.status!==200){
      if(r.status===403||r.status===429){const reset=Number(r.headers['x-ratelimit-reset'])*1000; this.retryAfter=Math.max(Date.now()+60000,Number.isFinite(reset)?reset:0);}
      throw Error(`GitHub HTTP ${r.status}`);
    }
    return r;
  }
  async poll(manual=false){
    if(this.running||this.stopped||document.hidden)return;
    if(this.settings.transport==='lite'){this.status='Modo Lite: abre un enlace para crear cada nota.';return;}
    if(Date.now()<this.retryAfter){this.status='GitHub pide esperar. Próximo intento: '+new Date(this.retryAfter).toLocaleTimeString();if(manual)new Notice(this.status);return;}
    if(!this.settings.enabled){this.status='Recepción pausada. Actívala en Configurar.';if(manual)new Notice(this.status);return;}
    this.running=true;this.issues=[];this.last=Date.now();let imported=0;let problems=0;let delivered=0;
    try{
      if(this.settings.transport==='relay'){await this.pollRelay();if(manual)new Notice(this.status);return;}
      this.repoPath();
      if(!this.app.secretStorage) throw Error('Se necesita Obsidian 1.14.5 o posterior');
      const token=this.app.secretStorage.getSecret(this.settings.secret);
      if(!token)throw Error('Selecciona un secreto con token GitHub de solo lectura');
      this.settings.roots.forEach(r=>safePath(r,false));
      const guard=(path:string)=>{if(this.stopped||!this.settings.enabled)throw Error('Recepción pausada');authorize(path,this.permittedRoots(),this.app.vault.configDir);};
      const listing=githubListing((await this.get(inboxPath(this.settings.branch),token)).json);
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
      this.status=`${imported} nueva(s), ${delivered} ya entregada(s), ${problems} pendiente(s). ${new Date().toLocaleString()}`;
      if(manual||imported||problems)new Notice(this.status);
    }catch(e){this.status=e instanceof Error?e.message:'Error de importación';if(manual)new Notice(this.status);}
    finally{this.running=false;this.notifyUpdate();if(this.retryPermissions){this.retryPermissions=false;void this.poll(true);}}
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
      {name:'Carpetas permitidas',aliases:['Toda la bóveda actual','Destino por defecto','Añadir una carpeta','Carpeta nueva'],render:row=>{folderControls(row.controlEl,p,()=>this.update());}},
      {name:'Intervalo (segundos)',desc:'Mínimo 60. Solo con Obsidian abierto y activo.',render:row=>{row.addText(t=>t.setValue(String(p.settings.interval)).onChange(async value=>{const n=Number(value);if(Number.isFinite(n)&&n>=60&&n<=86400){p.settings.interval=n;await p.persist();}}));}},
      ...p.issues.map(issue=>({name:issue})),
      {name:'Comprobar ahora',desc:p.status,render:row=>{row.addButton(b=>b.setButtonText('Comprobar').onClick(async()=>{await p.poll(true);this.update();}));}}
    ];
  }
}

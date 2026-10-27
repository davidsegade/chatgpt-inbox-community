import {Plugin,PluginSettingTab,Setting,SecretComponent,Notice,requestUrl,TFile,TFolder} from 'obsidian';
import {SetupModal,InboxModal,InstructionsModal,folderControls} from './ui';
import {MAX_BYTES,bytes,safePath,parseEnvelope,deliver,Ledger,digest,randomToken,secretId,authorize} from './core';
import {noteIdentity,stamp,stripIdentity,locateIdentity,recoverDelivery} from './identity';
import {sourcePath,inboxPath} from './source';
import {relayOrigin,receiveRelay} from './relay-client';
interface Settings { enabled:boolean; wholeVault:boolean; defaultFolder:string; roots:string[]; secret:string; interval:number; repository:string; branch:string; transport: string; relay:string; relaySecret:string; boundRelay:string; boundRelaySecret:string }
const defaults:Settings={enabled:false,wholeVault:false,defaultFolder:'ChatGPT Inbox',roots:['ChatGPT Inbox'],secret:'chatgpt-inbox-community-github-read',interval:120,repository:'',branch:'main',transport:'relay',relay:'',relaySecret:'chatgpt-inbox-community-relay',boundRelay:'',boundRelaySecret:''};
export interface HistoryEntry { source:string; path?:string; state:string; detail?:string; time:number; noteId?:string; contentHash?:string; legacyHash?:string; originalPath?:string }

export default class Inbox extends Plugin {
  settings:Settings={...defaults,roots:[...defaults.roots]}; ledger:Ledger=Object.create(null); running=false; retryPermissions=false; stopped=false; last=0; retryAfter=0; status='Sin comprobar'; issues:string[]=[]; history:HistoryEntry[]=[]; private saveQueue:Promise<void>=Promise.resolve();
  async onload(){
    const data=await this.loadData();
    this.settings={...defaults,...(data?.settings?{transport:'github'}:{}),...data?.settings};
    if(!data?.settings?.relaySecret)this.settings.relaySecret='chatgpt-inbox-community-'+randomToken(); this.ledger=Object.assign(Object.create(null),data?.ledger??{});
    this.history=Array.isArray(data?.history)?data.history.slice(-100):[];
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
    const snapshot=JSON.parse(JSON.stringify({settings:this.settings,ledger:this.ledger,history:this.history}));
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
    const file=await locateIdentity(entry,this.app.vault.getMarkdownFiles(),f=>this.app.vault.cachedRead(f));
    entry.path=file.path;await this.persist();return file;
  }
  repoPath(){return sourcePath(this.settings.repository,this.settings.branch);}
  async relayRequest(path:string,body:unknown,anonymous=false){
    const origin=relayOrigin(this.settings.relay);
    if(!anonymous&&this.settings.boundRelay!==origin)throw Error('La dirección del relay cambió. Vuelve a emparejar antes de enviar credenciales.');
    const credential=this.settings.relaySecret;
    if(!anonymous&&this.settings.boundRelaySecret&&this.settings.boundRelaySecret!==credential)throw Error('El secreto del relay cambió. Vuelve a emparejar.');
    const token=this.app.secretStorage?.getSecret(credential);
    if(!anonymous&&!token)throw Error('Empareja este dispositivo con el relay.');
    const r=await requestUrl({url:origin+path,method:'POST',headers:{'Content-Type':'application/json',...(!anonymous?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),throw:false});
    if(origin!==relayOrigin(this.settings.relay)||credential!==this.settings.relaySecret)throw Error('La conexión cambió durante la solicitud. Vuelve a intentarlo.');
    if(r.status<200||r.status>=300)throw Error(`Relay HTTP ${r.status}. Revisa conexión o vuelve a emparejar.`);
    return r.json;
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
    await this.persist();return b.pair_code as string;
  }
  async revokeRelay(){await this.relayRequest('/plugin/revoke',{});this.app.secretStorage.setSecret(secretId(this.settings.relaySecret),'');this.settings.enabled=false;await this.persist();}
  async pollRelay(){
    const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});
    if(this.stopped||!this.settings.enabled)return;
    const guard=(path:string)=>{if(this.stopped||!this.settings.enabled)throw Error('Recepción pausada');authorize(path,this.permittedRoots(),this.app.vault.configDir);};
    await receiveRelay(data.jobs,this.permittedRoots(),this.app.vault.configDir,this.ledger,{
      read:async path=>{guard(path);const f=this.app.vault.getAbstractFileByPath(path);if(!f)return null;if(!(f instanceof TFile))throw Error('Destino no es un archivo');return stripIdentity(await this.app.vault.read(f));},
      create:async(path,content)=>{
        guard(path);
        const parts=path.split('/');parts.pop();let current='';
        for(const part of parts){current=current?current+'/'+part:part;const f=this.app.vault.getAbstractFileByPath(current);if(f&&!(f instanceof TFolder))throw Error('Carpeta ocupada');if(!f)await this.app.vault.createFolder(current);}
        const text=stamp(content,await noteIdentity(data.jobs.find((j:{path:string})=>j.path===path).id));guard(path);
        await this.app.vault.create(path,text);
      }
    },()=>this.persist(),async(id,state)=>{
      await this.relayRequest('/plugin/receipt',{id,state});
      const job=data.jobs.find((j:{id:string})=>j.id===id);
      this.record({source:id,path:job.path,originalPath:job.path,noteId:await noteIdentity(id),contentHash:await digest(job.content),legacyHash:this.ledger[id],state:state==='delivered'?'Importada':'Conflicto'});await this.persist();
    },job=>recoverDelivery(job,this.ledger,async path=>{guard(path);const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?this.app.vault.read(f):null;},this.permittedRoots(),this.app.vault.configDir));
    this.status=`Relay comprobado. ${data.jobs.length} solicitud(es) procesada(s). ${new Date().toLocaleString()}`;
  }
  async checkConnection(){
    if(this.settings.transport==='relay'){const data=await this.relayRequest('/plugin/poll',{folders:this.permittedRoots(),defaultFolder:this.settings.defaultFolder});return data.jobs.length;}

    const token=this.app.secretStorage?.getSecret(this.settings.secret);
    if(!token)throw Error('Vincula un secreto de GitHub en este dispositivo.');
    const listing=(await this.get(inboxPath(this.settings.branch),token)).json;
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
      const listing=(await this.get(inboxPath(this.settings.branch),token)).json;
      if(!Array.isArray(listing)||listing.length>=1000)throw Error('Cola inválida o llena; archiva solicitudes antiguas en GitHub');
      for(const entry of listing){
        if(this.stopped||!this.settings.enabled)break;
        if(entry.type!=='file'||!entry.name.endsWith('.json'))continue;
        try{
          if(!/^[a-f0-9]{40}$/.test(entry.sha)||entry.size>MAX_BYTES)throw Error('Tamaño o referencia no válidos');
          const blob=(await this.get(`git/blobs/${entry.sha}`,token)).json;
          if(blob.encoding!=='base64'||blob.size>MAX_BYTES||typeof blob.content!=='string'||blob.content.length>MAX_BYTES*1.5)throw Error('Blob inválido');
          const raw=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
          if(bytes(raw)>MAX_BYTES)throw Error('Solicitud demasiado grande');
          if(this.stopped||!this.settings.enabled)break;
          // Validate the envelope and config-path protection before any local read.
          // The folder scope is enforced inside the recovery step, so a path the
          // user never authorized is never opened in the vault.
          const job=parseEnvelope(raw,this.app.vault.configDir);
          const recovered=await recoverDelivery(job,this.ledger,async p=>{const f=this.app.vault.getAbstractFileByPath(p);return f instanceof TFile?this.app.vault.read(f):null;},this.permittedRoots(),this.app.vault.configDir);
          const identity=await noteIdentity(job.id);
          const result=recovered?'duplicada':await deliver(job,this.ledger,{
            read:async p=>{const f=this.app.vault.getAbstractFileByPath(p);if(!f)return null;if(!(f instanceof TFile))throw Error('El destino es una carpeta');return stripIdentity(await this.app.vault.read(f));},
            create:async(p,content)=>{
              const parts=p.split('/');parts.pop();let folder='';
              for(const part of parts){folder=folder?folder+'/'+part:part;const f=this.app.vault.getAbstractFileByPath(folder);if(f&&!(f instanceof TFolder))throw Error('Una carpeta es un archivo');if(!f){try{await this.app.vault.createFolder(folder);}catch(e){if(!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder))throw e;}}}
              // Vault.create refuses existing files; never modify or delete vault content.
              await this.app.vault.create(p,stamp(content,identity));
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
  display(){const el=this.containerEl;el.empty();
    new Setting(el).setName('ChatGPT Inbox Community').setHeading();
    el.createEl('p',{text:'Relay o GitHub → bóveda actual. Solo crea notas nuevas. Obsidian debe estar abierto. Usa Configurar para elegir un modo.'});
    new Setting(el).setName('Empezar aquí').setDesc('Tres pasos: conexión, carpetas y recepción.').addButton(b=>b.setButtonText('Configurar paso a paso').setCta().onClick(()=>new SetupModal(this.plugin).open()));
    new Setting(el).setName('Tus notas recibidas').addButton(b=>b.setButtonText('Abrir bandeja').onClick(()=>new InboxModal(this.plugin).open())).addButton(b=>b.setButtonText('Instrucción para ChatGPT').onClick(()=>new InstructionsModal(this.plugin).open()));
    new Setting(el).setName('Importar solicitudes').setDesc('Autoriza crear notas en el ámbito elegido de la bóveda actual.').addToggle(t=>t.setValue(this.plugin.settings.enabled).onChange(async v=>{this.plugin.settings.enabled=v;await this.plugin.persist();}));
    if(this.plugin.settings.transport==='github'){
    new Setting(el).setName('Repositorio GitHub').setDesc('Formato propietario/repositorio; debe existir y ser accesible con el token.').addText(t=>t.setPlaceholder('usuario/mi-inbox').setValue(this.plugin.settings.repository).onChange(async v=>{this.plugin.settings.repository=v.trim();await this.plugin.persist();}));
    new Setting(el).setName('Rama').addText(t=>t.setValue(this.plugin.settings.branch).onChange(async v=>{this.plugin.settings.branch=v.trim();await this.plugin.persist();}));
    new Setting(el).setName('Token de solo lectura').setDesc('Crea un token fine-grained: solo este repositorio, Contents: Read-only. El secreto se configura por dispositivo, nunca en data.json.').addComponent(c=>new SecretComponent(this.app,c).setValue(this.plugin.settings.secret).onChange(async v=>{this.plugin.settings.secret=v??'';await this.plugin.persist();}));
    }
    new Setting(el).setName('Carpetas permitidas').setHeading();
    folderControls(el,this.plugin,()=>this.display());
    new Setting(el).setName('Intervalo (segundos)').setDesc('Mínimo 60. Solo con Obsidian abierto y activo.').addText(t=>t.setValue(String(this.plugin.settings.interval)).onChange(async s=>{const n=Number(s);if(Number.isFinite(n)&&n>=60&&n<=86400){this.plugin.settings.interval=n;await this.plugin.persist();}}));
    for(const issue of this.plugin.issues)el.createEl('p',{text:issue});
    new Setting(el).setName('Comprobar ahora').setDesc(this.plugin.status).addButton(b=>b.setButtonText('Comprobar').onClick(async()=>{await this.plugin.poll(true);this.display();}));
  }
}

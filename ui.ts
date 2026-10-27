import {App, Modal, FuzzySuggestModal, TFolder, Setting, SecretComponent, Notice} from 'obsidian';
import {openInboxNote} from './navigation';
import type Inbox from './main';
import {allowed,safePath,secretId} from './core';
import {liteURI} from './relay-client';

export class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app:App, private choose:(path:string)=>void){super(app);this.setPlaceholder('Busca una carpeta de la bóveda actual');}
  getItems():TFolder[]{return this.app.vault.getAllLoadedFiles().filter((f):f is TFolder=>{
    if(!(f instanceof TFolder))return false;
    try{safePath(f.path,false);return allowed(f.path+'/nota.md',[f.path],this.app.vault.configDir);}catch{return false;}
  });}
  getItemText(folder:TFolder){return folder.path;}
  onChooseItem(folder:TFolder){this.choose(folder.path);}
}

export function folderControls(el:HTMLElement,plugin:Inbox,changed:()=>void){
  new Setting(el).setName('Toda la bóveda actual').setDesc(`${plugin.app.vault.getName()}. No autoriza otras bóvedas ni la configuración de Obsidian.`).addToggle(t=>t.setValue(plugin.settings.wholeVault).onChange(async v=>{plugin.settings.wholeVault=v;await plugin.permissionsChanged();changed();}));
  new Setting(el).setName('Destino por defecto').setDesc('Carpeta relativa a la bóveda. No cambia los permisos ni los destinos explícitos.').addText(t=>t.setValue(plugin.settings.defaultFolder).onChange(async v=>{try{safePath(v,false);plugin.settings.defaultFolder=v;await plugin.persist();}catch{new Notice('Ruta no válida');}}));

  new Setting(el).setName('Añadir una carpeta').setDesc('Las subcarpetas también quedarán permitidas.').addButton(b=>b.setButtonText('Elegir carpeta…').onClick(()=>new FolderPicker(plugin.app,p=>{
    if(!plugin.settings.roots.includes(p))plugin.settings.roots.push(p);
    void plugin.permissionsChanged().then(changed).catch(()=>new Notice('No se pudo guardar la carpeta.'));
  }).open()));
  for(const root of plugin.settings.roots){new Setting(el).setName(root).addButton(b=>b.setButtonText('Quitar permiso').onClick(async()=>{
    plugin.settings.roots=plugin.settings.roots.filter(r=>r!==root);await plugin.permissionsChanged();changed();
  }));}
  // A new folder need not exist yet. This grants permission without creating it.
  let proposed='';
  new Setting(el).setName('Carpeta nueva').setDesc('Escribe una ruta si todavía no existe. Se creará al recibir una nota.').addText(t=>t.setPlaceholder('ChatGPT Inbox/Proyectos').onChange(v=>proposed=v.normalize('NFC'))).addButton(b=>b.setButtonText('Permitir').onClick(async()=>{
    try{safePath(proposed,false);if(!allowed(proposed+'/nota.md',[proposed],plugin.app.vault.configDir))throw Error();
      if(!plugin.settings.roots.includes(proposed))plugin.settings.roots.push(proposed);
      await plugin.permissionsChanged();changed();
    }catch{new Notice('Indica una carpeta relativa válida, fuera de la configuración de Obsidian.');}
  }));
}

export class SetupModal extends Modal {
  step=0; result=''; busy=false; closed=false; pairCode=''; liteTitle='Mi primera nota'; liteContent='# Mi primera nota';
  constructor(private plugin:Inbox){super(plugin.app);}
  onOpen(){this.closed=false;this.render();}
  onClose(){this.closed=true;this.contentEl.empty();}
  render(){if(this.closed)return;const el=this.contentEl;el.empty();this.setTitle('Configurar ChatGPT Inbox Community');
    el.createEl('p',{text:`Paso ${this.step+1} de 3`});
    if(this.step===0){
      new Setting(el).setName('Modo de conexión').addDropdown(d=>d.addOptions({relay:'Relay beta',lite:'Lite: enlace a Obsidian',github:'GitHub avanzado'}).setValue(this.plugin.settings.transport).onChange(async v=>{this.plugin.settings.transport=v;this.pairCode='';await this.plugin.persist();this.render();}));
      if(this.plugin.settings.transport==='lite'){
        el.createEl('p',{text:'Sin cuentas ni servidor. Genera un enlace para una nota corta y ábrelo en el dispositivo con Obsidian. Lite requiere un toque y no ofrece recibo remoto.'});
        new Setting(el).setName('Título').addText(t=>t.setValue(this.liteTitle).onChange(v=>this.liteTitle=v));
        const area=el.createEl('textarea');area.value=this.liteContent;area.setAttribute('aria-label','Contenido de la nota Lite');area.oninput=()=>this.liteContent=area.value;
        new Setting(el).addButton(b=>b.setButtonText('Generar enlace').onClick(()=>{try{const href=liteURI(this.app.vault.getName(),this.plugin.settings.defaultFolder,this.liteTitle,this.liteContent,this.app.vault.configDir);el.createEl('a',{text:'Abrir en Obsidian',href});}catch(e){new Notice((e as Error).message);}}));
      }else if(this.plugin.settings.transport==='relay'){
        el.createEl('p',{text:'Elige carpetas en el paso 2 antes de emparejar. Usa un relay HTTPS de confianza. El operador puede ver las notas en tránsito. El relay guarda temporalmente las solicitudes. La conexión puede revocarse en cualquier momento. No compartas el código de emparejamiento.'});
        new Setting(el).setName('Dirección del relay').addText(t=>t.setPlaceholder('https://tu-relay.example').setValue(this.plugin.settings.relay).onChange(async v=>{this.plugin.settings.relay=v.trim();this.pairCode='';await this.plugin.persist();}));
        new Setting(el).setName('Secreto del dispositivo').setDesc('Usa un nombre distinto por dispositivo; no sincronices las credenciales. Solo minúsculas, números y guiones.').addText(t=>t.setValue(this.plugin.settings.relaySecret).onChange(async v=>{try{this.plugin.settings.relaySecret=secretId(v);this.pairCode='';await this.plugin.persist();}catch(e){new Notice((e as Error).message);}}));
        new Setting(el).setName('Conectar con ChatGPT').setDesc('Añade la URL del relay terminada en /mcp como servidor MCP en ChatGPT web, con OAuth. Pega el código solo en la página de autorización del relay.').addButton(b=>b.setButtonText('Obtener código').onClick(async()=>{try{this.pairCode=await this.plugin.pairRelay();this.render();}catch(e){new Notice((e as Error).message);}})).addButton(b=>b.setButtonText('Revocar conexión').onClick(async()=>{try{await this.plugin.revokeRelay();this.pairCode='';this.render();}catch(e){new Notice((e as Error).message);}}));
        if(this.pairCode){const code=el.createEl('textarea');code.value=this.pairCode;code.readOnly=true;code.setAttribute('aria-label','Código de emparejamiento, caduca en cinco minutos');el.createEl('p',{text:'Código de un solo uso, válido 5 minutos. No lo pegues en una conversación.'});}
      }else{
      el.createEl('h3',{text:'1. Conectar GitHub en este dispositivo'});
      el.createEl('p',{text:'Configura tu repositorio GitHub y la rama. El complemento utiliza la bóveda actualmente abierta.'});
      el.createEl('p',{text:'Crea un token fine-grained para este repositorio con Contents: Read-only. Después guárdalo con el selector de secretos. No pegues el token en ChatGPT.'});
      el.createEl('a',{text:'Abrir creación de token en GitHub',href:'https://github.com/settings/personal-access-tokens/new'});
      new Setting(el).setName('Repositorio').setDesc('Formato usuario/repositorio.').addText(t=>t.setPlaceholder('usuario/mi-inbox').setValue(this.plugin.settings.repository).onChange(async v=>{this.plugin.settings.repository=v.trim();this.result='';await this.plugin.persist();}));
      new Setting(el).setName('Rama').addText(t=>t.setValue(this.plugin.settings.branch).onChange(async v=>{this.plugin.settings.branch=v.trim();this.result='';await this.plugin.persist();}));
      new Setting(el).setName('Secreto de GitHub').setDesc('Usa un secreto propio de ChatGPT Inbox, configurado en cada dispositivo.').addComponent(c=>new SecretComponent(this.app,c).setValue(this.plugin.settings.secret).onChange(async value=>{
        this.plugin.settings.secret=value??'';this.result='';await this.plugin.persist();
      }));
      new Setting(el).setName('Probar conexión').setDesc(this.result||'Solo comprueba acceso; no importa notas.').addButton(b=>b.setButtonText(this.busy?'Comprobando…':'Probar conexión').setDisabled(this.busy).onClick(async()=>{
        this.busy=true;this.render();try{const n=await this.plugin.checkConnection();this.result=`Conexión correcta: ${n} solicitud(es) en la bandeja.`;}catch(e){this.result=e instanceof Error?e.message:'No se pudo conectar.';}finally{this.busy=false;this.render();}
      }));
      }
    }else if(this.step===1){
      el.createEl('h3',{text:'2. Elegir dónde se pueden crear notas'});
      el.createEl('p',{text:'Elige toda la bóveda actual o carpetas concretas y sus subcarpetas. El nombre de la bóveda no forma parte de la ruta de destino.'});
      if(this.plugin.settings.transport==='lite')el.createEl('p',{text:'En Lite, la carpeta elegida es el destino del enlace. Los permisos del plugin no se aplican a ese enlace.'});
      folderControls(el,this.plugin,()=>this.render());
    }else{
      el.createEl('h3',{text:'3. Listo para recibir'});
      el.createEl('p',{text:`Ámbito: ${this.plugin.settings.wholeVault?'toda la bóveda actual':this.plugin.settings.roots.join(', ')||'ninguna'}. Destino por defecto: ${this.plugin.settings.defaultFolder}. Comprueba la conexión antes de activar. La sincronización de la bóveda no se modifica.`});
      el.createEl('p',{text:'Al activar, las solicitudes anteriores aún no entregadas también se importarán si están permitidas. Las notas distintas existentes se conservan.'});
      if(this.plugin.settings.transport==='lite'){el.createEl('p',{text:'Lite está listo: vuelve al paso 1 para generar un enlace. No activa recepción automática.'});}
      else {new Setting(el).setName('Activar recepción en este ajuste').setDesc('Se guarda con la configuración del plugin; La sincronización externa puede copiar ajustes entre dispositivos. El secreto debe existir en cada uno.').addButton(b=>b.setButtonText('Comprobar y activar').setCta().setDisabled(this.busy||(!this.plugin.settings.wholeVault&&this.plugin.settings.roots.length===0)).onClick(async()=>{
        this.busy=true;this.render();try{await this.plugin.checkConnection();if(this.closed||this.plugin.stopped)return;this.plugin.settings.enabled=true;await this.plugin.persist();new Notice('ChatGPT Inbox Community preparado.');this.close();await this.plugin.poll(true);new InboxModal(this.plugin).open();}catch(e){this.result=e instanceof Error?e.message:'No se pudo activar.';this.busy=false;this.render();}
      }));
      if(this.result)el.createEl('p',{text:this.result});}
      new Setting(el).addButton(b=>b.setButtonText('Cerrar sin activar').onClick(()=>this.close()));
    }
    const nav=new Setting(el);
    if(this.step>0)nav.addButton(b=>b.setButtonText('Atrás').setDisabled(this.busy).onClick(()=>{this.step--;this.result='';this.render();}));
    if(this.step<2)nav.addButton(b=>b.setButtonText('Siguiente').setDisabled(this.busy).onClick(()=>{this.step++;this.result='';this.render();}));
  }
}

export class InboxModal extends Modal {
  closed=false;private unsubscribe?:()=>void;
  constructor(private plugin:Inbox){super(plugin.app);}
  onOpen(){this.closed=false;this.unsubscribe=this.plugin.onUpdate(()=>this.render());this.render();}
  onClose(){this.closed=true;this.unsubscribe?.();this.unsubscribe=undefined;this.contentEl.empty();}
  render(){if(this.closed)return;const el=this.contentEl;el.empty();this.setTitle('Bandeja de ChatGPT Community');
    el.createEl('p',{text:this.plugin.status});
    new Setting(el).addButton(b=>b.setButtonText(this.plugin.running?'Comprobando…':'Recibir ahora').setDisabled(this.plugin.running).setCta().onClick(async()=>{const run=this.plugin.poll(true);this.render();await run;this.render();})).addButton(b=>b.setButtonText('Configurar').onClick(()=>{this.close();new SetupModal(this.plugin).open();}));
    if(!this.plugin.history.length)el.createEl('p',{text:'Todavía no hay entregas registradas en este historial. Pulsa Recibir ahora. El registro de deduplicación de versiones anteriores se conserva.'});
    for(const item of [...this.plugin.history].reverse()){
      const row=new Setting(el).setName(item.path||item.source).setDesc(`${item.state} · ${new Date(item.time).toLocaleString()}${item.detail?' · '+item.detail:''}`);
      if(item.path&&(item.state==='Importada'||item.state==='Ya entregada'))row.addButton(b=>b.setButtonText('Abrir nota').onClick(async()=>{
        try{const file=await this.plugin.resolveNote(item);await openInboxNote(this.app,file.path,()=>this.close());}
        catch(e){new Notice(e instanceof Error?e.message:'No se pudo localizar la nota.');}
      }));
    }
    el.createEl('p',{text:'Últimas 100 solicitudes. El historial guarda rutas y estados, nunca el contenido ni el token. Los conflictos se resuelven enviando una solicitud con otro nombre.'});
  }
}

export class InstructionsModal extends Modal {
  constructor(private plugin:Inbox){super(plugin.app);}
  onOpen(){this.setTitle('Instrucción para ChatGPT');
    if(this.plugin.settings.transport==='lite'){
      this.contentEl.createEl('p',{text:'Modo Lite: crea un enlace y ábrelo en el dispositivo con Obsidian. No hay recepción automática ni recibo remoto.'});
      const text=`Devuelve un enlace obsidian://new para la bóveda ${JSON.stringify(this.app.vault.getName())}, carpeta ${JSON.stringify(this.plugin.settings.defaultFolder)} y el título y contenido que te indique. Codifica cada parámetro URI por separado. No incluyas overwrite ni append. El enlace se abre con un toque y no ofrece confirmación remota de entrega.`;
      this.showInstruction(text);return;
    }
    this.contentEl.createEl('p',{text:this.plugin.settings.transport==='relay'?'Copia esta instrucción en una conversación que tenga conectadas las herramientas de ChatGPT Inbox.':'Modo avanzado: usa una conversación con una herramienta que pueda escribir en tu repositorio GitHub.'});
    const text=this.plugin.settings.transport==='relay'?`Usa ChatGPT Inbox: primero listar_carpetas; después crear_nota(carpeta, titulo, contenido, clave única para reintentos). Consulta consultar_estado(id). Solo delivered confirma que el plugin verificó la nota. Si está queued, abre Obsidian y comprueba otra vez. No afirmes entrega sin recibo.`:`Para guardar en Obsidian, usa exclusivamente GitHub: ${this.plugin.settings.repository||'<usuario/repositorio>'}, rama ${this.plugin.settings.branch}. Crea un archivo nuevo chatgpt-inbox/requests/<id-unico>.json con exactamente {"version":1,"id":"<id-unico>","path":"<ruta relativa .md>","content":"<Markdown>"}. ID nuevo con letras, números y guiones. Carpetas permitidas: ${this.plugin.settings.wholeVault?'toda la bóveda actual':this.plugin.settings.roots.join(', ')||'ninguna; configurar primero'}. Destino por defecto: ${this.plugin.settings.defaultFolder}. Las rutas son relativas a la bóveda, por ejemplo ${this.plugin.settings.defaultFolder}/Nota.md; no añadas el nombre de la bóveda. No crees Markdown directamente en GitHub ni cambies archivos existentes. Relee el JSON para verificar. Si no tienes escritura en GitHub, indícalo.`;
    this.showInstruction(text);
  }
  private showInstruction(text:string){
    const area=this.contentEl.createEl('textarea');area.value=text;area.rows=12;area.setAttribute('aria-label','Instrucción para copiar');area.addClass('chatgpt-inbox-instructions');
    new Setting(this.contentEl).addButton(b=>b.setButtonText('Copiar').setCta().onClick(async()=>{try{await navigator.clipboard.writeText(text);new Notice('Instrucción copiada.');}catch{area.focus();area.select();new Notice('Selecciona y copia el texto.');}}));
  }
  onClose(){this.contentEl.empty();}
}

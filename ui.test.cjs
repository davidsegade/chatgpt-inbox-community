const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');

// Exercise compiled modal callbacks using the Obsidian public component contract.
// This checks navigation and retained user input, not native rendering or iOS.
function harness(){
 class Element{
  constructor(root){this.root=root||this;this.nodes=[];this.settings=[];}
  empty(){this.nodes=[];this.settings=[];}
  createEl(tag,props={}){const node=new Element(this.root);Object.assign(node,{tag,...props});this.nodes.push(node);return node;}
  setAttribute(){}addClass(){}focus(){}select(){}
 }
 class Control{
  setValue(value){this.value=value;return this;}setPlaceholder(){return this;}
  setButtonText(text){this.text=text;return this;}setCta(){return this;}
  setDisabled(value){this.disabled=value;return this;}addOptions(){return this;}
  onClick(fn){this.click=fn;return this;}onChange(fn){this.change=fn;return this;}
 }
 class Setting{
  constructor(el){this.el=el;this.buttons=[];this.texts=[];el.settings.push(this);}
  setName(name){this.name=name;return this;}setDesc(){return this;}setHeading(){return this;}
  addButton(fn){const c=new Control();this.buttons.push(c);fn(c);return this;}
  addText(fn){const c=new Control();this.texts.push(c);fn(c);return this;}
  addDropdown(fn){fn(new Control());return this;}addToggle(fn){fn(new Control());return this;}
  addComponent(fn){fn({});return this;}
 }
 class Modal{constructor(app){this.app=app;this.contentEl=new Element();}setTitle(t){this.title=t;}close(){this.onClose();}open(){this.onOpen();}}
 const api={Modal,Setting,FuzzySuggestModal:class{},TFile:class{},TFolder:class{},SecretComponent:Control,Notice:class{}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync('ui.cjs','utf8'),{module:mod,exports:mod.exports,require:name=>{assert.equal(name,'obsidian');return api;},TextEncoder,URL,Uint8Array});
 const plugin={app:{vault:{getName:()=> 'Community Test',configDir:'.obsidian',getAllLoadedFiles:()=>[]}},settings:{transport:'lite',wholeVault:false,roots:['ChatGPT Inbox'],defaultFolder:'ChatGPT Inbox',relay:'',relaySecret:'test-secret'},persist:async()=>{},permissionsChanged:async()=>{},stopped:false};
 const setup=new mod.exports.SetupModal(plugin);
 const buttons=modal=>modal.contentEl.settings.flatMap(s=>s.buttons);
 const click=async(modal,label)=>{const b=buttons(modal).find(b=>b.text===label);assert.ok(b,`Missing button: ${label}`);assert.notEqual(b.disabled,true);await b.click();};
 return {plugin,setup,InstructionsModal:mod.exports.InstructionsModal,buttons,click};
}

test('Lite permite volver desde el último paso y cerrar sin activar recepción',async()=>{
 const h=harness();h.setup.step=2;h.setup.onOpen();
 assert.ok(!h.buttons(h.setup).some(b=>b.text==='Comprobar y activar'));
 await h.click(h.setup,'Atrás');assert.equal(h.setup.step,1);
 await h.click(h.setup,'Atrás');assert.equal(h.setup.step,0);
 await h.click(h.setup,'Siguiente');await h.click(h.setup,'Siguiente');
 await h.click(h.setup,'Cerrar sin activar');assert.equal(h.setup.closed,true);assert.notEqual(h.plugin.settings.enabled,true);
});

test('Lite conserva título y contenido al cambiar pasos y genera el enlace exacto',async()=>{
 const h=harness();h.setup.onOpen();
 const text=h.setup.contentEl.settings.find(s=>s.name==='Título').texts[0];text.change('Árbol de prueba');
 const area=h.setup.contentEl.nodes.find(n=>n.tag==='textarea');area.value='# Texto 👋\nSegunda línea';area.oninput();
 await h.click(h.setup,'Siguiente');await h.click(h.setup,'Siguiente');await h.click(h.setup,'Atrás');await h.click(h.setup,'Atrás');
 assert.equal(h.setup.contentEl.settings.find(s=>s.name==='Título').texts[0].value,'Árbol de prueba');
 assert.equal(h.setup.contentEl.nodes.find(n=>n.tag==='textarea').value,area.value);
 await h.click(h.setup,'Generar enlace');
 const link=h.setup.contentEl.nodes.find(n=>n.tag==='a');const u=new URL(link.href);
 assert.equal(u.protocol,'obsidian:');assert.equal(u.searchParams.get('vault'),'Community Test');
 assert.equal(u.searchParams.get('file'),'ChatGPT Inbox/Árbol de prueba');assert.equal(u.searchParams.get('content'),area.value);
 assert.equal(u.searchParams.has('overwrite'),false);assert.equal(u.searchParams.has('append'),false);
});

test('las instrucciones Lite piden un enlace local sin flujo GitHub ni recibo remoto',()=>{
 const h=harness();const modal=new h.InstructionsModal(h.plugin);modal.onOpen();
 const text=modal.contentEl.nodes.find(n=>n.tag==='textarea').value;
 assert.match(text,/obsidian:\/\/new/);assert.match(text,/Community Test/);assert.doesNotMatch(text,/GitHub|crear_nota/);
 assert.match(text,/no ofrece confirmación remota/);
});

test('relay conserva la activación y la navegación en el último paso',()=>{
 const h=harness();h.plugin.settings.transport='relay';h.setup.step=2;h.setup.onOpen();
 assert.ok(h.buttons(h.setup).some(b=>b.text==='Comprobar y activar'));assert.ok(h.buttons(h.setup).some(b=>b.text==='Atrás'));
});

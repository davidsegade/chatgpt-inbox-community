import {App,TFile,Notice} from 'obsidian';

/** Open an existing file, never resolve a link that could create a new note. */
export async function openInboxNote(app:App,path:string,closeInbox:()=>void):Promise<boolean>{
  const file=app.vault.getAbstractFileByPath(path);
  if(!(file instanceof TFile))return false;
  try{
    closeInbox();
    // Obsidian has no public settings-close API. Guard this narrow compatibility
    // adapter; file opening itself uses the public Workspace/Vault APIs.
    const settings=(app as App & {setting?:{close?:()=>void}}).setting;
    if(typeof settings?.close==='function')settings.close();
    const leaf=app.workspace.getLeaf(false);
    await leaf.openFile(file,{active:true});
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf,{focus:true});
    if(typeof settings?.close!=='function')new Notice('Nota abierta. Si los ajustes siguen encima, ciérralos para verla.');
    return true;
  }catch{new Notice('No se pudo abrir la nota. Prueba a abrirla desde el explorador de Obsidian.');return true;}
}

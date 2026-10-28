export type FailureCode='network'|'timeout'|'reconnect'|'rate-limit'|'server'|'configuration'|'background'|'relay-update'|'pairing-pending'|'storage';
export class ReceptionError extends Error {
  constructor(public code:FailureCode,public httpStatus?:number){super(code);}
}
export function failureText(code:FailureCode):string {
  switch(code){
    case 'network':return 'No hay conexión con el servidor. Comprueba internet y vuelve a intentarlo.';
    case 'timeout':return 'El servidor no respondió a tiempo. Puedes reintentar; se conserva la protección contra duplicados.';
    case 'reconnect':return 'La conexión necesita autorización. Abre configurar y vuelve a conectar este dispositivo.';
    case 'rate-limit':return 'El servidor pide esperar antes de volver a comprobar.';
    case 'server':return 'El servidor no está disponible temporalmente. La recepción volverá a intentarlo.';
    case 'background':return 'Recepción en espera. Vuelve a Obsidian para continuar.';
    case 'relay-update':return 'El relay todavía no admite la nota de prueba. Su operador debe actualizarlo a 0.4.4 o posterior; la recepción normal sigue disponible.';
    case 'pairing-pending':return 'Todavía falta autorizar la conexión en el cliente. Abre el paso 1 y completa la autorización del relay antes de activar.';
    case 'storage':return 'No se pudo guardar el estado local. Comprueba el espacio y el acceso a la bóveda antes de reintentar; todavía no se confirma la entrega.';
    case 'configuration':return 'Revisa la conexión, las carpetas permitidas y el destino por defecto en configurar.';
  }
}
export function retryDelay(failures:number):number{return Math.min(900000,60000*2**Math.min(4,Math.max(0,failures-1)));}
// requestUrl cannot abort a socket. A deadline releases the receiver; a late
// response only settles this abandoned promise and can never trigger a write.
export function withDeadline<T>(request:Promise<T>,timeoutMs=20000,timers:Pick<Window,'setTimeout'|'clearTimeout'>=window,signal?:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    let cleaned=false;
    const cleanup=()=>{if(cleaned)return;cleaned=true;timers.clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();const reason:unknown=signal?.reason;reject(reason instanceof ReceptionError?reason:new ReceptionError('background'));};
    const timer=timers.setTimeout(()=>{cleanup();reject(new ReceptionError('timeout'));},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    void request.then(value=>{cleanup();resolve(value);},(error:unknown)=>{cleanup();reject(error instanceof Error?error:new ReceptionError('network'));});
  });
}

export function historyPresentation(state:string,receiptPending=false):{label:string;help:string}{
  if(state==='Guardada sin recibo')return {label:'Esperando confirmación',help:'La nota está guardada y verificada localmente; falta el recibo del relay. Pulsa recibir ahora para reintentarlo sin duplicarla.'};
  if(state==='Importada'||state==='Ya entregada')return {label:'Entregada',help:'La nota se verificó en esta bóveda.'};
  if(state==='Conflicto')return {label:'Conflicto',help:'Se conserva el archivo existente. Envía la nota con otro título.'+(receiptPending?' Falta comunicar el conflicto al relay.':'')};
  if(state==='Bloqueada')return {label:'Requiere revisión',help:'Comprueba las carpetas permitidas y el formato de la solicitud.'};
  return {label:'Esperando',help:'Todavía no hay una entrega confirmada.'};
}

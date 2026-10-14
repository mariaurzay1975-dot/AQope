/* Shared-state concurrency and durable, per-tab recovery. Loaded after app definitions. */
const sharedMerge=window.AquarelleSharedMerge;
let sharedBase=null, sharedConflict=null, sharedLoading=false, sharedJournalQueue=Promise.resolve();
let sharedTab=sessionStorage.getItem('aq-sync-tab');
if(!sharedTab){sharedTab=crypto.randomUUID();sessionStorage.setItem('aq-sync-tab',sharedTab);}
function sharedDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open('aquarelle-sync-recovery',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('copies',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function sharedRecords(){
  const db=await sharedDB();
  try{return await new Promise((resolve,reject)=>{const req=db.transaction('copies').objectStore('copies').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
}
function sharedBackup(local,reason='pending',remote=null){
  if(!supabaseUser)return Promise.resolve();
  const user=supabaseUser.id;
  const record={id:reason==='pending'?`${user}:${sharedTab}:pending`:`${user}:${sharedTab}:${crypto.randomUUID()}`,user,tab:sharedTab,reason,at:new Date().toISOString(),base:sharedMerge.copy(sharedBase),version:supabaseStateVersion,local:sharedMerge.copy(local),remote:sharedMerge.copy(remote)};
  const task=sharedJournalQueue.catch(()=>{}).then(async()=>{
    const db=await sharedDB();
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('copies','readwrite');tx.objectStore('copies').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('No se pudo conservar la copia'));});}finally{db.close();}
  });
  sharedJournalQueue=task;
  return task;
}
function sharedAdopt(state){
  const key=state.activeWeekKey, view=groupView;
  const draft=productionWeeklyDraft, draftDirty=productionWeeklyDirty;
  const previous=suppressSupabaseAutoSave;
  suppressSupabaseAutoSave=true;
  try{
    applyAppState(sharedMerge.copy(state));
    if(weekSnapshots[key])applyWeekSnapshot({...weekSnapshots[key],key});
    groupView=view;productionWeeklyDraft=draft;productionWeeklyDirty=draftDirty;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(buildAppState()));
    // Keep the open editor and the focused field intact while saving in background.
    if(!document.querySelector('.modal-overlay.open') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))refreshAppAfterCloudLoad();
  }finally{suppressSupabaseAutoSave=previous;}
}
async function sharedRead(){
  const {data,error}=await supabaseClient.from('app_states').select('state,version,updated_at,updated_by').eq('week_key',SUPABASE_STATE_KEY).maybeSingle();
  if(error)throw error;
  return data;
}
function sharedButton(text,action){const b=document.createElement('button');b.type='button';b.className='btn btn-ghost';b.textContent=text;b.onclick=action;return b;}
function sharedDownload(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function sharedDialog(title){
  const dialog=document.createElement('dialog');dialog.style.cssText='width:min(850px,90vw);max-height:85vh;overflow:auto;border:1px solid #ccc;border-radius:14px;padding:24px';
  const h=document.createElement('h2');h.textContent=title;dialog.append(h);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());return dialog;
}
async function showSharedRecovery(){
  try{
    await sharedJournalQueue;
    const records=(await sharedRecords()).filter(r=>r.user===supabaseUser?.id).sort((a,b)=>b.at.localeCompare(a.at));
    const d=sharedDialog('Copias de recuperación de este navegador');
    const p=document.createElement('p');p.textContent='Descarga una copia antes de recuperar datos. Estas copias pertenecen a este navegador; la copia de tu compañera se consulta en su ordenador.';d.append(p);
    records.forEach(r=>{const row=document.createElement('p');row.textContent=`${new Date(r.at).toLocaleString('es-ES')} · ${r.reason} `;row.append(sharedButton('Descargar mi copia',()=>sharedDownload(r.local,`aquarelle-recuperacion-${r.at.replace(/[:.]/g,'-')}.json`)));if(r.remote)row.append(sharedButton('Descargar copia compartida',()=>sharedDownload(r.remote,'aquarelle-copia-compartida.json')));d.append(row);});
    if(!records.length){const p=document.createElement('p');p.textContent='Todavía no hay copias en este navegador.';d.append(p);}
    d.append(sharedButton('Cerrar',()=>d.close()));d.showModal();
  }catch(error){alert('No se pudieron leer las copias: '+error.message);}
}
function showSharedConflicts(){
  if(!sharedConflict)return;
  const context=sharedConflict,choices={};
  const d=sharedDialog('Hay cambios en el mismo dato');
  const p=document.createElement('p');p.textContent='Los cambios compatibles se combinarán. Elige qué versión usar en cada conflicto. Ambas copias están conservadas en Copias de recuperación. Si lo dejas pendiente, tus cambios siguen en este navegador y no se sustituyen.';d.append(p);
  context.conflicts.forEach(c=>{
    const section=document.createElement('section');section.style.cssText='border-top:1px solid #ddd;padding:12px 0';
    const h=document.createElement('h3');h.textContent=c.path.map(part=>part==='bouquets'?'Ramo':part).join(' / ');section.append(h);
    for(const [label,value] of [['Mi cambio',c.local],['Cambio compartido',c.remote]]){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent=label;pre.style.cssText='white-space:pre-wrap;max-height:200px;overflow:auto';pre.textContent=value===undefined?'Eliminado':JSON.stringify(value,null,2);details.append(summary,pre);section.append(details);}
    const select=document.createElement('select');select.setAttribute('aria-label',c.path.join(' / '));for(const [v,t] of [['','Elegir versión…'],['local','Usar mi cambio'],['remote','Usar cambio compartido']]){const o=document.createElement('option');o.value=v;o.textContent=t;select.append(o);}select.onchange=()=>{choices[c.id]=select.value;};section.append(select);d.append(section);
  });
  d.append(sharedButton('Conservar pendiente',()=>d.close()));
  d.append(sharedButton('Combinar y guardar',async()=>{
    if(context.conflicts.some(c=>!choices[c.id])){alert('Elige una versión para cada conflicto.');return;}
    try{
      const local=sharedMerge.copy(buildAppState());
      const result=sharedMerge.merge(context.base,local,context.remote.state,choices);
      if(result.conflicts.length){alert('Hay cambios nuevos. Revisa los conflictos actualizados.');d.close();sharedConflict={...context,conflicts:result.conflicts};showSharedConflicts();return;}
      await sharedBackup(local,'before-resolution',context.remote.state);
      sharedAdopt(result.state);sharedBase=sharedMerge.copy(context.remote.state);supabaseStateVersion=context.remote.version;sharedConflict=null;
      await sharedBackup(buildAppState());d.close();await saveStateToSupabase();
    }catch(error){alert('No se pudo guardar la resolución: '+error.message);}
  }));d.showModal();
}
async function sharedHold(base,local,remote,conflicts){
  await sharedBackup(local,'conflict',remote.state);
  sharedConflict={base:sharedMerge.copy(base),remote:sharedMerge.copy(remote),conflicts};
  clearTimeout(supabaseSaveTimer);
  setSaveStatus('Cambios conservados · revisar conflicto','warn');
  document.getElementById('sharedConflictButton').hidden=false;
  showSharedConflicts();
}
// Replace the legacy reload-on-conflict path. Every write still uses an atomic
// version predicate; a merge never bypasses the server's concurrency check.
saveStateToSupabase=async function(){
  if(!supabaseUser||!cloudSyncEnabled||suppressSupabaseAutoSave||sharedLoading||sharedConflict)return false;
  if(supabaseSaveInProgress){supabaseSavePending=true;return false;}
  supabaseSaveInProgress=true;
  const user=supabaseUser.id;
  try{
    if(!sharedBase)throw new Error('Carga primero los datos compartidos para combinar con seguridad.');
    for(let attempt=0;attempt<5;attempt++){
      const remote=await sharedRead();
      if(!remote)throw new Error('No se encuentra la versión compartida. Se conserva tu copia local.');
      if(supabaseUser?.id!==user)return false;
      const local=sharedMerge.copy(buildAppState()),base=sharedMerge.copy(sharedBase);
      await sharedBackup(local);
      const result=sharedMerge.merge(base,local,remote.state);
      if(result.conflicts.length){await sharedHold(base,local,remote,result.conflicts);return false;}
      let rows=[{version:remote.version}];
      if(!sharedMerge.equal(sharedMerge.canonical(result.state),sharedMerge.canonical(remote.state))){
        const response=await supabaseClient.from('app_states').update({state:result.state,version:remote.version+1,updated_by:user,updated_at:new Date().toISOString()}).eq('week_key',SUPABASE_STATE_KEY).eq('version',remote.version).select('version');
        if(response.error)throw response.error;
        rows=response.data;
      }
      if(!rows?.length)continue;
      if(supabaseUser?.id!==user)return false;
      // Edits made while the request was in flight are rebased, never replaced.
      const current=sharedMerge.copy(buildAppState());
      const after=sharedMerge.merge(local,current,result.state);
      sharedBase=sharedMerge.copy(result.state);supabaseStateVersion=rows[0].version;
      if(after.conflicts.length){await sharedHold(local,current,{state:result.state,version:rows[0].version},after.conflicts);return false;}
      sharedAdopt(after.state);
      await sharedBackup(buildAppState());
      document.getElementById('sharedConflictButton').hidden=true;
      setSaveStatus(`Compartido guardado ${new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`);
      if(!sharedMerge.equal(sharedMerge.canonical(after.state),sharedMerge.canonical(result.state)))supabaseSavePending=true;
      return true;
    }
    setSaveStatus('Hay más cambios · reintentando','warn');supabaseSavePending=true;return false;
  }catch(error){console.error('No se pudo combinar y guardar',error);setSaveStatus('Pendiente de guardar · copia local conservada','warn');return false;}
  finally{supabaseSaveInProgress=false;if(supabaseSavePending&&!sharedConflict){supabaseSavePending=false;scheduleSupabaseAutoSave();}}
};
loadStateFromSupabase=async function(){
  if(!supabaseUser||supabaseSaveInProgress||sharedLoading)return false;
  if(sharedConflict){showSharedConflicts();return false;}
  sharedLoading=true;clearTimeout(supabaseSaveTimer);
  try{
    const user=supabaseUser.id;
    const records=await sharedRecords();
    const pending=records.find(r=>r.id===`${user}:${sharedTab}:pending`);
    const local=sharedMerge.copy(buildAppState());
    // Preserve the pre-update browser copy even if its baseline is unknown.
    await sharedBackup(local,'before-load');
    const remote=await sharedRead();
    if(!remote){setSaveStatus('Supabase todavía está vacío','warn');return false;}
    if(supabaseUser?.id!==user)return false;
    const base=sharedBase||pending?.base;
    const mine=sharedBase?sharedMerge.copy(buildAppState()):(pending?.base?pending.local:local);
    const result=base?sharedMerge.merge(base,mine,remote.state):{state:remote.state,conflicts:[]};
    if(result.conflicts.length){sharedAdopt(mine);cloudSyncEnabled=true;sharedBase=sharedMerge.copy(base);await sharedHold(base,mine,remote,result.conflicts);return false;}
    const duringLoad=sharedMerge.merge(local,sharedMerge.copy(buildAppState()),result.state);
    if(duringLoad.conflicts.length){cloudSyncEnabled=true;sharedBase=sharedMerge.copy(local);await sharedHold(local,buildAppState(),{...remote,state:result.state},duringLoad.conflicts);return false;}
    result.state=duringLoad.state;
    sharedAdopt(result.state);sharedBase=sharedMerge.copy(remote.state);supabaseStateVersion=remote.version;cloudSyncEnabled=true;
    localStorage.setItem(SUPABASE_MIGRATED_FLAG,'1');
    document.getElementById('migrationOverlay')?.classList.remove('visible');
    await sharedBackup(buildAppState());
    refreshAppAfterCloudLoad();setSaveStatus('Datos compartidos cargados');return true;
  }finally{sharedLoading=false;if(cloudSyncEnabled&&!sharedConflict)scheduleSupabaseAutoSave();}
};
const sharedOriginalSave=saveState;
saveState=function(){const ok=sharedOriginalSave();if(sharedConflict)setSaveStatus('Cambios conservados · revisar conflicto','warn');if(ok&&supabaseUser&&!suppressSupabaseAutoSave)sharedBackup(buildAppState()).catch(error=>{console.error(error);setSaveStatus('No se pudo conservar la copia de recuperación','warn');});return ok;};
const sharedOriginalMigrate=uploadMigrationCandidate;
uploadMigrationCandidate=async function(){await sharedOriginalMigrate();if(cloudSyncEnabled&&supabaseStateVersion!==null){sharedBase=sharedMerge.copy(buildAppState());await sharedBackup(buildAppState());}};
// The web application must not load an old OneDrive file over shared data.
const sharedOldOneDriveLoad=loadStateFromOneDrive;
loadStateFromOneDrive=async function(options={}){if(location.protocol==='https:'||cloudSyncEnabled)return false;return sharedOldOneDriveLoad(options);};
const sharedOldOneDriveWrite=writeStateToOneDrive;
writeStateToOneDrive=async function(handle,options={}){if(location.protocol==='https:'||cloudSyncEnabled)return saveStateToSupabase();return sharedOldOneDriveWrite(handle,options);};
const sharedOldOneDriveSchedule=scheduleOneDriveAutoSave;
scheduleOneDriveAutoSave=function(){if(location.protocol==='https:'||cloudSyncEnabled)return;sharedOldOneDriveSchedule();};
const sharedOldOneDriveInit=initOneDriveAutoSave;
initOneDriveAutoSave=async function(){if(location.protocol==='https:'||cloudSyncEnabled)return;return sharedOldOneDriveInit();};
const sharedRecoveryButton=sharedButton('Copias de recuperación',showSharedRecovery);
const sharedConflictButton=sharedButton('Revisar conflicto',showSharedConflicts);sharedConflictButton.id='sharedConflictButton';sharedConflictButton.hidden=true;
document.getElementById('cloudUser')?.append(sharedRecoveryButton,sharedConflictButton);
window.addEventListener('online',()=>{if(cloudSyncEnabled)scheduleSupabaseAutoSave();});
window.addEventListener('beforeunload',event=>{
  if(sharedConflict || (sharedBase&&!sharedMerge.equal(sharedMerge.canonical(buildAppState()),sharedMerge.canonical(sharedBase)))){event.preventDefault();event.returnValue='';}
});
// Reset baselines between users; recovery records remain scoped to their owner.
supabaseClient.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT'){sharedBase=null;sharedConflict=null;clearTimeout(supabaseSaveTimer);cloudSyncEnabled=false;}});
let sharedChecking=false;
async function sharedRefreshWhenIdle(){
  if(sharedChecking||!sharedBase||!cloudSyncEnabled||sharedLoading||supabaseSaveInProgress||sharedConflict||document.visibilityState!=='visible'||document.querySelector('.modal-overlay.open')||productionWeeklyDirty||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  if(!sharedMerge.equal(sharedMerge.canonical(buildAppState()),sharedMerge.canonical(sharedBase)))return;
  sharedChecking=true;
  try{const remote=await sharedRead();if(remote&&remote.version!==supabaseStateVersion)await loadStateFromSupabase();}catch(error){setSaveStatus('Sin conexión · se conserva la copia local','warn');}finally{sharedChecking=false;}
}
setInterval(sharedRefreshWhenIdle,15000);
window.addEventListener('focus',sharedRefreshWhenIdle);

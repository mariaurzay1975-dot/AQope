const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const M=require('./shared-state-merge');
function harness(server){
  const elements=new Map();const element=()=>({append(){},addEventListener(){},setAttribute(){},showModal(){},close(){},style:{},classList:{remove(){}},value:''});
  const ctx={console:{error(){}},window:{AquarelleSharedMerge:M,addEventListener(){}},document:{createElement:element,body:element(),getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},querySelector(){return null;},activeElement:{tagName:'BODY'},visibilityState:'visible'},sessionStorage:{getItem(){return 'tab';},setItem(){}},localStorage:{setItem(){}},crypto:require('node:crypto').webcrypto,location:{protocol:'https:'},setTimeout(){return 1;},clearTimeout(){},setInterval(){},supabaseUser:{id:'u'},supabaseStateVersion:1,supabaseSaveTimer:null,suppressSupabaseAutoSave:false,supabaseSaveInProgress:false,supabaseSavePending:false,cloudSyncEnabled:true,STORAGE_KEY:'state',SUPABASE_MIGRATED_FLAG:'flag',SUPABASE_STATE_KEY:'global',groupView:false,productionWeeklyDraft:null,productionWeeklyDirty:false,weekSnapshots:{},state:{data:[],stock:{a:0,b:0},nomenclatures:[]},copies:[],statuses:[],scheduled:0,refreshAppAfterCloudLoad(){},applyWeekSnapshot(){},buildAppState(){return M.copy(ctx.state);},applyAppState(s){ctx.state=M.copy(s);},setSaveStatus(s){ctx.statuses.push(s);},scheduleSupabaseAutoSave(){ctx.scheduled++;},saveState(){return true;},saveStateToSupabase(){},loadStateFromSupabase(){},loadStateFromOneDrive(){throw Error('Old OneDrive load called');},writeStateToOneDrive(){throw Error('Old OneDrive write called');},uploadMigrationCandidate(){},alert(){},Blob,URL};
  ctx.supabaseClient={auth:{onAuthStateChange(){}},from(){let values,version;const q={select(){return values?Promise.resolve().then(async()=>{if(server.beforeWrite)await server.beforeWrite(ctx);if(server.fail)throw Error('offline');if(server.version!==version)return {data:[],error:null};server.state=M.copy(values.state);server.version=values.version;server.writes++;if(server.afterWrite)await server.afterWrite(ctx);return {data:[{version:server.version}],error:null};}):q;},eq(key,value){if(key==='version')version=value;return q;},update(v){values=v;return q;},async maybeSingle(){if(server.beforeRead)await server.beforeRead(ctx);if(server.failRead)throw Error('offline');return {data:{state:M.copy(server.state),version:server.version},error:null};}};return q;}};
  ctx.scheduleOneDriveAutoSave=()=>{};ctx.initOneDriveAutoSave=()=>{};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('shared-sync.js','utf8'),ctx);
  vm.runInContext(`sharedBackup=async function(local,reason='pending',remote=null){if(backupFail)throw Error('quota');copies.push({local:sharedMerge.copy(local),base:sharedMerge.copy(sharedBase),reason,remote:sharedMerge.copy(remote)});};sharedRecords=async()=>records;sharedBase=sharedMerge.copy(state);`,Object.assign(ctx,{backupFail:false,records:[]}));
  return ctx;
}
function server(){return {state:{data:[],stock:{a:0,b:0},nomenclatures:[]},version:1,writes:0};}
test('two clients save independent changes without losing either',async()=>{
  const s=server(),a=harness(s),b=harness(s);a.state.stock.a=2;b.state.stock.b=3;
  assert.equal(await a.saveStateToSupabase(),true);assert.equal(await b.saveStateToSupabase(),true);assert.deepEqual(s.state.stock,{a:2,b:3});assert.equal(s.version,3);
});
test('version race retries against the new remote state',async()=>{
  const s=server(),a=harness(s);a.state.stock.a=2;s.beforeWrite=()=>{s.beforeWrite=null;s.version++;s.state.stock.b=9;};
  assert.equal(await a.saveStateToSupabase(),true);assert.deepEqual(s.state.stock,{a:2,b:9});assert.equal(s.writes,1);
});
test('conflict retains local edits and both recovery versions, no reload or overwrite',async()=>{
  const s=server(),a=harness(s);a.state.stock.a=2;s.state.stock.a=4;s.version=2;
  assert.equal(await a.saveStateToSupabase(),false);assert.equal(a.state.stock.a,2);assert.equal(s.state.stock.a,4);assert.equal(s.writes,0);assert.ok(a.copies.some(c=>c.reason==='conflict'&&c.local.stock.a===2&&c.remote.stock.a===4));
  assert.equal(await a.loadStateFromSupabase(),false);assert.equal(a.state.stock.a,2);
});
test('edits made during network request are retained and scheduled',async()=>{
  const s=server(),a=harness(s);a.state.stock.a=2;s.afterWrite=ctx=>{ctx.state.stock.b=8;};
  assert.equal(await a.saveStateToSupabase(),true);assert.equal(s.state.stock.b,0);assert.equal(a.state.stock.b,8);assert.ok(a.scheduled);
});
test('failed write or failed recovery backup does not discard local changes',async()=>{
  for(const failure of ['network','backup']){const s=server(),a=harness(s);a.state.stock.a=2;if(failure==='network')s.fail=true;else a.backupFail=true;assert.equal(await a.saveStateToSupabase(),false);assert.equal(a.state.stock.a,2);assert.equal(s.writes,0);}
});
test('pending journal survives reload and combines with newer remote changes',async()=>{
  const s=server(),a=harness(s),base=M.copy(a.state),pending=M.copy(base);pending.stock.a=7;s.state.stock.b=4;s.version=2;
  a.records=[{id:'u:tab:pending',base,local:pending}];vm.runInContext('sharedBase=null',a);
  assert.equal(await a.loadStateFromSupabase(),true);assert.deepEqual(a.state.stock,{a:7,b:4});assert.ok(a.copies.some(c=>c.reason==='before-load'));assert.equal(s.writes,0);
});
test('read failure leaves local state untouched',async()=>{const s=server(),a=harness(s);a.state.stock.a=3;s.failRead=true;await assert.rejects(a.loadStateFromSupabase());assert.equal(a.state.stock.a,3);});
test('https never loads an obsolete OneDrive state over Supabase',async()=>{const s=server(),a=harness(s);assert.equal(await a.loadStateFromOneDrive(),false);});
test('no-op save does not increment shared version',async()=>{const s=server(),a=harness(s);assert.equal(await a.saveStateToSupabase(),true);assert.equal(s.version,1);assert.equal(s.writes,0);});
test('sign-out while read is in flight does not write',async()=>{const s=server(),a=harness(s);a.state.stock.a=2;s.beforeRead=ctx=>{ctx.supabaseUser=null;};assert.equal(await a.saveStateToSupabase(),false);assert.equal(s.writes,0);});

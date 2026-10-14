// Run with NODE_PATH pointing to a Playwright installation. Uses isolated
// browser contexts and an in-memory fake server; never connects to Supabase.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=__dirname;
const clone=x=>JSON.parse(JSON.stringify(x));
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+(req.url==='/'?'/index.html':req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:process.env.AQ_TEST_BROWSER||'chrome'});
  const errors=[],remote={state:null,version:1};
  try{
    const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
    const pages=[];
    for(const ctx of contexts){
      await ctx.exposeBinding('fakeRead',()=>({data:{state:clone(remote.state),version:remote.version},error:null}));
      await ctx.exposeBinding('fakeWrite',(_source,values,version)=>{if(remote.version!==version)return {data:[],error:null};remote.state=clone(values.state);remote.version=values.version;return {data:[{version:remote.version}],error:null};});
      await ctx.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
      await ctx.addInitScript(()=>{
        window.supabase={createClient:()=>({auth:{async getSession(){return {data:{session:null}};},onAuthStateChange(){return {};},async signOut(){return {};}},from(){let payload,version;const q={select(){return payload?window.fakeWrite(payload,version):q;},eq(k,v){if(k==='version')version=v;return q;},update(v){payload=v;return q;},maybeSingle(){return window.fakeRead();}};return q;}})};
      });
      const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);pages.push(page);
      await page.waitForFunction(()=>typeof sharedBase!=='undefined');
    }
    remote.state=await pages[0].evaluate(()=>JSON.parse(JSON.stringify(buildAppState())));
    for(const page of pages){await page.evaluate(async state=>{applyAppState(state);showAuthenticatedUser({id:'test-user',email:'test@example.invalid'});cloudSyncEnabled=true;sharedBase=JSON.parse(JSON.stringify(state));supabaseStateVersion=1;await sharedBackup(buildAppState());},clone(remote.state));}
    // Separate bouquets, simultaneous saves, actual IndexedDB and app renderer.
    await pages[0].evaluate(()=>{nomenclatures.push(normalizeNomenclatureLine({productCode:'TEST-A',productName:'Ramo A',articleCode:'flower-a',stemsPerBouquet:2}));});
    await pages[1].evaluate(()=>{nomenclatures.push(normalizeNomenclatureLine({productCode:'TEST-B',productName:'Ramo B',articleCode:'flower-b',stemsPerBouquet:3}));});
    const outcomes=await Promise.all(pages.map(p=>p.evaluate(()=>saveStateToSupabase())));assert.deepEqual(outcomes,[true,true]);
    assert.ok(remote.state.nomenclatures.some(n=>n.productCode==='TEST-A'));assert.ok(remote.state.nomenclatures.some(n=>n.productCode==='TEST-B'));
    // Refresh to a common baseline, then force an actual same-bouquet conflict.
    for(const page of pages)await page.evaluate(async()=>{await loadStateFromSupabase();clearTimeout(supabaseSaveTimer);});
    await pages[0].evaluate(()=>{nomenclatures.find(n=>n.productCode==='TEST-A').stemsPerBouquet=5;});
    await pages[1].evaluate(()=>{nomenclatures.find(n=>n.productCode==='TEST-A').stemsPerBouquet=8;});
    assert.equal(await pages[0].evaluate(()=>saveStateToSupabase()),true);
    assert.equal(await pages[1].evaluate(()=>saveStateToSupabase()),false);
    await pages[1].getByRole('heading',{name:'Hay cambios en el mismo dato'}).waitFor();
    assert.equal(await pages[1].evaluate(()=>nomenclatures.find(n=>n.productCode==='TEST-A').stemsPerBouquet),8);
    const backups=await pages[1].evaluate(async()=>(await sharedRecords()).filter(r=>r.reason==='conflict').length);assert.ok(backups>=1);
    await pages[1].locator('dialog select').selectOption('local');await pages[1].getByRole('button',{name:'Combinar y guardar',exact:true}).click();
    await pages[1].waitForFunction(()=>!supabaseSaveInProgress&&!document.querySelector('dialog[open]'));
    assert.equal(remote.state.nomenclatures.find(n=>n.productCode==='TEST-A').stemsPerBouquet,8);
    // Journal recovery after a real browser reload, with unsent local change.
    await pages[1].evaluate(async()=>{nomenclatures.find(n=>n.productCode==='TEST-B').stemsPerBouquet=11;await sharedBackup(buildAppState());});
    await pages[1].reload();await pages[1].evaluate(async()=>{showAuthenticatedUser({id:'test-user',email:'test@example.invalid'});await loadStateFromSupabase();clearTimeout(supabaseSaveTimer);});
    assert.equal(await pages[1].evaluate(()=>nomenclatures.find(n=>n.productCode==='TEST-B').stemsPerBouquet),11);
    assert.deepEqual(errors,[]);
    console.log('PASS: two real app instances, simultaneous saves, conflict UI resolution, IndexedDB backups, reload recovery; no page errors.');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});

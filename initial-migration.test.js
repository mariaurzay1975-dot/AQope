const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Migration=require('./initial-migration.js');

function state(overrides={}){
  return {app:'aquarelle-control-stock',version:6,data:Array.from({length:51},(_,index)=>({producto:`Producto ${index+1}`})),nomenclatures:Array.from({length:268},(_,index)=>({id:`n-${index+1}`})),flowers:Array.from({length:65},(_,index)=>({id:`f-${index+1}`})),weekState:{year:2026,week:33,objetivo:469},weekSnapshots:Object.fromEntries(Array.from({length:11},(_,index)=>[`2026-${23+index}`,{year:2026,week:23+index}])),annualPlanning:{selectedYear:2026,previousYear:2025,comparableYear:2015,projectionSettings:{distributionWindow:8},imports:{'2015':{weeks:{'2015-33':{year:2015,week:33,total:400}}}},years:{'2026':{year:2026,comparableYear:2015,weeks:{'2026-33':{year:2026,week:33,currentForecast:469}}}},changeHistory:[]},productionState:{version:5,tasks:[],weeklyPlans:{}},...overrides};
}

test('prepara una migración con comparableYear y construye la clave semanal',()=>{
  const result=Migration.prepareInitialMigrationPayload(state());assert.equal(result.canUpload,true);assert.deepEqual(result.reference,{comparableYear:2015,comparableKey:'2015-33',exists:true});assert.equal(result.state.annualPlanning.comparableYear,2015);
});

test('sin comparableYear utiliza null y no lanza ReferenceError',()=>{
  const input=state();delete input.annualPlanning.comparableYear;delete input.annualPlanning.years['2026'].comparableYear;
  const result=Migration.prepareInitialMigrationPayload(input);assert.equal(result.canUpload,true);assert.deepEqual(result.reference,{comparableYear:null,comparableKey:null,exists:false});assert.equal(result.state.annualPlanning.comparableYear,null);assert.ok(result.warnings.some(item=>item.code==='COMPARABLE_YEAR_NOT_CONFIGURED'));
});

test('normaliza un annualPlanning antiguo conservando años, semanas e historial',()=>{
  const input=state({annualPlanning:{selectedYear:2026,years:{'2026':{weeks:{'2026-33':{currentForecast:469}}}},changeHistory:[{id:'old'}]}}),result=Migration.prepareInitialMigrationPayload(input);
  assert.equal(result.canUpload,true);assert.equal(result.state.annualPlanning.years['2026'].weeks['2026-33'].currentForecast,469);assert.equal(result.state.annualPlanning.changeHistory[0].id,'old');assert.equal(result.state.annualPlanning.years['2026'].comparableYear,null);assert.equal(result.state.annualPlanning.projectionSettings.distributionWindow,8);
});

test('un JSON sin comparableKey se prepara sin depender de esa propiedad',()=>{
  const input=state();delete input.comparableKey;delete input.annualPlanning.comparableKey;
  assert.doesNotThrow(()=>Migration.prepareInitialMigrationPayload(input));const result=Migration.prepareInitialMigrationPayload(input);assert.equal(result.reference.comparableKey,'2015-33');assert.equal('comparableKey' in result.state,false);
});

test('una semana comparable inexistente solo genera un aviso no bloqueante',()=>{
  const input=state();input.annualPlanning.imports={};
  const result=Migration.prepareInitialMigrationPayload(input);assert.equal(result.canUpload,true);assert.equal(result.reference.exists,false);assert.ok(result.warnings.some(item=>item.code==='COMPARABLE_WEEK_NOT_FOUND'));assert.deepEqual(result.errors,[]);
});

test('el payload conserva semana activa 33/2026, objetivo 469 y todas las colecciones',()=>{
  const input=state(),result=Migration.prepareInitialMigrationPayload(input);assert.equal(result.summary.week,33);assert.equal(result.summary.year,2026);assert.equal(result.summary.objective,469);assert.equal(result.summary.stock,51);assert.equal(result.summary.nomenclatures,268);assert.equal(result.summary.flowers,65);assert.equal(result.summary.weeks,11);assert.deepEqual(result.state.productionState,input.productionState);assert.deepEqual(result.state.weekSnapshots,input.weekSnapshots);
});

test('un fallo de normalización o aplicación local ocurre antes de la primera escritura',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),start=html.indexOf('async function uploadMigrationCandidate()'),end=html.indexOf('\nfunction initMigrationControls()',start),source=html.slice(start,end),preflight=source.indexOf('preflightMigrationCandidateLocally(migrationCandidate)'),firstWrite=Math.min(...[source.indexOf(".update({state:migrationCandidate"),source.indexOf(".insert({week_key:SUPABASE_STATE_KEY")].filter(index=>index>=0));
  assert.ok(preflight>=0&&firstWrite>preflight);assert.match(source,/writtenVersion===null\?'Migración cancelada antes de escribir en Supabase/);
});

test('un fallo de renderizado posterior se identifica y dispone de rollback',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');assert.match(html,/async function rollbackInitialMigrationWrite/);assert.match(html,/await rollbackInitialMigrationWrite\(existing,writtenVersion\)/);assert.match(html,/Escritura completada con fallo local posterior/);assert.match(html,/\.eq\('version',writtenVersion\)/);
});

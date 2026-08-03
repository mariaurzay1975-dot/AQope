const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const production=require('./production.js');

const NOW='2026-07-31T10:00:00.000Z';

function configuredState(){
  let state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  for(const category of production.PRODUCT_CATEGORIES){
    state=production.updateCategoryRate(state,category.code,'reception',category.code==='ROSAS'?120:60,{now:NOW}).state;
    state=production.updateCategoryRate(state,category.code,'preassignment',category.code==='ROSAS'?60:30,{now:NOW}).state;
  }
  return production.updateShippingRate(state,100,{now:NOW}).state;
}

test('separa cuatro tareas principales, categorías existentes y planificación semanal',()=>{
  const state=production.createProductionState(null,{now:NOW});
  assert.equal(state.version,3);
  assert.deepEqual(Object.keys(state.mainTasks),['RECEPTION','PREASSIGNMENT','MANUFACTURING','SHIPPING']);
  assert.deepEqual(production.PRODUCT_CATEGORIES.map(item=>item.code),['ROSAS','COMPUESTOS','SIMPLES','PLANTAS']);
  assert.deepEqual(state.weeklyPlans,{});
  assert.equal('validFrom' in state,false);
  assert.equal('validTo' in state,false);
});

test('carga estados anteriores y convierte duración por personas a horas-persona fijas',()=>{
  const state=production.createProductionState({
    tasks:[
      {id:'old-main',code:'RECEPTION',type:'principal',name:'Recepción antigua',priority:'Alta',mobility:'Fija'},
      {id:'old-satellite',code:'OLD_TASK',type:'satelite',name:'Tarea antigua',calculationType:'duracion_personas',durationHours:2,peopleCount:3,priority:'Normal'}
    ],
    timeHistory:[{id:'old-history',taskId:'old-main',validFrom:'2026-01-01',performance:100}]
  },{now:NOW});
  assert.equal(state.mainTasks.RECEPTION.name,'Recepción antigua');
  assert.equal(state.mainTasks.RECEPTION.priority,'Alta');
  assert.equal(state.satelliteTasks[0].calculationType,'tiempo_fijo');
  assert.equal(state.satelliteTasks[0].durationHours,6);
  assert.equal('peopleCount' in state.satelliteTasks[0],false);
  assert.equal(state.legacy.timeHistory[0].validFrom,'2026-01-01');
});

test('edita prioridad, movilidad, estado y nombre de tareas principales',()=>{
  const state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  const result=production.updateMainTask(state,'RECEPTION',{name:'Entrada de producto',priority:'Alta',mobility:'Fija',active:false},{now:'2026-07-31T11:00:00.000Z',comment:'Ajuste operativo'});
  assert.equal(result.ok,true);
  assert.deepEqual(result.task,{code:'RECEPTION',name:'Entrada de producto',priority:'Alta',mobility:'Fija',active:false,rateMode:'category'});
  assert.equal(result.state.changeHistory.length,4);
  assert.ok(result.state.changeHistory.every(entry=>entry.scope==='main'&&entry.comment==='Ajuste operativo'));
});

test('guarda Recepción y Preasignación por categoría y Expedición global',()=>{
  let state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  state=production.updateCategoryRate(state,'ROSAS','reception','120,5',{now:NOW}).state;
  state=production.updateCategoryRate(state,'ROSAS','preassignment','60.25',{now:NOW}).state;
  state=production.updateShippingRate(state,'35,5',{now:NOW}).state;
  assert.deepEqual(state.categoryRates.ROSAS,{reception:120.5,preassignment:60.25});
  assert.equal(state.shippingRate,35.5);
  assert.ok(state.changeHistory.every(entry=>!('validFrom' in entry)&&!('validTo' in entry)));
});

test('Fabricación continúa por variante, admite decimales y no duplica rendimientos',()=>{
  assert.deepEqual(production.normalizeManufacturingRates(['6','5','4,5'],3),[6,5,4.5]);
  const descriptor=production.manufacturingTaskDescriptor();
  assert.equal(descriptor.source,'nomenclatures');
  assert.equal(descriptor.editable,false);
  assert.equal(descriptor.unit,'unidades / hora / persona');
});

test('las tareas satélite solo admiten Por cantidad o Tiempo fijo',()=>{
  let state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  const quantity=production.addProductionTask(state,{name:'Relleno',code:'FILL',calculationType:'por_cantidad',performance:80,priority:'Media',mobility:'Flexible'},{now:NOW});
  assert.equal(quantity.ok,true);
  assert.equal(production.calculateTaskPersonHours(quantity.task,240),3);
  state=quantity.state;
  const fixed=production.addProductionTask(state,{name:'Inventario',code:'INVENTORY',calculationType:'tiempo_fijo',durationHours:12,priority:'Alta',mobility:'Fija'},{now:NOW});
  assert.equal(fixed.ok,true);
  assert.equal(production.calculateTaskPersonHours(fixed.task),12);
  assert.equal('peopleCount' in fixed.task,false);
  assert.deepEqual(new Set(fixed.state.satelliteTasks.map(task=>task.calculationType)),new Set(['por_cantidad','tiempo_fijo']));
});

test('valida los datos aplicables al crear tareas satélite',()=>{
  const state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  assert.equal(production.addProductionTask(state,{name:'Sin rendimiento',code:'NO_RATE',calculationType:'por_cantidad'}).ok,false);
  assert.equal(production.addProductionTask(state,{name:'Sin horas',code:'NO_HOURS',calculationType:'tiempo_fijo'}).ok,false);
  assert.match(production.taskTimingText({name:'Limpieza',calculationType:'tiempo_fijo',durationHours:2}),/2 h-persona/);
});

test('crea, normaliza y navega semanas ISO independientes',()=>{
  const week=production.createWeeklyPlan(2026,32,{now:NOW});
  assert.equal(week.key,'2026-W32');
  assert.equal(week.status,'draft');
  assert.equal(week.preassignmentDays.monday,'monday');
  assert.equal(week.receptionDays.monday,'');
  assert.deepEqual(production.shiftWeek(2026,53,1),{year:2027,week:1,key:'2027-W01'});
});

test('mantiene previsión sistema, ajuste, mix y decisiones semanales sin mezclar maestros',()=>{
  const plan=production.normalizeWeeklyPlan({
    year:2026,week:32,status:'draft',
    dailyForecast:{monday:{system:100,adjustment:20}},
    bouquetSystem:90,bouquetAdjustment:10,
    categoryMix:{monday:{ROSAS:60,COMPUESTOS:60}},
    preassignmentDays:{monday:'friday'},receptionDays:{monday:'wednesday'},
    satelliteAssignments:[{taskId:'task-1',day:'automatic',quantity:240}]
  },{now:NOW});
  assert.equal(production.forecastUsed(plan.dailyForecast.monday),120);
  assert.deepEqual(plan.categoryMix.monday,{ROSAS:60,COMPUESTOS:60,SIMPLES:0,PLANTAS:0});
  assert.equal(plan.preassignmentDays.monday,'friday');
  assert.equal(plan.receptionDays.monday,'wednesday');
  assert.equal(plan.satelliteAssignments[0].quantity,240);
});

test('calcula horas-persona diarias y semanales con todas las fuentes de verdad',()=>{
  let state=configuredState();
  state=production.addProductionTask(state,{id:'fill',name:'Relleno',code:'FILL',calculationType:'por_cantidad',performance:80,priority:'Media',mobility:'Fija'},{now:NOW}).state;
  state=production.addProductionTask(state,{id:'inventory',name:'Inventario',code:'INVENTORY',calculationType:'tiempo_fijo',durationHours:12,priority:'Alta',mobility:'Flexible'},{now:NOW}).state;
  const plan=production.normalizeWeeklyPlan({
    year:2026,week:32,dailyForecast:{monday:{system:100,adjustment:20}},
    categoryMix:{monday:{ROSAS:60,COMPUESTOS:60}},
    receptionDays:{monday:'monday'},preassignmentDays:{monday:'monday'},
    variantMix:[{day:'monday',productKey:'toscana',variantKey:'toscana|1',productName:'Toscana',variantName:'P1',units:60}],
    satelliteAssignments:[{taskId:'fill',day:'monday',quantity:240},{taskId:'inventory',day:'automatic'}]
  },{now:NOW});
  const result=production.calculateWeeklyPlan(plan,state,{variantRates:{'toscana|1':6}});
  assert.equal(result.forecastTotal,120);
  assert.equal(result.bouquetTotal,120);
  assert.equal(result.days.monday.reception,1.5);
  assert.equal(result.days.monday.preassignment,3);
  assert.equal(result.days.monday.manufacturing,10);
  assert.equal(result.days.monday.shipping,1.2);
  assert.equal(result.days.monday.satellite,3);
  assert.equal(result.unassignedSatelliteHours,12);
  assert.ok(Math.abs(result.weekly.total-30.7)<1e-9);
  assert.ok(result.issues.some(issue=>issue.code==='SATELLITE_DAY_AUTOMATIC'));
});

test('avisa y bloquea la validación cuando faltan mix o rendimientos de Fabricación',()=>{
  const state=configuredState();
  const withoutMix=production.createWeeklyPlan(2026,32,{now:NOW});
  withoutMix.dailyForecast.monday={system:100,adjustment:0};
  assert.ok(production.calculateWeeklyPlan(withoutMix,state).issues.some(issue=>issue.code==='CATEGORY_MIX_MISSING'));
  const plan=production.normalizeWeeklyPlan({year:2026,week:32,dailyForecast:{monday:{system:10}},categoryMix:{monday:{ROSAS:10}},receptionDays:{monday:'monday'},variantMix:[{day:'monday',variantKey:'missing',units:10}]},{now:NOW});
  const calculated=production.calculateWeeklyPlan(plan,state,{variantRates:{}});
  assert.ok(calculated.issues.some(issue=>issue.code==='MANUFACTURING_RATE_MISSING'));
  assert.equal(production.validateWeeklyPlan(state,plan,{variantRates:{}}).ok,false);
});

test('guarda semanas por clave y valida únicamente planes completos',()=>{
  const state=configuredState();
  const plan=production.createWeeklyPlan(2026,32,{now:NOW});
  const saved=production.saveWeeklyPlan(state,plan,{now:'2026-07-31T11:00:00.000Z'});
  assert.equal(saved.ok,true);
  assert.equal(saved.state.weeklyPlans['2026-W32'].status,'draft');
  const validated=production.validateWeeklyPlan(saved.state,saved.plan,{now:'2026-07-31T12:00:00.000Z'});
  assert.equal(validated.ok,true);
  assert.equal(validated.state.weeklyPlans['2026-W32'].status,'validated');
  assert.equal(production.summarizeProductionState(validated.state).validatedWeeks,1);
});

test('una tarea utilizada por una semana no se elimina físicamente',()=>{
  let state=production.createProductionState({satelliteTasks:[]},{now:NOW});
  const added=production.addProductionTask(state,{id:'used',name:'Usada',code:'USED',calculationType:'tiempo_fijo',durationHours:1},{now:NOW});
  state=added.state;
  const plan=production.createWeeklyPlan(2026,32,{now:NOW});
  plan.satelliteAssignments=[{taskId:'used',day:'monday',quantity:null}];
  state=production.saveWeeklyPlan(state,plan,{now:NOW}).state;
  const deleted=production.deleteProductionTask(state,'used',{now:NOW});
  assert.equal(deleted.ok,false);
  assert.match(deleted.errors[0],/desactívala/);
});

test('el SQL propuesto separa maestros y planificación sin vigencias ni personas',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'supabase-production.sql'),'utf8');
  for(const table of ['production_main_tasks','production_category_times','production_settings','production_satellite_tasks','production_weekly_plans','production_weekly_forecasts','production_weekly_category_mix','production_weekly_variant_mix','production_weekly_satellite_tasks','production_change_history']) assert.match(sql,new RegExp(`create table if not exists public\\.${table}\\b`,'i'));
  assert.doesNotMatch(sql,/\bvalid_from\b|\bvalid_to\b/i);
  assert.doesNotMatch(sql,/duracion_personas|people_count/i);
  assert.match(sql,/check \(calculation_type in \('por_cantidad','tiempo_fijo'\)\)/i);
  assert.match(sql,/references public\.nomenclature_variants\(id\)/i);
});

test('la interfaz muestra ambas secciones compactas, guardado explícito y sin controles eliminados',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/data-production-tab="weekly"[^>]*>Planificación semanal/);
  assert.match(html,/id="productionMainTasksTbody"/);
  assert.match(html,/id="btnProductionSaveWeek"[^>]*>Guardar/);
  assert.match(html,/id="btnProductionValidateWeek"[^>]*>Validar semana/);
  assert.match(html,/id="productionResultTbody"/);
  assert.match(html,/Gestionar rendimientos de fabricación/);
  assert.doesNotMatch(html,/id="productionTaskPeople"|duracion_personas|data-production-tab="forecasts"/);
  assert.doesNotMatch(html,/\.production-(?:main|satellite)-table\{[^}]*min-width/i);
});

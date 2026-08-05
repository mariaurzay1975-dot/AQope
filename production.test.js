const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Production=require('./production.js');

const NOW='2026-08-05T10:00:00.000Z';
const days=(monday=0,tuesday=0,wednesday=0,thursday=0,friday=0,saturday=0,sunday=0)=>({monday,tuesday,wednesday,thursday,friday,saturday,sunday});
const historyWeek=(year,week,daily,extra={})=>({year,week,daily,status:'closed',isComplete:true,campaigns:[],holidayDays:[],...extra});

test('identifica S33/2026 con clave y rango ISO propios de Producción',()=>{
  assert.equal(Production.weeklyPlanKey(2026,33),'2026-W33');
  assert.deepEqual(Production.isoWeekRange(2026,33),{start:'2026-08-10',end:'2026-08-16'});
});

test('el cambio de semana respeta el cambio de año ISO',()=>{
  const next=Production.shiftWeek(2026,53,1);
  assert.equal(next.year,2027);assert.equal(next.week,1);assert.equal(next.key,'2027-W01');
  const previous=Production.shiftWeek(next.year,next.week,-1);
  assert.equal(previous.year,2026);assert.equal(previous.week,53);assert.equal(previous.key,'2026-W53');
});

test('crea una colección única con cuatro principales especiales y seis satélite',()=>{
  const state=Production.createProductionState(null,{now:NOW});
  assert.equal(state.version,4);
  assert.equal(state.tasks.length,10);
  assert.equal(state.tasks.filter(task=>task.type===Production.TASK_TYPES.MAIN).length,4);
  assert.equal(state.tasks.filter(task=>task.type===Production.TASK_TYPES.SATELLITE).length,6);
  assert.deepEqual(state.tasks.filter(task=>task.specialKind).map(task=>task.code),['RECEPTION','PREASSIGNMENT','MANUFACTURING','SHIPPING']);
  assert.equal('mainTasks' in state,false);
  assert.equal('satelliteTasks' in state,false);
});

test('migra en memoria estados v3 sin perder tareas, rendimientos ni semanas',()=>{
  const old={version:3,mainTasks:{RECEPTION:{code:'RECEPTION',name:'Recepción muelle',priority:'Alta',mobility:'Fija',active:true}},categoryRates:{ROSAS:{reception:100,preassignment:80}},shippingRate:120,satelliteTasks:[{id:'old-clean',code:'CLEANING',name:'Limpieza',calculationType:'tiempo_fijo',durationHours:3,active:true}],weeklyPlans:{'2026-W32':{year:2026,week:32,dailyForecast:{monday:{system:100,adjustment:5}},bouquetSystem:100,bouquetAdjustment:5}},updatedAt:NOW};
  const state=Production.createProductionState(old,{now:NOW});
  assert.equal(state.tasks.find(task=>task.code==='RECEPTION').name,'Recepción muelle');
  assert.equal(state.tasks.find(task=>task.id==='old-clean').type,'satelite');
  assert.equal(state.categoryRates.ROSAS.reception,100);
  assert.equal(state.shippingRate,120);
  assert.equal(state.weeklyPlans['2026-W32'].annualForecast,100);
  assert.equal(state.weeklyPlans['2026-W32'].productionAdjustment,5);
  assert.equal(state.weeklyPlans['2026-W32'].dailyExpeditions.monday,105);
});

test('permite crear y cambiar una tarea general entre Principal y Satélite',()=>{
  let state=Production.createProductionState(null,{now:NOW});
  let result=Production.addProductionTask(state,{name:'Etiquetado especial',type:'principal',calculationType:'por_cantidad',performance:40,priority:'Alta',mobility:'Flexible'},{now:NOW});
  assert.equal(result.ok,true);
  assert.equal(result.task.code,'ETIQUETADO_ESPECIAL');
  assert.equal(result.task.type,'principal');
  result=Production.updateProductionTask(result.state,result.task.id,{type:'satelite',calculationType:'tiempo_fijo',performance:null,durationHours:2},{now:'2026-08-05T11:00:00.000Z',comment:'Cambio operativo'});
  assert.equal(result.ok,true);
  assert.equal(result.task.type,'satelite');
  assert.equal(result.task.durationHours,2);
  assert.ok(result.state.changeHistory.some(entry=>entry.field==='type'&&entry.comment==='Cambio operativo'));
});

test('una tarea base puede ser Satélite, conserva su fórmula y vuelve al resumen Principal',()=>{
  let state=Production.createProductionState(null,{now:NOW});
  const reception=state.tasks.find(task=>task.code==='RECEPTION');
  let updated=Production.updateProductionTask(state,reception.id,{type:'satelite',calculationType:'tiempo_fijo',durationHours:5},{now:NOW});
  assert.equal(updated.ok,true);assert.equal(updated.task.type,'satelite');assert.equal(updated.task.calculationType,'especial');assert.match(Production.taskTimingText(updated.task),/categoría/);
  state=Production.updateCategoryRate(updated.state,'ROSAS','reception',100,{now:NOW}).state;
  let plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.satelliteAssignments=[{taskId:reception.id,day:'automatic',quantity:null}];
  let calc=Production.calculateWeeklyPlan(plan,state,{purchases:[{day:'monday',category:'ROSAS',units:200}]});
  assert.equal(calc.days.monday.reception,2);assert.equal(calc.satelliteByTask[reception.id],2);assert.equal(calc.weekly.satelliteTotal,2);assert.equal(calc.mainByTask[reception.id],undefined);
  updated=Production.updateProductionTask(state,reception.id,{type:'principal'},{now:NOW});
  calc=Production.calculateWeeklyPlan(plan,updated.state,{purchases:[{day:'monday',category:'ROSAS',units:200}]});
  assert.equal(calc.mainByTask[reception.id],2);assert.equal(calc.satelliteByTask[reception.id],undefined);assert.equal(calc.weekly.mainTotal,2);
  assert.equal(Production.deleteProductionTask(updated.state,reception.id).ok,false);
});

test('una semana guarda previsión anual, ajuste separado y decisiones sin maestros duplicados',()=>{
  const state=Production.createProductionState(null,{now:NOW});
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});
  plan.annualForecast=2310;
  plan.productionAdjustment=40;
  plan.dailyExpeditions=days(470,470,470,470,470);
  plan.distributionContext={method:'Referencias',references:[{year:2026,week:31,weight:40}],warnings:[]};
  const saved=Production.saveWeeklyPlan(state,plan,{now:NOW});
  assert.equal(Production.weeklyTotalUsed(saved.plan),2350);
  assert.equal(saved.plan.annualForecast,2310);
  assert.equal(saved.plan.productionAdjustment,40);
  assert.equal('tasks' in saved.plan,false);
  assert.equal(saved.plan.distributionContext.references.length,1);
});

test('semana normal combina cuatro semanas recientes 40/30/20/10 y año comparable',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:20,total:1000,comparableYear:2024,historyWeeks:[
    historyWeek(2026,19,days(40,30,20,10)),historyWeek(2026,18,days(30,30,20,20)),historyWeek(2026,17,days(20,30,30,20)),historyWeek(2026,16,days(10,20,30,40)),historyWeek(2024,20,days(25,25,25,25))
  ],now:NOW});
  assert.equal(Object.values(proposal.dailyExpeditions).reduce((a,b)=>a+b,0),1000);
  assert.equal(Math.round(Object.values(proposal.percentages).reduce((a,b)=>a+b,0)),100);
  assert.equal(proposal.references.length,5);
  assert.equal(proposal.references.find(ref=>ref.year===2024).weight,30);
  assert.equal(proposal.references[0].reason,'Semana reciente comparable');
});

test('una campaña utiliza prioritariamente la misma campaña aunque cambie de semana ISO',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:7,total:500,campaigns:['San Valentín'],comparableYear:2025,historyWeeks:[
    historyWeek(2025,7,days(50,100,150,100,100),{campaigns:['San Valentín']}),
    historyWeek(2024,6,days(100,100,100,100,100),{campaigns:['San Valentín']}),
    historyWeek(2026,6,days(10,10,10,10,10))
  ],now:NOW});
  assert.equal(proposal.method,'Histórico de la misma campaña');
  assert.equal(proposal.references.length,2);
  assert.ok(proposal.references.every(ref=>/campaña|Misma semana/.test(ref.reason)));
  assert.equal(proposal.dailyExpeditions.saturday,0);
});

test('una semana con festivo solo utiliza referencias con el mismo patrón de festivos',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:33,total:400,holidayDays:['saturday'],comparableYear:2025,historyWeeks:[
    historyWeek(2025,33,days(80,80,80,80,80,0,0),{holidayDays:['saturday']}),
    historyWeek(2026,32,days(60,60,60,60,60,60,40))
  ],now:NOW});
  assert.equal(proposal.references.length,1);
  assert.equal(proposal.references[0].year,2025);
  assert.equal(proposal.dailyExpeditions.saturday,0);
  assert.equal(proposal.dailyExpeditions.sunday,0);
});

test('sin referencias suficientes no inventa reparto y explica la limitación',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:33,total:400,holidayDays:['monday'],historyWeeks:[historyWeek(2026,32,days(80,80,80,80,80))],now:NOW});
  assert.equal(proposal.references.length,0);
  assert.equal(Object.values(proposal.dailyExpeditions).reduce((a,b)=>a+b,0),0);
  assert.ok(proposal.warnings.some(message=>/mismos festivos/.test(message)));
  assert.ok(proposal.warnings.some(message=>/referencias diarias/.test(message)));
});

test('la acción de repartir corrige la diferencia diaria sin cambiar el total semanal',()=>{
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});
  plan.annualForecast=101;
  plan.dailyExpeditions=days(20,20,20,20,20);
  const adjusted=Production.spreadDailyDifference(plan);
  assert.equal(Object.values(adjusted.dailyExpeditions).reduce((a,b)=>a+b,0),101);
  assert.equal(adjusted.dailyManual,true);
  assert.equal(adjusted.annualForecast,101);
});

test('Recepción usa compras agrupadas por día y categoría, no expediciones',()=>{
  let state=Production.createProductionState(null,{now:NOW});
  state=Production.updateCategoryRate(state,'ROSAS','reception',100,{now:NOW}).state;
  state=Production.updateCategoryRate(state,'COMPUESTOS','reception',50,{now:NOW}).state;
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.annualForecast=100;plan.dailyExpeditions=days(100);
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[{day:'monday',category:'ROSAS',units:200},{day:'wednesday',category:'COMPUESTOS',units:100}]});
  assert.equal(calc.days.monday.reception,2);
  assert.equal(calc.days.wednesday.reception,2);
  assert.equal(calc.weekly.reception,4);
  assert.equal(calc.issues.some(issue=>issue.code==='RECEPTION_DATA_MISSING'),false);
});

test('Recepción informa claramente cuando faltan datos de Compras',()=>{
  const state=Production.createProductionState(null,{now:NOW}),plan=Production.createWeeklyPlan(2026,32,{now:NOW});
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.ok(calc.issues.some(issue=>issue.message==='Recepción pendiente de datos de Compras.'));
});

test('calcula Preasignación por categoría y día decidido',()=>{
  let state=Production.createProductionState(null,{now:NOW});state=Production.updateCategoryRate(state,'ROSAS','preassignment',50,{now:NOW}).state;
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.annualForecast=100;plan.dailyExpeditions=days(100);plan.categoryMix.monday.ROSAS=100;plan.preassignmentDays.monday='friday';
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.equal(calc.days.friday.preassignment,2);
});

test('Fabricación usa rendimientos de Nomenclaturas y detalla variantes incompletas',()=>{
  const state=Production.createProductionState(null,{now:NOW}),plan=Production.createWeeklyPlan(2026,32,{now:NOW});
  plan.annualForecast=30;plan.dailyExpeditions=days(30);plan.categoryMix.monday.COMPUESTOS=30;plan.variantMix=[{day:'monday',variantKey:'A|1',productName:'Ramo A',variantName:'P1',units:20},{day:'monday',variantKey:'B|1',productName:'Ramo B',variantName:'P1',units:10}];
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[],variantRates:{'A|1':10}});
  assert.equal(calc.days.monday.manufacturing,2);
  assert.ok(calc.issues.some(issue=>issue.code==='MANUFACTURING_RATE_MISSING'&&issue.variantKey==='B|1'));
});

test('Expedición divide cada día por el rendimiento global',()=>{
  let state=Production.createProductionState(null,{now:NOW});state=Production.updateShippingRate(state,50,{now:NOW}).state;
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.annualForecast=150;plan.dailyExpeditions=days(100,50);
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.equal(calc.days.monday.shipping,2);
  assert.equal(calc.days.tuesday.shipping,1);
  assert.equal(calc.weekly.shipping,3);
});

test('tareas satélite seleccionadas calculan cantidad o tiempo fijo y separan subtotal',()=>{
  let state=Production.createProductionState(null,{now:NOW});
  const quantity=Production.addProductionTask(state,{name:'Etiquetas',type:'satelite',calculationType:'por_cantidad',performance:100,mobility:'Fija'},{now:NOW});state=quantity.state;
  const fixed=Production.addProductionTask(state,{name:'Reunión',type:'satelite',calculationType:'tiempo_fijo',durationHours:1.5,mobility:'Flexible'},{now:NOW});state=fixed.state;
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.satelliteAssignments=[{taskId:quantity.task.id,day:'monday',quantity:200},{taskId:fixed.task.id,day:'automatic',quantity:null}];
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.equal(calc.days.monday.satellite,2);
  assert.equal(calc.weekly.satelliteTotal,3.5);
  assert.equal(calc.satelliteByTask[fixed.task.id],1.5);
});

test('el SQL propuesto usa una tabla única de tareas y no contiene vigencias',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'supabase-production.sql'),'utf8');
  assert.match(sql,/create table if not exists public\.production_tasks/i);
  assert.match(sql,/activity_type text/i);
  assert.doesNotMatch(sql,/production_main_tasks/i);
  assert.doesNotMatch(sql,/production_satellite_tasks/i);
  assert.doesNotMatch(sql,/valid_from|valid_to/i);
  assert.match(sql,/annual_forecast/i);
  assert.match(sql,/production_adjustment/i);
  assert.match(sql,/distribution_references/i);
});

test('la interfaz elimina Resumen y muestra la planificación semanal primero',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const production=html.slice(html.indexOf('<section class="production-view"'),html.indexOf('<div class="annual-floating-tooltip"'));
  assert.doesNotMatch(production,/data-production-(?:tab|panel)="summary"/);
  assert.ok(production.indexOf('data-production-tab="weekly"')<production.indexOf('data-production-tab="times"'));
  assert.match(production,/Tarea<\/th><th>Tipo<\/th><th>Tiempo \/ rendimiento/);
  assert.match(production,/Ver cálculo de la distribución/);
  assert.match(production,/TOTAL HORAS-PERSONA DE LA SEMANA/);
  assert.match(production,/id="productionDayDetail"/);
  assert.match(html,/data-production-day-detail=/);
  assert.match(html,/Detalle de \$\{day\.label\}/);
  assert.match(html,/type==='satelite'\|\|!task\.specialKind/);
  assert.match(html,/Esta tarea tiene una lógica de cálculo específica\. Cambiar su clasificación no modifica su fuente de datos ni su fórmula\./);
  assert.match(html,/productionTaskType'\)\.disabled=false/);
  assert.match(html,/let productionTab = 'weekly'/);
});

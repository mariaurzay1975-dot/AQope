const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Production=require('./production.js');

const NOW='2026-08-05T10:00:00.000Z';
const days=(monday=0,tuesday=0,wednesday=0,thursday=0,friday=0,saturday=0,sunday=0)=>({monday,tuesday,wednesday,thursday,friday,saturday,sunday});
const historyWeek=(year,week,daily,extra={})=>({year,week,daily,status:'closed',isComplete:true,campaigns:[],holidayDays:[],...extra});
const balancedPlan=(year=2027,week=8,total=469)=>{const plan=Production.createWeeklyPlan(year,week);plan.annualForecast=total;plan.distribution.calculated=days(total);plan.distribution.adjusted=days(total);plan.dailyExpeditions=plan.distribution.adjusted;return plan;};
const deleteSpecialTasks=state=>{let next=state;for(const task of [...next.tasks].filter(item=>item.specialKind))next=Production.deleteProductionTask(next,task.id).state;return next;};

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
  assert.equal(state.version,5);
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
  assert.equal(Production.deleteProductionTask(updated.state,reception.id).ok,true);
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

test('semana normal promedia cuatro semanas recientes y combina 60/40 con el año de referencia',()=>{
  assert.equal(Production.RECENT_WEEKS_WEIGHT,0.60);assert.equal(Production.REFERENCE_WEEK_WEIGHT,0.40);assert.equal(Production.RECENT_VALID_WEEKS_COUNT,4);
  const proposal=Production.proposeDailyDistribution({year:2026,week:20,total:1000,comparableYear:2024,historyWeeks:[
    historyWeek(2026,19,days(40,30,20,10)),historyWeek(2026,18,days(30,30,20,20)),historyWeek(2026,17,days(20,30,30,20)),historyWeek(2026,16,days(10,20,30,40)),historyWeek(2024,20,days(25,25,25,25))
  ],now:NOW});
  assert.equal(Object.values(proposal.dailyExpeditions).reduce((a,b)=>a+b,0),1000);
  assert.equal(Math.round(Object.values(proposal.percentages).reduce((a,b)=>a+b,0)),100);
  assert.equal(proposal.references.length,5);
  assert.equal(proposal.references.find(ref=>ref.year===2024).weight,40);
  assert.ok(proposal.references.filter(ref=>ref.source==='recent').every(ref=>ref.weight===15));
  assert.deepEqual(proposal.dailyExpeditions,days(250,265,250,235));
  assert.equal(proposal.sourceDetails.recent.weight,60);
  assert.equal(proposal.sourceDetails.reference.weight,40);
});

test('las semanas con campaña se descartan y no se mezclan con el histórico limpio',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:7,total:500,campaigns:['San Valentín'],comparableYear:2025,historyWeeks:[
    historyWeek(2025,7,days(50,100,150,100,100),{campaigns:['San Valentín']}),
    historyWeek(2024,6,days(100,100,100,100,100),{campaigns:['San Valentín']}),
    historyWeek(2026,6,days(10,10,10,10,10))
  ],now:NOW});
  assert.equal(proposal.references.length,1);
  assert.equal(proposal.references[0].year,2026);
  assert.equal(proposal.references[0].week,6);
  assert.ok(proposal.excluded.some(item=>item.year===2025&&item.reason==='campaña'));
  assert.equal(proposal.dailyExpeditions.saturday,0);
});

test('las referencias con festivo se descartan aunque coincidan con el patrón objetivo',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:33,total:400,holidayDays:['saturday'],comparableYear:2025,historyWeeks:[
    historyWeek(2025,33,days(80,80,80,80,80,0,0),{holidayDays:['saturday']}),
    historyWeek(2026,32,days(60,60,60,60,60,60,40))
  ],now:NOW});
  assert.equal(proposal.references.length,1);
  assert.equal(proposal.references[0].year,2026);
  assert.ok(proposal.excluded.some(item=>item.year===2025&&item.reason==='festivo'));
  assert.equal(proposal.dailyExpeditions.saturday,0);
  assert.ok(proposal.dailyExpeditions.sunday>0);
});

test('sin ninguna fuente válida aplica el fallback estándar y explica la limitación',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:33,total:400,holidayDays:['monday'],historyWeeks:[historyWeek(2026,32,days(80,80,80,80,80),{isComplete:false})],now:NOW});
  assert.equal(proposal.references.length,0);
  assert.equal(Object.values(proposal.dailyExpeditions).reduce((a,b)=>a+b,0),400);
  assert.ok(proposal.warnings.some(message=>/distribución estándar/.test(message)));
  assert.ok(proposal.excluded.some(item=>item.reason==='semana incompleta'));
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

test('calcula Preasignación desde las compras del mismo día',()=>{
  let state=Production.createProductionState(null,{now:NOW});state=Production.updateCategoryRate(state,'ROSAS','preassignment',50,{now:NOW}).state;
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.annualForecast=100;plan.dailyExpeditions=days(100);
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[{day:'monday',category:'ROSAS',units:100}]});
  assert.equal(calc.days.monday.preassignment,2);
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
  const plan=Production.createWeeklyPlan(2026,32,{now:NOW});plan.satelliteAssignments=[{taskId:quantity.task.id,days:{monday:{selected:true,quantity:200}}},{taskId:fixed.task.id,days:{tuesday:{selected:true,quantity:null}}}];
  const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.equal(calc.days.monday.satellite,2);
  assert.equal(calc.weekly.satelliteTotal,3.5);
  assert.equal(calc.satelliteByTask[fixed.task.id],1.5);
});

test('semana futura con 469 expediciones usa fallback, enteros y suma exacta',()=>{
  const proposal=Production.calculateProductionDailyProposal({weeklyTotal:469});
  assert.equal(proposal.source,'default');
  assert.equal(Object.values(proposal.days).reduce((a,b)=>a+b,0),469);
  assert.ok(Object.values(proposal.days).some(Boolean));
  assert.ok(Object.values(proposal.days).every(Number.isInteger));
});

test('un festivo queda a cero y su volumen se redistribuye',()=>{
  const proposal=Production.calculateProductionDailyProposal({weeklyTotal:469,blockedDays:['friday']});
  assert.equal(proposal.days.friday,0);
  assert.equal(Object.values(proposal.days).reduce((a,b)=>a+b,0),469);
});

test('un fallo de histórico conserva una propuesta estándar válida',()=>{
  const proposal=Production.proposeDailyDistribution({year:2027,week:8,total:469,historyWeeks:[]});
  assert.equal(proposal.source,'default');
  assert.equal(Object.values(proposal.dailyExpeditions).reduce((a,b)=>a+b,0),469);
});

test('el histórico reciente solo usa semanas completas, cerradas, anteriores y del mismo año',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:20,total:469,comparableYear:2015,historyWeeks:[
    historyWeek(2026,19,days(50,20,10,10,10)),historyWeek(2026,18,days(40,20,20,10,10)),historyWeek(2026,17,days(30,20,20,20,10)),historyWeek(2026,16,days(20,20,20,20,20)),historyWeek(2026,15,days(10,20,20,20,30)),
    historyWeek(2026,14,days(20,20,20,20,20),{isComplete:false}),historyWeek(2026,13,days(20,20,20,20,20),{status:'current'}),historyWeek(2025,19,days(90,10)),historyWeek(2026,21,days(90,10))
  ]});
  assert.deepEqual(proposal.sourceDetails.recent.weeks.map(item=>item.week),[19,18,17,16]);
  assert.equal(proposal.references.some(ref=>ref.week===15),false);
  assert.ok(proposal.excluded.some(item=>item.week===14&&item.reason==='semana incompleta'));
  assert.ok(proposal.excluded.some(item=>item.week===13&&item.reason==='semana pendiente de cierre'));
  assert.equal(proposal.sourceDetails.recent.weight,100);
  assert.equal(Object.values(proposal.days).reduce((sum,value)=>sum+value,0),469);
});

test('descarta cierres operativos y días anómalos',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:20,total:200,historyWeeks:[historyWeek(2026,19,days(40,40,40,40,40),{hasOperationalClosure:true}),historyWeek(2026,18,days(40,40,40,40,40),{hasAnomaly:true})]});
  assert.equal(proposal.source,'default');
  assert.ok(proposal.excluded.some(item=>item.reason==='cierre operativo'));
  assert.ok(proposal.excluded.some(item=>item.reason==='días anómalos o incompletos'));
});

test('si falta el histórico reciente usa el 100 % de la semana equivalente configurada',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:34,total:100,comparableYear:2015,historyWeeks:[historyWeek(2015,34,days(50,20,10,10,10))]});
  assert.equal(proposal.source,'reference-week');assert.equal(proposal.sourceDetails.reference.year,2015);assert.equal(proposal.sourceDetails.reference.weight,100);assert.deepEqual(proposal.days,days(50,20,10,10,10));
});

test('si falta la referencia usa el 100 % de la media reciente',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:34,total:100,comparableYear:2015,historyWeeks:[historyWeek(2026,33,days(40,20,20,10,10)),historyWeek(2026,32,days(20,20,20,20,20))]});
  assert.equal(proposal.source,'recent-average');assert.equal(proposal.sourceDetails.recent.weight,100);assert.equal(proposal.sourceDetails.reference.weight,0);assert.deepEqual(proposal.days,days(30,20,20,15,15));
});

test('la explicación conserva fuentes, descartes, porcentajes y redondeos al guardar el plan',()=>{
  const proposal=Production.proposeDailyDistribution({year:2026,week:34,total:469,comparableYear:2015,historyWeeks:[historyWeek(2026,33,days(40,20,20,10,10)),historyWeek(2026,32,days(20,20,20,20,20),{campaigns:['Especial']}),historyWeek(2015,34,days(30,25,20,15,10))]});
  const plan=Production.applyDistributionProposal(Production.createWeeklyPlan(2026,34),proposal,{replaceAdjusted:true});
  assert.equal(plan.distributionContext.source,'recent-and-reference');assert.equal(plan.distributionContext.sourceDetails.reference.year,2015);assert.ok(plan.distributionContext.excluded.some(item=>item.reason==='campaña'));assert.equal(plan.distributionContext.roundingAdjustments.length,7);assert.equal(Object.values(plan.distribution.calculated).reduce((sum,value)=>sum+value,0),469);
});

test('propuesta calculada y ajuste manual se normalizan por separado',()=>{
  const plan=Production.normalizeWeeklyPlan({year:2027,week:8,distribution:{calculated:days(10,20),adjusted:days(12,18),calculationSource:'saved'}});
  assert.equal(plan.distribution.calculated.monday,10);
  assert.equal(plan.distribution.adjusted.monday,12);
});

test('actualizar propuesta conserva ajustes manuales si se solicita',()=>{
  let plan=Production.createWeeklyPlan(2027,8);plan=Production.applyDistributionProposal(plan,{dailyExpeditions:days(10,20),source:'default'},{replaceAdjusted:true});
  plan.distribution.adjusted.monday=99;plan.dailyManual=true;
  const next=Production.applyDistributionProposal(plan,{dailyExpeditions:days(20,10),source:'recent-average'},{preserveAdjusted:true});
  assert.equal(next.distribution.calculated.monday,20);assert.equal(next.distribution.adjusted.monday,99);
});

test('repartir diferencia modifica solo ajustes y respeta bloqueos',()=>{
  let plan=Production.createWeeklyPlan(2027,8);plan.annualForecast=101;plan.distribution.calculated=days(10,20,20,20,20,11);plan.distribution.adjusted=days(10,10);plan.dailyExpeditions=plan.distribution.adjusted;plan.distributionContext.holidayDays=['monday'];
  const calculated=JSON.stringify(plan.distribution.calculated),next=Production.spreadDailyDifference(plan);
  assert.equal(JSON.stringify(next.distribution.calculated),calculated);assert.equal(next.distribution.adjusted.monday,0);assert.equal(Object.values(next.distribution.adjusted).reduce((a,b)=>a+b,0),101);
});

test('compras de varios días generan Preasignación en sus días',()=>{
  const result=Production.calculateDailyPreassignmentHours({purchases:[{day:'monday',category:'ROSAS',quantity:100},{day:'tuesday',category:'ROSAS',quantity:50}],categoryPerformances:{ROSAS:{preassignment:50}}});
  assert.equal(result.byDay.monday.totalHours,2);assert.equal(result.byDay.tuesday.totalHours,1);assert.equal(result.weeklyTotal,3);
});

test('categoría sin rendimiento avisa sin anular las demás',()=>{
  const result=Production.calculateDailyPreassignmentHours({purchases:[{day:'monday',category:'ROSAS',quantity:100},{day:'monday',category:'PLANTAS',quantity:10}],categoryPerformances:{ROSAS:{preassignment:50}}});
  assert.equal(result.byDay.monday.totalHours,2);assert.deepEqual(result.missingPerformances,['PLANTAS']);
});

test('Fabricación usa rendimiento medio como fallback con expediciones ajustadas',()=>{
  const state=Production.createProductionState(),plan=Production.createWeeklyPlan(2027,8);plan.annualForecast=100;plan.dailyExpeditions=days(100);
  const calc=Production.calculateWeeklyPlan(plan,state,{variantRates:{a:10,b:20},purchases:[]});
  assert.equal(calc.days.monday.manufacturing,100/15);assert.ok(calc.issues.some(issue=>issue.code==='MANUFACTURING_FALLBACK'));
});

test('se pueden eliminar las cuatro tareas principales sin romper el resto',()=>{
  let state=Production.createProductionState();
  for(const kind of ['reception','preassignment','manufacturing','shipping']){const task=state.tasks.find(item=>item.specialKind===kind),result=Production.deleteProductionTask(state,task.id);assert.equal(result.ok,true);state=result.state;}
  assert.equal(state.tasks.some(task=>task.specialKind),false);assert.equal(state.deletedTasks.length,4);
  const calc=Production.calculateWeeklyPlan(Production.createWeeklyPlan(2027,8),state,{purchases:[]});assert.ok(calc);
});

test('valida una semana sin tarea Recepción cuando el resto de tareas activas está calculado',()=>{
  let state=Production.createProductionState(),reception=state.tasks.find(task=>task.specialKind==='reception');state=Production.deleteProductionTask(state,reception.id).state;state=Production.updateCategoryRate(state,'ROSAS','preassignment',100).state;state=Production.updateShippingRate(state,100).state;
  const plan=balancedPlan();plan.categoryMix.monday.ROSAS=469;plan.variantMix=[{day:'monday',variantKey:'ROSAS|BASE',units:469}];
  const result=Production.validateWeeklyPlan(state,plan,{purchases:[{day:'monday',category:'ROSAS',units:100}],variantRates:{'ROSAS|BASE':100}});
  assert.equal(result.ok,true);assert.equal(result.plan.status,'validated');assert.equal(result.calculated.issues.some(issue=>issue.code.startsWith('RECEPTION_')),false);
});

test('una tarea principal eliminada queda fuera de los requisitos de validación',()=>{
  let state=deleteSpecialTasks(Production.createProductionState()),added=Production.addProductionTask(state,{name:'Principal temporal',type:'principal',calculationType:'por_cantidad',performance:10});state=added.state;const deletedId=added.task.id;state=Production.deleteProductionTask(state,deletedId).state;
  const plan=balancedPlan(),result=Production.validateWeeklyPlan(state,plan);
  assert.equal(state.tasks.some(task=>task.id===deletedId),false);assert.equal(result.ok,true);assert.equal(result.calculated.blockingIssues.some(issue=>issue.taskId===deletedId),false);
});

test('solo las tareas existentes y activas pueden bloquear la validación',()=>{
  let state=deleteSpecialTasks(Production.createProductionState()),added=Production.addProductionTask(state,{name:'Principal con cantidad',type:'principal',calculationType:'por_cantidad',performance:10});state=added.state;const taskId=added.task.id,plan=balancedPlan();plan.principalAssignments=[{taskId,days:{monday:{selected:true,quantity:null}}}];
  const inactive=Production.updateProductionTask(state,taskId,{active:false}).state,inactiveResult=Production.validateWeeklyPlan(inactive,plan),activeResult=Production.validateWeeklyPlan(state,plan);
  assert.equal(inactiveResult.ok,true);assert.ok(inactiveResult.calculated.issues.some(issue=>issue.code==='TASK_INACTIVE_SKIPPED'));assert.equal(activeResult.ok,false);assert.deepEqual(activeResult.errors,['Faltan datos para calcular Principal con cantidad el Lunes.']);assert.doesNotMatch(activeResult.errors.join(' '),/La semana tiene datos incompletos/);
});

test('469 calculadas y 469 ajustadas permiten validar sin diferencia',()=>{
  const state=deleteSpecialTasks(Production.createProductionState()),plan=balancedPlan(),result=Production.validateWeeklyPlan(state,plan);
  assert.equal(Production.distributionBalance(plan).difference,0);assert.equal(result.ok,true);assert.equal(result.plan.status,'validated');
});

test('una tarea eliminada conserva instantánea en un plan histórico usado',()=>{
  let state=Production.createProductionState(),task=state.tasks.find(item=>item.specialKind==='reception'),plan=Production.createWeeklyPlan(2027,8);plan.status='validated';state=Production.saveWeeklyPlan(state,plan).state;
  state=Production.deleteProductionTask(state,task.id).state;assert.equal(state.weeklyPlans[plan.key].taskSnapshots[task.id].name,task.name);
});

test('actividad satélite admite tres días y cantidades distintas',()=>{
  let state=Production.createProductionState(),added=Production.addProductionTask(state,{name:'Etiquetas multi',type:'satelite',calculationType:'por_cantidad',performance:10});state=added.state;const plan=Production.createWeeklyPlan(2027,8);plan.satelliteAssignments=[{taskId:added.task.id,days:{monday:{selected:true,quantity:10},wednesday:{selected:true,quantity:20},friday:{selected:true,quantity:30}}}];const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});
  assert.equal(calc.hoursByTaskAndDay[added.task.id].monday,1);assert.equal(calc.hoursByTaskAndDay[added.task.id].wednesday,2);assert.equal(calc.hoursByTaskAndDay[added.task.id].friday,3);
});

test('duración fija completa se aplica cada día seleccionado',()=>{
  let state=Production.createProductionState(),added=Production.addProductionTask(state,{name:'Limpieza extra',type:'satelite',calculationType:'tiempo_fijo',durationHours:2});state=added.state;const plan=Production.createWeeklyPlan(2027,8);plan.satelliteAssignments=[{taskId:added.task.id,days:{monday:{selected:true},thursday:{selected:true}}}];const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});assert.equal(calc.satelliteByTask[added.task.id],4);
});

test('desglose dinámico crea una columna por tarea y totales coherentes',()=>{
  const active=[{id:'a',name:'A',type:'principal'},{id:'b',name:'B',type:'satelite'}],hours={a:days(1,2),b:days(3,4)},breakdown=Production.buildProductionDailyBreakdown({activeTasks:active,calculatedHoursByTaskAndDay:hours});
  assert.equal(breakdown.columns.length,2);assert.equal(breakdown.totalsByDay.monday,4);assert.equal(breakdown.grandTotal,10);assert.equal(breakdown.totalsByTask.a,3);
});

test('resultado central comparte totales con resumen y desglose',()=>{
  let state=Production.createProductionState();state=Production.updateShippingRate(state,50).state;const plan=Production.createWeeklyPlan(2027,8);plan.annualForecast=100;plan.dailyExpeditions=days(100);const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});assert.equal(calc.totals.grandTotal,calc.dailyBreakdown.grandTotal);assert.equal(calc.totals.main,calc.weekly.mainTotal);
});

test('el desglose central ordena principales antes que satélites y mantiene totales por tarea, día y semana',()=>{
  let state=Production.createProductionState(),added=Production.addProductionTask(state,{name:'Satélite Z',type:'satelite',calculationType:'tiempo_fijo',durationHours:2});state=added.state;const plan=Production.createWeeklyPlan(2027,8);plan.satelliteAssignments=[{taskId:added.task.id,days:{saturday:{selected:true}}}];const calc=Production.calculateWeeklyPlan(plan,state,{purchases:[]});const types=calc.dailyBreakdown.columns.map(item=>item.type),firstSatellite=types.indexOf('satelite');
  assert.ok(types.slice(0,firstSatellite).every(type=>type==='principal'));assert.ok(types.slice(firstSatellite).every(type=>type==='satelite'));assert.equal(calc.dailyBreakdown.totalsByDay.saturday,2);assert.equal(calc.dailyBreakdown.totalsByTask[added.task.id],2);assert.equal(calc.dailyBreakdown.grandTotal,calc.totals.grandTotal);
});

test('migra day legado a days y la migración es idempotente',()=>{
  const source={version:4,tasks:Production.createProductionState().tasks,weeklyPlans:{x:{year:2027,week:8,satelliteAssignments:[{taskId:'x',day:'friday',quantity:8}]}}},once=Production.createProductionState(source),twice=Production.createProductionState(once);assert.equal(once.weeklyPlans['2027-W08'].satelliteAssignments[0].days.friday.quantity,8);assert.deepEqual(twice,once);
});

test('guardar y recargar conserva ajustes y selección multidiaria',()=>{
  let state=Production.createProductionState(),plan=Production.createWeeklyPlan(2027,8);plan.distribution.calculated=days(10);plan.distribution.adjusted=days(8,2);plan.dailyExpeditions=plan.distribution.adjusted;plan.satelliteAssignments=[{taskId:'x',days:{monday:{selected:true,quantity:1},friday:{selected:true,quantity:2}}}];state=Production.saveWeeklyPlan(state,plan).state;const loaded=Production.createProductionState(JSON.parse(JSON.stringify(state)));assert.equal(loaded.version,5);assert.equal(loaded.weeklyPlans[plan.key].distribution.adjusted.tuesday,2);assert.equal(loaded.weeklyPlans[plan.key].satelliteAssignments[0].days.friday.quantity,2);
});

test('claves ISO distinguen semana 1 y 53',()=>{assert.equal(Production.weeklyPlanKey(2027,1),'2027-W01');assert.equal(Production.weeklyPlanKey(2026,53),'2026-W53');});

test('null y NaN no se convierten en horas cero válidas',()=>{const task={name:'Sin datos',type:'satelite',calculationType:'por_cantidad',performance:10};assert.equal(Production.calculateTaskPersonHours(task,null),null);assert.equal(Production.calculateTaskPersonHours(task,NaN),null);});

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

test('la distribución presenta días en columnas, calculada primero y ajuste manual después',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/productionDistributionThead[^]*<th>Concepto<\/th>\$\{visibleDays\.map/);
  const calculated=html.indexOf('data-distribution-row="calculated"'),manual=html.indexOf('data-distribution-row="manual"');
  assert.ok(calculated>0&&manual>calculated);assert.match(html,/Expedición calculada/);assert.match(html,/Ajuste manual/);assert.match(html,/Total semana/);assert.match(html,/balance\.calculatedTotal/);assert.match(html,/balance\.adjustedTotal/);
});

test('sábado y domingo están ocultos por defecto y un único control actualiza ambas tablas sin tocar datos',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/let productionShowWeekend=false/);assert.match(html,/id="productionShowWeekend" type="checkbox"/);assert.match(html,/Mostrar sábado y domingo/);
  assert.ok((html.match(/productionShowWeekend\|\|!\['saturday','sunday'\]\.includes\(day\.code\)/g)||[]).length>=2);
  const handler=html.match(/productionShowWeekend'\)\.addEventListener\('change',event=>\{([^}]*)\}/)?.[1]||'';assert.match(handler,/renderProductionDistribution/);assert.match(handler,/renderProductionWeekResults/);assert.doesNotMatch(handler,/distribution\.adjusted|dailyExpeditions/);
});

test('actividades satélite ocultan el fin de semana sin borrar asignaciones y reorganizan la rejilla',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/let productionShowSatelliteWeekend=false/);assert.match(html,/id="productionShowSatelliteWeekend" type="checkbox"/);
  assert.match(html,/type==='satelite'&&!productionShowSatelliteWeekend\?AquarelleProduction\.PRODUCTION_DAYS\.filter/);assert.match(html,/--production-day-count:\$\{visibleDays\.length\}/);assert.match(html,/repeat\(var\(--production-day-count,7\),minmax\(0,1fr\)\)/);
  const handler=html.match(/productionShowSatelliteWeekend'\)\.addEventListener\('change',event=>\{([^}]*)\}/)?.[1]||'';assert.match(handler,/renderProductionTaskAssignments\('satelite','productionWeekTasks'\)/);assert.doesNotMatch(handler,/satelliteAssignments|dailyExpeditions|saveState/);
});

test('el layout semanal compacto limita inputs y evita mínimos horizontales en escritorio',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/production-total-grid\{display:grid;grid-template-columns:minmax\(150px,1fr\) minmax\(170px,220px\)/);assert.match(html,/production-total-grid input\{width:78px/);assert.match(html,/production-distribution-table input\{display:block;width:60px/);assert.match(html,/production-distribution-table\{width:100%;min-width:0;table-layout:fixed\}/);assert.match(html,/production-dynamic-breakdown\{width:100%;min-width:0;table-layout:fixed\}/);assert.match(html,/production-distribution-table,\.production-dynamic-breakdown\{min-width:720px\}/);
});

test('el ajuste manual conserva texto durante input y solo confirma número en change',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),inputHandler=html.match(/productionDistributionTbody'\)\.addEventListener\('input',event=>\{([^}]*)\}/)?.[1]||'',changeHandler=html.match(/productionDistributionTbody'\)\.addEventListener\('change',event=>\{([^}]*)\}/)?.[1]||'';
  let editing='';editing+='1';editing+='2';assert.equal(editing,'12');editing+='0';assert.equal(editing,'120');editing='';assert.equal(editing,'');
  assert.match(inputHandler,/editingValue=input\.value/);assert.doesNotMatch(inputHandler,/renderProduction|productionInputNumber|distribution\.adjusted/);assert.match(changeHandler,/text===''\?0/);assert.match(changeHandler,/distribution\.adjusted/);assert.match(changeHandler,/renderProductionDistribution/);
});

test('la tabla visual de Preasignación desaparece y su cálculo interno permanece',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),logic=fs.readFileSync(path.join(__dirname,'production.js'),'utf8');
  assert.doesNotMatch(html,/id="productionAssignmentsTbody"/);assert.doesNotMatch(html,/function renderProductionAssignments/);assert.match(logic,/calculateDailyPreassignmentHours/);assert.match(logic,/PREASSIGNMENT_DATA_MISSING/);
});

test('el desglose visual presenta actividades en filas, días en columnas y totales finales',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/<th>Actividad<\/th>\$\{visibleDays\.map/);assert.match(html,/breakdown\.columns\.map\(column=>`<tr>/);assert.match(html,/<th>Total semana<\/th>/);assert.match(html,/<td>Total día<\/td>/);assert.match(html,/breakdown\.totalsByDay\[day\.code\]/);assert.match(html,/breakdown\.grandTotal/);assert.match(html,/production-dynamic-breakdown th:first-child[^}]*position:sticky/);
});

test('la interfaz oculta Recepción eliminada y representa menos cero como cero',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),source=html.match(/function productionNumber\(value\)\{[\s\S]*?\n\}/)?.[0];assert.ok(source);
  const format=Function(`${source};return productionNumber;`)();assert.equal(format(-0),'0');assert.match(html,/receptionStatus\.hidden=!receptionTask/);assert.match(html,/receptionStatus\.textContent=!receptionTask\?'':/);
});

const manufacturingProduct=(forecastUnits=100,variants=[])=>({productId:'P1',productCode:'P1',name:'Ramo prueba',category:'ROSAS',forecastUnits,variants});
const manufacturingWeek=(year,week,variants,extra={})=>({year,week,status:'closed',isComplete:true,campaigns:[],holidayDays:[],products:[manufacturingProduct(100,variants)],...extra});
const manufacturingInput=extra=>({weeklyTotal:100,productForecast:[manufacturingProduct(100,[{variantKey:'1',variantIndex:1,quantity:60},{variantKey:'2',variantIndex:2,quantity:40}])],nomenclatures:[{productId:'P1',category:'ROSAS',manufacturingRates:[10,20]}],adjustedDailyExpeditions:days(50,50),purchases:[{day:'monday',category:'ROSAS',units:100}],...extra});

test('Fabricación calcula productos, variantes, rendimientos exactos y horas-persona',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput());
  assert.equal(result.status,'calculated');assert.equal(result.weeklyHours,8);assert.equal(result.products[0].variants[0].hours,6);assert.equal(result.products[0].variants[1].hours,2);assert.equal(result.calculationMeta.exactPercentage,100);
});

test('la previsión explícita por variante tiene prioridad sobre cualquier histórico',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({recentHistory:[manufacturingWeek(2026,31,[{variantIndex:1,quantity:1},{variantIndex:2,quantity:99}])],referenceWeek:manufacturingWeek(2025,33,[{variantIndex:1,quantity:1},{variantIndex:2,quantity:99}])}));
  assert.equal(result.products[0].variantSource,'explicit-forecast');assert.deepEqual(result.products[0].variants.map(item=>item.quantity),[60,40]);assert.deepEqual(result.calculationMeta.recentWeeksUsed,[]);assert.equal(result.calculationMeta.referenceWeekUsed,null);
});

test('sin variantes explícitas usa la distribución del histórico reciente válido',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],recentHistory:[manufacturingWeek(2026,31,[{variantIndex:1,quantity:75},{variantIndex:2,quantity:25}])]}));
  assert.equal(result.products[0].variantSource,'recent-history');assert.deepEqual(result.products[0].variants.map(item=>item.quantity),[75,25]);assert.deepEqual(result.calculationMeta.recentWeeksUsed,[{year:2026,week:31}]);
});

test('ordena varias semanas recientes sin depender de comparableKey global',()=>{
  const recentHistory=[manufacturingWeek(2026,29,[{variantIndex:1,quantity:50},{variantIndex:2,quantity:50}]),manufacturingWeek(2026,31,[{variantIndex:1,quantity:70},{variantIndex:2,quantity:30}]),manufacturingWeek(2025,52,[{variantIndex:1,quantity:90},{variantIndex:2,quantity:10}])];
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],recentHistory}));assert.equal(result.products[0].variantSource,'recent-history');assert.deepEqual(result.calculationMeta.recentWeeksUsed,[{year:2026,week:31},{year:2026,week:29},{year:2025,week:52}]);
});

test('ordena correctamente semanas ISO 1, 52 y 53 al cambiar de año',()=>{
  const recentHistory=[manufacturingWeek(2025,53,[{variantIndex:1,quantity:53},{variantIndex:2,quantity:47}]),manufacturingWeek(2026,1,[{variantIndex:1,quantity:1},{variantIndex:2,quantity:99}]),manufacturingWeek(2025,52,[{variantIndex:1,quantity:52},{variantIndex:2,quantity:48}])];
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],recentHistory}));
  assert.deepEqual(result.calculationMeta.recentWeeksUsed,[{year:2026,week:1},{year:2025,week:53},{year:2025,week:52}]);
});

test('sin previsión explícita ni histórico reciente usa la semana de referencia',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],referenceWeek:manufacturingWeek(2025,33,[{variantIndex:1,quantity:20},{variantIndex:2,quantity:80}])}));
  assert.equal(result.products[0].variantSource,'reference-week');assert.deepEqual(result.products[0].variants.map(item=>item.quantity),[20,80]);assert.deepEqual(result.calculationMeta.referenceWeekUsed,{year:2025,week:33});
});

test('combina histórico reciente y referencia con pesos 60/40',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],recentHistory:[manufacturingWeek(2026,31,[{variantIndex:1,quantity:80},{variantIndex:2,quantity:20}])],referenceWeek:manufacturingWeek(2025,33,[{variantIndex:1,quantity:30},{variantIndex:2,quantity:70}])}));
  assert.equal(result.products[0].variantSource,'recent-reference-blend');assert.deepEqual(result.products[0].variants.map(item=>item.quantity),[60,40]);
});

test('si falta una de las fuentes históricas la disponible pesa el 100 %',()=>{
  const recentOnly=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],recentHistory:[manufacturingWeek(2026,31,[{variantIndex:1,quantity:65},{variantIndex:2,quantity:35}])]}));
  const referenceOnly=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100)],referenceWeek:manufacturingWeek(2025,33,[{variantIndex:1,quantity:35},{variantIndex:2,quantity:65}])}));
  assert.deepEqual(recentOnly.products[0].variants.map(item=>item.quantity),[65,35]);assert.deepEqual(referenceOnly.products[0].variants.map(item=>item.quantity),[35,65]);
});

test('Compras solo contrasta categorías y nunca sustituye la previsión de Fabricación',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({purchases:[{day:'monday',category:'ROSAS',units:9999}]}));
  assert.equal(result.calculationMeta.normalizedTotal,100);assert.equal(result.products[0].forecastUnits,100);assert.equal(result.weeklyHours,8);assert.ok(result.warnings.some(message=>message.includes('superiores')));
});

test('una categoría prevista sin compras genera un aviso informativo no bloqueante',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({purchases:[]}));
  assert.ok(result.warnings.some(message=>message.includes('no hay compras previstas')));assert.deepEqual(result.blockingErrors,[]);assert.equal(result.status,'calculated');
});

test('la composición manual por categoría no es requisito del cálculo automático',()=>{
  let state=Production.createProductionState();for(const kind of ['reception','preassignment','shipping']){const task=state.tasks.find(item=>item.specialKind===kind);state=Production.deleteProductionTask(state,task.id).state;}const plan=balancedPlan(2027,8,100);
  const calc=Production.calculateWeeklyPlan(plan,state,manufacturingInput({productForecast:[manufacturingProduct(100,[{variantKey:'1',variantIndex:1,quantity:100}])],nomenclatures:[{productId:'P1',category:'ROSAS',manufacturingRates:[10]}]}));
  assert.equal(calc.incomplete,false);assert.equal(calc.manufacturingPlan.status,'calculated');assert.ok(!calc.issues.some(item=>item.code==='CATEGORY_MIX_MISSING'));
});

test('la falta de composición manual tampoco bloquea la validación semanal',()=>{
  let state=Production.createProductionState();for(const kind of ['reception','preassignment','shipping']){const task=state.tasks.find(item=>item.specialKind===kind);state=Production.deleteProductionTask(state,task.id).state;}const plan=balancedPlan(2027,8,100);
  const result=Production.validateWeeklyPlan(state,plan,manufacturingInput({productForecast:[manufacturingProduct(100,[{variantKey:'1',variantIndex:1,quantity:100}])],nomenclatures:[{productId:'P1',category:'ROSAS',manufacturingRates:[10]}]}));
  assert.equal(result.ok,true);assert.equal(result.plan.status,'validated');assert.ok(!result.calculated.blockingIssues.some(item=>item.code==='CATEGORY_MIX_MISSING'));
});

test('una variante sin rendimiento exacto usa la media configurada del producto',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100,[{variantKey:'3',variantIndex:3,quantity:100}])]}));
  assert.equal(result.products[0].variants[0].rate,15);assert.equal(result.products[0].variants[0].rateSource,'product-average');assert.equal(result.status,'estimated');
});

test('si el producto no tiene rendimientos usa la media disponible de su categoría',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[{...manufacturingProduct(100,[{variantKey:'1',variantIndex:1,quantity:100}]),productId:'P2',productCode:'P2'}],nomenclatures:[{productId:'P1',category:'ROSAS',manufacturingRates:[10,20]}]}));
  assert.equal(result.products[0].variants[0].rate,15);assert.equal(result.products[0].variants[0].rateSource,'category-average');assert.equal(result.status,'estimated');
});

test('un producto sin rendimiento no anula las horas calculables de los demás',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({weeklyTotal:100,productForecast:[manufacturingProduct(96,[{variantKey:'1',variantIndex:1,quantity:96}]),{...manufacturingProduct(4,[{variantKey:'1',variantIndex:1,quantity:4}]),productId:'P2',productCode:'P2',name:'Sin rendimiento',category:'PLANTAS'}],nomenclatures:[{productId:'P1',category:'ROSAS',manufacturingRates:[12]}]}));
  assert.equal(result.weeklyHours,8);assert.equal(result.status,'partial');assert.equal(result.calculationMeta.unresolvedPercentage,4);assert.deepEqual(result.blockingErrors,[]);
});

test('las horas de Fabricación se distribuyen según las expediciones diarias ajustadas',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({adjustedDailyExpeditions:days(25,75)}));
  assert.equal(result.dailyHours.monday,2);assert.equal(result.dailyHours.tuesday,6);assert.equal(Object.values(result.dailyHours).reduce((a,b)=>a+b,0),8);
});

test('una Fabricación estimada sigue permitiendo validar la semana',()=>{
  let state=Production.createProductionState();for(const kind of ['reception','preassignment','shipping']){const task=state.tasks.find(item=>item.specialKind===kind);state=Production.deleteProductionTask(state,task.id).state;}const plan=balancedPlan(2027,8,100),options=manufacturingInput({productForecast:[manufacturingProduct(100,[{variantKey:'3',variantIndex:3,quantity:100}])]});
  const result=Production.validateWeeklyPlan(state,plan,options);assert.equal(result.ok,true);assert.equal(result.calculated.manufacturingPlan.status,'estimated');
});

test('la ausencia material de rendimientos aplicables sí bloquea la validación',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({nomenclatures:[]}));
  assert.equal(result.status,'pending');assert.ok(result.blockingErrors.some(message=>message.includes('ningún rendimiento aplicable')));assert.equal(result.calculationMeta.unresolvedPercentage,100);
});

test('el detalle visible de Fabricación incluye producto, variante, origen, rendimiento y estado',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');assert.match(html,/id="productionManufacturingDetails"/);assert.match(html,/Detalle de Fabricación/);assert.match(html,/Rendimiento aplicado/);assert.match(html,/variantSourceLabel/);assert.match(html,/Avisos no bloqueantes/);assert.match(html,/manufacturingStatuses/);
});

test('el cálculo automático nunca propaga NaN ni convierte pendientes en horas válidas',()=>{
  const result=Production.calculateManufacturingPlan(manufacturingInput({productForecast:[manufacturingProduct(100,[{variantKey:'1',variantIndex:1,quantity:50},{variantKey:'2',variantIndex:2,quantity:Number.NaN}])],nomenclatures:[]}));
  assert.ok(Number.isFinite(result.weeklyHours));assert.ok(Object.values(result.dailyHours).every(Number.isFinite));assert.equal(result.products[0].variants[0].hours,null);assert.equal(result.products[0].variants[0].rate,null);
});

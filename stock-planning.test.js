const test=require('node:test');
const assert=require('node:assert/strict');
const StockPlanning=require('./stock-planning.js');
const Production=require('./production.js');

const NOW='2026-08-05T10:00:00.000Z';

test('weekKey mantiene el formato sin ceros (compatibilidad con weekSnapshots existentes)',()=>{
  assert.equal(StockPlanning.weekKey(2026,5),'2026-5');
  assert.equal(StockPlanning.weekKey(2026,32),'2026-32');
  assert.deepEqual(StockPlanning.parseWeekKey('2026-32'),{year:2026,week:32});
});

test('shiftWeek atraviesa el cambio de año ISO igual que Producción (2026 tiene 53 semanas)',()=>{
  const next=StockPlanning.shiftWeek(2026,53,1);
  assert.equal(next.year,2027);assert.equal(next.week,1);assert.equal(next.key,'2027-1');
  const prev=StockPlanning.shiftWeek(next.year,next.week,-1);
  assert.equal(prev.year,2026);assert.equal(prev.week,53);
});

test('isoWeekInfo coincide con AquarelleProduction.isoWeekInfo para las mismas fechas',()=>{
  ['2026-01-01','2026-08-05','2026-12-31','2027-01-04'].forEach(iso=>{
    const date=new Date(`${iso}T00:00:00.000Z`);
    const mine=StockPlanning.isoWeekInfo(date),theirs=Production.isoWeekInfo(date);
    assert.equal(mine.year,theirs.year,`año distinto en ${iso}`);
    assert.equal(mine.week,theirs.week,`semana distinta en ${iso}`);
  });
});

test('getPlanningHorizon devuelve exactamente 8 semanas consecutivas desde la siguiente',()=>{
  const horizon=StockPlanning.getPlanningHorizon(2026,32,8);
  assert.equal(horizon.length,8);
  assert.deepEqual(horizon[0],StockPlanning.shiftWeek(2026,32,1));
  assert.deepEqual(horizon[7],StockPlanning.shiftWeek(2026,32,8));
});

test('normalizeStockWeekPlan migra snapshots antiguos sin campo mode',()=>{
  const legacyWithFlag=StockPlanning.normalizeStockWeekPlan({planningMode:true});
  assert.equal(legacyWithFlag.mode,'planificacion');
  const legacyWithoutFlag=StockPlanning.normalizeStockWeekPlan({});
  assert.equal(legacyWithoutFlag.mode,'actual');
  const explicit=StockPlanning.normalizeStockWeekPlan({mode:'historico'});
  assert.equal(explicit.mode,'historico');
  const bogus=StockPlanning.normalizeStockWeekPlan({mode:'no-existe'});
  assert.equal(bogus.mode,'actual');
});

test('normalizeStockWeekPlan aplica defaults seguros y no altera los campos existentes',()=>{
  const veryOld={key:'2026-32',year:2026,week:32,data:[{producto:'A',generico:'G',saldo:10}],genericoData:{G:{compraL:5}},prevExpedicionProducto:{A:3}};
  const n=StockPlanning.normalizeStockWeekPlan(veryOld,{now:NOW});
  assert.equal(n.initialBalanceMode,'inherit');
  assert.deepEqual(n.data,veryOld.data);
  assert.equal(n.prevExpedicionProducto.A,3);
  assert.equal(n.genericoData.G.compraL,5);
});

test('normalizeStockWeekPlan ignora sin error los campos de la generación anterior (campaignAdjustments/manualDailyDistribution/manualForecastProducts)',()=>{
  const legacyFromTests={year:2026,week:36,data:[],campaignAdjustments:{X:{delta:60}},manualDailyDistribution:{X:{monday:10}},manualForecastProducts:{'A|1':{units:5}}};
  const n=StockPlanning.normalizeStockWeekPlan(legacyFromTests);
  assert.equal(n.mode,'actual');
  assert.equal(n.initialBalanceMode,'inherit');
  // No se migran ni se leen: no forman parte del modelo nuevo, pero tampoco provocan error.
});

const rowsG=[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:30},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:10},{producto:'T3',generico:'G',categoria:'ROSAS',saldo:0}];

test('forecastForGenerico suma por producto/talla cuando no hay override a nivel de genérico (semana actual/S+1)',()=>{
  const plan={prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  assert.equal(StockPlanning.forecastForGenerico(plan,'G',['T1','T2','T3']),7);
  assert.equal(StockPlanning.hasGenericoForecastOverride(plan,'G'),false);
});

test('forecastForGenerico usa el valor a nivel de genérico cuando existe explícitamente (S+2+, misma clave que usa la tabla agrupada)',()=>{
  const plan={prevExpedicionProducto:{T1:5,T2:2,T3:0,G:300}};
  assert.equal(StockPlanning.hasGenericoForecastOverride(plan,'G'),true);
  assert.equal(StockPlanning.forecastForGenerico(plan,'G',['T1','T2','T3']),300); // el override manda, no se suman las tallas
});

test('forecastForGenerico con override explícito a 0 sigue siendo un override (no cae al fallback de suma)',()=>{
  const plan={prevExpedicionProducto:{T1:5,T2:2,T3:0,G:0}};
  assert.equal(StockPlanning.hasGenericoForecastOverride(plan,'G'),true);
  assert.equal(StockPlanning.forecastForGenerico(plan,'G',['T1','T2','T3']),0);
});

test('applyWeekMovement reparte las compras de un generico proporcionalmente al saldo de cada talla (sin override de previsión)',()=>{
  const plan={genericoData:{G:{compraL:100,compraM:0,compraX:0,compraJ:0,compraV:0}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const opening={T1:30,T2:10,T3:0};
  const result=StockPlanning.applyWeekMovement(rowsG,opening,plan);
  assert.deepEqual(result,{T1:100,T2:33,T3:0});
});

test('applyWeekMovement con override de previsión a nivel de genérico (S+2+): la previsión de la familia se reparte entre las tallas para mantener el saldo interno coherente',()=>{
  const plan={genericoData:{G:{compraL:100}},prevExpedicionProducto:{G:40}};
  const opening={T1:30,T2:10,T3:0};
  const result=StockPlanning.applyWeekMovement(rowsG,opening,plan);
  // entradaFamilia=100 -> partes[75,25,0]; previsiónFamilia=40 -> partes[30,10,0]
  assert.deepEqual(result,{T1:75,T2:25,T3:0}); // T1:30+75-30 ; T2:10+25-10 ; T3:0+0-0
});

test('applyWeekMovement suma pendientePreasignar como entrada, igual que buildPlanningInitialData, solo en categorías donde aplica',()=>{
  const plan={genericoData:{G:{compraL:100,pendientePreasignar:20}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const result=StockPlanning.applyWeekMovement(rowsG,{T1:30,T2:10,T3:0},plan);
  // entradaFamilia=100+20=120; pesos[30,10,0] total40 -> partes[90,30,0]
  assert.deepEqual(result,{T1:115,T2:38,T3:0}); // T1:30+90-5 ; T2:10+30-2 ; T3:0+0-0
});

test('pendientePreasignar no se suma cuando la categoría no aplica preasignación (mismo criterio que aplicaPreasignacion)',()=>{
  const rowsPlantas=rowsG.map(row=>({...row,categoria:'PLANTAS'}));
  const plan={genericoData:{G:{compraL:100,pendientePreasignar:20}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const result=StockPlanning.applyWeekMovement(rowsPlantas,{T1:30,T2:10,T3:0},plan);
  assert.deepEqual(result,{T1:100,T2:33,T3:0}); // idéntico a sin pendientePreasignar: PLANTAS no aplica
});

test('aplicaPreasignacion es una única fuente de verdad (ROSAS y SIMPLES, nada más)',()=>{
  assert.equal(StockPlanning.aplicaPreasignacion('ROSAS'),true);
  assert.equal(StockPlanning.aplicaPreasignacion('SIMPLES'),true);
  assert.equal(StockPlanning.aplicaPreasignacion('PLANTAS'),false);
  assert.equal(StockPlanning.aplicaPreasignacion('COMPUESTOS'),false);
});

test('applyWeekMovement con semana sin borrador (plan null) no mueve el saldo',()=>{
  const opening={T1:30,T2:10,T3:0};
  const result=StockPlanning.applyWeekMovement(rowsG,opening,null);
  assert.deepEqual(result,opening);
});

test('endingBalanceForPlan usa data[].saldo como apertura y aplica el mismo movimiento',()=>{
  const plan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  assert.deepEqual(StockPlanning.endingBalanceForPlan(plan),{T1:100,T2:33,T3:0});
});

test('addPlannedProduct exige metadatos reales (categoria/generico/producto), no texto libre vacío',()=>{
  const result=StockPlanning.addPlannedProduct({data:[]},{categoria:'',generico:'',producto:''});
  assert.equal(result.ok,false);
  assert.ok(result.errors.length>=2);
});

test('addPlannedProduct incorpora el producto como una fila normal de data, con categoría/generico/codeBase reales (no inventados)',()=>{
  const add=StockPlanning.addPlannedProduct({data:[{producto:'X',generico:'G',categoria:'ROSAS',saldo:5}]},{categoria:'COMPUESTOS',generico:'Ramo San Valentin',producto:'Ramo San Valentin',codeBase:'RSV-001'},{now:NOW});
  assert.equal(add.ok,true);
  assert.equal(add.plan.data.length,2);
  const row=add.plan.data.find(r=>r.producto==='Ramo San Valentin');
  assert.equal(row.categoria,'COMPUESTOS'); // la categoría real, no el código de producto
  assert.equal(row.generico,'Ramo San Valentin');
  assert.equal(row.codeBase,'RSV-001');
  assert.equal(row.saldo,0);
  assert.equal(row.addedManually,true);
});

test('addPlannedProduct rechaza duplicar un producto ya presente en la planificación de esa semana',()=>{
  const result=StockPlanning.addPlannedProduct({data:[{producto:'Ramo San Valentin',generico:'Ramo San Valentin',categoria:'COMPUESTOS',saldo:0}]},{categoria:'COMPUESTOS',generico:'Ramo San Valentin',producto:'Ramo San Valentin'});
  assert.equal(result.ok,false);
});

test('removePlannedProduct elimina únicamente esa fila añadida manualmente, sin tocar el resto del plan',()=>{
  const add=StockPlanning.addPlannedProduct({data:[{producto:'X',generico:'G',categoria:'ROSAS',saldo:5}],prevExpedicionProducto:{'Ramo San Valentin':300},genericoData:{'Ramo San Valentin':{compraL:10}}},{categoria:'COMPUESTOS',generico:'Ramo San Valentin',producto:'Ramo San Valentin'});
  const removed=StockPlanning.removePlannedProduct(add.plan,'Ramo San Valentin');
  assert.deepEqual(removed.data,[{producto:'X',generico:'G',categoria:'ROSAS',saldo:5}]);
  assert.equal(Object.prototype.hasOwnProperty.call(removed.prevExpedicionProducto,'Ramo San Valentin'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(removed.genericoData,'Ramo San Valentin'),false);
});

test('removePlannedProduct nunca elimina una fila real (no marcada addedManually) aunque comparta el mismo producto',()=>{
  const plan={data:[{producto:'X',generico:'G',categoria:'ROSAS',saldo:5}]};
  const removed=StockPlanning.removePlannedProduct(plan,'X');
  assert.deepEqual(removed.data,plan.data);
});

test('removePlannedProduct limpia PREV./compras aunque estén guardados bajo la clave del genérico, no del producto (fila agrupada de una sola variante)',()=>{
  // Caso real: producto (código de catálogo) y generico (nombre real) son distintos, y la tabla
  // agrupada escribe PREV./compras bajo row.generico, no bajo el producto/código.
  const add=StockPlanning.addPlannedProduct({data:[]},{categoria:'COMPUESTOS',generico:'Ramo San Valentín',producto:'RSV-001',codeBase:'RSV-001'});
  let plan=add.plan;
  plan={...plan,prevExpedicionProducto:{'Ramo San Valentín':300},genericoData:{'Ramo San Valentín':{compraL:50}}};
  const removed=StockPlanning.removePlannedProduct(plan,'RSV-001');
  assert.deepEqual(removed.data,[]);
  assert.equal(Object.prototype.hasOwnProperty.call(removed.prevExpedicionProducto,'Ramo San Valentín'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(removed.genericoData,'Ramo San Valentín'),false);
});

test('removePlannedProduct no borra genericoData/prevExpedicionProducto de un genérico que todavía usa otra fila real',()=>{
  const plan={
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:5,addedManually:false},{producto:'ADD1',generico:'G',categoria:'ROSAS',saldo:0,addedManually:true}],
    prevExpedicionProducto:{G:80},genericoData:{G:{compraL:20}}
  };
  const removed=StockPlanning.removePlannedProduct(plan,'ADD1');
  assert.deepEqual(removed.data,[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:5,addedManually:false}]);
  // G sigue usándose por T1: no se debe borrar la previsión/compras compartidas del genérico.
  assert.equal(removed.prevExpedicionProducto.G,80);
  assert.equal(removed.genericoData.G.compraL,20);
});

test('projectOpeningBalance de un solo salto (S32->S33) sin borrador de S33 usa el saldo final de S32',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const result=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:33,getStoredPlan:()=>null});
  assert.deepEqual(result.balances,{T1:100,T2:33,T3:0});
  assert.equal(result.initialBalanceMode,'inherit');
});

test('projectOpeningBalance con offset<=0 devuelve el saldo de apertura del ancla sin proyectar',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:7}]};
  const result=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:32,getStoredPlan:()=>null});
  assert.deepEqual(result.balances,{A:7});
});

test('projectOpeningBalance atraviesa S32->S33->S34->S35->S36 sin exigir que las intermedias existan',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-34':{genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'}};
  const seenLookups=[];
  const getStoredPlan=(year,week)=>{seenLookups.push(`${year}-${week}`);return storedPlans[`${year}-${week}`]||null;};
  const result=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,getStoredPlan});
  // S32 ending = {T1:100,T2:33,T3:0} (igual que el test de un solo salto)
  // S33 sin borrador -> sin movimiento -> {T1:100,T2:33,T3:0}
  // S34 con compras 10: pesos [100,33,0], total 133; partes = [round(10*100/133)=8, round(10*33/133)=2, resto=0]
  //   T1=100+8-50=58; T2=33+2-0=35; T3=0
  // S35 sin borrador -> sin movimiento -> {T1:58,T2:35,T3:0}
  // S36 es el objetivo -> se devuelve esa apertura sin consumir su propia previsión
  assert.deepEqual(result.balances,{T1:58,T2:35,T3:0});
  assert.equal(result.initialBalanceMode,'inherit');
  // Ninguna semana intermedia quedó persistida: el "almacén" de borradores sigue teniendo solo S34
  assert.deepEqual(Object.keys(storedPlans),['2026-34']);
  assert.deepEqual(seenLookups,['2026-33','2026-34','2026-35','2026-36']);
});

test('projectOpeningBalance: initialBalanceMode=zero en una semana intermedia rompe la cadena en ese punto',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-34':{genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'zero'}};
  const result=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null});
  // En S34 la apertura se resetea a 0 para todos los productos, independientemente de lo que llegara de S33.
  // Con apertura toda a 0, el reparto de compras cae al reparto igualitario (sin pesos): 10/3 -> [3,3,4]
  assert.deepEqual(result.balances,{T1:-47,T2:3,T3:4}); // T1: 0+3-50 ; T2: 0+3-0 ; T3: 0+4-0
});

test('projectOpeningBalance usa la previsión automática (no 0) en una semana intermedia sin borrador',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  // Objetivo S34 para que S33 (intermedia, sin borrador) sea realmente "consumida" por el camino: su
  // propia previsión nunca debe restarse de su propia apertura, solo de la apertura de la SIGUIENTE semana.
  // S32 termina en {T1:100,T2:33,T3:0} (igual que siempre). S33 no tiene borrador, pero SÍ una previsión
  // automática de 20 unidades repartida según la mezcla de previsión del ancla (pesos [5,2,0], total 7):
  // partes = [round(20*5/7)=14, round(20*2/7)=6, resto=0] -> prevExpedicionProducto sintética {T1:14,T2:6,T3:0}
  // (compras sigue siendo 0: no se inventan compras). Balance resultante en S34: T1=100+0-14=86; T2=33+0-6=27; T3=0.
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,
    getStoredPlan:()=>null,
    getAutomaticForecastTotal:(y,w)=>(w===33?20:null)
  });
  assert.deepEqual(result.balances,{T1:86,T2:27,T3:0});
});

test('la previsión automática de las semanas intermedias reduce el saldo proyectado frente a tratarlas como 0',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-34':{genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'}};
  const withoutAutomatic=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,
    getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null,
    getAutomaticForecastTotal:()=>null
  });
  const withAutomatic=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,
    getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null,
    getAutomaticForecastTotal:(y,w)=>({'2026-33':20,'2026-35':15}[`${y}-${w}`]??null)
  });
  assert.deepEqual(withoutAutomatic.balances,{T1:58,T2:35,T3:0}); // idéntico al test de arriba: sin previsión automática, se sigue tratando como hoy
  assert.deepEqual(withAutomatic.balances,{T1:33,T2:25,T3:0});
  assert.ok(withAutomatic.balances.T1<withoutAutomatic.balances.T1,'la previsión automática debe reducir el saldo, no dejarlo igual o mayor');
  assert.ok(withAutomatic.balances.T2<withoutAutomatic.balances.T2,'la previsión automática debe reducir el saldo, no dejarlo igual o mayor');
});

test('mezcla S33 automática + S34 con borrador real + S35 automática: S34 no se sobreescribe con previsión automática',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-34':{genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'}};
  const totals={'2026-33':20,'2026-35':15};
  const seenAuto=[],seenStored=[];
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,
    getStoredPlan:(y,w)=>{seenStored.push(`${y}-${w}`);return storedPlans[`${y}-${w}`]||null;},
    getAutomaticForecastTotal:(y,w)=>{seenAuto.push(`${y}-${w}`);return totals[`${y}-${w}`]??null;}
  });
  assert.deepEqual(result.balances,{T1:33,T2:25,T3:0});
  // S34 tiene borrador real: nunca debe consultarse la previsión automática para esa semana (stored gana siempre).
  assert.ok(!seenAuto.includes('2026-34'),'S34 tiene borrador real y no debe usar previsión automática');
  assert.deepEqual(Object.keys(storedPlans),['2026-34']); // S33/S35/S36 nunca se persisten
});

test('initialBalanceMode=zero en una semana intermedia sigue rompiendo la cadena aunque haya previsión automática alrededor',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-34':{genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'zero'}};
  const totals={'2026-33':20,'2026-35':15};
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:36,
    getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null,
    getAutomaticForecastTotal:(y,w)=>totals[`${y}-${w}`]??null
  });
  // S34 sigue reseteando la apertura a 0 sin importar lo que llegara de S33 (automática); y S35 (automática)
  // sigue aplicándose con normalidad sobre lo que salga de S34. Ver desglose exacto en el informe de entrega.
  assert.deepEqual(result.balances,{T1:-58,T2:-1,T3:4});
});

test('sin previsión automática disponible ni borrador, una semana intermedia sigue sin inventar previsión (0)',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:33,
    getStoredPlan:()=>null,
    getAutomaticForecastTotal:()=>null
  });
  assert.deepEqual(result.balances,{T1:100,T2:33,T3:0}); // igual que sin la nueva opción: compras 0 y previsión 0
});

test('projectOpeningBalance: pendientePreasignar de una semana real intermedia aumenta el saldo proyectado de la siguiente',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const withoutPrea={genericoData:{G:{compraL:10,pendientePreasignar:0}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'};
  const withPrea={genericoData:{G:{compraL:10,pendientePreasignar:30}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'};
  const resultWithout=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,getStoredPlan:(y,w)=>(w===33?withoutPrea:null)});
  const resultWith=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,getStoredPlan:(y,w)=>(w===33?withPrea:null)});
  // Sin pendientePreasignar: entradaFamilia(S33)=10; con pendientePreasignar=30: entradaFamilia(S33)=40.
  assert.deepEqual(resultWithout.balances,{T1:58,T2:35,T3:0});
  assert.deepEqual(resultWith.balances,{T1:80,T2:43,T3:0});
  assert.ok(resultWith.balances.T1>resultWithout.balances.T1,'pendientePreasignar debe aumentar el saldo proyectado, no dejarlo igual');
  assert.ok(resultWith.balances.T2>resultWithout.balances.T2,'pendientePreasignar debe aumentar el saldo proyectado, no dejarlo igual');
});

test('una semana sintética sin borrador no inventa pendientePreasignar, solo reparte la previsión automática',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,
    getStoredPlan:()=>null, // S33 no tiene borrador, aunque su categoría (ROSAS) SÍ aplicaría preasignación si hubiera un valor real
    getAutomaticForecastTotal:(y,w)=>(w===33?20:null)
  });
  // S33 sintética: compras=0, pendientePreasignar=0 (genericoData:{} vacío en el plan sintético),
  // previsión=20 repartida según pesos del ancla [5,2,0] total7 -> partes [14,6,0].
  assert.deepEqual(result.balances,{T1:86,T2:27,T3:0}); // T1:100+0-14 ; T2:33+0-6 ; T3:0
});

test('initialBalanceMode=zero sigue reseteando correctamente la apertura aunque la semana tenga pendientePreasignar',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const storedPlans={'2026-33':{genericoData:{G:{compraL:10,pendientePreasignar:30}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'zero'}};
  const result=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null});
  // Apertura de S33 se resetea a 0 sin importar el saldo que llegara del ancla. Con apertura 0, los
  // pesos son [0,0,0] -> reparto igualitario de entradaFamilia=10+30=40 entre 3 filas: [13,13,resto 14]
  assert.deepEqual(result.balances,{T1:-37,T2:13,T3:14}); // T1:0+13-50 ; T2:0+13-0 ; T3:0+14-0
});

test('buildAutomaticForecastPlan marca su resultado como proyección sintética explícita (synthetic:true)',()=>{
  const plan=StockPlanning.buildAutomaticForecastPlan(rowsG,{T1:5,T2:2,T3:0},2026,33,()=>20);
  assert.equal(plan.synthetic,true);
  assert.deepEqual(plan.genericoData,{}); // nunca inventa compras ni pendientePreasignar
});

test('la proyección sintética nunca se convierte en la previsión persistida de la semana que finalmente se abre',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const projection=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:33,
    getStoredPlan:()=>null,
    getAutomaticForecastTotal:()=>999 // si esto se filtrara al borrador, se notaría en prevExpedicionProducto
  });
  const draft=StockPlanning.buildDraftWeekPlan({year:2026,week:33,rows:rowsG,openingBalances:projection.balances,initialBalanceMode:projection.initialBalanceMode,now:NOW});
  assert.deepEqual(draft.prevExpedicionProducto,{}); // el borrador nuevo siempre arranca sin previsión propia
  assert.deepEqual(projection.balances,{T1:100,T2:33,T3:0}); // S33 es el target: su propia previsión (999) nunca se resta de su propia apertura
});

test('en cuanto existe un borrador real para una semana, la proyección sintética deja de consultarse para ella',()=>{
  const anchorPlan={data:rowsG,genericoData:{G:{compraL:100}},prevExpedicionProducto:{T1:5,T2:2,T3:0}};
  const realDraft={genericoData:{G:{compraL:10}},prevExpedicionProducto:{T1:50,T2:0,T3:0},initialBalanceMode:'inherit'};
  const seenAuto=[];
  StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,
    getStoredPlan:(y,w)=>(w===33?realDraft:null),
    getAutomaticForecastTotal:(y,w)=>{seenAuto.push(w);return 999;}
  });
  assert.ok(!seenAuto.includes(33),'S33 ya tiene borrador real: no debe consultarse la previsión automática ni mezclarse con ella');
});

test('projectOpeningBalance nunca crea ni modifica snapshots: el accesor de lectura es la única interacción',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:10}],genericoData:{},prevExpedicionProducto:{}};
  const storedPlans={'2026-34':{initialBalanceMode:'inherit'}};
  const beforeKeys=JSON.stringify(Object.keys(storedPlans));
  StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:37,getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null});
  assert.equal(JSON.stringify(Object.keys(storedPlans)),beforeKeys);
});

test('projectOpeningBalance corta con error si el horizonte es absurdamente largo (guarda contra bucles infinitos)',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:1}]};
  assert.throws(()=>StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2100,targetWeek:32,getStoredPlan:()=>null}),/horizonte de proyección/);
});

test('buildDraftWeekPlan crea un borrador en modo planificacion con el saldo proyectado y vista agrupada por defecto',()=>{
  const draft=StockPlanning.buildDraftWeekPlan({year:2026,week:36,rows:[{producto:'A',generico:'G',categoria:'ROSAS'}],openingBalances:{A:58},initialBalanceMode:'inherit',now:NOW});
  assert.equal(draft.mode,'planificacion');
  assert.equal(draft.initialBalanceMode,'inherit');
  assert.equal(draft.key,'2026-36');
  assert.equal(draft.data[0].saldo,58);
  assert.deepEqual(draft.prevExpedicionProducto,{});
  assert.equal(draft.groupView,true);
});

test('promoteWeekPlans es la única transición actual->historico y no altera los planes originales',()=>{
  const currentActualPlan={key:'2026-32',year:2026,week:32,mode:'actual',data:[{producto:'A',saldo:1}]};
  const targetPlan={key:'2026-33',year:2026,week:33,mode:'planificacion',baseWeekKey:'2026-32',data:[{producto:'A',saldo:2}]};
  const {previous,next}=StockPlanning.promoteWeekPlans({currentActualPlan,targetPlan});
  assert.equal(previous.mode,'historico');
  assert.deepEqual(previous.data,currentActualPlan.data);
  assert.equal(next.mode,'actual');
  assert.equal(next.baseWeekKey,null);
  assert.deepEqual(next.data,targetPlan.data);
  assert.equal(currentActualPlan.mode,'actual');
  assert.equal(targetPlan.mode,'planificacion');
});

test('filterHistoryPlans excluye los borradores planificacion aunque su semana sea anterior a la objetivo (S33-S35 no cuentan para S36)',()=>{
  const plans=[
    {year:2026,week:30,mode:'historico'},
    {year:2026,week:31,mode:'historico'},
    {year:2026,week:33,mode:'planificacion'},
    {year:2026,week:34,mode:'planificacion'},
    {year:2026,week:35,mode:'planificacion'},
  ];
  const eligible=StockPlanning.filterHistoryPlans(plans,2026,36);
  assert.deepEqual(eligible.map(p=>p.week),[30,31]);
});

test('filterHistoryPlans aplica el guard temporal opcional como segunda barrera',()=>{
  const plans=[{year:2026,week:30,mode:'historico'}];
  assert.deepEqual(StockPlanning.filterHistoryPlans(plans,2026,36,{isDateClosed:()=>false}),[]);
  assert.equal(StockPlanning.filterHistoryPlans(plans,2026,36,{isDateClosed:()=>true}).length,1);
});

test('isEligibleHistoryWeek rechaza la propia semana objetivo y semanas futuras aunque estén historico',()=>{
  assert.equal(StockPlanning.isEligibleHistoryWeek({year:2026,week:36,mode:'historico'},2026,36),false);
  assert.equal(StockPlanning.isEligibleHistoryWeek({year:2026,week:37,mode:'historico'},2026,36),false);
  assert.equal(StockPlanning.isEligibleHistoryWeek(null,2026,36),false);
});

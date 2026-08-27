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

test('S+2 manual -> S+1 con clic IA elimina solo el override de la semana activa y usa las tallas nuevas',()=>{
  const rowsS34=[
    {generico:'A-Rosas-Colores',producto:'A-Rosas-Colores-30_1'},
    {generico:'A-Rosas-Colores',producto:'A-Rosas-Colores-40_2'},
    {generico:'C-TOURNESOL',producto:'C-TOURNESOL_1'}
  ];
  const prevS34={
    'A-Rosas-Colores':22,
    'A-Rosas-Colores-30_1':0,
    'A-Rosas-Colores-40_2':0,
    'C-TOURNESOL_1':0
  };
  const prevOtraSemana={'A-Rosas-Colores':31,'A-Rosas-Colores-30_1':31};

  // Abrir/renderizar/guardar sin pulsar IA no llama al helper: el estado manual permanece intacto.
  assert.equal(prevS34['A-Rosas-Colores'],22);
  const recalculada=StockPlanning.clearGenericoForecastOverridesForWeek(prevS34,rowsS34);
  assert.equal(Object.hasOwn(recalculada,'A-Rosas-Colores'),false);
  assert.equal(Object.hasOwn(recalculada,'C-TOURNESOL'),false);
  assert.equal(prevS34['A-Rosas-Colores'],22,'el helper puro no modifica el snapshot original');
  assert.deepEqual(prevOtraSemana,{'A-Rosas-Colores':31,'A-Rosas-Colores-30_1':31});

  // Equivalente al reparto posterior del clic IA: 167 en Rosas + 377 en el resto = pendiente 544.
  recalculada['A-Rosas-Colores-30_1']=100;
  recalculada['A-Rosas-Colores-40_2']=67;
  recalculada['C-TOURNESOL_1']=377;
  const rosas=StockPlanning.forecastForGenerico({prevExpedicionProducto:recalculada},'A-Rosas-Colores',rowsS34.slice(0,2).map(r=>r.producto));
  const resto=StockPlanning.forecastForGenerico({prevExpedicionProducto:recalculada},'C-TOURNESOL',[rowsS34[2].producto]);
  assert.equal(rosas,167);
  assert.notEqual(rosas,22);
  assert.equal(rosas+resto,544);
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

// TEST A (fix S+1): saldo inicial de S+1 con saldo/compras/PREV./pendientePreasignar conocidos, replicando
// a mano la fórmula del antiguo buildPlanningInitialData() (index.html): por cada generico,
// entradaFamilia = compras + pendientePreasignar (solo si aplicaPreasignacion, aquí ROSAS sí aplica),
// repartida proporcionalmente al peso de saldo de cada talla (resto en la última fila), y luego
// saldo_final_talla = saldo_apertura + entrada_repartida - PREV_talla. projectOpeningBalance de S(actual)
// a S+1 debe dar exactamente ese resultado, sin exigir borrador de S+1 ni previsión automática.
test('projectOpeningBalance (S+1) reproduce exactamente la fórmula del antiguo buildPlanningInitialData',()=>{
  const rows=[
    {producto:'T1',generico:'G',categoria:'ROSAS',saldo:30},
    {producto:'T2',generico:'G',categoria:'ROSAS',saldo:10},
    {producto:'T3',generico:'G',categoria:'ROSAS',saldo:0}
  ];
  const anchorPlan={
    data:rows,
    genericoData:{G:{compraL:12,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:40}},
    prevExpedicionProducto:{T1:8,T2:5,T3:0}
  };
  // entradaFamilia = 12 (compras) + 40 (pendientePreasignar, ROSAS aplica) = 52
  // pesoTotal = 30+10+0 = 40; parteT1=round(52*30/40)=39; parteT2=round(52*10/40)=13; parteT3(resto)=52-39-13=0
  // T1 = 30+39-8 = 61 ; T2 = 10+13-5 = 18 ; T3 = 0+0-0 = 0
  const result=StockPlanning.projectOpeningBalance({
    anchorPlan,anchorYear:2026,anchorWeek:40,targetYear:2026,targetWeek:41,getStoredPlan:()=>null
  });
  assert.deepEqual(result.balances,{T1:61,T2:18,T3:0});
  assert.equal(result.initialBalanceMode,'inherit');
  // buildDraftWeekPlan (la función que crea el borrador real de S+1) debe partir exactamente de ese saldo.
  const draft=StockPlanning.buildDraftWeekPlan({year:2026,week:41,rows,openingBalances:result.balances,initialBalanceMode:result.initialBalanceMode,now:'2026-10-01T00:00:00.000Z'});
  assert.equal(draft.initialBalanceMode,'inherit');
  assert.deepEqual(draft.data.map(r=>[r.producto,r.saldo]),[['T1',61],['T2',18],['T3',0]]);
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

test('refreshInheritedBalance solo reescribe data[].saldo por producto, deja todo lo demás intacto',()=>{
  const plan={
    key:'2026-34',year:2026,week:34,mode:'planificacion',initialBalanceMode:'inherit',baseWeekKey:'2026-33',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:0,addedManually:true}],
    genericoData:{G:{compraL:5,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:12}},
    prevExpedicionProducto:{T1:9,T2:3},
    forecastAdjustments:{G:{percent:'20'}},
    simplesPrea:{G:7},
    groupView:true
  };
  const refreshed=StockPlanning.refreshInheritedBalance(plan,{T1:61,T2:18});
  assert.deepEqual(refreshed.data.map(r=>[r.producto,r.saldo]),[['T1',61],['T2',18]]);
  assert.equal(refreshed.data[1].addedManually,true); // metadatos de la fila preservados
  assert.deepEqual(refreshed.genericoData,plan.genericoData);
  assert.deepEqual(refreshed.prevExpedicionProducto,plan.prevExpedicionProducto);
  assert.deepEqual(refreshed.forecastAdjustments,plan.forecastAdjustments);
  assert.deepEqual(refreshed.simplesPrea,plan.simplesPrea);
  assert.equal(refreshed.initialBalanceMode,'inherit');
  assert.equal(refreshed.baseWeekKey,'2026-33');
  // el plan original no se muta
  assert.equal(plan.data[0].saldo,0);
});

test('refreshInheritedBalance conserva el saldo de una fila cuyo producto no aparece en openingBalances (nunca inventa un 0)',()=>{
  const plan={data:[{producto:'T1',saldo:5},{producto:'T2',saldo:8}]};
  const refreshed=StockPlanning.refreshInheritedBalance(plan,{T1:20});
  assert.deepEqual(refreshed.data.map(r=>[r.producto,r.saldo]),[['T1',20],['T2',8]]);
});

// TEST DE REGRESIÓN (S+1 congelada): reproduce exactamente el bug real reportado — un snapshot S+1 ya
// existente con saldo 0 (creado antes de que la semana actual tuviera compras/PREV), la semana actual
// con saldo final proyectado distinto de 0, y S+1 con compras/PREV manuales YA introducidos. Al
// recalcular (como hace ahora openStockPlanningWeek en el rol 's1') debe actualizarse solo el saldo.
test('refreshInheritedBalance corrige un snapshot S+1 congelado en 0 sin tocar sus compras/PREV manuales',()=>{
  const anchorPlan={
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:30},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:10}],
    genericoData:{G:{compraL:20,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:5,T2:5}
  };
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:34,getStoredPlan:()=>null});
  assert.notDeepEqual(projection.balances,{T1:0,T2:0}); // la semana actual SÍ tiene saldo final != 0
  const staleS1Snap={
    key:'2026-34',year:2026,week:34,mode:'planificacion',initialBalanceMode:'inherit',baseWeekKey:'2026-33',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:8,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}}, // compras manuales ya metidas en S+1
    prevExpedicionProducto:{T1:11,T2:4} // PREV manual ya metida en S+1
  };
  const refreshed=StockPlanning.refreshInheritedBalance(staleS1Snap,projection.balances);
  assert.deepEqual(refreshed.data.map(r=>[r.producto,r.saldo]),[['T1',projection.balances.T1],['T2',projection.balances.T2]]);
  assert.notDeepEqual(refreshed.data.map(r=>r.saldo),[0,0]); // ya no está congelado en 0
  assert.deepEqual(refreshed.genericoData,staleS1Snap.genericoData); // compras manuales de S+1 intactas
  assert.deepEqual(refreshed.prevExpedicionProducto,staleS1Snap.prevExpedicionProducto); // PREV manual de S+1 intacta
});

test('refreshInheritedBalance es idempotente: aplicarla dos veces con la misma proyección da exactamente el mismo estado',()=>{
  const staleS1Snap={
    key:'2026-34',year:2026,week:34,mode:'planificacion',initialBalanceMode:'inherit',baseWeekKey:'2026-33',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:8,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:11,T2:4}
  };
  const openingBalances={T1:61,T2:18};
  const once=StockPlanning.refreshInheritedBalance(staleS1Snap,openingBalances);
  const twice=StockPlanning.refreshInheritedBalance(once,openingBalances);
  assert.deepEqual(once,twice);
});

// TEST DE REGRESIÓN (bug real confirmado en sesión con datos de Supabase): el snapshot de S+1 puede
// conservar un initialBalanceMode:"zero" histórico (p.ej. de un ciclo de semanas anterior en el que ese
// mismo slot fue S+2+ con "Partir de 0"). Ese campo NUNCA debe respetarse para S+1: el patrón correcto
// (el que ahora usa openStockPlanningWeek en index.html) es excluir la propia clave (year,week) del
// getStoredPlan que se le pasa a projectOpeningBalance — el mismo truco que ya usaba
// setStockWeekInitialBalanceMode para S+2+ — y forzar snap.initialBalanceMode a 'inherit' después de
// refrescar. Sin esa exclusión, projectOpeningBalance lee el "zero" del propio snapshot que se está
// refrescando y devuelve saldo 0 para todo, por mucho que refreshInheritedBalance funcione bien.
test('S+1 con initialBalanceMode="zero" histórico: la exclusión de la propia clave fuerza inherit y recalcula el saldo real',()=>{
  const anchorPlan={
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:30},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:10}],
    genericoData:{G:{compraL:20,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:5,T2:5}
  };
  const staleS1Snap={
    key:'2026-34',year:2026,week:34,mode:'planificacion',initialBalanceMode:'zero',baseWeekKey:'2026-33',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:8,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}}, // compras ya en S+1
    prevExpedicionProducto:{T1:11,T2:4} // PREV ya en S+1
  };
  const storedPlans={'2026-34':staleS1Snap};
  const getStoredPlanSinExclusion=(y,w)=>storedPlans[`${y}-${w}`]||null;
  const getStoredPlanConExclusion=(y,w)=>(y===2026&&w===34)?null:getStoredPlanSinExclusion(y,w);

  // Reproduce primero el bug (sin la exclusión): confirma que SIN el fix, el "zero" histórico gana.
  const buggy=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:34,getStoredPlan:getStoredPlanSinExclusion});
  assert.equal(buggy.initialBalanceMode,'zero');
  assert.deepEqual(buggy.balances,{T1:0,T2:0});

  // Con la exclusión (lo que ahora hace openStockPlanningWeek): el "zero" histórico se ignora.
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:34,getStoredPlan:getStoredPlanConExclusion});
  assert.equal(projection.initialBalanceMode,'inherit');
  assert.notDeepEqual(projection.balances,{T1:0,T2:0}); // saldo final proyectado de S33 distinto de 0

  const refreshed=StockPlanning.refreshInheritedBalance(staleS1Snap,projection.balances);
  refreshed.initialBalanceMode='inherit'; // paso explícito que aplica openStockPlanningWeek tras refrescar
  assert.deepEqual(refreshed.data.map(r=>[r.producto,r.saldo]),[['T1',projection.balances.T1],['T2',projection.balances.T2]]);
  assert.notDeepEqual(refreshed.data.map(r=>r.saldo),[0,0]);
  assert.equal(refreshed.initialBalanceMode,'inherit'); // el snapshot queda coherente con su rol s1
  // compras y PREV que ya estaban en S+1 permanecen exactamente iguales
  assert.deepEqual(refreshed.genericoData,staleS1Snap.genericoData);
  assert.deepEqual(refreshed.prevExpedicionProducto,staleS1Snap.prevExpedicionProducto);
});

test('S+2 con initialBalanceMode="zero" sigue quedándose en zero (el fix de S+1 no afecta a future)',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:40}],genericoData:{G:{compraL:10}},prevExpedicionProducto:{A:5}};
  const storedS35={initialBalanceMode:'zero',genericoData:{G:{compraL:0}},prevExpedicionProducto:{A:0}};
  // Mismo patrón que usa setStockWeekInitialBalanceMode para S+2+: excluye SU PROPIA clave (S35, el
  // slot que se está configurando), pero deja intacta la lectura de cualquier otra semana intermedia.
  const getStoredPlan=(y,w)=>(y===2026&&w===35)?storedS35:null;
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan});
  assert.equal(projection.initialBalanceMode,'zero');
  assert.deepEqual(projection.balances,{A:0});
});

test('S+2 con initialBalanceMode="inherit" sigue heredando el saldo real (el fix de S+1 no afecta a future)',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:40}],genericoData:{G:{compraL:10}},prevExpedicionProducto:{A:5}};
  const storedS35={initialBalanceMode:'inherit',genericoData:{G:{compraL:0}},prevExpedicionProducto:{A:0}};
  const getStoredPlan=(y,w)=>(y===2026&&w===35)?storedS35:null;
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan});
  assert.equal(projection.initialBalanceMode,'inherit');
  assert.notDeepEqual(projection.balances,{A:0});
});

// TESTS A-H (reconcileMissingInheritedProducts): reproducen exactamente el caso real confirmado en
// sesión — S+1 con su propio Recap (composición distinta a la semana actual) al que le falta una
// referencia que la semana actual termina con saldo != 0.
const anchorRowsReconcile=[
  {producto:'C-LUX_HORTENSIA_SWEET_3',generico:'C-LUX_HORTENSIA_SWEET',categoria:'COMPUESTOS',saldo:5,codeBase:'999'},
  {producto:'A-Rosas-Colores-60_4',generico:'A-Rosas-Colores',categoria:'ROSAS',saldo:0,codeBase:'17127'},
  {producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}
];
const endingBalancesReconcile={
  'C-LUX_HORTENSIA_SWEET_3':-2, // saldo final != 0 (negativo): debe incorporarse con -2
  'A-Rosas-Colores-60_4':0,     // saldo final == 0: NO debe incorporarse
  'YA-EN-S1':999                // ya existe en S+1: nunca se toca ni se duplica aquí
};
function isActiveSiempre(){ return true; }
function isActivoSoloHortensia(anchorRow){ return anchorRow.generico==='C-LUX_HORTENSIA_SWEET'; }

test('A: producto con saldo final negativo (!=0), activo y ausente en S+1 -> se incorpora con ese saldo exacto',()=>{
  const s1Plan={data:[{producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}]};
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,endingBalancesReconcile,anchorRowsReconcile,isActiveSiempre);
  const added=result.plan.data.find(r=>r.producto==='C-LUX_HORTENSIA_SWEET_3');
  assert.ok(added,'debe añadirse la fila que faltaba');
  assert.equal(added.saldo,-2);
  assert.equal(added.generico,'C-LUX_HORTENSIA_SWEET');
  assert.deepEqual(result.added,['C-LUX_HORTENSIA_SWEET_3']);
});

test('B: producto con saldo final positivo (!=0), activo y ausente en S+1 -> se incorpora',()=>{
  const s1Plan={data:[]};
  const anchorRows=[{producto:'X',generico:'GX',categoria:'ROSAS',saldo:0}];
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,{X:4},anchorRows,isActiveSiempre);
  const added=result.plan.data.find(r=>r.producto==='X');
  assert.ok(added);
  assert.equal(added.saldo,4);
  assert.deepEqual(result.added,['X']);
});

test('C: producto con saldo final proyectado == 0 -> NO se incorpora aunque falte en S+1',()=>{
  const s1Plan={data:[{producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}]};
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,endingBalancesReconcile,anchorRowsReconcile,isActiveSiempre);
  assert.equal(result.plan.data.find(r=>r.producto==='A-Rosas-Colores-60_4'),undefined);
  assert.ok(!result.added.includes('A-Rosas-Colores-60_4'));
  assert.ok(!result.omitted.some(o=>o.producto==='A-Rosas-Colores-60_4')); // no es "omitida por inactiva": simplemente no aplica la regla
});

test('D: genérico inactivo en Nomenclaturas -> NO se incorpora, se reporta en omitted (nunca se reactiva sola)',()=>{
  const s1Plan={data:[]};
  const anchorRows=[{producto:'C-ZODIAC-CANCER_1',generico:'C-ZODIAC-CANCER',categoria:'COMPUESTOS',saldo:0}];
  function isActiveInactivo(){ return false; } // simula active:false en Nomenclaturas
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,{'C-ZODIAC-CANCER_1':3},anchorRows,isActiveInactivo);
  assert.equal(result.plan.data.length,0);
  assert.deepEqual(result.added,[]);
  assert.deepEqual(result.omitted,[{producto:'C-ZODIAC-CANCER_1',generico:'C-ZODIAC-CANCER',saldo:3}]);
});

test('E: genérico no encontrado en Nomenclaturas (no confirmable) -> NO se incorpora, se reporta en omitted',()=>{
  const s1Plan={data:[]};
  const anchorRows=[{producto:'S-Premium-12-18-24-30-roja_3',generico:'S-Premium-12-18-24-30-roja',categoria:'SIMPLES',saldo:0}];
  function isActiveNoEncontrado(){ return false; } // simula "no encontrada en Nomenclaturas"
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,{'S-Premium-12-18-24-30-roja_3':7},anchorRows,isActiveNoEncontrado);
  assert.equal(result.plan.data.length,0);
  assert.deepEqual(result.omitted,[{producto:'S-Premium-12-18-24-30-roja_3',generico:'S-Premium-12-18-24-30-roja',saldo:7}]);
});

test('F: un producto que ya existe en S+1 nunca se duplica, aunque su saldo final en el ancla sea != 0',()=>{
  const s1Plan={data:[{producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}]};
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,endingBalancesReconcile,anchorRowsReconcile,isActiveSiempre);
  assert.equal(result.plan.data.filter(r=>r.producto==='YA-EN-S1').length,1);
  assert.equal(result.plan.data.find(r=>r.producto==='YA-EN-S1').saldo,1); // su saldo NO se toca aquí (eso es refreshInheritedBalance)
  assert.ok(!result.added.includes('YA-EN-S1'));
});

test('G: compras, PREV, genericoData, forecastAdjustments y simplesPrea de S+1 permanecen idénticos tras reconciliar',()=>{
  const s1Plan={
    data:[{producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}],
    genericoData:{'G-YA':{compraL:9,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{'YA-EN-S1':2},
    forecastAdjustments:{'G-YA':{percent:'10'}},
    simplesPrea:{'G-YA':5}
  };
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,endingBalancesReconcile,anchorRowsReconcile,isActiveSiempre);
  assert.deepEqual(result.plan.genericoData,s1Plan.genericoData);
  assert.deepEqual(result.plan.prevExpedicionProducto,s1Plan.prevExpedicionProducto);
  assert.deepEqual(result.plan.forecastAdjustments,s1Plan.forecastAdjustments);
  assert.deepEqual(result.plan.simplesPrea,s1Plan.simplesPrea);
  // encadenado con refreshInheritedBalance (como hace openStockPlanningWeek): sigue intacto
  const refreshed=StockPlanning.refreshInheritedBalance(result.plan,endingBalancesReconcile);
  assert.deepEqual(refreshed.genericoData,s1Plan.genericoData);
  assert.deepEqual(refreshed.prevExpedicionProducto,s1Plan.prevExpedicionProducto);
});

test('la comprobación de activo puede admitir/rechazar por genérico distintos de cada fila, no solo un flag global',()=>{
  const s1Plan={data:[]};
  const anchorRows=[
    {producto:'C-LUX_HORTENSIA_SWEET_3',generico:'C-LUX_HORTENSIA_SWEET',categoria:'COMPUESTOS',saldo:0},
    {producto:'C-ZODIAC-CANCER_1',generico:'C-ZODIAC-CANCER',categoria:'COMPUESTOS',saldo:0}
  ];
  const balances={'C-LUX_HORTENSIA_SWEET_3':-2,'C-ZODIAC-CANCER_1':3};
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,balances,anchorRows,isActivoSoloHortensia);
  assert.deepEqual(result.added,['C-LUX_HORTENSIA_SWEET_3']);
  assert.deepEqual(result.omitted,[{producto:'C-ZODIAC-CANCER_1',generico:'C-ZODIAC-CANCER',saldo:3}]);
});

// TESTS A-H (bug real confirmado en sesión con datos de Supabase): reconcileMissingInheritedProducts
// añadía de vuelta una talla antigua de una familia (categoria+codeBase) que la semana destino YA
// representaba con otra composición de tallas (p.ej. S34 con 2 tallas reales de Alstro-parme recibía de
// vuelta una 3ª talla de S33 solo porque su `producto` no coincidía letra a letra). Ahora, si la familia
// entera ya está representada en destino, esa variante suelta no se reintroduce.
test('A: familia completamente ausente en destino + saldo != 0 + activa -> se añade (comportamiento sin cambios)',()=>{
  const destino={data:[]};
  const anchorRows=[{producto:'X-1',generico:'GX',categoria:'SIMPLES',codeBase:'999',saldo:0}];
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'X-1':7},anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,['X-1']);
  assert.equal(result.plan.data.find(r=>r.producto==='X-1').saldo,7);
});

test('B: producto exacto ya existente en destino -> nunca se duplica, con prioridad sobre cualquier chequeo de familia',()=>{
  const destino={data:[{producto:'X-1',generico:'GX',categoria:'SIMPLES',codeBase:'999',saldo:3}]};
  const anchorRows=[{producto:'X-1',generico:'GX',categoria:'SIMPLES',codeBase:'999',saldo:0}];
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'X-1':7},anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,[]);
  assert.equal(result.plan.data.filter(r=>r.producto==='X-1').length,1);
  assert.equal(result.plan.data.find(r=>r.producto==='X-1').saldo,3); // su saldo NO se toca aquí (eso es refreshInheritedBalance)
});

test('C: producto distinto pero misma categoria+codeBase YA representada en destino -> NO se añade',()=>{
  const destino={data:[{producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}]};
  const anchorRows=[{producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}];
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'S-Alstro-parme-15-1':4},anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,[]);
  assert.equal(result.plan.data.length,1);
  assert.ok(!result.plan.data.some(r=>r.producto==='S-Alstro-parme-15-1'));
});

test('D: varias variantes candidatas de una familia YA representada en destino -> no se añade ninguna',()=>{
  const destino={data:[{producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}]};
  const anchorRows=[
    {producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}
  ];
  const balances={'S-Alstro-parme-15-1':4,'S-Alstro-parme-25-3':1};
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,balances,anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,[]);
  assert.equal(result.plan.data.length,1);
});

test('E: familia completamente ausente con varias variantes activas y saldo != 0 -> se incorporan todas (no se bloquean entre sí)',()=>{
  const destino={data:[]};
  const anchorRows=[
    {producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0},
    {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}
  ];
  const balances={'S-Alstro-parme-15-1':-1,'S-Alstro-parme-20-2':0,'S-Alstro-parme-25-3':-1};
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,balances,anchorRows,isActiveSiempre);
  // -20-2 tiene saldo final 0: nunca se incorpora (regla ya existente, independiente de la familia)
  assert.deepEqual(result.added,['S-Alstro-parme-15-1','S-Alstro-parme-25-3']);
  assert.equal(result.plan.data.length,2);
});

test('F: sin codeBase en alguno de los dos lados -> comportamiento actual por producto exacto, nunca se agrupa por nombre',()=>{
  const destino={data:[{producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',saldo:0}]}; // sin codeBase
  const anchorRows=[{producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',saldo:0}]; // sin codeBase
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'S-Alstro-parme-15-1':4},anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,['S-Alstro-parme-15-1']); // sin codeBase no hay familia que comprobar: se añade igual que siempre
});

test('G: caso real Hortensia S+1 (activa, saldo final -2, familia completamente ausente) sigue incorporándose igual que antes',()=>{
  const s1Plan={data:[{producto:'YA-EN-S1',generico:'G-YA',categoria:'ROSAS',saldo:1}]};
  const result=StockPlanning.reconcileMissingInheritedProducts(s1Plan,endingBalancesReconcile,anchorRowsReconcile,isActiveSiempre);
  const added=result.plan.data.find(r=>r.producto==='C-LUX_HORTENSIA_SWEET_3');
  assert.ok(added,'Hortensia debe seguir incorporándose: no comparte codeBase con nada ya presente en destino');
  assert.equal(added.saldo,-2);
  assert.deepEqual(result.added,['C-LUX_HORTENSIA_SWEET_3']);
});

test('H: caso real Alstro intermedio (S33 con 3 variantes, S34 con 2 de la misma familia) -> la tercera NO reaparece',()=>{
  const destino={ // composición real de S34: solo 2 de las 3 tallas de Alstro-parme
    data:[
      {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:0},
      {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:0}
    ]
  };
  const anchorRowsS33=[ // composición real de S33 (ancla): las 3 tallas
    {producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:5},
    {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:2},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:1}
  ];
  const endingBalancesS33={'S-Alstro-parme-15-1':4,'S-Alstro-parme-20-2':2,'S-Alstro-parme-25-3':1};
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,endingBalancesS33,anchorRowsS33,isActiveSiempre);
  assert.deepEqual(result.added,[]);
  assert.equal(result.plan.data.length,2);
  assert.ok(!result.plan.data.some(r=>r.producto==='S-Alstro-parme-15-1'));
});

test('regresión Virgo: borrador futuro sin Recap completa las variantes heredadas de una familia ya presente',()=>{
  const destino={
    recapLoaded:false,
    data:[
      {producto:'A-ROSAS',generico:'A-ROSAS',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:1},
      // Producto obsoleto de un borrador antiguo: ya no existe en S35 y no tiene planificación propia.
      {producto:'C-ASTRO-LEO_1',generico:'C-ASTRO-LEO',categoria:'COMPUESTOS',codeBase:'4',variantCode:'1',saldo:-5},
      {producto:'P-BONSAI',generico:'P-BONSAI',categoria:'PLANTAS',codeBase:'2',variantCode:'1',saldo:1},
      {producto:'S-ALSTRO',generico:'S-ALSTRO',categoria:'SIMPLES',codeBase:'3',variantCode:'1',saldo:1},
      // Reproduce el estado real guardado: Virgo estaba al final y generaba un segundo bloque COMPUESTOS.
      {producto:'C-ZODIAC-VIRGO_1',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'1',saldo:6}
    ]
  };
  const anchorRows=[
    {producto:'A-ROSAS',generico:'A-ROSAS',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:1},
    {producto:'C-ZODIAC-VIRGO_1',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'1',saldo:6},
    {producto:'C-ZODIAC-VIRGO_2',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'2',saldo:16},
    {producto:'C-ZODIAC-VIRGO_3',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'3',saldo:2},
    {producto:'P-BONSAI',generico:'P-BONSAI',categoria:'PLANTAS',codeBase:'2',variantCode:'1',saldo:1},
    {producto:'S-ALSTRO',generico:'S-ALSTRO',categoria:'SIMPLES',codeBase:'3',variantCode:'1',saldo:1}
  ];
  const balances={'C-ZODIAC-VIRGO_1':6,'C-ZODIAC-VIRGO_2':16,'C-ZODIAC-VIRGO_3':2};

  const reconciled=StockPlanning.reconcileMissingInheritedProducts(destino,balances,anchorRows,isActiveSiempre);
  const refreshed=StockPlanning.refreshInheritedBalance(reconciled.plan,balances);
  const byVariant=StockPlanning.refreshInheritedBalanceByVariant(refreshed,anchorRows,balances);
  const result=StockPlanning.refreshInheritedBalanceByFamily(byVariant.plan,anchorRows,balances);
  const virgoRows=result.data.filter(row=>row.generico==='C-ZODIAC-VIRGO');

  assert.deepEqual(reconciled.added,['C-ZODIAC-VIRGO_2','C-ZODIAC-VIRGO_3']);
  assert.equal(virgoRows.length,3);
  assert.equal(virgoRows.reduce((sum,row)=>sum+row.saldo,0),24);
  assert.deepEqual(result.data.map(row=>row.producto),[
    'A-ROSAS',
    'C-ZODIAC-VIRGO_1','C-ZODIAC-VIRGO_2','C-ZODIAC-VIRGO_3',
    'P-BONSAI','S-ALSTRO'
  ]);
  assert.ok(!result.data.some(row=>row.generico==='C-ASTRO-LEO'));
});

test('borrador futuro conserva una referencia ausente del ancla si fue añadida manualmente',()=>{
  const destino={
    recapLoaded:false,
    data:[{producto:'C-MANUAL_1',generico:'C-MANUAL',categoria:'COMPUESTOS',codeBase:'999',variantCode:'1',saldo:0,addedManually:true}]
  };
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{},[],isActiveSiempre);
  assert.deepEqual(result.plan.data.map(row=>row.producto),['C-MANUAL_1']);
});

test('borrador futuro incorpora un ramo nuevo activo aunque llegue con saldo proyectado 0',()=>{
  const destino={recapLoaded:false,data:[]};
  const anchorRows=[
    {producto:'C-NUEVO_1',generico:'C-NUEVO',categoria:'COMPUESTOS',codeBase:'777',variantCode:'1',saldo:0}
  ];
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'C-NUEVO_1':0},anchorRows,isActiveSiempre);
  assert.deepEqual(result.added,['C-NUEVO_1']);
  assert.equal(result.plan.data[0].saldo,0);
});

test('borrador futuro conserva un ramo ausente del ancla cuando tiene planificación propia',()=>{
  const destino={
    recapLoaded:false,
    data:[{producto:'C-PLANIFICADO_1',generico:'C-PLANIFICADO',categoria:'COMPUESTOS',codeBase:'778',variantCode:'1',saldo:0}],
    genericoData:{'C-PLANIFICADO':{compraL:5,compraM:0,compraX:0,compraJ:0,compraV:0}}
  };
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{},[],isActiveSiempre);
  assert.deepEqual(result.plan.data.map(row=>row.producto),['C-PLANIFICADO_1']);
});

test('familia parcial con Recap propio conserva su composición y no reintroduce variantes ausentes',()=>{
  const destino={
    recapLoaded:true,
    data:[
      {producto:'C-ZODIAC-VIRGO_1',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'1',saldo:6}
    ]
  };
  const anchorRows=[
    {producto:'C-ZODIAC-VIRGO_1',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'1',saldo:6},
    {producto:'C-ZODIAC-VIRGO_2',generico:'C-ZODIAC-VIRGO',categoria:'COMPUESTOS',codeBase:'54804',variantCode:'2',saldo:16}
  ];
  const result=StockPlanning.reconcileMissingInheritedProducts(destino,{'C-ZODIAC-VIRGO_1':6,'C-ZODIAC-VIRGO_2':16},anchorRows,isActiveSiempre);

  assert.deepEqual(result.added,[]);
  assert.deepEqual(result.plan.data.map(row=>row.producto),['C-ZODIAC-VIRGO_1']);
});

// TEST C/E (S+2 real, cadena de dos saltos): mismo bug y mismo fix que S+1, pero con una semana
// intermedia REAL de por medio (S33), que respeta su propio modo/compras/PREV — projectOpeningBalance
// no se toca, solo se encadena reconcile+refresh sobre su resultado, igual que hace ahora
// setStockWeekInitialBalanceMode/openStockPlanningWeek para 'future' en modo inherit.
test('S+2 (dos saltos, intermedia S33 real en inherit): reconcilia lo que falta del ancla y preserva lo propio de S+2',()=>{
  const anchorPlan={
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:30},{producto:'T2',generico:'G',categoria:'ROSAS',saldo:10}],
    genericoData:{G:{compraL:20,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:5,T2:5}
  };
  const storedS33={initialBalanceMode:'inherit',genericoData:{G:{compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0,T2:0}};
  const getStoredPlan=(y,w)=>(y===2026&&w===33)?storedS33:null; // S34 (destino) se excluye desde el caller, como ya hacemos
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:34,getStoredPlan});
  assert.equal(projection.initialBalanceMode,'inherit');
  assert.notDeepEqual(projection.balances,{T1:0,T2:0});

  // S+2 (S34) tiene su propio Recap: no trae T1 (que el ancla proyecta con saldo != 0), pero sí trae un
  // producto propio "PROPIO-S34" con saldo 12 que no tiene relación con el ancla.
  const s34Plan={
    data:[{producto:'T2',generico:'G',categoria:'ROSAS',saldo:0},{producto:'PROPIO-S34',generico:'G-PROPIO',categoria:'SIMPLES',saldo:12}],
    genericoData:{'G-PROPIO':{compraL:1,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{'PROPIO-S34':3}
  };
  const reconciled=StockPlanning.reconcileMissingInheritedProducts(s34Plan,projection.balances,anchorPlan.data,()=>true);
  assert.ok(reconciled.plan.data.some(r=>r.producto==='T1'),'T1 debe reconciliarse: falta en S34 y su saldo final proyectado es != 0');
  assert.equal(reconciled.plan.data.find(r=>r.producto==='T1').saldo,projection.balances.T1);

  const refreshed=StockPlanning.refreshInheritedBalance(reconciled.plan,projection.balances);
  assert.equal(refreshed.data.find(r=>r.producto==='T1').saldo,projection.balances.T1);
  assert.equal(refreshed.data.find(r=>r.producto==='T2').saldo,projection.balances.T2); // ya existía, se refresca
  assert.equal(refreshed.data.find(r=>r.producto==='PROPIO-S34').saldo,12); // propio de S34: NUNCA se toca (no está en la proyección)
  assert.deepEqual(refreshed.genericoData,s34Plan.genericoData); // compras propias de S34 intactas
  assert.deepEqual(refreshed.prevExpedicionProducto,s34Plan.prevExpedicionProducto); // PREV propia de S34 intacta
});

test('S+3 con una intermedia real en modo "zero": la cadena se rompe ahí, igual que antes de este fix (projectOpeningBalance no se toca)',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',saldo:40}],genericoData:{G:{compraL:10}},prevExpedicionProducto:{A:5}};
  const storedS34={initialBalanceMode:'zero',genericoData:{G:{compraL:0}},prevExpedicionProducto:{A:0}};
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalance({anchorPlan,anchorYear:2026,anchorWeek:32,targetYear:2026,targetWeek:35,getStoredPlan});
  // S32 termina en 45; S34 (intermedia, zero) resetea la apertura a 0 antes de aplicar su propio movimiento (0);
  // S35 (destino, sin stored propio) hereda esa cadena ya rota: 0, no 45.
  assert.deepEqual(projection.balances,{A:0});
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

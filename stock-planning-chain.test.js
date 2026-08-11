// Tests para projectOpeningBalanceChain: el saldo inicial de una semana en "inherit" debe corresponder
// al estado ACTUAL de toda la cadena anterior, usando en cada salto la composición REAL de esa semana
// (no siempre la del ancla S33), sin depender de que el usuario haya abierto previamente las
// intermedias, y sin escribir nunca en ningún snapshot (todo en memoria).
const test=require('node:test');
const assert=require('node:assert/strict');
const StockPlanning=require('./stock-planning.js');

function isActiveSiempre(){ return true; }

// TEST A (caso real confirmado en sesión): Ethiopia (+8) y Alstro-parme (-2) nacen en S34 (no existían
// en S33) y deben llegar exactos a la apertura de S35.
test('A: un producto que nace en la intermedia (no existía en el ancla) llega con su saldo final real al destino',()=>{
  const anchorPlan={ // S33
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:30}],
    genericoData:{G:{compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0}
  };
  const storedS34={ // intermedia real, inherit, con su PROPIA composición (Ethiopia y Alstro no están en S33)
    initialBalanceMode:'inherit',
    data:[
      {producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},
      {producto:'A-Rosas-Ethiopia',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',saldo:0},
      {producto:'S-Alstro-parme',generico:'S-Alstro-parme',categoria:'SIMPLES',saldo:0}
    ],
    genericoData:{
      G:{compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0},
      'A-Rosas-Ethiopia':{compraL:8,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0},
      'S-Alstro-parme':{compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}
    },
    prevExpedicionProducto:{T1:0,'A-Rosas-Ethiopia':0,'S-Alstro-parme':2}
  };
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.initialBalanceMode,'inherit');
  assert.equal(projection.balances['A-Rosas-Ethiopia'],8);
  assert.equal(projection.balances['S-Alstro-parme'],-2);
  assert.equal(projection.balances.T1,30);
  assert.ok(projection.rows.some(r=>r.producto==='A-Rosas-Ethiopia'),'la composición evolucionada debe incluir Ethiopia para que el destino pueda reconciliarla');
  assert.ok(projection.rows.some(r=>r.producto==='S-Alstro-parme'));

  // S35 (destino) no trae Ethiopia ni Alstro en su propio Recap: deben reconciliarse con reconcileMissingInheritedProducts + refreshInheritedBalance, usando projection.rows (no anchorPlan.data).
  const s35Plan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}]};
  const reconciled=StockPlanning.reconcileMissingInheritedProducts(s35Plan,projection.balances,projection.rows,isActiveSiempre);
  const refreshed=StockPlanning.refreshInheritedBalance(reconciled.plan,projection.balances);
  assert.equal(refreshed.data.find(r=>r.producto==='A-Rosas-Ethiopia').saldo,8);
  assert.equal(refreshed.data.find(r=>r.producto==='S-Alstro-parme').saldo,-2);
  assert.equal(refreshed.data.find(r=>r.producto==='T1').saldo,30);
});

// TEST B: un producto propio de una intermedia se incorpora al universo de la cadena y sigue
// propagándose incluso a través de un HUECO (semana sin snapshot) hacia un tercer salto.
test('B: un producto propio de una intermedia entra en el universo de la cadena y se propaga a través de un hueco sin snapshot',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:10}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={
    initialBalanceMode:'inherit',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'PROPIO-S34',generico:'G-PROPIO',categoria:'SIMPLES',saldo:0}],
    genericoData:{G:{compraL:0,pendientePreasignar:0},'G-PROPIO':{compraL:5,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0,'PROPIO-S34':0}
  };
  // S35 no tiene snapshot (hueco): sin previsión automática, la cadena no mueve nada, solo propaga.
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:36,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances['PROPIO-S34'],5); // nace en S34 (compraL:5), se propaga sin cambios a través del hueco S35 hasta S36
  assert.ok(projection.rows.some(r=>r.producto==='PROPIO-S34'));
});

// TEST C: un producto que existía en una intermedia anterior (activo, saldo != 0) pero que el Recap de
// la SIGUIENTE intermedia real ya no trae, se conserva (se reconcilia dentro de esa misma intermedia,
// no solo al llegar al destino final).
test('C: producto activo con saldo != 0 desaparecido del Recap de la siguiente intermedia se conserva y sigue propagándose',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:10}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={ // introduce ETHIOPIA con saldo final +8
    initialBalanceMode:'inherit',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'A-Rosas-Ethiopia',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:0,pendientePreasignar:0},'A-Rosas-Ethiopia':{compraL:8,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0,'A-Rosas-Ethiopia':0}
  };
  const storedS35={ // S35 es una intermedia REAL (destino final es S36) cuyo Recap ya NO trae Ethiopia
    initialBalanceMode:'inherit',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0}
  };
  const getStoredPlan=(y,w)=>{ if(y!==2026) return null; if(w===34) return storedS34; if(w===35) return storedS35; return null; };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:36,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances['A-Rosas-Ethiopia'],8,'Ethiopia debe sobrevivir a S35 aunque su Recap no la traiga, porque sigue activa y con saldo != 0');
  assert.ok(projection.rows.some(r=>r.producto==='A-Rosas-Ethiopia'));
});

// TEST D: producto inactivo/no confirmable en Nomenclaturas nunca se incorpora, ni en una intermedia ni
// en el destino, y queda reportado en `omitted`.
test('D: producto inactivo/no confirmable en Nomenclaturas nunca se incorpora en ningún salto, y queda en omitted',()=>{
  // C-ZODIAC-CANCER_1 existe en el ancla (S33) con saldo final proyectado != 0 (compraL:3), pero el
  // Recap propio de S34 ya no lo trae. Al ser inactivo, NUNCA debe reconciliarse de vuelta en S34 (ni,
  // por tanto, propagarse a S35): debe quedar fuera de la apertura del destino y reportado en omitted.
  const anchorPlan={
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:10},{producto:'C-ZODIAC-CANCER_1',generico:'C-ZODIAC-CANCER',categoria:'COMPUESTOS',saldo:0}],
    genericoData:{G:{compraL:0,pendientePreasignar:0},'C-ZODIAC-CANCER':{compraL:3,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0,'C-ZODIAC-CANCER_1':0}
  };
  const storedS34={ // su propio Recap ya no trae C-ZODIAC-CANCER_1
    initialBalanceMode:'inherit',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}],
    genericoData:{G:{compraL:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:0}
  };
  function isActiveExceptoZodiac(row){ return row.generico!=='C-ZODIAC-CANCER'; }
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan,isActiveProduct:isActiveExceptoZodiac
  });
  assert.equal(projection.balances['C-ZODIAC-CANCER_1'],undefined,'nunca debe aparecer en la apertura del destino: inactivo, no se reconcilia');
  assert.ok(!projection.rows.some(r=>r.producto==='C-ZODIAC-CANCER_1'),'tampoco debe formar parte de la composición evolucionada');
  assert.ok(projection.omitted.some(o=>o.producto==='C-ZODIAC-CANCER_1'&&o.saldo===3));
});

// TEST E: una intermedia en "zero" corta el saldo inicial (0), pero sus propias compras/PREV sí generan
// un saldo final que se hereda a la siguiente semana si esta está en inherit.
test('E: intermedia en "zero" corta el saldo inicial pero su saldo final (compras/PREV propios) sí se hereda',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:100}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={
    initialBalanceMode:'zero',
    data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:999}], // el saldo guardado no importa: se fuerza a 0 igualmente
    genericoData:{G:{compraL:15,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{T1:4}
  };
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  // S34: apertura forzada a 0 (nunca 999 ni 100 heredado de S33) + compras 15 - PREV 4 = 11
  assert.equal(projection.balances.T1,11);
});

// TEST F: varias intermedias "inherit" en cascada se recalculan SIN haberlas abierto previamente (no
// depende de ningún estado guardado más allá de lo que ya hay en weekSnapshots).
test('F: varias intermedias inherit en cascada (S34 y S35 reales) se recalculan en cadena sin haberlas abierto antes',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:10}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={initialBalanceMode:'inherit',data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}],genericoData:{G:{compraL:5,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS35={initialBalanceMode:'inherit',data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}],genericoData:{G:{compraL:3,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:2}};
  const getStoredPlan=(y,w)=>{ if(y!==2026) return null; if(w===34) return storedS34; if(w===35) return storedS35; return null; };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:36,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  // S33 ending=10 -> S34 (inherit) opening=10, +5 compras = 15 -> S35 (inherit) opening=15, +3-2=16 -> S36 hereda 16
  assert.equal(projection.balances.T1,16);
});

// TEST G: inmutabilidad — la función no modifica ninguno de los snapshots de entrada (ni el ancla, ni
// los que devuelve getStoredPlan).
test('G: projectOpeningBalanceChain no modifica los snapshots de entrada (ancla ni intermedias)',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:10}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={initialBalanceMode:'inherit',data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'X',generico:'GX',categoria:'SIMPLES',saldo:0}],genericoData:{G:{compraL:0,pendientePreasignar:0},GX:{compraL:9,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0,X:0}};
  const anchorBefore=JSON.stringify(anchorPlan);
  const s34Before=JSON.stringify(storedS34);
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  StockPlanning.projectOpeningBalanceChain({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan,isActiveProduct:isActiveSiempre});
  assert.equal(JSON.stringify(anchorPlan),anchorBefore);
  assert.equal(JSON.stringify(storedS34),s34Before);
});

// TEST H (persistencia): la función nunca escribe en ningún "almacén" de snapshots — el accesor de
// lectura es la única interacción, igual que ya garantiza projectOpeningBalance().
test('projectOpeningBalanceChain nunca crea ni modifica snapshots: el accesor de lectura es la única interacción',()=>{
  const anchorPlan={data:[{producto:'A',generico:'G',categoria:'ROSAS',saldo:10}],genericoData:{},prevExpedicionProducto:{}};
  const storedPlans={'2026-34':{initialBalanceMode:'inherit',data:[{producto:'A',generico:'G',categoria:'ROSAS',saldo:0}],genericoData:{},prevExpedicionProducto:{}}};
  const beforeKeys=JSON.stringify(Object.keys(storedPlans));
  StockPlanning.projectOpeningBalanceChain({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:37,getStoredPlan:(y,w)=>storedPlans[`${y}-${w}`]||null,isActiveProduct:isActiveSiempre});
  assert.equal(JSON.stringify(Object.keys(storedPlans)),beforeKeys);
});

// TEST I: sin isActiveProduct (omitido), por defecto reconcilia igual que si todo fuera confirmable —
// comportamiento explícito y documentado, no un fallo silencioso.
test('sin callback isActiveProduct, reconcileMissingInheritedProducts (y por tanto la cadena) trata todo como confirmable',()=>{
  const anchorPlan={data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0}],genericoData:{G:{compraL:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0}};
  const storedS34={initialBalanceMode:'inherit',data:[{producto:'T1',generico:'G',categoria:'ROSAS',saldo:0},{producto:'Y',generico:'GY',categoria:'SIMPLES',saldo:0}],genericoData:{G:{compraL:0,pendientePreasignar:0},GY:{compraL:6,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},prevExpedicionProducto:{T1:0,Y:0}};
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null;
  const projection=StockPlanning.projectOpeningBalanceChain({anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan});
  assert.equal(projection.balances.Y,6);
  assert.deepEqual(projection.omitted,[]);
});

// TEST J (caso real Alstro-parme confirmado en sesión con datos de Supabase): S33 (ancla) tiene las 3
// tallas de la familia SIMPLES|25148; S34 (intermedia real, inherit) solo tiene 2 (su propio Recap dejó
// fuera la talla "-15-1"). Antes del fix de familia, la reconciliación INTERNA del salto S33->S34
// reintroducía esa 3ª talla dentro de projectOpeningBalanceChain (porque no coincidía por producto
// exacto contra las 2 reales de S34), corrompiendo también el reparto de compras/PREV entre las 2
// tallas legítimas. Ahora S34 debe seguir teniendo exactamente sus 2 tallas reales en toda la cadena.
test('J: projectOpeningBalanceChain ya no transforma una intermedia real de 2 filas de una familia en 3 (caso real Alstro-parme)',()=>{
  const anchorPlan={ // S33: las 3 tallas reales de Alstro-parme
    data:[
      {producto:'S-Alstro-parme-15-1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:5},
      {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:3},
      {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:2}
    ],
    genericoData:{'S-Alstro-parme':{compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{'S-Alstro-parme-15-1':1,'S-Alstro-parme-20-2':1,'S-Alstro-parme-25-3':1}
  };
  const storedS34={ // S34: intermedia real, su propio Recap solo trae 2 de las 3 tallas
    initialBalanceMode:'inherit',
    data:[
      {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:0},
      {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',saldo:0}
    ],
    genericoData:{'S-Alstro-parme':{compraL:6,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{'S-Alstro-parme-20-2':0,'S-Alstro-parme-25-3':0}
  };
  const getStoredPlan=(y,w)=>(y===2026&&w===34)?storedS34:null; // S35 (destino) sin snapshot propio: un hueco después de S34
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,getStoredPlan,isActiveProduct:isActiveSiempre
  });
  const filasAlstro=projection.rows.filter(r=>r.codeBase==='25148');
  assert.equal(filasAlstro.length,2,'S34 debe seguir teniendo exactamente sus 2 tallas reales, nunca 3');
  assert.ok(!filasAlstro.some(r=>r.producto==='S-Alstro-parme-15-1'));
  assert.equal(projection.balances['S-Alstro-parme-15-1'],undefined,'la talla que S34 nunca tuvo no debe aparecer en la apertura del destino');
  const clavesAlstroEnBalances=Object.keys(projection.balances).filter(k=>/alstro/i.test(k));
  assert.equal(clavesAlstroEnBalances.length,2);
});

test('K: una intermedia inherit renombrada hereda por variantCode el saldo real anterior, no su saldo guardado',()=>{
  const anchorPlan={
    data:[{producto:'OLD',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:5}],
    genericoData:{G:{}},prevExpedicionProducto:{OLD:0}
  };
  const storedS34={
    initialBalanceMode:'inherit',
    data:[{producto:'NEW',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:100}],
    genericoData:{G:{}},prevExpedicionProducto:{NEW:0}
  };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,
    getStoredPlan:(y,w)=>(y===2026&&w===34)?storedS34:null,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances.NEW,5);
  assert.equal(projection.balances.OLD,undefined);
  assert.deepEqual(projection.rows.map(row=>row.producto),['NEW']);
});

test('L: una intermedia legacy sin variantCode conserva el total heredado mediante fallback de familia',()=>{
  const anchorPlan={
    data:[{producto:'OLD',generico:'G',categoria:'ROSAS',codeBase:'1',saldo:5}],
    genericoData:{G:{}},prevExpedicionProducto:{OLD:0}
  };
  const storedS34={
    initialBalanceMode:'inherit',
    data:[{producto:'NEW',generico:'G',categoria:'ROSAS',codeBase:'1',saldo:100}],
    genericoData:{G:{}},prevExpedicionProducto:{NEW:0}
  };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,
    getStoredPlan:(y,w)=>(y===2026&&w===34)?storedS34:null,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances.NEW,5);
  assert.equal(projection.balances.OLD,undefined);
});

test('M: tras heredar por variante, las compras y PREV de la intermedia afectan a su saldo final',()=>{
  const anchorPlan={
    data:[{producto:'OLD',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:5}],
    genericoData:{G:{}},prevExpedicionProducto:{OLD:0}
  };
  const storedS34={
    initialBalanceMode:'inherit',
    data:[{producto:'NEW',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:100}],
    genericoData:{G:{compraL:3,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{NEW:2}
  };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,
    getStoredPlan:(y,w)=>(y===2026&&w===34)?storedS34:null,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances.NEW,6);
});

test('N: una intermedia zero sigue cortando la apertura aunque producto y saldo guardado hayan cambiado',()=>{
  const anchorPlan={
    data:[{producto:'OLD',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:5}],
    genericoData:{G:{}},prevExpedicionProducto:{OLD:0}
  };
  const storedS34={
    initialBalanceMode:'zero',
    data:[{producto:'NEW',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:100}],
    genericoData:{G:{compraL:3,compraM:0,compraX:0,compraJ:0,compraV:0,pendientePreasignar:0}},
    prevExpedicionProducto:{NEW:2}
  };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,
    getStoredPlan:(y,w)=>(y===2026&&w===34)?storedS34:null,isActiveProduct:isActiveSiempre
  });
  assert.equal(projection.balances.NEW,1);
  assert.equal(projection.balances.OLD,undefined);
});

test('O: el emparejamiento intermedio no crea variantes fantasma ni cuenta dos veces los saldos',()=>{
  const anchorPlan={
    data:[
      {producto:'OLD-1',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:2},
      {producto:'OLD-2',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'2',saldo:3},
      {producto:'OLD-3',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'3',saldo:7}
    ],
    genericoData:{G:{}},prevExpedicionProducto:{'OLD-1':0,'OLD-2':0,'OLD-3':0}
  };
  const storedS34={
    initialBalanceMode:'inherit',
    data:[
      {producto:'NEW-1',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'1',saldo:100},
      {producto:'NEW-2',generico:'G',categoria:'ROSAS',codeBase:'1',variantCode:'2',saldo:100}
    ],
    genericoData:{G:{}},prevExpedicionProducto:{'NEW-1':0,'NEW-2':0}
  };
  const projection=StockPlanning.projectOpeningBalanceChain({
    anchorPlan,anchorYear:2026,anchorWeek:33,targetYear:2026,targetWeek:35,
    getStoredPlan:(y,w)=>(y===2026&&w===34)?storedS34:null,isActiveProduct:isActiveSiempre
  });
  assert.deepEqual(projection.rows.map(row=>row.producto),['NEW-1','NEW-2']);
  assert.deepEqual(projection.balances,{'NEW-1':2,'NEW-2':3});
  assert.equal(Object.values(projection.balances).reduce((sum,saldo)=>sum+saldo,0),5);
});

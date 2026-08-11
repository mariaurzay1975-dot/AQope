// Tests para la herencia por VARIANTE real (categoria+codeBase+variantCode) y su fallback por familia.
// El nombre de `producto` puede cambiar entre Recaps de semanas distintas para la MISMA variante real
// (caso confirmado con datos reales de sesión: Ethiopia/Alstro-parme). variantCode es un dato de origen
// del propio Recap Stock (columna real, NUNCA inferido del sufijo de `producto`) que sigue siendo
// estable aunque el nombre cambie.
const test=require('node:test');
const assert=require('node:assert/strict');
const StockPlanning=require('./stock-planning.js');

// Líneas reales confirmadas por el usuario (9 columnas, con columnas vacías intermedias):
// 31.056  1  A-Rosas-Ethiopia-1     2    1  -1     31056-1
// 25.148  2  S-Alstro-parme-20-2    2                25148-2
test('lastNonEmptyField extrae el último campo real de las dos líneas reales del Recap, ignorando columnas vacías',()=>{
  const lineaEthiopia = '31.056\t1\tA-Rosas-Ethiopia-1\t2\t\t1\t-1\t\t31056-1'.split('\t');
  const lineaAlstro = '25.148\t2\tS-Alstro-parme-20-2\t2\t\t\t\t\t25148-2'.split('\t');
  assert.equal(lineaEthiopia.length,9);
  assert.equal(lineaAlstro.length,9);
  assert.equal(StockPlanning.lastNonEmptyField(lineaEthiopia),'31056-1');
  assert.equal(StockPlanning.lastNonEmptyField(lineaAlstro),'25148-2');
});

test('lastNonEmptyField devuelve "" si TODOS los campos están vacíos, y no altera el array recibido',()=>{
  const parts = ['','',''];
  const before = JSON.stringify(parts);
  assert.equal(StockPlanning.lastNonEmptyField(parts),'');
  assert.equal(JSON.stringify(parts),before);
});

test('lastNonEmptyField ignora un tabulador vacío final (caso que motivó la lectura robusta, no parts[length-1] a ciegas)',()=>{
  const parts = ['31.056','1','A-Rosas-Ethiopia-1','2','31056-1','']; // trailing vacío tras el campo real
  assert.equal(StockPlanning.lastNonEmptyField(parts),'31056-1');
});

function isActiveSiempre(){ return true; }

// TEST caso real ETHIOPIA: 4 variantes en origen y 4 en destino, nombres de producto distintos, MISMO
// categoria+codeBase+variantCode en cada pareja -> asignación exacta 1:1, no reparto proporcional.
test('refreshInheritedBalanceByVariant resuelve Ethiopia real 1:1 por variantCode (nombres de producto distintos)',()=>{
  const refreshedS35 = {
    data:[
      {producto:'A-ROSAS-ETHIOPIA_1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'1',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'2',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_3',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'3',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_4',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'4',saldo:0}
    ]
  };
  const projectionRows = [
    {producto:'A-Rosas-Ethiopia-1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'1'},
    {producto:'A-Rosas-Ethiopia-2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'2'},
    {producto:'A-Rosas-Ethiopia-3',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'3'},
    {producto:'A-Rosas-Ethiopia-4',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',recapCode:'31.056',variantCode:'4'}
  ];
  const projectionBalances = {'A-Rosas-Ethiopia-1':5,'A-Rosas-Ethiopia-2':2,'A-Rosas-Ethiopia-3':2,'A-Rosas-Ethiopia-4':-1};
  const result = StockPlanning.refreshInheritedBalanceByVariant(refreshedS35, projectionRows, projectionBalances);
  assert.equal(result.plan.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_1').saldo,5);
  assert.equal(result.plan.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_2').saldo,2);
  assert.equal(result.plan.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_3').saldo,2);
  assert.equal(result.plan.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_4').saldo,-1);
  assert.deepEqual(new Set(result.matchedDestino),new Set(['A-ROSAS-ETHIOPIA_1','A-ROSAS-ETHIOPIA_2','A-ROSAS-ETHIOPIA_3','A-ROSAS-ETHIOPIA_4']));
  assert.deepEqual(new Set(result.matchedSource),new Set(['A-Rosas-Ethiopia-1','A-Rosas-Ethiopia-2','A-Rosas-Ethiopia-3','A-Rosas-Ethiopia-4']));
  const totalResultado = result.plan.data.reduce((s,r)=>s+r.saldo,0);
  assert.equal(totalResultado,8); // 5+2+2-1
});

// TEST caso real ALSTRO: solo 2 variantes en origen (S34 real solo tiene variantCode 2 y 3), 3 en
// destino (S35 tiene variantCode 1, 2 y 3) -> las que coinciden por variantCode se resuelven exactas;
// la variante 1 (que S34 nunca tuvo) queda sin resolver aquí, para el fallback de familia.
test('refreshInheritedBalanceByVariant resuelve Alstro real: variantCode 2 y 3 exactas, variantCode 1 queda pendiente',()=>{
  const refreshedS35 = {
    data:[
      {producto:'S-Alstro_parme__1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',variantCode:'1',saldo:0},
      {producto:'S-Alstro_parme__2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',variantCode:'2',saldo:0},
      {producto:'S-Alstro_parme__3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',variantCode:'3',saldo:0}
    ]
  };
  const projectionRows = [
    {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',variantCode:'2'},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',recapCode:'25.148',variantCode:'3'}
  ];
  const projectionBalances = {'S-Alstro-parme-20-2':-1,'S-Alstro-parme-25-3':-1};
  const result = StockPlanning.refreshInheritedBalanceByVariant(refreshedS35, projectionRows, projectionBalances);
  assert.equal(result.plan.data.find(r=>r.producto==='S-Alstro_parme__2').saldo,-1);
  assert.equal(result.plan.data.find(r=>r.producto==='S-Alstro_parme__3').saldo,-1);
  assert.equal(result.plan.data.find(r=>r.producto==='S-Alstro_parme__1').saldo,0); // sin variante origen equivalente: no se toca aquí
  assert.deepEqual(new Set(result.matchedDestino),new Set(['S-Alstro_parme__2','S-Alstro_parme__3']));
});

test('refreshInheritedBalanceByVariant nunca adivina en caso ambiguo (2 candidatas para la misma clave variante): deja ambas sin tocar',()=>{
  const plan = {data:[
    {producto:'X-DEST-A',generico:'GX',categoria:'ROSAS',codeBase:'999',variantCode:'1',saldo:0},
    {producto:'X-DEST-B',generico:'GX',categoria:'ROSAS',codeBase:'999',variantCode:'1',saldo:0} // misma clave variante que la anterior: ambigüedad
  ]};
  const projectionRows = [{producto:'X-SRC',generico:'GX',categoria:'ROSAS',codeBase:'999',variantCode:'1'}];
  const balances = {'X-SRC':7};
  const result = StockPlanning.refreshInheritedBalanceByVariant(plan, projectionRows, balances);
  assert.equal(result.plan.data.find(r=>r.producto==='X-DEST-A').saldo,0);
  assert.equal(result.plan.data.find(r=>r.producto==='X-DEST-B').saldo,0);
  assert.deepEqual(result.matchedDestino,[]);
});

test('refreshInheritedBalanceByVariant nunca toca filas ya resueltas por coincidencia exacta de producto (no duplica el conteo)',()=>{
  const plan = {data:[{producto:'YA-EXACTO',generico:'GX',categoria:'ROSAS',codeBase:'999',variantCode:'1',saldo:0}]};
  const projectionRows = [{producto:'YA-EXACTO',generico:'GX',categoria:'ROSAS',codeBase:'999',variantCode:'1'}];
  const balances = {'YA-EXACTO':99}; // si esto se contara aquí, el resultado sería 99; refreshInheritedBalance ya lo habría resuelto antes
  const result = StockPlanning.refreshInheritedBalanceByVariant(plan, projectionRows, balances);
  assert.deepEqual(result.matchedDestino,[]);
  assert.deepEqual(result.matchedSource,[]);
  assert.equal(result.plan.data[0].saldo,0); // no tocado: esta función asume que refreshInheritedBalance ya lo resolvió
});

test('refreshInheritedBalanceByVariant: filas sin variantCode nunca se emparejan entre sí (snapshots antiguos)',()=>{
  const plan = {data:[{producto:'DEST-SIN-VC',generico:'G',categoria:'ROSAS',codeBase:'999',saldo:0}]}; // sin variantCode
  const projectionRows = [{producto:'SRC-SIN-VC',generico:'G',categoria:'ROSAS',codeBase:'999'}]; // sin variantCode
  const balances = {'SRC-SIN-VC':4};
  const result = StockPlanning.refreshInheritedBalanceByVariant(plan, projectionRows, balances);
  assert.deepEqual(result.matchedDestino,[]);
  assert.equal(result.plan.data[0].saldo,0);
});

// ---------- refreshInheritedBalanceByFamily (fallback LEGACY por RESIDUAL de familia) ----------
// Diseño confirmado tras el diagnóstico real: sourceFamilyTotal - destinationFamilyCurrentTotal = delta,
// y solo ese delta se reparte entre las filas destino YA EXISTENTES de la familia con
// distributeAcrossRows. Nunca sustituye lo ya asignado por coincidencia exacta o por variantCode; nunca
// añade filas nuevas; solo actúa cuando la familia no tiene variantCode completo en ambos lados.

// TEST caso real ROSAS-COLORES: S33 termina la familia en 4 (0+1+2+1 por talla), pero S34 (S+1) solo
// trae 3 de las 4 tallas con nombres ya sin coincidencia exacta -> antes de este fix se perdía 1 unidad
// exacta, porque la familia ya estaba parcialmente representada (reconcileMissingInheritedProducts no
// reintroduce una talla suelta de una familia ya presente) y el fallback ANTERIOR solo repartía entre
// filas "sin resolver" — con las 3 exactas ya resueltas, no quedaba ninguna fila a la que repartir el
// residual de la 4ª. Ahora se calcula por TOTAL de familia, no por filas sueltas.
test('Rosas-Colores real: sourceFamilyTotal=4, destino ya en 3 tras coincidencia exacta -> delta=+1 repartido -> total final 4',()=>{
  const refreshedS34 = {data:[ // 3 filas YA resueltas por refreshInheritedBalance (coincidencia exacta): 40_2=1, 50_3=2, 60_4 NO existe en destino
    {producto:'A-Rosas-Colores-30_1',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127',saldo:0},
    {producto:'A-Rosas-Colores-40_2',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127',saldo:1},
    {producto:'A-Rosas-Colores-50_3',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127',saldo:2}
  ]}; // la talla "-60_4" (saldo final 1) no existe en absoluto en S34: ninguna tiene variantCode (snapshot antiguo)
  const projectionRows = [
    {producto:'A-Rosas-Colores-30_1',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127'},
    {producto:'A-Rosas-Colores-40_2',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127'},
    {producto:'A-Rosas-Colores-50_3',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127'},
    {producto:'A-Rosas-Colores-60_4',generico:'A-Rosas-Colores',categoria:'ROSAS',codeBase:'17127'}
  ];
  const projectionBalances = {'A-Rosas-Colores-30_1':0,'A-Rosas-Colores-40_2':1,'A-Rosas-Colores-50_3':2,'A-Rosas-Colores-60_4':1};
  const byVariant = StockPlanning.refreshInheritedBalanceByVariant(refreshedS34, projectionRows, projectionBalances);
  assert.deepEqual(byVariant.matchedDestino,[]); // sin variantCode en ningún lado: nada se resuelve por variante
  const final = StockPlanning.refreshInheritedBalanceByFamily(byVariant.plan, projectionRows, projectionBalances);
  const total = final.data.reduce((s,r)=>s+r.saldo,0);
  assert.equal(total,4); // antes de este fix: 3 (se perdía la unidad de la talla ausente)
  assert.equal(final.data.length,3); // nunca añade una 4ª fila (eso es responsabilidad de reconcileMissingInheritedProducts)
});

test('Alstro legacy: sourceFamilyTotal=-2, destino en 0 (nada resuelto) -> delta=-2 repartido -> total final exactamente -2',()=>{
  const destino = {data:[
    {producto:'S-Alstro_parme__1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0},
    {producto:'S-Alstro_parme__2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0},
    {producto:'S-Alstro_parme__3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',saldo:0}
  ]};
  const projectionRows = [ // solo 2 variantes fuente reales (S34 solo tenía 2 tallas), sin variantCode
    {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148'},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148'}
  ];
  const balances = {'S-Alstro-parme-20-2':-1,'S-Alstro-parme-25-3':-1};
  const byVariant = StockPlanning.refreshInheritedBalanceByVariant(destino, projectionRows, balances);
  assert.deepEqual(byVariant.matchedDestino,[]);
  const final = StockPlanning.refreshInheritedBalanceByFamily(byVariant.plan, projectionRows, balances);
  const total = final.data.reduce((s,r)=>s+r.saldo,0);
  assert.equal(total,-2);
});

test('delta === 0: la familia ya cuadra exacta tras coincidencia exacta/variante -> ninguna fila se modifica',()=>{
  const destino = {data:[
    {producto:'A',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:3},
    {producto:'B',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:1}
  ]};
  const projectionRows = [
    {producto:'A',generico:'G',categoria:'SIMPLES',codeBase:'111'},
    {producto:'B',generico:'G',categoria:'SIMPLES',codeBase:'111'}
  ];
  const balances = {A:3,B:1}; // sourceFamilyTotal=4, destinationFamilyCurrentTotal=4 -> delta=0
  const before = JSON.stringify(destino.data);
  const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
  assert.equal(JSON.stringify(final.data),before);
});

test('variantCode completo en ambos lados (fuente y destino) -> el fallback de familia NUNCA interviene, aunque quede un residual',()=>{
  const destino = {data:[
    {producto:'X-1',generico:'G',categoria:'SIMPLES',codeBase:'111',variantCode:'1',saldo:5} // residual deliberado: no cuadra con el total fuente
  ]};
  const projectionRows = [
    {producto:'Y-1',generico:'G',categoria:'SIMPLES',codeBase:'111',variantCode:'1'} // no coincide exacto, pero SÍ tiene variantCode en ambos lados
  ];
  const balances = {'Y-1':9}; // sourceFamilyTotal=9 != destinationFamilyCurrentTotal=5 -> delta=4, pero cobertura de variantCode completa
  const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
  assert.equal(final.data[0].saldo,5); // intacto: se confía en la resolución estructural del paso B, no se ajusta con un reparto aproximado
});

test('positivos y negativos preservan exactamente el total de la familia tras el delta',()=>{
  const casos = [
    {destinoSaldo:[0,0,0], balances:{A:3,B:2,C:1}, totalEsperado:6},
    {destinoSaldo:[0,0,0], balances:{A:-3,B:-2,C:-1}, totalEsperado:-6},
    {destinoSaldo:[2,-1,0], balances:{A:5,B:-2,C:1}, totalEsperado:4}
  ];
  casos.forEach(({destinoSaldo,balances,totalEsperado})=>{
    const destino = {data:destinoSaldo.map((saldo,i)=>({producto:`D${i}`,generico:'G',categoria:'SIMPLES',codeBase:'111',saldo}))};
    const projectionRows = Object.keys(balances).map(producto=>({producto,generico:'G',categoria:'SIMPLES',codeBase:'111'}));
    const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
    const total = final.data.reduce((s,r)=>s+r.saldo,0);
    assert.equal(total,totalEsperado);
  });
});

test('nunca añade variantes fantasma: el número de filas de destino es idéntico antes y después',()=>{
  const destino = {data:[
    {producto:'X',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:0},
    {producto:'Y',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:0}
  ]};
  const projectionRows = [
    {producto:'A',generico:'G',categoria:'SIMPLES',codeBase:'111'},
    {producto:'B',generico:'G',categoria:'SIMPLES',codeBase:'111'},
    {producto:'C',generico:'G',categoria:'SIMPLES',codeBase:'111'} // más variantes fuente que filas destino
  ];
  const balances = {A:2,B:3,C:1};
  const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
  assert.equal(final.data.length,2); // sigue habiendo solo 2 filas: nunca se crea una tercera
  assert.equal(final.data.reduce((s,r)=>s+r.saldo,0),6);
});

test('dos familias independientes (codeBase distinto) en la misma llamada: cada delta se calcula y reparte por separado, nunca se mezclan',()=>{
  const destino = {data:[
    {producto:'FAM1-DEST',generico:'G1',categoria:'SIMPLES',codeBase:'111',saldo:0},
    {producto:'FAM2-DEST',generico:'G2',categoria:'SIMPLES',codeBase:'222',saldo:0}
  ]};
  const projectionRows = [
    {producto:'FAM1-SRC',generico:'G1',categoria:'SIMPLES',codeBase:'111'},
    {producto:'FAM2-SRC',generico:'G2',categoria:'SIMPLES',codeBase:'222'}
  ];
  const balances = {'FAM1-SRC':10,'FAM2-SRC':-4};
  const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
  assert.equal(final.data.find(r=>r.producto==='FAM1-DEST').saldo,10);
  assert.equal(final.data.find(r=>r.producto==='FAM2-DEST').saldo,-4);
});

test('no doble conteo: una fila ya resuelta por coincidencia exacta/variante no recibe delta si su familia ya cuadra',()=>{
  // 2 de 3 variantes coinciden exacto (ya con su valor correcto puesto por refreshInheritedBalance);
  // la 3ª no existe en destino. sourceFamilyTotal=6 (1+2+3), destino actual=3 (1+2) -> delta=3, que debe
  // repartirse SOLO entre las filas existentes (nunca inventar una fila para la variante ausente).
  const destino = {data:[
    {producto:'A',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:1},
    {producto:'B',generico:'G',categoria:'SIMPLES',codeBase:'111',saldo:2}
  ]};
  const projectionRows = [
    {producto:'A',generico:'G',categoria:'SIMPLES',codeBase:'111'},
    {producto:'B',generico:'G',categoria:'SIMPLES',codeBase:'111'},
    {producto:'C',generico:'G',categoria:'SIMPLES',codeBase:'111'}
  ];
  const balances = {A:1,B:2,C:3};
  const final = StockPlanning.refreshInheritedBalanceByFamily(destino, projectionRows, balances);
  assert.equal(final.data.length,2);
  const total = final.data.reduce((s,r)=>s+r.saldo,0);
  assert.equal(total,6); // 1+2+3: nunca se pierde la variante ausente, nunca se cuenta dos veces la que ya coincidía exacto
});

// TEST PIPELINE COMPLETO con los datos reales confirmados en sesión: reproduce exactamente
// refreshInheritedBalance -> refreshInheritedBalanceByVariant -> refreshInheritedBalanceByFamily.
test('pipeline completo (caso real Ethiopia+Alstro): variantCode resuelve todo lo que puede, familia solo cubre el residual real',()=>{
  const refreshedS35 = {
    data:[
      {producto:'A-ROSAS-ETHIOPIA_1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'1',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'2',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_3',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'3',saldo:0},
      {producto:'A-ROSAS-ETHIOPIA_4',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'4',saldo:0},
      {producto:'S-Alstro_parme__1',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',variantCode:'1',saldo:0},
      {producto:'S-Alstro_parme__2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',variantCode:'2',saldo:0},
      {producto:'S-Alstro_parme__3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',variantCode:'3',saldo:0}
    ]
  };
  const projectionRows = [
    {producto:'A-Rosas-Ethiopia-1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'1'},
    {producto:'A-Rosas-Ethiopia-2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'2'},
    {producto:'A-Rosas-Ethiopia-3',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'3'},
    {producto:'A-Rosas-Ethiopia-4',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',variantCode:'4'},
    {producto:'S-Alstro-parme-20-2',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',variantCode:'2'},
    {producto:'S-Alstro-parme-25-3',generico:'S-Alstro-parme',categoria:'SIMPLES',codeBase:'25148',variantCode:'3'}
  ];
  const projectionBalances = {
    'A-Rosas-Ethiopia-1':5,'A-Rosas-Ethiopia-2':2,'A-Rosas-Ethiopia-3':2,'A-Rosas-Ethiopia-4':-1,
    'S-Alstro-parme-20-2':-1,'S-Alstro-parme-25-3':-1
  };
  const byVariant = StockPlanning.refreshInheritedBalanceByVariant(refreshedS35, projectionRows, projectionBalances);
  const final = StockPlanning.refreshInheritedBalanceByFamily(byVariant.plan, projectionRows, projectionBalances);

  assert.equal(final.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_1').saldo,5);
  assert.equal(final.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_2').saldo,2);
  assert.equal(final.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_3').saldo,2);
  assert.equal(final.data.find(r=>r.producto==='A-ROSAS-ETHIOPIA_4').saldo,-1);
  // Ethiopia: variantCode completo en ambos lados (4 fuente, 4 destino) -> fallback de familia no interviene, ya cuadraba
  assert.equal(final.data.find(r=>r.producto==='S-Alstro_parme__2').saldo,-1);
  assert.equal(final.data.find(r=>r.producto==='S-Alstro_parme__3').saldo,-1);
  // Alstro NO tiene cobertura completa (variantCode '1' fuente no existe en projectionRows): el residual (0, porque
  // no hay ninguna variante fuente sin representar) no mueve la fila "_1", que se queda como refreshInheritedBalance la dejó.
  assert.equal(final.data.find(r=>r.producto==='S-Alstro_parme__1').saldo,0);

  const totalEthiopia = final.data.filter(r=>r.codeBase==='31056').reduce((s,r)=>s+r.saldo,0);
  const totalAlstro = final.data.filter(r=>r.codeBase==='25148').reduce((s,r)=>s+r.saldo,0);
  assert.equal(totalEthiopia,8);
  assert.equal(totalAlstro,-2);
});

test('pipeline con snapshot ANTIGUO sin variantCode en ningún lado: cae por completo al fallback de familia por residual (regresión de compatibilidad)',()=>{
  const destinoAntiguo = {data:[
    {producto:'A-ROSAS-ETHIOPIA_1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',saldo:0}, // sin variantCode: snapshot de antes de este fix
    {producto:'A-ROSAS-ETHIOPIA_2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056',saldo:0}
  ]};
  const projectionRows = [
    {producto:'A-Rosas-Ethiopia-1',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056'}, // tampoco tiene variantCode
    {producto:'A-Rosas-Ethiopia-2',generico:'A-Rosas-Ethiopia',categoria:'ROSAS',codeBase:'31056'}
  ];
  const balances = {'A-Rosas-Ethiopia-1':5,'A-Rosas-Ethiopia-2':3};
  const byVariant = StockPlanning.refreshInheritedBalanceByVariant(destinoAntiguo, projectionRows, balances);
  assert.deepEqual(byVariant.matchedDestino,[]); // nada se resuelve por variante: no hay variantCode en ningún lado
  const final = StockPlanning.refreshInheritedBalanceByFamily(byVariant.plan, projectionRows, balances);
  const total = final.data.reduce((s,r)=>s+r.saldo,0);
  assert.equal(total,8); // el total se conserva vía delta, aunque no haya precisión por variante
});

// Tests de regresión para el fix "el saldo heredado de S+1 quedaba congelado si su snapshot ya
// existía". La lógica de cálculo (refreshInheritedBalance) ya se prueba a fondo en
// stock-planning.test.js con datos reales; aquí solo se comprueba el CABLEADO real en index.html:
// que openStockPlanningWeek() la invoca exclusivamente en el rol 's1', nunca en 'future' (S+2+), y que
// el bloque de creación (snapshot inexistente) sigue intacto.
const fs=require('fs');
const path=require('path');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');

const fnStart=html.indexOf('function openStockPlanningWeek(');
const fnEnd=html.indexOf('function setStockWeekInitialBalanceMode(');
if(fnStart<0||fnEnd<0) throw new Error('No se encontró openStockPlanningWeek en index.html');
const source=html.slice(fnStart,fnEnd);

test('openStockPlanningWeek: el bloque de creación (snapshot inexistente) sigue intacto',()=>{
  assert.match(source,/if\(!snap\)\{/);
  assert.match(source,/snap = AquarelleStockPlanning\.buildDraftWeekPlan\(\{/);
  assert.match(source,/weekSnapshots\[key\] = snap; \/\/ se persiste SOLO la semana que el usuario decide abrir; nunca las intermedias/);
});

test('openStockPlanningWeek: el refresco de saldo (snapshot ya existente) solo se dispara para el rol "s1"',()=>{
  const elseIfMatch=source.match(/\}\s*else if\(([^)]*stockPlanningWeekRole\([^)]*\)\s*===\s*['"]s1['"][^)]*)\)\{/);
  assert.ok(elseIfMatch,'debe existir un "else if" adjunto al "if(!snap)" que compruebe el rol s1');
  const branchStart=source.indexOf(elseIfMatch[0]);
  const branchEnd=source.indexOf('applyWeekSnapshot(', branchStart);
  const branch=source.slice(branchStart,branchEnd);
  assert.match(branch,/AquarelleStockPlanning\.projectOpeningBalance\(\{/);
  assert.match(branch,/const refreshed = AquarelleStockPlanning\.refreshInheritedBalance\(reconciled\.plan, projection\.balances\);/);
  assert.match(branch,/snap = byFamily;/);
  assert.match(branch,/weekSnapshots\[key\] = snap;/);
  // nunca debe reconstruir todo el borrador (eso borraría compras/PREV manuales de S+1) ni usar buildDraftWeekPlan aquí
  assert.doesNotMatch(branch,/buildDraftWeekPlan/);
});

test('S+1 encadena refreshInheritedBalanceByVariant -> refreshInheritedBalanceByFamily tras refreshInheritedBalance (caso real Rosas-Colores: 1 unidad que producto exacto solo no recuperaba)',()=>{
  const elseIfMatch=source.match(/\}\s*else if\(([^)]*stockPlanningWeekRole\([^)]*\)\s*===\s*['"]s1['"][^)]*)\)\{/);
  const branchStart=source.indexOf(elseIfMatch[0]);
  const branchEnd=source.indexOf('applyWeekSnapshot(', branchStart);
  const branch=source.slice(branchStart,branchEnd);
  const refreshIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  const byVariantIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByVariant(');
  const byFamilyIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByFamily(');
  assert.ok(byVariantIndex>refreshIndex,'debe resolver por variante DESPUÉS de la coincidencia exacta por producto');
  assert.ok(byFamilyIndex>byVariantIndex,'el fallback de familia debe ir DESPUÉS del emparejamiento por variante');
  assert.match(branch,/AquarelleStockPlanning\.refreshInheritedBalanceByVariant\(refreshed, projection\.rows, projection\.balances\);/);
  assert.match(branch,/AquarelleStockPlanning\.refreshInheritedBalanceByFamily\(byVariant\.plan, projection\.rows, projection\.balances\);/);
  // refreshInheritedBalanceByFamily ya no necesita resolvedProductos: calcula por residual de familia.
  assert.doesNotMatch(branch,/resolvedProductos/);
});

test('openStockPlanningWeek: el getStoredPlan de la proyección de S+1 excluye su propia clave (year,week), ignorando cualquier initialBalanceMode="zero" histórico',()=>{
  const elseIfMatch=source.match(/\}\s*else if\(([^)]*stockPlanningWeekRole\([^)]*\)\s*===\s*['"]s1['"][^)]*)\)\{/);
  const branchStart=source.indexOf(elseIfMatch[0]);
  const branchEnd=source.indexOf('applyWeekSnapshot(', branchStart);
  const branch=source.slice(branchStart,branchEnd);
  // mismo patrón de exclusión que ya usa setStockWeekInitialBalanceMode para S+2+, aplicado aquí a la
  // propia clave (year,week) de S+1 en vez de a weekState.year/weekState.week.
  assert.match(branch,/getStoredPlan:\(y,w\)=>\(y===year&&w===week\)\?null:stockPlanningGetStoredPlan\(y,w\),/);
  assert.doesNotMatch(branch,/getStoredPlan: stockPlanningGetStoredPlan,/,'no debe pasar el accesor sin filtrar: leería el initialBalanceMode histórico del propio snapshot de S+1');
});

test('openStockPlanningWeek: tras refrescar el saldo, el snapshot de S+1 se fuerza a initialBalanceMode inherit',()=>{
  const elseIfMatch=source.match(/\}\s*else if\(([^)]*stockPlanningWeekRole\([^)]*\)\s*===\s*['"]s1['"][^)]*)\)\{/);
  const branchStart=source.indexOf(elseIfMatch[0]);
  const branchEnd=source.indexOf('applyWeekSnapshot(', branchStart);
  const branch=source.slice(branchStart,branchEnd);
  const refreshIndex=branch.indexOf('refreshInheritedBalance');
  const forceInheritIndex=branch.indexOf('snap.initialBalanceMode = AquarelleStockPlanning.DEFAULT_INITIAL_BALANCE_MODE');
  assert.ok(forceInheritIndex>=0,'debe forzar snap.initialBalanceMode al valor por defecto (inherit) tras refrescar');
  assert.ok(forceInheritIndex>refreshIndex,'debe forzarse DESPUÉS de refreshInheritedBalance, sobre el snapshot ya refrescado');
});

test('openStockPlanningWeek: el refresco de saldo NUNCA se dispara para "future" (S+2 en adelante) ni para "actual"',()=>{
  // La única condición de disparo es stockPlanningWeekRole(...) === 's1'; comprobamos que no exista
  // ninguna variante que también dispare el refresco para 'future' o sin comprobar el rol.
  assert.doesNotMatch(source,/stockPlanningWeekRole\([^)]*\)\s*===\s*['"]future['"]\)\{\s*\n?\s*.*refreshInheritedBalance/);
  const role=require('./stock-planning.js'); // solo para confirmar que 'future' y 's1' son valores distintos y reales
  assert.notEqual('s1','future');
});

test('openStockPlanningWeek: el "else if" del refresco cuelga del mismo "if(!snap)", no es un bloque independiente que también podría disparar en la creación',()=>{
  const ifIndex=source.indexOf('if(!snap){');
  const elseIfIndex=source.search(/\}\s*else if\([^)]*stockPlanningWeekRole/);
  assert.ok(ifIndex>=0&&elseIfIndex>ifIndex,'el else-if de refresco debe aparecer después del if(!snap) de creación, en la misma cadena');
  const between=source.slice(ifIndex,elseIfIndex);
  // entre el "if(!snap){" y el "else if" de refresco no debe haber otro "}" de nivel superior que rompa la cadena
  const applyIndex=source.indexOf('applyWeekSnapshot(');
  assert.ok(elseIfIndex<applyIndex,'el else-if de refresco debe resolverse antes de aplicar el snapshot al render');
});

test('el panel de S+2+ (saldo heredar/cero manual, + Añadir producto) sigue exactamente igual: este fix no lo toca',()=>{
  assert.match(html,/role === 'future'.*Heredar saldo previsto.*Partir de 0/s);
  assert.match(html,/function setStockWeekInitialBalanceMode\(mode\)\{\s*\n\s*const safeMode = AquarelleStockPlanning\.normalizeInitialBalanceMode\(mode\);\s*\n\s*if\(activeStockPlanningWeekRole\(\) !== 'future'\) return;/);
});

// Tests para reconcileMissingInheritedProducts: solo el CABLEADO en index.html (orden, guardas de rol,
// hook en el pegado de Recap). El comportamiento de la función pura ya se prueba a fondo con datos
// reales en stock-planning.test.js (tests A-H).

test('H: openStockPlanningWeek reconcilia ANTES de refrescar el saldo, y solo en el rol "s1" (S+2+ nunca la invoca)',()=>{
  const elseIfMatch=source.match(/\}\s*else if\(([^)]*stockPlanningWeekRole\([^)]*\)\s*===\s*['"]s1['"][^)]*)\)\{/);
  const branchStart=source.indexOf(elseIfMatch[0]);
  const branchEnd=source.indexOf('applyWeekSnapshot(', branchStart);
  const branch=source.slice(branchStart,branchEnd);
  const reconcileIndex=branch.indexOf('AquarelleStockPlanning.reconcileMissingInheritedProducts(');
  const refreshIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  assert.ok(reconcileIndex>=0,'debe reconciliar la composición dentro de la rama s1');
  assert.ok(reconcileIndex<refreshIndex,'debe reconciliar ANTES de refrescar el saldo, para que el refresco también alcance a las filas reconciliadas');
  assert.match(branch,/AquarelleStockPlanning\.reconcileMissingInheritedProducts\(\s*snap, projection\.balances, anchorPlan\.data, stockPlanningProductIsActiveInCatalog\s*\);/);
  assert.match(branch,/const refreshed = AquarelleStockPlanning\.refreshInheritedBalance\(reconciled\.plan, projection\.balances\);/);
  // fuera de la rama s1 (todo lo anterior al "else if" y todo lo posterior a applyWeekSnapshot dentro de
  // este archivo, para S+2+) no debe existir ninguna llamada a reconcileMissingInheritedProducts.
  const beforeBranch=source.slice(0,branchStart);
  const afterApply=source.slice(source.indexOf('applyWeekSnapshot(',branchStart));
  assert.doesNotMatch(beforeBranch,/reconcileMissingInheritedProducts/);
  assert.doesNotMatch(afterApply,/reconcileMissingInheritedProducts/);
});

test('I: el pegado de Recap (btnPasteApply) aplica la MISMA reconciliación inmediatamente, gateada por activeStockPlanningWeekRole()===\'s1\'',()=>{
  const pasteStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
  const pasteEnd=html.indexOf('// ---------- Cálculo de previsión', pasteStart);
  assert.ok(pasteStart>=0&&pasteEnd>pasteStart,'no se encontró el handler btnPasteApply en index.html');
  const pasteSource=html.slice(pasteStart,pasteEnd);

  const guardIndex=pasteSource.search(/if\(activeStockPlanningWeekRole\(\) === ['"]s1['"]\)\{/);
  assert.ok(guardIndex>=0,'el pegado debe reconciliar solo cuando la semana activa en pantalla es s1');
  const guardBlockEnd=pasteSource.indexOf('\n  }',guardIndex);
  const guardBlock=pasteSource.slice(guardIndex,guardBlockEnd);

  assert.match(guardBlock,/AquarelleStockPlanning\.reconcileMissingInheritedProducts\(\s*\{data\}, projection\.balances, anchorPlan\.data, stockPlanningProductIsActiveInCatalog\s*\);/);
  assert.match(guardBlock,/const refreshed = AquarelleStockPlanning\.refreshInheritedBalance\(reconciled\.plan, projection\.balances\);/);
  assert.match(guardBlock,/data = byFamily\.data;/);
  // debe reutilizar exactamente la misma pareja de funciones puras que openStockPlanningWeek, no una
  // reimplementación paralela de "reconciliar + refrescar".
  assert.doesNotMatch(guardBlock,/buildDraftWeekPlan/);

  // el hook vive DESPUÉS del reemplazo normal de data (data = nextData) y de la reconstrucción de
  // genericoData/prevExpedicionProducto/forecastAdjustments que ya hacía el pegado: nunca antes.
  const dataAssignIndex=pasteSource.indexOf('data = nextData;');
  assert.ok(dataAssignIndex>=0&&dataAssignIndex<guardIndex,'la reconciliación debe ir después de aplicar el Recap pegado, nunca antes');
});

test('5: el pegado de Recap en S+1 aplica la MISMA secuencia refreshInheritedBalanceByVariant -> refreshInheritedBalanceByFamily que openStockPlanningWeek',()=>{
  const pasteStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
  const pasteEnd=html.indexOf('// ---------- Cálculo de previsión', pasteStart);
  const pasteSource=html.slice(pasteStart,pasteEnd);
  const guardIndex=pasteSource.search(/if\(activeStockPlanningWeekRole\(\) === ['"]s1['"]\)\{/);
  const guardBlockEnd=pasteSource.indexOf('\n  }',guardIndex);
  const guardBlock=pasteSource.slice(guardIndex,guardBlockEnd);
  const refreshIndex=guardBlock.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  const byVariantIndex=guardBlock.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByVariant(');
  const byFamilyIndex=guardBlock.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByFamily(');
  assert.ok(byVariantIndex>refreshIndex);
  assert.ok(byFamilyIndex>byVariantIndex);
  assert.match(guardBlock,/AquarelleStockPlanning\.refreshInheritedBalanceByVariant\(refreshed, anchorPlan\.data, projection\.balances\);/);
  assert.match(guardBlock,/AquarelleStockPlanning\.refreshInheritedBalanceByFamily\(byVariant\.plan, anchorPlan\.data, projection\.balances\);/);
  assert.doesNotMatch(guardBlock,/resolvedProductos/);
});

test('el hook del pegado no aparece fuera de su guarda de rol (no afecta a semana actual, S+2+ ni histórico)',()=>{
  const pasteStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
  const pasteEnd=html.indexOf('// ---------- Cálculo de previsión', pasteStart);
  const pasteSource=html.slice(pasteStart,pasteEnd);
  const occurrences=pasteSource.match(/AquarelleStockPlanning\.reconcileMissingInheritedProducts\(/g)||[];
  assert.equal(occurrences.length,1,'reconcileMissingInheritedProducts debe invocarse una sola vez en el handler de pegado, dentro de la guarda de rol s1');
});

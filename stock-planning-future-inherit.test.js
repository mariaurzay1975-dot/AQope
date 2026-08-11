// Tests de regresión para el fix "el saldo heredado de S+2..S+8 en modo inherit no coincidía con el
// saldo final proyectado REAL de la semana anterior, porque la cadena fijaba la composición a la del
// ancla (S33) para todos los saltos". La lógica de cálculo (projectOpeningBalanceChain,
// reconcileMissingInheritedProducts, refreshInheritedBalance) ya se prueba a fondo con datos reales en
// stock-planning.test.js / stock-planning-chain.test.js; aquí solo se comprueba el CABLEADO real en
// index.html: setStockWeekInitialBalanceMode (rama inherit vs zero) y el auto-refresco al reabrir una
// semana future en modo inherit dentro de openStockPlanningWeek.
const fs=require('fs');
const path=require('path');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');

const setModeStart=html.indexOf('function setStockWeekInitialBalanceMode(');
const setModeEnd=html.indexOf('function addStockPlannedProduct(',setModeStart);
if(setModeStart<0||setModeEnd<0) throw new Error('No se encontró setStockWeekInitialBalanceMode en index.html');
const setModeSource=html.slice(setModeStart,setModeEnd);

const openWeekStart=html.indexOf('function openStockPlanningWeek(');
const openWeekEnd=html.indexOf('function setStockWeekInitialBalanceMode(');
const openWeekSource=html.slice(openWeekStart,openWeekEnd);

const pasteStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
const pasteEnd=html.indexOf('// ---------- Cálculo de previsión',pasteStart);
const pasteSource=html.slice(pasteStart,pasteEnd);

test('setStockWeekInitialBalanceMode: la rama "zero" pone saldo 0 directamente y NUNCA reconcilia',()=>{
  const zeroBranchMatch=setModeSource.match(/if\(safeMode==='zero'\)\{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(zeroBranchMatch,'debe existir una rama explícita para safeMode===\'zero\'');
  const zeroBranch=zeroBranchMatch[1];
  assert.match(zeroBranch,/data = data\.map\(row=>\(\{\.\.\.row, saldo:0\}\)\);/);
  assert.doesNotMatch(zeroBranch,/reconcileMissingInheritedProducts/);
  assert.doesNotMatch(zeroBranch,/refreshInheritedBalance/);
  assert.doesNotMatch(zeroBranch,/projectOpeningBalanceChain/);
});

test('A: setStockWeekInitialBalanceMode: la rama "inherit" (Heredar) usa projectOpeningBalanceChain -> reconcileMissingInheritedProducts -> refreshInheritedBalance, no el "??0" antiguo',()=>{
  const elseBranchStart=setModeSource.indexOf('} else {');
  const elseBranchEnd=setModeSource.indexOf('stockInitialBalanceMode = safeMode;');
  const elseBranch=setModeSource.slice(elseBranchStart,elseBranchEnd);
  const chainIndex=elseBranch.indexOf('AquarelleStockPlanning.projectOpeningBalanceChain(');
  const reconcileIndex=elseBranch.indexOf('AquarelleStockPlanning.reconcileMissingInheritedProducts(');
  const refreshIndex=elseBranch.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  assert.ok(chainIndex>=0,'debe usar la cadena completa (projectOpeningBalanceChain), no el salto único');
  assert.ok(reconcileIndex>chainIndex,'debe reconciliar DESPUÉS de calcular la cadena');
  assert.ok(refreshIndex>reconcileIndex,'debe refrescar el saldo DESPUÉS de reconciliar, no antes');
  assert.match(elseBranch,/AquarelleStockPlanning\.projectOpeningBalanceChain\(\{/);
  assert.match(elseBranch,/getStoredPlan:\(y,w\)=>\(y===weekState\.year&&w===weekState\.week\)\?null:stockPlanningGetStoredPlan\(y,w\),/,'debe excluir su propia clave, igual que antes');
  assert.match(elseBranch,/isActiveProduct: stockPlanningProductIsActiveInCatalog/);
  // la reconciliación del destino debe usar projection.rows (composición evolucionada), NUNCA anchorPlan.data fijo
  assert.match(elseBranch,/AquarelleStockPlanning\.reconcileMissingInheritedProducts\(\s*\{data\}, projection\.balances, projection\.rows, stockPlanningProductIsActiveInCatalog\s*\);/);
  assert.doesNotMatch(elseBranch,/reconcileMissingInheritedProducts\(\s*\{data\}, projection\.balances, anchorPlan\.data,/,'no debe reconciliar contra anchorPlan.data: eso es exactamente el bug de fijar la composición a S33');
  assert.match(elseBranch,/const refreshed = AquarelleStockPlanning\.refreshInheritedBalance\(reconciled\.plan, projection\.balances\);/);
  assert.match(elseBranch,/data = byFamily\.data;/);
  // el bug real original: nunca debe quedar el patrón antiguo que forzaba a 0 cualquier producto propio ausente de la proyección
  assert.doesNotMatch(setModeSource,/saldo:Math\.round\(openingBalances\[row\.producto\]\?\?0\)/);
});

test('A2: setStockWeekInitialBalanceMode: tras refreshInheritedBalance encadena refreshInheritedBalanceByVariant -> refreshInheritedBalanceByFamily, excluyendo lo ya resuelto en cada paso',()=>{
  const elseBranchStart=setModeSource.indexOf('} else {');
  const elseBranchEnd=setModeSource.indexOf('stockInitialBalanceMode = safeMode;');
  const elseBranch=setModeSource.slice(elseBranchStart,elseBranchEnd);
  const refreshIndex=elseBranch.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  const byVariantIndex=elseBranch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByVariant(');
  const byFamilyIndex=elseBranch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByFamily(');
  assert.ok(byVariantIndex>refreshIndex,'debe resolver por variante DESPUÉS de la coincidencia exacta por producto');
  assert.ok(byFamilyIndex>byVariantIndex,'el fallback de familia debe ir DESPUÉS del emparejamiento por variante, nunca antes');
  assert.match(elseBranch,/AquarelleStockPlanning\.refreshInheritedBalanceByVariant\(refreshed, projection\.rows, projection\.balances\);/);
  assert.match(elseBranch,/AquarelleStockPlanning\.refreshInheritedBalanceByFamily\(byVariant\.plan, projection\.rows, projection\.balances\);/);
  // refreshInheritedBalanceByFamily ya no necesita resolvedProductos: calcula por residual de familia
  // (sourceFamilyTotal - destinationFamilyCurrentTotal), no por conjuntos "sin resolver".
  assert.doesNotMatch(elseBranch,/resolvedProductos/);
});

test('setStockWeekInitialBalanceMode: los omitted de toda la cadena (no solo del último salto) se juntan para revisión',()=>{
  const elseBranchStart=setModeSource.indexOf('} else {');
  const elseBranchEnd=setModeSource.indexOf('stockInitialBalanceMode = safeMode;');
  const elseBranch=setModeSource.slice(elseBranchStart,elseBranchEnd);
  assert.match(elseBranch,/const todoLoOmitido = \[\.\.\.projection\.omitted, \.\.\.reconciled\.omitted\];/);
});

test('setStockWeekInitialBalanceMode: el guard "if(activeStockPlanningWeekRole() !== \'future\') return;" sigue intacto (nunca aplica a s1/actual)',()=>{
  assert.match(setModeSource,/if\(activeStockPlanningWeekRole\(\) !== 'future'\) return;/);
});

test('B: openStockPlanningWeek: existe una rama que auto-refresca al reabrir una semana "future" cuyo snapshot ya está en modo inherit, usando la cadena completa',()=>{
  const elseIfMatch=openWeekSource.match(/\}\s*else if\(stockPlanningWeekRole\(year, week\) === ['"]future['"] && AquarelleStockPlanning\.normalizeInitialBalanceMode\(snap\.initialBalanceMode\) === ['"]inherit['"]\)\{/);
  assert.ok(elseIfMatch,'debe existir una rama else-if para role===\'future\' && initialBalanceMode==\'inherit\'');
  const branchStart=openWeekSource.indexOf(elseIfMatch[0]);
  const branchEnd=openWeekSource.indexOf('applyWeekSnapshot(',branchStart);
  const branch=openWeekSource.slice(branchStart,branchEnd);
  assert.match(branch,/AquarelleStockPlanning\.projectOpeningBalanceChain\(\{/);
  assert.match(branch,/getStoredPlan:\(y,w\)=>\(y===year&&w===week\)\?null:stockPlanningGetStoredPlan\(y,w\),/,'debe excluir su propia clave, igual que S+1 y que "Heredar", para que no se autoalimente de un valor antiguo');
  assert.match(branch,/isActiveProduct: stockPlanningProductIsActiveInCatalog/);
  assert.match(branch,/AquarelleStockPlanning\.reconcileMissingInheritedProducts\(\s*snap, projection\.balances, projection\.rows, stockPlanningProductIsActiveInCatalog\s*\);/);
  assert.doesNotMatch(branch,/reconcileMissingInheritedProducts\(\s*snap, projection\.balances, anchorPlan\.data,/,'no debe reconciliar contra anchorPlan.data: eso es exactamente el bug de fijar la composición a S33');
  assert.match(branch,/const refreshed = AquarelleStockPlanning\.refreshInheritedBalance\(reconciled\.plan, projection\.balances\);/);
  assert.match(branch,/weekSnapshots\[key\] = snap;/);
  // a diferencia de la rama s1, aquí NO se debe forzar initialBalanceMode (ya es inherit por la propia guarda del else-if)
  assert.doesNotMatch(branch,/snap\.initialBalanceMode = AquarelleStockPlanning\.DEFAULT_INITIAL_BALANCE_MODE/);
});

test('B2: openStockPlanningWeek (future+inherit): tras refreshInheritedBalance encadena refreshInheritedBalanceByVariant -> refreshInheritedBalanceByFamily antes de guardar el snapshot',()=>{
  const elseIfMatch=openWeekSource.match(/\}\s*else if\(stockPlanningWeekRole\(year, week\) === ['"]future['"] && AquarelleStockPlanning\.normalizeInitialBalanceMode\(snap\.initialBalanceMode\) === ['"]inherit['"]\)\{/);
  const branchStart=openWeekSource.indexOf(elseIfMatch[0]);
  const branchEnd=openWeekSource.indexOf('applyWeekSnapshot(',branchStart);
  const branch=openWeekSource.slice(branchStart,branchEnd);
  const refreshIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalance(');
  const byVariantIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByVariant(');
  const byFamilyIndex=branch.indexOf('AquarelleStockPlanning.refreshInheritedBalanceByFamily(');
  const snapAssignIndex=branch.indexOf('snap = byFamily;');
  assert.ok(byVariantIndex>refreshIndex);
  assert.ok(byFamilyIndex>byVariantIndex);
  assert.ok(snapAssignIndex>byFamilyIndex,'debe guardar el resultado del fallback de familia (el último paso), no uno intermedio');
  assert.match(branch,/AquarelleStockPlanning\.refreshInheritedBalanceByVariant\(refreshed, projection\.rows, projection\.balances\);/);
  assert.match(branch,/AquarelleStockPlanning\.refreshInheritedBalanceByFamily\(byVariant\.plan, projection\.rows, projection\.balances\);/);
  assert.doesNotMatch(branch,/resolvedProductos/);
});

test('D: openStockPlanningWeek: una semana "future" en modo "zero" NUNCA dispara el auto-refresco ni la reconciliación al reabrir',()=>{
  const futureBranchCount=(openWeekSource.match(/stockPlanningWeekRole\(year, week\) === ['"]future['"]/g)||[]).length;
  assert.equal(futureBranchCount,1,'solo debe haber una comprobación de role===\'future\', y debe ir acompañada de la comprobación de inherit');
  assert.doesNotMatch(openWeekSource,/stockPlanningWeekRole\(year, week\) === ['"]future['"] && AquarelleStockPlanning\.normalizeInitialBalanceMode\(snap\.initialBalanceMode\) === ['"]zero['"]\)\{/);
});

test('H/J: projectOpeningBalanceChain se usa EXACTAMENTE en las dos ramas future+inherit (Heredar y reabrir), y en ningún otro sitio de index.html',()=>{
  const totalOccurrences=(html.match(/AquarelleStockPlanning\.projectOpeningBalanceChain\(/g)||[]).length;
  assert.equal(totalOccurrences,2,'debe usarse exactamente 2 veces en todo index.html: setStockWeekInitialBalanceMode y la rama future+inherit de openStockPlanningWeek');
  // ninguna de las dos apariciones está en la rama s1 ni en el bloque de creación de openStockPlanningWeek
  const s1BranchMatch=openWeekSource.match(/\}\s*else if\(stockPlanningWeekRole\(year, week\) === ['"]s1['"]\)\{([\s\S]*?)\}\s*else if\(stockPlanningWeekRole/);
  assert.ok(s1BranchMatch,'debe poder aislarse la rama s1 completa');
  assert.doesNotMatch(s1BranchMatch[1],/AquarelleStockPlanning\.projectOpeningBalanceChain\(/);
  const creationBranchMatch=openWeekSource.match(/if\(!snap\)\{([\s\S]*?)\}\s*else if\(stockPlanningWeekRole/);
  assert.ok(creationBranchMatch,'debe poder aislarse el bloque de creación completo');
  assert.doesNotMatch(creationBranchMatch[1],/AquarelleStockPlanning\.projectOpeningBalanceChain\(/);
  // tampoco en el hook de pegado de Recap de S+1
  assert.doesNotMatch(pasteSource,/AquarelleStockPlanning\.projectOpeningBalanceChain\(/);
});

test('J: la rama s1 de openStockPlanningWeek (S+1) permanece exactamente igual: sigue forzando inherit, con projectOpeningBalance de un solo salto',()=>{
  const s1BranchMatch=openWeekSource.match(/\}\s*else if\(stockPlanningWeekRole\(year, week\) === ['"]s1['"]\)\{([\s\S]*?)\}\s*else if\(stockPlanningWeekRole/);
  assert.match(s1BranchMatch[1],/AquarelleStockPlanning\.projectOpeningBalance\(\{/);
  assert.doesNotMatch(s1BranchMatch[1],/AquarelleStockPlanning\.projectOpeningBalanceChain\(/);
  assert.match(openWeekSource,/snap\.initialBalanceMode = AquarelleStockPlanning\.DEFAULT_INITIAL_BALANCE_MODE; \/\/ S\+1 siempre inherit, nunca "zero"/);
});

test('J: el hook de pegado de Recap de S+1 sigue usando projectOpeningBalance de un solo salto, no la cadena',()=>{
  assert.match(pasteSource,/AquarelleStockPlanning\.projectOpeningBalance\(\{/);
  assert.doesNotMatch(pasteSource,/AquarelleStockPlanning\.projectOpeningBalanceChain\(/);
  assert.match(pasteSource,/if\(activeStockPlanningWeekRole\(\) === 's1'\)\{/);
});

test('el pegado de Recap captura variantCode (parts[1]) en el formato "Recap Stock real" y lo persiste en las filas de data',()=>{
  const applyStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
  const applyEnd=html.indexOf('// ---------- Subir archivo de previsiones',applyStart);
  const applySource=html.slice(applyStart,applyEnd>0?applyEnd:applyStart+6000);
  assert.match(applySource,/variantCode = parts\[1\];/);
  assert.match(applySource,/const row = \{producto, saldo, codeProduit, codeBase, variantCode, meta, categoria\};/);
  assert.match(applySource,/nextData\.push\(\{categoria:r\.categoria, generico, producto:r\.producto, saldo:r\.saldo, recapCode:r\.codeProduit, codeBase:r\.codeBase, variantCode:r\.variantCode\}\);/);
  // nunca se infiere variantCode a partir del nombre de producto (ningún parseo de sufijo de r.producto)
  assert.doesNotMatch(applySource,/variantCode\s*=\s*.*producto\.match/);
});

test('el pegado de Recap valida variantKey (último campo no vacío) contra codeBase-variantCode, usando lastNonEmptyField (sin asumir parts[length-1])',()=>{
  const applyStart=html.indexOf("document.getElementById('btnPasteApply').addEventListener");
  const applyEnd=html.indexOf('// ---------- Subir archivo de previsiones',applyStart);
  const applySource=html.slice(applyStart,applyEnd>0?applyEnd:applyStart+6000);
  assert.match(applySource,/AquarelleStockPlanning\.lastNonEmptyField\(parts\)/);
  assert.doesNotMatch(applySource,/parts\[parts\.length\s*-\s*1\]/,'no debe confiar a ciegas en el último índice: podría ser un tabulador vacío final');
  assert.match(applySource,/variantKey !== `\$\{codeBase\}-\$\{variantCode\}`/);
});

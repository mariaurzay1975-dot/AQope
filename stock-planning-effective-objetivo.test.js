// Tests de regresión para el fix "S+1 no usaba el objetivo efectivo en el cálculo con IA".
// Ejecuta el código REAL de index.html (extraído por rango de texto, mismo patrón que
// annual-bo-parser.test.js) dentro de un contexto vm mínimo, en vez de reimplementar la lógica.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const AquarelleStockPlanning=require('./stock-planning.js');

const indexPath=path.join(__dirname,'index.html');
const html=fs.readFileSync(indexPath,'utf8');

// Bloque contiguo de solo declaraciones de función (sin código de nivel superior que se
// ejecute al cargar), desde weekKey/parseWeekKey hasta activeStockPlanningWeekRole, justo antes
// de openStockPlanningWeek. Incluye stockPlanningAutomaticForecastTotal y la función del fix,
// stockPlanningEffectiveObjetivo, además de la resolución de rol s1/future/actual.
const start=html.indexOf('function weekKey(');
const end=html.indexOf('function openStockPlanningWeek(');
if(start<0||end<0) throw new Error('No se encontraron las funciones de planificación semanal en index.html');
const source=html.slice(start,end);
assert.match(source,/function stockPlanningEffectiveObjetivo\(\)/,'el fix debe seguir viviendo en una única función reutilizable');
assert.match(source,/function stockPlanningWeekRole\(/);

function makeContext({annualForecast=null, objetivo=0, acumulado=0, currentWeekKey, activeYear, activeWeek}={}){
  const context={
    weekState:{year:activeYear, week:activeWeek, objetivo, acumulado, baseWeekKey:null},
    currentWeekKey,
    AquarelleStockPlanning,
    AquarelleAnnualHolidays:{
      getAnnualForecastForWeek:(_plan,_year,_week)=>annualForecast!=null?{status:'found',value:annualForecast}:{status:'not-found'}
    },
    annualPlanning:{}
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return context;
}

test('DIAGNÓSTICO: buildDraftWeekPlan (creación real de S+1) sigue inicializando objetivo a 0',()=>{
  const draft=AquarelleStockPlanning.buildDraftWeekPlan({year:2026,week:41,rows:[{producto:'A',generico:'G',categoria:'ROSAS'}],openingBalances:{A:10},initialBalanceMode:'inherit',now:'2026-10-01T00:00:00.000Z'});
  assert.equal(draft.objetivo,0);
});

test('B: stockPlanningEffectiveObjetivo recupera el objetivo de Planificación anual aunque weekState.objetivo sea 0 (S+1 recién creada)',()=>{
  const ctx=makeContext({annualForecast:930, objetivo:0, acumulado:0, currentWeekKey:'2026-40', activeYear:2026, activeWeek:41});
  assert.equal(ctx.stockPlanningEffectiveObjetivo(),930);
});

test('B: sin previsión anual encontrada, stockPlanningEffectiveObjetivo cae al valor guardado en weekState (compatibilidad)',()=>{
  const ctx=makeContext({annualForecast:null, objetivo:250, acumulado:0, currentWeekKey:'2026-40', activeYear:2026, activeWeek:41});
  assert.equal(ctx.stockPlanningEffectiveObjetivo(),250);
});

test('C: el objetivo efectivo que devolvería la IA para S+1 ya no es 0 cuando Planificación anual tiene previsión',()=>{
  const ctx=makeContext({annualForecast:930, objetivo:0, acumulado:120, currentWeekKey:'2026-40', activeYear:2026, activeWeek:41});
  const pendienteQueUsariaLaIA=Math.max(0, ctx.stockPlanningEffectiveObjetivo()-ctx.weekState.acumulado);
  assert.equal(pendienteQueUsariaLaIA,810); // antes del fix habría sido max(0,0-120)=0
});

test('C: openPrevisionModal y el cálculo con IA llaman a stockPlanningEffectiveObjetivo(), no a weekState.objetivo en crudo',()=>{
  const modalStart=html.indexOf('function openPrevisionModal(');
  const modalEnd=html.indexOf("document.getElementById('btnPrevision').addEventListener");
  const modalSource=html.slice(modalStart,modalEnd);
  assert.match(modalSource,/const pendiente = stockPlanningEffectiveObjetivo\(\) - weekState\.acumulado;/);
  assert.doesNotMatch(modalSource,/const pendiente = weekState\.objetivo - weekState\.acumulado;/);

  const calcStart=html.indexOf("document.getElementById('btnPrevisionCalcular').addEventListener");
  const calcWindow=html.slice(calcStart,calcStart+2000);
  assert.match(calcWindow,/const pendiente = Math\.max\(0, stockPlanningEffectiveObjetivo\(\) - weekState\.acumulado\);/);
  assert.doesNotMatch(calcWindow,/const pendiente = Math\.max\(0, weekState\.objetivo - weekState\.acumulado\);/);

  const uploadStart=html.indexOf("document.getElementById('previsionFileInput')?.addEventListener");
  const uploadWindow=html.slice(uploadStart,uploadStart+3500);
  assert.match(uploadWindow,/const pendiente = stockPlanningEffectiveObjetivo\(\) - weekState\.acumulado;/);
});

test('D: S+1 (rol "s1") nunca coincide con el guard de IA, que solo bloquea el rol "future"',()=>{
  const ctx=makeContext({currentWeekKey:'2026-40', activeYear:2026, activeWeek:41}); // S+1 real de 2026-40
  assert.equal(ctx.activeStockPlanningWeekRole(),'s1');
  const modalStart=html.indexOf('function openPrevisionModal(');
  const modalGuardWindow=html.slice(modalStart,modalStart+600);
  assert.match(modalGuardWindow,/activeStockPlanningWeekRole\(\)===['"]future['"]/);
  assert.notEqual(ctx.activeStockPlanningWeekRole(),'future');
});

test('E: S+2 sigue resolviendo a rol "future" (el guard de IA lo sigue bloqueando)',()=>{
  const ctx=makeContext({currentWeekKey:'2026-40', activeYear:2026, activeWeek:42}); // S+2 de 2026-40
  assert.equal(ctx.activeStockPlanningWeekRole(),'future');
});

test('F: el bloque de S+2+ (saldo heredar/cero, + Añadir producto, ocultar botones de IA) no fue tocado por este fix',()=>{
  assert.match(html,/role === 'future'.*Heredar saldo previsto.*Partir de 0/s);
  assert.match(html,/stockPlanInitialBalanceMode/);
  assert.match(html,/btnStockPlanAddProduct/);
  assert.match(html,/previsionBtn\.style\.display = role==='future' \? 'none' : '';/);
});

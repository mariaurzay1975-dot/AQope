(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.AquarelleStockPlanning=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PURCHASE_FIELDS=Object.freeze(['compraL','compraM','compraX','compraJ','compraV']);
  const MODES=Object.freeze(['planificacion','actual','historico']);
  const INITIAL_BALANCE_MODES=Object.freeze(['inherit','zero']);
  const DEFAULT_MODE='planificacion';
  const DEFAULT_INITIAL_BALANCE_MODE='inherit';
  const PLANNING_HORIZON_WEEKS=8;
  const PROJECTION_GUARD_LIMIT=2000;

  function cleanText(value){return String(value==null?'':value).trim();}
  function clone(value){return JSON.parse(JSON.stringify(value===undefined?null:value));}
  function finiteNumber(value,fallback=0){if(value===''||value===null||value===undefined)return fallback;const number=Number(String(value).replace(',','.'));return Number.isFinite(number)?number:fallback;}
  function nonNegativeNumber(value,fallback=0){const number=finiteNumber(value,null);return number!=null&&number>=0?number:fallback;}
  function isoNow(now){const date=now instanceof Date?now:new Date(now||Date.now());return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();}

  // ---------- Utilidades de año+semana ISO ----------
  // getISOWeek/getISOWeekRange/weekKey replican EXACTAMENTE el algoritmo ya usado en index.html
  // (getISOWeek/getISOWeekRange/weekKey/parseWeekKey) para que las claves de weekSnapshots no cambien.
  function getISOWeek(dateInput){
    let d=new Date(dateInput);
    d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
    const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
    return Math.ceil((((d-yearStart)/86400000)+1)/7);
  }
  function getISOWeekRange(year,week){
    const simple=new Date(Date.UTC(year,0,1+(week-1)*7));
    const dow=simple.getUTCDay();
    const start=new Date(simple);
    if(dow<=4) start.setUTCDate(simple.getUTCDate()-simple.getUTCDay()+1);
    else start.setUTCDate(simple.getUTCDate()+8-simple.getUTCDay());
    const end=new Date(start);
    end.setUTCDate(start.getUTCDate()+6);
    return {start,end};
  }
  function isoWeeksInYear(year){return getISOWeek(new Date(year,11,28));}
  function weekKey(year,week){return String(parseInt(year,10))+'-'+String(parseInt(week,10));}
  function parseWeekKey(key){const [year,week]=String(key||'').split('-').map(n=>parseInt(n,10));return {year,week};}
  function isoWeekInfo(dateInput=new Date()){
    const date=new Date(dateInput),utc=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())),day=utc.getUTCDay()||7;
    utc.setUTCDate(utc.getUTCDate()+4-day);
    const year=utc.getUTCFullYear(),yearStart=new Date(Date.UTC(year,0,1)),week=Math.ceil((((utc-yearStart)/86400000)+1)/7);
    return {year,week,key:weekKey(year,week)};
  }
  function shiftWeek(year,week,delta){
    const {start}=getISOWeekRange(parseInt(year,10),parseInt(week,10));
    const shifted=new Date(start);
    shifted.setUTCDate(shifted.getUTCDate()+Math.trunc(finiteNumber(delta,0))*7);
    return isoWeekInfo(shifted);
  }
  function compareWeek(year1,week1,year2,week2){
    if(year1!==year2) return year1<year2?-1:1;
    if(week1!==week2) return week1<week2?-1:1;
    return 0;
  }
  function getPlanningHorizon(year,week,count=PLANNING_HORIZON_WEEKS){
    const safeCount=Math.max(0,Math.round(finiteNumber(count,PLANNING_HORIZON_WEEKS)));
    return Array.from({length:safeCount},(_,index)=>shiftWeek(year,week,index+1));
  }

  // ---------- Modo de la semana (borrador / activa / histórica) ----------
  // Generaliza el campo `mode` que ya existe hoy en captureWeekSnapshot() (solo 'actual'/'planificacion'),
  // añadiendo 'historico'. No se crea ningún sistema paralelo.
  function normalizeMode(rawMode,legacyPlanningMode){
    const mode=cleanText(rawMode).toLowerCase();
    if(MODES.includes(mode)) return mode;
    return legacyPlanningMode===true?'planificacion':'actual';
  }
  function normalizeInitialBalanceMode(value){
    const mode=cleanText(value).toLowerCase();
    return INITIAL_BALANCE_MODES.includes(mode)?mode:DEFAULT_INITIAL_BALANCE_MODE;
  }

  // ---------- Normalización del plan semanal completo (compatibilidad con snapshots antiguos) ----------
  // Los campos de una generación anterior (campaignAdjustments/manualDailyDistribution/
  // manualForecastProducts) ya no se leen ni se escriben: si un snapshot antiguo de pruebas los
  // conserva, simplemente se ignoran (no provocan error, no se migran, no se borran a propósito).
  function normalizeStockWeekPlan(input={},options={}){
    const plan=input&&typeof input==='object'?clone(input):{};
    plan.mode=normalizeMode(plan.mode,plan.planningMode);
    plan.initialBalanceMode=normalizeInitialBalanceMode(plan.initialBalanceMode);
    return plan;
  }

  // ---------- Previsión a nivel de familia (genérico) — única fuente de verdad ----------
  // Si existe una entrada explícita en prevExpedicionProducto bajo la clave del PROPIO genérico, esa
  // es la previsión manual de la familia completa (semanas S+2 en adelante, escrita directamente en la
  // celda PREV. de la tabla agrupada — en vista agrupada `row.producto === row.generico`, así que es
  // literalmente la misma clave que ya usa esta tabla, sin inventar ninguna nueva). Si no existe, se
  // mantiene el comportamiento de siempre: sumar la previsión de cada producto/talla individual (semana
  // actual y S+1, que nunca escriben una clave a nivel de genérico). Esta MISMA función debe usarse en
  // la tabla (computed), en el movimiento de saldo (applyWeekMovement) y en el puente a Producción, para
  // que nunca haya dos interpretaciones distintas de "previsión de un genérico".
  function hasGenericoForecastOverride(plan,generico){
    return !!(plan&&typeof plan==='object'&&plan.prevExpedicionProducto&&typeof plan.prevExpedicionProducto==='object'&&Object.prototype.hasOwnProperty.call(plan.prevExpedicionProducto,generico));
  }
  function forecastForGenerico(plan,generico,productos){
    if(hasGenericoForecastOverride(plan,generico)) return Math.max(0,nonNegativeNumber(plan.prevExpedicionProducto[generico],0));
    return (productos||[]).reduce((sum,producto)=>sum+Math.max(0,nonNegativeNumber(plan?.prevExpedicionProducto?.[producto],0)),0);
  }

  // ---------- Productos añadidos a la planificación de UNA semana concreta ----------
  // No crea ninguna estructura paralela: el producto añadido es una fila normal de `data`, con sus
  // metadatos REALES (categoria/generico/producto/codeBase) tal como los entregue el catálogo — nunca
  // texto libre ni categoría inventada. Solo pertenece al plan de esa semana; no toca el catálogo.
  function addPlannedProduct(plan,input={},options={}){
    const categoria=cleanText(input.categoria),generico=cleanText(input.generico),producto=cleanText(input.producto);
    const errors=[];
    if(!generico) errors.push('Selecciona un producto real del catálogo de nomenclaturas.');
    if(!categoria) errors.push('No se ha podido determinar la categoría real del producto.');
    if(!producto) errors.push('No se ha podido determinar el identificador del producto.');
    if(errors.length) return {ok:false,errors,plan};
    const next=clone(plan);
    next.data=Array.isArray(next.data)?next.data:[];
    if(next.data.some(row=>row&&row.producto===producto)) return {ok:false,errors:['Ese producto ya está en la planificación de esta semana.'],plan};
    const row={categoria,generico,producto,saldo:0,codeBase:cleanText(input.codeBase)||producto,recapCode:cleanText(input.recapCode),addedManually:true};
    next.data=[...next.data,row];
    return {ok:true,plan:next,row};
  }
  // OJO: en la tabla agrupada, PREV. y compras se guardan bajo la clave del GENÉRICO de la fila
  // (row.producto===row.generico en una fila agrupada de una sola variante), no necesariamente bajo su
  // propio `producto`. Por eso limpia ambas claves — pero solo borra genericoData/prevExpedicionProducto
  // del genérico si ninguna otra fila restante sigue usándolo (nunca debe borrar compras/previsión de
  // un genérico compartido con otras filas reales).
  function removePlannedProduct(plan,producto){
    const next=clone(plan),key=cleanText(producto),rows=Array.isArray(next.data)?next.data:[];
    const removedRow=rows.find(row=>row&&row.producto===key&&row.addedManually);
    next.data=rows.filter(row=>!(row&&row.producto===key&&row.addedManually));
    if(next.prevExpedicionProducto&&Object.prototype.hasOwnProperty.call(next.prevExpedicionProducto,key)) delete next.prevExpedicionProducto[key];
    if(next.genericoData&&Object.prototype.hasOwnProperty.call(next.genericoData,key)) delete next.genericoData[key];
    if(removedRow&&removedRow.generico&&!next.data.some(row=>row&&row.generico===removedRow.generico)){
      const genericoKey=removedRow.generico;
      if(next.prevExpedicionProducto&&Object.prototype.hasOwnProperty.call(next.prevExpedicionProducto,genericoKey)) delete next.prevExpedicionProducto[genericoKey];
      if(next.genericoData&&Object.prototype.hasOwnProperty.call(next.genericoData,genericoKey)) delete next.genericoData[genericoKey];
    }
    return next;
  }

  // ---------- Movimiento semanal de saldo por producto (misma fórmula que buildPlanningInitialData) ----------
  // aplicaPreasignacion es la ÚNICA fuente de verdad de esta regla de negocio (qué categorías suman
  // pendientePreasignar como entrada). index.html debe delegar en esta misma función para que
  // buildPlanningInitialData() y applyWeekMovement()/projectOpeningBalance() nunca diverjan.
  function aplicaPreasignacion(categoria){
    return categoria==='ROSAS'||categoria==='SIMPLES';
  }
  function comprasTotalForGenerico(plan,generico){
    const g=plan?.genericoData?.[generico]||{};
    return PURCHASE_FIELDS.reduce((sum,field)=>sum+nonNegativeNumber(g[field],0),0);
  }
  // Solo suma pendientePreasignar cuando el plan es real (su genericoData proviene de un borrador
  // guardado). El plan sintético de buildAutomaticForecastPlan siempre tiene genericoData:{} vacío, así
  // que esta función ya devuelve 0 para él sin necesidad de una comprobación aparte — no se inventa
  // pendientePreasignar para semanas sin borrador, exactamente igual que las compras.
  function pendientePreasignarTotalForGenerico(plan,generico,categoria){
    if(!aplicaPreasignacion(categoria))return 0;
    return nonNegativeNumber(plan?.genericoData?.[generico]?.pendientePreasignar,0);
  }
  function groupRowsByGenerico(rows){
    const map=new Map();
    (rows||[]).forEach(row=>{
      if(!row||!row.producto) return;
      const list=map.get(row.generico)||[];
      list.push(row);
      map.set(row.generico,list);
    });
    return map;
  }
  function distributeAcrossRows(rows,totalEntrada){
    const weights=rows.map(row=>Math.max(finiteNumber(row.saldo,0),0)),weightTotal=weights.reduce((a,b)=>a+b,0);
    let assigned=0;
    return rows.map((row,index)=>{
      let part;
      if(index===rows.length-1) part=totalEntrada-assigned;
      else if(weightTotal>0) part=Math.round(totalEntrada*(weights[index]/weightTotal));
      else part=Math.round(totalEntrada/rows.length);
      assigned+=part;
      return part;
    });
  }
  function zeroBalances(rows){
    const result={};
    (rows||[]).forEach(row=>{ if(row&&row.producto) result[row.producto]=0; });
    return result;
  }
  function applyWeekMovement(rows,openingBalances,weekPlan){
    // OJO: el saldo de apertura se lee con finiteNumber (admite negativo = déficit real), nunca con
    // nonNegativeNumber — ese clamp solo debe aplicarse al PESO de reparto (distributeAcrossRows ya lo
    // hace con Math.max(...,0)), no al valor que se arrastra de una semana a la siguiente.
    const plan=weekPlan||{},grouped=groupRowsByGenerico(rows),nextBalances={...openingBalances};
    grouped.forEach((groupRows,generico)=>{
      const rowsWithOpeningSaldo=groupRows.map(row=>({...row,saldo:finiteNumber(openingBalances[row.producto],0)}));
      // Mismo criterio que buildPlanningInitialData(): la categoría de la primera fila del generico
      // decide si pendientePreasignar cuenta como entrada (un generico no mezcla categorías).
      const categoria=groupRows[0]?.categoria;
      const entradaFamilia=comprasTotalForGenerico(plan,generico)+pendientePreasignarTotalForGenerico(plan,generico,categoria);
      const entradaPartes=distributeAcrossRows(rowsWithOpeningSaldo,entradaFamilia);
      // Previsión: si hay override a nivel de genérico (S+2+), se reparte proporcionalmente entre las
      // tallas igual que la entrada (solo para mantener el saldo interno de cada fila coherente); si no,
      // cada fila resta exactamente su propia previsión individual, como siempre (semana actual/S+1).
      const previsionPartes=hasGenericoForecastOverride(plan,generico)
        ? distributeAcrossRows(rowsWithOpeningSaldo,forecastForGenerico(plan,generico,groupRows.map(row=>row.producto)))
        : groupRows.map(row=>Math.max(0,nonNegativeNumber(plan?.prevExpedicionProducto?.[row.producto],0)));
      groupRows.forEach((row,index)=>{
        nextBalances[row.producto]=finiteNumber(openingBalances[row.producto],0)+entradaPartes[index]-previsionPartes[index];
      });
    });
    return nextBalances;
  }
  function endingBalanceForPlan(plan){
    const rows=Array.isArray(plan?.data)?plan.data:[];
    const opening=Object.fromEntries(rows.map(row=>[row.producto,finiteNumber(row.saldo,0)]));
    return applyWeekMovement(rows,opening,plan);
  }

  // ---------- Proyección pura de saldo inicial (cadena S+1..S+N sin crear/tocar snapshots) ----------
  // buildAutomaticForecastPlan NO es un plan real ni una previsión de producto definitiva: es
  // exclusivamente una PROYECCIÓN AUTOMÁTICA de apoyo, usada única y transitoriamente dentro del bucle
  // de projectOpeningBalance para poder calcular el saldo de entrada de una semana lejana sin exigir que
  // el usuario abra las semanas intermedias. Se marca con `synthetic:true` para que quede inequívoco.
  // Nunca se persiste (projectOpeningBalance no escribe en weekSnapshots) y, en cuanto exista un
  // borrador real para esa semana (`getStoredPlan` deja de devolver null), esa semana usa SIEMPRE el
  // borrador real — buildAutomaticForecastPlan ni siquiera se invoca para ella (ver `stored||...` en
  // projectOpeningBalance). Cuando el usuario abre/crea expresamente una semana con
  // buildDraftWeekPlan(), esa función arranca con prevExpedicionProducto:{} vacío: la distribución
  // sintética que aquí se calcula sirve solo para arrastrar el SALDO agregado a través de la cadena,
  // nunca para sembrar la previsión por producto de la semana que el usuario termina abriendo.
  //
  // Reparto: se usa `total` (p.ej. de Planificación anual) sobre `distributeAcrossRows` (el mismo
  // reparto proporcional que ya usan las compras, sin duplicar una segunda fórmula), con pesos iguales
  // a la mezcla de previsión conocida del ancla (anchorForecast). Si no hay total automático
  // disponible, se sigue devolviendo null (compras 0 y previsión 0, igual que antes) — nunca se inventa
  // una previsión de la nada. pendientePreasignar nunca se inventa aquí tampoco: genericoData:{} vacío
  // hace que pendientePreasignarTotalForGenerico ya devuelva 0 para este plan sintético.
  function buildAutomaticForecastPlan(rows,anchorForecast,year,week,getAutomaticForecastTotal){
    if(typeof getAutomaticForecastTotal!=='function')return null;
    const total=nonNegativeNumber(getAutomaticForecastTotal(year,week),null);
    if(total==null)return null;
    const weightedRows=rows.map(row=>({...row,saldo:finiteNumber(anchorForecast?.[row.producto],0)}));
    const partes=distributeAcrossRows(weightedRows,total);
    const prevExpedicionProducto={};
    rows.forEach((row,index)=>{ prevExpedicionProducto[row.producto]=partes[index]; });
    return {synthetic:true,genericoData:{},prevExpedicionProducto};
  }
  function projectOpeningBalance({anchorPlan,anchorYear,anchorWeek,targetYear,targetWeek,getStoredPlan,getAutomaticForecastTotal}={}){
    const rows=Array.isArray(anchorPlan?.data)?anchorPlan.data:[];
    const anchorForecast=anchorPlan?.prevExpedicionProducto||{};
    const ay=parseInt(anchorYear,10),aw=parseInt(anchorWeek,10),ty=parseInt(targetYear,10),tw=parseInt(targetWeek,10);
    if(compareWeek(ty,tw,ay,aw)<=0){
      const opening=Object.fromEntries(rows.map(row=>[row.producto,finiteNumber(row.saldo,0)]));
      return {year:ay,week:aw,initialBalanceMode:DEFAULT_INITIAL_BALANCE_MODE,balances:opening};
    }
    let balances=endingBalanceForPlan(anchorPlan);
    let cursor=shiftWeek(ay,aw,1),guard=0;
    while(guard++<PROJECTION_GUARD_LIMIT){
      const stored=typeof getStoredPlan==='function'?getStoredPlan(cursor.year,cursor.week):null;
      const mode=stored?normalizeInitialBalanceMode(stored.initialBalanceMode):DEFAULT_INITIAL_BALANCE_MODE;
      const opening=mode==='zero'?zeroBalances(rows):balances;
      if(cursor.year===ty&&cursor.week===tw) return {year:ty,week:tw,initialBalanceMode:mode,balances:opening};
      const effectivePlan=stored||buildAutomaticForecastPlan(rows,anchorForecast,cursor.year,cursor.week,getAutomaticForecastTotal);
      balances=applyWeekMovement(rows,opening,effectivePlan);
      cursor=shiftWeek(cursor.year,cursor.week,1);
    }
    throw new Error('projectOpeningBalance: horizonte de proyección excesivo (posible bucle de semanas).');
  }

  // ---------- Construcción de un borrador nuevo (nunca se llama sola/automáticamente sobre semanas intermedias) ----------
  function buildDraftWeekPlan({year,week,rows=[],openingBalances={},initialBalanceMode=DEFAULT_INITIAL_BALANCE_MODE,now}={}){
    const data=rows.map(row=>({...clone(row),saldo:Math.round(finiteNumber(openingBalances[row.producto],0))}));
    const genericoData={};
    data.forEach(row=>{ if(!genericoData[row.generico]) genericoData[row.generico]={compraL:0,compraM:0,compraX:0,compraJ:0,compraV:0,prevExpedicion:0,pendientePreasignar:0}; });
    return normalizeStockWeekPlan({
      key:weekKey(year,week),year:parseInt(year,10),week:parseInt(week,10),
      mode:DEFAULT_MODE,initialBalanceMode,baseWeekKey:null,objetivo:0,acumulado:0,
      data,genericoData,prevExpedicionProducto:{},simplesPrea:{},forecastAdjustments:{},
      recapLoaded:false,groupView:true,updatedAt:isoNow(now)
    },{now});
  }

  // ---------- Transición explícita de estado (solo la usa el flujo de promoción real) ----------
  function promoteWeekPlans({currentActualPlan,targetPlan}){
    const previous=clone(currentActualPlan);
    previous.mode='historico';
    const next=clone(targetPlan);
    next.mode='actual';
    next.baseWeekKey=null;
    return {previous,next};
  }

  // ---------- Exclusión de borradores del histórico ----------
  // Doble barrera: (1) mode==='historico' explícito (nunca 'planificacion', sin importar el número de
  // semana); (2) opcionalmente, un guard temporal adicional (isDateClosed) como segunda protección.
  function isEligibleHistoryWeek(plan,targetYear,targetWeek,options={}){
    if(!plan) return false;
    if(plan.mode!=='historico') return false;
    if(compareWeek(plan.year,plan.week,targetYear,targetWeek)>=0) return false;
    if(typeof options.isDateClosed==='function'&&!options.isDateClosed(plan.year,plan.week)) return false;
    return true;
  }
  function filterHistoryPlans(plans,targetYear,targetWeek,options={}){
    return (Array.isArray(plans)?plans:[]).filter(plan=>isEligibleHistoryWeek(plan,targetYear,targetWeek,options));
  }

  return {
    MODES,INITIAL_BALANCE_MODES,DEFAULT_MODE,DEFAULT_INITIAL_BALANCE_MODE,PLANNING_HORIZON_WEEKS,
    getISOWeek,getISOWeekRange,isoWeeksInYear,weekKey,parseWeekKey,isoWeekInfo,shiftWeek,compareWeek,getPlanningHorizon,
    normalizeMode,normalizeInitialBalanceMode,normalizeStockWeekPlan,
    hasGenericoForecastOverride,forecastForGenerico,addPlannedProduct,removePlannedProduct,
    aplicaPreasignacion,distributeAcrossRows,applyWeekMovement,endingBalanceForPlan,zeroBalances,buildAutomaticForecastPlan,projectOpeningBalance,
    buildDraftWeekPlan,promoteWeekPlans,
    isEligibleHistoryWeek,filterHistoryPlans
  };
});

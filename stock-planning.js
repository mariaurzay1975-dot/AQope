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
  // Último campo NO VACÍO de una fila de Recap ya partida por tabulador (parts=line.split('\t')). Nunca
  // asume que el último elemento del array es válido: si el Recap deja un tabulador vacío al final de la
  // línea, parts[parts.length-1] sería '' — esto recorre desde el final hasta encontrar el primer valor
  // con contenido real, sin alterar ni recortar el array original.
  function lastNonEmptyField(parts){
    const list=Array.isArray(parts)?parts:[];
    for(let i=list.length-1;i>=0;i--){
      const value=cleanText(list[i]);
      if(value!=='') return value;
    }
    return '';
  }

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
  function clearGenericoForecastOverridesForWeek(prevExpedicionProducto,rows){
    const next={...(prevExpedicionProducto&&typeof prevExpedicionProducto==='object'?prevExpedicionProducto:{})};
    const genericos=new Set((Array.isArray(rows)?rows:[]).map(row=>cleanText(row?.generico)).filter(Boolean));
    genericos.forEach(generico=>{ delete next[generico]; });
    return next;
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

  // ---------- Refresco del saldo heredado de un borrador YA EXISTENTE (solo S+1) ----------
  // openStockPlanningWeek() crea el borrador de S+1 la PRIMERA vez con buildDraftWeekPlan(), pero si el
  // usuario vuelve a entrar más tarde el snapshot ya existe y proyectOpeningBalance() nunca se
  // recalculaba: el saldo heredado quedaba congelado aunque compras/PREV/pendientePreasignar de la
  // semana actual cambiasen después. refreshInheritedBalance() es la única pieza que corrige eso: solo
  // reescribe data[].saldo (por `producto`, la misma clave que ya usa buildDraftWeekPlan/
  // projectOpeningBalance) con el saldo recién proyectado. Todo lo demás del borrador — genericoData
  // (compras/pendientePreasignar), prevExpedicionProducto (PREV. manual de S+1), forecastAdjustments,
  // simplesPrea, initialBalanceMode, filas añadidas manualmente, etc. — se conserva íntegro. Una fila
  // cuyo producto no aparezca en openingBalances mantiene su saldo actual (nunca se inventa un 0).
  // ---------- Reconciliación de composición heredada (solo S+1) ----------
  // El Recap propio de S+1 (el mismo mecanismo de "Cargar Recap" que ya usa cualquier semana) puede
  // reemplazar su `data` libremente, y eso es correcto: cada semana tiene su propio Recap real. Pero si
  // ese Recap deja fuera una referencia que la semana actual todavía tiene con saldo final proyectado
  // distinto de 0, esa referencia no debe desaparecer sin más de S+1: hay que reincorporarla con ese
  // mismo saldo (positivo o negativo) como fila normal. reconcileMissingInheritedProducts() es la única
  // pieza que hace esto — SOLO añade filas que faltan (nunca quita ni duplica una que ya esté, nunca
  // toca el saldo de las que ya existen: eso sigue siendo trabajo exclusivo de refreshInheritedBalance,
  // que se aplica después). Reglas: (1) coincidencia EXACTA de `producto` tiene prioridad — si ya existe,
  // nunca se toca ni se duplica; (2) si no hay coincidencia exacta pero la fila candidata tiene
  // `categoria`+`codeBase` y esa MISMA familia ya está representada en `plan.data` (por otra variante,
  // con otro `producto`), la familia se considera ya cubierta y NO se añade esa variante suelta cuando
  // el destino tiene Recap propio (o es un snapshot antiguo sin marca): nunca se reintroduce una talla
  // antigua de una composición deliberada. La excepción son los borradores generados por la app con
  // `recapLoaded:false`: estos sí deben completar todas las variantes activas heredadas aunque la familia
  // ya esté parcialmente presente; (3) solo si la familia completa está ausente (o no se puede determinar
  // por falta de `codeBase` en alguno de los dos lados, en cuyo caso se sigue comparando solo por
  // `producto` exacto,
  // como siempre) se aplica la lógica de siempre: solo se considera un producto del ancla si su saldo
  // final proyectado (endingBalances) es distinto de 0, y solo se incorpora si isActiveProduct(anchorRow)
  // confirma que sigue activa — si no se puede confirmar (no encontrada) o está inactiva, NUNCA se
  // reactiva sola: se reporta en `omitted` para revisión manual, nunca en silencio y nunca añadiéndola.
  function reconcileMissingInheritedProducts(plan,endingBalances={},anchorRows=[],isActiveProduct){
    const next=clone(plan||{});
    next.data=Array.isArray(next.data)?next.data:[];
    // Los borradores futuros generados por la app deben mantener completa la composición heredada.
    // Un Recap propio, y los snapshots antiguos sin esta marca, conservan su composición deliberada.
    const preserveDestinationFamilyComposition=next.recapLoaded!==false;
    const existing=new Set(next.data.map(row=>row&&row.producto).filter(Boolean));
    const familyKeyOf=row=>(row&&row.categoria&&row.codeBase)?`${row.categoria}|${row.codeBase}`:null;
    // Familias YA representadas en destino, calculado UNA sola vez a partir de la composición original
    // (antes de añadir nada en esta misma llamada): así, si una familia entera está ausente y el ancla
    // aporta varias de sus variantes, todas siguen pudiendo incorporarse (no se bloquean entre sí).
    const existingFamilies=new Set(next.data.map(familyKeyOf).filter(Boolean));
    const added=[],omitted=[];
    (anchorRows||[]).forEach(anchorRow=>{
      if(!anchorRow||!anchorRow.producto||existing.has(anchorRow.producto)) return;
      const family=familyKeyOf(anchorRow);
      if(preserveDestinationFamilyComposition&&family&&existingFamilies.has(family)) return; // un Recap propio ya representa la familia con su composición: no reintroducir esta variante suelta
      const hasBalance=Object.prototype.hasOwnProperty.call(endingBalances,anchorRow.producto);
      const saldo=hasBalance?finiteNumber(endingBalances[anchorRow.producto],null):null;
      // En un borrador automático se sincroniza también la composición: una referencia nueva y activa
      // debe entrar aunque su saldo proyectado sea 0. Con Recap propio/estado legacy se mantiene la regla
      // histórica de reincorporar únicamente saldos distintos de 0 para respetar su composición.
      if(saldo==null||(preserveDestinationFamilyComposition&&saldo===0)) return;
      if(typeof isActiveProduct==='function'&&!isActiveProduct(anchorRow)){
        omitted.push({producto:anchorRow.producto,generico:anchorRow.generico,saldo:Math.round(saldo)});
        return;
      }
      const inheritedRow={...clone(anchorRow),saldo:Math.round(saldo)};
      if(!preserveDestinationFamilyComposition&&family&&existingFamilies.has(family)){
        // Si completamos una familia de un borrador generado, insertamos la variante junto a sus
        // hermanas. Añadirla al final separaba visualmente el producto y creaba otro encabezado de
        // categoría (p.ej. Virgo aparecía en un segundo bloque COMPUESTOS tras SIMPLES).
        let familyEnd=-1;
        next.data.forEach((row,index)=>{ if(familyKeyOf(row)===family) familyEnd=index; });
        next.data.splice(familyEnd+1,0,inheritedRow);
      } else {
        next.data=[...next.data,inheritedRow];
      }
      existing.add(anchorRow.producto);
      added.push(anchorRow.producto);
    });
    if(!preserveDestinationFamilyComposition){
      const anchorProducts=new Set((anchorRows||[]).map(row=>row?.producto).filter(Boolean));
      const anchorFamilies=new Set((anchorRows||[]).map(familyKeyOf).filter(Boolean));
      next.data=next.data.filter(row=>{
        const family=familyKeyOf(row);
        const inheritedNow=anchorProducts.has(row?.producto)||(family&&anchorFamilies.has(family));
        if(inheritedNow||row?.addedManually) return true;
        const genericValues=next.genericoData?.[row?.generico]||{};
        const hasOwnMovement=Object.values(genericValues).some(value=>finiteNumber(value,0)!==0)
          ||finiteNumber(next.prevExpedicionProducto?.[row?.producto],0)!==0
          ||finiteNumber(next.prevExpedicionProducto?.[row?.generico],0)!==0
          ||Object.prototype.hasOwnProperty.call(next.forecastAdjustments||{},row?.generico);
        return hasOwnMovement;
      });
      // La semana anterior es también la plantilla de presentación: cada familia heredada debe quedar
      // en el mismo lugar que allí, no solo dentro de la misma categoría. Esto repara igualmente los
      // snapshots ya guardados que tenían una familia completa al final. Las filas propias/manuales que
      // todavía tienen planificación se conservan y se colocan al final de su categoría.
      const identityOf=row=>{
        const family=familyKeyOf(row);
        return family?`family:${family}`:(row?.producto?`product:${row.producto}`:null);
      };
      const groups=new Map(),originalKeys=[];
      next.data.forEach(row=>{
        const key=identityOf(row);
        if(!key) return;
        if(!groups.has(key)){
          groups.set(key,{rows:[],categoria:row.categoria});
          originalKeys.push(key);
        }
        groups.get(key).rows.push(row);
      });
      const anchorKeys=[];
      (anchorRows||[]).forEach(row=>{
        const key=identityOf(row);
        if(key&&groups.has(key)&&!anchorKeys.includes(key)) anchorKeys.push(key);
      });
      const orderedKeys=[...anchorKeys];
      originalKeys.filter(key=>!anchorKeys.includes(key)).forEach(key=>{
        const originalIndex=originalKeys.indexOf(key);
        const categoria=groups.get(key).categoria;
        const nextKnown=originalKeys.slice(originalIndex+1).find(candidate=>orderedKeys.includes(candidate)&&groups.get(candidate)?.categoria===categoria);
        if(nextKnown){
          orderedKeys.splice(orderedKeys.indexOf(nextKnown),0,key);
          return;
        }
        let categoryEnd=-1;
        orderedKeys.forEach((candidate,index)=>{ if(groups.get(candidate)?.categoria===categoria) categoryEnd=index; });
        if(categoryEnd>=0) orderedKeys.splice(categoryEnd+1,0,key);
        else orderedKeys.push(key);
      });
      const ordered=orderedKeys.flatMap(key=>groups.get(key).rows);
      // Las filas sin identidad (datos legacy incompletos) nunca se pierden ni se reinterpretan.
      next.data.filter(row=>!identityOf(row)).forEach(row=>ordered.push(row));
      next.data=ordered;
    }
    return {plan:next,added,omitted};
  }

  function refreshInheritedBalance(plan,openingBalances={}){
    const next=clone(plan||{});
    next.data=(Array.isArray(next.data)?next.data:[]).map(row=>{
      if(!row||!Object.prototype.hasOwnProperty.call(openingBalances,row.producto)) return row;
      return {...row,saldo:Math.round(finiteNumber(openingBalances[row.producto],row.saldo))};
    });
    return next;
  }

  // ---------- Herencia por VARIANTE real (categoria+codeBase+variantCode) ----------
  // El nombre de `producto` puede cambiar entre Recaps de semanas distintas para la MISMA variante real
  // (mismo caso de siempre: talla 2 de una familia puede llamarse "-20-2" en una semana y "_2" en otra),
  // pero cuando el propio Recap Stock trae un código de variante real (columna `variantCode`, NUNCA
  // inferido del sufijo del nombre), esa es una identidad mucho más fiable que el reparto proporcional
  // por familia. refreshInheritedBalanceByVariant() SOLO actúa sobre lo que refreshInheritedBalance()
  // dejó sin resolver (ni el producto de destino ni el de origen coincidían exactos), y solo asigna el
  // saldo cuando hay EXACTAMENTE una variante origen y una fila destino para la misma clave
  // categoria+codeBase+variantCode — nunca adivina si hay ambigüedad (varias candidatas a la vez para la
  // misma clave): eso se deja para el fallback de familia. Filas sin `variantCode` (snapshots antiguos,
  // de antes de este cambio) simplemente no participan aquí. Devuelve también qué `producto` de destino
  // y de origen quedaron resueltos, para que el fallback de familia (refreshInheritedBalanceByFamily) los
  // excluya y nunca haya doble conteo.
  function refreshInheritedBalanceByVariant(plan,projectionRows=[],projectionBalances={}){
    const next=clone(plan||{});
    next.data=Array.isArray(next.data)?next.data:[];
    const variantKeyOf=row=>(row&&row.categoria&&row.codeBase&&row.variantCode)?`${row.categoria}|${row.codeBase}|${row.variantCode}`:null;
    const destinoProductoSet=new Set(next.data.map(row=>row&&row.producto).filter(Boolean));

    const sourceByVariant=new Map();
    (projectionRows||[]).forEach(sourceRow=>{
      if(!sourceRow||!sourceRow.producto||destinoProductoSet.has(sourceRow.producto)) return; // ya resuelto por coincidencia exacta
      if(!Object.prototype.hasOwnProperty.call(projectionBalances,sourceRow.producto)) return;
      const key=variantKeyOf(sourceRow);
      if(!key) return;
      const list=sourceByVariant.get(key)||[];
      list.push(sourceRow.producto);
      sourceByVariant.set(key,list);
    });

    const destByVariant=new Map();
    next.data.forEach(row=>{
      if(!row||!row.producto||Object.prototype.hasOwnProperty.call(projectionBalances,row.producto)) return; // ya resuelto por coincidencia exacta
      const key=variantKeyOf(row);
      if(!key) return;
      const list=destByVariant.get(key)||[];
      list.push(row);
      destByVariant.set(key,list);
    });

    const matchedDestino=[],matchedSource=[];
    destByVariant.forEach((destRows,key)=>{
      const sourceProductos=sourceByVariant.get(key);
      if(!sourceProductos||sourceProductos.length!==1||destRows.length!==1) return; // ambiguo: nunca se adivina, queda para el fallback de familia
      const saldo=finiteNumber(projectionBalances[sourceProductos[0]],null);
      if(saldo==null) return;
      const producto=destRows[0].producto;
      next.data=next.data.map(row=>row.producto===producto?{...row,saldo:Math.round(saldo)}:row);
      matchedDestino.push(producto);
      matchedSource.push(sourceProductos[0]);
    });

    return {plan:next,matchedDestino,matchedSource};
  }

  // ---------- Herencia por FAMILIA (categoria+codeBase): fallback LEGACY por residual ----------
  // Solo actúa cuando una familia NO tiene cobertura estructural completa de variantCode en ambos
  // lados (fuente y destino) — snapshots de antes de capturar variantCode, o Recaps mixtos. En vez de
  // intentar adivinar "qué filas quedan sin resolver" (eso rompía el caso real: 3 de 4 tallas de
  // Rosas-Colores ya coincidían exacto, así que la 4ª — ausente del todo en destino — nunca encontraba
  // ninguna fila "sin resolver" a la que repartirse, y esa unidad se perdía sin más), calcula el TOTAL
  // real de la familia en origen (sourceFamilyTotal, con TODAS sus variantes, resueltas o no) y el
  // total que la familia YA tiene en destino después de los pasos A (producto exacto) y B (variantCode)
  // — destinationFamilyCurrentTotal —, y reparte SOLO la diferencia (delta) entre las filas destino
  // EXISTENTES de esa familia con distributeAcrossRows. Si delta=0 (la familia ya cuadra exacta) no se
  // toca nada; si todas las filas (fuente y destino) de la familia ya tienen variantCode, tampoco se
  // toca nada — se confía en la resolución estructural del paso B, aunque quedase un residual, para no
  // corromper una coincidencia ya precisa con un reparto aproximado. Nunca añade filas nuevas (eso es
  // responsabilidad exclusiva de reconcileMissingInheritedProducts), nunca mezcla familias distintas, y
  // nunca toca nada que no sea `data[].saldo`.
  function refreshInheritedBalanceByFamily(plan,projectionRows=[],projectionBalances={}){
    const next=clone(plan||{});
    next.data=Array.isArray(next.data)?next.data:[];
    const familyKeyOf=row=>(row&&row.categoria&&row.codeBase)?`${row.categoria}|${row.codeBase}`:null;

    const sourceRowsByFamily=new Map();
    (projectionRows||[]).forEach(sourceRow=>{
      const family=familyKeyOf(sourceRow);
      if(!family||!sourceRow||!sourceRow.producto) return;
      if(!Object.prototype.hasOwnProperty.call(projectionBalances,sourceRow.producto)) return;
      const list=sourceRowsByFamily.get(family)||[];
      list.push(sourceRow);
      sourceRowsByFamily.set(family,list);
    });

    const destRowsByFamily=new Map();
    next.data.forEach(row=>{
      const family=familyKeyOf(row);
      if(!family||!row||!row.producto) return;
      const list=destRowsByFamily.get(family)||[];
      list.push(row);
      destRowsByFamily.set(family,list);
    });

    destRowsByFamily.forEach((destRows,family)=>{
      const sourceRowsFamily=sourceRowsByFamily.get(family);
      if(!sourceRowsFamily||!sourceRowsFamily.length) return; // ninguna referencia fuente de esta familia: nada que ajustar

      const coberturaVariantCodeCompleta=sourceRowsFamily.every(row=>row.variantCode)&&destRows.every(row=>row.variantCode);
      if(coberturaVariantCodeCompleta) return; // resolución estructural por variante ya definitiva: nunca se ajusta con un reparto aproximado

      const sourceFamilyTotal=sourceRowsFamily.reduce((sum,row)=>sum+finiteNumber(projectionBalances[row.producto],0),0);
      const destinationFamilyCurrentTotal=destRows.reduce((sum,row)=>sum+finiteNumber(row.saldo,0),0);
      const delta=sourceFamilyTotal-destinationFamilyCurrentTotal;
      if(delta===0) return;

      const partes=distributeAcrossRows(destRows,delta);
      const deltaByProducto={};
      destRows.forEach((row,index)=>{ deltaByProducto[row.producto]=partes[index]; });
      next.data=next.data.map(row=>
        Object.prototype.hasOwnProperty.call(deltaByProducto,row.producto)
          ?{...row,saldo:Math.round(finiteNumber(row.saldo,0)+deltaByProducto[row.producto])}
          :row
      );
    });

    return next;
  }

  // ---------- Proyección de apertura ENCADENADA (S+2 en adelante): la composición evoluciona en cada
  // salto real, en vez de quedar fijada a la del ancla (S33) durante toda la cadena ---------------------
  // projectOpeningBalance() fija `rows` a anchorPlan.data una sola vez y lo usa sin cambios en todos los
  // saltos: si una intermedia real (p.ej. S34) tiene su propia composición (productos que no existían en
  // el ancla, o que el ancla ya no tiene), esos productos nunca entran en el cálculo — ni en el
  // movimiento de esa intermedia ni en la reconciliación del destino. projectOpeningBalanceChain() existe
  // exclusivamente para resolver eso: en cada salto con snapshot real, reconcilia esa intermedia contra
  // lo heredado hasta ese punto (o la resetea a 0 si su initialBalanceMode es 'zero') y usa SU PROPIA
  // composición ya reconciliada (`runningPlan`) como base del siguiente salto. projectOpeningBalance()
  // NO se modifica: sigue siendo la proyección de un solo salto que usa S+1 (donde "el ancla" y "la
  // semana inmediatamente anterior" son la misma semana por definición, así que no hay nada que
  // evolucionar). Nunca escribe en ningún snapshot: `getStoredPlan` es un accesor de solo lectura, igual
  // que en projectOpeningBalance(); todo el recorrido de las intermedias ocurre en memoria y se descarta
  // al terminar — solo el resultado final (`balances`+`rows` de la semana destino) sale de la función.
  function projectOpeningBalanceChain({anchorPlan,anchorYear,anchorWeek,targetYear,targetWeek,getStoredPlan,getAutomaticForecastTotal,isActiveProduct}={}){
    const ay=parseInt(anchorYear,10),aw=parseInt(anchorWeek,10),ty=parseInt(targetYear,10),tw=parseInt(targetWeek,10);
    if(compareWeek(ty,tw,ay,aw)<=0){
      const rows=Array.isArray(anchorPlan?.data)?anchorPlan.data:[];
      const opening=Object.fromEntries(rows.map(row=>[row.producto,finiteNumber(row.saldo,0)]));
      return {year:ay,week:aw,initialBalanceMode:DEFAULT_INITIAL_BALANCE_MODE,balances:opening,rows,omitted:[]};
    }
    let runningPlan=anchorPlan;
    let runningBalances=endingBalanceForPlan(anchorPlan);
    const omitted=[]; // acumula lo omitido en CUALQUIER salto real de la cadena (no solo el destino final), para que quien llama pueda revisarlo todo junto
    let cursor=shiftWeek(ay,aw,1),guard=0;
    while(guard++<PROJECTION_GUARD_LIMIT){
      const isTarget=(cursor.year===ty&&cursor.week===tw);
      // Nunca se lee el propio destino: mismo patrón de autoexclusión que ya usan S+1 y "Heredar" para
      // que un initialBalanceMode/composición antiguos de ESE mismo snapshot no se autoalimenten.
      const stored=isTarget?null:(typeof getStoredPlan==='function'?getStoredPlan(cursor.year,cursor.week):null);
      const mode=stored?normalizeInitialBalanceMode(stored.initialBalanceMode):DEFAULT_INITIAL_BALANCE_MODE;
      const openingRows=(stored&&Array.isArray(stored.data)&&stored.data.length)?stored.data:runningPlan.data;
      const opening=mode==='zero'?zeroBalances(openingRows):runningBalances;
      if(isTarget) return {year:ty,week:tw,initialBalanceMode:mode,balances:opening,rows:runningPlan.data,omitted};
      if(stored){
        if(mode==='zero'){
          // El saldo inicial de esta intermedia se corta a 0, pero su propio movimiento (compras/PREV
          // desde 0) sí genera un saldo final real que puede heredarse al siguiente salto.
          const zeroed={...stored,data:(stored.data||[]).map(row=>({...row,saldo:0}))};
          runningPlan=zeroed;
          runningBalances=endingBalanceForPlan(zeroed);
        } else {
          // Reconcilia ESTA intermedia real contra lo heredado hasta aquí antes de usarla como base del
          // siguiente salto: nunca reactiva inactivos/no confirmables, nunca duplica, nunca borra sus
          // propios productos/compras/PREV (lo garantiza la secuencia exacta -> variante -> familia).
          const reconciled=reconcileMissingInheritedProducts(stored,opening,runningPlan.data,isActiveProduct);
          if(reconciled.omitted.length) omitted.push(...reconciled.omitted);
          const refreshed=refreshInheritedBalance(reconciled.plan,opening);
          const byVariant=refreshInheritedBalanceByVariant(refreshed,runningPlan.data,opening);
          const byFamily=refreshInheritedBalanceByFamily(byVariant.plan,runningPlan.data,opening);
          runningPlan=byFamily;
          runningBalances=endingBalanceForPlan(byFamily);
        }
      } else {
        // Hueco sin snapshot real: previsión automática igual que projectOpeningBalance(), pero anclada
        // a la composición MÁS RECIENTE conocida (runningPlan), no siempre a la del ancla original.
        const synthetic=buildAutomaticForecastPlan(runningPlan.data,runningPlan.prevExpedicionProducto||{},cursor.year,cursor.week,getAutomaticForecastTotal);
        runningBalances=applyWeekMovement(runningPlan.data,opening,synthetic);
      }
      cursor=shiftWeek(cursor.year,cursor.week,1);
    }
    throw new Error('projectOpeningBalanceChain: horizonte de proyección excesivo (posible bucle de semanas).');
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
    hasGenericoForecastOverride,forecastForGenerico,clearGenericoForecastOverridesForWeek,addPlannedProduct,removePlannedProduct,
    aplicaPreasignacion,distributeAcrossRows,applyWeekMovement,endingBalanceForPlan,zeroBalances,buildAutomaticForecastPlan,projectOpeningBalance,
    projectOpeningBalanceChain,
    buildDraftWeekPlan,refreshInheritedBalance,reconcileMissingInheritedProducts,
    refreshInheritedBalanceByVariant,refreshInheritedBalanceByFamily,lastNonEmptyField,
    promoteWeekPlans,
    isEligibleHistoryWeek,filterHistoryPlans
  };
});

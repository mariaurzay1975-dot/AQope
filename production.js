(function(root, factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) root.AquarelleProduction=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PRODUCT_CATEGORIES=Object.freeze([
    {code:'ROSAS',label:'Rosas'},
    {code:'COMPUESTOS',label:'Ramos compuestos'},
    {code:'SIMPLES',label:'Ramos simples'},
    {code:'PLANTAS',label:'Plantas'}
  ]);
  const WEEK_DAYS=Object.freeze([
    {code:'monday',label:'Lunes',short:'Lun'},
    {code:'tuesday',label:'Martes',short:'Mar'},
    {code:'wednesday',label:'Miércoles',short:'Mié'},
    {code:'thursday',label:'Jueves',short:'Jue'},
    {code:'friday',label:'Viernes',short:'Vie'},
    {code:'saturday',label:'Sábado',short:'Sáb'},
    {code:'sunday',label:'Domingo',short:'Dom'}
  ]);
  const TASK_PRIORITIES=Object.freeze(['Baja','Media','Alta']);
  const TASK_MOBILITIES=Object.freeze(['Fija','Flexible']);
  const CALCULATION_TYPES=Object.freeze({
    QUANTITY:'por_cantidad',
    FIXED:'tiempo_fijo',
    PERFORMANCE:'por_cantidad',
    FIXED_DURATION:'tiempo_fijo'
  });
  const WEEK_STATUSES=Object.freeze({DRAFT:'draft',VALIDATED:'validated'});
  const MAIN_TASK_DEFINITIONS=Object.freeze([
    {code:'RECEPTION',name:'Recepción',rateMode:'category'},
    {code:'PREASSIGNMENT',name:'Preasignación',rateMode:'category'},
    {code:'MANUFACTURING',name:'Fabricación',rateMode:'variant'},
    {code:'SHIPPING',name:'Expedición',rateMode:'global'}
  ]);
  const DEFAULT_SATELLITE_TASKS=Object.freeze([
    {id:'production-satellite-pot-filling',code:'POT_FILLING',name:'Relleno de pots',frequency:'Bajo demanda'},
    {id:'production-satellite-monthly-inventory',code:'MONTHLY_INVENTORY',name:'Inventario mensual',frequency:'Mensual'},
    {id:'production-satellite-cold-room-stock',code:'COLD_ROOM_REAL_STOCK',name:'Control stock real en cámara',frequency:'Diaria'},
    {id:'production-satellite-cleaning',code:'CLEANING',name:'Limpieza',frequency:'Semanal'},
    {id:'production-satellite-plant-care',code:'PLANT_CARE',name:'Cuidado de plantas',frequency:'Semanal'},
    {id:'production-satellite-forklift-maintenance',code:'FORKLIFT_MAINTENANCE',name:'Mantenimiento de toro',frequency:'Bajo demanda'}
  ]);
  const LEGACY_MAIN_CODES=new Set(MAIN_TASK_DEFINITIONS.map(task=>task.code));

  function cleanText(value){ return String(value==null?'':value).trim(); }
  function isoNow(now){
    const date=now instanceof Date?now:new Date(now||Date.now());
    return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();
  }
  function finiteNumber(value,fallback=0){
    if(value==='' || value===null || value===undefined) return fallback;
    const number=Number(String(value).replace(',','.'));
    return Number.isFinite(number)?number:fallback;
  }
  function nonNegativeNumber(value,fallback=null){
    if(value==='' || value===null || value===undefined) return fallback;
    const number=Number(String(value).replace(',','.'));
    return Number.isFinite(number) && number>=0?number:fallback;
  }
  function positiveNumber(value){
    const number=nonNegativeNumber(value,null);
    return number!==null && number>0?number:null;
  }
  function normalizeCode(value){
    return cleanText(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  }
  function createId(prefix='production'){
    if(typeof crypto!=='undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  }
  function sameValue(left,right){ return (left==null?null:left)===(right==null?null:right); }
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function normalizePriority(value){
    const text=cleanText(value).toLowerCase();
    if(text==='baja') return 'Baja';
    if(text==='alta') return 'Alta';
    return 'Media';
  }
  function normalizeMobility(value){ return cleanText(value).toLowerCase()==='fija'?'Fija':'Flexible'; }
  function validDay(value,allowAutomatic=false){
    const day=cleanText(value).toLowerCase();
    if(allowAutomatic && day==='automatic') return day;
    return WEEK_DAYS.some(item=>item.code===day)?day:'';
  }

  function emptyCategoryRates(){
    return Object.fromEntries(PRODUCT_CATEGORIES.map(category=>[category.code,{reception:null,preassignment:null}]));
  }
  function normalizeCategoryRates(input={}){
    const result=emptyCategoryRates();
    PRODUCT_CATEGORIES.forEach(category=>{
      const source=input?.[category.code] || {};
      result[category.code]={reception:positiveNumber(source.reception),preassignment:positiveNumber(source.preassignment)};
    });
    return result;
  }
  function normalizeManufacturingRates(values,count){
    const length=Math.max(1,parseInt(count,10)||1);
    return Array.from({length},(_,index)=>positiveNumber(Array.isArray(values)?values[index]:null));
  }
  function defaultMainTasks(){
    return Object.fromEntries(MAIN_TASK_DEFINITIONS.map(definition=>[definition.code,{
      code:definition.code,name:definition.name,priority:'Media',mobility:'Flexible',active:true,rateMode:definition.rateMode
    }]));
  }
  function mainTaskSource(source,code){
    if(source?.mainTasks && !Array.isArray(source.mainTasks) && source.mainTasks[code]) return source.mainTasks[code];
    const array=Array.isArray(source?.mainTasks)?source.mainTasks:Array.isArray(source?.tasks)?source.tasks:Array.isArray(source?.legacy?.mainTasks)?source.legacy.mainTasks:[];
    return array.find(task=>normalizeCode(task.code)===code) || {};
  }
  function normalizeMainTasks(source={}){
    const defaults=defaultMainTasks();
    MAIN_TASK_DEFINITIONS.forEach(definition=>{
      const input=mainTaskSource(source,definition.code);
      defaults[definition.code]={
        ...defaults[definition.code],
        name:cleanText(input.name)||definition.name,
        priority:normalizePriority(input.priority),
        mobility:normalizeMobility(input.mobility),
        active:input.active!==false
      };
    });
    return defaults;
  }
  function normalizeCalculationType(value){
    const type=cleanText(value).toLowerCase();
    return ['rendimiento','por_cantidad'].includes(type)?CALCULATION_TYPES.QUANTITY:CALCULATION_TYPES.FIXED;
  }
  function normalizeSatelliteTask(input={},options={}){
    const calculationType=normalizeCalculationType(input.calculationType);
    const legacyPeople=Math.max(1,parseInt(input.peopleCount,10)||1);
    const rawDuration=input.durationHours??input.performanceOrDuration;
    const durationHours=cleanText(input.calculationType).toLowerCase()==='duracion_personas'
      ? (positiveNumber(rawDuration)==null?null:positiveNumber(rawDuration)*legacyPeople)
      : positiveNumber(rawDuration);
    return {
      id:cleanText(input.id)||createId('production-satellite'),
      code:normalizeCode(input.code||input.name),
      name:cleanText(input.name),
      active:input.active!==false,
      calculationType,
      performance:calculationType===CALCULATION_TYPES.QUANTITY?positiveNumber(input.performance??input.performanceOrDuration):null,
      durationHours:calculationType===CALCULATION_TYPES.FIXED?durationHours:null,
      frequency:cleanText(input.frequency),
      priority:normalizePriority(input.priority),
      mobility:normalizeMobility(input.mobility),
      notes:cleanText(input.notes),
      createdAt:cleanText(input.createdAt)||isoNow(options.now),
      updatedAt:cleanText(input.updatedAt)||isoNow(options.now),
      ...(input.usageCount==null?{}:{usageCount:Math.max(0,parseInt(input.usageCount,10)||0)})
    };
  }
  function seedSatelliteTasks(now){
    return DEFAULT_SATELLITE_TASKS.map(task=>normalizeSatelliteTask({...task,active:true,calculationType:CALCULATION_TYPES.FIXED,priority:'Media',mobility:'Flexible'},{now}));
  }
  function normalizeChangeEntry(input={},options={}){
    return {
      id:cleanText(input.id)||createId('production-change'),
      scope:['main','category','shipping','task'].includes(input.scope)?input.scope:'task',
      entityKey:cleanText(input.entityKey),
      field:cleanText(input.field),
      changedAt:cleanText(input.changedAt)||isoNow(options.now),
      previousValue:input.previousValue??null,
      newValue:input.newValue??null,
      comment:cleanText(input.comment)
    };
  }

  function weeklyPlanKey(year,week){
    const normalizedYear=Math.max(2000,Math.min(2200,parseInt(year,10)||new Date().getFullYear()));
    const normalizedWeek=Math.max(1,Math.min(53,parseInt(week,10)||1));
    return `${normalizedYear}-W${String(normalizedWeek).padStart(2,'0')}`;
  }
  function isoWeekInfo(dateInput=new Date()){
    const date=new Date(dateInput);
    const utc=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
    const day=utc.getUTCDay()||7;
    utc.setUTCDate(utc.getUTCDate()+4-day);
    const year=utc.getUTCFullYear();
    const yearStart=new Date(Date.UTC(year,0,1));
    const week=Math.ceil((((utc-yearStart)/86400000)+1)/7);
    return {year,week,key:weeklyPlanKey(year,week)};
  }
  function isoWeekStart(year,week){
    const jan4=new Date(Date.UTC(year,0,4));
    const day=jan4.getUTCDay()||7;
    const monday=new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate()-(day-1)+(week-1)*7);
    return monday;
  }
  function shiftWeek(year,week,delta){
    const start=isoWeekStart(parseInt(year,10),parseInt(week,10));
    start.setUTCDate(start.getUTCDate()+(parseInt(delta,10)||0)*7);
    return isoWeekInfo(start);
  }
  function emptyDailyForecast(){
    return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,{system:null,adjustment:0}]));
  }
  function normalizeDailyForecast(input={}){
    const result=emptyDailyForecast();
    WEEK_DAYS.forEach(day=>{
      const source=Array.isArray(input)?input.find(entry=>entry.day===day.code)||{}:input?.[day.code]||{};
      result[day.code]={system:nonNegativeNumber(source.system,null),adjustment:finiteNumber(source.adjustment,0)};
    });
    return result;
  }
  function emptyCategoryMix(){
    return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,Object.fromEntries(PRODUCT_CATEGORIES.map(category=>[category.code,0]))]));
  }
  function normalizeCategoryMix(input={}){
    const result=emptyCategoryMix();
    WEEK_DAYS.forEach(day=>PRODUCT_CATEGORIES.forEach(category=>{
      result[day.code][category.code]=nonNegativeNumber(input?.[day.code]?.[category.code],0);
    }));
    return result;
  }
  function normalizeDayAssignments(input={},fallbackSameDay=false){
    return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,validDay(input?.[day.code])||(fallbackSameDay?day.code:'')]));
  }
  function normalizeVariantMix(input=[]){
    if(!Array.isArray(input)) return [];
    return input.map(entry=>({
      id:cleanText(entry.id)||createId('production-variant-mix'),
      day:validDay(entry.day),
      productKey:cleanText(entry.productKey),
      productCode:cleanText(entry.productCode),
      productName:cleanText(entry.productName),
      variantKey:cleanText(entry.variantKey),
      variantName:cleanText(entry.variantName),
      units:nonNegativeNumber(entry.units,0)
    })).filter(entry=>entry.day&&entry.variantKey&&entry.units>0);
  }
  function normalizeSatelliteAssignments(input=[]){
    if(!Array.isArray(input)) return [];
    const seen=new Set();
    return input.map(entry=>({
      taskId:cleanText(entry.taskId),
      day:validDay(entry.day,true),
      quantity:nonNegativeNumber(entry.quantity,null)
    })).filter(entry=>entry.taskId&&!seen.has(entry.taskId)&&seen.add(entry.taskId));
  }
  function createWeeklyPlan(year,week,options={}){
    const key=weeklyPlanKey(year,week);
    const [safeYear,safeWeek]=key.replace('-W','-').split('-').map(Number);
    return {
      key,year:safeYear,week:safeWeek,status:WEEK_STATUSES.DRAFT,
      dailyForecast:emptyDailyForecast(),
      bouquetSystem:null,bouquetAdjustment:0,
      categoryMix:emptyCategoryMix(),variantMix:[],
      preassignmentDays:normalizeDayAssignments({},true),
      receptionDays:normalizeDayAssignments({},false),
      satelliteAssignments:[],
      updatedAt:isoNow(options.now),validatedAt:null
    };
  }
  function normalizeWeeklyPlan(input={},options={}){
    const fallback=createWeeklyPlan(input.year,input.week,options);
    const key=weeklyPlanKey(input.year??fallback.year,input.week??fallback.week);
    const [year,week]=key.replace('-W','-').split('-').map(Number);
    return {
      key,year,week,status:input.status===WEEK_STATUSES.VALIDATED?WEEK_STATUSES.VALIDATED:WEEK_STATUSES.DRAFT,
      dailyForecast:normalizeDailyForecast(input.dailyForecast),
      bouquetSystem:nonNegativeNumber(input.bouquetSystem,null),
      bouquetAdjustment:finiteNumber(input.bouquetAdjustment,0),
      categoryMix:normalizeCategoryMix(input.categoryMix),
      variantMix:normalizeVariantMix(input.variantMix),
      preassignmentDays:normalizeDayAssignments(input.preassignmentDays,true),
      receptionDays:normalizeDayAssignments(input.receptionDays,false),
      satelliteAssignments:normalizeSatelliteAssignments(input.satelliteAssignments),
      updatedAt:cleanText(input.updatedAt)||isoNow(options.now),
      validatedAt:input.status===WEEK_STATUSES.VALIDATED?(cleanText(input.validatedAt)||cleanText(input.updatedAt)||isoNow(options.now)):null
    };
  }
  function normalizeWeeklyPlans(input={},options={}){
    if(!input || typeof input!=='object') return {};
    const result={};
    Object.values(input).forEach(plan=>{ const normalized=normalizeWeeklyPlan(plan,options); result[normalized.key]=normalized; });
    return result;
  }
  function legacyMainTasks(source){
    const direct=Array.isArray(source?.legacy?.mainTasks)?source.legacy.mainTasks:[];
    const fromV1=Array.isArray(source?.tasks)?source.tasks.filter(task=>task.type==='principal'||LEGACY_MAIN_CODES.has(normalizeCode(task.code))):[];
    return clone(direct.length?direct:fromV1);
  }
  function legacyTimeHistory(source){
    const direct=Array.isArray(source?.legacy?.timeHistory)?source.legacy.timeHistory:[];
    return clone(direct.length?direct:(Array.isArray(source?.timeHistory)?source.timeHistory:[]));
  }
  function legacyShippingRate(source){
    const shipping=(Array.isArray(source?.tasks)?source.tasks:[]).find(task=>normalizeCode(task.code)==='SHIPPING');
    return positiveNumber(shipping?.performance);
  }

  function createProductionState(input,options={}){
    const source=input && typeof input==='object'?input:{};
    const hasNewTasks=Array.isArray(source.satelliteTasks);
    const hasOldTasks=Array.isArray(source.tasks);
    let taskSource;
    if(hasNewTasks) taskSource=source.satelliteTasks;
    else if(hasOldTasks) taskSource=source.tasks.filter(task=>task.type==='satelite'||!LEGACY_MAIN_CODES.has(normalizeCode(task.code)));
    else taskSource=seedSatelliteTasks(options.now);
    const ids=new Set();
    const satelliteTasks=taskSource.map(task=>normalizeSatelliteTask(task,options)).filter(task=>task.id&&task.code&&!ids.has(task.id)&&ids.add(task.id));
    const oldMainTasks=legacyMainTasks(source);
    const oldHistory=legacyTimeHistory(source);
    const state={
      version:3,
      mainTasks:normalizeMainTasks(source),
      categoryRates:normalizeCategoryRates(source.categoryRates),
      shippingRate:positiveNumber(source.shippingRate)??legacyShippingRate(source),
      satelliteTasks,
      weeklyPlans:normalizeWeeklyPlans(source.weeklyPlans,options),
      changeHistory:Array.isArray(source.changeHistory)?source.changeHistory.map(entry=>normalizeChangeEntry(entry,options)):[],
      updatedAt:cleanText(source.updatedAt)||isoNow(options.now)
    };
    if(oldMainTasks.length||oldHistory.length) state.legacy={mainTasks:oldMainTasks,timeHistory:oldHistory};
    return state;
  }

  function validateSatelliteTask(task,allTasks=[],ignoreId=''){
    const errors=[];
    if(!task.name) errors.push('El nombre es obligatorio.');
    if(!task.code) errors.push('El código estable es obligatorio.');
    if(allTasks.some(other=>other.id!==ignoreId&&other.code===task.code)) errors.push('El código estable ya existe.');
    if(task.calculationType===CALCULATION_TYPES.QUANTITY&&task.performance==null) errors.push('Indica un rendimiento mayor que cero.');
    if(task.calculationType===CALCULATION_TYPES.FIXED&&task.durationHours==null) errors.push('Indica las horas-persona de la tarea.');
    return errors;
  }
  function appendChange(state,input,options={}){
    const entry=normalizeChangeEntry(input,options);
    return {...state,changeHistory:[...state.changeHistory,entry],updatedAt:entry.changedAt};
  }
  function updateMainTask(stateInput,taskCode,patch={},options={}){
    let state=createProductionState(stateInput,options);
    const code=normalizeCode(taskCode);
    const previous=state.mainTasks[code];
    if(!previous) return {ok:false,errors:['La tarea principal no existe.'],state};
    const next={...previous,name:cleanText(patch.name)||previous.name,priority:normalizePriority(patch.priority),mobility:normalizeMobility(patch.mobility),active:patch.active!==false};
    state={...state,mainTasks:{...state.mainTasks,[code]:next}};
    ['name','priority','mobility','active'].forEach(field=>{
      if(!sameValue(previous[field],next[field])) state=appendChange(state,{scope:'main',entityKey:code,field,previousValue:previous[field],newValue:next[field],comment:options.comment},options);
    });
    return {ok:true,changed:JSON.stringify(previous)!==JSON.stringify(next),task:next,state};
  }
  function updateCategoryRate(stateInput,categoryCode,operation,value,options={}){
    const state=createProductionState(stateInput,options);
    const code=normalizeCode(categoryCode);
    if(!PRODUCT_CATEGORIES.some(category=>category.code===code)) return {ok:false,errors:['La categoría de producto no existe.'],state};
    if(!['reception','preassignment'].includes(operation)) return {ok:false,errors:['La operación no es válida.'],state};
    const raw=cleanText(value);
    const next=positiveNumber(value);
    if(raw && next==null) return {ok:false,errors:['El rendimiento debe ser un número mayor que cero.'],state};
    const previous=state.categoryRates[code][operation];
    if(sameValue(previous,next)) return {ok:true,changed:false,state};
    const categoryRates={...state.categoryRates,[code]:{...state.categoryRates[code],[operation]:next}};
    return {ok:true,changed:true,state:appendChange({...state,categoryRates},{scope:'category',entityKey:code,field:operation,previousValue:previous,newValue:next,comment:options.comment},options)};
  }
  function updateShippingRate(stateInput,value,options={}){
    const state=createProductionState(stateInput,options);
    const raw=cleanText(value);
    const next=positiveNumber(value);
    if(raw && next==null) return {ok:false,errors:['El rendimiento debe ser un número mayor que cero.'],state};
    if(sameValue(state.shippingRate,next)) return {ok:true,changed:false,state};
    return {ok:true,changed:true,state:appendChange({...state,shippingRate:next},{scope:'shipping',entityKey:'SHIPPING',field:'performance',previousValue:state.shippingRate,newValue:next,comment:options.comment},options)};
  }
  function taskTimingText(task){
    if(task.calculationType===CALCULATION_TYPES.QUANTITY) return task.performance==null?'':`${task.performance} uds/h/persona`;
    return task.durationHours==null?'':`${task.durationHours} h-persona`;
  }
  function addProductionTask(stateInput,input,options={}){
    const state=createProductionState(stateInput,options);
    const task=normalizeSatelliteTask(input,{now:options.now});
    const errors=validateSatelliteTask(task,state.satelliteTasks);
    if(errors.length) return {ok:false,errors,state};
    return {ok:true,task,state:{...state,satelliteTasks:[...state.satelliteTasks,task],updatedAt:isoNow(options.now)}};
  }
  function updateProductionTask(stateInput,taskId,patch={},options={}){
    const state=createProductionState(stateInput,options);
    const index=state.satelliteTasks.findIndex(task=>task.id===taskId);
    if(index<0) return {ok:false,errors:['La tarea no existe.'],state};
    const previous=state.satelliteTasks[index];
    const next=normalizeSatelliteTask({...previous,...patch,id:previous.id,code:previous.code,createdAt:previous.createdAt,updatedAt:isoNow(options.now)},{now:options.now});
    const errors=validateSatelliteTask(next,state.satelliteTasks,taskId);
    if(errors.length) return {ok:false,errors,state};
    const tasks=state.satelliteTasks.slice();
    tasks[index]=next;
    let updated={...state,satelliteTasks:tasks,updatedAt:isoNow(options.now)};
    ['name','active','calculationType','performance','durationHours','frequency','priority','mobility','notes'].forEach(field=>{
      if(!sameValue(previous[field],next[field])) updated=appendChange(updated,{scope:'task',entityKey:taskId,field,previousValue:previous[field],newValue:next[field],comment:options.comment},options);
    });
    return {ok:true,task:next,state:updated};
  }
  function deactivateProductionTask(stateInput,taskId,options={}){ return updateProductionTask(stateInput,taskId,{active:false},options); }
  function deleteProductionTask(stateInput,taskId,options={}){
    const state=createProductionState(stateInput,options);
    const task=state.satelliteTasks.find(item=>item.id===taskId);
    if(!task) return {ok:false,errors:['La tarea no existe.'],state};
    const used=Object.values(state.weeklyPlans).some(plan=>plan.satelliteAssignments.some(item=>item.taskId===taskId));
    if(used||state.changeHistory.some(entry=>entry.scope==='task'&&entry.entityKey===taskId)||(task.usageCount||0)>0){
      return {ok:false,errors:['La tarea tiene modificaciones o uso registrado; desactívala en lugar de eliminarla.'],state};
    }
    return {ok:true,state:{...state,satelliteTasks:state.satelliteTasks.filter(item=>item.id!==taskId),updatedAt:isoNow(options.now)}};
  }
  function calculateTaskPersonHours(taskInput,workload=1){
    const task=normalizeSatelliteTask(taskInput);
    if(task.calculationType===CALCULATION_TYPES.QUANTITY){
      const amount=nonNegativeNumber(workload,null);
      return amount==null||task.performance==null?null:amount/task.performance;
    }
    return task.durationHours;
  }
  function manufacturingTaskDescriptor(){
    return Object.freeze({code:'MANUFACTURING',name:'Fabricación',calculationType:CALCULATION_TYPES.QUANTITY,unit:'unidades / hora / persona',source:'nomenclatures',editable:false});
  }

  function forecastUsed(entry={}){ return Math.max(0,(nonNegativeNumber(entry.system,0)||0)+finiteNumber(entry.adjustment,0)); }
  function bouquetTotal(plan){
    const system=plan.bouquetSystem==null?WEEK_DAYS.reduce((sum,day)=>sum+forecastUsed(plan.dailyForecast[day.code]),0):plan.bouquetSystem;
    return Math.max(0,system+finiteNumber(plan.bouquetAdjustment,0));
  }
  function variantRate(variantRates,key){
    if(variantRates instanceof Map) return positiveNumber(variantRates.get(key));
    return positiveNumber(variantRates?.[key]);
  }
  function calculateWeeklyPlan(planInput,stateInput,options={}){
    const state=createProductionState(stateInput);
    const plan=normalizeWeeklyPlan(planInput);
    const days=Object.fromEntries(WEEK_DAYS.map(day=>[day.code,{reception:0,preassignment:0,manufacturing:0,shipping:0,satellite:0,total:0}]));
    const issues=[];
    const issueKeys=new Set();
    const addIssue=(code,message,context={})=>{ const key=JSON.stringify([code,message,context]); if(!issueKeys.has(key)){issueKeys.add(key);issues.push({code,message,...context});} };
    const receptionActive=state.mainTasks.RECEPTION.active;
    const preassignmentActive=state.mainTasks.PREASSIGNMENT.active;
    const forecastTotal=WEEK_DAYS.reduce((sum,day)=>sum+forecastUsed(plan.dailyForecast[day.code]),0);
    const categoryUnits=WEEK_DAYS.reduce((sum,day)=>sum+Object.values(plan.categoryMix[day.code]).reduce((daySum,value)=>daySum+value,0),0);
    if(forecastTotal>0&&categoryUnits===0) addIssue('CATEGORY_MIX_MISSING','Falta la composición prevista por categoría; Recepción, Preasignación y Fabricación no pueden calcularse completamente.');
    else if(forecastTotal>0&&Math.abs(categoryUnits-forecastTotal)>0.001) addIssue('CATEGORY_MIX_MISMATCH','El total del mix por categoría no coincide con la previsión utilizada.');
    WEEK_DAYS.forEach(sourceDay=>{
      PRODUCT_CATEGORIES.forEach(category=>{
        const units=nonNegativeNumber(plan.categoryMix[sourceDay.code][category.code],0);
        if(!units) return;
        if(receptionActive){
          const target=plan.receptionDays[sourceDay.code];
          const rate=state.categoryRates[category.code].reception;
          if(!target) addIssue('RECEPTION_DAY_MISSING',`Falta el día de Recepción para ${sourceDay.label}.`,{day:sourceDay.code,category:category.code});
          else if(rate==null) addIssue('RECEPTION_RATE_MISSING',`Falta el rendimiento de Recepción para ${category.label}.`,{day:sourceDay.code,category:category.code});
          else days[target].reception+=units/rate;
        }
        if(preassignmentActive){
          const target=plan.preassignmentDays[sourceDay.code];
          const rate=state.categoryRates[category.code].preassignment;
          if(rate==null) addIssue('PREASSIGNMENT_RATE_MISSING',`Falta el rendimiento de Preasignación para ${category.label}.`,{day:sourceDay.code,category:category.code});
          else days[target].preassignment+=units/rate;
        }
      });
    });
    if(state.mainTasks.MANUFACTURING.active){
      plan.variantMix.forEach(entry=>{
        const rate=variantRate(options.variantRates,entry.variantKey);
        if(rate==null) addIssue('MANUFACTURING_RATE_MISSING',`Falta el rendimiento de Fabricación de ${entry.productName||entry.productCode||entry.variantKey} ${entry.variantName||''}.`.trim(),{day:entry.day,variantKey:entry.variantKey});
        else days[entry.day].manufacturing+=entry.units/rate;
      });
      if(categoryUnits>0&&!plan.variantMix.length) addIssue('VARIANT_MIX_MISSING','La carga de Fabricación está incompleta: falta el desglose previsto por producto y variante.');
    }
    if(state.mainTasks.SHIPPING.active){
      WEEK_DAYS.forEach(day=>{
        const units=forecastUsed(plan.dailyForecast[day.code]);
        if(units>0&&state.shippingRate==null) addIssue('SHIPPING_RATE_MISSING','Falta el rendimiento global de Expedición.');
        else if(state.shippingRate) days[day.code].shipping=units/state.shippingRate;
      });
    }
    let unassignedSatelliteHours=0;
    plan.satelliteAssignments.forEach(assignment=>{
      const task=state.satelliteTasks.find(item=>item.id===assignment.taskId);
      if(!task){ addIssue('SATELLITE_TASK_MISSING','Una tarea satélite seleccionada ya no existe.',{taskId:assignment.taskId}); return; }
      if(!task.active) addIssue('SATELLITE_TASK_INACTIVE',`${task.name} está inactiva pero sigue seleccionada.`,{taskId:task.id});
      const hours=calculateTaskPersonHours(task,assignment.quantity);
      if(hours==null){ addIssue('SATELLITE_VALUE_MISSING',`Faltan datos para calcular ${task.name}.`,{taskId:task.id}); return; }
      if(!assignment.day){
        unassignedSatelliteHours+=hours;
        addIssue('SATELLITE_DAY_MISSING',`Falta asignar el día de ${task.name}.`,{taskId:task.id});
      } else if(assignment.day==='automatic'){
        unassignedSatelliteHours+=hours;
        addIssue('SATELLITE_DAY_AUTOMATIC',`${task.name} está pendiente de asignación automática.`,{taskId:task.id});
      } else days[assignment.day].satellite+=hours;
    });
    WEEK_DAYS.forEach(day=>{
      const row=days[day.code];
      row.total=row.reception+row.preassignment+row.manufacturing+row.shipping+row.satellite;
    });
    const weekly={reception:0,preassignment:0,manufacturing:0,shipping:0,satellite:unassignedSatelliteHours,total:0};
    WEEK_DAYS.forEach(day=>Object.keys(weekly).filter(key=>key!=='total').forEach(key=>{ weekly[key]+=days[day.code][key]; }));
    weekly.total=weekly.reception+weekly.preassignment+weekly.manufacturing+weekly.shipping+weekly.satellite;
    return {
      plan,days,weekly,
      forecastTotal,
      bouquetTotal:bouquetTotal(plan),
      unassignedSatelliteHours,
      issues,incomplete:issues.some(issue=>issue.code.endsWith('_MISSING'))
    };
  }
  function saveWeeklyPlan(stateInput,planInput,options={}){
    const state=createProductionState(stateInput,options);
    const plan=normalizeWeeklyPlan({...planInput,updatedAt:isoNow(options.now)},options);
    return {ok:true,plan,state:{...state,weeklyPlans:{...state.weeklyPlans,[plan.key]:plan},updatedAt:plan.updatedAt}};
  }
  function validateWeeklyPlan(stateInput,planInput,options={}){
    const calculated=calculateWeeklyPlan(planInput,stateInput,options);
    if(calculated.incomplete) return {ok:false,errors:['La semana tiene datos incompletos y no puede validarse.'],calculated,state:createProductionState(stateInput)};
    const now=isoNow(options.now);
    return saveWeeklyPlan(stateInput,{...calculated.plan,status:WEEK_STATUSES.VALIDATED,validatedAt:now,updatedAt:now},{...options,now});
  }
  function weeklyPlanFor(stateInput,year,week,options={}){
    const state=createProductionState(stateInput,options);
    const key=weeklyPlanKey(year,week);
    return state.weeklyPlans[key]?normalizeWeeklyPlan(state.weeklyPlans[key],options):createWeeklyPlan(year,week,options);
  }
  function summarizeProductionState(stateInput){
    const state=createProductionState(stateInput);
    const configuredCategoryRates=PRODUCT_CATEGORIES.reduce((count,category)=>count+(state.categoryRates[category.code].reception!=null?1:0)+(state.categoryRates[category.code].preassignment!=null?1:0),0);
    return {
      mainActive:Object.values(state.mainTasks).filter(task=>task.active).length,
      satellite:state.satelliteTasks.length,
      activeSatellite:state.satelliteTasks.filter(task=>task.active).length,
      configuredCategoryRates,
      shippingConfigured:state.shippingRate!=null,
      weeklyPlans:Object.keys(state.weeklyPlans).length,
      validatedWeeks:Object.values(state.weeklyPlans).filter(plan=>plan.status===WEEK_STATUSES.VALIDATED).length,
      changes:state.changeHistory.length
    };
  }

  return {
    PRODUCT_CATEGORIES,WEEK_DAYS,TASK_PRIORITIES,TASK_MOBILITIES,CALCULATION_TYPES,WEEK_STATUSES,MAIN_TASK_DEFINITIONS,DEFAULT_SATELLITE_TASKS,
    createProductionState,normalizeMainTasks,normalizeSatelliteTask,normalizeChangeEntry,normalizeManufacturingRates,normalizeWeeklyPlan,normalizeCode,
    weeklyPlanKey,isoWeekInfo,shiftWeek,createWeeklyPlan,weeklyPlanFor,saveWeeklyPlan,validateWeeklyPlan,forecastUsed,calculateWeeklyPlan,
    updateMainTask,updateCategoryRate,updateShippingRate,addProductionTask,updateProductionTask,deactivateProductionTask,deleteProductionTask,
    calculateTaskPersonHours,taskTimingText,manufacturingTaskDescriptor,summarizeProductionState
  };
});

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
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
  const TASK_TYPES=Object.freeze({MAIN:'principal',SATELLITE:'satelite'});
  const TASK_PRIORITIES=Object.freeze(['Baja','Media','Alta']);
  const TASK_MOBILITIES=Object.freeze(['Fija','Flexible']);
  const CALCULATION_TYPES=Object.freeze({QUANTITY:'por_cantidad',FIXED:'tiempo_fijo',SPECIAL:'especial',PERFORMANCE:'por_cantidad',FIXED_DURATION:'tiempo_fijo'});
  const WEEK_STATUSES=Object.freeze({DRAFT:'draft',VALIDATED:'validated'});
  const SPECIAL_TASK_DEFINITIONS=Object.freeze([
    {id:'production-main-reception',code:'RECEPTION',name:'Recepción',specialKind:'reception',rateMode:'category'},
    {id:'production-main-preassignment',code:'PREASSIGNMENT',name:'Preasignación',specialKind:'preassignment',rateMode:'category'},
    {id:'production-main-manufacturing',code:'MANUFACTURING',name:'Fabricación',specialKind:'manufacturing',rateMode:'variant'},
    {id:'production-main-shipping',code:'SHIPPING',name:'Expedición',specialKind:'shipping',rateMode:'global'}
  ]);
  const MAIN_TASK_DEFINITIONS=SPECIAL_TASK_DEFINITIONS;
  const DEFAULT_SATELLITE_TASKS=Object.freeze([
    {id:'production-satellite-pot-filling',code:'POT_FILLING',name:'Relleno de pots',frequency:'Bajo demanda'},
    {id:'production-satellite-monthly-inventory',code:'MONTHLY_INVENTORY',name:'Inventario mensual',frequency:'Mensual'},
    {id:'production-satellite-cold-room-stock',code:'COLD_ROOM_REAL_STOCK',name:'Control stock real en cámara',frequency:'Diaria'},
    {id:'production-satellite-cleaning',code:'CLEANING',name:'Limpieza',frequency:'Semanal'},
    {id:'production-satellite-plant-care',code:'PLANT_CARE',name:'Cuidado de plantas',frequency:'Semanal'},
    {id:'production-satellite-forklift-maintenance',code:'FORKLIFT_MAINTENANCE',name:'Mantenimiento de toro',frequency:'Bajo demanda'}
  ]);
  const DEFAULT_DISTRIBUTION_SETTINGS=Object.freeze({recentWeights:[40,30,20,10],recentShare:70,comparableShare:30,maxRecentWeeks:4});
  const SPECIAL_BY_CODE=new Map(SPECIAL_TASK_DEFINITIONS.map(task=>[task.code,task]));

  function cleanText(value){return String(value==null?'':value).trim();}
  function isoNow(now){const date=now instanceof Date?now:new Date(now||Date.now());return Number.isNaN(date.getTime())?new Date().toISOString():date.toISOString();}
  function finiteNumber(value,fallback=0){if(value===''||value===null||value===undefined)return fallback;const number=Number(String(value).replace(',','.'));return Number.isFinite(number)?number:fallback;}
  function nonNegativeNumber(value,fallback=null){if(value===''||value===null||value===undefined)return fallback;const number=Number(String(value).replace(',','.'));return Number.isFinite(number)&&number>=0?number:fallback;}
  function positiveNumber(value){const number=nonNegativeNumber(value,null);return number!==null&&number>0?number:null;}
  function normalizeCode(value){return cleanText(value).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'');}
  function normalizeName(value){return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function createId(prefix='production'){if(typeof crypto!=='undefined'&&crypto.randomUUID)return `${prefix}-${crypto.randomUUID()}`;return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function sameValue(left,right){return (left==null?null:left)===(right==null?null:right);}
  function normalizePriority(value){const text=normalizeName(value);return text==='baja'?'Baja':text==='alta'?'Alta':'Media';}
  function normalizeMobility(value){return normalizeName(value)==='fija'?'Fija':'Flexible';}
  function normalizeTaskType(value){return normalizeName(value)==='principal'?TASK_TYPES.MAIN:TASK_TYPES.SATELLITE;}
  function normalizeCalculationType(value){return ['rendimiento','por_cantidad'].includes(normalizeName(value))?CALCULATION_TYPES.QUANTITY:CALCULATION_TYPES.FIXED;}
  function validDay(value,allowAutomatic=false){const day=cleanText(value).toLowerCase();if(allowAutomatic&&day==='automatic')return day;return WEEK_DAYS.some(item=>item.code===day)?day:'';}
  function emptyDayValues(value=0){return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,value]));}
  function emptyCategoryRates(){return Object.fromEntries(PRODUCT_CATEGORIES.map(category=>[category.code,{reception:null,preassignment:null}]));}
  function normalizeCategoryRates(input={}){const result=emptyCategoryRates();PRODUCT_CATEGORIES.forEach(category=>{const source=input?.[category.code]||{};result[category.code]={reception:positiveNumber(source.reception),preassignment:positiveNumber(source.preassignment)};});return result;}
  function normalizeManufacturingRates(values,count){const length=Math.max(1,parseInt(count,10)||1);return Array.from({length},(_,index)=>positiveNumber(Array.isArray(values)?values[index]:null));}

  function specialDefinition(input={}){return SPECIAL_BY_CODE.get(normalizeCode(input.code||input.specialKind||input.name))||SPECIAL_TASK_DEFINITIONS.find(item=>item.specialKind===cleanText(input.specialKind).toLowerCase())||null;}
  function normalizeTask(input={},options={}){
    const special=specialDefinition(input);
    const calculationType=special?CALCULATION_TYPES.SPECIAL:normalizeCalculationType(input.calculationType);
    const legacyPeople=Math.max(1,parseInt(input.peopleCount,10)||1);
    const rawDuration=input.durationHours??input.performanceOrDuration;
    const duration=normalizeName(input.calculationType)==='duracion_personas'&&positiveNumber(rawDuration)!=null?positiveNumber(rawDuration)*legacyPeople:positiveNumber(rawDuration);
    const name=cleanText(input.name)||special?.name||'';
    return {
      id:cleanText(input.id)||special?.id||createId('production-task'),
      code:normalizeCode(input.code||special?.code||name),
      name,
      type:normalizeTaskType(input.type??(special?TASK_TYPES.MAIN:TASK_TYPES.SATELLITE)),
      specialKind:special?.specialKind||'',
      rateMode:special?.rateMode||'',
      active:input.active!==false,
      calculationType,
      performance:calculationType===CALCULATION_TYPES.QUANTITY?positiveNumber(input.performance??input.performanceOrDuration):null,
      durationHours:calculationType===CALCULATION_TYPES.FIXED?duration:null,
      frequency:cleanText(input.frequency),
      priority:normalizePriority(input.priority),
      mobility:normalizeMobility(input.mobility),
      notes:cleanText(input.notes),
      createdAt:cleanText(input.createdAt)||isoNow(options.now),
      updatedAt:cleanText(input.updatedAt)||isoNow(options.now),
      ...(input.usageCount==null?{}:{usageCount:Math.max(0,parseInt(input.usageCount,10)||0)})
    };
  }
  function seedTasks(now){return [
    ...SPECIAL_TASK_DEFINITIONS.map(task=>normalizeTask({...task,type:TASK_TYPES.MAIN,active:true,priority:'Media',mobility:'Flexible'},{now})),
    ...DEFAULT_SATELLITE_TASKS.map(task=>normalizeTask({...task,type:TASK_TYPES.SATELLITE,active:true,calculationType:CALCULATION_TYPES.FIXED,priority:'Media',mobility:'Flexible'},{now}))
  ];}
  function migrateTasks(source={},options={}){
    if(Array.isArray(source.tasks)&&Number(source.version)>=4) return source.tasks.map(task=>normalizeTask(task,options));
    const result=[];
    SPECIAL_TASK_DEFINITIONS.forEach(definition=>{
      const objectSource=source.mainTasks&&!Array.isArray(source.mainTasks)?source.mainTasks[definition.code]:null;
      const arraySource=(Array.isArray(source.mainTasks)?source.mainTasks:[]).find(task=>normalizeCode(task.code)===definition.code);
      const legacySource=(Array.isArray(source.tasks)?source.tasks:[]).find(task=>normalizeCode(task.code)===definition.code);
      result.push(normalizeTask({...definition,...(objectSource||arraySource||legacySource||{}),id:definition.id,type:TASK_TYPES.MAIN},options));
    });
    let general=[];
    if(Array.isArray(source.satelliteTasks)) general=source.satelliteTasks;
    else if(Array.isArray(source.tasks)) general=source.tasks.filter(task=>!SPECIAL_BY_CODE.has(normalizeCode(task.code)));
    else general=DEFAULT_SATELLITE_TASKS.map(task=>({...task,type:TASK_TYPES.SATELLITE,calculationType:CALCULATION_TYPES.FIXED,active:true}));
    general.forEach(task=>result.push(normalizeTask({...task,type:task.type||TASK_TYPES.SATELLITE},options)));
    return result;
  }
  function deduplicateTasks(tasks){const ids=new Set(),codes=new Set();return tasks.filter(task=>task.id&&task.code&&!ids.has(task.id)&&!codes.has(task.code)&&ids.add(task.id)&&codes.add(task.code));}
  function ensureSpecialTasks(tasks,options={}){const result=tasks.slice();SPECIAL_TASK_DEFINITIONS.forEach(definition=>{if(!result.some(task=>task.code===definition.code))result.unshift(normalizeTask({...definition,type:TASK_TYPES.MAIN,active:true},options));});return result;}
  function normalizeChangeEntry(input={},options={}){return {id:cleanText(input.id)||createId('production-change'),scope:'task',entityKey:cleanText(input.entityKey),field:cleanText(input.field),changedAt:cleanText(input.changedAt)||isoNow(options.now),previousValue:input.previousValue??null,newValue:input.newValue??null,comment:cleanText(input.comment)};}

  function weeklyPlanKey(year,week){const normalizedYear=Math.max(2000,Math.min(2200,parseInt(year,10)||new Date().getFullYear()));const normalizedWeek=Math.max(1,Math.min(53,parseInt(week,10)||1));return `${normalizedYear}-W${String(normalizedWeek).padStart(2,'0')}`;}
  function isoWeekInfo(dateInput=new Date()){const date=new Date(dateInput),utc=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())),day=utc.getUTCDay()||7;utc.setUTCDate(utc.getUTCDate()+4-day);const year=utc.getUTCFullYear(),yearStart=new Date(Date.UTC(year,0,1)),week=Math.ceil((((utc-yearStart)/86400000)+1)/7);return {year,week,key:weeklyPlanKey(year,week)};}
  function isoWeekStart(year,week){const jan4=new Date(Date.UTC(year,0,4)),day=jan4.getUTCDay()||7,monday=new Date(jan4);monday.setUTCDate(jan4.getUTCDate()-(day-1)+(week-1)*7);return monday;}
  function shiftWeek(year,week,delta){const start=isoWeekStart(parseInt(year,10),parseInt(week,10));start.setUTCDate(start.getUTCDate()+(parseInt(delta,10)||0)*7);return isoWeekInfo(start);}
  function emptyCategoryMix(){return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,Object.fromEntries(PRODUCT_CATEGORIES.map(category=>[category.code,0]))]));}
  function normalizeCategoryMix(input={}){const result=emptyCategoryMix();WEEK_DAYS.forEach(day=>PRODUCT_CATEGORIES.forEach(category=>{result[day.code][category.code]=nonNegativeNumber(input?.[day.code]?.[category.code],0);}));return result;}
  function normalizeDayAssignments(input={},fallbackSameDay=false){return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,validDay(input?.[day.code])||(fallbackSameDay?day.code:'')]));}
  function normalizeVariantMix(input=[]){if(!Array.isArray(input))return [];return input.map(entry=>({id:cleanText(entry.id)||createId('production-variant-mix'),day:validDay(entry.day),productKey:cleanText(entry.productKey),productCode:cleanText(entry.productCode),productName:cleanText(entry.productName),variantKey:cleanText(entry.variantKey),variantName:cleanText(entry.variantName),units:nonNegativeNumber(entry.units,0)})).filter(entry=>entry.day&&entry.variantKey&&entry.units>0);}
  function normalizeAssignments(input=[]){if(!Array.isArray(input))return [];const seen=new Set();return input.map(entry=>({taskId:cleanText(entry.taskId),day:validDay(entry.day,true),quantity:nonNegativeNumber(entry.quantity,null)})).filter(entry=>entry.taskId&&!seen.has(entry.taskId)&&seen.add(entry.taskId));}
  function normalizePercentages(input={}){const values=Object.fromEntries(WEEK_DAYS.map(day=>[day.code,Math.max(0,finiteNumber(input?.[day.code],0))])),sum=Object.values(values).reduce((a,b)=>a+b,0);return sum>0?Object.fromEntries(WEEK_DAYS.map(day=>[day.code,values[day.code]/sum*100])):values;}
  function normalizeDailyValues(input={}){return Object.fromEntries(WEEK_DAYS.map(day=>[day.code,Math.max(0,Math.round(nonNegativeNumber(input?.[day.code],0)))]));}
  function normalizeDistributionContext(input={}){return {campaigns:Array.isArray(input.campaigns)?input.campaigns.map(cleanText).filter(Boolean):[],holidayDays:Array.isArray(input.holidayDays)?input.holidayDays.map(day=>validDay(day)).filter(Boolean):[],productionHolidayDays:Array.isArray(input.productionHolidayDays)?input.productionHolidayDays.map(day=>validDay(day)).filter(Boolean):[],holidayDetails:Array.isArray(input.holidayDetails)?clone(input.holidayDetails):[],references:Array.isArray(input.references)?clone(input.references):[],excluded:Array.isArray(input.excluded)?clone(input.excluded):[],warnings:Array.isArray(input.warnings)?input.warnings.map(cleanText).filter(Boolean):[],calculatedAt:cleanText(input.calculatedAt),method:cleanText(input.method)};}
  function legacyDailyValues(input={}){const result=emptyDayValues(0);WEEK_DAYS.forEach(day=>{const entry=input?.dailyForecast?.[day.code]||{};result[day.code]=Math.max(0,Math.round((nonNegativeNumber(entry.system,0)||0)+finiteNumber(entry.adjustment,0)));});return result;}
  function totalDaily(values={}){return WEEK_DAYS.reduce((sum,day)=>sum+(nonNegativeNumber(values?.[day.code],0)||0),0);}
  function createWeeklyPlan(year,week,options={}){const key=weeklyPlanKey(year,week),[safeYear,safeWeek]=key.replace('-W','-').split('-').map(Number);return {key,year:safeYear,week:safeWeek,status:WEEK_STATUSES.DRAFT,annualForecast:null,productionAdjustment:0,dailyDistributionAuto:emptyDayValues(0),dailyExpeditions:emptyDayValues(0),dailyManual:false,distributionContext:normalizeDistributionContext(),categoryMix:emptyCategoryMix(),variantMix:[],preassignmentDays:normalizeDayAssignments({},true),satelliteAssignments:[],principalAssignments:[],updatedAt:isoNow(options.now),validatedAt:null};}
  function normalizeWeeklyPlan(input={},options={}){
    const fallback=createWeeklyPlan(input.year,input.week,options),key=weeklyPlanKey(input.year??fallback.year,input.week??fallback.week),[year,week]=key.replace('-W','-').split('-').map(Number);
    const legacyDaily=legacyDailyValues(input),hasNewDaily=input.dailyExpeditions&&typeof input.dailyExpeditions==='object';
    const annualForecast=nonNegativeNumber(input.annualForecast,input.bouquetSystem??(totalDaily(legacyDaily)||null));
    const productionAdjustment=finiteNumber(input.productionAdjustment,input.bouquetAdjustment??0);
    const dailyExpeditions=normalizeDailyValues(hasNewDaily?input.dailyExpeditions:legacyDaily);
    const dailyDistributionAuto=normalizePercentages(input.dailyDistributionAuto||(totalDaily(dailyExpeditions)?Object.fromEntries(WEEK_DAYS.map(day=>[day.code,dailyExpeditions[day.code]])):{}));
    return {key,year,week,status:input.status===WEEK_STATUSES.VALIDATED?WEEK_STATUSES.VALIDATED:WEEK_STATUSES.DRAFT,annualForecast,productionAdjustment,dailyDistributionAuto,dailyExpeditions,dailyManual:input.dailyManual===true||(!hasNewDaily&&totalDaily(legacyDaily)>0),distributionContext:normalizeDistributionContext(input.distributionContext),categoryMix:normalizeCategoryMix(input.categoryMix),variantMix:normalizeVariantMix(input.variantMix),preassignmentDays:normalizeDayAssignments(input.preassignmentDays,true),satelliteAssignments:normalizeAssignments(input.satelliteAssignments),principalAssignments:normalizeAssignments(input.principalAssignments),updatedAt:cleanText(input.updatedAt)||isoNow(options.now),validatedAt:input.status===WEEK_STATUSES.VALIDATED?(cleanText(input.validatedAt)||cleanText(input.updatedAt)||isoNow(options.now)):null};
  }
  function normalizeWeeklyPlans(input={},options={}){if(!input||typeof input!=='object')return {};const result={};Object.values(input).forEach(plan=>{const normalized=normalizeWeeklyPlan(plan,options);result[normalized.key]=normalized;});return result;}
  function createProductionState(input,options={}){const source=input&&typeof input==='object'?input:{};const tasks=ensureSpecialTasks(deduplicateTasks(migrateTasks(source,options)),options);const oldHistory=Array.isArray(source?.legacy?.timeHistory)?source.legacy.timeHistory:Array.isArray(source.timeHistory)?source.timeHistory:[];return {version:4,tasks,categoryRates:normalizeCategoryRates(source.categoryRates),shippingRate:positiveNumber(source.shippingRate)||(Array.isArray(source.tasks)?positiveNumber(source.tasks.find(task=>normalizeCode(task.code)==='SHIPPING')?.performance):null),distributionSettings:{...DEFAULT_DISTRIBUTION_SETTINGS,...(source.distributionSettings||{}),recentWeights:Array.isArray(source.distributionSettings?.recentWeights)?source.distributionSettings.recentWeights.map(value=>Math.max(0,finiteNumber(value,0))).slice(0,8):DEFAULT_DISTRIBUTION_SETTINGS.recentWeights.slice()},weeklyPlans:normalizeWeeklyPlans(source.weeklyPlans,options),changeHistory:Array.isArray(source.changeHistory)?source.changeHistory.map(entry=>normalizeChangeEntry(entry,options)):[],updatedAt:cleanText(source.updatedAt)||isoNow(options.now),...(oldHistory.length?{legacy:{timeHistory:clone(oldHistory)}}:{})};}

  function validateTask(task,allTasks=[],ignoreId=''){const errors=[];if(!task.name)errors.push('El nombre es obligatorio.');if(!task.code)errors.push('No se ha podido generar la identidad de la tarea.');if(allTasks.some(other=>other.id!==ignoreId&&other.code===task.code))errors.push('Ya existe una tarea con ese nombre o identidad.');if(!task.specialKind&&task.calculationType===CALCULATION_TYPES.QUANTITY&&task.performance==null)errors.push('Indica un rendimiento mayor que cero.');if(!task.specialKind&&task.calculationType===CALCULATION_TYPES.FIXED&&task.durationHours==null)errors.push('Indica las horas-persona de la tarea.');return errors;}
  function appendChange(state,input,options={}){const entry=normalizeChangeEntry(input,options);return {...state,changeHistory:[...state.changeHistory,entry],updatedAt:entry.changedAt};}
  function addProductionTask(stateInput,input,options={}){const state=createProductionState(stateInput,options),task=normalizeTask({...input,id:input.id||createId('production-task'),code:input.code||normalizeCode(input.name)},{now:options.now}),errors=validateTask(task,state.tasks);if(errors.length)return {ok:false,errors,state};return {ok:true,task,state:{...state,tasks:[...state.tasks,task],updatedAt:isoNow(options.now)}};}
  function updateProductionTask(stateInput,taskId,patch={},options={}){const state=createProductionState(stateInput,options),index=state.tasks.findIndex(task=>task.id===taskId);if(index<0)return {ok:false,errors:['La tarea no existe.'],state};const previous=state.tasks[index],next=normalizeTask({...previous,...patch,id:previous.id,code:previous.code,specialKind:previous.specialKind,createdAt:previous.createdAt,updatedAt:isoNow(options.now)},{now:options.now}),errors=validateTask(next,state.tasks,taskId);if(errors.length)return {ok:false,errors,state};const tasks=state.tasks.slice();tasks[index]=next;let updated={...state,tasks,updatedAt:isoNow(options.now)};['name','type','active','calculationType','performance','durationHours','frequency','priority','mobility','notes'].forEach(field=>{if(!sameValue(previous[field],next[field]))updated=appendChange(updated,{entityKey:taskId,field,previousValue:previous[field],newValue:next[field],comment:options.comment},options);});return {ok:true,task:next,state:updated};}
  function updateMainTask(stateInput,taskCode,patch={},options={}){const state=createProductionState(stateInput,options),task=state.tasks.find(item=>item.code===normalizeCode(taskCode));return task?updateProductionTask(state,task.id,patch,options):{ok:false,errors:['La tarea principal no existe.'],state};}
  function updateCategoryRate(stateInput,categoryCode,operation,value,options={}){const state=createProductionState(stateInput,options),code=normalizeCode(categoryCode);if(!PRODUCT_CATEGORIES.some(category=>category.code===code))return {ok:false,errors:['La categoría de producto no existe.'],state};if(!['reception','preassignment'].includes(operation))return {ok:false,errors:['La operación no es válida.'],state};const raw=cleanText(value),next=positiveNumber(value);if(raw&&next==null)return {ok:false,errors:['El rendimiento debe ser un número mayor que cero.'],state};const previous=state.categoryRates[code][operation];if(sameValue(previous,next))return {ok:true,changed:false,state};const categoryRates={...state.categoryRates,[code]:{...state.categoryRates[code],[operation]:next}};return {ok:true,changed:true,state:appendChange({...state,categoryRates},{entityKey:`${operation}:${code}`,field:'performance',previousValue:previous,newValue:next,comment:options.comment},options)};}
  function updateShippingRate(stateInput,value,options={}){const state=createProductionState(stateInput,options),raw=cleanText(value),next=positiveNumber(value);if(raw&&next==null)return {ok:false,errors:['El rendimiento debe ser un número mayor que cero.'],state};if(sameValue(state.shippingRate,next))return {ok:true,changed:false,state};return {ok:true,changed:true,state:appendChange({...state,shippingRate:next},{entityKey:'SHIPPING',field:'performance',previousValue:state.shippingRate,newValue:next,comment:options.comment},options)};}
  function deactivateProductionTask(stateInput,taskId,options={}){return updateProductionTask(stateInput,taskId,{active:false},options);}
  function deleteProductionTask(stateInput,taskId,options={}){const state=createProductionState(stateInput,options),task=state.tasks.find(item=>item.id===taskId);if(!task)return {ok:false,errors:['La tarea no existe.'],state};if(task.specialKind)return {ok:false,errors:['Las cuatro actividades base no se eliminan; puedes desactivarlas.'],state};const used=Object.values(state.weeklyPlans).some(plan=>[...plan.satelliteAssignments,...plan.principalAssignments].some(item=>item.taskId===taskId));if(used||state.changeHistory.some(entry=>entry.entityKey===taskId)||(task.usageCount||0)>0)return {ok:false,errors:['La tarea tiene modificaciones o uso registrado; desactívala en lugar de eliminarla.'],state};return {ok:true,state:{...state,tasks:state.tasks.filter(item=>item.id!==taskId),updatedAt:isoNow(options.now)}};}
  function taskTimingText(task){if(task.specialKind==='reception'||task.specialKind==='preassignment')return 'Rendimiento por categoría';if(task.specialKind==='manufacturing')return 'Rendimiento por producto y variante';if(task.specialKind==='shipping')return 'Rendimiento global de expedición';if(task.calculationType===CALCULATION_TYPES.QUANTITY)return task.performance==null?'Pendiente':`${task.performance} uds/h/persona`;return task.durationHours==null?'Pendiente':`${task.durationHours} h-persona`;}
  function calculateTaskPersonHours(taskInput,workload=1){const task=normalizeTask(taskInput);if(task.specialKind)return null;if(task.calculationType===CALCULATION_TYPES.QUANTITY){const amount=nonNegativeNumber(workload,null);return amount==null||task.performance==null?null:amount/task.performance;}return task.durationHours;}
  function manufacturingTaskDescriptor(){return Object.freeze({code:'MANUFACTURING',name:'Fabricación',calculationType:CALCULATION_TYPES.QUANTITY,unit:'unidades / hora / persona',source:'nomenclatures',editable:false});}

  function weeklyTotalUsed(planInput){const plan=normalizeWeeklyPlan(planInput);return Math.max(0,Math.round((nonNegativeNumber(plan.annualForecast,0)||0)+finiteNumber(plan.productionAdjustment,0)));}
  function largestRemainder(total,weights={}){const rounded=Math.max(0,Math.round(finiteNumber(total,0))),clean=WEEK_DAYS.map(day=>Math.max(0,finiteNumber(weights?.[day.code],0))),sum=clean.reduce((a,b)=>a+b,0);if(!sum)return emptyDayValues(0);const raw=clean.map(value=>value/sum*rounded),values=raw.map(Math.floor);let left=rounded-values.reduce((a,b)=>a+b,0);raw.map((value,index)=>({index,remainder:value-values[index]})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index).slice(0,left).forEach(item=>values[item.index]++);return Object.fromEntries(WEEK_DAYS.map((day,index)=>[day.code,values[index]]));}
  function dailyPercentages(values={}){const total=totalDaily(values);return total?Object.fromEntries(WEEK_DAYS.map(day=>[day.code,(nonNegativeNumber(values[day.code],0)||0)/total*100])):emptyDayValues(0);}
  function distributionBalance(planInput){const plan=normalizeWeeklyPlan(planInput),used=weeklyTotalUsed(plan),daily=totalDaily(plan.dailyExpeditions);return {used,daily,difference:used-daily,percentages:dailyPercentages(plan.dailyExpeditions)};}
  function applyDistributionProposal(planInput,proposal={}){const plan=normalizeWeeklyPlan(planInput);return normalizeWeeklyPlan({...plan,dailyDistributionAuto:proposal.percentages||emptyDayValues(0),dailyExpeditions:proposal.dailyExpeditions||largestRemainder(weeklyTotalUsed(plan),proposal.percentages),dailyManual:false,distributionContext:{campaigns:proposal.campaigns||[],holidayDays:proposal.holidayDays||[],productionHolidayDays:proposal.productionHolidayDays||[],holidayDetails:proposal.holidayDetails||[],references:proposal.references||[],excluded:proposal.excluded||[],warnings:proposal.warnings||[],calculatedAt:proposal.calculatedAt||isoNow(),method:proposal.method||''},status:WEEK_STATUSES.DRAFT,validatedAt:null});}
  function spreadDailyDifference(planInput){const plan=normalizeWeeklyPlan(planInput),balance=distributionBalance(plan);if(!balance.difference)return plan;const weights=totalDaily(plan.dailyExpeditions)?plan.dailyExpeditions:(Object.values(plan.dailyDistributionAuto).some(Boolean)?plan.dailyDistributionAuto:Object.fromEntries(WEEK_DAYS.map((day,index)=>[day.code,index<5?1:0])));plan.dailyExpeditions=largestRemainder(balance.used,weights);plan.dailyManual=true;plan.status=WEEK_STATUSES.DRAFT;plan.validatedAt=null;return plan;}
  function comparableKey(week){return Number(week.year)*100+Number(week.week);}
  function campaignNames(value){return (Array.isArray(value)?value:String(value||'').split(/\s*[·,]\s*/)).map(cleanText).filter(Boolean);}
  function sameCampaign(left,right){const a=campaignNames(left).map(normalizeName),b=campaignNames(right).map(normalizeName);return a.length>0&&a.some(name=>b.includes(name));}
  function holidaySignature(value){return [...new Set((Array.isArray(value)?value:[]).map(day=>validDay(day)).filter(Boolean))].sort().join('|');}
  function normalizeHistoryWeek(input={}){const daily=normalizeDailyValues(input.daily||input.dailyExpeditions),total=totalDaily(daily);return {year:Number(input.year),week:Number(input.week),status:cleanText(input.status)||'closed',isComplete:input.isComplete===true,campaigns:campaignNames(input.campaigns||input.campaign),holidayDays:(input.holidayDays||input.holidays||[]).map(day=>validDay(day)).filter(Boolean),hasIncident:input.hasIncident===true||input.incident===true,daily,total};}
  function proposeDailyDistribution(input={}){
    const year=Number(input.year),week=Number(input.week),total=Math.max(0,Math.round(nonNegativeNumber(input.total,0)||0)),campaigns=campaignNames(input.campaigns),holidayDays=(input.holidayDays||[]).map(day=>validDay(day)).filter(Boolean),settings={...DEFAULT_DISTRIBUTION_SETTINGS,...(input.settings||{})},warnings=[],excluded=[];
    const targetKey=year*100+week,targetHoliday=holidaySignature(holidayDays),hasCampaign=campaigns.length>0,history=(input.historyWeeks||[]).map(normalizeHistoryWeek).filter(item=>item.year&&item.week&&item.total>0);
    const structurallyValid=history.filter(item=>{if(item.status!=='closed'){excluded.push({year:item.year,week:item.week,reason:'semana no cerrada'});return false;}if(!item.isComplete){excluded.push({year:item.year,week:item.week,reason:'semana incompleta'});return false;}if(item.hasIncident){excluded.push({year:item.year,week:item.week,reason:'incidencia extraordinaria'});return false;}return true;});
    let eligible;
    if(hasCampaign){eligible=structurallyValid.filter(item=>sameCampaign(item.campaigns,campaigns)&&holidaySignature(item.holidayDays)===targetHoliday);if(!eligible.length)warnings.push(`No hay histórico completo comparable para la campaña ${campaigns.join(' · ')}.`);}
    else if(targetHoliday){eligible=structurallyValid.filter(item=>!item.campaigns.length&&holidaySignature(item.holidayDays)===targetHoliday);if(!eligible.length)warnings.push('No hay semanas históricas completas con los mismos festivos; no se propone un traslado de volumen.');}
    else eligible=structurallyValid.filter(item=>!item.campaigns.length&&!item.holidayDays.length);
    const prior=eligible.filter(item=>comparableKey(item)<targetKey).sort((a,b)=>comparableKey(b)-comparableKey(a)).slice(0,Math.max(1,settings.maxRecentWeeks||4));
    const comparableYear=Number(input.comparableYear),comparable=eligible.find(item=>item.year===comparableYear&&item.week===week)||null;
    const recent=prior.filter(item=>!comparable||item.year!==comparable.year||item.week!==comparable.week);
    const references=[];
    const recentWeights=(Array.isArray(settings.recentWeights)?settings.recentWeights:DEFAULT_DISTRIBUTION_SETTINGS.recentWeights).map(value=>Math.max(0,finiteNumber(value,0)));
    const hasComparable=!!comparable,recentShare=hasComparable&&recent.length?Math.max(0,finiteNumber(settings.recentShare,70)):100,comparableShare=hasComparable?Math.max(0,finiteNumber(settings.comparableShare,30)):0,recentWeightTotal=recent.reduce((sum,item,index)=>sum+(recentWeights[index]||0),0);
    recent.forEach((item,index)=>references.push({week:item,weight:recentWeightTotal?recentShare*(recentWeights[index]||0)/recentWeightTotal:recentShare/recent.length,reason:hasCampaign?'Misma campaña histórica':targetHoliday?'Mismos festivos':'Semana reciente comparable'}));
    if(comparable)references.push({week:comparable,weight:recent.length?comparableShare:100,reason:`Misma semana de ${comparableYear}`});
    if(!references.length){warnings.push('No hay suficientes referencias diarias comparables para calcular una propuesta.');return {year,week,total,campaigns,holidayDays,percentages:emptyDayValues(0),dailyExpeditions:emptyDayValues(0),references:[],excluded,warnings,method:'Sin referencias comparables',calculatedAt:isoNow(input.now)};}
    const weightTotal=references.reduce((sum,item)=>sum+item.weight,0)||1,percentages=emptyDayValues(0);
    references.forEach(reference=>{const pct=dailyPercentages(reference.week.daily);WEEK_DAYS.forEach(day=>{percentages[day.code]+=pct[day.code]*reference.weight/weightTotal;});});
    const normalized=normalizePercentages(percentages),dailyExpeditions=largestRemainder(total,normalized),method=hasCampaign?'Histórico de la misma campaña':targetHoliday?'Histórico con los mismos festivos':'Últimas semanas comparables + año de referencia';
    return {year,week,total,campaigns,holidayDays,percentages:normalized,dailyExpeditions,references:references.map(item=>({year:item.week.year,week:item.week.week,weight:Number((item.weight/weightTotal*100).toFixed(2)),reason:item.reason,percentages:dailyPercentages(item.week.daily)})),excluded,warnings,method,calculatedAt:isoNow(input.now)};
  }

  function variantRate(variantRates,key){return positiveNumber(variantRates instanceof Map?variantRates.get(key):variantRates?.[key]);}
  function specialTask(state,kind){return state.tasks.find(task=>task.specialKind===kind);}
  function calculateWeeklyPlan(planInput,stateInput,options={}){
    const state=createProductionState(stateInput),plan=normalizeWeeklyPlan(planInput);
    const days=Object.fromEntries(WEEK_DAYS.map(day=>[day.code,{reception:0,preassignment:0,manufacturing:0,shipping:0,otherMain:0,satellite:0,total:0}]));
    const issues=[],issueKeys=new Set(),mainByTask=Object.fromEntries(state.tasks.filter(task=>task.type===TASK_TYPES.MAIN&&task.active).map(task=>[task.id,0]));
    const selectedSatelliteIds=new Set(plan.satelliteAssignments.map(item=>item.taskId));
    const satelliteByTask=Object.fromEntries(state.tasks.filter(task=>task.type===TASK_TYPES.SATELLITE&&task.active&&selectedSatelliteIds.has(task.id)).map(task=>[task.id,0]));
    const addIssue=(code,message,context={})=>{const key=JSON.stringify([code,message,context]);if(!issueKeys.has(key)){issueKeys.add(key);issues.push({code,message,...context});}};
    const balance=distributionBalance(plan);if(balance.difference)addIssue('DAILY_TOTAL_MISMATCH',`La distribución diaria difiere del total semanal en ${balance.difference>0?'+':''}${balance.difference} expediciones.`);
    const reception=specialTask(state,'reception'),preassignment=specialTask(state,'preassignment'),manufacturing=specialTask(state,'manufacturing'),shipping=specialTask(state,'shipping');
    const includeSpecial=task=>task?.active&&(task.type===TASK_TYPES.MAIN||selectedSatelliteIds.has(task.id));
    const addSpecialHours=(task,hours)=>{if(task.type===TASK_TYPES.MAIN)mainByTask[task.id]=(mainByTask[task.id]||0)+hours;else satelliteByTask[task.id]=(satelliteByTask[task.id]||0)+hours;};
    const purchases=Array.isArray(options.purchases)?options.purchases:[];
    if(includeSpecial(reception)){
      if(!purchases.length)addIssue('RECEPTION_DATA_MISSING','Recepción pendiente de datos de Compras.');
      purchases.forEach(item=>{const day=validDay(item.day),category=normalizeCode(item.category),units=nonNegativeNumber(item.units,0),rate=state.categoryRates[category]?.reception;if(!day||!PRODUCT_CATEGORIES.some(entry=>entry.code===category)||!units)return;if(rate==null)addIssue('RECEPTION_RATE_MISSING',`Falta el rendimiento de Recepción para ${PRODUCT_CATEGORIES.find(entry=>entry.code===category)?.label||category}.`,{day,category});else{const hours=units/rate;days[day].reception+=hours;addSpecialHours(reception,hours);}});
    }
    const categoryUnits=totalDaily(Object.fromEntries(WEEK_DAYS.map(day=>[day.code,Object.values(plan.categoryMix[day.code]).reduce((sum,value)=>sum+value,0)]))),needsCategoryMix=includeSpecial(preassignment)||includeSpecial(manufacturing);
    if(needsCategoryMix&&balance.daily>0&&categoryUnits===0)addIssue('CATEGORY_MIX_MISSING','Falta la composición prevista por categoría; Preasignación y Fabricación no pueden calcularse completamente.');else if(needsCategoryMix&&balance.daily>0&&Math.abs(categoryUnits-balance.daily)>0.001)addIssue('CATEGORY_MIX_MISMATCH','El total del mix por categoría no coincide con la distribución diaria.');
    if(includeSpecial(preassignment))WEEK_DAYS.forEach(sourceDay=>PRODUCT_CATEGORIES.forEach(category=>{const units=nonNegativeNumber(plan.categoryMix[sourceDay.code][category.code],0);if(!units)return;const target=plan.preassignmentDays[sourceDay.code],rate=state.categoryRates[category.code].preassignment;if(!target)addIssue('PREASSIGNMENT_DAY_MISSING',`Falta el día de Preasignación para ${sourceDay.label}.`,{day:sourceDay.code,category:category.code});else if(rate==null)addIssue('PREASSIGNMENT_RATE_MISSING',`Falta el rendimiento de Preasignación para ${category.label}.`,{day:sourceDay.code,category:category.code});else{const hours=units/rate;days[target].preassignment+=hours;addSpecialHours(preassignment,hours);}}));
    if(includeSpecial(manufacturing)){plan.variantMix.forEach(entry=>{const rate=variantRate(options.variantRates,entry.variantKey);if(rate==null)addIssue('MANUFACTURING_RATE_MISSING',`Falta el rendimiento de Fabricación de ${entry.productName||entry.productCode||entry.variantKey} ${entry.variantName||''}.`.trim(),{day:entry.day,variantKey:entry.variantKey});else{const hours=entry.units/rate;days[entry.day].manufacturing+=hours;addSpecialHours(manufacturing,hours);}});if(categoryUnits>0&&!plan.variantMix.length)addIssue('VARIANT_MIX_MISSING','La carga de Fabricación está incompleta: falta el desglose previsto por producto y variante.');}
    if(includeSpecial(shipping))WEEK_DAYS.forEach(day=>{const units=plan.dailyExpeditions[day.code];if(units>0&&state.shippingRate==null)addIssue('SHIPPING_RATE_MISSING','Falta el rendimiento global de Expedición.');else if(state.shippingRate){const hours=units/state.shippingRate;days[day.code].shipping=hours;addSpecialHours(shipping,hours);}});
    let unassignedOtherMain=0,unassignedSatellite=0;
    function calculateAssignments(assignments,type){assignments.forEach(assignment=>{const task=state.tasks.find(item=>item.id===assignment.taskId&&item.type===type);if(!task){return;}if(task.specialKind)return;if(!task.active)addIssue('TASK_INACTIVE',`${task.name} está inactiva pero sigue seleccionada.`,{taskId:task.id});const hours=calculateTaskPersonHours(task,assignment.quantity);if(hours==null){addIssue('TASK_VALUE_MISSING',`Faltan datos para calcular ${task.name}.`,{taskId:task.id});return;}const isMain=type===TASK_TYPES.MAIN;if(isMain)mainByTask[task.id]=(mainByTask[task.id]||0)+hours;else satelliteByTask[task.id]=(satelliteByTask[task.id]||0)+hours;if(!assignment.day||assignment.day==='automatic'){if(isMain)unassignedOtherMain+=hours;else unassignedSatellite+=hours;addIssue('TASK_DAY_PENDING',`${task.name} está pendiente de asignación diaria.`,{taskId:task.id});}else if(isMain)days[assignment.day].otherMain+=hours;else days[assignment.day].satellite+=hours;});}
    calculateAssignments(plan.principalAssignments,TASK_TYPES.MAIN);calculateAssignments(plan.satelliteAssignments,TASK_TYPES.SATELLITE);
    state.tasks.filter(task=>task.type===TASK_TYPES.MAIN&&task.active&&!task.specialKind&&!plan.principalAssignments.some(item=>item.taskId===task.id)).forEach(task=>addIssue('PRINCIPAL_TASK_UNPLANNED',`${task.name} es una actividad principal activa y todavía no está planificada.`,{taskId:task.id}));
    WEEK_DAYS.forEach(day=>{const row=days[day.code];row.total=row.reception+row.preassignment+row.manufacturing+row.shipping+row.otherMain+row.satellite;});
    const weekly={reception:0,preassignment:0,manufacturing:0,shipping:0,otherMain:unassignedOtherMain,satellite:unassignedSatellite,mainTotal:0,satelliteTotal:0,total:0};
    WEEK_DAYS.forEach(day=>['reception','preassignment','manufacturing','shipping','otherMain','satellite'].forEach(key=>{weekly[key]+=days[day.code][key];}));
    const specialTasks={reception,preassignment,manufacturing,shipping};
    const specialMainTotal=Object.entries(specialTasks).reduce((sum,[kind,task])=>sum+(includeSpecial(task)&&task.type===TASK_TYPES.MAIN?weekly[kind]:0),0);
    const specialSatelliteTotal=Object.entries(specialTasks).reduce((sum,[kind,task])=>sum+(includeSpecial(task)&&task.type===TASK_TYPES.SATELLITE?weekly[kind]:0),0);
    weekly.mainTotal=specialMainTotal+weekly.otherMain;weekly.satelliteTotal=specialSatelliteTotal+weekly.satellite;weekly.total=weekly.mainTotal+weekly.satelliteTotal;
    return {plan,days,weekly,mainByTask,satelliteByTask,forecastTotal:balance.daily,totalUsed:balance.used,difference:balance.difference,issues,incomplete:issues.some(issue=>issue.code.endsWith('_MISSING')||['DAILY_TOTAL_MISMATCH','VARIANT_MIX_MISSING','PRINCIPAL_TASK_UNPLANNED'].includes(issue.code))};
  }
  function saveWeeklyPlan(stateInput,planInput,options={}){const state=createProductionState(stateInput,options),plan=normalizeWeeklyPlan({...planInput,updatedAt:isoNow(options.now)},options);return {ok:true,plan,state:{...state,weeklyPlans:{...state.weeklyPlans,[plan.key]:plan},updatedAt:plan.updatedAt}};}
  function validateWeeklyPlan(stateInput,planInput,options={}){const calculated=calculateWeeklyPlan(planInput,stateInput,options);if(calculated.incomplete)return {ok:false,errors:['La semana tiene datos incompletos y no puede validarse.'],calculated,state:createProductionState(stateInput)};const now=isoNow(options.now);return saveWeeklyPlan(stateInput,{...calculated.plan,status:WEEK_STATUSES.VALIDATED,validatedAt:now,updatedAt:now},{...options,now});}
  function weeklyPlanFor(stateInput,year,week,options={}){const state=createProductionState(stateInput,options),key=weeklyPlanKey(year,week);return state.weeklyPlans[key]?normalizeWeeklyPlan(state.weeklyPlans[key],options):createWeeklyPlan(year,week,options);}
  function summarizeProductionState(stateInput){const state=createProductionState(stateInput),main=state.tasks.filter(task=>task.type===TASK_TYPES.MAIN),satellite=state.tasks.filter(task=>task.type===TASK_TYPES.SATELLITE),configuredCategoryRates=PRODUCT_CATEGORIES.reduce((count,category)=>count+(state.categoryRates[category.code].reception!=null?1:0)+(state.categoryRates[category.code].preassignment!=null?1:0),0);return {tasks:state.tasks.length,main:main.length,mainActive:main.filter(task=>task.active).length,satellite:satellite.length,activeSatellite:satellite.filter(task=>task.active).length,configuredCategoryRates,shippingConfigured:state.shippingRate!=null,weeklyPlans:Object.keys(state.weeklyPlans).length,validatedWeeks:Object.values(state.weeklyPlans).filter(plan=>plan.status===WEEK_STATUSES.VALIDATED).length,changes:state.changeHistory.length};}

  return {PRODUCT_CATEGORIES,WEEK_DAYS,TASK_TYPES,TASK_PRIORITIES,TASK_MOBILITIES,CALCULATION_TYPES,WEEK_STATUSES,SPECIAL_TASK_DEFINITIONS,MAIN_TASK_DEFINITIONS,DEFAULT_SATELLITE_TASKS,DEFAULT_DISTRIBUTION_SETTINGS,createProductionState,normalizeTask,normalizeManufacturingRates,normalizeWeeklyPlan,normalizeCode,weeklyPlanKey,isoWeekInfo,shiftWeek,createWeeklyPlan,weeklyPlanFor,saveWeeklyPlan,validateWeeklyPlan,weeklyTotalUsed,dailyPercentages,distributionBalance,applyDistributionProposal,spreadDailyDifference,proposeDailyDistribution,calculateWeeklyPlan,updateMainTask,updateCategoryRate,updateShippingRate,addProductionTask,updateProductionTask,deactivateProductionTask,deleteProductionTask,calculateTaskPersonHours,taskTimingText,manufacturingTaskDescriptor,summarizeProductionState};
});

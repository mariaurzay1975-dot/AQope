(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AquarelleInitialMigration=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
  function objectValue(value){return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
  function finiteInteger(value){const number=Number(value);return Number.isFinite(number)?Math.round(number):null;}
  function nullableYear(value){const year=finiteInteger(value);return year&&year>=2000&&year<=2200?year:null;}
  function weekNumber(state){const week=finiteInteger(state?.weekState?.week);return week&&week>=1&&week<=53?week:null;}
  function migrationWeekKey(year,week,padded=true){const safeYear=nullableYear(year),safeWeek=finiteInteger(week);if(!safeYear||!safeWeek||safeWeek<1||safeWeek>53)return null;return `${safeYear}-${padded?String(safeWeek).padStart(2,'0'):safeWeek}`;}

  function normalizeAnnualPlanningForMigration(value,state={}){
    const source=objectValue(value),selectedYear=nullableYear(source.selectedYear)||nullableYear(state?.weekState?.year)||new Date().getFullYear(),hasComparable=Object.prototype.hasOwnProperty.call(source,'comparableYear'),comparableYear=hasComparable?nullableYear(source.comparableYear):null,previousYear=nullableYear(source.previousYear),projectionDefaults={defaultGrowthPercent:0,projectionBase:'comparable',distributionWindow:8};
    const normalized={...clone(source),selectedYear,previousYear,comparableYear,projectionSettings:{...projectionDefaults,...clone(objectValue(source.projectionSettings))},imports:clone(objectValue(source.imports)),years:clone(objectValue(source.years)),campaignCatalog:Array.isArray(source.campaignCatalog)?clone(source.campaignCatalog):[],changeHistory:Array.isArray(source.changeHistory)?clone(source.changeHistory):[]};
    Object.entries(normalized.years).forEach(([key,raw])=>{const yearData=objectValue(raw),year=nullableYear(yearData.year)||nullableYear(key),yearHasComparable=Object.prototype.hasOwnProperty.call(yearData,'comparableYear');normalized.years[key]={...yearData,year,previousYear:Object.prototype.hasOwnProperty.call(yearData,'previousYear')?nullableYear(yearData.previousYear):previousYear,comparableYear:yearHasComparable?nullableYear(yearData.comparableYear):comparableYear,projectionSettings:{...normalized.projectionSettings,...objectValue(yearData.projectionSettings)},weeks:clone(objectValue(yearData.weeks)),campaigns:Array.isArray(yearData.campaigns)?clone(yearData.campaigns):[],holidays:Array.isArray(yearData.holidays)?clone(yearData.holidays):[]};});
    return normalized;
  }

  function migrationSummary(state){return {stock:Array.isArray(state?.data)?state.data.length:0,nomenclatures:Array.isArray(state?.nomenclatures)?state.nomenclatures.length:0,flowers:Array.isArray(state?.flowers)?state.flowers.length:0,weeks:Object.keys(objectValue(state?.weekSnapshots)).length,week:weekNumber(state),year:nullableYear(state?.weekState?.year),objective:Number.isFinite(Number(state?.weekState?.objetivo))?Number(state.weekState.objetivo):null};}
  function validateInitialMigrationState(state){const errors=[];if(!state||typeof state!=='object'||Array.isArray(state))return ['El JSON no contiene un estado de aplicación válido.'];if(!Array.isArray(state.data)||!state.data.length)errors.push('La copia no contiene referencias de stock.');if(!Array.isArray(state.nomenclatures)||!state.nomenclatures.length)errors.push('La copia no contiene nomenclaturas.');if(!state.weekState||typeof state.weekState!=='object'||!weekNumber(state)||!nullableYear(state.weekState.year))errors.push('La copia no contiene una semana activa válida.');if(!state.weekSnapshots||typeof state.weekSnapshots!=='object'||Array.isArray(state.weekSnapshots)||!Object.keys(state.weekSnapshots).length)errors.push('La copia no contiene semanas guardadas válidas.');return errors;}
  function comparableReference(annualPlanning,state){const activeWeek=weekNumber(state),yearData=annualPlanning.years?.[String(annualPlanning.selectedYear)]||{},comparableYear=nullableYear(yearData.comparableYear)??nullableYear(annualPlanning.comparableYear),comparableKey=migrationWeekKey(comparableYear,activeWeek,true),legacyKey=migrationWeekKey(comparableYear,activeWeek,false);if(!comparableYear)return {comparableYear:null,comparableKey:null,exists:false};const importedWeeks=objectValue(annualPlanning.imports?.[String(comparableYear)]?.weeks),annualWeeks=objectValue(annualPlanning.years?.[String(comparableYear)]?.weeks),snapshots=objectValue(state.weekSnapshots),exists=!!(importedWeeks[comparableKey]||importedWeeks[legacyKey]||annualWeeks[comparableKey]||annualWeeks[legacyKey]||snapshots[comparableKey]||snapshots[legacyKey]);return {comparableYear,comparableKey,exists};}

  function prepareInitialMigrationPayload(input){
    const errors=validateInitialMigrationState(input),state=clone(input||{});if(errors.length)return {state:null,summary:migrationSummary(input),reference:{comparableYear:null,comparableKey:null,exists:false},warnings:[],errors,canUpload:false};
    state.annualPlanning=normalizeAnnualPlanningForMigration(state.annualPlanning,state);state.weekSnapshots=clone(objectValue(state.weekSnapshots));state.nomenclatures=clone(state.nomenclatures);state.flowers=Array.isArray(state.flowers)?clone(state.flowers):[];state.productionState=state.productionState&&typeof state.productionState==='object'?clone(state.productionState):null;
    const activeKey=migrationWeekKey(state.weekState.year,state.weekState.week,false);state.activeWeekKey=String(state.activeWeekKey||activeKey);state.currentWeekKey=String(state.currentWeekKey||activeKey);
    const reference=comparableReference(state.annualPlanning,state),warnings=[];if(!reference.comparableYear)warnings.push({code:'COMPARABLE_YEAR_NOT_CONFIGURED',message:'No hay año comparable configurado; la migración continuará sin semana de referencia.'});else if(!reference.exists)warnings.push({code:'COMPARABLE_WEEK_NOT_FOUND',message:`No existe la semana comparable ${reference.comparableKey}; la migración continuará sin esa referencia.`});
    return {state,summary:migrationSummary(state),reference,warnings,errors:[],canUpload:true};
  }

  return {migrationWeekKey,normalizeAnnualPlanningForMigration,migrationSummary,validateInitialMigrationState,prepareInitialMigrationPayload};
});

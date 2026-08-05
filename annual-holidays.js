(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.AquarelleAnnualHolidays=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SCOPES=Object.freeze([
    {code:'national',label:'Nacional'},
    {code:'regional',label:'Autonómico'},
    {code:'local',label:'Local'},
    {code:'company',label:'Empresa'}
  ]);
  const DAY_CODES=Object.freeze(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);

  function text(value){return String(value==null?'':value).trim();}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function dateParts(value){const match=text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!match)return null;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?{year,month,day,date}:null;}
  function isoWeekInfo(value){const parts=dateParts(value);if(!parts)return null;const date=new Date(parts.date),weekday=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()+4-weekday);const isoYear=date.getUTCFullYear(),start=new Date(Date.UTC(isoYear,0,1)),week=Math.ceil((((date-start)/86400000)+1)/7);return {year:isoYear,week,dayCode:DAY_CODES[(parts.date.getUTCDay()+6)%7]};}
  function normalizeScope(value){const code=text(value).toLowerCase();return SCOPES.some(item=>item.code===code)?code:'local';}
  function createId(year,index,now){const stamp=now?new Date(now).getTime():Date.now();return `holiday-${year}-${stamp}-${index}`;}
  function normalizeHoliday(input={},options={}){
    const parts=dateParts(input.date),year=Number(options.year)||parts?.year||new Date().getFullYear();
    const hasImpactFields=input.affectsShipping!==undefined||input.affectsProduction!==undefined;
    return {id:text(input.id)||createId(year,options.index||1,options.now),name:text(input.name),date:parts?text(input.date):'',scope:normalizeScope(input.scope),affectsShipping:hasImpactFields?input.affectsShipping===true:true,affectsProduction:hasImpactFields?input.affectsProduction===true:true,active:input.active!==false,notes:text(input.notes)};
  }
  function normalizeYearData(input={}){const year=Number(input.year)||new Date().getFullYear(),seen=new Set(),holidays=(Array.isArray(input.holidays)?input.holidays:[]).map((item,index)=>normalizeHoliday(item,{year,index:index+1})).filter(item=>item.name&&item.date&&!seen.has(item.id)&&seen.add(item.id));return {...input,year,holidays,holidayCalendarVersion:1};}
  function validateHoliday(input,year){const holiday=normalizeHoliday(input,{year}),errors=[],parts=dateParts(holiday.date);if(!holiday.name)errors.push('El nombre del festivo es obligatorio.');if(!parts)errors.push('La fecha del festivo no es válida.');else if(Number(year)&&parts.year!==Number(year))errors.push(`La fecha debe pertenecer al ejercicio ${year}.`);if(!holiday.affectsShipping&&!holiday.affectsProduction)errors.push('Indica si afecta a expediciones, a producción o a ambas.');return {holiday,errors};}
  function addHoliday(yearData,input,options={}){const normalized=normalizeYearData(yearData),checked=validateHoliday({...input,id:input.id||createId(normalized.year,normalized.holidays.length+1,options.now)},normalized.year);if(checked.errors.length)return {ok:false,errors:checked.errors,yearData:normalized};const holiday=checked.holiday;return {ok:true,holiday,yearData:{...normalized,holidays:[...normalized.holidays,holiday]}};}
  function updateHoliday(yearData,id,patch,options={}){const normalized=normalizeYearData(yearData),index=normalized.holidays.findIndex(item=>item.id===id);if(index<0)return {ok:false,errors:['El festivo no existe.'],yearData:normalized};const checked=validateHoliday({...normalized.holidays[index],...patch,id},{year:normalized.year,now:options.now});if(checked.errors.length)return {ok:false,errors:checked.errors,yearData:normalized};const holidays=normalized.holidays.slice();holidays[index]=checked.holiday;return {ok:true,holiday:checked.holiday,yearData:{...normalized,holidays}};}
  function removeHoliday(yearData,id){const normalized=normalizeYearData(yearData),holiday=normalized.holidays.find(item=>item.id===id);if(!holiday)return {ok:false,errors:['El festivo no existe.'],yearData:normalized};return {ok:true,holiday,yearData:{...normalized,holidays:normalized.holidays.filter(item=>item.id!==id)}};}
  function holidaysForYear(yearData,{activeOnly=false}={}){const holidays=normalizeYearData(yearData).holidays;return holidays.filter(item=>!activeOnly||item.active).sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));}
  function affectsImpact(holiday,impact){if(impact==='shipping')return holiday.affectsShipping;if(impact==='production')return holiday.affectsProduction;return holiday.affectsShipping||holiday.affectsProduction;}
  function holidaysForWeek(yearData,year,week,{impact='any',activeOnly=true}={}){return holidaysForYear(yearData,{activeOnly}).filter(item=>{const info=isoWeekInfo(item.date);return info&&info.year===Number(year)&&info.week===Number(week)&&affectsImpact(item,impact);});}
  function holidayDaysForWeek(yearData,year,week,options={}){return [...new Set(holidaysForWeek(yearData,year,week,options).map(item=>isoWeekInfo(item.date).dayCode))];}
  function weekImpact(yearData,year,week){const holidays=holidaysForWeek(yearData,year,week),shipping=holidays.filter(item=>item.affectsShipping),production=holidays.filter(item=>item.affectsProduction);return {holidays,shipping,production,shippingDays:[...new Set(shipping.map(item=>isoWeekInfo(item.date).dayCode))],productionDays:[...new Set(production.map(item=>isoWeekInfo(item.date).dayCode))]};}

  return {SCOPES,DAY_CODES,dateParts,isoWeekInfo,normalizeHoliday,normalizeYearData,validateHoliday,addHoliday,updateHoliday,removeHoliday,holidaysForYear,holidaysForWeek,holidayDaysForWeek,weekImpact};
});

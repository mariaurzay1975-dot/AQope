const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Holidays=require('./annual-holidays.js');

const yearData=()=>({year:2026,weeks:{},holidays:[]});
const holiday={name:'Fiesta local',date:'2026-08-05',scope:'local',affectsShipping:true,affectsProduction:false,notes:'Calendario municipal'};

test('da de alta y edita un festivo estructurado',()=>{
  const added=Holidays.addHoliday(yearData(),holiday,{now:'2026-01-01T00:00:00Z'});
  assert.equal(added.ok,true);assert.equal(added.holiday.scope,'local');assert.equal(added.holiday.affectsShipping,true);assert.equal(added.holiday.affectsProduction,false);
  const edited=Holidays.updateHoliday(added.yearData,added.holiday.id,{name:'Fiesta local actualizada',scope:'regional',notes:'Revisado'});
  assert.equal(edited.ok,true);assert.equal(edited.holiday.name,'Fiesta local actualizada');assert.equal(edited.holiday.scope,'regional');assert.equal(edited.holiday.notes,'Revisado');
});

test('normaliza y persiste el calendario dentro del año',()=>{
  const added=Holidays.addHoliday(yearData(),holiday,{now:'2026-01-01T00:00:00Z'}),serialized=JSON.parse(JSON.stringify(added.yearData)),restored=Holidays.normalizeYearData(serialized);
  assert.deepEqual(restored.holidays,added.yearData.holidays);assert.equal(restored.holidayCalendarVersion,1);
});

test('identifica la semana ISO afectada y permite desactivar o eliminar',()=>{
  const added=Holidays.addHoliday(yearData(),holiday,{now:'2026-01-01T00:00:00Z'});
  assert.equal(Holidays.isoWeekInfo(holiday.date).week,32);assert.equal(Holidays.holidaysForWeek(added.yearData,2026,32).length,1);
  const inactive=Holidays.updateHoliday(added.yearData,added.holiday.id,{active:false});assert.equal(Holidays.holidaysForWeek(inactive.yearData,2026,32).length,0);assert.equal(Holidays.holidaysForYear(inactive.yearData).length,1);
  const removed=Holidays.removeHoliday(inactive.yearData,added.holiday.id);assert.equal(removed.ok,true);assert.equal(removed.yearData.holidays.length,0);
});

test('distingue festivos de expediciones, producción y ambos',()=>{
  let data=Holidays.addHoliday(yearData(),holiday,{now:'2026-01-01T00:00:00Z'}).yearData;
  data=Holidays.addHoliday(data,{name:'Producción',date:'2026-08-06',scope:'company',affectsShipping:false,affectsProduction:true},{now:'2026-01-02T00:00:00Z'}).yearData;
  data=Holidays.addHoliday(data,{name:'Ambos',date:'2026-08-07',scope:'national',affectsShipping:true,affectsProduction:true},{now:'2026-01-03T00:00:00Z'}).yearData;
  assert.deepEqual(Holidays.holidayDaysForWeek(data,2026,32,{impact:'shipping'}),['wednesday','friday']);
  assert.deepEqual(Holidays.holidayDaysForWeek(data,2026,32,{impact:'production'}),['thursday','friday']);
  const impact=Holidays.weekImpact(data,2026,32);assert.equal(impact.holidays.length,3);assert.equal(impact.shipping.length,2);assert.equal(impact.production.length,2);
});

test('rechaza fechas de otro ejercicio y festivos sin impacto',()=>{
  assert.equal(Holidays.addHoliday(yearData(),{...holiday,date:'2027-08-05'}).ok,false);
  assert.equal(Holidays.addHoliday(yearData(),{...holiday,affectsShipping:false,affectsProduction:false}).ok,false);
});

test('lee la previsión anual mediante la clave real de Planificación anual',()=>{
  const planning={years:{'2026':{year:2026,weeks:{'2026-33':{year:2026,week:33,currentForecast:469}}}}};
  const result=Holidays.getAnnualForecastForWeek(planning,2026,33);
  assert.equal(Holidays.annualWeekKey(2026,33),'2026-33');
  assert.equal(result.status,'found');assert.equal(result.key,'2026-33');assert.equal(result.value,469);assert.equal(result.weekData.currentForecast,469);
});

test('distingue carga, semana inexistente, previsión pendiente y cero válido',()=>{
  assert.equal(Holidays.getAnnualForecastForWeek(null,2026,33).status,'loading');
  const planning={years:{'2026':{year:2026,weeks:{'2026-33':{year:2026,week:33,currentForecast:null},'2026-34':{year:2026,week:34,currentForecast:0}}}}};
  assert.equal(Holidays.getAnnualForecastForWeek(planning,2026,32).status,'not_found');
  assert.equal(Holidays.getAnnualForecastForWeek(planning,2026,33).status,'pending');
  const zero=Holidays.getAnnualForecastForWeek(planning,2026,34);assert.equal(zero.status,'found');assert.equal(zero.value,0);
});

test('resuelve claves semanales legadas sin confundir el año ISO',()=>{
  const planning={years:{'2026':{year:2026,weeks:{'2026-W53':{year:2026,week:53,currentForecast:321},'2026-S33':{year:2026,week:33,currentForecast:469}}}}};
  assert.equal(Holidays.getAnnualForecastForWeek(planning,2026,33).key,'2026-S33');
  const iso=Holidays.isoWeekInfo('2027-01-01');assert.equal(iso.year,2026);assert.equal(iso.week,53);
  const boundary=Holidays.getAnnualForecastForWeek(planning,iso.year,iso.week);assert.equal(boundary.status,'found');assert.equal(boundary.value,321);
});

test('el ciclo de carga pasa de Cargando a la previsión real de S33',()=>{
  const before=Holidays.getAnnualForecastForWeek(undefined,2026,33);
  const supabaseState={annualPlanning:{years:{'2026':{weeks:{'2026-33':{year:2026,week:33,currentForecast:469}}}}}};
  const after=Holidays.getAnnualForecastForWeek(supabaseState.annualPlanning,2026,33);
  assert.equal(before.status,'loading');assert.equal(before.value,null);
  assert.equal(after.status,'found');assert.equal(after.value,469);
});

test('Planificación anual ofrece CRUD visual y Producción lee el calendario, no las observaciones',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/id="btnAnnualHolidays"/);assert.match(html,/id="annualHolidayModal"/);assert.match(html,/id="btnAnnualHolidayAdd"/);
  assert.match(html,/data-holiday-name/);assert.match(html,/data-holiday-date/);assert.match(html,/data-holiday-scope/);assert.match(html,/data-holiday-shipping/);assert.match(html,/data-holiday-production/);assert.match(html,/data-holiday-active/);assert.match(html,/data-holiday-delete/);
  assert.match(html,/class="annual-holiday-marker"/);assert.match(html,/function productionStructuredHolidayContext/);assert.match(html,/annualHolidayImpactForWeek\(year,week\)/);
  assert.doesNotMatch(html,/function productionHolidayUnknown/);
});

test('la carga compartida vuelve a renderizar Planificación anual y Producción',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const refresh=html.match(/function refreshAppAfterCloudLoad\(\)\{([\s\S]*?)\n\}/)?.[1]||'';
  assert.match(refresh,/renderAnnualPlanning\(\)/);assert.match(refresh,/renderProduction\(\)/);assert.match(refresh,/renderProductionWeek\(\)/);
  assert.match(html,/getAnnualForecastForWeek\(annualPlanning,year,week\)/);
  assert.match(html,/annualForecastStatusLabel/);
});

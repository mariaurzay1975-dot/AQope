const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const planning=require('./stock-planning.js');
const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const predicate=html.slice(html.indexOf('function stockPlanningProductIsActiveInCatalog('),html.indexOf('function stockPlanningAnchorPlan('));
const normalize=html.slice(html.indexOf('function codeBaseFor('),html.indexOf('function inferCategoryFromProduct('));
function active(catalog){
  const context=vm.createContext({nomenclatures:catalog});
  vm.runInContext(normalize+predicate,context);
  return context.stockPlanningProductIsActiveInCatalog;
}
const row={producto:'C-AZUR-COTON_1',generico:'C-AZUR-COTON',categoria:'COMPUESTOS',codeBase:'60911',recapCode:'60.911',saldo:1};
const catalog={productCode:'60911',productName:'C-AZUR-COTON-2026',active:true};
test('60911 inherits -15 into an existing week despite its different catalogue name; purchases remain',()=>{
  const plan={recapLoaded:false,data:[],genericoData:{rosas:{compraL:66,compraJ:127}}};
  const result=planning.reconcileMissingInheritedProducts(plan,{[row.producto]:-15},[row],active([catalog]));
  assert.equal(result.plan.data.length,1);
  assert.equal(result.plan.data[0].saldo,-15);
  assert.deepEqual(result.plan.genericoData,plan.genericoData);
  assert.equal(plan.data.length,0);
});
test('code uses existing Recap normalization and fallback field',()=>{
  assert.equal(active([catalog])({...row,codeBase:''}),true);
  assert.equal(active([{...catalog,productCode:'060.911'}])(row),true);
});
test('inactive or deleted code is not revived through another matching name',()=>{
  for(const state of [{active:false},{deleted:true}]){
    const check=active([{...catalog,...state},{productCode:'999',productName:row.generico,active:true}]);
    assert.equal(check(row),false);
  }
});
test('legacy exact name remains supported, unknown and deleted products are excluded',()=>{
  assert.equal(active([{...catalog,productName:row.generico}])({...row,codeBase:'',recapCode:''}),true);
  assert.equal(active([])(row),false);
  assert.equal(active([{productName:row.generico,deleted:true}])(row),false);
});

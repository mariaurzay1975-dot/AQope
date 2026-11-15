const test=require('node:test');
const assert=require('node:assert/strict');
const p=require('./stock-planning');
const row=(producto,saldo,extra={})=>({categoria:'ROSAS',generico:'Ethiopia',codeBase:'31056',variantCode:'1',producto,saldo,...extra});
test('borrador automático elimina aliases antiguos y duplicados sin sumar su saldo',()=>{
 const source=[row('Ethiopia_1',-19)];
 const plan={recapLoaded:false,data:[row('Ethiopia-1',2),row('ETHIOPIA_1',-19),row('Ethiopia_1',-19),row('Ethiopia_1',-19,{codeBase:'',variantCode:''})],genericoData:{Ethiopia:{compraL:3}},prevExpedicionProducto:{Ethiopia_1:2}};
 const original=structuredClone(plan);
 const result=p.reconcileMissingInheritedProducts(plan,{'Ethiopia_1':-19},source,()=>true).plan;
 assert.deepEqual(result.data,source);
 assert.deepEqual(result.genericoData,plan.genericoData);
 assert.deepEqual(result.prevExpedicionProducto,plan.prevExpedicionProducto);
 assert.deepEqual(plan,original);
 assert.deepEqual(p.reconcileMissingInheritedProducts(result,{'Ethiopia_1':-19},source,()=>true).plan,result);
});
test('un alias con previsión propia y las composiciones de Recap propio se conservan',()=>{
 const source=[row('Ethiopia_1',-19)],data=[row('Ethiopia-1',2)];
 const plan={recapLoaded:false,data,prevExpedicionProducto:{'Ethiopia-1':4}};
 assert.ok(p.reconcileMissingInheritedProducts(plan,{'Ethiopia_1':-19},source,()=>true).plan.data.some(r=>r.producto==='Ethiopia-1'));
 assert.deepEqual(p.reconcileMissingInheritedProducts({...plan,recapLoaded:true},{'Ethiopia_1':-19},source,()=>true).plan.data,data);
});

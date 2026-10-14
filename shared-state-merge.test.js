const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('./shared-state-merge');
const state=()=>({data:[],nomenclatures:[],productPriceCatalog:{},flowers:[],stock:{L:0,M:0},savedAt:'old'});
test('different fields and new bouquets from two people are combined',()=>{
  const b=state(),l=M.copy(b),r=M.copy(b);l.stock.L=3;r.stock.M=5;
  l.nomenclatures.push({productCode:'A',id:'new-a',stems:2});r.nomenclatures.push({productCode:'B',id:'new-b',stems:4});
  const result=M.merge(b,l,r);assert.equal(result.conflicts.length,0);assert.deepEqual(result.state.stock,{L:3,M:5});assert.equal(result.state.nomenclatures.length,2);assert.equal(b.nomenclatures.length,0);
});
test('same field requires explicit resolution and keeps both values',()=>{
  const b=state(),l=M.copy(b),r=M.copy(b);l.stock.L=3;r.stock.L=5;
  const result=M.merge(b,l,r);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].local,3);assert.equal(result.conflicts[0].remote,5);
  const resolved=M.merge(b,l,r,{[result.conflicts[0].id]:'remote'});assert.equal(resolved.conflicts.length,0);assert.equal(resolved.state.stock.L,5);
});
test('rewritten recipe line IDs cannot concatenate two versions of one bouquet',()=>{
  const b=state();b.nomenclatures=[{productCode:'A',id:'old',stems:1}];const l=M.copy(b),r=M.copy(b);
  l.nomenclatures=[{productCode:'A',id:'local',stems:2}];r.nomenclatures=[{productCode:'A',id:'remote',stems:3}];
  const result=M.merge(b,l,r);assert.equal(result.conflicts.length,1);assert.equal(result.state.nomenclatures.length,1);assert.deepEqual(result.conflicts[0].path,['bouquets','A']);
});
test('choosing remote recipe after local deletion also restores its price catalog',()=>{
  const b=state();b.nomenclatures=[{productCode:'A',id:'old',stems:1}];b.productPriceCatalog.A={priceCount:2,prices:[20,30]};
  const l=M.copy(b),r=M.copy(b);l.nomenclatures=[];delete l.productPriceCatalog.A;r.nomenclatures[0].stems=9;
  const first=M.merge(b,l,r);assert.equal(first.conflicts.length,1);
  const resolved=M.merge(b,l,r,{[first.conflicts[0].id]:'remote'});assert.equal(resolved.state.nomenclatures[0].stems,9);assert.equal(resolved.state.productPriceCatalog.A.priceCount,2);
});
test('deletion versus edit is a conflict; independent deletion is retained',()=>{
  const b=state();b.flowers=[{id:'a',cost:1},{id:'b',cost:2}];const l=M.copy(b),r=M.copy(b);l.flowers.shift();r.flowers[0].cost=4;
  assert.equal(M.merge(b,l,r).conflicts.length,1);r.flowers[0].cost=1;r.flowers[1].cost=3;
  assert.deepEqual(M.merge(b,l,r).state.flowers,[{id:'b',cost:3}]);
});
test('ambiguous IDs and unkeyed arrays fail closed',()=>{
  const b=state();b.values=[1,2];const l=M.copy(b),r=M.copy(b);l.values.push(3);r.values.push(4);assert.equal(M.merge(b,l,r).conflicts.length,1);
  b.flowers=[{id:'a',cost:1},{id:'a',cost:2}];l.flowers=[{id:'a',cost:3}];r.flowers=[{id:'a',cost:4}];assert.ok(M.merge(b,l,r).conflicts.length);
});
test('week selection is local and duplicate top-level week fields do not collide',()=>{
  const b=state();b.currentWeekKey='2026-W40';b.activeWeekKey='2026-W40';b.weekSnapshots={'2026-W40':{year:2026,week:40,data:[],genericoData:{R:{compraL:0}},objetivo:1},'2026-W41':{year:2026,week:41,data:[],genericoData:{R:{compraL:0}},objetivo:2}};
  const l=M.copy(b),r=M.copy(b);l.weekSnapshots['2026-W40'].genericoData.R.compraL=4;r.weekSnapshots['2026-W41'].genericoData.R.compraL=7;r.activeWeekKey='2026-W41';r.data=[{producto:'wrong-week-alias'}];
  const result=M.merge(b,l,r);assert.equal(result.conflicts.length,0);assert.equal(result.state.activeWeekKey,'2026-W40');assert.equal(result.state.genericoData.R.compraL,4);assert.equal(result.state.weekSnapshots['2026-W41'].genericoData.R.compraL,7);assert.deepEqual(result.state.data,[]);
});
test('new independent object keys and equal concurrent changes are safe',()=>{
  const b=state(),l=M.copy(b),r=M.copy(b);l.productPriceCatalog.A={price:1};r.productPriceCatalog.B={price:2};l.stock.L=r.stock.L=9;
  const result=M.merge(b,l,r);assert.equal(result.conflicts.length,0);assert.equal(Object.keys(result.state.productPriceCatalog).length,2);
});
test('changes made during a save survive the successful write',()=>{
  const b=state(),sent=M.copy(b),remote=M.copy(b);sent.stock.L=2;remote.stock.M=4;
  const written=M.merge(b,sent,remote).state,current=M.copy(sent);current.stock.L=8;
  const after=M.merge(sent,current,written);assert.equal(after.conflicts.length,0);assert.deepEqual(after.state.stock,{L:8,M:4});
});

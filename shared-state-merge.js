(function(root){
  'use strict';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function equal(a,b){
    if(a === b) return true;
    if(Array.isArray(a) && Array.isArray(b)) return a.length===b.length && a.every((v,i)=>equal(v,b[i]));
    if(object(a) && object(b)) return Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
    return false;
  }
  const aliases=['data','genericoData','prevExpedicionProducto','simplesPrea','forecastAdjustments','stockInitialBalanceMode','recapLoaded','weekState','groupView','activeWeekKey','planningMode'];
  function canonical(state){
    const result=copy(state);
    delete result.savedAt;
    if(Array.isArray(result.nomenclatures) && result.nomenclatures.every(row=>row.productCode)){
      const products=Object.create(null);
      for(const row of result.nomenclatures){const code=String(row.productCode);products[code]??={lines:[]};products[code].lines.push(row);}
      for(const [code,catalog] of Object.entries(result.productPriceCatalog||{})){products[code]??={lines:[]};products[code].catalog=catalog;}
      result.bouquets=products;delete result.nomenclatures;delete result.productPriceCatalog;
    }
    if(Object.keys(result.weekSnapshots||{}).length){
      aliases.forEach(key=>delete result[key]);
      Object.values(result.weekSnapshots).forEach(week=>delete week.groupView);
    }
    return result;
  }
  function materialize(state,view){
    const result=copy(state);
    if(result.bouquets){
      result.nomenclatures=[];result.productPriceCatalog={};
      for(const [code,product] of Object.entries(result.bouquets)){
        result.nomenclatures.push(...(product.lines||[]));
        if(product.catalog!==undefined)Object.defineProperty(result.productPriceCatalog,code,{value:product.catalog,enumerable:true,writable:true,configurable:true});
      }
      delete result.bouquets;
    }
    const key=result.weekSnapshots?.[view.activeWeekKey] ? view.activeWeekKey : result.currentWeekKey;
    const week=result.weekSnapshots?.[key];
    if(week){
      ['data','genericoData','prevExpedicionProducto','simplesPrea','forecastAdjustments','recapLoaded'].forEach(k=>{result[k]=copy(week[k]);});
      result.activeWeekKey=key;
      result.stockInitialBalanceMode=week.initialBalanceMode;
      result.weekState={year:week.year,week:week.week,objetivo:week.objetivo,acumulado:week.acumulado,baseWeekKey:week.baseWeekKey};
      result.planningMode=!!week.planningMode;
      result.groupView=view.groupView;
    }
    result.savedAt=new Date().toISOString();
    return result;
  }
  function indexArray(arr,key){
    const map=new Map();
    for(const value of arr){
      const id=key(value);
      if(id===undefined || id===null || id==='' || map.has(String(id))) return null;
      map.set(String(id),value);
    }
    return map;
  }
  function merge(base,local,remote,choices={}){
    const conflicts=[];
    function conflict(b,l,r,path){
      const id=JSON.stringify(path);
      if(choices[id]==='remote') return copy(r);
      if(choices[id]==='local') return copy(l);
      conflicts.push({id,path,base:copy(b),local:copy(l),remote:copy(r)});
      return copy(l);
    }
    function walk(b,l,r,path){
      if(equal(l,r)) return copy(l);
      if(equal(b,l)) return copy(r);
      if(equal(b,r)) return copy(l);
      // Recipe and price catalog are a single unit: choosing a recipe must also
      // keep its price count, prices and photo, including delete/edit conflicts.
      if(path.length===2 && path[0]==='bouquets')return conflict(b,l,r,path);
      if(['updatedAt','savedAt'].includes(path.at(-1)) && typeof l==='string' && typeof r==='string') return l>r?l:r;
      if(object(l)&&object(r)&&(object(b)||b===undefined)){
        const result={};
        for(const k of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
          const value=walk(b?.[k],l[k],r[k],[...path,k]);
          if(value!==undefined) Object.defineProperty(result,k,{value,writable:true,enumerable:true,configurable:true});
        }
        return result;
      }
      if(Array.isArray(l)&&Array.isArray(r)&&(Array.isArray(b)||b===undefined)){
        // The editor regenerates recipe line IDs. Treat each complete bouquet as
        // one unit, so two edits to the same recipe cannot create duplicate stems.
        if(path.length===1 && path[0]==='nomenclatures'){
          const group=rows=>{const m=new Map(); for(const row of rows){if(!row.productCode)return null; const k=String(row.productCode);m.set(k,[...(m.get(k)||[]),row]);}return m;};
          const maps=[group(b||[]),group(l),group(r)];
          if(maps.every(Boolean)){
            const result=[];
            for(const k of new Set(maps.flatMap(m=>[...m.keys()]))){
              const [bv,lv,rv]=maps.map(m=>m.get(k));
              const value=equal(lv,rv)?copy(lv):equal(bv,lv)?copy(rv):equal(bv,rv)?copy(lv):conflict(bv,lv,rv,[...path,k]);
              if(value) result.push(...value);
            }
            return result;
          }
        }
        const all=[...(b||[]),...l,...r];
        const field=['id','producto','code'].find(k=>all.length&&all.every(v=>object(v)&&v[k]!==undefined&&v[k]!==''));
        if(field){
          const maps=[indexArray(b||[],v=>v[field]),indexArray(l,v=>v[field]),indexArray(r,v=>v[field])];
          if(maps.every(Boolean)){
            const result=[];
            for(const k of new Set(maps.flatMap(m=>[...m.keys()]))){
              const value=walk(...maps.map(m=>m.get(k)),[...path,k]);
              if(value!==undefined) result.push(value);
            }
            return result;
          }
        }
      }
      return conflict(b,l,r,path);
    }
    const state=materialize(walk(canonical(base),canonical(local),canonical(remote),[]),local);
    return {state,conflicts};
  }
  const api={copy,equal,canonical,materialize,merge};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.AquarelleSharedMerge=api;
})(typeof globalThis!=='undefined'?globalThis:this);

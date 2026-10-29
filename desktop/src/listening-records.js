/* One playback can arrive through several sync snapshots. Identity is evidence,
 * never a guessed time window: link a stable ID OR the same track/start pair. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ListeningRecords=factory();})(globalThis,()=>{
 const ids=p=>[...(p.id!=null?[String(p.id)]:[]),...(Array.isArray(p.syncAliases?.ids)?p.syncAliases.ids.filter(v=>typeof v==='string'&&v&&v.length<=1024).slice(0,512):[])];
 const starts=p=>[p.started,...(Array.isArray(p.syncAliases?.starts)?p.syncAliases.starts.slice(0,512):[])].map(Number).filter(v=>Number.isFinite(v)&&v>0);
 const number=v=>Number.isFinite(Number(v))&&Number(v)>=0?Number(v):0;
 function canonical(rows=[]){
  const groups=[],aliases=new Map(),parents=[];let sequence=0;
  const find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(const p of rows){
   if(!p||p.track==null)continue;
   const keys=[],track=String(p.track),start=number(p.started);
   for(const id of ids(p))if(id)keys.push(JSON.stringify(['id',track,id]));
   for(const at of starts(p))keys.push(JSON.stringify(['start',track,at]));
   const linked=keys.filter(k=>aliases.has(k)).map(k=>find(aliases.get(k)));
   let i=linked[0];if(i===undefined){i=groups.length;parents.push(i);groups.push([]);}
   for(const j of linked)if(find(j)!==find(i))parents[find(j)]=find(i);
   groups[i].push({row:p,order:sequence++});for(const key of keys)aliases.set(key,i);
  }
  const merged=new Map();
  groups.forEach((rows,i)=>{const root=find(i);if(!merged.has(root))merged.set(root,[]);merged.get(root).push(...rows);});
  return [...merged.values()].map(entries=>{
   const rows=entries.sort((a,b)=>a.order-b.order).map(e=>e.row),out={...rows.at(-1)};
   for(const p of rows){
    for(const field of ['heard','duration','media_heard'])if(field in p)out[field]=Math.max(number(out[field]),number(p[field]));
    for(const field of ['finished','skipped'])if(field in p)out[field]=out[field]===1||out[field]===true||p[field]===1||p[field]===true?1:0;
    if(number(p.started)>0)out.started=number(out.started)>0?Math.min(number(out.started),number(p.started)):number(p.started);
    for(const field of ['at','timestamp'])if(field in p)out[field]=Math.max(number(out[field]),number(p[field]));
   }
   // Proven relay links survive JSON round trips; runtime aliases also remap slices.
   const knownIds=[...new Set(rows.flatMap(ids))].sort(),knownStarts=[...new Set(rows.flatMap(starts))].sort((a,b)=>a-b);
   delete out.syncAliases;
   if(knownIds.length>1||knownStarts.length>1)out.syncAliases={ids:knownIds,starts:knownStarts};
   Object.defineProperty(out,'aliases',{value:knownIds});
   return out;
  });
 }
 return {canonical};
});

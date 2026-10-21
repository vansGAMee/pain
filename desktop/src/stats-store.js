// A replayed or older snapshot must not erase coverage or count one play twice.
module.exports=function mergeStats(local={},incoming={}){
 const plays=[],byId=new Map(),byStart=new Map(),aliases=new Map();
 const number=n=>Number.isFinite(Number(n))&&Number(n)>=0?Number(n):0;
 const flag=n=>n===true||n===1?1:0;
 const rows=value=>Array.isArray(value)?value:[];
 for(const p of [...rows(local.plays),...rows(incoming.plays)]){
  if(!p||typeof p.track!=='string'||!p.track||!p.id)continue;
  const start=number(p.started),key=start?p.track+'\0'+start:null;
  let index=byId.get(String(p.id));if(index===undefined&&key)index=byStart.get(key);
  if(index===undefined){index=plays.length;plays.push({...p});}
  else{
   const old=plays[index],merged={...old,...p};
   for(const field of ['heard','duration'])if(field in old||field in p)merged[field]=Math.max(number(old[field]),number(p[field]));
   // Older relays omitted unique coverage; audible wall time is not a substitute.
   if('media_heard' in old||'media_heard' in p)merged.media_heard=Math.max(number(old.media_heard),number(p.media_heard));
   for(const field of ['finished','skipped'])if(field in old||field in p)merged[field]=Math.max(flag(old[field]),flag(p[field]));
   plays[index]=merged;
  }
  byId.set(String(p.id),index);aliases.set(String(p.id),index);if(key)byStart.set(key,index);
 }
 const slices=new Map();
 for(const s of [...rows(local.slices),...rows(incoming.slices)]){
  if(!s||!s.play||!Number.isFinite(s.at)||!Number.isFinite(s.ms)||s.ms<=0)continue;
  const index=aliases.get(String(s.play)),play=index===undefined?s.play:plays[index].id;
  // SQLite row IDs belong to one device, not the merged history.
  slices.set(JSON.stringify([play,s.at,s.ms]),{...s,play});
 }
 return {...local,...incoming,plays,slices:[...slices.values()]};
};

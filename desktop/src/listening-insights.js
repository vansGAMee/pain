/* Descriptive statistics from saved listening, with no inference about emotion or genre. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ListeningInsights=factory();})(globalThis,()=>{
 const DAY=86400000,flag=n=>n===1||n===true;
 const dayKey=stamp=>{const d=new Date(stamp);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const ordinal=stamp=>{const d=new Date(stamp);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;};
 function build(tracks=[],stats={},now=Date.now()){
  const library=new Map(tracks.filter(t=>t?.id!=null).map(t=>[String(t.id),t])),rows=new Map(),aliases=new Map();
  for(const p of Array.isArray(stats.plays)?stats.plays:[]){
   if(!p||p.track==null)continue;
   const started=Number(p.started||p.timestamp),heard=Number(p.heard);
   if(!Number.isFinite(started)||started<=0||started>now||!Number.isFinite(heard)||heard<=0||heard>7*DAY)continue;
   const track=String(p.track),key=JSON.stringify([track,started]),old=rows.get(key);
   rows.set(key,{...old,...p,track,started,heard:Math.max(heard,old?.heard||0),finished:flag(p.finished)||flag(old?.finished)?1:0});
   if(p.id!=null)aliases.set(String(p.id),key);
  }
  const plays=[...rows.values()].sort((a,b)=>a.started-b.started),intervals=new Map();
  for(const s of Array.isArray(stats.slices)?stats.slices:[]){
   if(!s||!Number.isFinite(s.at)||!Number.isFinite(s.ms)||s.at<=0||s.ms<=0||s.ms>7*DAY||s.at>=now)continue;
   const key=aliases.get(String(s.play));if(!key)continue;
   if(!intervals.has(key))intervals.set(key,[]);
   intervals.get(key).push([s.at,Math.min(now,s.at+s.ms)]);
  }
  const days=new Map(),hours=Array(24).fill(0),trackTime=new Map();let totalMs=0;
  function add(start,end,track){
   totalMs+=end-start;trackTime.set(track,(trackTime.get(track)||0)+end-start);
   while(start<end){
    const date=new Date(start),next=new Date(start);next.setMinutes(60,0,0);
    const stop=Math.min(end,next.getTime()),ms=stop-start;
    if(ms<=0)break;
    const key=dayKey(start);days.set(key,(days.get(key)||0)+ms);hours[date.getHours()]+=ms;start=stop;
   }
  }
  for(const [key,p] of rows){
   const spans=(intervals.get(key)||[[p.started,Math.min(now,p.started+p.heard)]]).sort((a,b)=>a[0]-b[0]);
   let merged=null;
   for(const span of spans){
    if(merged&&span[0]<=merged[1])merged[1]=Math.max(merged[1],span[1]);
    else{if(merged)add(...merged,p.track);merged=span.slice();}
   }
   if(merged)add(...merged,p.track);
  }
  const today=new Date(now),monthStart=new Date(today.getFullYear(),today.getMonth(),today.getDate()-29).getTime();
  const calendar=Array.from({length:28},(_,i)=>{const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()-27+i),key=dayKey(date);return {day:key,at:date.getTime(),ms:days.get(key)||0};});
  const first=new Map(),last=new Map(),rituals=new Map(),retained=new Set(),heardLibrary=new Set();let comeback=null;
  for(const p of plays){
   const duration=Number(p.duration||library.get(p.track)?.duration),threshold=duration>0?Math.min(30000,Math.max(1000,duration/2)):30000;
   if(p.heard<threshold)continue; // Previews and accidental clicks are not discoveries or rituals.
   if(library.has(p.track))heardLibrary.add(p.track);
   if(!first.has(p.track))first.set(p.track,p.started);
   if(first.get(p.track)>=monthStart&&dayKey(first.get(p.track))!==dayKey(p.started))retained.add(p.track);
   if(p.started>=calendar[0].at){if(!rituals.has(p.track))rituals.set(p.track,new Set());rituals.get(p.track).add(dayKey(p.started));}
   if(last.has(p.track)&&p.started>=monthStart){
    const gap=ordinal(p.started)-ordinal(last.get(p.track));
    if(gap>=7&&(!comeback||gap>comeback.days||gap===comeback.days&&p.started>comeback.at))comeback={track:p.track,days:gap,at:p.started};
   }
   last.set(p.track,p.started);
  }
  const ritual=[...rituals].map(([track,days])=>({track,days:days.size})).filter(p=>p.days>=2).sort((a,b)=>b.days-a.days||last.get(b.track)-last.get(a.track))[0]||null;
  const discoveries=[...first.values()].filter(stamp=>stamp>=monthStart).length;
  let knownTime=0,outsideFavorites=0,record=null;
  for(const [id,ms] of trackTime)if(library.has(id)){knownTime+=ms;if(!flag(library.get(id).favorite))outsideFavorites+=ms;}
  for(const [day,ms] of days)if(!record||ms>record.ms||ms===record.ms&&day>record.day)record={day,ms};
  return {plays,totalMs,days,hours,calendar,ritual,comeback,record,discoveries,retained:retained.size,
   heardLibrary:heardLibrary.size,librarySize:library.size,outsideFavorites,knownTime};
 }
 return {build,dayKey};
});

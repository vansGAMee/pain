/* Descriptive statistics from saved listening, with no inference about emotion or genre. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./listening-records'));else root.ListeningInsights=factory(root.ListeningRecords);})(globalThis,Records=>{
 const DAY=86400000,flag=n=>n===1||n===true;
 const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const dayKey=stamp=>dateKey(new Date(stamp));
 const ordinal=stamp=>{const d=new Date(stamp);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;};
 function build(tracks=[],stats={},now=Date.now()){
  const library=new Map(),rows=new Map(),aliases=new Map();
  for(const track of tracks)if(track?.id!=null)library.set(String(track.id),track);
  let timeSensitive=false;
  for(const p of Records.canonical(Array.isArray(stats.plays)?stats.plays:[])){
   if(!p||p.track==null)continue;
   const started=Number(p.started||p.timestamp),heard=Number(p.heard);
   if(!Number.isFinite(started)||started<=0||!Number.isFinite(heard)||heard<=0||heard>7*DAY)continue;
   if(started>now){timeSensitive=true;continue;}
   const track=String(p.track),key=JSON.stringify([track,started]),old=rows.get(key);
   const wallTime=Math.max(heard,old?.heard||0);
   const coverage=Number.isFinite(p.media_heard)&&p.media_heard>=0?p.media_heard:-1;
   const previousCoverage=Number.isFinite(old?.media_heard)&&old.media_heard>=0?old.media_heard:-1;
   const mediaTime=Math.max(coverage,previousCoverage);
   rows.set(key,{...old,...p,track,started,heard:wallTime,media_heard:mediaTime>=0?mediaTime:wallTime,finished:flag(p.finished)||flag(old?.finished)?1:0,skipped:flag(p.skipped)||flag(old?.skipped)?1:0});
   for(const id of p.aliases)aliases.set(id,key);
  }
  const plays=[...rows.values()].sort((a,b)=>a.started-b.started),intervals=new Map();
  for(const s of Array.isArray(stats.slices)?stats.slices:[]){
   if(!s||!Number.isFinite(s.at)||!Number.isFinite(s.ms)||s.at<=0||s.ms<=0||s.ms>7*DAY)continue;
   const key=aliases.get(String(s.play));if(!key)continue;
   const end=s.at+s.ms;
   if(end>now)timeSensitive=true;
   if(s.at>=now)continue;
   let spans=intervals.get(key);
   if(!spans)intervals.set(key,spans=[]);
   spans.push([s.at,Math.min(now,end)]);
  }
  const days=new Map(),hours=Array(24).fill(0),weekdayHours=Array.from({length:7},()=>Array(24).fill(0)),dayHours=new Map(),trackTime=new Map(),trackDays=new Map(),playTime=new Map();let totalMs=0;
  function add(start,end,track){
   totalMs+=end-start;trackTime.set(track,(trackTime.get(track)||0)+end-start);
   while(start<end){
    const date=new Date(start),hour=date.getHours(),weekday=date.getDay(),key=dateKey(date);
    const stop=Math.min(end,date.setMinutes(60,0,0)),ms=stop-start;
    if(ms<=0)break;
    days.set(key,(days.get(key)||0)+ms);hours[hour]+=ms;weekdayHours[weekday][hour]+=ms;
    let dailyHours=dayHours.get(key),byTrack=trackDays.get(key);
    if(!dailyHours)dayHours.set(key,dailyHours=Array(24).fill(0));
    if(!byTrack)trackDays.set(key,byTrack=new Map());
    dailyHours[hour]+=ms;
    byTrack.set(track,(byTrack.get(track)||0)+ms);
    start=stop;
   }
  }
  for(const [key,p] of rows){
   let spans=intervals.get(key);
   if(!spans){
    const end=p.started+p.heard;
    if(end>now)timeSensitive=true;
    spans=[[p.started,Math.min(now,end)]];
   }
   if(spans.length>1)spans.sort((a,b)=>a[0]-b[0]);
   let merged=null,heard=0;
   for(const span of spans){
    if(merged&&span[0]<=merged[1])merged[1]=Math.max(merged[1],span[1]);
    else{if(merged){add(...merged,p.track);heard+=merged[1]-merged[0];}merged=span.slice();}
   }
   if(merged){add(...merged,p.track);heard+=merged[1]-merged[0];}
   playTime.set(key,heard);
  }
  const today=new Date(now),monthStart=new Date(today.getFullYear(),today.getMonth(),today.getDate()-29).getTime();
  const calendar=Array.from({length:28},(_,i)=>{const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()-27+i),key=dateKey(date);return {day:key,at:date.getTime(),ms:days.get(key)||0};});
  const first=new Map(),last=new Map(),rituals=new Map(),retained=new Set(),heardLibrary=new Set(),counts=new Map();
  let comeback=null,qualified=0,completed=0,early=0,other=0,replayed=0;
  for(const p of plays){
   const track=library.get(p.track),duration=Number(p.duration||track?.duration),threshold=duration>0?Math.min(30000,Math.max(1000,duration/2)):30000;
   if(duration>0&&p.media_heard>=duration*.9)completed++;
   else if(flag(p.skipped)&&p.heard<30000)early++;
   else if(flag(p.skipped)||flag(p.finished))other++;
   if(p.heard<threshold)continue; // Previews and accidental clicks are not discoveries or rituals.
   const count=counts.get(p.track)||0;
   qualified++;if(count)replayed++;counts.set(p.track,count+1);
   if(track)heardLibrary.add(p.track);
   let firstAt=first.get(p.track);
   if(firstAt===undefined)first.set(p.track,firstAt=p.started);
   const previous=last.get(p.track);
   if(p.started>=monthStart){
    const date=dayKey(p.started);
    if(firstAt>=monthStart&&firstAt!==p.started&&dayKey(firstAt)!==date)retained.add(p.track);
    if(p.started>=calendar[0].at){
     let ritualDays=rituals.get(p.track);
     if(!ritualDays)rituals.set(p.track,ritualDays=new Set());
     ritualDays.add(date);
    }
   }
   if(previous!==undefined&&p.started>=monthStart){
    const gap=ordinal(p.started)-ordinal(previous);
    if(gap>=7&&(!comeback||gap>comeback.days||gap===comeback.days&&p.started>comeback.at))comeback={track:p.track,days:gap,at:p.started};
   }
   last.set(p.track,p.started);
  }
  const ritual=[...rituals].map(([track,days])=>({track,days:days.size})).filter(p=>p.days>=2).sort((a,b)=>b.days-a.days||last.get(b.track)-last.get(a.track))[0]||null;
  const discoveries=[...first.values()].filter(stamp=>stamp>=monthStart).length;
  let knownTime=0,outsideFavorites=0,record=null;
  for(const [id,ms] of trackTime)if(library.has(id)){knownTime+=ms;if(!flag(library.get(id).favorite))outsideFavorites+=ms;}
  for(const [day,ms] of days)if(!record||ms>record.ms||ms===record.ms&&day>record.day)record={day,ms};
  const active=[...days].filter(([,ms])=>ms>=60000).map(([day])=>day).sort();let streak=0,longestStreak=0,run=0,previous=null;
  for(const day of active){const at=Date.parse(day);run=previous!==null&&at-previous===DAY?run+1:1;longestStreak=Math.max(longestStreak,run);previous=at;}
  const activeSet=new Set(active),cursor=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  if(!activeSet.has(dateKey(cursor)))cursor.setDate(cursor.getDate()-1);
  while(activeSet.has(dateKey(cursor))){streak++;cursor.setDate(cursor.getDate()-1);}
  const behavior={qualified,completed,early,other,replayed,newPlays:counts.size,streak,longestStreak,counts:Object.fromEntries(counts)};
  const details={plays,totalMs,days,hours,calendar,ritual,comeback,record,discoveries,retained:retained.size,behavior,trackTime,trackDays,weekdayHours,dayHours,playTime,
   heardLibrary:heardLibrary.size,librarySize:library.size,outsideFavorites,knownTime};
  // Desktop can reuse settled statistics within the same local day.
  return Object.defineProperty(details,'timeSensitive',{value:timeSensitive});
 }
 return {build,dayKey};
});

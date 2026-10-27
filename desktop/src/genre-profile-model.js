'use strict';
const aliases={'hip-hop':'hip hop','hiphop':'hip hop','rnb':'r&b','rhythm and blues':'r&b','post punk':'post-punk','synth pop':'synth-pop','synthpop':'synth-pop'};
Object.assign(aliases,{'рок':'rock','поп-музыка':'pop','альтернативный рок':'alternative rock','альтернативный метал':'alternative metal','инди-рок':'indie rock','постпанк':'post-punk','пост-панк':'post-punk','нью-вейв':'new wave','синти-поп':'synth-pop','поп-рок':'pop rock','панк-рок':'punk rock','хард-рок':'hard rock','готик-рок':'gothic rock','гранж':'grunge','шугейз':'shoegaze','дрим-поп':'dream pop','хип-хоп':'hip hop','рэп':'rap','хеви-метал':'heavy metal','ню-метал':'nu metal','фолк-рок':'folk rock','электронная музыка':'electronic','эмбиент':'ambient','электропоп':'electropop','арт-рок':'art rock','классическая музыка':'classical','джаз':'jazz'});
function normalize(value){
 const list=Array.isArray(value)?value:String(value||'').split(/[;,/|\u0000]+/);
 return [...new Set(list.map(s=>String(s).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()).filter(s=>s.length<=80&&/\p{L}/u.test(s)&&!/[<>]|https?:|www\./i.test(s)&&!/^(?:unknown|other|misc|music|genre|неизвестно|неизвестный|другое|разное|музыка|n\/a)$/i.test(s)).map(s=>aliases[s]||s))];
}
function build(tracks,details,entries,range='all',now=Date.now()){
 const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-27);
 const dayKey=require('./listening-insights').dayKey,first=dayKey(start),byId=new Map(tracks.map(t=>[String(t.id),t]));
 const genreFor=id=>normalize(entries[id]?.names?.length?entries[id].names:byId.get(id)?.genre);
 const totals=new Map(),bins=Array.from({length:4},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i*7);return {day:dayKey(d),total:0,genres:new Map()};});
 const listened=new Set(),known=new Set();let total=0,identified=0;
 const add=(map,names,ms)=>{for(const name of names.length?names:[''])map.set(name,(map.get(name)||0)+ms/(names.length||1));};
 for(const [day,rows] of details.trackDays){
  const bin=day>=first?bins.findLast(b=>day>=b.day):null;
  for(const [id,ms] of rows){
   const names=genreFor(id);
   if(bin){bin.total+=ms;add(bin.genres,names,ms);}
   if(range==='28'&&day<first)continue;
   total+=ms;listened.add(id);if(names.length){known.add(id);identified+=ms;}
   add(totals,names,ms);
  }
 }
 const sorted=map=>[...map].map(([name,ms])=>({name,ms})).sort((a,b)=>b.ms-a.ms||a.name.localeCompare(b.name));
 return {total,identified,known:known.size,listened:listened.size,genres:sorted(totals),weeks:bins.map(b=>({...b,genres:sorted(b.genres)}))};
}
module.exports={normalize,build};

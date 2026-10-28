(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TrackLeaderboard=factory();})(globalThis,()=>{
 function bounds(period,now){
  const d=new Date(now),year=d.getFullYear();
  if(period==='this-year')return [new Date(year,0,1).getTime(),now+1];
  if(period==='this-month')return [new Date(year,d.getMonth(),1).getTime(),now+1];
  if(/^year:\d{4}$/.test(period)){const y=Number(period.slice(5));return [new Date(y,0,1).getTime(),Math.min(now+1,new Date(y+1,0,1).getTime())];}
  if(['7','30','90','365'].includes(period))return [now-Number(period)*86400000,now+1];
  return [0,now+1];
 }
 function rank(tracks,plays,period='all',now=Date.now()){
  const library=new Map(tracks.map(t=>[String(t.id),t])),seen=new Map(),counts=new Map(),[start,end]=bounds(period,now),years=new Set();
  for(const p of plays||[]){
   const at=Number(p?.started||p?.timestamp),heard=Number(p?.heard),id=String(p?.track),track=library.get(id);
   if(!track||!(at>0)||at>now||!(heard>0))continue;
   const duration=Number(p.duration||track.duration),threshold=duration>0?Math.min(30000,Math.max(1000,duration/2)):30000;
   if(heard<threshold)continue;
   const key=JSON.stringify([id,at]);if(seen.has(key))continue;seen.set(key,true);
   years.add(new Date(at).getFullYear());if(at<start||at>=end)continue;
   const row=counts.get(id)||{track,count:0,last:0};row.count++;row.last=Math.max(row.last,at);counts.set(id,row);
  }
  return {rows:[...counts.values()].sort((a,b)=>b.count-a.count||b.last-a.last||String(a.track.id).localeCompare(String(b.track.id))).slice(0,50),years:[...years].sort((a,b)=>b-a),total:[...counts.values()].reduce((sum,r)=>sum+r.count,0)};
 }
 return {rank,bounds};
});

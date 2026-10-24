/* Read-only home summaries and an isolated preview of the existing Smart DJ. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./listening-insights'),require('./queue-engine'));else root.HomeModel=factory(root.ListeningInsights,root.QueueEngine);})(globalThis,(Insights,Queue)=>{
 const DAY=86400000;
 function build(tracks=[],stats={},now=Date.now()){
  const library=new Map(tracks.filter(t=>t?.id!=null).map(t=>[String(t.id),t]));
  const details=Insights.build([...library.values()],stats,now),first=new Map(),last=new Map();
  for(const p of details.plays){
   const t=library.get(p.track),duration=Number(p.duration||t?.duration);
   if(!t||p.heard<(duration>0?Math.min(30000,Math.max(1000,duration/2)):30000))continue;
   if(!first.has(p.track))first.set(p.track,p.started);last.set(p.track,p.started);
  }
  const recent=[...last].sort((a,b)=>b[1]-a[1]).map(([id])=>library.get(id));
  const fresh=[...first].filter(([,at])=>now-at<=30*DAY).sort((a,b)=>b[1]-a[1]).map(([id])=>library.get(id));
  const past=[...last].filter(([,at])=>now-at>=7*DAY).sort((a,b)=>(details.behavior.counts[b[0]]||0)-(details.behavior.counts[a[0]]||0)||b[1]-a[1]).map(([id])=>library.get(id));
  const favorites=[...library.values()].filter(t=>t.favorite===1||t.favorite===true).sort((a,b)=>(last.get(String(b.id))||0)-(last.get(String(a.id))||0));
  return {details,library,recent,fresh,past,favorites,first,last,
   todayMs:details.days.get(Insights.dayKey(now))||0,
   week:details.calendar.slice(-7),weekMs:details.calendar.slice(-7).reduce((sum,d)=>sum+d.ms,0)};
 }
 function mix(tracks,live,limit=6,variation=0){
  if(!live||!tracks.length)return [];
  const q=new Queue({shuffleMode:'smart',loopMode:'off',stats:live.stats,bpmCache:live.bpmCache,
   audioProfiles:live.audioProfiles,excludedTracks:live.excludedTracks,now:live.now});
  const allowed=tracks.filter(t=>t?.id!=null&&!q.isExcluded(t.id));if(!allowed.length)return [];
  const anchor=live.getCurrentTrack(),index=allowed.findIndex(t=>String(t.id)===String(anchor?.id));
  q.setContext('library',allowed,Math.max(0,index),'Smart DJ');
  q.smartSeed=(live.smartSeed+Math.imul(variation,2654435761))>>>0;q.smartStep=live.smartStep;
  q.setVibeProfile(live.vibeProfile);
  if(index<0){q.currentIndex=-1;q.resetCycle();}
  else{
   q.currentStartedAt=live.currentStartedAt;
   const indices=new Map(allowed.map((t,i)=>[String(t.id),i]));
   q.playedHistory=live.playedHistory.map(i=>indices.get(String(live.tracks[i]?.id))).filter(i=>i!==undefined);
   q.recentArtists=[...live.recentArtists];
  }
  const result=[];for(let i=0;i<Math.min(12,Math.max(0,limit));i++){
   const track=q.next();if(!track)break;
   result.push({track,decision:q.getLastTransition()});
  }
  // A single-song library still has a usable play action, without a fake reason.
  if(!result.length&&allowed.length===1&&limit>0)result.push({track:allowed[0],decision:null});
  return result;
 }
 return {build,mix};
});

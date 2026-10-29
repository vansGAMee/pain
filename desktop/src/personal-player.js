/* Player adapter for the separate whole-history mode. Decisions are captured once. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PersonalPlayer=factory();})(globalThis,()=>{
 let preparing=false;
 async function request(payload){const response=await fetch('/api/personal/recommend',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'personal'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||'Personal recommender unavailable');return result;}
 const payload=(q,eligible,length)=>({eligible,length,scope:JSON.stringify([q.context.type,q.tracks.map(t=>String(t.id))]),kind:length===1?'next':'mix',seed:(q.smartSeed+Math.imul(q.smartStep,2654435761))>>>0,now:q.now(),offset:new Date().getTimezoneOffset(),vibe:q.pulseflowVibe});
 function choice(q,row){const index=q.tracks.findIndex(t=>String(t.id)===String(row.id));if(index<0||q.isExcluded(row.id))throw Error('Ineligible personal recommendation');return {...row,index,track:q.tracks[index]};}
 async function next(q,query=request){
  if(q.previewChoice()){preparing=false;const track=q.next();return {trackId:track?.id??null,navigation:q.navigationSnapshot()};}
  preparing=false;q.forwardHistory=q.forwardHistory.filter(i=>!q.isExcluded(q.tracks[i]?.id));
  if(q.loopMode==='one'||q.forwardHistory.length||!q.smartCandidates().length){const t=q.next({fallback:true});return {trackId:t?.id??null,navigation:q.navigationSnapshot()};}
  let plan=q.pulseflowPlan?.preview?q.pulseflowPlan:null;
  const allowed=new Set(q.smartCandidates().map(i=>String(q.tracks[i].id)));
  if(plan)plan={...plan,remaining:plan.remaining.filter(r=>allowed.has(String(r.id)))};
  let row=plan?.remaining[0];
  if(!row){const response=await query(payload(q,[...allowed],1));preparing=!!response.preparing;
   if(preparing){const track=q.next({fallback:true});return {trackId:track?.id??null,navigation:q.navigationSnapshot()};}
   row=response.tracks[0];}
  if(!row||!allowed.has(String(row.id)))throw Error('Ineligible personal recommendation');
  const selected=choice(q,row);q.pulseflowPlan=plan?{...plan,remaining:plan.remaining.slice(1)}:null;
  q.smartChoose=()=>selected;const track=q.next();return {trackId:track?.id??null,navigation:q.navigationSnapshot()};
 }
 async function mix(tracks,q,length,query=request){
  preparing=false;
  const current=q.getCurrentTrack(),eligible=tracks.filter(t=>String(t.id)!==String(current?.id)&&!q.isExcluded(t.id)).map(t=>String(t.id));
  const allowed=new Set(eligible),response=await query(payload(q,eligible,length));preparing=!!response.preparing;
  let rows=response.tracks;
  if(preparing){
   rows=[];const remaining=q.tracks.map((t,i)=>allowed.has(String(t.id))?i:-1).filter(i=>i>=0);
   while(remaining.length&&rows.length<length){const item=q.frequencyChoose(remaining);if(!item)break;rows.push({id:item.track.id,reasons:['Модель готовится · частотный подбор'],explanation:{method:'personal-taste-fallback',plays:item.explanation.plays}});remaining.splice(remaining.indexOf(item.index),1);}
  }
  return rows.map(row=>{if(!allowed.has(String(row.id)))throw Error('Ineligible personal recommendation');const selected=choice(q,row);return {track:selected.track,decision:{fromTrack:null,toTrack:selected.track,reasons:selected.reasons,explanation:selected.explanation}};});
 }
 return {next,mix,isPreparing:()=>preparing};
});

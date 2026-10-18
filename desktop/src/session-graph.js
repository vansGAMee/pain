/* Personal song associations from independent listening sessions, never remote data. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SessionGraph=factory();})(globalThis,()=>{
 class SessionGraph {
  constructor(events=[],now=Date.now()){
   this.neighbors=new Map();
   const counts=new Map(),edges=new Map(),records=new Set();
   let recent=[],sessionTracks=new Set(),sessionPairs=new Set(),start=0,last=0;
   const rows=events.filter(e=>e&&e.id!=null&&Number.isFinite(e.started)&&e.started>0&&e.started<=now).sort((a,b)=>a.started-b.started).slice(-6000);
   for(const row of rows){
    const id=String(row.id),record=JSON.stringify([id,row.started]);
    if(records.has(record))continue;records.add(record);
    if(!start||row.started-last>30*60000||row.started-start>2*3600000){recent=[];sessionTracks=new Set();sessionPairs=new Set();start=row.started;}
    last=row.started;
    if(row.skipped||!Number.isFinite(row.quality)||row.quality<.75){recent=[];continue;}
    const weight=Math.exp(-(now-row.started)/(90*86400000));
    if(!sessionTracks.has(id)){counts.set(id,(counts.get(id)||0)+weight);sessionTracks.add(id);}
    for(const previous of recent){
     if(previous.id===id)continue;
     const key=JSON.stringify([id,previous.id].sort());if(sessionPairs.has(key))continue;sessionPairs.add(key);
     const edge=edges.get(key)||{a:id,b:previous.id,weight:0,support:0};
     edge.weight+=Math.min(weight,previous.weight);edge.support++;edges.set(key,edge);
    }
    recent=recent.filter(p=>p.id!==id);recent.push({id,weight});if(recent.length>5)recent.shift();
   }
   for(const edge of edges.values()){
    if(edge.support<2)continue;
    const similarity=Math.min(1,edge.weight/Math.sqrt(counts.get(edge.a)*counts.get(edge.b)))*edge.weight/(edge.weight+3);
    for(const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]){
     if(!this.neighbors.has(a))this.neighbors.set(a,new Map());this.neighbors.get(a).set(b,similarity);
    }
   }
   // Bound scoring cost even for a large collection and long listening history.
   for(const [id,neighbors] of this.neighbors)this.neighbors.set(id,new Map([...neighbors].sort((a,b)=>b[1]-a[1]).slice(0,24)));
  }
  affinity(seedIds,candidateId){
   const candidate=String(candidateId),seeds=[...new Set(seedIds.filter(id=>id!=null).map(String))].slice(0,4);
   if(seeds.includes(candidate))return 0;
   let total=0,normalizer=0;
   for(let i=0;i<seeds.length;i++){
    const near=this.neighbors.get(seeds[i]);if(!near)continue;
    let score=near.get(candidate)||0;
    for(const [bridge,first] of near){
     const second=this.neighbors.get(bridge)?.get(candidate)||0;
     score=Math.max(score,.5*first*second);
    }
    const weight=1/(i+1);total+=score*weight;normalizer+=weight;
   }
   return normalizer?Math.min(1,total/normalizer):0;
  }
 }
 return SessionGraph;
});

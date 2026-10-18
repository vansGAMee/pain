/* Personal logistic ranker. Fits only local listening evidence; no remote model. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TasteModel=factory();})(globalThis,()=>{
 const clean=s=>String(s||'').trim().toLowerCase();
 const sigmoid=x=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
 const knownBpm=(t,cache)=>{const n=Number(cache?.[t.id]||t.bpm);return n>=40&&n<=240?n:null;};
 class TasteModel {
  constructor(tracks=[],plays=[],now=Date.now()){
   this.weights=new Map();this.counts=new Map();this.artistCounts=new Map();this.now=now;
   const byId=new Map(tracks.map(t=>[t.id,t])),seen=new Set();
   const samples=[];let previous=null;
   for(const p of [...plays].sort((a,b)=>(a.started||0)-(b.started||0)).slice(-6000)){
    const track=byId.get(p.track),stamp=Number(p.started||p.timestamp||0),id=p.track+'|'+stamp;
    if(!track||!stamp||seen.has(id))continue;seen.add(id);
    const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
    const explicit=p.finished===1||p.completed===true||p.completed===1;
    // Pauses, buffering, unknown duration and sub-second accidental clicks are not dislikes.
    if(!explicit&&(!Number.isFinite(heard)||heard<1000||!(duration>0)))continue;
    const target=explicit?1:Math.min(1,heard/duration);
    const from=previous&&stamp-previous.stamp<30*60*1000?previous.track:null;
    const features=this.features(track,new Date(stamp).getHours(),from);
    const weight=Math.exp(-Math.max(0,now-stamp)/(90*86400000));
    samples.push({features,target,weight});this.counts.set(track.id,(this.counts.get(track.id)||0)+weight);
    const artist=clean(track.artist);this.artistCounts.set(artist,(this.artistCounts.get(artist)||0)+weight);
    previous={track,stamp};
   }
   this.samples=samples.length;
   // Sparse SGD with L2 shrinkage: learned coefficients, not hand-written mood scores.
   for(let epoch=0;epoch<5;epoch++)for(const sample of samples){
    const error=(sample.target-this.predictFeatures(sample.features))*sample.weight;
    const rate=.16/Math.sqrt(1+epoch);
    for(const [key,value] of sample.features){const old=this.weights.get(key)||0;this.weights.set(key,old+rate*(error*value-.018*old));}
   }
  }
  features(track,hour,from){
   const artist=clean(track.artist),album=clean(track.album),genre=clean(track.genre),slot=Math.floor(hour/4);
   const f=[['bias',1],['track:'+track.id,1]];
   if(artist){f.push(['artist:'+artist,1],['hour:'+slot+':'+artist,.8]);}
   if(album&&artist)f.push(['album:'+artist+':'+album,.65]);
   if(genre)f.push(['genre:'+genre,.65]);
   if(from&&artist&&clean(from.artist))f.push(['transition:'+clean(from.artist)+'>'+artist,.7]);
   if(track.favorite)f.push(['favorite',1]);
   return f;
  }
  predictFeatures(features){return sigmoid(features.reduce((s,[k,v])=>s+(this.weights.get(k)||0)*v,0));}
  score(current,candidate,cache={},context={}){
   const hour=context.hour??new Date().getHours(),n=this.counts.get(candidate.id)||0;
   const p=this.predictFeatures(this.features(candidate,hour,current));
   let score=p*100;const reasons=[];
   if(this.samples&&p>.58)reasons.push('По вашим дослушиваниям');
   if(!n&&(this.artistCounts.get(clean(candidate.artist))||0)>2&&p>.55)reasons.push('Новое у знакомого исполнителя');
   // Modest exploration and spacing keep a learned preference from becoming a repeat trap.
   score+=5/Math.sqrt(1+n);if(!this.samples&&candidate.favorite)score+=5;
   const artist=clean(candidate.artist),recent=context.recentArtists||[];
   if(artist&&artist===clean(current?.artist))score-=9;
   else if(artist&&recent.slice(-3).includes(artist))score-=4;
   const a=current?knownBpm(current,cache):null,b=knownBpm(candidate,cache);
   const dist=a&&b?Math.min(Math.abs(a-b),Math.abs(a*2-b),Math.abs(a-b*2)):null;
   if(dist!==null){score+=6*Math.exp(-dist/12);if(dist<8)reasons.push('Близкий темп');}
   if(!reasons.length)reasons.push(this.samples?'Расширяем подбор':'Знакомимся с вашим вкусом');
   return {score,bpm:b,dist,reasons:reasons.slice(0,2),probability:p};
  }
 }
 TasteModel.knownBpm=knownBpm;return TasteModel;
});

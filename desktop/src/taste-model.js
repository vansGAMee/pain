/* Personal logistic ranker. Fits only local listening evidence; no remote model. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TasteModel=factory();})(globalThis,()=>{
 const SessionGraph=typeof module==='object'&&module.exports?require('./session-graph'):globalThis.SessionGraph;
 const Sound=typeof module==='object'&&module.exports?require('./audio-profile'):globalThis.AudioProfile;
 const clean=s=>String(s||'').trim().toLowerCase();
 // Untrusted source/placeholder tags must never create a shared artist preference.
 const trustedArtist=value=>{
  const name=clean(value).normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ');
  // Match whole source labels, including common client/platform/version variants.
  // Never reject an artist merely because the name contains "gram".
  const source=name.replace(/[\p{P}\p{S}\s]+/gu,'');
  if(/^(?:ayugram|aiogram|ayogram|аюграм|айуграм|айограм|telegram|телеграм|телеграмм|nekogram|некограм|nekox|nicegram|найсграм|exteragram|экстераграм|kotatogram|котатограм|forkgram|форкграм|cherrygram|bgram|unigram|юниграм|64gram|plusmessenger|graphmessenger)(?:desktop|android|ios|windows|linux|macos|mobile|app|client|beta|alpha|premium|official|десктоп|андроид|клиент|x){0,2}(?:v?\d{1,12})?$/.test(source))return '';
  if(!name||/^(unknown(?: artist)?|неизвестн(?:ый исполнитель|ый артист|о)|various(?: artists)?|разные исполнители|сборник|n\/a|null|none|без исполнителя|исполнитель|artist|track|audio|аудиозапись|telegram|телеграм|телеграмм|youtube|ютуб|vk|вконтакте)$/i.test(name))return '';
  if(/https?:\/\/|www\.|(?:t\.me|telegram\.me|telegram\.org)\/|(?:^|\s)@[\w.]+|(?:скачано|скачать|downloaded|download from)|(?:telegram|телеграм)[\s:|/—-]+(?:канал|channel|music|музыка)/i.test(name))return '';
  if(/(?:^|[\s[(])(?:[\p{L}\d-]+\.)+(?:com|net|org|ru|su|me|cc|io|ua|рф)(?:$|[\s/\])])/iu.test(name))return '';
  return name;
 };
 const skipIdentity=track=>trustedArtist(track.artist)||'track:'+track.id;
 const sigmoid=x=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
 const knownBpm=(t,cache)=>{const n=Number(cache?.[t.id]||t.bpm);return n>=40&&n<=240?n:null;};
 class TasteModel {
  constructor(tracks=[],plays=[],now=Date.now(),audioProfiles={}){
   this.audioProfiles=audioProfiles;
   this.weights=new Map();this.counts=new Map();this.artistCounts=new Map();this.now=now;this.evidence=new Map();this.recentSkips=[];
   this.recentWeights=new Map();this.recentCounts=new Map();this.recentArtistCounts=new Map();
   const byId=new Map(tracks.map(t=>[t.id,t])),seen=new Set();
   const samples=[],sessionEvents=[];this.lastQuality=new Map();let previous=null;
   for(const p of [...plays].sort((a,b)=>(a.started||0)-(b.started||0)).slice(-6000)){
    const track=byId.get(p.track),stamp=Number(p.started||p.timestamp||0),id=p.track+'|'+stamp;
    if(!track||!stamp||seen.has(id))continue;seen.add(id);
    const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
    const explicit=p.finished===1||p.completed===true||p.completed===1;
    // Pauses, buffering, unknown duration and sub-second accidental clicks are not dislikes.
    if(!explicit&&(!Number.isFinite(heard)||heard<1000||!(duration>0)))continue;
    const target=explicit?1:Math.min(1,heard/duration);
    sessionEvents.push({id:track.id,started:stamp,quality:target,skipped:p.skipped===1&&target<.75});
    this.lastQuality.set(String(track.id),target);
    const from=previous&&stamp-previous.stamp<30*60*1000?previous.track:null;
    const features=this.features(track,new Date(stamp).getHours(),from);
    const weight=Math.exp(-Math.max(0,now-stamp)/(90*86400000));
    const recentWeight=Math.exp(-Math.max(0,now-stamp)/(7*86400000));
    samples.push({features,target,weight,recentWeight,id:track.id});
    this.recentCounts.set(track.id,(this.recentCounts.get(track.id)||0)+recentWeight);
    const recentArtist=trustedArtist(track.artist);
    if(recentArtist)this.recentArtistCounts.set(recentArtist,(this.recentArtistCounts.get(recentArtist)||0)+recentWeight);
    const evidence=this.evidence.get(track.id)||{count:0,reward:0,last:0};
    evidence.count+=weight;evidence.reward+=target*weight;evidence.last=Math.max(stamp,evidence.last);this.evidence.set(track.id,evidence);this.counts.set(track.id,(this.counts.get(track.id)||0)+weight);
    const artist=trustedArtist(track.artist);if(artist)this.artistCounts.set(artist,(this.artistCounts.get(artist)||0)+weight);
    // Temporary intent: explicit early skips can mean "not this mood right now".
    if(p.skipped===1 && target<.25 && now-stamp>=0 && now-stamp<10*60000){
      this.recentSkips.push(skipIdentity(track));this.recentSkips=this.recentSkips.slice(-2);
    }else this.recentSkips=[];
    previous={track,stamp};
   }
   this.samples=samples.length;
   this.sessionGraph=new SessionGraph(sessionEvents,now);
   // Sparse SGD with L2 shrinkage: learned coefficients, not hand-written mood scores.
   for(let epoch=0;epoch<5;epoch++)for(const sample of samples){
    const error=(sample.target-this.predictFeatures(sample.features))*sample.weight/Math.sqrt(1+(this.counts.get(sample.id)||0)/8);
    const rate=.16/Math.sqrt(1+epoch);
    for(const [key,value] of sample.features){const old=this.weights.get(key)||0;this.weights.set(key,old+rate*(error*value-.018*old));}
    if(sample.recentWeight>.02){
      const recentError=(sample.target-this.predictFeatures(sample.features,this.recentWeights))*sample.recentWeight/Math.sqrt(1+(this.recentCounts.get(sample.id)||0)/8);
      for(const [key,value] of sample.features){const old=this.recentWeights.get(key)||0;this.recentWeights.set(key,old+rate*(recentError*value-.018*old));}
    }
   }
  }
  features(track,hour,from){
   const artist=trustedArtist(track.artist),album=clean(track.album),genre=clean(track.genre),slot=Math.floor(hour/4);
   const f=[['bias',1],['track:'+track.id,1]];
   if(artist){f.push(['artist:'+artist,1],['hour:'+slot+':'+artist,.8]);}
   if(album&&artist)f.push(['album:'+artist+':'+album,.65]);
   if(genre)f.push(['genre:'+genre,.65]);
   if(from&&artist&&trustedArtist(from.artist))f.push(['transition:'+trustedArtist(from.artist)+'>'+artist,.7]);
   const sound=Sound.get(this.audioProfiles,track);
   if(sound) sound.vector.forEach((value,i)=>f.push(['sound:'+i,(value-.5)*.8]));
   // Hearts do not become a shortcut: learn from actual listening instead.
   return f;
  }
  predictFeatures(features,weights=this.weights){return sigmoid(features.reduce((s,[k,v])=>s+(weights.get(k)||0)*v,0));}
  choose(current,candidates,cache={},context={}){
   // Seeded sampling makes peek and next agree, while each queue visit draws anew.
   let seed=(context.seed??1)>>>0;
   const random=()=>{seed=(seed+0x6d2b79f5)>>>0;let z=seed;z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);return ((z^(z>>>14))>>>0)/4294967296;};
   let pool=candidates.map(track=>({track,...this.score(current,track,cache,context)}));
   if(!pool.length)return null;
   // Reserve one turn in four for discovery when safe candidates exist.
   const pivot=this.recentSkips.length>=2;
   const discovery=pivot||(context.step??0)%4===3;let discovering=false;
   if(discovery){
    const fresh=pool.filter(item=>{
     const e=this.evidence.get(item.track.id);
     if(e&&e.count>=1.5&&e.reward/e.count<.25)return false;
     return !e||e.count<1.5||this.now-e.last>21*86400000;
    });
    if(fresh.length){pool=fresh;discovering=true;}
   }
   const differentMood=pool.filter(item=>!this.recentSkips.includes(skipIdentity(item.track)));
   if(differentMood.length)pool=differentMood;
   const recent=context.recentArtists||[];
   const diverse=pool.filter(item=>!recent.slice(-2).includes(trustedArtist(item.track.artist)));
   if(diverse.length)pool=diverse;
   // Balance artist probability mass: a huge discography is not extra evidence of taste.
   const artistKey=track=>{
    const artist=trustedArtist(track.artist);
    return !artist||artist==='unknown artist'||artist==='неизвестный исполнитель'?'track:'+track.id:'artist:'+artist;
   };
   const poolCounts=new Map();
   for(const item of pool){const key=artistKey(item.track);poolCounts.set(key,(poolCounts.get(key)||0)+1);}
   // Gumbel sampling explores uncertainty without discarding learned preference.
   let winner=null,best=-Infinity;
   for(const item of pool){
    const n=this.counts.get(item.track.id)||0;
    const artistEvidence=trustedArtist(item.track.artist)?this.artistCounts.get(trustedArtist(item.track.artist))||0:0;
    const uncertainty=discovery?10/Math.sqrt(1+n+Math.min(8,artistEvidence)*.25):0;
    const catalogCorrection=9*Math.log(poolCounts.get(artistKey(item.track)));
    const value=item.score+uncertainty-catalogCorrection-9*Math.log(-Math.log(Math.max(1e-9,random())));
    if(value>best){winner=item;best=value;}
   }
   if(discovering){const e=this.evidence.get(winner.track.id);winner.reasons=[e&&this.now-e.last>21*86400000?'Давно не звучало':'Открываем новое',...winner.reasons].slice(0,2);}
   if(pivot)winner.reasons=['Смена направления после пропусков',...winner.reasons].slice(0,2);
   return winner;
  }
  score(current,candidate,cache={},context={}){
   const hour=context.hour??new Date().getHours(),n=this.counts.get(candidate.id)||0;
   const features=this.features(candidate,hour,current);
   const support=Math.max(this.recentCounts.get(candidate.id)||0,this.recentArtistCounts.get(trustedArtist(candidate.artist))||0);
   // Recent taste earns influence through repeated evidence; one skip cannot erase history.
   const recentMix=.75*support/(support+4);
   const p=(1-recentMix)*this.predictFeatures(features)+recentMix*this.predictFeatures(features,this.recentWeights);
   let score=p*100;const reasons=[];
   const seeds=[current?.id,...(context.recentTrackIds||[])].filter(id=>id!=null&&(this.lastQuality.get(String(id))??1)>=.75);
   const affinity=this.sessionGraph.affinity(seeds,candidate.id);
   score+=28*affinity;
   if(affinity>.12)reasons.push('Сочетается с вашей сессией');
   if(this.samples&&p>.58)reasons.push('По вашим дослушиваниям');
   if(!n&&(this.artistCounts.get(trustedArtist(candidate.artist))||0)>2&&p>.55)reasons.push('Новое у знакомого исполнителя');
   // Modest exploration and spacing keep a learned preference from becoming a repeat trap.
   score+=5/Math.sqrt(1+n);
   const evidence=this.evidence.get(candidate.id);
   if(evidence)score-=12*Math.exp(-Math.max(0,this.now-evidence.last)/(18*3600000));
   const artist=trustedArtist(candidate.artist),recent=context.recentArtists||[];
   if(artist&&artist===trustedArtist(current?.artist))score-=9;
   else if(artist&&recent.slice(-3).includes(artist))score-=4;
   const a=current?knownBpm(current,cache):null,b=knownBpm(candidate,cache);
   const dist=a&&b?Math.min(Math.abs(a-b),Math.abs(a*2-b),Math.abs(a-b*2)):null;
   if(dist!==null){score+=6*Math.exp(-dist/12);if(dist<8)reasons.push('Близкий темп');}
   const currentSound=(this.lastQuality.get(String(current?.id))??1)>=.75?Sound.get(this.audioProfiles,current):null,candidateSound=Sound.get(this.audioProfiles,candidate);
   const soundSimilarity=Sound.similarity(currentSound,candidateSound);
   if(soundSimilarity!==null){
    const confidence=Math.min(1,currentSound.seconds/30,candidateSound.seconds/30);
    // A modest transition signal preserves discovery and stronger personal evidence.
    score+=10*confidence*(soundSimilarity-.5);
    if(soundSimilarity>.8&&confidence>.6)reasons.push('Близкое звучание');
   }
   if(!reasons.length)reasons.push(this.samples?'Расширяем подбор':'Знакомимся с вашим вкусом');
   return {score,bpm:b,dist,reasons:reasons.slice(0,2),probability:p,affinity};
  }
 }
 TasteModel.artistIdentity=track=>trustedArtist(track?.artist);
 TasteModel.knownBpm=knownBpm;return TasteModel;
});

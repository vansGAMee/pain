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
 const completed=p=>p.finished===1||p.finished===true||p.completed===true||p.completed===1;
 function history(tracks,plays,now){
  const rows=new Map();
  for(const p of Array.isArray(plays)?plays:[]){
   if(!p||typeof p!=='object')continue;
   const track=tracks.get(p.track),stamp=Number(p.started||p.timestamp||0);
   if(!track||!Number.isFinite(stamp)||stamp<=0||stamp>now)continue;
   const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
   if(!completed(p)&&(!Number.isFinite(heard)||heard<1000||!Number.isFinite(duration)||duration<=0))continue;
   const key=JSON.stringify([p.track,stamp]),old=rows.get(key);
   // A relayed partial record must not replace a later completion of the same play.
   if(!old||Number(completed(p))>Number(completed(old))||completed(p)===completed(old)&&heard>Number(old.media_heard??old.heard))rows.set(key,{...p,started:stamp});
  }
  // Deduplicate before bounding: repeated sync copies must not erase genuine history.
  return [...rows.values()].sort((a,b)=>a.started-b.started).slice(-6000);
 }
 class TasteModel {
  constructor(tracks=[],plays=[],now=Date.now(),audioProfiles={},options={}){
   this.excludedTracks=options.excludedTracks instanceof Set?options.excludedTracks:new Set(Array.from(options.excludedTracks||[]).map(String));
   this.audioProfiles=audioProfiles;
   this.weights=new Map();this.counts=new Map();this.artistCounts=new Map();this.now=now;this.evidence=new Map();this.recentSkips=[];
   this.recentWeights=new Map();this.recentCounts=new Map();this.recentArtistCounts=new Map();
   const byId=new Map(tracks.map(t=>[t.id,t])),seen=new Set();
   this.tracksById=new Map(tracks.map(t=>[String(t.id),t]));
   const soundSkips=new Map(),soundFeedback=new Map();
   const samples=[],sessionEvents=[];this.lastQuality=new Map();let previous=null;
   for(const p of history(byId,plays,now)){
    const track=byId.get(p.track),stamp=Number(p.started||p.timestamp||0),id=p.track+'|'+stamp;
    if(!track||!stamp||seen.has(id))continue;seen.add(id);
    if(this.excludedTracks.has(String(track.id))||this.excludedTracks.has(String(p.track)))continue;
    const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
    const explicit=completed(p);
    // Pauses, buffering, unknown duration and sub-second accidental clicks are not dislikes.
    if(!explicit&&(!Number.isFinite(heard)||heard<1000||!(duration>0)))continue;
    const target=explicit?1:Math.min(1,heard/duration);
    sessionEvents.push({id:track.id,started:stamp,quality:target,skipped:(p.skipped===1||p.skipped===true)&&target<.75});
    // An explicitly non-skipped partial play means interruption, not rejection.
    // Keep legacy records without a skip field compatible with older clients.
    if(!explicit&&(p.skipped===0||p.skipped===false)&&target<.75){previous=null;this.recentSkips=[];continue;}
    this.lastQuality.set(String(track.id),target);
    if(explicit||target>=.75)soundSkips.delete(String(track.id));
    else if((p.skipped===1||p.skipped===true)&&heard<=20000&&target<.25&&now-stamp<30*60000){
     soundSkips.delete(String(track.id));soundSkips.set(String(track.id),{track,stamp});
    }
    const from=previous&&stamp-previous.stamp<30*60*1000?previous.track:null;
    const features=this.features(track,new Date(stamp).getHours(),from);
    const weight=Math.exp(-Math.max(0,now-stamp)/(90*86400000));
    const recentWeight=Math.exp(-Math.max(0,now-stamp)/(7*86400000));
    const accepted=explicit||target>=.75;
    const quickSkip=(p.skipped===1||p.skipped===true)&&heard<=20000&&target<.25;
    if(accepted||quickSkip){
     const feedback=soundFeedback.get(String(track.id))||{positive:0,negative:0,last:0};
     feedback[accepted?'positive':'negative']+=Math.exp(-(now-stamp)/(30*86400000));
     feedback.last=stamp;soundFeedback.set(String(track.id),feedback);
    }
    samples.push({features,target,weight,recentWeight,id:track.id});
    this.recentCounts.set(track.id,(this.recentCounts.get(track.id)||0)+recentWeight);
    const recentArtist=trustedArtist(track.artist);
    if(recentArtist)this.recentArtistCounts.set(recentArtist,(this.recentArtistCounts.get(recentArtist)||0)+recentWeight);
    const evidence=this.evidence.get(track.id)||{count:0,reward:0,last:0};
    evidence.count+=weight;evidence.reward+=target*weight;evidence.last=Math.max(stamp,evidence.last);this.evidence.set(track.id,evidence);this.counts.set(track.id,(this.counts.get(track.id)||0)+weight);
    const artist=trustedArtist(track.artist);if(artist)this.artistCounts.set(artist,(this.artistCounts.get(artist)||0)+weight);
    // Temporary intent: explicit early skips can mean "not this mood right now".
    if(quickSkip && now-stamp>=0 && now-stamp<10*60000){
      this.recentSkips.push(skipIdentity(track));this.recentSkips=this.recentSkips.slice(-2);
    }else this.recentSkips=[];
    previous={track,stamp};
   }
   this.samples=samples.length;
   this.soundSkips=[];
   // Missing, stale or too-short profiles must not evict usable acoustic feedback.
   const skippedSounds=[...soundSkips.values()];
   for(let i=skippedSounds.length-1;i>=0&&this.soundSkips.length<3;i--){
    const {track,stamp}=skippedSounds[i],profile=Sound.get(audioProfiles,track,true);
    if(profile)this.soundSkips.push({profile,strength:Math.exp(-(now-stamp)/(10*60000))});
   }
   this.soundPreferences=[];this.trackRejections=new Map();this.soundPreferenceCache=new Map();
   for(const [id,feedback] of soundFeedback){
    const total=feedback.positive+feedback.negative;
    if(total<1.5)continue; // One play or one accidental skip cannot define a style preference.
    const polarity=Math.sign(feedback.positive-feedback.negative),quality=this.lastQuality.get(id);
    if(!polarity||polarity>0&&quality<.75||polarity<0&&quality>=.75)continue;
    const strength=Math.abs(feedback.positive-feedback.negative)/total*Math.min(1,(total-1)/3)*Math.exp(-(now-feedback.last)/(30*86400000));
    if(polarity<0)this.trackRejections.set(id,strength);
    const profile=Sound.get(audioProfiles,this.tracksById.get(id));
    if(Sound.texture(profile))this.soundPreferences.push({id,profile,polarity,strength});
   }
   // Separate neighbours preserve multiple tastes; a single averaged sound would not.
   this.soundPreferences=[1,-1].flatMap(sign=>{
    const selected=[];
    for(const example of this.soundPreferences.filter(p=>p.polarity===sign).sort((a,b)=>b.strength-a.strength)){
     // Near-duplicate recordings must not fill every slot and erase another taste.
     if(selected.some(other=>Sound.similarity(example.profile,other.profile)>.97))continue;
     selected.push(example);if(selected.length===12)break;
    }
    return selected;
   });
   this.sessionGraph=new SessionGraph(sessionEvents,now);
   // Balance informative outcomes: frequent skips must not drown out the user's
   // fewer full listens (or vice versa). Cap correction so rare events cannot dominate.
   const balance=key=>{
    let positive=0,negative=0;
    for(const sample of samples){if(sample.target>=.75)positive+=sample[key];else if(sample.target<.25)negative+=sample[key];}
    if(!positive||!negative)return ()=>1;
    const total=positive+negative,p=Math.max(.5,Math.min(2,total/(2*positive))),n=Math.max(.5,Math.min(2,total/(2*negative)));
    return target=>target>=.75?p:target<.25?n:1;
   };
   const lifetimeBalance=balance('weight'),recentBalance=balance('recentWeight');
   // Sparse SGD with L2 shrinkage: learned coefficients, not hand-written mood scores.
   for(let epoch=0;epoch<5;epoch++)for(const sample of samples){
    const error=(sample.target-this.predictFeatures(sample.features))*sample.weight*lifetimeBalance(sample.target)/Math.sqrt(1+(this.counts.get(sample.id)||0)/8);
    const rate=.16/Math.sqrt(1+epoch);
    for(const [key,value] of sample.features){const old=this.weights.get(key)||0;this.weights.set(key,old+rate*(error*value-.018*old));}
    if(sample.recentWeight>.02){
      const recentError=(sample.target-this.predictFeatures(sample.features,this.recentWeights))*sample.recentWeight*recentBalance(sample.target)/Math.sqrt(1+(this.recentCounts.get(sample.id)||0)/8);
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
   const variation=Sound.variation(sound);
   if(variation)variation.forEach((value,i)=>f.push(['sound-variation:'+i,(value-.5)*.5]));
   const texture=Sound.texture(sound);
   if(texture){
    texture.mean.forEach((value,i)=>f.push(['timbre:'+i,(value-.5)*.45]));
    texture.variation.forEach((value,i)=>f.push(['timbre-variation:'+i,(value-.5)*.3]));
   }
   // Hearts do not become a shortcut: learn from actual listening instead.
   return f;
  }
  predictFeatures(features,weights=this.weights){return sigmoid(features.reduce((s,[k,v])=>s+(weights.get(k)||0)*v,0));}
  soundPreference(candidate,profile){
   if(!this.soundPreferences.length||!Sound.texture(profile))return 0;
   const id=String(candidate.id),cached=this.soundPreferenceCache.get(id);
   if(cached?.profile===profile)return cached.value;
   let positive=0,negative=0;
   for(const example of this.soundPreferences){
    if(example.id===id)continue; // Direct track history already has its own signal.
    const similarity=Sound.similarity(profile,example.profile);
    const vote=example.strength*Math.max(0,(similarity-.65)/.35)**2;
    if(example.polarity>0)positive=Math.max(positive,vote);else negative=Math.max(negative,vote);
   }
   const value=positive-negative;
   this.soundPreferenceCache.set(id,{profile,value});return value;
  }
  choose(current,candidates,cache={},context={}){
   const excluded=context.excludedTracks instanceof Set?context.excludedTracks:(context.excludedTracks?new Set(Array.from(context.excludedTracks).map(String)):this.excludedTracks);
   // Seeded sampling makes peek and next agree, while each queue visit draws anew.
   let seed=(context.seed??1)>>>0;
   const random=()=>{seed=(seed+0x6d2b79f5)>>>0;let z=seed;z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);return ((z^(z>>>14))>>>0)/4294967296;};
   let pool=candidates.filter(track=>!excluded.has(String(track.id))).map(track=>({track,...this.score(current,track,cache,context)}));
   if(!pool.length)return null;
   const acoustic=pool.some(item=>item.soundSimilarity!==null);
   const bestScore=pool.reduce((best,item)=>Math.max(best,item.score),-Infinity);
   // Reserve one turn in four for discovery when safe candidates exist.
   const pivot=this.recentSkips.length>=2;
   const discovery=pivot||(context.step??0)%4===3;let discovering=false;
   // Break the cache feedback loop: at most one in eight turns explores unmeasured
   // sound. Keep explicit rejections and provisional acoustic penalties in force.
   const unmeasured=acoustic&&!this.recentSkips.length&&(context.step??0)%8===7?pool.filter(item=>{
    const e=this.evidence.get(item.track.id);
    return item.soundSimilarity===null&&item.skipPenalty===0&&
     (this.lastQuality.get(String(item.track.id))??1)>=.75&&
     (!e||e.count<1.5||e.reward/e.count>=.5);
   }):[];
   if(unmeasured.length){pool=unmeasured;discovering=true;}
   else if(discovery){
    const fresh=pool.filter(item=>{
     if(acoustic&&item.score<bestScore-12)return false;
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
   if(!acoustic&&diverse.length)pool=diverse;
   // Balance artist probability mass: a huge discography is not extra evidence of taste.
   const artistKey=track=>{
    const artist=trustedArtist(track.artist);
    return !artist||artist==='unknown artist'||artist==='неизвестный исполнитель'?'track:'+track.id:'artist:'+artist;
   };
   const poolCounts=new Map();
   for(const item of pool){const key=artistKey(item.track);poolCounts.set(key,(poolCounts.get(key)||0)+1);}
   // Shortlist before drawing: random variation among good acoustic fits, not all songs.
   for(const item of pool){
    const n=this.counts.get(item.track.id)||0;
    const artistEvidence=trustedArtist(item.track.artist)?this.artistCounts.get(trustedArtist(item.track.artist))||0:0;
    const uncertainty=discovery?10/Math.sqrt(1+n+Math.min(8,artistEvidence)*.25):0;
    const catalogSize=poolCounts.get(artistKey(item.track));
    const catalogCorrection=acoustic?Math.min(8,3*Math.log(catalogSize)):9*Math.log(catalogSize);
    item.rank=item.score+uncertainty-catalogCorrection;
   }
   if(acoustic){
    // Equal fits must not always shortlist the first six files in library order.
    for(const item of pool)item.tie=random();
    pool.sort((a,b)=>b.rank-a.rank||a.tie-b.tie);
    pool=pool.filter(item=>item.rank>=pool[0].rank-18).slice(0,6);
   }
   // Seeded Gumbel sampling keeps preview and playback consistent.
   let winner=null,best=-Infinity;
   for(const item of pool){
    const value=item.rank-(acoustic?4:9)*Math.log(-Math.log(Math.max(1e-9,random())));
    if(value>best){winner=item;best=value;}
   }
   if(discovering){const e=this.evidence.get(winner.track.id);winner.reasons=[e&&this.now-e.last>21*86400000?'Давно не звучало':'Открываем новое',...winner.reasons].slice(0,2);}
   if(pivot)winner.reasons=['Смена направления после пропусков',...winner.reasons].slice(0,2);
   return winner;
  }
  score(current,candidate,cache={},context={}){
   const hour=context.hour??new Date().getHours(),n=this.counts.get(candidate.id)||0;
   // A rejected track must not steer tempo or learned transitions, either.
   let reference=!this.excludedTracks.has(String(current?.id))&&(this.lastQuality.get(String(current?.id))??1)>=.75?current:null;
   if(!Sound.get(this.audioProfiles,reference)){
    const previous=(context.recentTrackIds||[]).map(id=>this.tracksById.get(String(id))).find(track=>
     track&&!this.excludedTracks.has(String(track.id))&&(this.lastQuality.get(String(track.id))??1)>=.75&&Sound.get(this.audioProfiles,track));
    if(previous)reference=previous;
   }
   const features=this.features(candidate,hour,reference);
   const support=Math.max(this.recentCounts.get(candidate.id)||0,this.recentArtistCounts.get(trustedArtist(candidate.artist))||0);
   // Recent taste earns influence through repeated evidence; one skip cannot erase history.
   const recentMix=.75*support/(support+4);
   const p=(1-recentMix)*this.predictFeatures(features)+recentMix*this.predictFeatures(features,this.recentWeights);
   let score=p*100;const reasons=[];
   const seeds=[current?.id,...(context.recentTrackIds||[])].filter(id=>id!=null&&!this.excludedTracks.has(String(id))&&(this.lastQuality.get(String(id))??1)>=.75);
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
   const a=reference?knownBpm(reference,cache):null,b=knownBpm(candidate,cache);
   const dist=a&&b?Math.min(Math.abs(a-b),Math.abs(a*2-b),Math.abs(a-b*2)):null;
   if(dist!==null){score+=6*Math.exp(-dist/12);if(dist<8)reasons.push('Близкий темп');}
   const vibeSound=Sound.texture(context.vibeProfile)?context.vibeProfile:null;
   const currentSound=vibeSound||Sound.get(this.audioProfiles,reference),candidateSound=Sound.get(this.audioProfiles,candidate);
   let soundSimilarity=Sound.similarity(currentSound,candidateSound);
   if(currentSound){
    const detailed=!!Sound.texture(currentSound),confidence=detailed?1:.55;
    // Keep history on the same scale for every candidate. Coarse spectra cannot
    // claim a certain timbre match: shrink their evidence toward the neutral prior.
    if(detailed&&candidateSound&&!Sound.texture(candidateSound)&&soundSimilarity!==null)
     soundSimilarity=.5+.55*(soundSimilarity-.5);
    // Timbre is primary (70 points); learned taste, BPM and spacing refine the fit.
    // Unmeasured candidates get a neutral prior, not an unfair unscaled history score.
    score=(1-confidence)*score+confidence*(70*(soundSimilarity??.5)+.25*score);
    if(soundSimilarity!==null&&soundSimilarity>.65)reasons.unshift(vibeSound?'Звучание сохранённого вайба':'Близкое звучание');
   }
   if(candidate.favorite===true||candidate.favorite===1)score+=2;
   const soundPreference=this.soundPreference(candidate,candidateSound);
   score+=16*soundPreference;
   if(soundPreference>.15)reasons.push('Похоже на то, что вы дослушиваете');
   // A short explicit rejection suppresses acoustic neighbours, even with other artists/tags.
   // Max, not sum: repeated skips cannot accidentally blacklist the whole library.
   let skipPenalty=0;
   const negativeSound=candidateSound||(this.soundSkips.length?Sound.get(this.audioProfiles,candidate,true):null);
   if(negativeSound)for(const skip of this.soundSkips){
    const similarity=Sound.similarity(skip.profile,negativeSound,true);
    if(similarity!==null)skipPenalty=Math.max(skipPenalty,80*skip.strength*Math.min(1,skip.profile.seconds/4)*Math.max(0,(similarity-.55)/.45)**2);
   }
   const rejectionPenalty=30*(this.trackRejections.get(String(candidate.id))||0);
   score-=Math.max(skipPenalty,rejectionPenalty);
   if(!reasons.length)reasons.push(this.samples?'Расширяем подбор':'Знакомимся с вашим вкусом');
   return {score,bpm:b,dist,reasons:reasons.slice(0,2),probability:p,affinity,soundSimilarity,soundPreference,skipPenalty,rejectionPenalty};
  }
 }
 TasteModel.artistIdentity=track=>trustedArtist(track?.artist);
 TasteModel.knownBpm=knownBpm;return TasteModel;
});

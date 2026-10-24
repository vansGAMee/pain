/* Personal logistic ranker. Fits only local listening evidence; no remote model. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TasteModel=factory();})(globalThis,()=>{
 const SessionGraph=typeof module==='object'&&module.exports?require('./session-graph'):globalThis.SessionGraph;
 const Sound=typeof module==='object'&&module.exports?require('./audio-profile'):globalThis.AudioProfile;
 const clean=s=>String(s||'').trim().toLowerCase();
 // Untrusted source/placeholder tags must never create a shared artist preference.
 const parseArtist=value=>{
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
 const artistCache=new Map();
 const trustedArtist=value=>{
  const key=String(value||'');
  if(artistCache.has(key))return artistCache.get(key);
  const result=parseArtist(key);
  if(key.length<=1024){
   if(artistCache.size>=2048)artistCache.delete(artistCache.keys().next().value);
   artistCache.set(key,result);
  }
  return result;
 };
 const skipIdentity=track=>trustedArtist(track.artist)||'track:'+track.id;
 // Recognise explicitly labelled speed edits, not arbitrary subtitles, live
 // performances or remixes. Source tags cannot establish a shared recording.
 const recordingIdentity=track=>{
  const artist=trustedArtist(track?.artist);
  let title=clean(track?.title).normalize('NFKC').replace(/\s+/g,' ');
  if(!artist||!title)return '';
  const edit=/\s*(?:[-–—]\s*|\(\s*|\[\s*)(?:(?:(?:super|ultra)\s+)?slowed(?:\s+down)?(?:\s*(?:\+|&|and)\s*reverb(?:ed)?)?|(?:sped|speed)[\s-]*up)(?:\s+(?:version|edit|mix))?\s*[\])]?$/;
  title=title.replace(edit,'').trim();
  return title?JSON.stringify([artist,title]):'';
 };
 const sigmoid=x=>1/(1+Math.exp(-Math.max(-20,Math.min(20,x))));
 const knownBpm=(t,cache)=>{const n=Number(cache?.[t.id]||t.bpm);return n>=40&&n<=240?n:null;};
 const completed=p=>p.finished===1||p.finished===true||p.completed===true||p.completed===1;
 const quickSkip=(p,track)=>{
  const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track?.duration);
  return !completed(p)&&(p.skipped===1||p.skipped===true)&&heard>=1000&&heard<=20000&&duration>0&&heard/duration<.25;
 };
 function history(tracks,plays,now){
  const rows=new Map();
  for(const p of Array.isArray(plays)?plays:[]){
   if(!p||typeof p!=='object')continue;
   const track=tracks.get(p.track),stamp=Number(p.started||p.timestamp||0);
   if(!track||!Number.isFinite(stamp)||stamp<=0||stamp>now)continue;
   const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
   if(!completed(p)&&(!Number.isFinite(heard)||heard<0||!Number.isFinite(duration)||duration<=0))continue;
   const key=JSON.stringify([p.track,stamp]),old=rows.get(key);
   const merged={...p,started:stamp};
   if(old){
    const positive=n=>Number.isFinite(Number(n))&&Number(n)>=0?Number(n):0;
    merged.heard=Math.max(positive(old.heard),positive(p.heard));
    merged.duration=Math.max(positive(old.duration),positive(p.duration));
    // Known unique coverage beats wall time in legacy copies, even below 1 s.
    if(old.media_heard!=null||p.media_heard!=null)merged.media_heard=Math.max(positive(old.media_heard),positive(p.media_heard));
    merged.finished=completed(old)||completed(p)?1:0;
    if(old.skipped===1||old.skipped===true||p.skipped===1||p.skipped===true)merged.skipped=1;
    else if(old.skipped===0||old.skipped===false||p.skipped===0||p.skipped===false)merged.skipped=0;
   }
   rows.set(key,merged);
  }
  // Deduplicate before bounding: repeated sync copies must not erase genuine history.
  return [...rows.values()].filter(p=>completed(p)||Number(p.media_heard??p.heard)>=1000).sort((a,b)=>a.started-b.started).slice(-6000);
 }
 class TasteModel {
  constructor(tracks=[],plays=[],now=Date.now(),audioProfiles={},options={}){
   this.excludedTracks=options.excludedTracks instanceof Set?options.excludedTracks:new Set(Array.from(options.excludedTracks||[]).map(String));
   this.audioProfiles=audioProfiles;
   this._profileCache=new WeakMap();
   this.similarity=Sound.calibratedSimilarity(tracks.filter(t=>!this.excludedTracks.has(String(t.id))).map(t=>this.sound(t)));
   this.weights=new Map();this.counts=new Map();this.artistCounts=new Map();this.now=now;this.evidence=new Map();this.recentSkips=[];
   this.recentWeights=new Map();this.recentCounts=new Map();this.recentArtistCounts=new Map();
   const byId=new Map(tracks.map(t=>[t.id,t])),seen=new Set();
   this.tracksById=new Map(tracks.map(t=>[String(t.id),t]));
   const soundSkips=new Map(),soundFeedback=new Map();
   const samples=[],sessionEvents=[];this.lastQuality=new Map();this.lastFeedback=new Map();this.searching=false;this.lastAcceptedTrack=null;this.sessionSoundTracks=new Map();let previous=null;
   const rows=history(byId,plays,now),browsing=new Set();let priorSkip=null;
   // Consecutive short previews of different songs suggest browsing, not a style
   // rejection. Mark both sides so the first preview is reconsidered as well.
   for(const p of rows){
    if(this.excludedTracks.has(String(p.track))||!quickSkip(p,byId.get(p.track))){priorSkip=null;continue;}
    if(priorSkip&&priorSkip.track!==p.track&&p.started>priorSkip.started&&p.started-priorSkip.started<=45000){browsing.add(priorSkip);browsing.add(p);}
    priorSkip=p;
   }
   for(const p of rows){
    const track=byId.get(p.track),stamp=Number(p.started||p.timestamp||0),id=p.track+'|'+stamp;
    if(!track||!stamp||seen.has(id))continue;seen.add(id);
    if(this.excludedTracks.has(String(track.id))||this.excludedTracks.has(String(p.track)))continue;
    const heard=Number(p.media_heard??p.heard),duration=Number(p.duration||track.duration);
    const explicit=completed(p);
    // Pauses, buffering, unknown duration and sub-second accidental clicks are not dislikes.
    if(!explicit&&(!Number.isFinite(heard)||heard<1000||!(duration>0)))continue;
    const coverage=explicit?1:Math.min(1,heard/duration);
    // A long mix is not a three-minute single: substantial listening before an
    // explicit switch is useful evidence even when most of the recording remains.
    // Cap this weaker signal below full completion; leave interruptions/legacy
    // records and ordinary songs unchanged. `heard` uses unique media coverage.
    const target=!explicit&&(p.skipped===1||p.skipped===true)&&duration>240000
      ?Math.max(coverage,Math.min(.75,heard/240000)):coverage;
    const accepted=explicit||target>=.75,isQuickSkip=quickSkip(p,track);
    const feedbackBefore=soundFeedback.get(String(track.id));
    const familiar=track.favorite===1||track.favorite===true||
      feedbackBefore?.positive>.75&&feedbackBefore.positive>feedbackBefore.negative;
    const confidence=isQuickSkip?(browsing.has(p)?.15:familiar?.35:1):1;
    const learningTarget=isQuickSkip?.5+(target-.5)*confidence:target;
    this.searching=isQuickSkip&&now-stamp<10*60000;
    if(accepted&&now-stamp<30*60000){
     this.lastAcceptedTrack=track;
     this.sessionSoundTracks.delete(String(track.id));this.sessionSoundTracks.set(String(track.id),track);
     if(this.sessionSoundTracks.size>8)this.sessionSoundTracks.delete(this.sessionSoundTracks.keys().next().value);
    }
    sessionEvents.push({id:track.id,started:stamp,quality:target,skipped:(p.skipped===1||p.skipped===true)&&target<.75});
    // An explicitly non-skipped partial play means interruption, not rejection.
    // Keep legacy records without a skip field compatible with older clients.
    if(!explicit&&(p.skipped===0||p.skipped===false)&&target<.75){previous=null;this.recentSkips=[];continue;}
    this.lastQuality.set(String(track.id),learningTarget);
    this.lastFeedback.set(String(track.id),{stamp,rejected:!accepted});
    if(accepted){
     soundSkips.delete(String(track.id));
     // A successful search explains ambiguous previews relative to the sound
     // actually chosen. Keep the first confirmation, confident refusals and
     // long-term feedback; do not guess an anchor when its audio is unavailable.
     const acceptedProfile=this.sound(track);
     if(Sound.texture(acceptedProfile))for(const skip of soundSkips.values())
      if(skip.confidence<1&&!skip.acceptedProfile)skip.acceptedProfile=acceptedProfile;
    }
    else if(isQuickSkip&&now-stamp<30*60000){
     soundSkips.delete(String(track.id));soundSkips.set(String(track.id),{track,stamp,confidence});
    }
    const from=previous&&stamp-previous.stamp<30*60*1000?previous.track:null;
    const features=this.features(track,new Date(stamp).getHours(),from);
    const weight=confidence*Math.exp(-Math.max(0,now-stamp)/(90*86400000));
    const recentWeight=confidence*Math.exp(-Math.max(0,now-stamp)/(7*86400000));
    if(accepted||isQuickSkip){
     const feedback=soundFeedback.get(String(track.id))||{positive:0,negative:0,last:0};
     feedback[accepted?'positive':'negative']+=confidence*Math.exp(-(now-stamp)/(30*86400000));
     feedback.last=stamp;soundFeedback.set(String(track.id),feedback);
    }
    samples.push({features,target:learningTarget,weight,recentWeight,id:track.id});
    this.recentCounts.set(track.id,(this.recentCounts.get(track.id)||0)+recentWeight);
    const recentArtist=trustedArtist(track.artist);
    if(recentArtist)this.recentArtistCounts.set(recentArtist,(this.recentArtistCounts.get(recentArtist)||0)+recentWeight);
    const evidence=this.evidence.get(track.id)||{count:0,reward:0,last:0};
    evidence.count+=weight;evidence.reward+=learningTarget*weight;evidence.last=Math.max(stamp,evidence.last);this.evidence.set(track.id,evidence);this.counts.set(track.id,(this.counts.get(track.id)||0)+weight);
    const artist=trustedArtist(track.artist);if(artist)this.artistCounts.set(artist,(this.artistCounts.get(artist)||0)+weight);
    // Temporary intent: explicit early skips can mean "not this mood right now".
    if(isQuickSkip && confidence===1 && now-stamp>=0 && now-stamp<10*60000){
      this.recentSkips.push(skipIdentity(track));this.recentSkips=this.recentSkips.slice(-2);
    }else this.recentSkips=[];
    previous={track,stamp};
   }
   this.samples=samples.length;
   this.soundSkips=[];
   // Missing, stale or too-short profiles must not evict usable acoustic feedback.
   const skippedSounds=[...soundSkips.values()];
   for(let i=skippedSounds.length-1;i>=0&&this.soundSkips.length<3;i--){
    const {track,stamp,confidence,acceptedProfile}=skippedSounds[i],profile=this.sound(track,true);
    if(profile)this.soundSkips.push({profile,acceptedProfile,strength:confidence*Math.exp(-(now-stamp)/(10*60000))});
   }
   this.soundPreferences=[];this.trackRejections=new Map();this.soundPreferenceCache=new Map();
   // A new listener should not need to replay the same song before its sound can
   // inform taste. A small positive prior fades out over the first twelve samples;
   // rejection still needs the usual repeated evidence. Never guess missing audio.
   const warmup=Math.max(0,1-this.samples/12);
   for(const [id,feedback] of soundFeedback){
    const total=feedback.positive+feedback.negative;
    const polarity=Math.sign(feedback.positive-feedback.negative),quality=this.lastQuality.get(id);
    const provisional=total<1.5;
    if(provisional&&!(warmup>0&&polarity>0&&feedback.positive>=.75&&quality>=.25&&now-feedback.last<=7*86400000))continue;
    if(!polarity||polarity>0&&quality<.25||polarity<0&&quality>=.75)continue;
    const confidence=provisional?.25*warmup:Math.min(1,(total-1)/3);
    const strength=Math.abs(feedback.positive-feedback.negative)/total*confidence*Math.exp(-(now-feedback.last)/(30*86400000));
    if(polarity<0)this.trackRejections.set(id,strength);
    const profile=this.sound(this.tracksById.get(id));
    if(Sound.texture(profile))this.soundPreferences.push({id,profile,polarity,strength,...(provisional?{provisional:true}:{})});
   }
   // Separate neighbours preserve multiple tastes; a single averaged sound would not.
   this.soundPreferences=[1,-1].flatMap(sign=>{
    const selected=[];
    const remaining=this.soundPreferences.filter(p=>p.polarity===sign)
     .sort((a,b)=>b.strength-a.strength||a.id.localeCompare(b.id)).map(example=>({example,nearest:0}));
    // Cover confirmed tastes, not just the twelve most-played variations of one
    // sound. Confidence still matters; nearest distance is updated incrementally.
    while(remaining.length&&selected.length<12){
     const last=selected.at(-1);let best=-1,priority=-1;
     for(let i=0;i<remaining.length;i++){
      const item=remaining[i];
      if(last)item.nearest=Math.max(item.nearest,this.similarity(last.profile,item.example.profile));
      if(item.nearest>.97)continue;
      const value=item.example.strength*(1-item.nearest);
      if(value>priority){priority=value;best=i;}
     }
     if(best<0)break;
     selected.push(remaining.splice(best,1)[0].example);
    }
    return selected;
   });
   this.sessionGraph=new SessionGraph(sessionEvents,now);
   // Balance informative outcomes: frequent skips must not drown out the user's
   // fewer full listens (or vice versa). Cap correction so rare events cannot dominate.
   const balance=key=>{
    let positive=0,negative=0;
    for(const sample of samples){if(sample[key]<=.02)continue;if(sample.target>=.75)positive+=sample[key];else if(sample.target<.25)negative+=sample[key];}
    if(!positive||!negative)return ()=>1;
    const total=positive+negative,p=Math.max(.5,Math.min(2,total/(2*positive))),n=Math.max(.5,Math.min(2,total/(2*negative)));
    return target=>target>=.75?p:target<.25?n:1;
   };
   const lifetimeBalance=balance('weight'),recentBalance=balance('recentWeight');
   // Retire negligible evidence from both learning and L2 shrinkage, using
   // the same floor as the recent model. Otherwise expired archive rows keep
   // erasing fresh preferences even though they can no longer teach anything.
   // Compile string feature keys once. The equations and sample order stay the
   // same; the five fitting passes no longer perform millions of Map operations.
   const keys=new Map();
   const indexed=samples.filter(s=>s.weight>.02).map(sample=>({...sample,indices:sample.features.map(([key])=>{
    if(!keys.has(key))keys.set(key,keys.size);return keys.get(key);
   })}));
   const weights=new Float64Array(keys.size),recentWeights=new Float64Array(keys.size),recentUsed=new Uint8Array(keys.size);
   const predict=(sample,w)=>{let sum=0;for(let i=0;i<sample.indices.length;i++)sum+=w[sample.indices[i]]*sample.features[i][1];return sigmoid(sum);};
   for(let epoch=0;epoch<5;epoch++){
    const rate=.16/Math.sqrt(1+epoch);
    for(const sample of indexed){
     const error=(sample.target-predict(sample,weights))*sample.weight*lifetimeBalance(sample.target)/Math.sqrt(1+(this.counts.get(sample.id)||0)/8);
     for(let i=0;i<sample.indices.length;i++){const key=sample.indices[i],old=weights[key];weights[key]=old+rate*(error*sample.features[i][1]-.018*old);}
     if(sample.recentWeight>.02){
      const error=(sample.target-predict(sample,recentWeights))*sample.recentWeight*recentBalance(sample.target)/Math.sqrt(1+(this.recentCounts.get(sample.id)||0)/8);
      for(let i=0;i<sample.indices.length;i++){const key=sample.indices[i],old=recentWeights[key];recentWeights[key]=old+rate*(error*sample.features[i][1]-.018*old);recentUsed[key]=1;}
     }
    }
   }
   for(const [key,i] of keys){this.weights.set(key,weights[i]);if(recentUsed[i])this.recentWeights.set(key,recentWeights[i]);}
   this._profileCache=null;
  }
  sound(track,partial=false){
   if(!this._profileCache||!track)return Sound.get(this.audioProfiles,track,partial);
   let cached=this._profileCache.get(track);
   if(!cached){const p=Sound.get(this.audioProfiles,track,true);cached={partial:p,full:Sound.valid(p)?p:null};this._profileCache.set(track,cached);}
   return partial?cached.partial:cached.full;
  }
  features(track,hour,from){
   const artist=trustedArtist(track.artist),album=clean(track.album),genre=clean(track.genre),slot=Math.floor(hour/4);
   const f=[['bias',1],['track:'+track.id,1]];
   if(artist){f.push(['artist:'+artist,1],['hour:'+slot+':'+artist,.8]);}
   if(album&&artist)f.push(['album:'+artist+':'+album,.65]);
   if(genre)f.push(['genre:'+genre,.65]);
   if(from&&artist&&trustedArtist(from.artist))f.push(['transition:'+trustedArtist(from.artist)+'>'+artist,.7]);
   const sound=this.sound(track);
   const entry=this._profileCache?.get(track),offset=f.length;
   if(entry?.features)return f.concat(entry.features);
   if(sound) sound.vector.forEach((value,i)=>f.push(['sound:'+i,(value-.5)*.8]));
   const variation=Sound.variation(sound);
   if(variation)variation.forEach((value,i)=>f.push(['sound-variation:'+i,(value-.5)*.5]));
   const texture=Sound.texture(sound);
   const instruments=Sound.detail(sound);
   if(instruments)instruments.forEach((value,i)=>f.push(['instrument-texture:'+i,(value-.5)*.35]));
   if(texture){
    texture.mean.forEach((value,i)=>f.push(['timbre:'+i,(value-.5)*.45]));
    texture.variation.forEach((value,i)=>f.push(['timbre-variation:'+i,(value-.5)*.3]));
   }
   // Hearts do not become a shortcut: learn from actual listening instead.
   if(entry)entry.features=f.slice(offset);
   return f;
  }
  predictFeatures(features,weights=this.weights){return sigmoid(features.reduce((s,[k,v])=>s+(weights.get(k)||0)*v,0));}
  soundPreference(candidate,profile){
   if(!this.soundPreferences.length||!Sound.texture(profile))return 0;
   const id=String(candidate.id),cached=this.soundPreferenceCache.get(id);
   if(cached?.profile===profile)return cached.value;
   let positive=0,negative=0,provisional=false;
   for(const example of this.soundPreferences){
    if(example.id===id)continue; // Direct track history already has its own signal.
    const similarity=this.similarity(profile,example.profile);
    const vote=example.strength*Math.max(0,(similarity-.65)/.35)**2;
    if(example.polarity>0){if(vote>positive){positive=vote;provisional=!!example.provisional;}}else negative=Math.max(negative,vote);
   }
   const value=positive-negative;
   this.soundPreferenceCache.set(id,{profile,value,provisional});return value;
  }
  choose(current,candidates,cache={},context={}){
   // Profiles cannot change during a synchronous decision. Validate each once,
   // then release the cache so in-place metadata edits are seen next time.
   this._profileCache=new WeakMap();
   try{return this.chooseCandidates(current,candidates,cache,context);}
   finally{this._profileCache=null;}
  }
  chooseCandidates(current,candidates,cache={},context={}){
   const excluded=context.excludedTracks instanceof Set?context.excludedTracks:(context.excludedTracks?new Set(Array.from(context.excludedTracks).map(String)):this.excludedTracks);
   // Seeded sampling makes peek and next agree, while each queue visit draws anew.
   let seed=(context.seed??1)>>>0;
   const random=()=>{seed=(seed+0x6d2b79f5)>>>0;let z=seed;z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);return ((z^(z>>>14))>>>0)/4294967296;};
   let pool=candidates.filter(track=>!excluded.has(String(track.id))).map(track=>({track,...this.score(current,track,cache,context)}));
   if(!pool.length)return null;
   const acoustic=pool.some(item=>item.soundSimilarity!==null);
   let bestScore=pool.reduce((best,item)=>Math.max(best,item.score),-Infinity);
   const recentRecordings=new Set([current,...(context.recentTrackIds||[]).slice(0,2).map(id=>this.tracksById.get(String(id)))].map(recordingIdentity).filter(Boolean));
   if(recentRecordings.size){
    const alternatives=pool.filter(item=>!recentRecordings.has(recordingIdentity(item.track)));
    // Defer another version only when a good alternative exists. Never force an
    // unrelated sound, ignore rejection, or dead-end a small/finishing queue.
    if(alternatives.length<pool.length&&alternatives.some(item=>item.score>=bestScore-18&&item.skipPenalty===0&&item.rejectionPenalty===0&&(!acoustic||item.soundSimilarity>=.65))){
     pool=alternatives;bestScore=pool.reduce((best,item)=>Math.max(best,item.score),-Infinity);
    }
   }
   // Browsing may explore verified neighbours, but never forces an unheard,
   // unmeasured detour or amplifies uncertainty after skips.
   const pivot=this.recentSkips.length>=2;
   const discovery=!this.searching&&!this.recentSkips.length&&(context.step??0)%4===3;let discovering=false;
   const guidedDiscovery=acoustic&&this.searching&&(context.step??0)%4===3;
   // Break the cache feedback loop: at most one in eight turns explores unmeasured
   // sound. Keep explicit rejections and provisional acoustic penalties in force.
   // A saved vibe should not force an unmeasured detour when measured fits exist.
   const unmeasured=acoustic&&discovery&&!Sound.texture(context.vibeProfile)&&(context.step??0)%8===7?pool.filter(item=>{
    const e=this.evidence.get(item.track.id);
    // No independent comparison (e.g. the reference itself) is not missing audio.
    return item.soundSimilarity===null&&!this.sound(item.track)&&item.skipPenalty===0&&
     (this.lastQuality.get(String(item.track.id))??1)>=.75&&
     (!e||e.count<1.5||e.reward/e.count>=.5);
   }):[];
   if(unmeasured.length){pool=unmeasured;discovering=true;}
   else if(discovery||guidedDiscovery){
    const fresh=pool.filter(item=>{
     if(acoustic&&item.score<bestScore-12)return false;
     if(guidedDiscovery&&!(item.soundSimilarity>=.65&&item.skipPenalty===0&&item.rejectionPenalty===0))return false;
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
   const noiseScale=acoustic?2.8:4.0;
   for(const item of pool){
    const n=this.counts.get(item.track.id)||0;
    const artistEvidence=trustedArtist(item.track.artist)?this.artistCounts.get(trustedArtist(item.track.artist))||0:0;
    const uncertainty=discovery?10/Math.sqrt(1+n+Math.min(8,artistEvidence)*.25):0;
    const catalogSize=poolCounts.get(artistKey(item.track));
    const catalogCorrection=acoustic?Math.min(8,3*Math.log(catalogSize)):noiseScale*Math.log(catalogSize);
    item.rank=item.score+uncertainty-catalogCorrection;
   }
   // Similarity alone can repeat the same texture across different artists.
   // After two accepted examples, gently favour a different texture *within*
   // the good-fit band. No penalty when the only alternatives are poor/unknown.
   if(acoustic&&!discovering){
    const recentSounds=[...new Set((context.recentTrackIds||[]).map(String))]
     .filter(id=>this.sessionSoundTracks.has(id)&&!excluded.has(id)&&(this.lastQuality.get(id)??0)>=.75)
     .slice(0,3).map(id=>this.sound(this.tracksById.get(id))).filter(p=>Sound.texture(p));
    if(recentSounds.length>=2){
     const repeats=new Map();
     for(const item of pool){
      if(item.soundSimilarity<.75||item.score<bestScore-10)continue;
      const profile=this.sound(item.track);if(!Sound.texture(profile))continue;
      const matches=recentSounds.map(p=>this.similarity(p,profile)).sort((a,b)=>b-a);
      repeats.set(item,Math.max(0,(matches[1]-.94)/.06));
     }
     const alternative=[...repeats].some(([item,repeat])=>repeat===0&&item.skipPenalty===0&&item.rejectionPenalty===0);
     if(alternative)for(const [item,repeat] of repeats)item.rank-=10*Math.min(1,repeat);
    }
   }
   if(acoustic){
    // Equal fits must not always shortlist the first six files in library order.
    for(const item of pool)item.tie=random();
    pool.sort((a,b)=>b.rank-a.rank||a.tie-b.tie);
    pool=pool.filter(item=>item.rank>=pool[0].rank-18);
    // A top-six list of acoustic copies hides other good fits before sampling.
    // Keep the best fit, then spread the remaining slots within the existing
    // quality band. Only verified, unrejected sound earns diversity credit.
    // Bound work to 24 candidates and five rounds; discovery stays unchanged.
    if(!discovering&&pool.length>6&&pool[0].soundSimilarity>=.75&&Sound.texture(this.sound(pool[0].track))){
     const selected=[pool[0]],remaining=pool.slice(1,24).map(item=>{
      const profile=this.sound(item.track);
      return {item,profile:item.soundSimilarity>=.75&&item.skipPenalty===0&&item.rejectionPenalty===0&&Sound.texture(profile)?profile:null,nearest:0};
     });
     while(selected.length<6&&remaining.length){
      const last=this.sound(selected.at(-1).track);let best=0,priority=-Infinity;
      for(let i=0;i<remaining.length;i++){
       const entry=remaining[i];
       if(entry.profile&&Sound.texture(last))entry.nearest=Math.max(entry.nearest,this.similarity(last,entry.profile));
       const redundancy=entry.profile?Math.max(0,(entry.nearest-.94)/.06):1;
       const value=entry.item.rank-6*Math.min(1,redundancy);
       if(value>priority){priority=value;best=i;}
      }
      selected.push(remaining.splice(best,1)[0].item);
     }
     pool=selected;
    }else pool=pool.slice(0,6);
   }
   // Controlled calibrated sampling keeps preview and playback consistent without wild noise jumps.
   let winner=null,best=-Infinity;
   for(const item of pool){
    const value=item.rank-noiseScale*Math.log(-Math.log(Math.max(1e-9,random())));
    if(value>best){winner=item;best=value;}
   }
   if(discovering){const e=this.evidence.get(winner.track.id);winner.reasons=[e&&this.now-e.last>21*86400000?'Давно не звучало':'Открываем новое',...winner.reasons].slice(0,2);}
   if(pivot)winner.reasons=['Смена направления после пропусков',...winner.reasons].slice(0,2);
   return winner;
  }
  canReference(track,startedAt){
   if(!track||this.excludedTracks.has(String(track.id)))return false;
   const feedback=this.lastFeedback.get(String(track.id));
   if(!feedback?.rejected)return true;
   // An old skip is taste evidence, not a veto on a newly selected song.
   // The playback visit identifies a fresh skip even after a long pause.
   if(Number.isFinite(startedAt)&&startedAt>0)return feedback.stamp<startedAt;
   return this.now-feedback.stamp>=30*60000;
  }
  score(current,candidate,cache={},context={}){
   const hour=context.hour??new Date(this.now).getHours(),n=this.counts.get(candidate.id)||0;
   // Only a rejection in this visit suppresses its sound, tempo and transitions.
   const currentAccepted=this.canReference(current,context.currentStartedAt);
   let reference=currentAccepted?current:null;
   if(!this.sound(reference)){
    const previous=(context.recentTrackIds||[]).map(id=>this.tracksById.get(String(id))).find(track=>
     track&&!this.excludedTracks.has(String(track.id))&&(this.lastQuality.get(String(track.id))??1)>=.75&&this.sound(track));
    if(previous)reference=previous;
    else if(this.searching&&this.lastAcceptedTrack&&(this.lastQuality.get(String(this.lastAcceptedTrack.id))??0)>=.25&&this.sound(this.lastAcceptedTrack))reference=this.lastAcceptedTrack;
   }
   // Keep one reference/normalisation scale across the candidate pool, but its
   // own recording supplies no independent match, tempo or transition evidence.
   const selfReference=reference!=null&&String(reference.id)===String(candidate.id);
   const features=this.features(candidate,hour,selfReference?null:reference);
   const support=Math.max(this.recentCounts.get(candidate.id)||0,this.recentArtistCounts.get(trustedArtist(candidate.artist))||0);
   // Recent taste earns influence through repeated evidence; one skip cannot erase history.
   const recentMix=.75*support/(support+4);
   const p=(1-recentMix)*this.predictFeatures(features)+recentMix*this.predictFeatures(features,this.recentWeights);
   let score=p*100;const reasons=[];
   const seeds=[...(currentAccepted?[current?.id]:[]),...(context.recentTrackIds||[]).filter(id=>String(id)!==String(current?.id)&&(this.lastQuality.get(String(id))??1)>=.75)]
    .filter(id=>id!=null&&!this.excludedTracks.has(String(id)));
   const affinity=this.sessionGraph.affinity(seeds,candidate.id);
   score+=28*affinity;
   if(affinity>.12)reasons.push('Сочетается с вашей сессией');
   if(this.samples&&p>.58)reasons.push('По вашим прослушиваниям');
   if(!n&&(this.artistCounts.get(trustedArtist(candidate.artist))||0)>2&&p>.55)reasons.push('Новое у знакомого исполнителя');
   // Modest exploration and spacing keep a learned preference from becoming a repeat trap.
   score+=5/Math.sqrt(1+n);
   const evidence=this.evidence.get(candidate.id);
   let spacingPenalty=evidence?12*Math.exp(-Math.max(0,this.now-evidence.last)/(18*3600000)):0;
   const artist=trustedArtist(candidate.artist),recent=context.recentArtists||[];
   if(artist&&artist===trustedArtist(current?.artist))spacingPenalty+=9;
   else if(artist&&recent.slice(-3).includes(artist))spacingPenalty+=4;
   const a=reference&&!selfReference?knownBpm(reference,cache):null,b=knownBpm(candidate,cache);
   const dist=a&&b?Math.min(Math.abs(a-b),Math.abs(a*2-b),Math.abs(a-b*2)):null;
   if(dist!==null){score+=6*Math.exp(-dist/12);if(dist<8)reasons.push('Близкий темп');}
   const vibeSound=Sound.texture(context.vibeProfile)?context.vibeProfile:null;
   const currentSound=vibeSound||this.sound(reference),candidateSound=this.sound(candidate);
   let soundSimilarity=selfReference&&!vibeSound?null:this.similarity(currentSound,candidateSound);
   // Compare with separate accepted recordings, not their averaged spectrum:
   // a sustained listening mood should survive one transitional song. A deliberate
   // switch to a different sound (or a saved vibe) must still take effect immediately.
   if(!vibeSound&&!selfReference&&Sound.texture(currentSound)&&Sound.texture(candidateSound)){
    const anchors=[...this.sessionSoundTracks.values()].reverse().filter(track=>
     String(track.id)!==String(reference?.id)&&String(track.id)!==String(candidate.id)&&!this.excludedTracks.has(String(track.id))&&
     (this.lastQuality.get(String(track.id))??0)>=.75).map(track=>this.sound(track))
     .filter(profile=>Sound.texture(profile)&&(this.similarity(currentSound,profile)??0)>=.6).slice(0,3);
    if(anchors.length>=2&&soundSimilarity!==null){
     const continuity=anchors.reduce((sum,profile)=>sum+this.similarity(profile,candidateSound),0)/anchors.length;
     soundSimilarity=.7*soundSimilarity+.3*continuity;
     if(continuity>.75)reasons.unshift('В настроении последних прослушанных треков');
    }
   }
   if(currentSound){
    const detailed=!!Sound.texture(currentSound),confidence=detailed?1:.55;
    if(detailed&&candidateSound&&!Sound.texture(candidateSound)&&soundSimilarity!==null)
     soundSimilarity=.5+.55*(soundSimilarity-.5);
    const sim=soundSimilarity??.5;
    if(selfReference){
     score=(1-confidence)*score+confidence*(70*sim+.25*score);
    }else{
     const candidateDetailed=!!Sound.texture(candidateSound);
     const historyScale=candidateDetailed?0.55:0.30;
     score=(1-confidence)*score+confidence*(historyScale*score+65*sim);
    }
    if(soundSimilarity!==null&&soundSimilarity>.65)reasons.unshift(vibeSound?'Звучание сохранённого вайба':'Близкое звучание');
   }
   score-=spacingPenalty;
   if(candidate.favorite===true||candidate.favorite===1)score+=2;
   const soundPreference=this.soundPreference(candidate,candidateSound);
   score+=16*soundPreference;
   if(soundPreference>.15)reasons.push(this.soundPreferenceCache.get(String(candidate.id))?.provisional?'Похоже на первые удачные прослушивания':'Похоже на музыку, к которой вы возвращаетесь');
   // A short explicit rejection suppresses acoustic neighbours, even with other artists/tags.
   // Max, not sum: repeated skips cannot accidentally blacklist the whole library.
   let skipPenalty=0;
   const negativeSound=candidateSound||(this.soundSkips.length?this.sound(candidate,true):null);
   if(negativeSound)for(const skip of this.soundSkips){
    const similarity=this.similarity(skip.profile,negativeSound,true);
    if(similarity!==null){
     let match=Math.max(0,(similarity-.55)/.45);
     const acceptedSimilarity=this.similarity(skip.acceptedProfile,negativeSound,true);
     // Penalize only the extra resemblance to a preview over the chosen sound.
     // This preserves a rejected direction without vetoing the confirmed mood.
     if(acceptedSimilarity!==null)match=Math.min(match,Math.max(0,(similarity-acceptedSimilarity)/.45));
     skipPenalty=Math.max(skipPenalty,80*skip.strength*Math.min(1,skip.profile.seconds/4)*match**2);
    }
   }
   const rejectionPenalty=30*(this.trackRejections.get(String(candidate.id))||0);
   score-=Math.max(skipPenalty,rejectionPenalty);
   if(!reasons.length)reasons.push(this.samples?'Расширяем подбор':'Знакомимся с вашим вкусом');
   return {score,bpm:b,dist,reasons:reasons.slice(0,2),probability:p,affinity,soundSimilarity,soundPreference,skipPenalty,rejectionPenalty,
    explanation:{referenceTitle:vibeSound||selfReference?null:reference?.title||null,referenceBpm:a,liked:candidate.favorite===true||candidate.favorite===1}};
  }
 }
 TasteModel.artistIdentity=track=>trustedArtist(track?.artist);
 TasteModel.knownBpm=knownBpm;return TasteModel;
});

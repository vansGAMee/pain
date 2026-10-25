/* Measured audio descriptors, collected from playback before EQ. No model downloads. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AudioProfile=factory();})(globalThis,()=>{
 const Timbre=typeof module==='object'&&module.exports?require('./audio-timbre'):globalThis.AudioTimbre;
 const clamp=n=>Math.max(0,Math.min(1,n));
 const VERSION=4,MAX_FRAMES=360,ANALYSIS_FRAMES=48,BODY_FRAMES=24,MAX_CACHE=50000;
 function frame(wave,spectrumDb,sampleRate){
  if(!wave?.length||wave.length>32768||!spectrumDb?.length||spectrumDb.length>16384||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)return null;
  let mean=0;for(const x of wave){if(!Number.isFinite(x))return null;mean+=x;}mean/=wave.length;
  let energy=0,peak=0;for(const x of wave){const centered=x-mean;energy+=centered*centered;peak=Math.max(peak,Math.abs(centered));}
  const rms=Math.sqrt(energy/wave.length);if(!Number.isFinite(rms)||rms<.0001)return null;
  let total=0,bass=0,mid=0,high=0,centroid=0,logs=0,bins=0;
  for(let i=1;i<spectrumDb.length;i++){
   const hz=i*sampleRate/(2*spectrumDb.length);if(hz<40||hz>10000)continue;
   const db=spectrumDb[i];if(typeof db!=='number'||Number.isNaN(db)||db===Infinity)return null;
   const power=db===-Infinity?0:Math.pow(10,Math.max(-120,Math.min(0,db))/10);
   total+=power;centroid+=hz*power;logs+=Math.log(Math.max(power,1e-12));bins++;
   if(hz<250)bass+=power;else if(hz<2000)mid+=power;else high+=power;
  }
  if(!bins||total<1e-9)return null;
  // Crest shape is gain independent: volume changes must not redefine a song's character.
  return [clamp(rms/peak),bass/total,mid/total,high/total,clamp(centroid/total/8000),clamp(Math.exp(logs/bins)/(total/bins))];
 }
 function shape(p){return !!p&&p.analysis?.method!=='metadata-fallback-v1'&&Array.isArray(p.vector)&&p.vector.length===6&&p.vector.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&Number.isInteger(p.frames)&&p.frames>0&&p.frames<=MAX_FRAMES&&Number.isFinite(p.seconds)&&p.seconds>0&&p.seconds<=p.frames*1.5;}
 function valid(p){return shape(p)&&p.frames>=20&&p.seconds>=10;}
 function ready(p,partial=false){return partial?shape(p)&&p.frames>=4&&p.seconds>=2:valid(p);}
 const validVariance=(v,size=6)=>Array.isArray(v)&&v.length===size&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=.25);
 function variation(p){return valid(p)&&validVariance(p.variance)?p.variance.map(v=>2*Math.sqrt(v)):null;}
 const validTimbre=v=>Array.isArray(v)&&v.length===12&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
 function texture(p){return valid(p)&&validTimbre(p.timbre)&&validVariance(p.timbreVariance,12)?{mean:p.timbre,variation:p.timbreVariance.map(v=>2*Math.sqrt(v))}:null;}
 const detailValid=d=>d?.version===1&&Array.isArray(d.mean)&&d.mean.length===7&&d.mean.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&Number.isInteger(d.frames)&&d.frames>=0&&d.frames<=24&&Number.isFinite(d.seconds)&&d.seconds>=0&&d.seconds<=d.frames*1.5&&Array.isArray(d.positions)&&d.positions.length===d.frames&&d.positions.length<=24&&d.positions.every(n=>Number.isSafeInteger(n)&&n>=0)&&new Set(d.positions).size===d.positions.length;
 let detailCache=null;
 function withCachedDetails(task){
  // Synchronous scoring cannot receive new audio frames. Discard at the end
  // so edits to a profile are validated again by the next operation.
  const previous=detailCache;detailCache=new WeakMap();
  try{return task();}finally{detailCache=previous;}
 }
 function detailParts(p){
  if(p&&detailCache?.has(p))return detailCache.get(p);
  const parts=detailValid(p?.detail)?[p.detail]:[];
  // A separate bounded body excerpt upgrades old intro caches without
  // changing their measurements or double-counting replayed positions.
  if(detailValid(p?.bodyDetail)&&!p.bodyDetail.positions.some(n=>parts[0]?.positions.includes(n)))parts.push(p.bodyDetail);
  if(p&&typeof p==='object')detailCache?.set(p,parts);
  return parts;
 }
 const detailFrames=(p,fromSecond)=>detailParts(p).reduce((n,d)=>n+
  (fromSecond===undefined?d.frames:d.positions.filter(position=>position/2>=fromSecond).length),0);
 function detail(p){
  const parts=detailParts(p),frames=parts.reduce((n,d)=>n+d.frames,0),seconds=parts.reduce((n,d)=>n+d.seconds,0);
  if(frames<20||seconds<10)return null;
  return parts.length===1?parts[0].mean:Array.from({length:7},(_,i)=>parts.reduce((n,d)=>n+d.mean[i]*d.frames,0)/frames);
 }
 function stored(p){return shape(p)&&validVariance(p.variance)&&p.version===VERSION&&(p.timbre===null&&p.timbreVariance===null||validTimbre(p.timbre)&&validVariance(p.timbreVariance,12))&&typeof p.signature==='string'&&p.signature.length<=4096&&Array.isArray(p.positions)&&p.positions.length===p.frames&&p.positions.every(n=>Number.isSafeInteger(n)&&n>=0)&&new Set(p.positions).size===p.positions.length;}
 function similarity(a,b,partial=false){
  if(!ready(a,partial)||!ready(b,partial))return null;
  const weights=[.5,1.2,1,1.4,1.2,1.2];let distance=0;
  for(let i=0;i<6;i++)distance+=weights[i]*(a.vector[i]-b.vector[i])**2;
  const av=variation(a),bv=variation(b);
  if(av&&bv)for(let i=0;i<6;i++)distance+=.2*(av[i]-bv[i])**2;
  const ad=detail(a),bd=detail(b);
  const detailMatch=ad&&bd?Math.exp(-4.5*ad.reduce((sum,v,i)=>sum+(v-bd[i])**2,0)/7):1;
  if(validTimbre(a.timbre)&&validTimbre(b.timbre)&&validVariance(a.timbreVariance,12)&&validVariance(b.timbreVariance,12)){
   // Diagonal Gaussian Bhattacharyya distance: compare timbre distributions,
   // not just bass/treble averages. A variance floor regularizes short excerpts.
   // MFCC statistical summaries: https://essentia.upf.edu/howto_standard_extractor.html
   let timbreDistance=0;
   for(let i=0;i<12;i++){
    const va=a.timbreVariance[i]+.0025,vb=b.timbreVariance[i]+.0025;
    timbreDistance+=(a.timbre[i]-b.timbre[i])**2/(4*(va+vb))+.25*Math.log(.25*(va/vb+vb/va+2));
   }
   return detailMatch*Math.exp(-(2.5*timbreDistance/12+3.5*distance));
  }
  return detailMatch*Math.exp(-3.5*distance);
 }
 // Local scaling makes a match relative to the surrounding audio, rather than
 // declaring almost every bass-heavy recording similar. No decoding or training.
 // https://jmlr.csail.mit.edu/papers/v13/schnitzer12a.html
 let matchCache=null;
 const neighbourhoodDistances=new WeakMap();
 function neighbourhoodDistance(a,b){
  let row=neighbourhoodDistances.get(a);const cached=row?.get(b);
  if(cached!==undefined)return cached;
  const distance=-Math.log(Math.max(similarity(a,b),1e-12));
  if(!row){row=new WeakMap();neighbourhoodDistances.set(a,row);}row.set(b,distance);
  let reverse=neighbourhoodDistances.get(b);
  if(!reverse){reverse=new WeakMap();neighbourhoodDistances.set(b,reverse);}reverse.set(a,distance);
  return distance;
 }
 function calibratedSimilarity(profiles=[]){
  const source=profiles.filter(p=>texture(p));
  if(matchCache&&source.length===matchCache.source.length&&source.every((p,i)=>p===matchCache.source[i]))return matchCache.match;
  const unique=new Map();
  for(const p of source){
   const key=JSON.stringify([p.vector,p.variance,p.timbre,p.timbreVariance,detail(p)]);
   if(!unique.has(key)){
    let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);
    unique.set(key,{key,hash:hash>>>0,profile:p});
   }
  }
  const ordered=[...unique.values()].sort((a,b)=>a.hash-b.hash||a.key.localeCompare(b.key));
  let match=similarity;
  if(ordered.length>=12){
   // At most 96 references, sampled independently of title, artist and likes.
   const count=Math.min(96,ordered.length),anchors=Array.from({length:count},(_,i)=>ordered[Math.floor(i*ordered.length/count)].profile);
   const radii=new WeakMap(),neighbour=Math.max(2,Math.min(7,Math.round(count*.05)));
   function radius(p){
    if(radii.has(p))return radii.get(p);
    const distances=[];
    for(const anchor of anchors){const d=neighbourhoodDistance(p,anchor);if(d>1e-6)distances.push(d);}
    distances.sort((a,b)=>a-b);
    const value=distances.length>=neighbour?distances[neighbour-1]:null;radii.set(p,value);return value;
   }
   match=(a,b,partial=false)=>{
    const raw=similarity(a,b,partial);
    // Short previews / missing detail do not supply a local audio neighbourhood.
    if(raw===null||raw>=.999999||!texture(a)||!texture(b))return raw;
    const ra=radius(a),rb=radius(b);if(ra===null||rb===null)return raw;
    const scale=Math.max(.02,Math.sqrt(ra*rb));
    // Never promote a genuinely distant pair just because its style is rare.
    return Math.min(raw,Math.exp(.5*Math.log(Math.max(raw,1e-12))/scale));
   };
  }
  matchCache={source,match};return match;
 }
 const signature=t=>JSON.stringify([t?.duration||0,t?.bytes||0,t?.mime||'',t?.modified||t?.dateModified||t?.lastModified||0,t?.uri||t?.path||'']);
 function read(store,track){if(!track||track.id==null||!store||!Object.hasOwn(store,track.id))return null;const p=store[track.id];return stored(p)&&p.signature===signature(track)?p:null;}
 function get(store,track,partial=false){const p=read(store,track);return ready(p,partial)?p:null;}
 function prune(store,limit=MAX_CACHE){
  const keys=Object.keys(store).sort((a,b)=>(store[b]?.updatedAt||0)-(store[a]?.updatedAt||0));
  for(const id of keys.slice(limit))delete store[id];
 }
 function restore(raw,limit=MAX_CACHE){
  const result=Object.create(null);
  try{const data=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{});if(data&&typeof data==='object'&&!Array.isArray(data))for(const [id,p] of Object.entries(data))if(id.length<=1024&&stored(p))Object.defineProperty(result,id,{value:p,enumerable:true,writable:true,configurable:true});}catch(_){}
  prune(result,limit);return result;
 }
 function persist(store,storage,key='pain_audio_profiles_v4',limit=MAX_CACHE){
  prune(store,limit);
  try{storage.setItem(key,JSON.stringify(store));return true;}catch(_){}
  // Keep recent evidence usable if the browser quota is shared with other application data.
  const snapshot=Object.assign(Object.create(null),store),half=Math.floor(Object.keys(snapshot).length/2);
  for(const stepLimit of [half,Math.min(64,Math.floor(half/2))]){
   if(stepLimit<1)break;prune(snapshot,stepLimit);try{storage.setItem(key,JSON.stringify(snapshot));return true;}catch(_){}
  }
  return false;
 }
 function observe(context,source,audio,getTrack,onProfile,store,options={}){
  const now=options.now||(()=>performance.now()),schedule=options.setInterval||setInterval,cancel=options.clearInterval||clearInterval;
  const nodes=[],listeners=[];let splitter=null;
  function analyser(){const node=context.createAnalyser();node.fftSize=2048;node.smoothingTimeConstant=0;nodes.push(node);return node;}
  try{
   const first=analyser();
   if(typeof context.createChannelSplitter==='function'){
    splitter=context.createChannelSplitter(2);source.connect(splitter);splitter.connect(first,0);splitter.connect(analyser(),1);
   }else source.connect(first);
  }catch(error){try{source.disconnect(splitter||nodes[0]);splitter?.disconnect();}catch(_){}throw error;}
  const buffers=nodes.map(node=>({wave:new Float32Array(node.fftSize),spectrum:new Float32Array(node.frequencyBinCount)}));
  const detailSupported=context.sampleRate>=16000&&context.sampleRate<=192000;
  let timer=null,previous=null,trackKey=null,activeTrack=null,profile=null,positions=new Set(),dirty=false,disposed=false,src=null;
  let step=.5,bodyPosition=Infinity,bodyFrames=0;
  function listen(target,event,fn){if(target.addEventListener){target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));}}
  function flush(){
   if(!dirty||!profile||!activeTrack)return;dirty=false;
   const saved={...profile,version:VERSION,vector:profile.vector.map(n=>Math.round(n*100000)/100000),positions:[...positions],updatedAt:Date.now()};
   if(profile.detail)saved.detail={...profile.detail,mean:[...profile.detail.mean],positions:[...profile.detail.positions]};
   if(profile.bodyDetail)saved.bodyDetail={...profile.bodyDetail,mean:[...profile.bodyDetail.mean],positions:[...profile.bodyDetail.positions]};
   if(!stored(saved))return;
   try{Object.defineProperty(store,activeTrack.id,{value:saved,enumerable:true,writable:true,configurable:true});prune(store);}catch(_){}
   try{onProfile(activeTrack,saved);}catch(_){} // Analysis must never interrupt playback.
  }
  function boundary(){flush();previous=null;}
  function sample(){
   if(disposed)return;
   try{
    const track=getTrack();
    if(!track||track.id==null){boundary();return;}
    const key=JSON.stringify([track.id,signature(track)]),sourceUrl=audio.currentSrc||audio.src||'';
    if(key!==trackKey){
     boundary();trackKey=key;activeTrack={...track};const cached=read(store,track);
     profile=cached?{...cached,vector:[...cached.vector]}:{version:VERSION,signature:signature(track),vector:[0,0,0,0,0,0],variance:[0,0,0,0,0,0],timbre:null,timbreVariance:null,frames:0,seconds:0};positions=new Set(cached?.positions||[]);
     profile.detail=detailValid(cached?.detail)?{...cached.detail,mean:[...cached.detail.mean],positions:[...cached.detail.positions]}:{version:1,mean:Array(7).fill(0),frames:0,seconds:0,positions:[]};
     if(detailValid(cached?.bodyDetail))profile.bodyDetail={...cached.bodyDetail,mean:[...cached.bodyDetail.mean],positions:[...cached.bodyDetail.positions]};
     else delete profile.bodyDetail;
     const duration=Number(track.duration)/1000;
     // Preserve the v4 grid and old evidence. Add at most 24 extra frames
     // from the body during playback: an intro alone need not describe the song.
     step=Number.isFinite(duration)&&duration>0?Math.max(.5,Math.ceil(duration/MAX_FRAMES*2)/2):.5;
     bodyPosition=Number.isFinite(duration)&&duration>=60?Math.ceil(Math.max(30,duration*.35)/step):Infinity;
     bodyFrames=[...positions].filter(p=>p>=bodyPosition).length;
     if(profile.bodyDetail?.positions.some(p=>p/2<bodyPosition*step||profile.detail.positions.includes(p)))delete profile.bodyDetail;
    }
    if(src!==sourceUrl){boundary();src=sourceUrl;}
    const mediaTime=audio.currentTime;
    if(audio.paused||audio.seeking||audio.readyState<3||context.state!=='running'||audio.muted||audio.volume===0||audio.playbackRate!==1||!Number.isFinite(mediaTime)||mediaTime<0){boundary();return;}
    const needsBody=bodyPosition!==Infinity&&bodyFrames<BODY_FRAMES&&profile.frames<ANALYSIS_FRAMES+BODY_FRAMES;
    const fullFile=profile.analysis?.method==='stratified-pcm-v1'&&!!detail(profile);
    const bodyDetailFrames=detailFrames(profile,bodyPosition*step);
    const needsBodyDetail=detailSupported&&!fullFile&&bodyPosition!==Infinity&&bodyDetailFrames<BODY_FRAMES;
    // Reuse both cached excerpts; never decode or scan tracks in the background.
    if(profile.frames>=ANALYSIS_FRAMES&&!needsBody&&!needsBodyDetail&&(!detailSupported||profile.detail.frames>=24)){boundary();return;}
    const current={wall:now(),media:mediaTime},last=previous;previous=current;
    if(!last||!Number.isFinite(current.wall))return;
    const wall=(current.wall-last.wall)/1000,media=current.media-last.media;
    if(wall<=0||wall>1.5||media<=0||Math.abs(media-wall)>.35)return;
    const position=Math.floor(mediaTime/step),detailPosition=Math.floor(mediaTime*2);
    if(!Number.isSafeInteger(position)||!Number.isSafeInteger(detailPosition))return;
    const updateBase=!positions.has(position)&&(profile.frames<ANALYSIS_FRAMES||needsBody&&position>=bodyPosition);
    const updateIntroDetail=detailSupported&&profile.detail.frames<24&&!profile.detail.positions.includes(detailPosition);
    const updateBodyDetail=!updateIntroDetail&&needsBodyDetail&&(profile.bodyDetail?.frames||0)<BODY_FRAMES&&position>=bodyPosition&&
      !profile.detail.positions.includes(detailPosition)&&!(profile.bodyDetail?.positions||[]).includes(detailPosition);
    const updateDetail=updateIntroDetail||updateBodyDetail;
    if(!updateBase&&!updateDetail)return;
    const wasDetailReady=!!detail(profile);let publishDetail=false;
    let vector=null,timbre=null,timbrePower=0,totalPower=0,instruments=null,detailPower=0;
    nodes.forEach((node,i)=>{
     const buffer=buffers[i];node.getFloatTimeDomainData(buffer.wave);node.getFloatFrequencyData(buffer.spectrum);
     const v=frame(buffer.wave,buffer.spectrum,context.sampleRate);if(!v)return;
     let power=0;for(const x of buffer.wave)power+=x*x;
     const tone=updateBase?Timbre.frame(buffer.spectrum,context.sampleRate):null;
     const extra=updateDetail?Timbre.detail(buffer.wave,buffer.spectrum,context.sampleRate):null;
     if(extra){instruments=instruments?instruments.map((x,j)=>(x*detailPower+extra[j]*power)/(detailPower+power)):extra;detailPower+=power;}
     if(tone){timbre=timbre?timbre.map((x,j)=>(x*timbrePower+tone[j]*power)/(timbrePower+power)):tone;timbrePower+=power;}
     if(!vector)vector=v;else vector=vector.map((x,j)=>(x*totalPower+v[j]*power)/(totalPower+power));totalPower+=power;
    });
    if(updateDetail&&instruments){
     const d=updateIntroDetail?profile.detail:(profile.bodyDetail||= {version:1,mean:Array(7).fill(0),frames:0,seconds:0,positions:[]});
     d.positions.push(detailPosition);dirty=true;
     d.frames++;d.seconds+=Math.min(wall,media);d.mean=d.mean.map((v,i)=>v+(instruments[i]-v)/d.frames);
     publishDetail=(!wasDetailReady&&!!detail(profile))||d.frames===24||updateBodyDetail&&bodyDetailFrames+1===BODY_FRAMES;
    }
    if(!vector||!updateBase){if(publishDetail)flush();return;}
    const wasPartialReady=ready(profile,true),wasReady=ready(profile);
    const n=profile.frames+1,mean=profile.vector.map((v,i)=>v+(vector[i]-v)/n);
    // Online population variance preserves contrast between sections without retaining PCM.
    profile.variance=profile.variance.map((v,i)=>Math.max(0,Math.min(.25,
      (v*profile.frames+(vector[i]-profile.vector[i])*(vector[i]-mean[i]))/n)));
    if(timbre){
     if(!profile.frames){profile.timbre=timbre;profile.timbreVariance=Array(12).fill(0);}
     else if(profile.timbre){
      const next=profile.timbre.map((v,i)=>v+(timbre[i]-v)/n);
      profile.timbreVariance=profile.timbreVariance.map((v,i)=>Math.max(0,Math.min(.25,(v*profile.frames+(timbre[i]-profile.timbre[i])*(timbre[i]-next[i]))/n)));
      profile.timbre=next;
     }
    }else {profile.timbre=null;profile.timbreVariance=null;}
    profile.vector=mean;profile.frames++;profile.seconds+=Math.min(wall,media);positions.add(position);dirty=true;
    if(position>=bodyPosition)bodyFrames++;
    // Timer jitter can leave frame 4/20 just below 2/10 seconds. Publish when
    // evidence actually becomes usable, without waiting for the next periodic save.
    if(publishDetail||!wasPartialReady&&ready(profile,true)||!wasReady&&ready(profile)||profile.frames%20===0||profile.frames===ANALYSIS_FRAMES||profile.frames===ANALYSIS_FRAMES+BODY_FRAMES||position>=bodyPosition&&bodyFrames===BODY_FRAMES)flush();
   }catch(_){boundary();}
  }
  function start(){if(!disposed&&timer===null)timer=schedule(sample,500);}
  function stop(){if(timer!==null)cancel(timer);timer=null;boundary();}
  listen(audio,'playing',start);
  for(const event of ['pause','ended','emptied','abort','error'])listen(audio,event,stop);
  for(const event of ['seeking','seeked','loadstart','ratechange','volumechange','waiting','stalled'])listen(audio,event,boundary);
  listen(context,'statechange',()=>{if(context.state==='running'&&!audio.paused)start();else stop();});
  if(typeof window!=='undefined')listen(window,'pagehide',stop);
  if(!audio.paused)start();
  return ()=>{if(disposed)return;disposed=true;stop();for(const remove of listeners)remove();try{source.disconnect(splitter||nodes[0]);splitter?.disconnect();for(const node of nodes)node.disconnect();}catch(_){};};
 }
 return {frame,valid,similarity,calibratedSimilarity,variation,texture,detail,detailFrames,withCachedDetails,signature,get,observe,restore,persist,prune,MAX_CACHE};
});

/* Measured audio descriptors, collected from playback before EQ. No model downloads. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AudioProfile=factory();})(globalThis,()=>{
 const Timbre=typeof module==='object'&&module.exports?require('./audio-timbre'):globalThis.AudioTimbre;
 const clamp=n=>Math.max(0,Math.min(1,n));
 const VERSION=4,MAX_FRAMES=360,ANALYSIS_FRAMES=48,MAX_CACHE=750;
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
 function shape(p){return !!p&&Array.isArray(p.vector)&&p.vector.length===6&&p.vector.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&Number.isInteger(p.frames)&&p.frames>0&&p.frames<=MAX_FRAMES&&Number.isFinite(p.seconds)&&p.seconds>0&&p.seconds<=p.frames*1.5;}
 function valid(p){return shape(p)&&p.frames>=20&&p.seconds>=10;}
 function ready(p,partial=false){return partial?shape(p)&&p.frames>=4&&p.seconds>=2:valid(p);}
 const validVariance=(v,size=6)=>Array.isArray(v)&&v.length===size&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=.25);
 function variation(p){return valid(p)&&validVariance(p.variance)?p.variance.map(v=>2*Math.sqrt(v)):null;}
 const validTimbre=v=>Array.isArray(v)&&v.length===12&&v.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
 function texture(p){return valid(p)&&validTimbre(p.timbre)&&validVariance(p.timbreVariance,12)?{mean:p.timbre,variation:p.timbreVariance.map(v=>2*Math.sqrt(v))}:null;}
 function stored(p){return shape(p)&&validVariance(p.variance)&&p.version===VERSION&&(p.timbre===null&&p.timbreVariance===null||validTimbre(p.timbre)&&validVariance(p.timbreVariance,12))&&typeof p.signature==='string'&&p.signature.length<=4096&&Array.isArray(p.positions)&&p.positions.length===p.frames&&p.positions.every(n=>Number.isSafeInteger(n)&&n>=0)&&new Set(p.positions).size===p.positions.length;}
 function similarity(a,b,partial=false){
  if(!ready(a,partial)||!ready(b,partial))return null;
  const weights=[.5,1,1,1,1,.5];let distance=0;
  for(let i=0;i<6;i++)distance+=weights[i]*(a.vector[i]-b.vector[i])**2;
  const av=variation(a),bv=variation(b);
  if(av&&bv)for(let i=0;i<6;i++)distance+=.2*(av[i]-bv[i])**2;
  if(validTimbre(a.timbre)&&validTimbre(b.timbre)&&validVariance(a.timbreVariance,12)&&validVariance(b.timbreVariance,12)){
   // Diagonal Gaussian Bhattacharyya distance: compare timbre distributions,
   // not just bass/treble averages. A variance floor regularizes short excerpts.
   // MFCC statistical summaries: https://essentia.upf.edu/howto_standard_extractor.html
   let timbreDistance=0;
   for(let i=0;i<12;i++){
    const va=a.timbreVariance[i]+.0025,vb=b.timbreVariance[i]+.0025;
    timbreDistance+=(a.timbre[i]-b.timbre[i])**2/(4*(va+vb))+.25*Math.log(.25*(va/vb+vb/va+2));
   }
   return Math.exp(-3*(.75*timbreDistance/12+.25*distance));
  }
  return Math.exp(-3*distance);
 }
 const signature=t=>JSON.stringify([t?.duration||0,t?.bytes||0,t?.mime||'',t?.modified||t?.dateModified||t?.lastModified||0,t?.uri||t?.path||'']);
 function read(store,track){if(!track||track.id==null||!store||!Object.hasOwn(store,track.id))return null;const p=store[track.id];return stored(p)&&p.signature===signature(track)?p:null;}
 function get(store,track,partial=false){const p=read(store,track);return ready(p,partial)?p:null;}
 function prune(store,limit=MAX_CACHE){
  const keys=Object.keys(store).sort((a,b)=>(store[b]?.updatedAt||0)-(store[a]?.updatedAt||0));
  for(const id of keys.slice(limit))delete store[id];
 }
 function restore(raw){
  const result=Object.create(null);
  try{const data=JSON.parse(raw||'{}');if(data&&typeof data==='object'&&!Array.isArray(data))for(const [id,p] of Object.entries(data))if(id.length<=1024&&stored(p))Object.defineProperty(result,id,{value:p,enumerable:true,writable:true,configurable:true});}catch(_){}
  prune(result);return result;
 }
 function persist(store,storage,key='pain_audio_profiles_v4'){
  prune(store);
  try{storage.setItem(key,JSON.stringify(store));return true;}catch(_){}
  // Keep recent evidence usable if the browser quota is shared with other application data.
  const snapshot=Object.assign(Object.create(null),store),half=Math.floor(Object.keys(snapshot).length/2);
  for(const limit of [half,Math.min(64,Math.floor(half/2))]){
   if(limit<1)break;prune(snapshot,limit);try{storage.setItem(key,JSON.stringify(snapshot));return true;}catch(_){}
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
  let timer=null,previous=null,trackKey=null,activeTrack=null,profile=null,positions=new Set(),dirty=false,disposed=false,src=null;
  function listen(target,event,fn){if(target.addEventListener){target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));}}
  function flush(){
   if(!dirty||!profile||!activeTrack)return;dirty=false;
   const saved={...profile,version:VERSION,vector:profile.vector.map(n=>Math.round(n*100000)/100000),positions:[...positions],updatedAt:Date.now()};
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
    }
    if(src!==sourceUrl){boundary();src=sourceUrl;}
    const mediaTime=audio.currentTime;
    if(audio.paused||audio.seeking||audio.readyState<3||context.state!=='running'||audio.muted||audio.volume===0||audio.playbackRate!==1||!Number.isFinite(mediaTime)||mediaTime<0){boundary();return;}
    // Reuse complete cached excerpts; no analysis of the rest of the library/track.
    if(profile.frames>=ANALYSIS_FRAMES){boundary();return;}
    const current={wall:now(),media:mediaTime},last=previous;previous=current;
    if(!last||!Number.isFinite(current.wall))return;
    const wall=(current.wall-last.wall)/1000,media=current.media-last.media;
    if(wall<=0||wall>1.5||media<=0||Math.abs(media-wall)>.35)return;
    const duration=Number(track.duration)/1000;
    // Keep the v4 position grid compatible with profiles measured before this budget cap.
    const step=Number.isFinite(duration)&&duration>0?Math.max(.5,Math.ceil(duration/MAX_FRAMES*2)/2):.5;
    const position=Math.floor(mediaTime/step);if(!Number.isSafeInteger(position)||positions.has(position))return;
    let vector=null,timbre=null,timbrePower=0,totalPower=0;
    nodes.forEach((node,i)=>{
     const buffer=buffers[i];node.getFloatTimeDomainData(buffer.wave);node.getFloatFrequencyData(buffer.spectrum);
     const v=frame(buffer.wave,buffer.spectrum,context.sampleRate);if(!v)return;
     let power=0;for(const x of buffer.wave)power+=x*x;
     const tone=Timbre.frame(buffer.spectrum,context.sampleRate);
     if(tone){timbre=timbre?timbre.map((x,j)=>(x*timbrePower+tone[j]*power)/(timbrePower+power)):tone;timbrePower+=power;}
     if(!vector)vector=v;else vector=vector.map((x,j)=>(x*totalPower+v[j]*power)/(totalPower+power));totalPower+=power;
    });
    if(!vector)return;
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
    // Early provisional evidence lets a quick skip reject similar sounds immediately.
    if(profile.frames===4||profile.frames%20===0||profile.frames===ANALYSIS_FRAMES)flush();
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
 return {frame,valid,similarity,variation,texture,signature,get,observe,restore,persist};
});

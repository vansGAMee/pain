/* Lightweight corrective EQ from the audio profile already measured during playback. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AutoEqualizer=factory();})(globalThis,()=>{
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const flat=()=>({ready:false,bands:Array(8).fill(0),preamp:0,character:'learning'});

 // Unconnected native filters measure the combined curve only when it changes.
 // Summing every positive slider over-attenuates separated frequency bands.
 function createHeadroom(context,centers){
  const frequencies=Float32Array.from([...Array.from({length:128},(_,i)=>20*Math.pow(Math.min(20000,context.sampleRate*.49)/20,i/127)),...centers]);
  const magnitude=new Float32Array(frequencies.length),phase=new Float32Array(frequencies.length);
  const filters=centers.map((frequency,i)=>{
   const node=context.createBiquadFilter();node.type=i===0?'lowshelf':i===centers.length-1?'highshelf':'peaking';
   node.frequency.value=frequency;node.Q.value=1.2;return node;
  });
  let previous=null,cached=null;
  const responseFor=bands=>{
   const key=JSON.stringify(bands);if(key===previous)return cached;
   const response=new Float64Array(frequencies.length).fill(1);
   filters.forEach((node,i)=>{
    node.gain.value=bands[i];node.getFrequencyResponse(frequencies,magnitude,phase);
    for(let j=0;j<response.length;j++)response[j]*=magnitude[j];
   });
   const peak=Math.max(...response);
   if(!Number.isFinite(peak)||peak<=0)throw new Error('Invalid EQ response');
   // Small margin covers the space between probe frequencies.
   cached={peak,headroom:Math.max(0,Math.ceil((20*Math.log10(peak)+.25)*4)/4),
    attenuation:Math.max(0,-20*Math.log10(Math.min(...response)))};previous=key;return cached;
  };
  const measure=bands=>responseFor(bands).headroom;measure.response=responseFor;return measure;
 }

 // Reference matching: gain (dB) = 10 * log10(reference power / source power).
 // The reference is the normalized median of measured library band powers.
 // Broad, subtle moves on finished stereo masters: iZotope's mastering guidance.
 // https://www.izotope.com/community/blog/how-to-eq-your-master
 const FREQUENCIES=[60,170,310,600,1000,3000,6000,12000];
 const ANCHORS=[Math.sqrt(40*250),Math.sqrt(250*2000),Math.sqrt(2000*10000)];
 const MAX_CUT=3;
 const MAX_MATCH=1; // Subtle mastering-scale correction per measured range (iZotope guidance).
 function usable(p){
  return p?.analysis?.method!=='metadata-fallback-v1'&&Array.isArray(p?.vector)&&p.vector.length===6&&
   p.vector.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&p.vector.slice(1,4).some(v=>v>0)&&Number.isInteger(p.frames)&&p.frames>=20&&p.frames<=360&&
   Number.isFinite(p.seconds)&&p.seconds>=10&&p.seconds<=p.frames*1.5;
 }
 function ratios(p){
  if(!usable(p))return null;
  const values=p.vector.slice(1,4),sum=values.reduce((a,b)=>a+b,0);
  // An absent range / pure tone is not a useful reference for full-band music.
  if(values.some(v=>v<=0)||!(sum>0))return null;
  return values.map(v=>v/sum);
 }
 function quantile(sorted,p){
  const at=(sorted.length-1)*p,lo=Math.floor(at),hi=Math.ceil(at);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo);
 }
 function createReference(entries=[]){
  const seen=new Map(),aliases=new Map(),rows=[];
  for(const entry of entries){
   const values=ratios(entry.profile);if(!values)continue;
   // Exact duplicate measurements should not gain extra influence via file aliases.
   const key=JSON.stringify(entry.profile.vector),id=String(entry.id);
   if(seen.has(key)){aliases.set(id,seen.get(key));continue;}
   seen.set(key,id);aliases.set(id,id);rows.push({id,values});
  }
  const columns=[0,1,2].map(i=>rows.map(r=>({id:r.id,value:r.values[i]})).sort((a,b)=>a.value-b.value));
  const cache=new Map();
  return {count:rows.length,limits(id){
   id=String(id??'');id=aliases.get(id)||id;if(cache.has(id))return cache.get(id);
   const columnsWithoutSelf=columns.map(column=>column.filter(row=>row.id!==id).map(row=>row.value));
   const count=columnsWithoutSelf[0].length;
   // Preserve the existing minimum reference budget for sparse libraries.
   let target=count>=4?columnsWithoutSelf.map(a=>quantile(a,.5)):null;
   if(target){const total=target.reduce((a,b)=>a+b,0);target=target.map(v=>v/total);}
   const result={count,target};if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(id,result);return result;
  }};
 }
 // Rolling measured section: at least 20 observations / 10-second
 // evidence requirement as AudioProfile. Reuses its pre-EQ stereo FFT reads.
 function createTracker(){
  let key=null,samples=[],lastPosition=null;
  const identity=t=>JSON.stringify([t?.id,t?.uri,t?.path,t?.duration,t?.bytes]);
  return {
   reset(){key=null;samples=[];lastPosition=null;},
   get(track){
    if(key!==identity(track)||samples.length<20||samples.reduce((sum,s)=>sum+s.seconds,0)<10)return null;
    const vector=Array(6).fill(0),variance=Array(6).fill(0),seconds=samples.reduce((sum,s)=>sum+s.seconds,0);
    for(const sample of samples)sample.vector.forEach((v,i)=>vector[i]+=v/samples.length);
    for(const sample of samples)sample.vector.forEach((v,i)=>variance[i]+=(v-vector[i])**2/samples.length);
    return {vector,variance,frames:samples.length,seconds,analysis:{method:'playback-window-v1'}};
   },
   observe(track,vector,seconds,position){
    if(!Array.isArray(vector)||vector.length!==6||!vector.every(v=>Number.isFinite(v)&&v>=0&&v<=1)||!Number.isFinite(seconds)||seconds<=0||seconds>1.5||!Number.isFinite(position)||position<0)return null;
    const next=identity(track);
    if(next!==key||lastPosition!==null&&(position<=lastPosition||position-lastPosition>1.5)){samples=[];key=next;}
    lastPosition=position;samples.push({vector:[...vector],seconds});if(samples.length>360)samples.shift();
    let duration=samples.reduce((sum,s)=>sum+s.seconds,0);
    while(samples.length>20&&duration-samples[0].seconds>=10)duration-=samples.shift().seconds;
    return this.get(track);
   }
  };
 }

 function recommend(track,profile,measureHeadroom=null,reference=null){
  if(!usable(profile))return {...flat(),reason:'learning',referenceTracks:reference?.count||0};
  const limits=reference?.limits(track?.id),base={ready:true,bands:Array(8).fill(0),preamp:0,character:'balanced',
   reason:'reference',referenceTracks:limits?.count||0,adjusted:false};
  if(!limits?.target)return base;
  const variance=profile.variance;
  if(!Array.isArray(variance)||variance.length!==6||!variance.every(v=>Number.isFinite(v)&&v>=0&&v<=.25))return {...base,reason:'learning',ready:false};
  const values=profile.vector.slice(1,4),sum=values.reduce((a,b)=>a+b,0);
  if(!(sum>0))return {...base,reason:'learning',ready:false};
  // A measured standard deviation is a variability guard, not a confidence
  // interval. Do not chase every kick, cymbal or changing arrangement.
  const cuts=values.map((value,i)=>{
   if(value<=0)return 0;
   const current=value/sum,target=limits.target[i],spread=Math.sqrt(variance[i+1])/sum;
   const measured=current>target?Math.max(target,current-spread):Math.min(target,current+spread);
   return clamp(10*Math.log10(target/measured),-MAX_MATCH,MAX_MATCH);
  });
  const nyquist=Number(profile.analysis?.sampleRate)>0?profile.analysis.sampleRate/2:Infinity;
  let bands=FREQUENCIES.map(hz=>{
   if(hz>=nyquist)return 0;
   if(hz<=ANCHORS[0])return cuts[0];if(hz>=ANCHORS[2])return cuts[2];
   const lo=hz<ANCHORS[1]?0:1,part=Math.log(hz/ANCHORS[lo])/Math.log(ANCHORS[lo+1]/ANCHORS[lo]);
   return cuts[lo]+(cuts[lo+1]-cuts[lo])*part;
  });
  // Bound the combined boost/attenuation, since neighbouring biquads overlap. The
  // native response is cached and measured only when a different curve is used.
  // A sum of absolute gains is safe when native response measurement is unavailable.
  for(let pass=0;pass<3;pass++){
   let attenuation=bands.reduce((sum,gain)=>sum+Math.abs(gain),0);
   try{const response=measureHeadroom?.response?.(bands),measured=response&&Math.max(response.attenuation,20*Math.log10(response.peak));if(Number.isFinite(measured)&&measured>=0)attenuation=measured;}catch(_){}
   if(attenuation<=MAX_CUT)break;
   bands=bands.map(gain=>gain*MAX_CUT/attenuation);
  }
  // Round toward zero so quantization cannot exceed the correction budget.
  bands=bands.map(v=>Math.trunc(v*4)/4||0);
  const adjusted=bands.some(v=>v!==0),dominant=cuts.findIndex(v=>Math.abs(v)===Math.max(...cuts.map(Math.abs)));
  let headroom=bands.reduce((sum,v)=>sum+Math.max(0,v),0);
  if(headroom&&measureHeadroom)try{const measured=measureHeadroom(bands);if(Number.isFinite(measured)&&measured>=0)headroom=Math.min(headroom,measured);}catch(_){}
  return {...base,bands,preamp:-headroom||0,adjusted,reason:adjusted?'corrected':'preserved',
   character:adjusted?['deep','vocal','bright'][dominant]:'balanced'};
 }

 function combine(manual,recommendation,measureHeadroom=null){
  const active=manual?.enabled!==false&&Array.isArray(manual?.bands)&&manual.bands.length===8;
  const base=active?manual.bands.map(v=>Number.isFinite(v)?clamp(v,-12,12):0):Array(8).fill(0);
  const bands=base.map((v,i)=>clamp(v+(recommendation?.bands?.[i]||0),-12,12));
  let headroom=bands.reduce((sum,v)=>sum+Math.max(0,v),0);
  if(headroom&&typeof measureHeadroom==='function')try{
   const measured=measureHeadroom(bands);if(Number.isFinite(measured)&&measured>=0)headroom=Math.min(headroom,measured);
  }catch(_){}
  const preamp=Math.min(active&&Number.isFinite(manual.preamp)?clamp(manual.preamp,-12,12):0,-headroom)||0;
  return {...recommendation,bands,preamp,base,correction:[...(recommendation?.bands||Array(8).fill(0))]};
 }

 return {recommend,combine,createReference,createHeadroom,createTracker};
});

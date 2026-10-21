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
  let previous=null,cached=0;
  return bands=>{
   const key=JSON.stringify(bands);if(key===previous)return cached;
   const response=new Float64Array(frequencies.length).fill(1);
   filters.forEach((node,i)=>{
    node.gain.value=bands[i];node.getFrequencyResponse(frequencies,magnitude,phase);
    for(let j=0;j<response.length;j++)response[j]*=magnitude[j];
   });
   const peak=Math.max(...response);
   if(!Number.isFinite(peak)||peak<=0)throw new Error('Invalid EQ response');
   // Small margin covers the space between probe frequencies.
   cached=Math.max(0,Math.ceil((20*Math.log10(peak)+.25)*4)/4);previous=key;return cached;
  };
 }

 function recommend(track,profile,measureHeadroom=null){
  const vector=profile?.vector;
  const frames=Number(profile?.frames),seconds=Number(profile?.seconds);
  if(!Array.isArray(vector)||vector.length!==6||!vector.every(value=>Number.isFinite(value)&&value>=0&&value<=1)||!Number.isInteger(frames)||frames<4||frames>360||!Number.isFinite(seconds)||seconds<2||seconds>frames*1.5)return flat();
  let [,bass,mid,high,centroid,flatness]=vector;
  const spectral=bass+mid+high;
  if(!(spectral>.0001))return flat();
  bass/=spectral;mid/=spectral;high/=spectral;

  // Labels describe the source; they no longer switch the actual EQ curve.
  const character=bass>.46?'deep':mid>.58?'vocal':high>.28||centroid>.28?'bright':'balanced';
  const variance=profile.variance;
  const stable=Array.isArray(variance)&&variance.length===6&&variance.every(v=>Number.isFinite(v)&&v>=0&&v<=.25);
  // Start gently, then trust longer excerpts. Changing sections and dense masters
  // deserve smaller corrections, not a fixed preset chosen by the intro.
  const confidence=clamp(Math.min(frames/20,seconds/10),0,1);
  const strength=confidence*(1-.4*clamp((vector[0]-.35)/.4,0,1));
  const correction=(value,lower,upper,index)=>{
   let gain=0;
   if(value>upper)gain=-Math.min(3,15*Math.log10(value/upper));
   else if(value>0&&value<lower){
    // Do not amplify an absent band, codec cutoff or noise into invented detail.
    gain=Math.min(1,5*Math.log10(lower/value))*clamp(value/(lower*.5),0,1);
    gain*=1-clamp((flatness-.35)/.3,0,1);
   }
   const reliability=stable?1/(1+6*Math.sqrt(variance[index])/spectral):.75;
   return gain*strength*reliability;
  };
  // Broad tolerance ranges preserve intentional bass/treble balance. Log ratios
  // vary continuously, unlike crossing a preset threshold by a fraction of a percent.
  const low=correction(bass,.20,.48,1),body=correction(mid,.33,.63,2),air=correction(high,.08,.28,3);
  const bands=[low*.85,low,low*.3+body*.7,body,body*.65,body*.35+air*.65,air,air*.8]
   .map(value=>Math.round(clamp(value,-3,1)*4)/4||0);
  // Filters overlap: reserving only the single largest boost can still overload.
  let headroom=bands.reduce((sum,gain)=>sum+Math.max(0,gain),0);
  if(headroom&&typeof measureHeadroom==='function')try{
   const measured=measureHeadroom(bands);
   if(Number.isFinite(measured)&&measured>=0)headroom=Math.min(headroom,measured);
  }catch(_){} // Conservative summed headroom remains available on older engines.
  return {ready:true,bands,preamp:headroom?-Math.ceil(headroom*4)/4:0,character};
 }

 return {recommend,createHeadroom};
});

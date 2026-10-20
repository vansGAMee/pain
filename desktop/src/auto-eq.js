/* Lightweight corrective EQ from the audio profile already measured during playback. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AutoEqualizer=factory();})(globalThis,()=>{
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const half=value=>Math.round(value*2)/2;
 const flat=()=>({ready:false,bands:Array(8).fill(0),preamp:0,character:'learning'});

 function recommend(track,profile){
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
   .map(value=>half(clamp(value,-3,1))||0);
  // Filters overlap: reserving only the single largest boost can still overload.
  const headroom=bands.reduce((sum,gain)=>sum+Math.max(0,gain),0);
  return {ready:true,bands,preamp:headroom?-half(headroom):0,character};
 }

 return {recommend};
});

/* Lightweight corrective EQ from the audio profile already measured during playback. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AutoEqualizer=factory();})(globalThis,()=>{
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 const half=value=>Math.round(value*2)/2;
 const flat=()=>({ready:false,bands:Array(8).fill(0),preamp:0,character:'learning'});

 function recommend(track,profile){
  const vector=profile?.vector;
  const frames=Number(profile?.frames),seconds=Number(profile?.seconds);
  if(!Array.isArray(vector)||vector.length!==6||!vector.every(value=>Number.isFinite(value)&&value>=0&&value<=1)||!Number.isFinite(frames)||frames<4||!Number.isFinite(seconds)||seconds<2)return flat();
  let [,bass,mid,high,centroid,flatness]=vector;
  const spectral=bass+mid+high;
  if(!(spectral>.0001))return flat();
  bass/=spectral;mid/=spectral;high/=spectral;

  let bands,character;
  if(bass>.46){
   bands=[.5,.5,-.5,-.5,0,.5,1,.5];character='deep';
  }else if(mid>.58){
   bands=[-.5,0,.5,1.5,1,.5,-.5,-.5];character='vocal';
  }else if(high>.28||centroid>.28){
   bands=[1,.5,0,0,.5,.5,-.5,-1];character='bright';
  }else{
   bands=[.5,.5,0,0,.5,.5,.5,0];character='balanced';
  }

  // Small corrections preserve the track's character while restoring missing weight or clarity.
  const low=clamp((.32-bass)*5,-1.25,1.25);
  const body=clamp((.49-mid)*3,-1,1);
  const air=clamp((.19-high)*5,-1.25,1.25)-clamp((flatness-.62)*1.5,0,.75);
  bands[0]+=low;bands[1]+=low*.7;bands[2]+=body*.45;bands[3]+=body;
  bands[4]+=body*.35;bands[5]+=air*.35;bands[6]+=air*.75;bands[7]+=air;

  // Dense masters get gentler changes; every result stays deliberately subtle.
  const strength=vector[0]>.62?.7:1;
  bands=bands.map(value=>half(clamp(value*strength,-3,3)));
  const largestBoost=Math.max(0,...bands);
  return {ready:true,bands,preamp:half(-Math.max(0,largestBoost-.5)),character};
 }

 return {recommend};
});

// Native audio-thread compression: no polling, microphone or system audio capture.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SmartVolume=factory();})(globalThis,()=>{
 function create(context){
  const compressor=context.createDynamicsCompressor(),output=context.createGain();
  compressor.threshold.value=0;compressor.knee.value=0;compressor.ratio.value=1;
  compressor.attack.value=.005;compressor.release.value=.45;
  compressor.connect(output);
  const set=(param,value,time)=>{
   const now=context.currentTime;
   if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
   else {const held=param.value;param.cancelScheduledValues(now);param.setValueAtTime(held,now);}
   param.setTargetAtTime(value,now,time);
  };
  let previousEnabled=null,previousDuck=null;
  return {input:compressor,output,update(enabled,duckInBackground,background){
   enabled=!!enabled;
   if(enabled!==previousEnabled){
    set(compressor.threshold,enabled?-24:0,.08);
    set(compressor.knee,enabled?18:0,.08);
    set(compressor.ratio,enabled?4:1,.08);
    previousEnabled=enabled;
   }
   const duck=enabled&&duckInBackground&&background;
   if(duck!==previousDuck){set(output.gain,duck?.3:1,duck?.25:.5);previousDuck=duck;}
  }};
 }
 return {create};
});

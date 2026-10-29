// Slow level matching after EQ; native compression catches fast peaks.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SmartVolume=factory();})(globalThis,()=>{
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function createLeveler(){
  let power=null,peakHold=0,age=0,gainDb=0;
  return {
   reset(keepGain=false){power=null;peakHold=0;age=0;if(!keepGain)gainDb=0;return gainDb;},
   sample(rms,peak,seconds){
    if(!Number.isFinite(rms)||!Number.isFinite(peak)||!Number.isFinite(seconds)||rms<=0||peak<rms||seconds<=0||seconds>1.5)return null;
    // Silence, fades and quiet breaks must never wind up the gain.
    if(rms<.003||power!==null&&rms<Math.sqrt(power)*.2)return null;
    age+=seconds;
    power=power===null?rms*rms:power+(rms*rms-power)*(1-Math.exp(-seconds/6));
    peakHold=Math.max(peak,peakHold*Math.exp(-seconds/20));
    let target=clamp(-18-10*Math.log10(power),-18,3);
    target=Math.min(target,20*Math.log10(.85/peakHold));
    if(age<3)target=Math.min(0,target);
    // Attenuate promptly, recover slowly, and ignore tiny level fluctuations.
    if(Math.abs(target-gainDb)>.35)gainDb+=clamp(target-gainDb,-6*seconds,.35*seconds);
    return gainDb;
   }
  };
 }
 function create(context,audio=null){
  const input=context.createGain(),normalizer=context.createGain();
  // Match the stereo compressor path, including the normal upmix of mono files.
  input.channelCount=2;input.channelCountMode='explicit';
  const compressor=context.createDynamicsCompressor(),output=context.createGain();
  compressor.threshold.value=0;compressor.knee.value=0;compressor.ratio.value=1;
  compressor.attack.value=.003;compressor.release.value=.45;
  input.connect(normalizer);normalizer.connect(compressor);compressor.connect(output);
  const set=(param,value,time)=>{
   const now=context.currentTime;
   if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
   else {const held=param.value;param.cancelScheduledValues(now);param.setValueAtTime(held,now);}
   param.setTargetAtTime(value,now,time);
  };
  const leveler=createLeveler(),listeners=[];
  let previousProtection=null,previousEnabled=null,previousOutput=null,meter=null,splitter=null,buffers=[],timer=null,lastTime=null,lastGain=0,disposed=false;
  const stop=()=>{if(timer!==null)clearInterval(timer);timer=null;lastTime=null;};
  const reset=(keepGain=false)=>{
   lastTime=null;lastGain=leveler.reset(keepGain);
   if(!keepGain)set(normalizer.gain,1,.03);
  };
  function sample(){
   if(disposed||!previousEnabled||!audio||audio.paused||audio.seeking||audio.readyState<3||audio.muted||audio.volume<.01||context.state!=='running'){lastTime=null;return;}
   const now=context.currentTime,elapsed=lastTime===null?0:now-lastTime;lastTime=now;
   if(!elapsed)return;
   let energy=0,peak=0;
   for(let channel=0;channel<meter.length;channel++){
    const wave=buffers[channel];meter[channel].getFloatTimeDomainData(wave);
    let mean=0;for(const value of wave)mean+=value;mean/=wave.length;
    for(const value of wave){const x=(value-mean)/audio.volume;energy+=x*x;peak=Math.max(peak,Math.abs(x));}
   }
   // Divide out the user's fader. The detector is before our gain and ducking,
   // so neither lowering volume nor switching windows can provoke a boost.
   const gain=leveler.sample(Math.sqrt(energy/(buffers.length*buffers[0].length)),peak,elapsed);
   if(gain!==null&&Math.abs(gain-lastGain)>.01){set(normalizer.gain,Math.pow(10,gain/20),gain<lastGain?.12:1);lastGain=gain;}
  }
  function start(){
   if(disposed||!previousEnabled||!audio||audio.paused||context.state!=='running'||timer!==null)return;
   try{
    if(!meter){
     // Separate channels preserve level for wide/antiphase stereo recordings.
     splitter=context.createChannelSplitter(2);input.connect(splitter);meter=[];
     for(let i=0;i<2;i++){
      const node=context.createAnalyser();node.fftSize=2048;node.smoothingTimeConstant=0;
      splitter.connect(node,i);meter.push(node);buffers.push(new Float32Array(node.fftSize));
     }
    }
    timer=setInterval(()=>{try{sample();}catch(_){stop();}},250);
   }catch(_){
    stop();try{if(splitter)input.disconnect(splitter);splitter?.disconnect();for(const node of meter||[])node.disconnect();}catch(_){}
    meter=null;splitter=null;buffers=[];
   } // Unsupported measurement still leaves native peak control.
  }
  const listen=(target,event,fn)=>{if(target?.addEventListener){target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));}};
  listen(audio,'playing',start);
  for(const event of ['pause','ended','waiting','stalled'])listen(audio,event,stop);
  for(const event of ['loadstart','emptied','error','abort'])listen(audio,event,()=>{stop();reset();});
  listen(audio,'seeking',()=>{stop();reset(true);});listen(audio,'seeked',start);
  listen(context,'statechange',()=>context.state==='running'?start():stop());
  return {input,output,update(enabled,duckInBackground,background,protectPeaks=false){
   if(disposed)return;
   enabled=!!enabled;
   // Smart EQ can protect crossfade/transient peaks without enabling loudness
   // normalization. Processing stays inside the native audio engine.
   const protection=enabled?'level':protectPeaks?'peaks':'off';
   const protectionChanged=protection!==previousProtection;
   if(protectionChanged){
    set(compressor.threshold,enabled?-18:protectPeaks?-1:0,.08);
    set(compressor.knee,enabled?12:0,.08);
    set(compressor.ratio,enabled?3:protectPeaks?20:1,.08);
    previousProtection=protection;
   }
   if(enabled!==previousEnabled){
    previousEnabled=enabled;
    if(enabled)start();else {stop();reset();}
   }
   const duck=!!(duckInBackground&&background);
   // Web Audio adds makeup gain even below the compression threshold. Cancel
   // it in peak-only mode: makeup = (1 / fullRangeGain) ** 0.6 (W3C formula).
   // https://www.w3.org/TR/webaudio-1.0/#computing-the-makeup-gain
   const compensate=protection==='peaks'?Math.pow(10,.6*(-1)*(1-1/20)/20):1;
   const outputGain=(duck?.3:1)*compensate;
   if(outputGain!==previousOutput){set(output.gain,outputGain,protectionChanged?.08:duck?.25:.5);previousOutput=outputGain;}
  },destroy(){disposed=true;stop();for(const remove of listeners)remove();splitter?.disconnect();for(const node of meter||[])node.disconnect();input.disconnect();normalizer.disconnect();compressor.disconnect();output.disconnect();}};
 }
 return {create,createLeveler};
});

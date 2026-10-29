(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SmartTransition=factory();})(globalThis,()=>{
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function valid(p){return p?.version===1&&Number.isFinite(p.duration)&&p.duration>0&&
  [p.leading,p.trailing].every(n=>Number.isFinite(n)&&n>=0&&n<=8)&&['intro','outro'].every(k=>{
   const e=p[k];return e&&Number.isFinite(e.start)&&e.start>=0&&e.step===.02&&Array.isArray(e.rms)&&e.rms.length>0&&e.rms.length<=401&&Array.isArray(e.peak)&&e.peak.length===e.rms.length&&e.rms.every(n=>Number.isFinite(n)&&n>=0&&n<=64)&&e.peak.every(n=>Number.isFinite(n)&&n>=0&&n<=64);
  });}
 function albumSequence(a,b){
  const norm=v=>String(v||'').trim().toLowerCase(),album=norm(a?.album),n=Number(a?.number),m=Number(b?.number);
  return !!album&&!['download','downloads','unknown','неизвестный альбом'].includes(album)&&album===norm(b?.album)&&norm(a?.artist)===norm(b?.artist)&&n>0&&m===n+1;
 }
 function plan(a,b,outgoing,incoming,limit,{automatic=true,position=0,rate=1,duration}={}){
  limit=clamp(Number(limit)||0,0,4);rate=Number.isFinite(rate)&&rate>0?rate:1;
  const out=valid(outgoing)?outgoing:null,into=valid(incoming)?incoming:null;
  const length=Number(duration)||out?.duration||Number(a?.duration)/1000||0;
  const continuous=automatic&&albumSequence(a,b);
  const end=Math.max(0,length-(automatic&&!continuous?out?.trailing||0:0));
  const start=automatic&&!continuous?into?.leading||0:0;
  const available=Math.max(0,(end-position)/rate),incomingLength=Math.max(0,(into?.duration||Number(b?.duration)/1000||Infinity)-start)/rate;
  return {duration:continuous?0:Math.min(limit,available,incomingLength),end,start,rate,continuous,measured:!!(out&&into)};
 }
 function power(profile,which,position){
  if(!profile)return null;const e=profile[which],at=Math.floor((position-e.start)/e.step);
  if(at<0||at>=e.rms.length)return null;return e.rms[at]**2;
 }
 function curves({duration=1,outgoing=null,incoming=null,outPosition=0,inPosition=0,outRate=1,inRate=1,outGain=1,inGain=0,points=128}={}){
  outgoing=valid(outgoing)?outgoing:null;incoming=valid(incoming)?incoming:null;
  points=clamp(Math.round(points)||128,2,512);
  const fadeOut=new Float32Array(points),fadeIn=new Float32Array(points);
  const begin=power(outgoing,'outro',outPosition),end=power(incoming,'intro',inPosition+duration*inRate);
  for(let i=0;i<points;i++){
   const x=i/(points-1),angle=x*Math.PI/2;
   // Canonical quarter-sine equal-power crossfade (also FFmpeg's qsin).
   let a=Math.cos(angle)*clamp(outGain,0,1),b=Math.sqrt((Math.cos(angle)*clamp(inGain,0,1))**2+Math.sin(angle)**2);
   const pa=power(outgoing,'outro',outPosition+x*duration*outRate),pb=power(incoming,'intro',inPosition+x*duration*inRate);
   // Compare the measured mix power to a smooth interpolation of its endpoints.
   // Only attenuate an excessive overlap; never amplify a quiet intro or tail.
   if(begin!==null&&end!==null&&pa!==null&&pb!==null){
    const expected=(1-x)*(begin*outGain*outGain)+x*end,mixed=pa*a*a+pb*b*b;
    if(mixed>0&&expected>0){const gain=Math.min(1,Math.sqrt(expected/mixed));a*=gain;b*=gain;}
   }
   fadeOut[i]=a;fadeIn[i]=b;
  }
  fadeOut[0]=outGain;fadeIn[0]=inGain;fadeOut[points-1]=0;fadeIn[points-1]=1;
  return {fadeOut,fadeIn};
 }
 return {valid,plan,curves,albumSequence};
});

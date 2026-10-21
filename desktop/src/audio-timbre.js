/* Gain-independent MFCC-style timbre from the existing playback spectrum.
 * Log mel energies + orthonormal DCT-II, excluding energy coefficient C0.
 * Reference: https://librosa.org/doc/main/api/generated/librosa.feature.mfcc.html
 * HTK mel spacing, 26 area-normalized bands, 12 bounded coefficients.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AudioTimbre=factory();})(globalThis,()=>{
 const BANDS=26,COUNT=12,cache=new Map();
 const cosines=Array.from({length:COUNT},(_,k)=>Array.from({length:BANDS},(_,j)=>Math.sqrt(2/BANDS)*Math.cos(Math.PI*(k+1)*(j+.5)/BANDS)));
 function filters(size,rate){
  const key=size+':'+rate;if(cache.has(key))return cache.get(key);
  const mel=f=>2595*Math.log10(1+f/700),hz=m=>700*(10**(m/2595)-1);
  const min=mel(40),max=mel(10000),edges=Array.from({length:BANDS+2},(_,i)=>hz(min+(max-min)*i/(BANDS+1)));
  const bank=Array.from({length:BANDS},(_,b)=>{
   const weights=[];let sum=0;
   for(let i=Math.max(1,Math.ceil(edges[b]*2*size/rate));i<Math.min(size,Math.ceil(edges[b+2]*2*size/rate));i++){
    const f=i*rate/(2*size),w=Math.max(0,Math.min((f-edges[b])/(edges[b+1]-edges[b]),(edges[b+2]-f)/(edges[b+2]-edges[b+1])));
    if(w>0){weights.push([i,w]);sum+=w;}
   }
   return {weights,sum};
  });
  if(cache.size>=4)cache.delete(cache.keys().next().value);
  cache.set(key,bank);return bank;
 }
 function frame(db,rate){
  if(!db?.length||db.length>16384||!Number.isFinite(rate)||rate<8000||rate>384000)return null;
  const bank=filters(db.length,rate);
  // A spectrum too coarse or narrow for the filter bank cannot supply comparable timbre.
  if(bank.some(b=>b.weights.length<2))return null;
  let peak=-Infinity;
  for(const band of bank)for(const [i] of band.weights){
   const v=db[i];if(typeof v!=='number'||Number.isNaN(v)||v===Infinity)return null;
   peak=Math.max(peak,v);
  }
  if(peak===-Infinity)return null;
  const powers=new Float64Array(db.length);
  for(let i=0;i<db.length;i++)powers[i]=Number.isFinite(db[i])?10**(Math.max(-80,db[i]-peak)/10):0;
  const energies=bank.map(({weights,sum})=>Math.log10(Math.max(1e-8,weights.reduce((s,[i,w])=>s+powers[i]*w,0)/sum)));
  return cosines.map(row=>.5+.5*Math.tanh(row.reduce((s,c,j)=>s+c*energies[j],0)/4));
 }
 // Octave-band peak/valley contrast preserves harmonic texture lost in mel means.
 // https://librosa.org/doc/main/api/generated/librosa.feature.spectral_contrast.html
 function detail(wave,db,rate){
  // Every octave must cover the same frequencies; a truncated top band cannot
  // be compared with a full-band recording at another sample rate.
  if(!wave?.length||wave.length<8||wave.length>32768||!db?.length||db.length>16384||!Number.isFinite(rate)||rate<16000||rate>192000)return null;
  const edges=[60,200,400,800,1600,3200,8000],result=[];
  for(let band=0;band<6;band++){
   const values=[];
   for(let i=Math.ceil(edges[band]*2*db.length/rate);i<Math.min(db.length,Math.ceil(edges[band+1]*2*db.length/rate));i++){
    if(typeof db[i]!=='number'||Number.isNaN(db[i])||db[i]===Infinity)return null;
    values.push(db[i]);
   }
   if(values.length<2)return null;
   values.sort((a,b)=>a-b);const peak=values.at(-1);
   if(peak===-Infinity){result.push(0);continue;}
   const n=Math.max(1,Math.ceil(values.length*.2));let high=0,low=0;
   for(let i=0;i<n;i++){low+=10**(Math.max(-80,values[i]-peak)/10);high+=10**(Math.max(-80,values[values.length-1-i]-peak)/10);}
   result.push(Math.min(1,10*Math.log10(high/low)/60));
  }
  let mean=0;for(const x of wave){if(!Number.isFinite(x))return null;mean+=x;}mean/=wave.length;
  const chunks=Array(8).fill(0),counts=Array(8).fill(0);
  for(let i=0;i<wave.length;i++){const b=Math.min(7,Math.floor(i*8/wave.length));chunks[b]+=(wave[i]-mean)**2;counts[b]++;}
  const power=chunks.map((n,i)=>n/Math.max(1,counts[i])),peak=Math.max(...power);
  if(peak<1e-8)return null;
  result.push(Math.max(0,1-power.reduce((a,b)=>a+b,0)/(8*peak)));
  return result;
 }
 return {frame,detail};
});

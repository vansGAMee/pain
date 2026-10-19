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
 return {frame};
});

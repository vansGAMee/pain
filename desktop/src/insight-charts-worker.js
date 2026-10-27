importScripts('listening-insights.js','insight-charts-model.js');
let cached,at=0,controller;
self.onmessage=async({data})=>{
 const {id,range,force}=data;controller?.abort();controller=new AbortController();const signal=controller.signal;
 try{
  if(!cached||force||Date.now()-at>60000){
   const results=await Promise.all(['/api/saved-library','/api/saved-stats'].map(async url=>{const r=await fetch(url,{signal});if(!r.ok)throw Error('History unavailable');return r.json();}));
   signal.throwIfAborted();cached={tracks:results[0].tracks||[],stats:results[1]||{}};at=Date.now();
  }
  const result=InsightChartStats.build(cached.tracks,cached.stats,range);signal.throwIfAborted();self.postMessage({id,result});
 }catch(e){if(e.name!=='AbortError')self.postMessage({id,error:e.message});}
};

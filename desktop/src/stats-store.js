// A phone snapshot must not erase PC listening recorded while the phone was offline.
module.exports=function mergeStats(local,incoming){
  function merge(a,b,key){const map=new Map();for(const item of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])])if(item&&typeof item==='object')map.set(key(item),item);return [...map.values()];}
  return {...local,...incoming,
    plays:merge(local.plays,incoming.plays,p=>p.track&&p.started?`${p.track}\0${p.started}`:p.id),
    slices:merge(local.slices,incoming.slices,p=>p.id||JSON.stringify(p))};
};

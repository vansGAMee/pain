(function(root){
  'use strict';
  let worker,tracksRef,revision=0,sequence=0,failed=false;const pending=new Map();
  const changed=()=>root.dispatchEvent(new Event('pain:search-index'));
  function stop(){failed=true;worker?.terminate();worker=null;for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Search worker unavailable'));}pending.clear();}
  function ensure(tracks){
    if(failed||typeof Worker==='undefined')return false;
    if(!worker){
      try{
        worker=new Worker('/music-search-worker.js');
        worker.onmessage=({data})=>{
          if(data.event==='updated'){changed();return;}
          const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);
          if(data.error||data.superseded)job.reject(Error(data.superseded?'Search superseded':'Search failed'));else job.resolve(data);
        };
        worker.onerror=worker.onmessageerror=stop;
      }catch(_){stop();return false;}
    }
    if(tracks!==tracksRef){
      tracksRef=tracks;revision++;
      worker.postMessage({type:'tracks',revision,tracks:tracks.map(({id,title,artist,album,genre,filename,duration})=>({id,title,artist,album,genre,filename,duration}))});
    }
    return true;
  }
  async function search(tracks,query,channel='library'){
    if(!String(query||'').trim())return {hits:tracks.map(t=>({id:String(t.id),reason:'metadata'})),lyrics:0};
    if(ensure(tracks))try{return await new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);stop();reject(Error('Search timed out'));},15000);
      pending.set(id,{resolve,reject,timer});worker.postMessage({type:'query',id,revision,query,channel});
    });}catch(error){if(!failed)throw error;}
    // Older embedded browsers keep functional metadata search. Yield between
    // batches rather than blocking audio controls for a large library.
    const hits=[];for(let i=0;i<tracks.length;i+=64){
      const index=new MusicSearchIndex.Index(tracks.slice(i,i+64));
      for(const h of index.search(query,{lyrics:false})){h.rank[h.rank.length-1]+=i;hits.push(h);}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    hits.sort((a,b)=>{for(let i=0;i<a.rank.length;i++)if(a.rank[i]!==b.rank[i])return a.rank[i]-b.rank[i];return 0;});return {hits,lyrics:0};
  }
  root.MusicSearchClient={search};
  root.addEventListener('pain:lyrics',event=>{
    if(!worker)return;const {id,lines}=event.detail||{};
    if(id!==undefined&&Array.isArray(lines))worker.postMessage({type:'extras',rows:[{id:String(id),lyrics:lines.map(l=>l.text||'').join('\n').slice(0,200000)}]});
  });
  root.addEventListener('pain:genres',event=>{if(worker&&event.detail?.id!==undefined&&Array.isArray(event.detail.names))worker.postMessage({type:'extras',rows:[{id:String(event.detail.id),genres:event.detail.names}]});});
  root.addEventListener('focus',()=>worker?.postMessage({type:'refresh-genres'}));
  root.addEventListener('pagehide',()=>{worker?.terminate();worker=null;});
})(globalThis);

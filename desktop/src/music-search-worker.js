/* Metadata and saved lyrics are indexed away from playback/UI work. */
importScripts('/vendor/minisearch/index.js','/vendor/double-metaphone/index.js','/music-search.js','/music-search-index.js');
const index=new MusicSearchIndex.Index(),loaded=new Map();
let tracks=[],revision=0,loading=false,genresLoaded=false,closed=false;
const signatures=new Map(),jobs=new Map();let jobTimer;
const notify=()=>postMessage({event:'updated',revision,lyrics:[...index.extra.values()].filter(e=>e.lyrics?.trim()).length});
async function json(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Search cache unavailable');return response.json();
}
async function loadExtras(){
  if(loading||closed)return;loading=true;let changed=false;
  try{
    if(!genresLoaded)try{
      const result=await json('/api/genres/snapshot');
      if(result.entries&&typeof result.entries==='object'){
        index.updateExtras(Object.entries(result.entries).filter(([,genres])=>Array.isArray(genres)).map(([id,genres])=>({id,genres})));genresLoaded=true;changed=true;
      }
    }catch(_){}
    while(!closed){
      const batch=tracks.filter(t=>loaded.get(String(t.id))!==signatures.get(String(t.id))).slice(0,32);
      if(!batch.length)break;
      const wanted=new Map(batch.map(t=>[String(t.id),signatures.get(String(t.id))]));
      try{
        const result=await json('/api/lyrics/search-index',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...wanted.keys()]})});
        if(!Array.isArray(result.rows))break;
        const rows=result.rows.filter(row=>wanted.has(String(row.id))&&wanted.get(String(row.id))===signatures.get(String(row.id))&&typeof row.lyrics==='string');
        index.updateExtras(rows);for(const row of rows)loaded.set(String(row.id),wanted.get(String(row.id)));
        // An incomplete endpoint response must not spin indefinitely.
        if(rows.length!==wanted.size)break;
        changed=true;
      }catch(_){break;}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }finally{loading=false;if(changed)notify();}
}
onmessage=({data})=>{
  if(data.type==='tracks'){
    tracks=data.tracks;revision=data.revision;index.setTracks(tracks);genresLoaded=false;
    const keep=new Set();for(const track of tracks){const id=String(track.id);keep.add(id);signatures.set(id,JSON.stringify([track.title,track.artist,track.album,track.duration]));}
    for(const id of signatures.keys())if(!keep.has(id)){signatures.delete(id);loaded.delete(id);}
  }else if(data.type==='extras'){
    index.updateExtras(data.rows);for(const row of data.rows)if('lyrics'in row)loaded.set(String(row.id),signatures.get(String(row.id)));notify();
  }else if(data.type==='refresh-genres'){genresLoaded=false;loadExtras();
  }else if(data.type==='query'){
    const previous=jobs.get(data.channel);if(previous)postMessage({id:previous.id,superseded:true});
    jobs.set(data.channel,data);clearTimeout(jobTimer);
    jobTimer=setTimeout(()=>{
      for(const job of jobs.values()){
        try{postMessage({id:job.id,revision,hits:index.search(job.query),lyrics:[...index.extra.values()].filter(e=>e.lyrics?.trim()).length});}
        catch(_){postMessage({id:job.id,error:true});}
      }
      jobs.clear();loadExtras();
    },0);
  }
};

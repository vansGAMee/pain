/* Real Python bridge, real saved library; no writes to library/history. */
const fs=require('node:fs'),path=require('node:path');
const assert=require('node:assert/strict');
const Queue=require('../src/queue-engine'),Player=require('../src/pulseflow-player');
const data=path.resolve(__dirname,'../data');
const tracks=JSON.parse(fs.readFileSync(path.join(data,'library.json'))).tracks;
const stats=JSON.parse(fs.readFileSync(path.join(data,'stats.json')));
const excluded=JSON.parse(fs.readFileSync(path.join(data,'excluded-tracks.json')));
const service=require('../src/pulseflow-service')({dataDir:data,getTracks:()=>tracks,resolveAudio:()=>null});
(async()=>{
 const results={};
 for(const policy of ['personal','smooth','contrast','frequency']){
  const runs=[],unique=new Set(),artists=new Set();let adjacentArtistRepeats=0;
  for(let start=0;start<8;start++){
   const q=new Queue({shuffleMode:'smart',loopMode:'off',stats,excludedTracks:excluded,pulseflowPolicy:policy});
   const pool=tracks.filter(t=>!q.isExcluded(t.id));q.setContext('library',pool,Math.floor(start*pool.length/8));
   const seen=new Set([String(q.getCurrentTrack().id)]),run=[String(q.getCurrentTrack().id)];let previous=q.getCurrentTrack();
   for(let i=0;i<30;i++){
    const next=policy==='frequency'?q.next({fallback:true}):(await Player.next(q,payload=>service.recommend(payload)),q.getCurrentTrack());
    assert.ok(next);assert.ok(!seen.has(String(next.id)));assert.ok(!q.isExcluded(next.id));
    seen.add(String(next.id));unique.add(String(next.id));artists.add(next.artist);run.push(String(next.id));
    if(next.artist===previous.artist)adjacentArtistRepeats++;previous=next;
   }
   runs.push(run);
  }
  results[policy]={transitions:240,uniqueTracks:unique.size,uniqueArtists:artists.size,adjacentArtistRepeats,runs};
 }
 fs.writeFileSync(path.join(data,'pulseflow/queue-validation.json'),JSON.stringify(results));
 console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,{runs,...v}])=>[k,v]))));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>service.close());

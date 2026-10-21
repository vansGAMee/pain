const test=require('node:test'),assert=require('node:assert/strict');
const Taste=require('../src/taste-model'),Audio=require('../src/audio-profile'),Timbre=require('../src/audio-timbre'),Queue=require('../src/queue-engine');
const NOW=Date.UTC(2026,9,21,12);
function fixture(){
 const song=id=>({id,artist:'Artist '+id,duration:180000,bpm:120});
 const recent=['current','previous1','previous2'].map(song),copies=Array.from({length:8},(_,i)=>song('copy'+i));
 const varied=song('varied'),far=song('far'),unknown=song('unknown'),tracks=[...recent,...copies,varied,far,unknown];
 const profiles=Object.fromEntries(tracks.filter(t=>t!==unknown).map(t=>{
  const peak=t===varied?745:t===far?1500:700;
  const timbre=Timbre.frame(Float32Array.from({length:1024},(_,i)=>-80+55*Math.exp(-(((i*48000/2048-peak)/350)**2))+12*Math.exp(-(((i*48000/2048-5000)/900)**2))),48000);
  return [t.id,{version:4,signature:Audio.signature(t),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),
   vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbre,timbreVariance:Array(12).fill(.001)}];
 }));
 const plays=recent.map((t,i)=>({track:t.id,started:NOW-(i+1)*240000,heard:180000,finished:1,duration:180000}));
 return {tracks,recent,copies,varied,far,unknown,profiles,plays,current:recent[0],candidates:[...copies,varied,far,unknown],context:{recentTrackIds:recent.map(t=>t.id),step:0}};
}
module.exports={fixture};

test('repeated accepted texture makes room for a close variation, never a distant or unmeasured song',()=>{
 const f=fixture(),m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 let varied=0;const seen=new Set();
 for(let seed=1;seed<=200;seed++){
  const context={...f.context,seed},pick=m.choose(f.current,f.candidates,{},context);
  assert.ok(pick.track!==f.far&&pick.track!==f.unknown);seen.add(pick.track.id);
  if(pick.track===f.varied)varied++;
  assert.equal(m.choose(f.current,f.candidates,{},context).track.id,pick.track.id);
 }
 assert.ok(varied>=25&&varied<150,`${varied}/200 close variations: neither a copy loop nor forced novelty`);
 assert.ok(seen.size>3);assert.ok(m.score(f.current,f.varied).soundSimilarity>.85);
});

test('missing data, old sessions and skipped previews cannot trigger texture fatigue',()=>{
 const f=fixture();
 for(const plays of [[],f.plays.map(p=>({...p,started:p.started-3600000})),f.plays.map(p=>({...p,heard:5000,finished:0,skipped:1}))]){
  const m=new Taste(f.tracks,plays,NOW,f.profiles);
  for(let seed=1;seed<=12;seed++){
   const a=m.choose(f.current,f.candidates,{}, {...f.context,seed});
   assert.equal(a.rank,a.score,'insufficient accepted recent evidence leaves ranking untouched');
   // Keep other context features identical; changing a duplicate recent ID must not create evidence.
   const b=m.choose(f.current,f.candidates,{}, {...f.context,recentTrackIds:[...f.context.recentTrackIds,...f.context.recentTrackIds],seed});
   assert.equal(a.track.id,b.track.id);
  }
 }
 const m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 const sample=m.choose(f.current,f.candidates,{}, {...f.context,recentTrackIds:['current','current'],seed:4});
 assert.equal(sample.rank,sample.score,'one sound repeated in context is still one observation');
});

test('no suitable variation leaves the existing ranking untouched, including exclusions and rejections',()=>{
 const f=fixture();
 for(const [candidates,options] of [[f.copies.concat(f.far,f.unknown),{}],[f.candidates,{excludedTracks:['varied']}]] ){
  const m=new Taste(f.tracks,f.plays,NOW,f.profiles,options);
  for(let seed=1;seed<=12;seed++){
   const chosen=m.choose(f.current,candidates,{}, {...f.context,seed});
   assert.ok(chosen.track.id.startsWith('copy'));assert.equal(chosen.rank,chosen.score);
  }
 }
 const rejected={track:'varied',started:NOW-20000,heard:5000,duration:180000,skipped:1};
 const m=new Taste(f.tracks,[...f.plays,rejected],NOW,f.profiles);
 const pick=m.choose(f.current,f.candidates,{}, {...f.context,seed:4});
 assert.equal(pick.rank,pick.score,'a recently rejected variation cannot make good songs less desirable');
});

test('saved vibes, discovery cadence and peek/next remain stable',()=>{
 const f=fixture(),m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 for(let seed=1;seed<=20;seed++){
  const frozen=m.choose(f.current,f.candidates,{}, {...f.context,seed,vibeProfile:f.profiles.current});
  assert.ok(frozen.soundSimilarity>.85);assert.notEqual(frozen.track,f.far);
  const discover=m.choose(f.current,f.candidates,{}, {...f.context,seed,step:7});
  assert.equal(discover.track,f.unknown,'existing bounded discovery is unchanged');
 }
 const q=new Queue({shuffleMode:'smart',loopMode:'off',now:()=>NOW,audioProfiles:f.profiles,stats:{plays:f.plays}});
 q.setContext('library',f.tracks);q.smartSeed=42;const seen=new Set([q.getCurrentTrack().id]);
 for(let i=1;i<f.tracks.length;i++){const preview=q.peekNext(),next=q.next();assert.equal(preview.id,next.id);assert.ok(!seen.has(next.id));seen.add(next.id);}
 assert.equal(q.next(),null);
});

test('saved vibes keep good measured fits on discovery turns without blocking an unmeasured-only queue',()=>{
 const f=fixture(),m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 for(const step of [7,15,23])for(let seed=1;seed<=12;seed++){
  const context={...f.context,step,seed,vibeProfile:f.profiles.current};
  const chosen=m.choose(f.current,f.candidates,{},context);
  assert.ok(chosen.soundSimilarity>.85,'discovery should keep the saved sound when good measured choices exist');
  assert.equal(m.choose(f.current,[f.unknown],{},context).track,f.unknown,'a restricted queue must still play');
  assert.equal(m.choose(f.current,f.candidates,{}, {...context,vibeProfile:null}).track,f.unknown,'ordinary discovery is unchanged');
 }
});

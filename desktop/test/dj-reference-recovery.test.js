const test=require('node:test'),assert=require('node:assert/strict');
const Taste=require('../src/taste-model'),Audio=require('../src/audio-profile'),Queue=require('../src/queue-engine'),Home=require('../src/home-model');
const NOW=Date.UTC(2026,9,24,12),DAY=86400000;
const song=id=>({id,title:id,artist:id,duration:180000,bpm:120});
const profile=(t,v=.2)=>({version:4,signature:Audio.signature(t),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),
 vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbre:Array(12).fill(v),timbreVariance:Array(12).fill(.001)});
const skip=(t,age=5000)=>({track:t.id,started:NOW-age,heard:5000,duration:t.duration,skipped:1});
const done=(t,age=DAY)=>({...skip(t,age),finished:1,heard:t.duration,skipped:0});
function fixture(){
 const tracks=['current','near','far','unknown'].map(song);
 return {tracks,profiles:Object.fromEntries(tracks.slice(0,3).map((t,i)=>[t.id,profile(t,i===2?.9:.2)]))};
}
test('historical skips do not erase the sound and tempo of a newly selected song',()=>{
 const {tracks:[current,near,far,unknown],profiles}=fixture();
 for(const heard of [5000,80000,130000]){
  const model=new Taste([current,near,far,unknown],[{...skip(current,DAY),heard}],NOW,profiles);
  const match=model.score(current,near);
  assert.equal(match.soundSimilarity,1);assert.equal(match.dist,0);assert.equal(match.explanation.referenceTitle,current.title);
  for(let seed=1;seed<=40;seed++)assert.equal(model.choose(current,[near,far],{},{seed}).track.id,near.id);
 }
});
test('fresh rejection still pivots; selecting the same song again establishes a new visit',()=>{
 const {tracks:[current,near,far],profiles}=fixture(),tracks=[current,near,far];
 const model=new Taste(tracks,[done(far,300000),skip(current)],NOW,profiles);
 assert.equal(model.score(current,near).explanation.referenceTitle,far.title);
 assert.ok(model.score(current,near).soundSimilarity<.1);
 const resumed=model.score(current,near,{}, {currentStartedAt:NOW-1000});
 assert.equal(resumed.soundSimilarity,1);assert.equal(resumed.explanation.referenceTitle,current.title);
 const longPause=new Taste(tracks,[skip(current,2*3600000)],NOW,profiles);
 assert.equal(longPause.score(current,near,{}, {currentStartedAt:NOW-2*3600000}).soundSimilarity,null,
  'a skip in this visit stays a rejection even if playback was paused for hours');
 for(const started of [NaN,Infinity,0])assert.equal(model.score(current,near,{}, {currentStartedAt:started}).explanation.referenceTitle,far.title);
});
test('recency and artist spacing retain their strength with measured audio',()=>{
 const {tracks:[current,near,far],profiles}=fixture();
 const model=new Taste([current,near,far],[done(near,60000)],NOW,profiles);
 const withRecent=model.score(current,near).score;
 // Compare the same fitted model so learned taste does not mask spacing.
 const evidence=model.evidence.get(near.id);model.evidence.delete(near.id);
 assert.ok(model.score(current,near).score-withRecent>11.9);
 model.evidence.set(near.id,evidence);
 assert.ok(Math.abs(model.score(current,near).score-model.score({...current,artist:near.artist},near).score-9)<1e-9);
});
test('browsing can discover measured good fits without forcing an unknown or distant track',()=>{
 const {tracks:[current,near,far,unknown],profiles}=fixture();
 const a=song('previewA'),b=song('previewB'),tracks=[current,near,far,unknown,a,b];
 const plays=[done(current,300000),skip(a,20000),skip(b,10000)],model=new Taste(tracks,plays,NOW,profiles);
 assert.equal(model.searching,true);
 for(let seed=1;seed<=60;seed++){
  const pick=model.choose(b,[near,far,unknown],{},{step:7,seed});
  assert.equal(pick.track.id,near.id);assert.ok(pick.reasons.includes('Открываем новое'));
 }
 const noNeighbour=model.choose(b,[far,unknown],{},{step:7,seed:1});
 assert.ok(!noNeighbour.reasons.includes('Открываем новое'),'weak matches do not earn guided discovery');
 const excluded=new Taste(tracks,plays,NOW,profiles,{excludedTracks:[near.id]});
 assert.notEqual(excluded.choose(b,[near,far,unknown],{},{step:7}).track.id,near.id);
});
test('queue and Home carry the live visit, preserve exclusions and keep peek equal to next',()=>{
 const {tracks,profiles}=fixture();
 const q=new Queue({shuffleMode:'smart',loopMode:'off',now:()=>NOW,audioProfiles:profiles,stats:{plays:[skip(tracks[0])]}});
 q.setContext('library',tracks);q.smartSeed=11;q.currentStartedAt=NOW-1000;q.excludeTrack('unknown');
 q.setShuffleMode('random');q.setShuffleMode('smart');assert.equal(q.currentStartedAt,NOW-1000);
 const score=q.smartScore(tracks[0],tracks[1],{});assert.equal(score.soundSimilarity,1);
 const snapshot=JSON.stringify(q),mix=Home.mix(tracks,q,1);
 assert.equal(JSON.stringify(q),snapshot);assert.equal(mix[0].decision.explanation.referenceTitle,'current');
 const seen=new Set([tracks[0].id]);
 while(q.peekNext()){
  const peek=q.peekNext(),next=q.next();assert.equal(next.id,peek.id);
  assert.ok(!seen.has(next.id));assert.notEqual(next.id,'unknown');seen.add(next.id);
 }
 assert.equal(seen.size,3);assert.equal(q.next(),null);
});
test('saved vibe, missing audio and excluded references stay honest after old skips',()=>{
 const {tracks:[current,near,far,unknown],profiles}=fixture(),tracks=[current,near,far,unknown];
 const model=new Taste(tracks,[skip(current,DAY)],NOW,profiles);
 assert.equal(model.score(current,far,{}, {vibeProfile:profiles.far}).soundSimilarity,1);
 assert.equal(model.score(current,unknown).soundSimilarity,null);
 assert.equal(model.score(current,{...near,bytes:100}).soundSimilarity,null);
 const blocked=new Taste(tracks,[],NOW,profiles,{excludedTracks:[current.id]});
 assert.equal(blocked.score(current,near,{}, {currentStartedAt:NOW}).soundSimilarity,null);
});

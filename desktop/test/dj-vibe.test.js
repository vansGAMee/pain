const test=require('node:test'),assert=require('node:assert/strict');
const Queue=require('../src/queue-engine'),Audio=require('../src/audio-profile');
const NOW=Date.UTC(2026,9,20),song=id=>({id,title:id,artist:id,duration:180000});
const profile=(track,timbre)=>({version:4,signature:Audio.signature(track),frames:48,seconds:24,
 positions:Array.from({length:48},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
 timbre:Array(12).fill(timbre),timbreVariance:Array(12).fill(.001)});
function fixture(){
 const anchor=song('anchor'),tracks=['current','nearA','nearB','far'].map(song);
 const profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t,t.id.startsWith('near')?.2:.8)]));
 const q=new Queue({shuffleMode:'smart',now:()=>NOW,audioProfiles:profiles});q.setContext('playlist',tracks,0,'Test');q.smartSeed=123;
 return {q,tracks,profiles,anchor:profile(anchor,.2)};
}

test('saved vibe anchors sound without changing queue history; release restores the exact original choice',()=>{
 const {q,tracks,anchor}=fixture(),before=q.peekNext().id,score=q.smartScore(tracks[0],tracks[3],{});
 const history=[...q.playedHistory],unplayed=[...q.unplayedIndices],seed=q.smartSeed,step=q.smartStep;
 assert.equal(before,'far');
 assert.equal(q.setVibeProfile(anchor),true);
 assert.ok(q.peekNext().id.startsWith('near'));
 assert.equal(q.smartScore(tracks[0],tracks[1],{}).reasons[0],'Звучание сохранённого вайба');
 assert.deepEqual(q.playedHistory,history);assert.deepEqual([...q.unplayedIndices],unplayed);
 assert.equal(q.smartSeed,seed);assert.equal(q.smartStep,step);
 q.setVibeProfile(null);
 assert.equal(q.peekNext().id,before);assert.deepEqual(q.smartScore(tracks[0],tracks[3],{}),score);
});

test('vibe is a validated snapshot, including after cache updates or removal of its source track',()=>{
 const {q,tracks,anchor}=fixture();q.setVibeProfile(anchor);const frozen=q.vibeProfile;
 anchor.timbre.fill(.8);q.setAudioProfile(tracks[0].id,profile(tracks[0],.6));
 assert.ok(q.peekNext().id.startsWith('near'));assert.equal(frozen.timbre[0],.2);
 for(const bad of [{}, {...anchor,version:100}, {...anchor,frames:2}, {...anchor,timbre:[NaN]}, {...anchor,positions:[0,0]}]){
  assert.equal(q.setVibeProfile(bad),false);assert.equal(q.vibeProfile,frozen);
 }
 const restored=new Queue({shuffleMode:'smart'});assert.equal(restored.setVibeProfile(JSON.parse(JSON.stringify(frozen))),true);
 assert.equal(restored.next(),null);
});

test('vibe respects exclusions, quick skips, stable previews and a finite queue without early repeats',()=>{
 const {q,tracks,anchor}=fixture();q.setVibeProfile(anchor);q.setLoopMode('off');q.excludeTrack('nearA');
 q.setStats({plays:[{track:'nearB',started:NOW-5000,heard:5000,duration:180000,skipped:1}]});
 assert.ok(q.smartScore(tracks[0],tracks[2],{}).skipPenalty>60);
 assert.equal(q.peekNext().id,'far','saved sound must not override a strong acoustic rejection');
 const seen=new Set(['current']);
 for(let i=0;i<2;i++){
  const preview=q.peekNext();const next=q.next();assert.equal(preview.id,next.id);
  assert.notEqual(next.id,'nearA');assert.ok(!seen.has(next.id));seen.add(next.id);
  assert.equal(q.getLastTransition().toTrack.id,next.id);
 }
 assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
});

test('vibe has no effect on sequential/random playback and does not rewrite the reason for the playing track',()=>{
 const {q,anchor}=fixture();q.next();const decision=structuredClone(q.getLastTransition());
 q.setVibeProfile(anchor);assert.deepEqual(q.getLastTransition(),decision);
 for(const mode of ['off','random']){
  const a=fixture().q,b=fixture().q;a.setShuffleMode(mode);b.setShuffleMode(mode);b.setVibeProfile(anchor);
  for(let i=0;i<8;i++)assert.equal(a.next().id,b.next().id);
 }
 q.setShuffleMode('off');assert.equal(q.getLastTransition(),null);
 q.setShuffleMode('smart');assert.equal(q.getLastTransition(),null);
});

test('library refresh preserves the actual decision, but replacement audio or removal clears it',()=>{
 const {q,tracks,anchor}=fixture();q.setVibeProfile(anchor);q.next();
 const selected=q.getCurrentTrack().id,decision=structuredClone(q.getLastTransition());
 q.refreshLibrary(tracks.map(t=>({...t,title:'Updated '+t.title})),false);
 assert.deepEqual(q.getLastTransition()?.reasons,decision.reasons);
 assert.equal(q.getLastTransition()?.toTrack.id,selected);
 q.refreshLibrary(tracks.map(t=>t.id===selected?{...t,bytes:123}:t),false);
 assert.equal(q.getLastTransition(),null);
 q.next();q.refreshLibrary([],false);
 assert.equal(q.getLastTransition(),null);assert.equal(q.getCurrentTrack(),null);
});

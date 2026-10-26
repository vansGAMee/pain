const test=require('node:test'),assert=require('node:assert/strict');
const Queue=require('../src/queue-engine'),Taste=require('../src/taste-model'),Audio=require('../src/audio-profile');
const NOW=Date.UTC(2026,9,24,12);
const profile=(track,n=.2)=>({version:4,signature:Audio.signature(track),frames:48,seconds:24,
 positions:Array.from({length:48},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
 timbre:Array(12).fill(n),timbreVariance:Array(12).fill(.001)});
function fixture(){
 let now=NOW;
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Song '+i,artist:'Artist '+i,duration:180000,bpm:120}));
 const profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)]));
 const q=new Queue({shuffleMode:'smart',loopMode:'off',audioProfiles:profiles,now:()=>now});q.setContext('library',tracks);q.smartSeed=42;
 return {q,tracks,profiles,time:t=>now=t};
}
function countDecisions(q){
 const model=q.tasteModel(),choose=model.choose;let calls=0;
 model.choose=function(...args){calls++;return choose.apply(this,args);};
 return ()=>calls;
}
test('repeated lookahead and next reuse one decision without advancing or changing playback',()=>{
 const {q}=fixture(),calls=countDecisions(q),step=q.smartStep;
 const first=q.peekNext();for(let i=0;i<20;i++)assert.equal(q.peekNext().id,first.id);
 assert.equal(q.smartStep,step);assert.equal(calls(),1);
 assert.equal(q.next().id,first.id);assert.equal(calls(),1);
 assert.notEqual(q.peekNext().id,first.id);assert.equal(calls(),2);
});
test('mutable likes, tempo, tags, file identity and reference changes invalidate a cached decision',()=>{
 const {q,tracks}=fixture(),calls=countDecisions(q);
 const changes=[()=>tracks[1].favorite=1,()=>q.bpmCache['2']=85,()=>tracks[3].artist='New artist',
  ()=>tracks[4].bytes=99,()=>q.currentStartedAt=NOW,()=>q.smartSeed++,()=>q.recentArtists.push('Artist 1'),
  ()=>q.playedHistory.push(2),()=>q.unplayedIndices.delete(4)];
 q.peekNext();let expected=1;
 for(const change of changes){change();q.peekNext();assert.equal(calls(),++expected);q.peekNext();assert.equal(calls(),expected);}
});
test('feedback, audio, time expiry and refreshed library cannot reuse stale scores',()=>{
 const {q,tracks,time}=fixture();q.peekNext();let model=q._smartDecision.model;
 q.setStats({plays:[{track:'0',started:NOW-5000,heard:5000,duration:180000,skipped:1}]});q.peekNext();
 assert.notEqual(q._smartDecision.model,model);assert.deepEqual(q._taste.outcomes.get('0'),[0,1]);model=q._smartDecision.model;
 q.setAudioProfile('1',profile(tracks[1],.9));q.peekNext();assert.notEqual(q._smartDecision.model,model);model=q._smartDecision.model;
 time(NOW+60000);q.peekNext();assert.notEqual(q._smartDecision.model,model);model=q._smartDecision.model;
 time(NOW-1000);q.peekNext();assert.notEqual(q._smartDecision.model,model);model=q._smartDecision.model;
 q.refreshLibrary(tracks.map(t=>({...t})));q.peekNext();assert.notEqual(q._smartDecision.model,model);
});
test('vibes and exclusions apply immediately; caller edits cannot corrupt cached explanations',()=>{
 const {q,tracks}=fixture();
 const a=q.smartChoose(q.getCurrentTrack(),q.smartCandidates()),expected=[...a.reasons];a.reasons.push('bad');a.explanation.referenceTitle='bad';
 const b=q.smartChoose(q.getCurrentTrack(),q.smartCandidates());assert.deepEqual(b.reasons,expected);assert.notEqual(b.explanation.referenceTitle,'bad');
 q.excludeTrack(b.track.id);assert.notEqual(q.peekNext().id,b.track.id);
 q.setVibeProfile(profile(tracks[0],.9));
 const c=q.smartChoose(q.getCurrentTrack(),q.smartCandidates());assert.equal(c.explanation.referenceTitle,null);
 q.setExcludedTracks(tracks.map(t=>t.id));assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
});
test('per-decision validation never retains a replaced file or an in-place profile edit',()=>{
 const {tracks,profiles}=fixture(),m=new Taste(tracks,[],NOW,profiles),candidates=tracks.slice(1,3);
 m.choose(tracks[0],candidates);assert.equal(m._profileCache,null);
 tracks[1].bytes=123;
 assert.equal(m.score(tracks[0],tracks[1]).soundSimilarity,null);
 profiles['1']=profile(tracks[1],.9);
 assert.equal(m.choose(tracks[0],candidates,{},{seed:1}).track.id,'2');
 profiles['2'].vector[0]=NaN;
 assert.equal(m.score(tracks[0],tracks[2]).soundSimilarity,null);
});

test('one selection reuses acoustic comparisons without changing the selected track or scores',()=>{
 const {tracks,profiles}=fixture();
 const plays=tracks.slice(0,5).map((t,i)=>({track:t.id,started:NOW-(6-i)*180000,heard:180000,media_heard:180000,duration:180000,finished:1}));
 const model=new Taste(tracks,plays,NOW,profiles),compare=model.similarity;let calls=0;
 model.similarity=(...args)=>{calls++;return compare(...args);};
 const instrumented=model.similarity;
 model._profileCache=new WeakMap();
 const expected=model.chooseCandidates(tracks[0],tracks.slice(1),{},{seed:44});
 const uncachedCalls=calls;calls=0;model._profileCache=null;model.soundPreferenceCache.clear();
 const actual=model.choose(tracks[0],tracks.slice(1),{},{seed:44});
 assert.deepEqual(actual,expected);
 assert.ok(calls<uncachedCalls,`${calls} cached comparisons vs ${uncachedCalls} uncached`);
 assert.equal(model.similarity,instrumented);
 assert.equal(model._profileCache,null);
});

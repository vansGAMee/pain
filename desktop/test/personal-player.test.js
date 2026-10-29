const test=require('node:test'),assert=require('node:assert/strict'),Queue=require('../src/queue-engine'),Player=require('../src/personal-player');
const tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:30000}));
function fixture(type='library'){const q=new Queue({shuffleMode:'smart',loopMode:'all',pulseflowPolicy:'taste',pulseflowEnabled:true,now:()=>1800000000000});q.setContext(type,tracks,0);return q;}
test('new mode obeys queue scope, exclusions, forward history and repeat-one',async()=>{
 const q=fixture();q.setExcludedTracks(['c']);const result=await Player.next(q,async payload=>{assert.deepEqual(payload.eligible,['b']);assert.equal(payload.kind,'next');return {tracks:[{id:'b',reasons:['Весь ваш вкус'],explanation:{method:'personal-taste'}}]};});assert.equal(result.trackId,'b');assert.equal(q.lastTransition.explanation.method,'personal-taste');
 q.setLoopMode('one');assert.equal((await Player.next(q,()=>{throw Error('navigation must not query');})).trackId,'b');
});
test('an explicitly selected preview finishes its displayed order',async()=>{
 const q=fixture();q.pulseflowPlan={preview:true,remaining:[{id:'c',reasons:['Весь ваш вкус'],explanation:{method:'personal-taste'}},{id:'b',reasons:['Весь ваш вкус']}]};
 assert.equal((await Player.next(q,()=>{throw Error('keep preview');})).trackId,'c');assert.equal(q.pulseflowPlan.remaining[0].id,'b');
});
test('library radio can revisit taste without forcing a whole-library sweep; playlists retain a finite cycle',()=>{
 const q=fixture();q.unplayedIndices.clear();q.unplayedIndices.add(2);assert.deepEqual(q.smartCandidates(),[1,2]);
 const list=fixture('playlist');list.unplayedIndices.clear();list.unplayedIndices.add(2);assert.deepEqual(list.smartCandidates(),[2]);
});
test('fresh feedback and likes invalidate personal prefetch; out-of-scope replies are rejected',async()=>{
 const q=fixture(),before=q.selectionKey();q.setStats({plays:[]});assert.notEqual(q.selectionKey(),before);
 const old=q.selectionKey();q.tracks[1].favorite=1;assert.notEqual(q.selectionKey(),old);
 await assert.rejects(Player.next(q,async()=>({tracks:[{id:'a'}]})),/Ineligible/);
});
test('a one-track library can repeat naturally rather than becoming an empty radio',async()=>{
 const q=new Queue({shuffleMode:'smart',loopMode:'all',pulseflowPolicy:'taste'});q.setContext('library',[tracks[0]],0);assert.deepEqual(q.smartCandidates(),[0]);
 const next=await Player.next(q,async()=>({tracks:[{id:'a',reasons:['Весь ваш вкус']}]}));assert.equal(next.trackId,'a');
});
test('cold learning returns the real frequency baseline immediately with worker snapshot evidence',async()=>{
 const live=fixture();live.setStats({plays:[{track:'b',started:1000,finished:1,heard:30000,duration:30000}]});
 const q=Queue.fromWorkerSnapshot(live.workerSnapshot());
 const result=await Player.next(q,async()=>({preparing:true,tracks:[]}));
 assert.equal(result.trackId,'b');assert.equal(q.lastTransition.explanation.method,'frequency-fallback');assert.equal(Player.isPreparing(),true);
});
test('a cold Home mix remains an actionable displayed playlist and never repeats rows',async()=>{
 const q=fixture();const rows=await Player.mix(tracks,q,6,async()=>({preparing:true,tracks:[]}));
 assert.deepEqual(new Set(rows.map(r=>r.track.id)),new Set(['b','c']));assert.ok(rows.every(r=>r.decision.explanation.method==='personal-taste-fallback'));
});

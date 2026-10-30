const test=require('node:test'),assert=require('node:assert/strict'),Queue=require('../src/queue-engine'),Player=require('../src/personal-player');
const tracks=['a','b','c'].map(id=>({id,title:id,artist:id,duration:30000}));
function fixture(type='library'){const q=new Queue({shuffleMode:'smart',loopMode:'all',pulseflowPolicy:'taste',pulseflowEnabled:true,now:()=>1800000000000});q.setContext(type,tracks.map(t=>({...t})),0);return q;}
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
 assert.ok(['b','c'].includes(result.trackId));assert.equal(q.lastTransition.explanation.method,'frequency-fallback');assert.equal(q.lastTransition.explanation.probability,result.trackId==='b'?2/3:1/3);assert.equal(Player.isPreparing(),true);
});
test('a cold Home mix remains an actionable displayed playlist and never repeats rows',async()=>{
 const q=fixture();const rows=await Player.mix(tracks,q,6,async()=>({preparing:true,tracks:[]}));
 assert.deepEqual(new Set(rows.map(r=>r.track.id)),new Set(['b','c']));assert.ok(rows.every(r=>r.decision.explanation.method==='personal-taste-fallback'));
});
test('cold or failed learning samples its actual baseline instead of alternating the top two',async()=>{
 const library=Array.from({length:12},(_,i)=>({id:String(i),title:'Song '+i,artist:'Artist '+i,duration:30000}));
 const stats={plays:library.flatMap((t,i)=>Array.from({length:12-i},(_,j)=>({track:t.id,started:1000+i*100+j,finished:1})))};
 const q=new Queue({shuffleMode:'smart',pulseflowPolicy:'taste',stats});q.smartSeed=42;q.setContext('library',library,0);
 const sequence=[];for(let i=0;i<60;i++)sequence.push((await Player.next(q,async()=>({preparing:true,tracks:[]}))).trackId);
 assert.ok(new Set(sequence).size>2,'an available library must not collapse to a two-track fallback loop');
 assert.ok(sequence.every((id,i)=>i===0||id!==sequence[i-1]));
 const all=q.tracks.map((_,i)=>i),counts=q.completedCounts();q.smartStep=10;
 const choice=q.fallbackChoose(all),total=library.reduce((n,t)=>n+(counts.get(t.id)||0)+1,0);
 assert.equal(choice.explanation.probability,((counts.get(choice.track.id)||0)+1)/total,'the fallback uses exactly the model baseline distribution');
 assert.equal(q.fallbackChoose(all).track.id,choice.track.id,'peeking cannot consume the seeded random cursor');
});
test('background refitting keeps the last learned choice and its explanation active',async()=>{
 const q=fixture();const result=await Player.next(q,async()=>({updating:true,tracks:[{id:'c',reasons:['Весь ваш вкус'],explanation:{method:'personal-taste',historyEvents:200}}]}));
 assert.equal(result.trackId,'c');assert.equal(q.lastTransition.explanation.method,'personal-taste');assert.equal(Player.isPreparing(),true,'readiness polling continues without switching to the baseline');
});

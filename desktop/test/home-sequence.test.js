const test=require('node:test'),assert=require('node:assert/strict'),Queue=require('../src/queue-engine');
const tracks=['a','b','c','d','e'].map(id=>({id,title:id,artist:id,duration:1000}));
const row=id=>({id,reasons:['Saved decision'],explanation:{method:'personal-taste',historyEvents:42}});
test('an explicit Home sequence bypasses all models, survives sync/refits, then resumes normal selection',async()=>{
 let calls=0;
 const q=new Queue({shuffleMode:'smart',loopMode:'all',pulseflowPolicy:'taste',selectInWorker:async({snapshot})=>{
  calls++;const worker=Queue.fromWorkerSnapshot(snapshot),track=worker.next({fallback:true});return {trackId:track.id,navigation:worker.navigationSnapshot()};
 }});
 q.setContext('library',tracks,0);q.pulseflowPlan={preview:true,remaining:['d','b','e'].map(row)};
 for(const id of ['d','b','e']){
  const before=JSON.stringify(q.pulseflowPlan);
  assert.equal(q.peekNext().id,id);assert.equal((await q.peekNextAsync()).id,id);assert.equal(JSON.stringify(q.pulseflowPlan),before);
  q.refreshLibrary(tracks.map(t=>({...t,album:'New metadata'})));q.setStats({plays:[]});q.refreshRecommendations();q.pulseflowPolicy='contrast';
  assert.equal((await q.nextAsync()).id,id);assert.equal(q.getLastTransition().explanation.historyEvents,42);assert.equal(calls,0);
 }
 assert.ok(await q.nextAsync());assert.equal(calls,1);assert.equal(q.pulseflowPlan,null);
});
test('preview keeps explicit versions and prior plays; only removed or excluded rows are skipped',async()=>{
 const songs=[{...tracks[0],title:'Everlong',artist:'Foo Fighters'},{...tracks[1],title:'Everlong - Slowed',artist:'Foo Fighters'},...tracks.slice(2)];
 const q=new Queue({shuffleMode:'smart',loopMode:'off',selectInWorker:()=>{throw Error('No model for explicit queue');}});
 q.setContext('library',songs,0);q.unplayedIndices.clear();q.pulseflowPlan={preview:true,remaining:['b','c','d','e'].map(row)};
 assert.equal((await q.nextAsync()).id,'b');
 q.setExcludedTracks(['c']);q.refreshLibrary(songs.filter(t=>t.id!=='d'));
 assert.equal(q.peekNext().id,'e');assert.equal((await q.nextAsync()).id,'e');
});
test('back/forward and explicit repeat-one do not consume the remaining Home queue',()=>{
 const q=new Queue({shuffleMode:'smart',loopMode:'all'});q.setContext('library',tracks,0);q.pulseflowPlan={preview:true,remaining:['b','c'].map(row)};
 assert.equal(q.next().id,'b');assert.equal(q.prev().id,'a');assert.equal(q.next().id,'b');assert.equal(q.pulseflowPlan.remaining[0].id,'c');
 q.setLoopMode('one');assert.equal(q.next().id,'b');assert.equal(q.pulseflowPlan.remaining[0].id,'c');
 q.setLoopMode('all');assert.equal(q.next().id,'c');
});
test('Home uses the full catalog even when the source queue is small or empty, and retains frequency evidence',()=>{
 for(const context of [[],[tracks[0]]]){
  const q=new Queue({pulseflowEnabled:true,pulseflowPolicy:'taste',stats:{plays:[{track:'d',started:1000,finished:1}]}});
  q.setContext('favorites',context,0);q.setExcludedTracks(['b']);const before=q.navigationSnapshot();
  const preview=Queue.previewFromSnapshot(q.workerSnapshot(),tracks),mix=preview.frequencyMix(6);
  assert.equal(mix[0].track.id,'d');assert.ok(mix.every(r=>r.track.id!=='b'));assert.equal(new Set(mix.map(r=>r.track.id)).size,mix.length);
  assert.deepEqual(q.navigationSnapshot(),before);assert.equal(q.context.type,'favorites');assert.equal(q.tracks.length,context.length);
 }
});

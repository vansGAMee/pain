const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Player = require('../src/pulseflow-player'), Queue = require('../src/queue-engine');
const tracks = Array.from({length:24}, (_, i) => ({id:String(i),title:'Audio '+i,artist:'Artist '+i}));
function queue() { const q=new Queue({shuffleMode:'smart',loopMode:'off'}); q.setContext('library',tracks,0); q.smartChoose=()=>{throw Error('Local scoring must never run');};return q; }

test('vendored PulseFlow is byte-for-byte the pinned upstream source', () => {
  const root=path.resolve(__dirname,'../src/vendor/pulseflow'), manifest=require('../src/vendor/pulseflow/UPSTREAM.json');
  assert.equal(manifest.commit,'d1fedcd4e1a676c0838ab2f7eb9ba6934676bcff');
  for(const [file, hash] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,file);
});
test('Next preserves the complete upstream contrast sequence across worker snapshots', async () => {
  let q=queue(), calls=0; q.pulseflowPolicy='contrast';
  const ids=['1','20','2','19','3','18'];
  const query=async request=>{calls++;assert.equal(request.length,20);assert.equal(request.policy,'contrast');return {tracks:ids.map((id,i)=>({id,score:1-i/10}))};};
  for(const id of ids){
    const result=await Player.next(q,query);assert.equal(result.trackId,id);
    q=Queue.fromWorkerSnapshot({...q.workerSnapshot(),navigation:result.navigation});
    assert.equal(q.getLastTransition().explanation.method,'pulseflow-clap-faiss');
  }
  assert.equal(calls,1,'do not replace contrast by repeated length=1 queries');
});
test('exclusions and current queue scope constrain upstream candidates without reranking', async () => {
  const q=queue();q.setExcludedTracks(['2','4']);let captured;
  const result=await Player.next(q,async request=>{captured=request;return {tracks:[{id:'3',score:.6},{id:'1',score:.8}]};});
  assert.equal(result.trackId,'3','keep upstream ordering even when later similarity is higher');
  assert.ok(!captured.eligible.includes('0'));assert.ok(!captured.eligible.includes('2'));assert.ok(!captured.eligible.includes('4'));
  q.setExcludedTracks(['1']);
  await Player.next(q,async request=>{assert.ok(!request.eligible.includes('1'));return {tracks:[{id:'5',score:.5}]};});
  assert.equal(q.getCurrentTrack().id,'5');
});
test('previous/forward replays navigation without querying the model', async () => {
  const q=queue();const query=async()=>({tracks:[{id:'1',score:.9},{id:'2',score:.8}]});
  await Player.next(q,query);await Player.next(q,query);q.prev();
  const result=await Player.next(q,async()=>{throw Error('unexpected request');});assert.equal(result.trackId,'2');
});
test('Home returns upstream order and actual recorded explanations', async () => {
  const q=queue();const result=await Player.mix(tracks,q,6,async request=>{
    assert.equal(request.seed,'0');assert.equal(request.length,6);
    return {tracks:[{id:'5',score:.4},{id:'2',score:.9}]};
  });
  assert.deepEqual(result.map(x=>x.track.id),['5','2']);assert.equal(result[0].decision.explanation.score,.4);
});
test('a saved CLAP reference can be outside the selected playlist', async () => {
  const q=queue();q.pulseflowVibe={trackId:'saved-outside-playlist',source:'Actual source'};
  await Player.next(q,async request=>{assert.equal(request.seed,'saved-outside-playlist');return {tracks:[{id:'1',score:.4}]};});
});
test('missing embeddings fail explicitly and do not invoke a substitute acoustic model', async () => {
  const q=queue();await assert.rejects(Player.next(q,async()=>{throw Error('index unavailable');}),/index unavailable/);
  assert.equal(q.getCurrentTrack().id,'0');
});
test('live acoustic frames and history do not cancel PulseFlow or get cloned into the worker', async () => {
  const q=queue();q.pulseflowEnabled=true;
  const key=q.selectionKey();
  q.setStats({plays:[{track:'0',started:1,finished:1}]});q.audioProfiles={large:'live audio evidence'};q.bpmCache['0']=120;
  assert.equal(q.selectionKey(),key);
  const snapshot=q.workerSnapshot();assert.equal(snapshot.stats,null);assert.deepEqual(snapshot.audioProfiles,{});assert.deepEqual(snapshot.bpmCache,{});
  q.setExcludedTracks(['1']);assert.notEqual(q.selectionKey(),key);
});
test('personal mode preserves frequency priority and calls upstream only for equal counts', async () => {
  const q=queue();q.pulseflowPolicy='personal';q.pulseflowEnabled=true;
  q.setStats({plays:[{track:'2',started:1,finished:1},{track:'2',started:2,finished:1},
    {track:'3',started:3,finished:1},{track:'3',started:4,finished:1},{track:'1',started:5,finished:1}]});
  const first=await Player.next(q,async request=>{
    assert.deepEqual(request.eligible,['2','3']);assert.equal(request.policy,'smooth');
    return {tracks:[{id:'3',score:.8},{id:'2',score:.5}]};
  });
  assert.equal(first.trackId,'3');assert.equal(q.getLastTransition().explanation.method,'frequency-pulseflow-ties');
  const second=await Player.next(q,async()=>{throw Error('Reuse the equal-count playlist');});assert.equal(second.trackId,'2');
  const third=await Player.next(q,async request=>{
    assert.deepEqual(request.eligible,['1']);return {tracks:[{id:'1',score:.2}]};
  });assert.equal(third.trackId,'1');
});
test('an explicitly chosen Home mix finishes in displayed order and continues beyond its preview',async()=>{
 const q=queue();q.pulseflowPolicy='personal';
 q.setStats({plays:[{track:'9',started:1,finished:1}]});
 q.pulseflowPlan={seed:tracks[0],policy:'smooth',personal:true,preview:true,vibeKey:'null',remaining:[{id:'1',score:.8},{id:'2',score:.6}]};
 const unexpected=async()=>{throw Error('Do not replace the playlist the listener just chose');};
 assert.equal((await Player.next(q,unexpected)).trackId,'1');
 assert.equal((await Player.next(q,unexpected)).trackId,'2');
 const result=await Player.next(q,async request=>{
  assert.deepEqual(request.eligible,['9']);return {tracks:[{id:'9',score:.5}]};
 });
 assert.equal(result.trackId,'9');assert.equal(q.tracks.length,24);
});

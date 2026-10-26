const test = require('node:test');
const assert = require('node:assert/strict');
const QueueEngine = require('../src/queue-engine');
const HomeModel = require('../src/home-model');
const AudioProfile = require('../src/audio-profile');

const sampleTracks = [
  { id: '1', title: 'Song One', artist: 'Artist A', duration: 180000, bpm: 120 },
  { id: '2', title: 'Song Two', artist: 'Artist B', duration: 200000, bpm: 124 },
  { id: '3', title: 'Song Three', artist: 'Artist C', duration: 210000, bpm: 122 },
  { id: '4', title: 'Song Four', artist: 'Artist D', duration: 195000, bpm: 126 },
  { id: '5', title: 'Song Five', artist: 'Artist E', duration: 220000, bpm: 120 }
];

test('QueueEngine.fromWorkerSnapshot matches synchronous queue selection and navigation', () => {
  const q1 = new QueueEngine({ shuffleMode: 'smart', loopMode: 'all' });
  q1.setContext('library', sampleTracks, 0, 'Library', true);
  q1.smartSeed = 12345;

  const snapshot = q1.workerSnapshot();
  const q2 = QueueEngine.fromWorkerSnapshot(snapshot);

  const t1 = q1.next();
  const t2 = q2.next();

  assert.equal(t1.id, t2.id);
  assert.deepEqual(q1.navigationSnapshot(), q2.navigationSnapshot());
  assert.equal(q1.getLastTransition().toTrack.id, q2.getLastTransition().toTrack.id);
});

test('nextAsync and peekNextAsync execute in worker and populate queue state accurately', async () => {
  let workerCalls = 0;
  const mockWorker = async ({ action, snapshot }) => {
    workerCalls++;
    const q = QueueEngine.fromWorkerSnapshot(snapshot);
    const track = q.next();
    return { trackId: track ? track.id : null, navigation: q.navigationSnapshot() };
  };

  const q = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    selectInWorker: mockWorker
  });
  q.setContext('library', sampleTracks, 0, 'Library', true);
  q.smartSeed = 54321;

  // 1. Peek next asynchronously
  const peeked = await q.peekNextAsync();
  assert.ok(peeked);
  assert.equal(workerCalls, 1);

  // 2. Synchronous peekNext uses cached worker job result
  const syncPeeked = q.peekNext();
  assert.equal(syncPeeked.id, peeked.id);
  assert.equal(workerCalls, 1, 'peekNext must reuse cached worker job without recomputing');

  // 3. nextAsync uses cached job and applies navigation
  const nextTrack = await q.nextAsync();
  assert.equal(nextTrack.id, peeked.id);
  assert.equal(workerCalls, 1, 'nextAsync must reuse cached job without triggering extra worker call');
  assert.equal(q.getCurrentTrack().id, peeked.id);
  assert.equal(q.currentIndex, sampleTracks.findIndex(t => t.id === peeked.id));
});

test('rapid successive nextAsync calls cancel obsolete requests and resolve the latest', async () => {
  let workerCalls = 0;
  const mockWorker = async ({ action, snapshot }) => {
    workerCalls++;
    await new Promise(r => setTimeout(r, 20));
    const q = QueueEngine.fromWorkerSnapshot(snapshot);
    const track = q.next();
    return { trackId: track ? track.id : null, navigation: q.navigationSnapshot() };
  };

  const q = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    selectInWorker: mockWorker
  });
  q.setContext('library', sampleTracks, 0, 'Library', true);

  // Rapidly trigger 3 selections
  const p1 = q.nextAsync();
  const p2 = q.nextAsync();
  const p3 = q.nextAsync();

  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  assert.equal(r1, undefined, 'First call superseded by newer generation must return undefined');
  assert.equal(r2, undefined, 'Second call superseded by newer generation must return undefined');
  assert.ok(r3, 'Latest call must resolve to a valid track');
  assert.equal(q.getCurrentTrack().id, r3.id);
  assert.equal(workerCalls, 1, 'Identical context should reuse single inflight calculation');
});

test('manual track change during inflight worker calculation discards stale worker result', async () => {
  const mockWorker = async ({ action, snapshot }) => {
    await new Promise(r => setTimeout(r, 40));
    const q = QueueEngine.fromWorkerSnapshot(snapshot);
    const track = q.next();
    return { trackId: track ? track.id : null, navigation: q.navigationSnapshot() };
  };

  const q = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    selectInWorker: mockWorker
  });
  q.setContext('library', sampleTracks, 0, 'Library', true);

  // Inflight calculation starts for track 0
  const inflight = q.nextAsync();

  // User manually clicks track 4 halfway through
  q.cancelPendingSelection();
  q.currentIndex = 4;
  q.currentStartedAt = Date.now();

  const result = await inflight;
  assert.equal(result, undefined, 'Stale worker result must return undefined when cancelled or track changed');
  assert.equal(q.currentIndex, 4, 'Current track must remain the user selected track');
  assert.equal(q.getCurrentTrack().id, '5');
});

test('worker failure or rejection falls back gracefully to synchronous next', async () => {
  const failingWorker = async () => {
    throw new Error('Worker process crashed');
  };

  const q = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    selectInWorker: failingWorker
  });
  q.setContext('library', sampleTracks, 0, 'Library', true);

  const fallbackTrack = await q.nextAsync();
  assert.ok(fallbackTrack, 'Must fall back to synchronous calculation without throwing');
  assert.ok(sampleTracks.some(t => t.id === fallbackTrack.id));
});

test('HomeModel.mix produces identical playlist whether calculated directly or from snapshot', () => {
  const q = new QueueEngine({ shuffleMode: 'smart', loopMode: 'off' });
  q.setContext('library', sampleTracks, 0, 'Library', true);
  q.smartSeed = 999;

  const directMix = HomeModel.mix(sampleTracks, q, 4, 1);

  const workerQ = QueueEngine.fromWorkerSnapshot(q.workerSnapshot());
  const workerMix = HomeModel.mix(sampleTracks, workerQ, 4, 1);

  assert.equal(directMix.length, workerMix.length);
  for (let i = 0; i < directMix.length; i++) {
    assert.equal(directMix[i].track.id, workerMix[i].track.id);
  }
});

test('worker failure uses completed-frequency fallback without calling the expensive model', async()=>{
 const now=Date.now();
 const q=new QueueEngine({shuffleMode:'smart',now:()=>now,selectInWorker:async()=>{throw Error('crash');},
  stats:{plays:[{track:'3',started:now-1000,finished:1},{track:'2',started:now-2000,skipped:1}]}});
 q.setContext('library',sampleTracks,0);
 q.smartChoose=()=>{throw Error('renderer must never score music');};
 assert.equal(q.peekNext(),null);
 assert.equal((await q.peekNextAsync()).id,'3');
 assert.equal((await q.nextAsync()).id,'3');
 assert.equal(q.getLastTransition().explanation.method,'frequency-fallback');
});

test('rejected worker cannot advance a newly selected track or reuse an excluded preview',async()=>{
 let reject;
 const q=new QueueEngine({shuffleMode:'smart',selectInWorker:()=>new Promise((_,r)=>reject=r)});
 q.setContext('library',sampleTracks,0);
 const next=q.nextAsync();q.jumpToTrack('5');reject(Error('late failure'));
 assert.equal(await next,undefined);assert.equal(q.getCurrentTrack().id,'5');
 q._selectionJob={key:'obsolete',result:{trackId:'2'}};q.excludeTrack('2');
 q.smartChoose=()=>{throw Error('synchronous scoring');};
 assert.equal(q.peekNext(),null);
});

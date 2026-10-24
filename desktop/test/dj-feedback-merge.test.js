const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Taste = require('../src/taste-model');
const Audio = require('../src/audio-profile');
const Listening = require('../src/listening');

const NOW = Date.UTC(2026, 9, 24, 12);
const tracks = ['skipped', 'neighbour'].map(id => ({id, title:id, artist:'Artist '+id, duration:180000}));
const profiles = Object.fromEntries(tracks.map(track => [track.id, {
  version:4, signature:Audio.signature(track), frames:48, seconds:24,
  positions:Array.from({length:48}, (_, i) => i),
  vector:[.4,.1,.7,.2,.25,.1], variance:Array(6).fill(.01),
  timbre:Array(12).fill(.2), timbreVariance:Array(12).fill(.001)
}]));
const play = extra => ({
  track:'skipped', started:NOW-30000, duration:180000,
  heard:5000, media_heard:5000, finished:0, skipped:1, ...extra
});
const model = rows => new Taste(tracks, rows, NOW, profiles);
const snapshot = value => ({
  samples:value.samples, searching:value.searching, recentSkips:value.recentSkips,
  quality:value.lastQuality.get('skipped'), feedback:value.lastFeedback.get('skipped'),
  evidence:value.evidence.get('skipped'), score:value.score(null, tracks[1])
});
function orders(a, b) {
  return [[a,b], [b,a], [a,b,a,b], [b,a,b,a]];
}

test('sync order and repeated copies cannot erase an explicit skip at equal coverage', () => {
  const skipped = play(), interrupted = play({skipped:0});
  const expected = snapshot(model([skipped]));
  assert.equal(expected.samples, 1);
  assert.equal(expected.searching, true);
  assert.ok(expected.score.skipPenalty > 50, 'the refusal must reach acoustic neighbours');
  for (const rows of orders(interrupted, skipped)) {
    const before = JSON.stringify(rows);
    assert.deepEqual(snapshot(model(rows)), expected);
    assert.equal(JSON.stringify(rows), before, 'merging must not mutate source records');
  }
  assert.deepEqual(snapshot(model([play({skipped:false}), play({skipped:true})])), expected);
});

test('known unique coverage wins over larger wall time from older short-skip copies', () => {
  const canonical = play({heard:25000}), legacy = {...canonical};
  delete legacy.media_heard;
  const expected = snapshot(model([canonical]));
  assert.equal(expected.searching, true);
  assert.ok(Math.abs(expected.quality-5000/180000) < 1e-12);
  for (const rows of orders(canonical, legacy)) assert.deepEqual(snapshot(model(rows)), expected);
  const laterCoverage = play({heard:29000, media_heard:10000});
  for (const rows of orders(canonical, laterCoverage)) {
    assert.deepEqual(snapshot(model(rows)), snapshot(model([laterCoverage])), 'actual coverage still grows across snapshots');
  }
  assert.equal(model([legacy]).samples, 1, 'legacy-only listening remains usable');
});

test('a completed play outranks skip snapshots without duplicate training', () => {
  const skipped = play();
  for (const completion of [{finished:1}, {finished:true}, {completed:1}, {completed:true}]) {
    const finished = play({skipped:0, ...completion});
    const expected = snapshot(model([finished]));
    assert.equal(expected.samples, 1);
    assert.equal(expected.quality, 1);
    assert.equal(expected.searching, false);
    assert.equal(expected.feedback.rejected, false);
    assert.equal(expected.score.skipPenalty, 0);
    for (const rows of orders(skipped, finished)) assert.deepEqual(snapshot(model(rows)), expected);
  }
});

test('sub-second measured coverage cannot become a dislike through a wall-only duplicate', () => {
  for (const coverage of [0, 500, 999]) {
    const measured = play({heard:25000, media_heard:coverage}), legacy = {...measured};
    delete legacy.media_heard;
    for (const rows of orders(measured, legacy)) {
      const actual = model(rows);
      assert.equal(actual.samples, 0);
      assert.equal(actual.searching, false);
      assert.equal(actual.score(null, tracks[1]).skipPenalty, 0);
    }
  }
});

test('malformed and non-audible records cannot invent or replace valid feedback', () => {
  const invalid = [null, false, 'skip', {}, play({track:'missing'}), play({started:NOW+1}),
    play({started:-1}), play({started:Infinity}), play({media_heard:NaN}),
    play({media_heard:Infinity}), play({media_heard:-1}), play({media_heard:500}),
    play({duration:-1}), play({duration:Infinity})];
  const empty = snapshot(model([]));
  assert.deepEqual(snapshot(model(invalid)), empty);
  const valid = play(), expected = snapshot(model([valid]));
  assert.deepEqual(snapshot(model([...invalid, valid, ...invalid])), expected);
  assert.equal(model([play({skipped:0})]).samples, 0, 'an interrupted preview is not a rejection');
});

test('short-skip recording preserves unique coverage in the immediate queue, storage and relay', async () => {
  const ledger = new Listening('skipped', 180000, NOW-30000);
  for (let i=0; i<5; i++) {
    ledger.anchor(i*5000, 0);
    ledger.sample((i+1)*5000, 5);
  }
  assert.equal(ledger.heard, 25000);
  assert.deepEqual(ledger.ranges, [[0,5]]);
  const storage = new Map(), requests = [], queued = [];
  const context = {
    listening:ledger, state:{saveHistory:true, stats:{plays:[]}, tracks, phoneUrl:''},
    localSyncRevision:0,
    localStorage:{getItem:key => storage.get(key) ?? null, setItem:(key, value) => storage.set(key, value)},
    queue:{setStats:stats => queued.push(JSON.parse(JSON.stringify(stats)))},
    fetch:async (url, options) => { requests.push({url, body:JSON.parse(options.body)}); return {ok:true}; },
    crypto:{randomUUID:() => 'test-feedback'}, Date, Math
  };
  // Exercise the actual recorder while keeping browser/server side effects in memory.
  const source = fs.readFileSync(require.resolve('../src/app'), 'utf8');
  const start = source.indexOf('  function readTasteSkips(');
  const end = source.indexOf('  // --- SLEEP-RESISTANT PREFETCHING ---', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  await context.recordTrackFinished('skipped', true);
  assert.equal(queued.length, 1);
  const persisted = JSON.parse(storage.get('pain_taste_skips'));
  assert.equal(persisted.length, 1);
  assert.equal(context.state.stats.plays.length, 1);
  assert.equal(requests.length, 1);
  for (const record of [queued[0].plays[0], persisted[0], context.state.stats.plays[0], requests[0].body.play]) {
    assert.equal(record.heard, 25000);
    assert.equal(record.media_heard, 5000, 'the same five seconds are not twenty-five seconds of coverage');
    assert.equal(record.skipped, 1);
    assert.equal(record.finished, 0);
    assert.equal(model([record]).searching, true);
  }
  await context.recordTrackFinished('skipped', true);
  assert.equal(requests.length, 1, 'a second finish must not send another play');
  assert.equal(context.state.stats.plays.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canonicalEvents, temporalSplit, rankMetrics, randomMetrics, parseArgs, evaluate } = require('./evaluate-recommendations.cjs');

test('evaluation deduplicates synchronized copies before splitting and keeps tied timestamps together', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }];
  const { events, diagnostics } = canonicalEvents([
    { track: 'a', started: 100, finished: 0, media_heard: 2000 },
    { track: 'a', started: 100, finished: 1, media_heard: 10000 },
    { track: 'a', started: 200, finished: 1 },
    { track: 'b', started: 200, finished: 1 },
    { track: 'b', started: 300, finished: 1 },
    { track: 'absent', started: 400 },
    { track: 'a', started: NaN }
  ], tracks);
  assert.equal(events.length, 4);
  assert.equal(diagnostics.duplicates, 1);
  assert.equal(diagnostics.unknownTrack, 1);
  assert.equal(diagnostics.invalidTime, 1);
  assert.equal(events[0].finished, 1);
  assert.equal(events[0].media_heard, 10000);
  const split = temporalSplit(events, 0.5);
  assert.deepEqual(split.train.map(event => event.started), [100]);
  assert.deepEqual(split.test.map(event => event.started), [200, 200, 300]);
});

test('evaluation random baseline is the exact expectation of every possible target rank', () => {
  const ranks = Array.from({ length: 5 }, (_, i) => rankMetrics(i + 1, 5, [1, 3, 10]));
  const expected = randomMetrics(5, [1, 3, 10]);
  for (const [metric, value] of Object.entries(expected)) {
    const empirical = ranks.reduce((sum, row) => sum + row[metric], 0) / ranks.length;
    assert.ok(Math.abs(value - empirical) < 1e-12, metric);
  }
});

test('offline evaluation masks future favourites, omits future profiles and never changes its inputs', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-evaluation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { ...parseArgs(['--data-dir', directory, '--train-fraction', '0.5']), queueStarts: 1, queueLength: 2 };
  const Audio = require('../src/audio-profile');
  const tracks = ['a', 'b', 'c'].map(id => ({ id, title: id, artist: id, duration: 10000, added: 1, favorite: false }));
  const plays = Array.from({ length: 12 }, (_, i) => ({ track: tracks[i % 3].id, started: 100000 + i * 20000, duration: 10000, heard: 10000, media_heard: 10000, finished: 1 }));
  const profile = { version: 4, signature: Audio.signature(tracks[0]), frames: 20, seconds: 10, positions: Array.from({ length: 20 }, (_, i) => i), vector: [0.4, 0.5, 0.3, 0.2, 0.4, 0.1], variance: Array(6).fill(0.01), timbre: Array(12).fill(0.5), timbreVariance: Array(12).fill(0.01), updatedAt: plays.at(-1).started };
  const writeLibrary = () => fs.writeFileSync(path.join(directory, 'library.json'), JSON.stringify({ tracks }));
  writeLibrary();
  fs.writeFileSync(path.join(directory, 'stats.json'), JSON.stringify({ plays }));
  fs.writeFileSync(path.join(directory, 'dj-state.json'), JSON.stringify({ profiles: { a: profile } }));
  const first = evaluate(options);
  assert.equal(first.integrity.unchanged, true);
  assert.equal(first.audio.signatureMatchingProfiles, 1);
  assert.equal(first.holdout.historicalAudioProfiles, 0);
  assert.equal(first.holdout.trainingEvents, 6);
  assert.equal(first.holdout.heldOutEvents, 6);
  assert.equal(first.queue.exclusionViolations, 0);
  assert.equal(first.queue.nonFiniteScores, 0);
  tracks[0].favorite = true;
  writeLibrary();
  const second = evaluate(options);
  assert.deepEqual(second.holdout.methods, first.holdout.methods);
  assert.equal(second.integrity.unchanged, true);
});

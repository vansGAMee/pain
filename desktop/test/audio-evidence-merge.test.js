const test = require('node:test'), assert = require('node:assert/strict');
const Audio = require('../src/audio-profile'), DjState = require('../src/dj-state');
const track = { id: 'a', duration: 180000 };
const profile = (frames, updatedAt, full = false) => ({
  version: 4, signature: Audio.signature(track), frames, seconds: frames / 2, updatedAt,
  positions: Array.from({ length: frames }, (_, i) => i), vector: Array(6).fill(.5), variance: Array(6).fill(0),
  timbre: Array(12).fill(.5), timbreVariance: Array(12).fill(0),
  detail: { version: 1, frames: 24, seconds: 12, positions: Array.from({ length: 24 }, (_, i) => i), mean: Array(7).fill(.5) },
  ...(full ? { analysis: { method: 'stratified-pcm-v1' } } : {})
});
const merge = (a, b) => DjState.merge({ profiles: { a } }, { profiles: { a: b } }).profiles.a;

test('whole-track PCM replaces larger intro caches and newer reanalysis replaces equal-sized evidence', () => {
  const old = profile(100, 10), full = profile(72, 20, true), refreshed = profile(72, 30, true);
  assert.deepEqual(merge(old, full), full);
  assert.deepEqual(merge(full, refreshed), refreshed);
  assert.deepEqual(merge(refreshed, full), refreshed);
  assert.deepEqual(merge(full, profile(120, 40)), full, 'partial playback cannot overwrite full-file evidence');
  assert.equal(old.frames, 100, 'merge must not mutate input snapshots');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const FavoriteMoments = require('../src/favorite-moments');

test('FavoriteMoments: normalize handles valid numbers and bounds', () => {
  assert.equal(FavoriteMoments.normalize(123.456, 300), 123.5);
  assert.equal(FavoriteMoments.normalize(0, 300), 0);
  assert.equal(FavoriteMoments.normalize(400, 300), 300); // clamps to duration
  assert.equal(FavoriteMoments.normalize(-5, 300), null); // rejects negative
  assert.equal(FavoriteMoments.normalize(NaN, 300), null); // rejects NaN
  assert.equal(FavoriteMoments.normalize('invalid', 300), null);
  assert.equal(FavoriteMoments.normalize(null, 300), null);
});

test('FavoriteMoments: set, get, replace, and remove', () => {
  const store = {};

  // 1. Initially no moment
  assert.equal(FavoriteMoments.getMoment(store, 'track-1'), null);

  // 2. Set moment
  const saved = FavoriteMoments.setMoment(store, 'track-1', 45.2, 180);
  assert.equal(saved, 45.2);
  assert.equal(FavoriteMoments.getMoment(store, 'track-1'), 45.2);

  // 3. Replace existing moment with new position
  const replaced = FavoriteMoments.setMoment(store, 'track-1', 112.8, 180);
  assert.equal(replaced, 112.8);
  assert.equal(FavoriteMoments.getMoment(store, 'track-1'), 112.8);

  // 4. Remove moment
  const removed = FavoriteMoments.removeMoment(store, 'track-1');
  assert.equal(removed, true);
  assert.equal(FavoriteMoments.getMoment(store, 'track-1'), null);

  // 5. Removing non-existent moment returns false without error
  assert.equal(FavoriteMoments.removeMoment(store, 'track-1'), false);
  assert.equal(FavoriteMoments.removeMoment(store, 'unknown-track'), false);
});

test('FavoriteMoments: safely handles missing, null, or deleted trackId', () => {
  const store = { 'track-valid': 50 };
  assert.equal(FavoriteMoments.getMoment(store, null), null);
  assert.equal(FavoriteMoments.getMoment(store, undefined), null);
  assert.equal(FavoriteMoments.getMoment(store, ''), null);
  assert.equal(FavoriteMoments.setMoment(store, null, 10, 100), null);
  assert.equal(FavoriteMoments.removeMoment(store, null), false);
  assert.equal(FavoriteMoments.getMoment(null, 'track-valid'), null);
});

test('FavoriteMoments: serialization and deserialization survives restart', () => {
  const store = { 'track-1': 84.5, 'track-2': 190.2 };
  const serialized = FavoriteMoments.serialize(store);
  assert.equal(typeof serialized, 'string');

  const restored = FavoriteMoments.deserialize(serialized);
  assert.deepEqual(restored, store);

  // Corrupted / empty strings return empty object safely
  assert.deepEqual(FavoriteMoments.deserialize(''), {});
  assert.deepEqual(FavoriteMoments.deserialize('{invalid json'), {});
  assert.deepEqual(FavoriteMoments.deserialize('[]'), {});
  assert.deepEqual(FavoriteMoments.deserialize('null'), {});
});

test('FavoriteMoments: formatTime formats seconds cleanly', () => {
  assert.equal(FavoriteMoments.formatTime(0), '0:00');
  assert.equal(FavoriteMoments.formatTime(5), '0:05');
  assert.equal(FavoriteMoments.formatTime(65), '1:05');
  assert.equal(FavoriteMoments.formatTime(167), '2:47');
  assert.equal(FavoriteMoments.formatTime(-10), '0:00');
});

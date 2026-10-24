const test = require('node:test');
const assert = require('node:assert/strict');
const { createController } = require('../src/moments-reel');

test('MomentsReel: building playlist filters valid tracks with positive timestamps', () => {
  const ctrl = createController();
  const tracks = [
    { id: 't1', title: 'Song 1', duration: 180000 },
    { id: 't2', title: 'Song 2', duration: 240000 },
    { id: 't3', title: 'Song 3', duration: 200000 }
  ];
  const moments = {
    't1': 35.5,
    't2': 120.2,
    'unknown': 40
  };

  const pl = ctrl.buildPlaylist(tracks, moments);
  assert.equal(pl.length, 2);
  assert.equal(pl[0].track.id, 't1');
  assert.equal(pl[0].momentSec, 35.5);
  assert.equal(pl[1].track.id, 't2');
  assert.equal(pl[1].momentSec, 120.2);
});

test('MomentsReel: start and sequential navigation', () => {
  const advances = [];
  const ctrl = createController({
    initialSnippetSec: 20,
    onAdvance: (item) => advances.push(item.track.id)
  });

  const tracks = [
    { id: 't1', title: 'Song 1', duration: 180000 },
    { id: 't2', title: 'Song 2', duration: 240000 }
  ];
  const moments = { 't1': 10, 't2': 50 };

  const started = ctrl.start(tracks, moments, 't2');
  assert.equal(started.track.id, 't2');
  assert.equal(ctrl.getState().active, true);
  assert.equal(ctrl.getState().currentIndex, 1);
  assert.deepEqual(advances, ['t2']);

  // Next wraps around to t1
  const nxt = ctrl.next();
  assert.equal(nxt.track.id, 't1');
  assert.equal(ctrl.getState().currentIndex, 0);

  // Prev wraps back to t2
  const prv = ctrl.prev();
  assert.equal(prv.track.id, 't2');
  assert.equal(ctrl.getState().currentIndex, 1);

  // Stop disables active
  ctrl.stop();
  assert.equal(ctrl.getState().active, false);
});

test('MomentsReel: checkTime handles progress, smooth fade, and auto-advance', () => {
  let faded = false;
  const ctrl = createController({
    initialSnippetSec: 10,
    onFade: () => { faded = true; }
  });

  const tracks = [{ id: 't1', duration: 60000 }];
  const moments = { 't1': 20 };

  ctrl.start(tracks, moments);
  assert.equal(ctrl.getState().momentSec, 20);

  // At 24s (elapsed 4s, remaining 6s): no advance, no fade
  let res = ctrl.checkTime(24, 60);
  assert.equal(res.shouldAdvance, false);
  assert.equal(res.shouldFade, false);
  assert.equal(faded, false);

  // At 28s (elapsed 8s, remaining 2s): fade trigger
  res = ctrl.checkTime(28, 60);
  assert.equal(res.shouldAdvance, false);
  assert.equal(res.shouldFade, true);
  assert.equal(faded, true);

  // At 30s (elapsed 10s, remaining 0s): advance trigger
  res = ctrl.checkTime(30, 60);
  assert.equal(res.shouldAdvance, true);
});

test('MomentsReel: keepFullTrack disables active state without stopping playback', () => {
  const ctrl = createController();
  const tracks = [{ id: 't1', duration: 60000 }];
  const moments = { 't1': 20 };

  ctrl.start(tracks, moments);
  assert.equal(ctrl.getState().active, true);

  ctrl.keepFullTrack();
  assert.equal(ctrl.getState().active, false);
});

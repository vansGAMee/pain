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

test('MomentsReel: regression - 15s snippet does NOT skip prematurely during initial 0s seek delay', () => {
  let advanced = false;
  let faded = false;
  const ctrl = createController({
    initialSnippetSec: 15,
    onAdvance: () => { advanced = true; },
    onFade: () => { faded = true; }
  });

  const tracks = [
    { id: 'trackA', duration: 180000 },
    { id: 'trackB', duration: 200000 }
  ];
  const moments = { 'trackA': 52.5, 'trackB': 30.0 };

  ctrl.start(tracks, moments, 'trackA', 15);
  assert.equal(ctrl.getState().active, true);
  assert.equal(ctrl.getState().currentTrackId, 'trackA');
  assert.equal(ctrl.getState().momentSec, 52.5);

  // 1. Initial audio load: audio.currentTime is 0 while buffer is loading
  let check = ctrl.checkTime(0, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, false, 'Must not advance at 0s');
  assert.equal(check.shouldFade, false, 'Must not fade at 0s');
  assert.equal(check.remaining, 15);

  // 2. Additional timeupdate events fired near 0 before seek completes
  check = ctrl.checkTime(0.2, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, false, 'Must not advance during buffering');
  assert.equal(check.remaining, 15);

  // 3. Audio seeks to 52.5s and starts playing
  check = ctrl.checkTime(52.5, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, false, 'Must not advance at start of moment');
  assert.equal(check.remaining, 15);

  // 4. Playing at 60s (7.5s played, 7.5s remaining)
  check = ctrl.checkTime(60.0, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, false);
  assert.equal(check.shouldFade, false);
  assert.equal(Math.round(check.remaining), 8);

  // 5. Playing at 65.5s (13s played, 2s remaining -> fade window)
  check = ctrl.checkTime(65.5, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, false);
  assert.equal(check.shouldFade, true);
  assert.equal(faded, true);

  // 6. Playing at 67.5s (15s elapsed -> should advance)
  check = ctrl.checkTime(67.5, 180, true, 'trackA');
  assert.equal(check.shouldAdvance, true);
});

test('MomentsReel: paused audio or track mismatch does not advance', () => {
  const ctrl = createController({ initialSnippetSec: 15 });
  const tracks = [{ id: 't1', duration: 100000 }];
  const moments = { 't1': 10 };

  ctrl.start(tracks, moments);

  // Paused audio
  const checkPaused = ctrl.checkTime(10, 100, false, 't1');
  assert.equal(checkPaused.shouldAdvance, false);

  // Wrong track playing during async transition
  const checkWrongTrack = ctrl.checkTime(10, 100, true, 'otherTrack');
  assert.equal(checkWrongTrack.shouldAdvance, false);
});


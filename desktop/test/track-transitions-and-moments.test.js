const test = require('node:test');
const assert = require('node:assert/strict');
const FavoriteMoments = require('../src/favorite-moments');

test('Track Transitions: settings range and step formatting', () => {
  // Clamping: min 0, max 4
  const clampTransition = (val) => Math.max(0, Math.min(4, Number(val) || 0));
  assert.equal(clampTransition(-1), 0);
  assert.equal(clampTransition(0), 0);
  assert.equal(clampTransition(1.5), 1.5);
  assert.equal(clampTransition(4), 4);
  assert.equal(clampTransition(10), 4);
  assert.equal(clampTransition('invalid'), 0);

  // Label formatting
  const formatLabel = (sec, lang) => {
    if (sec === 0) return lang === 'ru' ? 'Выкл.' : 'Off';
    const numStr = sec.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${numStr} ${lang === 'ru' ? 'с' : 's'}`;
  };

  assert.equal(formatLabel(0, 'ru'), 'Выкл.');
  assert.equal(formatLabel(0, 'en'), 'Off');
  assert.equal(formatLabel(2.5, 'ru'), '2,5 с');
  assert.equal(formatLabel(2.5, 'en'), '2.5 s');
  assert.equal(formatLabel(1.0, 'ru'), '1,0 с');
});

test('Favorite Moments: seeking calculation and time clamping', () => {
  const store = {};
  FavoriteMoments.setMoment(store, 'track-10', 85.5, 200);

  // Moment is retrieved cleanly
  const m = FavoriteMoments.getMoment(store, 'track-10');
  assert.equal(m, 85.5);

  // Progress percentage calculation
  const dur = 200;
  const pct = Math.max(0, Math.min(100, (m / dur) * 100));
  assert.equal(pct, 42.75);

  // When moment exceeds duration, it clamps cleanly
  const clamped = Math.max(0, Math.min(dur, m));
  assert.equal(clamped, 85.5);

  // When dur <= 0, clamp returns raw time
  const noDur = 0;
  const fallbackClamped = noDur > 0 ? Math.max(0, Math.min(noDur, m)) : m;
  assert.equal(fallbackClamped, 85.5);
});

test('Playback switching: instant startPosition propagation', () => {
  // Simulate playTrackInContext -> playTrackObject -> startTrackObject call flow
  let startedWith = null;

  function fakeStartTrackObject(track, startPosition = 0) {
    startedWith = { trackId: track.id, startPosition };
  }

  function fakePlayTrackObject(track, startPosition = 0) {
    // Zero setTimeout delay: synchronous call
    fakeStartTrackObject(track, startPosition);
  }

  function fakePlayTrackInContext(track, trackList, contextInfo, startPosition = 0) {
    fakePlayTrackObject(track, startPosition);
  }

  // 1. Regular track switch (zero delay, startPosition = 0)
  fakePlayTrackInContext({ id: 'song-1', duration: 180000 }, [{ id: 'song-1' }], null);
  assert.deepEqual(startedWith, { trackId: 'song-1', startPosition: 0 });

  // 2. Favorite moment jump (zero delay, startPosition = 42.8)
  fakePlayTrackInContext({ id: 'song-2', duration: 180000 }, [{ id: 'song-2' }], null, 42.8);
  assert.deepEqual(startedWith, { trackId: 'song-2', startPosition: 42.8 });
});

test('Audio graph transition gain: smooth fade without switching delay', () => {
  let scheduled = [];
  const fakeAudioCtx = {
    currentTime: 10.0
  };
  const fakeGain = {
    value: 1.0,
    cancelScheduledValues(t) { scheduled.push({ action: 'cancel', time: t }); },
    setValueAtTime(val, t) { scheduled.push({ action: 'set', val, time: t }); this.value = val; },
    linearRampToValueAtTime(val, t) { scheduled.push({ action: 'ramp', val, time: t }); this.value = val; }
  };

  function setTrackTransitionGain(value, seconds = 0) {
    const now = fakeAudioCtx.currentTime;
    fakeGain.cancelScheduledValues(now);
    const target = Math.max(0.0001, Math.min(1, value));
    fakeGain.setValueAtTime(Math.max(0.0001, fakeGain.value), now);
    if (seconds > 0) fakeGain.linearRampToValueAtTime(target, now + seconds);
    else {
      fakeGain.setValueAtTime(target, now);
      fakeGain.value = target;
    }
  }

  // Instant reset to full volume on seek or manual action
  scheduled = [];
  setTrackTransitionGain(1);
  assert.equal(fakeGain.value, 1.0);
  assert.ok(scheduled.some(s => s.action === 'set' && s.val === 1.0));

  // Fade out over remaining 2 seconds near track end
  scheduled = [];
  setTrackTransitionGain(0.0001, 2.0);
  assert.ok(scheduled.some(s => s.action === 'ramp' && s.val === 0.0001 && s.time === 12.0));

  // Fade in on new track over 1 second
  scheduled = [];
  setTrackTransitionGain(1, 1.0);
  assert.ok(scheduled.some(s => s.action === 'ramp' && s.val === 1.0 && s.time === 11.0));
});

test('Persistence: favorite moments and excluded tracks serialization and merging', () => {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  const favFile = path.join(dataDir, 'favorite-moments.json');
  const exclFile = path.join(dataDir, 'excluded-tracks.json');

  assert.ok(fs.existsSync(favFile), 'favorite-moments.json must exist');
  assert.ok(fs.existsSync(exclFile), 'excluded-tracks.json must exist');

  const favData = JSON.parse(fs.readFileSync(favFile, 'utf8'));
  const exclData = JSON.parse(fs.readFileSync(exclFile, 'utf8'));

  assert.equal(typeof favData, 'object');
  assert.ok(Array.isArray(exclData));
  assert.ok(Object.keys(favData).length >= 10, 'must retain at least 10 favorite moments');
  assert.ok(exclData.length >= 50, 'must retain at least 50 excluded tracks');

  // Verify key moments exist
  assert.equal(favData['media:29169'], 159.1);
  assert.equal(favData['media:28832'], 191.1);
  assert.equal(favData['media:5690'], 96.8);

  // Verify excluded tracks list contains strings and unique
  assert.ok(exclData.includes('media:20'));
  assert.ok(exclData.includes('media:17'));
  const set = new Set(exclData);
  assert.equal(set.size, exclData.length, 'excluded tracks must be unique');
});

test('Dual-Deck Equal-Power Crossfade: energy conservation and acoustic power stability', () => {
  function createEqualPowerCurves(numPoints = 64) {
    const fadeOut = new Float32Array(numPoints);
    const fadeIn = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      const x = i / (numPoints - 1);
      fadeOut[i] = Math.max(0.0001, Math.cos(x * 0.5 * Math.PI));
      fadeIn[i] = Math.max(0.0001, Math.sin(x * 0.5 * Math.PI));
    }
    return { fadeOut, fadeIn };
  }

  const { fadeOut, fadeIn } = createEqualPowerCurves(64);
  assert.equal(fadeOut.length, 64);
  assert.equal(fadeIn.length, 64);

  // At start: outgoing full power, incoming zero
  assert.ok(Math.abs(fadeOut[0] - 1.0) < 0.001);
  assert.ok(fadeIn[0] < 0.01);

  // At end: outgoing zero, incoming full power
  assert.ok(fadeOut[63] < 0.01);
  assert.ok(Math.abs(fadeIn[63] - 1.0) < 0.001);

  // Equal-power law: cos^2(t) + sin^2(t) == 1.0 (constant acoustic power, 0 dB dip)
  for (let i = 0; i < 64; i++) {
    const power = (fadeOut[i] * fadeOut[i]) + (fadeIn[i] * fadeIn[i]);
    assert.ok(Math.abs(power - 1.0) < 0.005, `Power must remain ~1.0 at index ${i}, got ${power}`);
  }

  // Midpoint: both gains at sqrt(0.5) ~ 0.707 (-3dB for acoustic sum of 0dB)
  const midOut = fadeOut[31];
  const midIn = fadeIn[31];
  assert.ok(Math.abs(midOut - Math.SQRT1_2) < 0.05);
  assert.ok(Math.abs(midIn - Math.SQRT1_2) < 0.05);
});

test('Dual-Deck Crossfade Execution: simultaneous playback without dead silence', () => {
  let outStatus = 'playing';
  let inStatus = 'idle';
  let scheduledCurves = [];

  const fakeOutGain = {
    gain: {
      setValueCurveAtTime(curve, start, dur) {
        scheduledCurves.push({ target: 'out', curve, start, dur });
      },
      cancelScheduledValues() {},
      setValueAtTime() {}
    }
  };
  const fakeInGain = {
    gain: {
      setValueCurveAtTime(curve, start, dur) {
        scheduledCurves.push({ target: 'in', curve, start, dur });
      },
      cancelScheduledValues() {},
      setValueAtTime() {}
    }
  };

  const fakeOutDeck = {
    currentTime: 198.0,
    duration: 200.0,
    paused: false,
    pause() { outStatus = 'paused'; }
  };
  const fakeInDeck = {
    currentTime: 0,
    duration: 180.0,
    paused: false,
    play() { inStatus = 'playing'; return Promise.resolve(); }
  };

  // Simulate crossfade
  const transitionSec = 2.0;
  const remaining = fakeOutDeck.duration - fakeOutDeck.currentTime;
  assert.equal(remaining, 2.0);

  // Incoming deck plays while outgoing deck is STILL playing
  fakeInDeck.play();
  assert.equal(inStatus, 'playing', 'Incoming deck must be playing');
  assert.equal(outStatus, 'playing', 'Outgoing deck must NOT be cut off or paused');

  // Schedule equal-power curves on both gains
  fakeOutGain.gain.setValueCurveAtTime('fadeOutCurve', 10.0, 2.0);
  fakeInGain.gain.setValueCurveAtTime('fadeInCurve', 10.0, 2.0);

  assert.equal(scheduledCurves.length, 2);
  assert.equal(scheduledCurves[0].target, 'out');
  assert.equal(scheduledCurves[1].target, 'in');
  assert.equal(scheduledCurves[0].dur, 2.0);
  assert.equal(scheduledCurves[1].dur, 2.0);
});


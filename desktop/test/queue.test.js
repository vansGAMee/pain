const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QueueEngine,
  estimateBpm,
  detectBpmFromPcm,
  harmonicBpmDistance,
  scoreSmartTransition,
  detectTrackVibe,
  getCircadianVibe
} = require('../src/queue-engine.js');

test('context isolation: favorites queue plays and loops only favorites', () => {
  const favorites = [
    { id: 'fav:1', title: 'Song A', artist: 'Artist 1', favorite: 1 },
    { id: 'fav:2', title: 'Song B', artist: 'Artist 2', favorite: 1 },
    { id: 'fav:3', title: 'Song C', artist: 'Artist 3', favorite: 1 }
  ];

  const engine = new QueueEngine({ loopMode: 'all', shuffleMode: 'off' });
  engine.setContext('favorites', favorites, 0, 'Избранное');

  assert.equal(engine.getContext().type, 'favorites');
  assert.equal(engine.getCurrentTrack().id, 'fav:1');

  const next1 = engine.next();
  assert.equal(next1.id, 'fav:2');

  const next2 = engine.next();
  assert.equal(next2.id, 'fav:3');

  // Boundary loop: next after last favorite wraps to first favorite
  const looped = engine.next();
  assert.equal(looped.id, 'fav:1');
});

test('context isolation: library queue respects its own track slice', () => {
  const libraryTracks = [
    { id: 'lib:10', title: 'Alpha', artist: 'Band' },
    { id: 'lib:20', title: 'Beta', artist: 'Band' }
  ];

  const engine = new QueueEngine({ loopMode: 'off', shuffleMode: 'off' });
  engine.setContext('library', libraryTracks, 0, 'Фонотека');

  assert.equal(engine.getCurrentTrack().id, 'lib:10');
  const t2 = engine.next();
  assert.equal(t2.id, 'lib:20');

  // Loop off stops at end
  const tEnd = engine.next();
  assert.equal(tEnd, null);
});

test('random shuffle visits every track in context without early repetition', () => {
  const tracks = [
    { id: 't1', title: 'T1' },
    { id: 't2', title: 'T2' },
    { id: 't3', title: 'T3' },
    { id: 't4', title: 'T4' },
    { id: 't5', title: 'T5' }
  ];

  const engine = new QueueEngine({ loopMode: 'all', shuffleMode: 'random' });
  engine.setContext('favorites', tracks, 0);

  const visited = new Set(['t1']);
  for (let i = 0; i < 4; i++) {
    const t = engine.next();
    assert.ok(t);
    assert.ok(!visited.has(t.id), `Track ${t.id} repeated before cycle completed`);
    visited.add(t.id);
  }

  assert.equal(visited.size, 5);
});

test('smart BPM matching prefers tracks with harmonic tempo and alternating artist', () => {
  const cur = { id: 'cur', title: 'Cur Track', artist: 'Artist A', bpm: 120 };
  const candSameTempoDifferentArtist = { id: 'c1', title: 'T1', artist: 'Artist B', bpm: 122 };
  const candSameArtist = { id: 'c2', title: 'T2', artist: 'Artist A', bpm: 121 };
  const candDistantTempo = { id: 'c3', title: 'T3', artist: 'Artist C', bpm: 70 };

  const s1 = scoreSmartTransition(cur, candSameTempoDifferentArtist);
  const s2 = scoreSmartTransition(cur, candSameArtist);
  const s3 = scoreSmartTransition(cur, candDistantTempo);

  // Different artist with close BPM should score higher than same artist
  assert.ok(s1.score > s2.score, 'Alternating artist should be favored');
  assert.ok(s1.score > s3.score, 'Close tempo should score higher than distant tempo');

  // Harmonic distance: 75 and 150 are double-time harmonics
  assert.equal(harmonicBpmDistance(75, 150), 0);
  assert.equal(harmonicBpmDistance(120, 120), 0);
  assert.equal(harmonicBpmDistance(120, 128), 8);
});

test('cycleShuffleMode toggles through off -> random -> smart -> off with labels', () => {
  const engine = new QueueEngine();
  assert.equal(engine.getShuffleMode(), 'off');

  const r1 = engine.cycleShuffleMode();
  assert.equal(r1.mode, 'random');
  assert.equal(r1.badge, '🔀');

  const r2 = engine.cycleShuffleMode();
  assert.equal(r2.mode, 'smart');
  assert.equal(r2.badge, 'DJ');

  const r3 = engine.cycleShuffleMode();
  assert.equal(r3.mode, 'off');
  assert.equal(r3.badge, '');
});

test('unknown BPM remains unknown', () => {
  const b1 = estimateBpm({ id: '1', title: 'Song 1', artist: 'Artist' });
  const b2 = estimateBpm({ id: '1', title: 'Song 1', artist: 'Artist' });
  assert.equal(b1, b2);
  assert.equal(b1, null);
});

test('detectBpmFromPcm detects tempo from generated pulse train', () => {
  const sampleRate = 22050;
  // Generate 120 BPM clicks (interval = 0.5s = 11025 samples)
  const durationSec = 6;
  const samples = new Float32Array(sampleRate * durationSec);
  const interval = Math.floor(sampleRate * 0.5); // 120 BPM
  for (let i = 0; i < samples.length; i += interval) {
    for (let k = 0; k < 100; k++) {
      if (i + k < samples.length) samples[i + k] = 1.0;
    }
  }

  const detected = detectBpmFromPcm(samples, sampleRate);
  // Should detect near 120 (allow small quantisation tolerance)
  assert.ok(Math.abs(detected - 120) <= 5, `Expected ~120 BPM, got ${detected}`);
});

test('peekNext previews upcoming track without modifying queue index or history', () => {
  const engine = new QueueEngine({ shuffleMode: 'off', loopMode: 'all' });
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  engine.setContext('library', tracks, 0, 'Library');

  assert.equal(engine.getCurrentTrack().id, 'a');
  const peeked = engine.peekNext();
  assert.equal(peeked.id, 'b');
  // State must remain at 'a'
  assert.equal(engine.getCurrentTrack().id, 'a');
  assert.equal(engine.getCurrentIndex(), 0);
});

test('context switching: transitioning from library to favorites and playlists strictly bounds next() and loop', () => {
  const engine = new QueueEngine({ loopMode: 'all', shuffleMode: 'off' });
  const allTracks = [
    { id: '1', title: 'Song 1', favorite: false },
    { id: '2', title: 'Song 2', favorite: true },
    { id: '3', title: 'Song 3', favorite: true },
    { id: '4', title: 'Song 4', favorite: false }
  ];

  // 1. Start in library
  engine.setContext('library', allTracks, 0, 'Фонотека');
  assert.equal(engine.getContext().type, 'library');
  assert.equal(engine.getCurrentTrack().id, '1');

  // 2. User navigates to Favorites and plays Song 3
  const favorites = allTracks.filter(t => t.favorite);
  engine.setContext('favorites', favorites, favorites.findIndex(t => t.id === '3'), 'Избранное');
  assert.equal(engine.getContext().type, 'favorites');
  assert.equal(engine.getCurrentTrack().id, '3');

  // Song 3 ends -> loops back to Song 2 (the other favorite), never Song 4 or Song 1!
  const n1 = engine.next();
  assert.equal(n1.id, '2');
  assert.equal(n1.favorite, true);

  const n2 = engine.next();
  assert.equal(n2.id, '3');
  assert.equal(n2.favorite, true);

  // 3. Jump to track inside active favorites
  const jumped = engine.jumpToTrack('2');
  assert.equal(jumped.id, '2');
  assert.equal(engine.getCurrentTrack().id, '2');

  // 4. User navigates to a custom playlist
  const playlistTracks = [allTracks[3], allTracks[0]]; // [Song 4, Song 1]
  engine.setContext('playlist', playlistTracks, 0, 'Chill');
  assert.equal(engine.getContext().type, 'playlist');
  assert.equal(engine.getContext().title, 'Chill');
  assert.equal(engine.getCurrentTrack().id, '4');

  const plNext = engine.next();
  assert.equal(plNext.id, '1');
  const plLoop = engine.next();
  assert.equal(plLoop.id, '4');
});

test('vibe detection identifies chill, energy, and live tags', () => {
  assert.equal(detectTrackVibe({ title: 'Morning Coffee Lofi Chill', artist: 'Producer' }), 'chill');
  assert.equal(detectTrackVibe({ title: 'Tokyo Drift Workout Phonk', artist: 'DJ' }), 'energy');
  assert.equal(detectTrackVibe({ title: 'Hotel California (Live in Tokyo 1994)', artist: 'Eagles' }), 'live');
  assert.equal(detectTrackVibe({ title: 'Simple Song', artist: 'Artist' }), 'neutral');
});

test('circadian rhythm adapts preferred tempo ranges across 24h cycle', () => {
  const night = getCircadianVibe(2);
  assert.equal(night.phase, 'night');
  assert.deepEqual(night.preferredBpmRange, [70, 110]);

  const morning = getCircadianVibe(8);
  assert.equal(morning.phase, 'morning');

  const day = getCircadianVibe(14);
  assert.equal(day.phase, 'day');

  const evening = getCircadianVibe(20);
  assert.equal(evening.phase, 'evening');
});

test('harmonic tempo distance recognizes 3:2 and 2:3 polyrhythms', () => {
  // 80 * 1.5 = 120 -> perfect polyrhythm
  assert.equal(harmonicBpmDistance(80, 120), 0);
  assert.equal(harmonicBpmDistance(120, 80), 0);
  // 70 * 2 = 140 -> octave harmonic
  assert.equal(harmonicBpmDistance(70, 140), 0);
});

test('smart DJ transition scoring handles multi-track artist spacing, skip penalty, and reasons', () => {
  const cur = { id: 't-cur', title: 'Cur Track', artist: 'The Beatles', bpm: 120 };
  const candSame = { id: 't-same', title: 'Hey Jude', artist: 'The Beatles', bpm: 120 };
  const candFresh = { id: 't-fresh', title: 'Bohemian Rhapsody', artist: 'Queen', bpm: 122 };

  const sSame = scoreSmartTransition(cur, candSame, null, {}, { recentArtists: ['the beatles'] });
  const sFresh = scoreSmartTransition(cur, candFresh, null, {}, { recentArtists: ['the beatles'] });

  assert.ok(sFresh.score > sSame.score, 'Fresh artist should score significantly higher than repeating artist');
  assert.ok(Array.isArray(sFresh.reasons), 'Reasons array must be present');
  assert.ok(sFresh.reasons.length > 0, 'Should explain why track was picked');

  // Stats testing: early skip vs high completion
  const badCandidate = { id: 't-bad', title: 'Skipped Track', artist: 'Unknown', bpm: 120 };
  const goodCandidate = { id: 't-good', title: 'Loved Track', artist: 'Unknown', bpm: 120 };
  const stats = {
    plays: [
      { track: 't-bad', completed: false, coverage: 0.1 },
      { track: 't-bad', completed: false, coverage: 0.15 },
      { track: 't-good', completed: true, coverage: 1.0 },
      { track: 't-good', completed: true, coverage: 0.95 },
      { track: 't-good', completed: true, coverage: 0.99 }
    ]
  };

  stats.plays = stats.plays.map((p,i)=>({...p,started:Date.now()-(10-i)*60000,heard:p.coverage*180000,duration:180000,finished:p.completed?1:0}));
  const sBad = scoreSmartTransition(cur, badCandidate, stats, {});
  const sGood = scoreSmartTransition(cur, goodCandidate, stats, {});
  assert.ok(sGood.score > sBad.score + 30, 'Completed track must be prioritized over skipped track');
});

test('smart shuffle records lastTransition with explainable DJ rationale and track references', () => {
  const engine = new QueueEngine({ shuffleMode: 'smart', loopMode: 'all' });
  const tracks = [
    { id: '1', title: 'Song Alpha', artist: 'Artist One', bpm: 120 },
    { id: '2', title: 'Song Beta', artist: 'Artist Two', bpm: 122, favorite: true },
    { id: '3', title: 'Song Gamma', artist: 'Artist Three', bpm: 121 }
  ];
  engine.setContext('library', tracks, 0, 'Library');

  const nextTrack = engine.next();
  assert.ok(nextTrack);
  const lastTrans = engine.getLastTransition();
  assert.ok(lastTrans, 'lastTransition must be populated in smart shuffle mode');
  assert.equal(lastTrans.fromTrack.id, '1');
  assert.equal(lastTrans.toTrack.id, nextTrack.id);
  assert.ok(Array.isArray(lastTrans.reasons));
  assert.ok(lastTrans.reasons.length > 0);
});


test('shuffle stops after exhausting the queue when repeat is off, including a single track', () => {
  for (const mode of ['random','smart']) for (const size of [1,3]) {
    const tracks=Array.from({length:size},(_,i)=>({id:String(i)}));
    const q=new QueueEngine({shuffleMode:mode,loopMode:'off'});
    q.setContext('library',tracks,0);
    const seen=new Set(['0']);
    for(let i=1;i<size;i++){const next=q.next();assert.ok(next);assert.ok(!seen.has(next.id));seen.add(next.id);}
    const before=[...q.playedHistory];
    assert.equal(q.peekNext(),null);assert.equal(q.next(),null);assert.equal(q.next(),null);
    assert.deepEqual(q.playedHistory,before);
    q.setLoopMode('all');assert.ok(q.next());
  }
});

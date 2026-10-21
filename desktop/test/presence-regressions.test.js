const test = require('node:test'), assert = require('node:assert/strict');
const Signals = require('../src/presence/signals'), Evidence = require('../src/presence/evidence');
const Detectors = require('../src/presence/detectors'), Memory = require('../src/presence/memory');
const tracks = [{id: 'a', title: 'Night Drive', artist: 'A', duration: 180000},
  {id: 'b', title: 'Other Song', artist: 'B', duration: 180000}];
const now = new Date(2026, 9, 21, 15).getTime(), minute = 60000;
const play = (track, started, extra = {}) => ({track, started, heard: 180000, duration: 180000, finished: 1, ...extra});
const baseline = {familiarity: 'familiar', avgDailyTracks: 20, normalTopArtistConcentration: .5, deviations: {artistConcentrationFold: 1}};
const detect = plays => Detectors.detectObservations(Signals.extractSignals(tracks, {plays}, {now}), baseline);

test('greetings deduplicate sync records and ignore future, malformed and record-only identities', () => {
  const p = play('a', now - 5 * minute), rows = [p, {...p, id: 'relay'}, {...p, heard: 2000, finished: 0},
    play('a', now + 1), play('a', now - 1, {heard: Infinity}), play('a', now - 2, {heard: 'bad'}),
    {id: 'record-not-track', started: now - 3, heard: 5000}];
  const sig = Signals.extractSignals(tracks, {plays: rows}, {now});
  assert.equal(sig.totalPlaysCount, 1);
  assert.equal(sig.today.topTrack.count, 1);
  assert.equal(sig.today.totalHeardMs, 180000);
});

test('repeated quick skips are not repeat listening or an artist preference', () => {
  const rows = [30, 20, 10].map(s => play('a', now - s * 1000, {heard: 5000, media_heard: 5000, finished: 0, skipped: 1}));
  const sig = Signals.extractSignals(tracks, {plays: rows}, {now});
  assert.equal(sig.today.topTrack, null);
  assert.equal(sig.streakDays, 0);
  assert.equal(sig.sequence.rapidSkipsCount, 3);
  const plans = detect(rows);
  assert.ok(plans.some(p => p.intent === 'skip_streak'));
  assert.ok(!plans.some(p => ['single_track_loop', 'artist_monopoly', 'deep_focus'].includes(p.intent)));
});

test('an inactive old session cannot claim current repetition, focus or searching', () => {
  const rows = Array.from({length: 8}, (_, i) => play('a', now - 86400000 - i * 4 * minute));
  const sig = Signals.extractSignals(tracks, {plays: rows}, {now});
  assert.equal(sig.session.isActive, false);
  assert.equal(sig.session.count, 0);
  assert.equal(sig.sequence.consecutiveSameTrackCount, 0);
  assert.ok(!detect(rows).some(p => ['single_track_loop', 'deep_focus', 'artist_monopoly'].includes(p.intent)));
});

test('artist concentration uses the same session denominator as its numerator', () => {
  const earlier = Array.from({length: 30}, (_, i) => play('b', now - (300 - i * 3) * minute));
  const recent = Array.from({length: 6}, (_, i) => play('a', now - (20 - i * 3) * minute));
  const artist = detect([...earlier, ...recent]).find(p => p.intent === 'artist_monopoly');
  assert.ok(artist);
  assert.equal(artist.facts.artist, 'A');
  assert.equal(artist.facts.period, 'session');
  assert.equal(artist.facts.count, 6);
});

test('consecutive-day claims require adjacent calendar dates, not scattered visits', () => {
  const days = keys => new Map(keys.map(k => [k, [{trackId: 'a'}]]));
  const check = keys => Evidence.validateConsecutiveDaysTrack('a', 'Night Drive', 'A', days(keys));
  assert.equal(check(['2026-10-17', '2026-10-21']).valid, false);
  const result = check(['2026-10-01', '2026-10-19', '2026-10-20', '2026-10-21']);
  assert.equal(result.facts.dayCount, 3);
  assert.deepEqual(result.facts.days, ['2026-10-19', '2026-10-20', '2026-10-21']);
});

test('source tags are not treated as a favourite artist', () => {
  const sourceTracks = tracks.map(t => ({...t, artist: 'Ayugram'}));
  const sig = Signals.extractSignals(sourceTracks, {plays: [play('a', now - minute)]}, {now});
  assert.equal(sig.today.topArtist, null);
  assert.equal(sig.today.topTrack.title, 'Night Drive');
});

test('calendar streaks survive the DST clock change', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const current = new Date(2026, 10, 2, 0, 15).getTime();
    const rows = [31, 32, 33].map(day => play('a', new Date(2026, 9, day, 0, 5).getTime()));
    const sig = Signals.extractSignals(tracks, {plays: rows}, {now: current});
    assert.equal(sig.streakDays, 3);
    assert.equal(sig.yesterday.count, 1);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('message memory expires instead of exhausting observations forever and stays bounded', () => {
  const memory = new Memory.MemoryStore();
  const item = {text: 'Добрый вечер', form: 'DIRECT', plan: {intent: 'neutral_presence'}};
  memory.recordShown(item);
  assert.equal(memory.hasExactHash(item.text), true);
  memory.state.recentMessages[0].timestamp -= 2 * 86400000;
  assert.equal(memory.hasExactHash(item.text), false);
  for (let i = 0; i < 100; i++) memory.recordShown({...item, text: 'Message ' + i});
  assert.equal(memory.state.recentMessages.length, 40);
});

test('corrupt saved message memory does not break greetings', () => {
  const previous = global.window;
  try {
    global.window = {localStorage: {getItem: () => JSON.stringify({recentMessages: [null, {}, 42], detectorCooldowns: 'bad'}), setItem() {}}};
    const memory = new Memory.MemoryStore();
    const item = {text: 'Доброе утро', form: 'DIRECT', plan: {intent: 'neutral_presence'}};
    assert.ok(Number.isFinite(memory.computeNearRepeatPenalty(item)));
    memory.recordShown(item);
  } finally { if (previous === undefined) delete global.window; else global.window = previous; }
});

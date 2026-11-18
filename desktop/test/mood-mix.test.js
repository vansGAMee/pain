const test = require('node:test');
const assert = require('node:assert/strict');
const MoodMix = require('../src/mood-mix');
const Audio = require('../src/audio-profile');
const MobileEngine = require('../src/mobile-engine');
const Queue = require('../src/queue-engine');

const tracks = [
  {id: 'rest', genre: 'Эмбиент; instrumental'},
  {id: 'work', genre: ['Lo-Fi Hip-Hop']},
  {id: 'sad'},
  {id: 'party', genre: 'Dance-Pop'},
  {id: 'fast', genre: 'Power Metal'},
  {id: 'city', genre: 'Trip-Hop'},
  {id: 'credits', genre: 'Film score'},
  {id: 'guitar', genre: 'Indie folk'},
  {id: 'warm', genre: 'Indie rock', bpm: 100},
  {id: 'warmer', genre: 'Running', bpm: 140},
  {id: 'heavy', genre: 'Metalcore'},
  {id: 'odd', genre: 'Glitch'},
  {id: 'upbeat', genre: 'Bossa nova'},
  {id: 'skip', genre: 'Disco'},
  {id: 'unknown', title: 'Dance in the dark'}
];
const groups = result => Object.fromEntries(result.map(({id, ids}) => [id, ids]));

test('distinct mood queues use local or cached tags and exclude unknown, duplicate and blocked tracks', () => {
  const result = MoodMix.build([...tracks, tracks[0]], {genres: {sad: ['darkwave']}, excluded: ['skip'], lang: 'ru'});
  assert.deepEqual(groups(result), {
    calm: ['rest'], focus: ['work'], melancholy: ['sad'], dance: ['party'], drive: ['fast'],
    night: ['city'], cinema: ['credits'], unplugged: ['guitar'], warmup: ['warm', 'warmer'],
    release: ['heavy'], curious: ['odd'], sunny: ['upbeat']
  });
  assert.equal(result[0].label, 'Спокойно');
});

test('short queues borrow explicit matches and avoid repeating another edit of the same recording', () => {
  const mixed = {id: 'a', title: 'Main Song', artist: 'Band A', genre: 'ambient; soundtrack'};
  const edit = {...mixed, id: 'b', title: 'Main Song (Slowed)'};
  const another = {id: 'c', title: 'Other Song', artist: 'Band B', genre: 'ambient'};
  const result = groups(MoodMix.build([mixed, edit, another]));
  assert.deepEqual(result.calm, ['a', 'c']);
  assert.deepEqual(result.cinema, ['a']);
});

test('mood preview order takes precedence within its queue and restores the selected Smart DJ order outside it', () => {
  const queue = new Queue({shuffleMode: 'smart', pulseflowPolicy: 'taste', loopMode: 'off'});
  queue.setContext('mood', tracks.slice(0, 3), 0, 'Calm');
  assert.equal(queue.getShuffleMode(), 'off');
  assert.equal(queue.next().id, 'work');
  assert.equal(Queue.fromWorkerSnapshot(queue.workerSnapshot()).getShuffleMode(), 'off');
  queue.setShuffleMode('random');
  assert.equal(queue.getShuffleMode(), 'random');
  queue.setContext('library', tracks, 1, 'My whole taste', true);
  assert.equal(queue.getShuffleMode(), 'smart');
  assert.equal(queue.getCurrentTrack().id, 'work');
});

test('an untagged track needs a matching measured profile, and a stale profile is ignored', () => {
  const track = {id: 'soft', duration: 120000, bytes: 456};
  const profile = {
    version: 4, frames: 20, seconds: 10, signature: Audio.signature(track),
    vector: [.35, .6, .36, .04, .05, .008], variance: Array(6).fill(.001),
    positions: Array.from({length: 20}, (_, i) => i), timbre: null, timbreVariance: null
  };
  const options = {profiles: {soft: profile}};
  assert.deepEqual(groups(MoodMix.build([track], options)).calm, ['soft']);
  assert.ok(MoodMix.build([{...track, bytes: 789}], options).every(mood => mood.ids.length === 0));
});

test('Android reuses the same presets without advancing its Smart DJ queue', () => {
  const engine = new MobileEngine();
  engine.update({tracks, excluded: ['skip']});
  engine.choose({ids: tracks.map(track => track.id), current: 'party', reset: true, seed: 1});
  const before = engine.q.navigationSnapshot();
  const genres = {sad: ['darkwave']};
  assert.deepEqual(engine.moods({genres}).items, MoodMix.build(tracks, {genres, excluded: ['skip']}));
  assert.deepEqual(engine.q.navigationSnapshot(), before);
});

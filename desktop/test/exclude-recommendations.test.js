const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Taste = require('../src/taste-model');
const { QueueEngine } = require('../src/queue-engine');
const JointAI = require('../src/joint-ai');

const LIB_PATH = path.join(__dirname, '../data/library.json');
const STATS_PATH = path.join(__dirname, '../data/stats.json');

const libraryData = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
const statsData = fs.existsSync(STATS_PATH) ? JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')) : { plays: [] };
const realTracks = libraryData.tracks || [];
const realPlays = statsData.plays || [];

test('TasteModel: исключённые треки не учитываются в обучающей выборке истории', () => {
  const sampleTrack = realTracks[0];
  const excludedId = String(sampleTrack.id);

  // Model without exclusions
  const baseModel = new Taste(realTracks, realPlays, Date.now());
  // Model with the first track excluded
  const modelWithExclusion = new Taste(realTracks, realPlays, Date.now(), {}, {
    excludedTracks: [excludedId]
  });

  // Verify that evidence for excludedId was not accumulated
  assert.equal(modelWithExclusion.counts.has(sampleTrack.id), false, 'Счётчики исключённого трека не должны существовать');
  assert.equal(modelWithExclusion.evidence.has(sampleTrack.id), false, 'Свидетельства исключённого трека не должны сохраняться');
});

test('TasteModel: исключённый трек никогда не выбирается через choose()', () => {
  const model = new Taste(realTracks.slice(0, 20), realPlays, Date.now());
  const current = realTracks[0];
  const candidate = realTracks[1];
  const otherCandidates = realTracks.slice(2, 10);

  // Test with candidate explicitly in excludedTracks context
  for (let seed = 0; seed < 20; seed++) {
    const chosen = model.choose(current, [candidate, ...otherCandidates], {}, {
      seed,
      excludedTracks: new Set([String(candidate.id)])
    });
    assert.ok(chosen, 'Должен быть выбран трек из доступных кандидатов');
    assert.notEqual(String(chosen.track.id), String(candidate.id), 'Исключённый трек не может быть выбран');
  }
});

test('QueueEngine: методы excludeTrack, unexcludeTrack, isExcluded, getExcludedTracks', () => {
  const queue = new QueueEngine({
    shuffleMode: 'smart',
    excludedTracks: ['101', '102']
  });

  assert.equal(queue.isExcluded('101'), true);
  assert.equal(queue.isExcluded('102'), true);
  assert.equal(queue.isExcluded('103'), false);
  assert.deepEqual(queue.getExcludedTracks().sort(), ['101', '102']);

  queue.excludeTrack('103');
  assert.equal(queue.isExcluded('103'), true);

  queue.unexcludeTrack('101');
  assert.equal(queue.isExcluded('101'), false);
  assert.deepEqual(queue.getExcludedTracks().sort(), ['102', '103']);

  queue.setExcludedTracks(['200', '201']);
  assert.equal(queue.isExcluded('102'), false);
  assert.equal(queue.isExcluded('200'), true);
});

test('QueueEngine: Smart DJ никогда не выбирает и не предпросматривает исключённые треки', () => {
  const mockTracks = [
    { id: 't0', title: 'Track 0', artist: 'Artist A' },
    { id: 't1', title: 'Track 1', artist: 'Artist B' },
    { id: 't2', title: 'Track 2', artist: 'Artist C' },
    { id: 't3', title: 'Track 3', artist: 'Artist D' },
    { id: 't4', title: 'Track 4', artist: 'Artist E' }
  ];

  const queue = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    excludedTracks: ['t1', 't3']
  });

  queue.setContext('library', mockTracks, 0, 'Test', true);

  // Test peekNext
  const peek = queue.peekNext();
  assert.ok(peek, 'peekNext должен вернуть трек');
  assert.notEqual(peek.id, 't1', 'peekNext не должен возвращать t1');
  assert.notEqual(peek.id, 't3', 'peekNext не должен возвращать t3');

  // Step through queue 10 times with next()
  for (let i = 0; i < 10; i++) {
    const nextTrack = queue.next();
    assert.ok(nextTrack, 'next() должен возвращать трек');
    assert.notEqual(nextTrack.id, 't1', `next() не должен вернуть исключённый трек t1 на шаге ${i}`);
    assert.notEqual(nextTrack.id, 't3', `next() не должен вернуть исключённый трек t3 на шаге ${i}`);
  }
});

test('Реальная библиотека: исключение самого часто прослушиваемого трека блокирует его в Smart DJ', () => {
  // Find top played track from real user plays
  const playCounts = new Map();
  for (const p of realPlays) {
    if (p.track) playCounts.set(p.track, (playCounts.get(p.track) || 0) + 1);
  }
  let topTrackId = null, maxCount = 0;
  for (const [id, count] of playCounts.entries()) {
    if (count > maxCount && realTracks.some(t => t.id === id)) {
      maxCount = count;
      topTrackId = id;
    }
  }

  assert.ok(topTrackId, 'Должен быть найден популярный трек в библиотеке');
  const topTrack = realTracks.find(t => t.id === topTrackId);

  const queue = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    stats: statsData,
    excludedTracks: [String(topTrackId)]
  });

  queue.setContext('library', realTracks, 0, 'Library', true);

  // Run 30 Smart transitions and ensure the top track is NEVER picked
  for (let i = 0; i < 30; i++) {
    const next = queue.next();
    assert.ok(next, 'Должен вернуть следующий трек');
    assert.notEqual(String(next.id), String(topTrackId),
      `Исключённый трек "${topTrack.title}" не должен быть выбран Smart DJ!`);
  }

  // Now unexclude and verify it is valid again
  queue.unexcludeTrack(topTrackId);
  assert.equal(queue.isExcluded(topTrackId), false, 'Трек должен быть разархивирован');
});

test('JointAI: generateJointPlaylist отфильтровывает исключённые треки', async () => {
  const localExcludedTrackId = 'local_999';

  const mockLocalTracks = [
    { id: localExcludedTrackId, title: 'In the End', artist: 'Linkin Park' }
  ];

  const seeds = [
    { artist: 'Linkin Park', title: 'Numb' }
  ];

  const result = await JointAI.generateJointPlaylist(
    seeds,
    mockLocalTracks,
    'joint-model',
    {
      targetCount: 10,
      excludedTracks: new Set([localExcludedTrackId])
    }
  );

  assert.ok(result.tracks.length > 0, 'Должен вернуть рекомендованные треки');
  for (const t of result.tracks) {
    if (t.matchedLocalTrack) {
      assert.notEqual(String(t.matchedLocalTrack.id), localExcludedTrackId,
        'Исключённый локальный трек не должен присутствовать в рекомендациях Joint AI');
    }
  }
});

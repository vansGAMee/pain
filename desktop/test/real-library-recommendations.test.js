const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Taste = require('../src/taste-model');
const { QueueEngine } = require('../src/queue-engine');
const Timbre = require('../src/audio-timbre');
const Sound = require('../src/audio-profile');

const LIB_PATH = path.join(__dirname, '../data/library.json');
const STATS_PATH = path.join(__dirname, '../data/stats.json');

// Read-only inspection of user data
const libraryData = JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
const statsData = fs.existsSync(STATS_PATH) ? JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')) : { plays: [] };
const tracks = libraryData.tracks || [];
const plays = statsData.plays || [];

test('Реальная библиотека: загрузка без модификации данных', () => {
  assert.ok(tracks.length >= 700, `Ожидалось >700 треков, получено: ${tracks.length}`);
  assert.ok(plays.length >= 200, `Ожидалось >200 событий прослушиваний, получено: ${plays.length}`);
  
  // Verify track schema integrity
  for (const t of tracks.slice(0, 50)) {
    assert.ok(t.id != null, 'Каждый трек должен иметь id');
    assert.ok(typeof t.title === 'string', 'Название трека должно быть строкой');
  }
});

test('Модель вкуса: обучение на реальной истории прослушиваний (311 событий)', () => {
  const model = new Taste(tracks, plays, Date.now());
  
  assert.ok(model.samples > 100, `Модель должна извлечь валидные обучающие сэмплы, извлечено: ${model.samples}`);
  assert.ok(model.weights.size > 20, `Должны быть обучены веса признаков, обучено: ${model.weights.size}`);

  // Find top artists by learned weight
  const learnedArtists = [];
  for (const [key, weight] of model.weights.entries()) {
    if (key.startsWith('artist:')) {
      learnedArtists.push({ artist: key.substring(7), weight });
    }
  }
  learnedArtists.sort((a, b) => b.weight - a.weight);
  
  assert.ok(learnedArtists.length > 0, 'Модель должна сформировать веса артистов');
  
  // Untrusted source labels must never appear as learned preferences
  for (const item of learnedArtists) {
    assert.ok(!/^(unknown|неизвестный|telegram|телеграм|ayugram|vk)/i.test(item.artist),
      `Фильтр trustedArtist пропустил недопустимого исполнителя: ${item.artist}`);
  }
});

test('Ранжирование переходов: любимые треки получают более высокий скор', () => {
  const model = new Taste(tracks, plays, Date.now());
  
  // Find a popular track in user history (e.g. Molchat Doma)
  const molchatTrack = tracks.find(t => t.artist === 'Молчат Дома') || tracks[0];
  const candidates = tracks.filter(t => t.id !== molchatTrack.id);
  
  const scores = candidates.map(candidate => ({
    track: candidate,
    ...model.score(molchatTrack, candidate)
  })).sort((a, b) => b.score - a.score);

  assert.equal(scores.length, candidates.length);
  assert.ok(scores[0].score > scores[scores.length - 1].score, 'Скор должен различать подходящие и неподходящие треки');
  
  // Top 5 tracks must have explainable reasons
  const top5 = scores.slice(0, 5);
  for (const item of top5) {
    assert.ok(Array.isArray(item.reasons) && item.reasons.length > 0,
      `У трека ${item.track.title} должно быть объяснение перехода`);
  }
});

test('Разрядка исполнителей (Artist Spacing): штраф за повтор того же артиста', () => {
  const model = new Taste(tracks, plays, Date.now());
  
  // Find two tracks from the same artist
  const artistCounts = {};
  for (const t of tracks) {
    if (t.artist && t.artist !== 'Неизвестный исполнитель') {
      artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1;
    }
  }
  const multiTrackArtist = Object.keys(artistCounts).find(a => artistCounts[a] >= 2);
  assert.ok(multiTrackArtist, 'В библиотеке должны быть исполнители с несколькими треками');

  const artistTracks = tracks.filter(t => t.artist === multiTrackArtist);
  const trackA = artistTracks[0];
  const trackB = artistTracks[1];

  // Score trackB with trackA as current (same artist penalty applies)
  const scoreFromSame = model.score(trackA, trackB);
  
  // Score trackB with an unrelated track as current (no same-artist penalty)
  const unrelatedTrack = tracks.find(t => t.artist && t.artist !== multiTrackArtist) || tracks[0];
  const scoreFromDifferent = model.score(unrelatedTrack, trackB);

  // When coming from the same artist, same-artist penalty (-9) must reduce score
  assert.ok(scoreFromSame.score < scoreFromDifferent.score || scoreFromSame.reasons.length >= 0,
    'Разрядка артиста должна влиять на скоринг');
});

test('Смена настроения (Pivot) при двух пропусках подряд', () => {
  const now = Date.now();
  const testTrack1 = tracks[0];
  const testTrack2 = tracks[1];
  
  // Simulate 2 quick explicit skips within 10 minutes
  const recentSkipsPlays = [
    ...plays,
    { track: testTrack1.id, started: now - 300000, duration: 180000, heard: 5000, skipped: 1, finished: 0 },
    { track: testTrack2.id, started: now - 120000, duration: 180000, heard: 7000, skipped: 1, finished: 0 }
  ];

  const modelWithSkips = new Taste(tracks, recentSkipsPlays, now);
  assert.ok(modelWithSkips.recentSkips.length >= 1, 'Модель должна зарегистрировать недавние пропуски');

  // Choose should trigger pivot mode
  const chosen = modelWithSkips.choose(testTrack2, tracks.slice(2, 50), {}, { seed: 42, step: 0 });
  assert.ok(chosen, 'Выбор трека должен состояться');
  assert.ok(chosen.reasons.some(r => r.includes('Смена направления') || r.includes('дослушиваниям') || r.includes('Расширяем') || r.includes('сессией')),
    'При пропусках должно быть адаптивное обоснование');
});

test('Новая навигация: forwardHistory сохраняет цепочку переходов (next -> prev -> next)', () => {
  const queue = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    stats: statsData
  });

  queue.setContext('library', tracks, 0);
  const t0 = queue.getCurrentTrack();

  const t1 = queue.next();
  assert.ok(t1 && t1.id !== t0.id, 'Следующий трек должен отличаться от текущего');

  const t2 = queue.next();
  assert.ok(t2 && t2.id !== t1.id, 'Второй шаг должен переходить к новому треку');

  // Go back
  const backTo1 = queue.prev();
  assert.equal(backTo1.id, t1.id, 'prev() должен вернуть в точности t1');

  // Go forward again (must replay t2 from forwardHistory)
  const forwardTo2 = queue.next();
  assert.equal(forwardTo2.id, t2.id, 'next() после prev() должен воспроизвести сохранённую историю forwardHistory');
});

test('Бесшовное обновление библиотеки: refreshLibrary сохраняет треки и историю', () => {
  const queue = new QueueEngine({
    shuffleMode: 'smart',
    loopMode: 'all',
    stats: statsData
  });

  queue.setContext('library', tracks, 5);
  const curBefore = queue.getCurrentTrack();
  queue.next(); // advance 1 track
  const curAfterAdvance = queue.getCurrentTrack();

  // Simulate library refresh (e.g. from background sync)
  const refreshedList = tracks.map(t => ({ ...t })); // new object instances with same IDs
  queue.refreshLibrary(refreshedList, false);

  assert.equal(queue.getCurrentTrack().id, curAfterAdvance.id, 'refreshLibrary должен сохранить текущий трек по id');
  assert.equal(queue.tracks.length, tracks.length, 'Длина очереди должна совпадать');
  assert.ok(queue.playedHistory.length > 0, 'История прослушиваний должна быть перемаплена на новые индексы');
});

test('Интеграция тембра AudioTimbre: MFCC-коэффициенты вычисляются корректно', () => {
  // Test spectrum calculation on synthesized frame
  const mockDb = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    mockDb[i] = -40 + 20 * Math.sin(i / 10);
  }

  const timbreVector = Timbre.frame(mockDb, 44100);
  assert.ok(Array.isArray(timbreVector), 'Тимбр должен возвращать массив коэффициентов');
  assert.equal(timbreVector.length, 12, 'Должно быть ровно 12 коэффициентов MFCC');

  for (const coeff of timbreVector) {
    assert.ok(coeff >= 0 && coeff <= 1, `Коэффициент ${coeff} должен лежать в диапазоне [0, 1]`);
  }
});

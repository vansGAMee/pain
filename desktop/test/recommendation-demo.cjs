// Run: node desktop/test/recommendation-demo.cjs
// Synthetic sound profiles: this checks recommendation learning, not MP3 decoding.
const assert = require('node:assert/strict');
const Taste = require('../src/taste-model');
const Audio = require('../src/audio-profile');

const NOW = Date.UTC(2026, 9, 20, 12), TRIALS = 500;
// No artist, genre, tempo or favourites: only listening history and sound differ.
const tracks = ['known-bass', 'known-bright', 'new-bass', 'new-bright']
  .map(id => ({ id, duration: 180000 }));
const profiles = Object.fromEntries(tracks.map(track => [track.id, {
  version: 4, signature: Audio.signature(track), frames: 100, seconds: 50,
  positions: Array.from({ length: 100 }, (_, i) => i),
  vector: track.id.endsWith('bass') ? [.4, .85, .1, .05, .1, .05] : [.4, .05, .1, .85, .8, .05],
  variance: Array(6).fill(.01),
  timbre: Array(12).fill(.5), timbreVariance: Array(12).fill(.01),
}]));
for (const track of tracks) assert.ok(Audio.get(profiles, track), 'Invalid sound fixture');

function history(preferred) {
  return Array.from({ length: 40 }, (_, i) => tracks.slice(0, 2).map((track, j) => {
    const enjoyed = track.id.endsWith(preferred);
    return {
      track: track.id, started: NOW - (i * 2 + j + 1) * 3600000,
      duration: 180000, heard: enjoyed ? 180000 : 5000,
      finished: Number(enjoyed), skipped: Number(!enjoyed),
    };
  })).flat();
}

function measure(plays) {
  const model = new Taste(tracks, plays, NOW, profiles);
  const counts = { bass: 0, bright: 0 };
  // Independent first choices, not a queue forced to play every song eventually.
  // The same seeds make the three scenarios directly comparable and repeatable.
  for (let i = 0; i < TRIALS; i++) {
    const chosen = model.choose(null, tracks.slice(2), {}, { seed: i + 1, step: i % 4, hour: 12 });
    assert.ok(chosen && Number.isFinite(chosen.score), 'Invalid recommendation');
    assert.ok(chosen.track.id.startsWith('new-'), 'Training song leaked into the candidates');
    counts[chosen.track.id.endsWith('bass') ? 'bass' : 'bright']++;
  }
  return counts;
}

const baseline = measure([]), bassFan = measure(history('bass')), brightFan = measure(history('bright'));
console.log('Тест: учимся на двух песнях, выбираем между двумя НОВЫМИ.');
console.log('Одинаковая громкость; отличаются только условные звуковые профили.');
console.log(`Каждая строка — ${TRIALS} независимых выборов, а не порядок одной очереди.\n`);
console.table([
  { Слушатель: 'Без истории', 'Басовый трек': baseline.bass, 'Яркий трек': baseline.bright },
  { Слушатель: 'Дослушивает басовый, пропускает яркий', 'Басовый трек': bassFan.bass, 'Яркий трек': bassFan.bright },
  { Слушатель: 'Дослушивает яркий, пропускает басовый', 'Басовый трек': brightFan.bass, 'Яркий трек': brightFan.bright },
]);
assert.ok(baseline.bass >= TRIALS * .4 && baseline.bass <= TRIALS * .6, 'Перекос без истории');
assert.ok(bassFan.bass >= TRIALS * .6 && bassFan.bass >= baseline.bass + TRIALS * .1, 'Не выучил предпочтение басового звучания');
assert.ok(brightFan.bright >= TRIALS * .6 && brightFan.bright >= baseline.bright + TRIALS * .1, 'Не выучил обратное предпочтение');
console.log('ПРОЙДЕН: история меняет выбор новых песен в обе стороны по звучанию.');
console.log('Это простой синтетический тест обучения, не оценка качества на реальной музыке.');

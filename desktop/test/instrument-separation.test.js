const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Audio = require("../src/audio-profile");
const Taste = require("../src/taste-model");

const libPath = path.join(__dirname, "../data/library.json");
const statePath = path.join(__dirname, "../data/dj-state.json");
const lib = JSON.parse(fs.readFileSync(libPath, "utf8"));
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const byTitle = (query) => {
  const t = lib.tracks.find(x => (x.title + " " + x.artist).toLowerCase().includes(query.toLowerCase()));
  return t ? { track: t, profile: state.profiles[t.id] } : null;
};

const vivaldi = byTitle("La Primavera");
const vivaldiRV522 = byTitle("RV 522");
const mozart = byTitle("Lacrimosa");
const c418 = byTitle("Dry Hands");
const suffocation = byTitle("Suffocation");
const smoke = byTitle("Smoke");
const nirvana = byTitle("Smells Like Teen Spirit");
const everlong = byTitle("Everlong");

test("физические дескрипторы отражают реальные инструменты: бас, гармоники струнных, дисторшн и тарелки", () => {
  assert.ok(vivaldi && vivaldi.profile, "Vivaldi profile must exist");
  assert.ok(c418 && c418.profile, "C418 profile must exist");
  assert.ok(suffocation && suffocation.profile, "Suffocation profile must exist");
  assert.ok(nirvana && nirvana.profile, "Nirvana profile must exist");

  // Вектор: [rms/peak, bass, mid, high, centroid, flatness]
  // 1. Чистые акустические инструменты (струнные Вивальди, рояль C418):
  // - почти нулевая спектральная плоскость (чистая гармоническая тональность без белого шума перегруза)
  assert.ok(vivaldi.profile.vector[5] < 0.010, "Струнные Вивальди имеют чистую гармоническую структуру (flatness < 0.010)");
  assert.ok(c418.profile.vector[5] < 0.010, "Рояль C418 имеет чистую тональность (flatness < 0.010)");
  // - доминирующий среднечастотный акустический резонанс деки/корпуса
  assert.ok(vivaldi.profile.vector[2] > 0.70, "Струнные имеют мощное тело в середине (mids > 0.70)");
  assert.ok(c418.profile.vector[2] > 0.75, "Рояль имеет мощное тело в середине (mids > 0.75)");

  // 2. Дисторшн-фонк (Suffocation, Smoke):
  // - тяжелый 808-саббас (bass > 0.40)
  assert.ok(suffocation.profile.vector[1] > 0.40, "Фонк насыщен тяжелым 808 басом (bass > 0.40)");
  assert.ok(smoke.profile.vector[1] > 0.40, "Фонк насыщен тяжелым 808 басом (bass > 0.40)");
  // - характерный пик ковбелла и открытого хэта в 5-й или 6-й октаве (октавный контраст > 0.38)
  assert.ok(suffocation.profile.detail.mean[5] > 0.38 || suffocation.profile.detail.mean[6] > 0.38, "Фонк имеет характерный пик в высоких частотах ковбелла");
  assert.ok(smoke.profile.detail.mean[5] > 0.45, "Фонк имеет характерный пик в высоких частотах ковбелла");

  // 3. Перегруженный рок/гранж (Nirvana, Everlong):
  // - мощные тарелки и высокие частоты барабанов (high > 0.10)
  assert.ok(nirvana.profile.vector[3] > 0.10, "Рок насыщен тарелками и перкуссией (high > 0.10)");
  assert.ok(everlong.profile.vector[3] > 0.10, "Рок насыщен тарелками и перкуссией (high > 0.10)");
  // - высокая спектральная плоскость от перегруженных дисторшн-гитар
  assert.ok(nirvana.profile.vector[5] > 0.035, "Перегруженные электрогитары дают высокий шумовой спектр (flatness > 0.035)");
  assert.ok(everlong.profile.vector[5] > 0.035, "Перегруженные электрогитары дают высокий шумовой спектр (flatness > 0.035)");
});

test("AudioProfile.similarity разделяет разные инструменты и объединяет близкие по тембру", () => {
  // Близкие по физике пары (внутри одного акустического мира)
  const simRock = Audio.similarity(nirvana.profile, everlong.profile);
  const simPhonk = Audio.similarity(smoke.profile, suffocation.profile);
  const simClassical = Audio.similarity(mozart.profile, c418.profile);

  assert.ok(simRock > 0.70, `Рок с роком должны иметь высокую схожесть (>0.70, факт: ${simRock.toFixed(3)})`);
  assert.ok(simPhonk > 0.65, `Фонк с фонком должны иметь высокую схожесть (>0.65, факт: ${simPhonk.toFixed(3)})`);
  assert.ok(simClassical > 0.70, `Классика с роялем должны иметь высокую схожесть (>0.70, факт: ${simClassical.toFixed(3)})`);

  // Чуждые инструменты (акустический конфликт)
  const simVivaldiPhonk = Audio.similarity(vivaldi.profile, suffocation.profile);
  const simPianoPhonk = Audio.similarity(c418.profile, suffocation.profile);
  const simPianoRock = Audio.similarity(c418.profile, everlong.profile);
  const simClassicalRock = Audio.similarity(mozart.profile, nirvana.profile);

  assert.ok(simVivaldiPhonk < 0.20, `Струнные Вивальди и фонк должны иметь контраст (<0.20, факт: ${simVivaldiPhonk.toFixed(3)})`);
  assert.ok(simPianoPhonk < 0.20, `Рояль и фонк должны иметь контраст (<0.20, факт: ${simPianoPhonk.toFixed(3)})`);
  assert.ok(simPianoRock < 0.18, `Рояль и перегруженный рок должны иметь контраст (<0.18, факт: ${simPianoRock.toFixed(3)})`);
  assert.ok(simClassicalRock < 0.35, `Оркестр/хор и гранж должны иметь контраст (<0.35, факт: ${simClassicalRock.toFixed(3)})`);
});

test("Smart DJ понимает инструменты чисто акустически без метаданных (Zero Hardcode)", () => {
  // Анонимизируем метаданные (названия, исполнители, альбомы, жанры стерты)
  const anonVivaldi = { ...vivaldi.track, title: "Track_A", artist: "Artist_A", album: "", genre: "" };
  const anonMozart = { ...mozart.track, title: "Track_B", artist: "Artist_B", album: "", genre: "" };
  const anonSuffocation = { ...suffocation.track, title: "Track_C", artist: "Artist_C", album: "", genre: "" };
  const anonNirvana = { ...nirvana.track, title: "Track_D", artist: "Artist_D", album: "", genre: "" };

  const m = new Taste(lib.tracks, [], Date.now(), state.profiles);

  // 1. Если играет Вивальди, классика получает огромное преимущество перед фонком и роком
  const scoreClassicalFromVivaldi = m.score(anonVivaldi, anonMozart).score;
  const scorePhonkFromVivaldi = m.score(anonVivaldi, anonSuffocation).score;
  const scoreRockFromVivaldi = m.score(anonVivaldi, anonNirvana).score;

  assert.ok(
    scoreClassicalFromVivaldi > scorePhonkFromVivaldi + 100,
    `Классика (+${scoreClassicalFromVivaldi.toFixed(1)}) должна опережать фонк (${scorePhonkFromVivaldi.toFixed(1)}) более чем на 100 баллов`
  );
  assert.ok(
    scoreClassicalFromVivaldi > scoreRockFromVivaldi + 100,
    `Классика (+${scoreClassicalFromVivaldi.toFixed(1)}) должна опережать рок (${scoreRockFromVivaldi.toFixed(1)}) более чем на 100 баллов`
  );

  // 2. Если пользователь слушает фонк — рекомендатор ценит фонк, а не штрафует его искусственно!
  const anonSmoke = { ...smoke.track, title: "Track_E", artist: "Artist_E", album: "", genre: "" };
  const scorePhonkFromPhonk = m.score(anonSuffocation, anonSmoke).score;
  const scoreClassicalFromPhonk = m.score(anonSuffocation, anonMozart).score;

  assert.ok(
    scorePhonkFromPhonk > scoreClassicalFromPhonk + 60,
    `Фонк (+${scorePhonkFromPhonk.toFixed(1)}) при прослушивании фонка побеждает классику (${scoreClassicalFromPhonk.toFixed(1)}) по физике звука`
  );
});

test("полное отсутствие хардкода: в коде нет строковых фильтров или запретов жанров", () => {
  const tasteCode = fs.readFileSync(path.join(__dirname, "../src/taste-model.js"), "utf8");
  const audioCode = fs.readFileSync(path.join(__dirname, "../src/audio-profile.js"), "utf8");

  // Никаких PHONK_TOKENS, isPhonkTrack, или магических штрафов -85
  assert.ok(!tasteCode.includes("PHONK_TOKENS"), "taste-model.js не должен содержать PHONK_TOKENS");
  assert.ok(!tasteCode.includes("isPhonkTrack"), "taste-model.js не должен содержать isPhonkTrack");
  assert.ok(!tasteCode.includes("score-=85"), "taste-model.js не должен содержать магический штраф -85");
  assert.ok(!audioCode.includes("phonk"), "audio-profile.js не должен знать ни про какие жанры");
  assert.ok(!audioCode.includes("vivaldi"), "audio-profile.js не должен знать имена композиторов");
});

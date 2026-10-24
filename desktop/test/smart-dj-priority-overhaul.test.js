const test = require("node:test");
const assert = require("node:assert/strict");
const Taste = require("../src/taste-model");
const { QueueEngine } = require("../src/queue-engine");
const Audio = require("../src/audio-profile");

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function song(id, title, artist = "Artist", favorite = 0, bpm = 120) {
  return { id, title: title || id, artist, album: "Album", genre: "", duration: 180000, favorite, bpm };
}

function makeProfile(track, v = 0.5) {
  return {
    version: 4,
    signature: Audio.signature(track),
    vector: [0.4, 0.2, 0.6, 0.2, 0.2, 0.1],
    variance: Array(6).fill(0.01),
    timbre: Array(12).fill(v),
    timbreVariance: Array(12).fill(0.001),
    frames: 48,
    seconds: 24,
    positions: Array.from({ length: 48 }, (_, i) => i),
    updatedAt: 1
  };
}

test("лайк (favorite) дает решающий буст и причину Любимый трек", () => {
  const rockA = song("rock1", "Sad Rock Song", "Rock Band", 0);
  const rockNeutral = song("rock2", "Neutral Rock Song", "Other Rock Band", 0);
  const rockFavorite = song("rock3", "Heartfelt Rock Song", "Another Rock Band", 1);

  const tracks = [rockA, rockNeutral, rockFavorite];
  const profiles = {
    rock1: makeProfile(rockA, 0.5),
    rock2: makeProfile(rockNeutral, 0.5),
    rock3: makeProfile(rockFavorite, 0.5)
  };

  const model = new Taste(tracks, [], NOW, profiles);
  const scoreNeutral = model.score(rockA, rockNeutral);
  const scoreFav = model.score(rockA, rockFavorite);

  assert.ok(scoreFav.score > scoreNeutral.score + 20, "Favorite track must have massive score advantage");
  assert.equal(scoreFav.reasons[0], "Любимый трек", "Primary reason must announce favorite status");
  assert.equal(scoreFav.explanation.liked, true);
});

test("изоляция фонка: в рок/акустической сессии фонк треки не подбираются", () => {
  const current = song("rock", "Everlong Acoustic", "Foo Fighters", 1);
  const sadRock = song("sad", "Can not Pretend", "Tom Odell", 1);
  const phonkCandidate1 = song("phonk1", "Ele Te Bota Soca Soca", "MC Mazzie, Mc Rd", 0);
  const phonkCandidate2 = song("phonk2", "MONTAGEM - PR FUNK", "S3BZS", 0);
  const phonkCandidate3 = song("phonk3", "Kerosene Phonk", "Aggrxssor", 0);

  const tracks = [current, sadRock, phonkCandidate1, phonkCandidate2, phonkCandidate3];
  const profiles = {
    rock: makeProfile(current, 0.5),
    sad: makeProfile(sadRock, 0.52),
    phonk1: makeProfile(phonkCandidate1, 0.2),
    phonk2: makeProfile(phonkCandidate2, 0.2),
    phonk3: makeProfile(phonkCandidate3, 0.2)
  };

  const q = new QueueEngine({ shuffleMode: "smart", audioProfiles: profiles });
  q.setContext("library", tracks, 0);

  const model = q.tasteModel();
  for (let step = 0; step < 16; step++) {
    const pick = model.choose(current, [sadRock, phonkCandidate1, phonkCandidate2, phonkCandidate3], {}, { step, sessionRootTrack: current });
    assert.equal(pick.track.id, "sad", "Phonk tracks must never be selected in rock/indie session");
  }
  const next = q.next();
  assert.equal(next.id, "sad");
});

test("динамический BPM не перевешивает акустическое несоответствие", () => {
  const current = song("curr", "Melancholy Piano", "Pianist", 0, 140);
  const closeSoundDistantBpm = song("cand1", "Sad Guitar", "Guitarist", 0, 80);
  const clashSoundSameBpm = song("cand2", "Distorted Synth", "Electro", 0, 140);

  const tracks = [current, closeSoundDistantBpm, clashSoundSameBpm];
  const profiles = {
    curr: makeProfile(current, 0.5),
    cand1: makeProfile(closeSoundDistantBpm, 0.51),
    cand2: makeProfile(clashSoundSameBpm, 0.15)
  };

  const model = new Taste(tracks, [], NOW, profiles);
  const scoreClose = model.score(current, closeSoundDistantBpm);
  const scoreClash = model.score(current, clashSoundSameBpm);

  assert.ok(scoreClose.score > scoreClash.score + 25, "Harmonious sound must easily beat distant timbre despite matching BPM");
});

test("усталость от переслушанных треков: недавние многократные прослушивания получают передышку", () => {
  const current = song("curr", "Current Song", "Artist A", 0);
  const overplayedTrack = song("overplayed", "Space Dementia", "Muse", 1);

  const tracks = [current, overplayedTrack];
  const playsRecent = Array.from({ length: 50 }, (_, i) => ({
    track: "overplayed",
    started: NOW - (i === 0 ? 2 * 3600000 : (i + 1) * 86400000),
    duration: 180000,
    heard: 180000,
    finished: 1
  }));

  const modelRecent = new Taste(tracks, playsRecent, NOW);
  const scoreRecent = modelRecent.score(current, overplayedTrack);

  const playsRested = Array.from({ length: 50 }, (_, i) => ({
    track: "overplayed",
    started: NOW - (120 * 3600000 + i * 86400000),
    duration: 180000,
    heard: 180000,
    finished: 1
  }));

  const modelRested = new Taste(tracks, playsRested, NOW);
  const scoreRested = modelRested.score(current, overplayedTrack);

  assert.ok(scoreRested.score > scoreRecent.score + 10, "Recently overplayed track must experience gentle fatigue compared to well-rested state");
});

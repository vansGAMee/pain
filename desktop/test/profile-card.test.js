const test = require('node:test');
const assert = require('node:assert/strict');
const ProfileCard = require('../src/profile-card');
const Insights = require('../src/listening-insights');

const NOW = new Date(2026, 9, 21, 12).getTime();
const at = (days, hour = 10) => new Date(2026, 9, 21 - days, hour).getTime();
const track = (id, artist = 'Artist', title = 'Title', favorite = 0) => ({
  id,
  title: title || id,
  artist,
  duration: 180000,
  favorite
});
const play = (id, days, extra = {}) => ({
  id: `${id}-${days}`,
  track: id,
  started: at(days),
  heard: 180000,
  duration: 180000,
  ...extra
});

test('ProfileCard: empty history returns honest defaults without crashes', () => {
  const data = ProfileCard.collectProfileData([], {}, 'ru', NOW);
  assert.equal(data.totalMs, 0);
  assert.equal(data.totalFormatted, '0 мин');
  assert.equal(data.todayMinutes, 0);
  assert.equal(data.uniqueTracks, 0);
  assert.equal(data.totalPlays, 0);
  assert.equal(data.currentStreak, 0);
  assert.equal(data.recordDay, null);
  assert.equal(data.completionRate, 0);
  assert.equal(data.discoveryRate, 0);
  assert.equal(data.repeatRate, 0);
  assert.equal(data.peakHourFormatted, '—');
  assert.equal(data.topArtists.length, 0);
  assert.equal(data.ritual, null);
  assert.equal(data.topTracks.length, 0);
  assert.ok(data.shareText.includes('Мой музыкальный профиль'));
});

test('ProfileCard: correctly aggregates listening data, streak, record day, top tracks & artists', () => {
  const tracks = [
    track('t1', 'Radiohead', 'Creep'),
    track('t2', 'Molchat Doma', 'Toska'),
    track('t3', 'Muse', 'Hysteria')
  ];

  // Plays across 3 days: today (day 0), yesterday (day 1), 2 days ago (day 2)
  const plays = [
    play('t1', 2, { finished: 1 }),
    play('t1', 1, { finished: 1 }),
    play('t1', 0, { finished: 1 }), // t1 listened across 3 days -> ritual!
    play('t2', 0, { heard: 180000, finished: 1 }),
    play('t2', 0, { started: at(0, 11), heard: 180000, finished: 1 }),
    play('t3', 1, { heard: 60000, finished: 0 })
  ];

  const stats = { plays };
  const data = ProfileCard.collectProfileData(tracks, stats, 'ru', NOW);

  assert.equal(data.uniqueTracks, 3);
  assert.equal(data.totalPlays, 6);
  assert.ok(data.totalMs > 0);
  assert.equal(data.currentStreak, 3);
  assert.equal(data.streakFormatted, '3 дня');
  assert.equal(data.streakSubFormatted, '3 дня подряд');

  // Ritual track should be t1 (Creep) with 3 days
  assert.ok(data.ritual);
  assert.equal(data.ritual.trackId, 't1');
  assert.equal(data.ritual.title, 'Creep');
  assert.equal(data.ritual.artist, 'Radiohead');
  assert.equal(data.ritual.days, 3);

  // Top tracks: t2 has 2 plays, t1 has 3 plays
  assert.ok(data.topTracks.length >= 2);
  assert.equal(data.topTracks[0].title, 'Creep');
  assert.equal(data.topTracks[0].plays, 3);
  assert.equal(data.topTracks[1].title, 'Toska');
  assert.equal(data.topTracks[1].plays, 2);

  // Top artists: Radiohead and Molchat Doma should be on top
  assert.ok(data.topArtists.length >= 2);
  const artistNames = data.topArtists.map(a => a.name);
  assert.ok(artistNames.includes('Radiohead'));
  assert.ok(artistNames.includes('Molchat Doma'));

  // Peak hour should be identified
  assert.ok(data.peakHour >= 0);
  assert.ok(data.peakHourFormatted.includes(':00'));

  // Completion rate (5 out of 6 finished)
  assert.equal(data.completionRate, Math.round((5 / 6) * 100));

  // Test HTML generation
  const html = ProfileCard.renderProfileCardHtml(data);
  assert.ok(html.includes('share-profile-poster'));
  assert.ok(html.includes('Creep'));
  assert.ok(html.includes('Radiohead'));
  assert.ok(html.includes('Toska'));
  assert.ok(html.includes('Мой музыкальный профиль'));
  assert.ok(html.includes('Музыка всегда рядом ♡'));
});

test('ProfileCard: works properly with English locale', () => {
  const tracks = [track('t1', 'Radiohead', 'Creep')];
  const plays = [play('t1', 0, { finished: 1 })];
  const data = ProfileCard.collectProfileData(tracks, { plays }, 'en', NOW);

  assert.equal(data.lang, 'en');
  assert.equal(data.isRu, false);
  assert.ok(data.totalFormatted.includes('m') || data.totalFormatted.includes('h'));
  assert.ok(data.shareText.includes('My Music Profile'));

  const html = ProfileCard.renderProfileCardHtml(data);
  assert.ok(html.includes('My Music Profile'));
  assert.ok(html.includes('Music is always near ♡'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const ArtistCard = require('../src/artist-card');

test('ArtistCard: norm cleans, folds case, and unifies e/yo', () => {
  assert.equal(ArtistCard.norm('  Кино  '), 'кино');
  assert.equal(ArtistCard.norm('Мёртвые Дельфины'), 'мертвыедельфины');
  assert.equal(ArtistCard.norm('AC/DC'), 'acdc');
  assert.equal(ArtistCard.norm(''), '');
});

test('ArtistCard: primaryArtist and splitArtists extract multi-artist collaborations', () => {
  assert.equal(ArtistCard.primaryArtist('Daft Punk feat. Pharrell Williams'), 'Daft Punk');
  assert.equal(ArtistCard.primaryArtist('Queen & David Bowie'), 'Queen');
  assert.equal(ArtistCard.primaryArtist('Gorillaz'), 'Gorillaz');

  const daftParts = ArtistCard.splitArtists('Daft Punk feat. Pharrell Williams');
  assert.deepEqual(daftParts, ['Daft Punk', 'Pharrell Williams']);

  const trioParts = ArtistCard.splitArtists('Artist A, Artist B; Artist C');
  assert.deepEqual(trioParts, ['Artist A', 'Artist B', 'Artist C']);
});

test('ArtistCard: getArtistTracks matches primary and featured artists accurately', () => {
  const tracks = [
    { id: '1', title: 'Get Lucky', artist: 'Daft Punk feat. Pharrell Williams' },
    { id: '2', title: 'One More Time', artist: 'Daft Punk' },
    { id: '3', title: 'Happy', artist: 'Pharrell Williams' },
    { id: '4', title: 'Around The World', artist: 'DAFT PUNK' },
    { id: '5', title: 'Song 2', artist: 'Blur' }
  ];

  // Search by Daft Punk -> matches tracks 1, 2, 4
  const daftTracks = ArtistCard.getArtistTracks('Daft Punk', tracks);
  assert.equal(daftTracks.length, 3);
  assert.deepEqual(daftTracks.map(t => t.id), ['1', '2', '4']);

  // Search by Pharrell Williams -> matches track 1 (feat) and 3 (solo)
  const pharrellTracks = ArtistCard.getArtistTracks('Pharrell Williams', tracks);
  assert.equal(pharrellTracks.length, 2);
  assert.deepEqual(pharrellTracks.map(t => t.id), ['1', '3']);

  // Search by non-existent artist -> empty array
  const unknownTracks = ArtistCard.getArtistTracks('Unknown Artist', tracks);
  assert.equal(unknownTracks.length, 0);
});

test('ArtistCard: formatTime formats durations nicely', () => {
  assert.equal(ArtistCard.formatTime(0), '0:00');
  assert.equal(ArtistCard.formatTime(65), '1:05');
  assert.equal(ArtistCard.formatTime(215), '3:35');
  assert.equal(ArtistCard.formatTime(-5), '0:00');
  assert.equal(ArtistCard.formatTime(NaN), '0:00');
});

test('ArtistCard: close safely cleans up state even when no modal is open', () => {
  assert.doesNotThrow(() => {
    ArtistCard.close();
  });
});

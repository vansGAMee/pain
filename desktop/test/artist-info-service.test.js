const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const createArtistInfoService = require('../src/artist-info-service');

test('ArtistInfoService: offline / empty artist returns minimal structure without throwing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artist-info-test-'));
  try {
    const service = createArtistInfoService(tmpDir, {
      genres: { entry: () => ({ names: [] }) },
      getTracks: () => []
    });

    const res = await service.lookup('Test Artist', 'ru', { online: false });
    assert.equal(res.artist, 'Test Artist');
    assert.deepEqual(res.genres, []);
    assert.deepEqual(res.similar, []);
    assert.equal(res.bio, null);
    assert.equal(res.avatar, null);

    // Empty artist name lookup
    const emptyRes = await service.lookup('', 'ru', { online: false });
    assert.equal(emptyRes.artist, 'Unknown Artist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ArtistInfoService: integrates local genre service when available', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artist-info-test-'));
  try {
    const service = createArtistInfoService(tmpDir, {
      genres: {
        entry: t => ({ names: ['Electronic', 'House'] })
      },
      getTracks: () => [
        { id: '1', title: 'One More Time', artist: 'Daft Punk', genre: 'French House' }
      ]
    });

    const res = await service.lookup('Daft Punk', 'en', { online: false });
    assert.equal(res.artist, 'Daft Punk');
    assert.ok(res.genres.includes('Electronic'));
    assert.ok(res.genres.includes('House'));
    assert.ok(res.genres.includes('French House'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

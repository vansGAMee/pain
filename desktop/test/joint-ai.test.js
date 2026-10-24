const test = require('node:test');
const assert = require('node:assert/strict');
const JointAI = require('../src/joint-ai.js');

test('JointAI module exports expected public methods', () => {
  assert.equal(typeof JointAI.loadJointModel, 'function');
  assert.equal(typeof JointAI.generateJointPlaylist, 'function');
  assert.equal(typeof JointAI.resolveSongs, 'function');
  assert.equal(typeof JointAI.isLoaded, 'function');
});

test('JointAI resolveSongs matches track identities and aliases', () => {
  const dummyCatalog = {
    tracks: [
      { id: '1', artist: 'The Beatles', title: 'Hey Jude', aliases: [] },
      { id: '2', artist: 'Queen', title: 'Bohemian Rhapsody', aliases: [['Queen', 'Bohemian Rhapsody (2011 Remaster)']] },
      { id: '3', artist: 'Daft Punk', title: 'Get Lucky', aliases: [] }
    ],
    artists: [0, 1, 2],
    families: [0, 1, 2]
  };

  const resolved = JointAI.resolveSongs(dummyCatalog, [
    { artist: 'The Beatles', title: 'Hey Jude' },
    { artist: 'Queen', title: 'Bohemian Rhapsody (Remaster)' },
    { artist: 'Unknown', title: 'Nonexistent Song' }
  ]);

  assert.equal(resolved.seeds.length, 2);
  assert.equal(resolved.matches.length, 2);
  assert.equal(resolved.matches[0].index, 0);
  assert.equal(resolved.matches[1].index, 1);
  assert.equal(resolved.unresolved.length, 1);
});

test('JointAI parseFileContent handles JSON, CSV, TSV, TXT, and M3U formats', () => {
  // JSON array of objects
  const jsonSimple = JSON.stringify([
    { artist: 'Nirvana', title: 'Smells Like Teen Spirit' },
    { artist: 'Radiohead', title: 'Creep' }
  ]);
  const resJson = JointAI.parseFileContent(jsonSimple);
  assert.equal(resJson.length, 2);
  assert.equal(resJson[0].artist, 'Nirvana');
  assert.equal(resJson[0].title, 'Smells Like Teen Spirit');

  // Spotify dump JSON format
  const jsonSpotify = JSON.stringify({
    items: [
      { track: { artists: [{ name: 'Deftones' }], name: 'Change' } },
      { track: { artists: [{ name: 'Korn' }], name: 'Freak on a Leash' } }
    ]
  });
  const resSpotify = JointAI.parseFileContent(jsonSpotify);
  assert.equal(resSpotify.length, 2);
  assert.equal(resSpotify[0].artist, 'Deftones');
  assert.equal(resSpotify[0].title, 'Change');

  // CSV with comma
  const csvComma = 'Artist,Track Name,Album\nNirvana,In Bloom,Nevermind\nLinkin Park,Numb,Meteora';
  const resCsv = JointAI.parseFileContent(csvComma);
  assert.equal(resCsv.length, 2);
  assert.equal(resCsv[0].artist, 'Nirvana');
  assert.equal(resCsv[0].title, 'In Bloom');

  // CSV with semicolon (European/Russian export)
  const csvSemi = 'Исполнитель;Название трека\nКино;Группа крови\nСплин;Мое сердце';
  const resSemi = JointAI.parseFileContent(csvSemi);
  assert.equal(resSemi.length, 2);
  assert.equal(resSemi[0].artist, 'Кино');
  assert.equal(resSemi[0].title, 'Группа крови');

  // TXT list "Artist - Title"
  const txtLines = 'Interpol - Evil\nThe Strokes - Reptilia\nArctic Monkeys - Do I Wanna Know?';
  const resTxt = JointAI.parseFileContent(txtLines);
  assert.equal(resTxt.length, 3);
  assert.equal(resTxt[0].artist, 'Interpol');
  assert.equal(resTxt[0].title, 'Evil');

  // M3U playlist format
  const m3u = '#EXTM3U\n#EXTINF:210,Blur - Song 2\nsong2.mp3\n#EXTINF:180,Oasis - Wonderwall\nwonderwall.mp3';
  const resM3u = JointAI.parseFileContent(m3u);
  assert.equal(resM3u.length, 2);
  assert.equal(resM3u[0].artist, 'Blur');
  assert.equal(resM3u[0].title, 'Song 2');
});

test('JointAI catalog respects artist limits without inventing match probabilities', {
  skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '../joint-model/manifest.json')) ? 'Optional JointAI model is absent' : false
}, async () => {
  // Test with sparse graph seeds that previously stalled at 4 tracks
  const seeds = [
    { artist: 'FACE', title: 'ЛАБИРИНТ' },
    { artist: 'Молчат Дома', title: 'Тоска' }
  ];

  const result = await JointAI.generateJointPlaylist(seeds, [], 'joint-model', {
    targetCount: 50,
    popularityFilter: 'underground',
    maxPerArtist: 1
  });

  assert.ok(result.tracks.length > 0 && result.tracks.length <= 50);

  // Model scores order results; they have not been calibrated as probabilities.
  result.tracks.forEach(t => {
    assert.equal(t.matchPercent, null);
    assert.ok(Number.isFinite(t.score));
  });
  assert.equal(result.source, 'catalog');
  const data = await JointAI.loadJointModel('joint-model');
  const sorted = Array.from({ length: data.catalog.tracks.length }, (_, i) => data.info[i * 2]).sort((a, b) => a - b);
  const boundary = sorted[Math.floor((sorted.length - 1) / 3)];
  const byId = new Map(data.catalog.tracks.map((t, i) => [t.id, i]));
  assert.ok(result.tracks.every(t => data.info[byId.get(t.id) * 2] <= boundary));

  // Check maxPerArtist = 1: all 50 tracks should have distinct artists
  const artists = new Set(result.tracks.map(t => t.artist.toLowerCase()));
  assert.equal(artists.size, result.tracks.length, 'Artist limit is strict even if fewer than 50 results exist');
});


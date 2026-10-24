const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Joint = require('../src/joint-ai');

function fixture() {
  const tracks = Array.from({ length: 9 }, (_, i) => ({ id: String(i), artist: i < 4 ? 'Same Artist' : `Artist ${i}`, title: `Song ${i}` }));
  return {
    manifest: { schema: 'joint-browser-v1', tracks: 9, dimensions: 2, neighbors: 1 },
    catalog: { tracks, artists: tracks.map(t => t.artist), families: tracks.map(t => t.id) },
    vectors: new Float32Array(tracks.flatMap((_, i) => [Math.cos(i / 10), Math.sin(i / 10)])),
    neighbors: new Int32Array(9).fill(-1),
    info: new Float32Array(tracks.flatMap((_, i) => [i / 8, i % 2])),
    weights: { w1: [[1, 0, 0, 0, 0, 0]], b1: [0], w2: [[1]], b2: [0] }
  };
}
function writeFixture(t, data = fixture()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pain-catalog-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = { 'catalog.json': JSON.stringify(data.catalog), 'ranker.json': JSON.stringify(data.weights),
    'vectors.f32': Buffer.from(data.vectors.buffer), 'neighbors.i32': Buffer.from(data.neighbors.buffer), 'info.f32': Buffer.from(data.info.buffer) };
  const manifest = { ...data.manifest, sizes: {}, sha256: {} };
  for (const [file, contents] of Object.entries(files)) {
    const bytes = Buffer.from(contents);
    fs.writeFileSync(path.join(dir, file), bytes);
    manifest.sizes[file] = bytes.length;
    manifest.sha256[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

test('unknown songs and unlisted remixes do not borrow another recording by the same artist', () => {
  const { catalog } = fixture();
  for (const title of ['Not in catalog', 'Song 0 (Remix)', 'Song 0 (slowed)']) {
    const result = Joint.resolveSongs(catalog, [{ artist: 'Same Artist', title }]);
    assert.equal(result.seeds.length, 0);
    assert.equal(result.matches.length, 0);
    assert.equal(result.unresolved.length, 1);
  }
});

test('audio, popularity, exclusions and artist caps remain strict for small candidate pools', () => {
  const d = fixture();
  const rows = Joint.recommend(d, [0], [], { targetCount: 50, maxPerArtist: 1, requireAudio: true, popularityFilter: 'underground' });
  assert.deepEqual(rows.map(r => r.index), [1]);
  const excluded = Joint.recommend(d, [0], [], { excludedTracks: new Set(['1', '2', '3']), maxPerArtist: 1 });
  assert.ok(excluded.every(r => r.index > 3));
  assert.equal(new Set(excluded.map(r => d.catalog.artists[r.index])).size, excluded.length);
  assert.deepEqual(Joint.recommend(d, [0], [], { targetCount: 0 }), []);
});

test('candidate filtering happens before taking the requested results', () => {
  const d = fixture();
  const result = Joint.recommend(d, [0], [], { targetCount: 2, allowedIndices: new Set([7, 8]) });
  assert.deepEqual(result.map(r => r.index), [7, 8]);
});

test('corrupt models fail validation; failed loads can be retried and separate paths stay separate', async t => {
  const data = fixture(), dir = writeFixture(t, data);
  const file = path.join(dir, 'vectors.f32'), original = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.alloc(original.length));
  await assert.rejects(Joint.loadJointModel(dir), /Повреждён/);
  fs.writeFileSync(file, original);
  const loaded = await Joint.loadJointModel(dir);
  assert.equal(loaded.catalog.tracks.length, 9);
  const second = fixture(); second.catalog.tracks[0].title = 'Different model';
  const other = await Joint.loadJointModel(writeFixture(t, second));
  assert.equal(other.catalog.tracks[0].title, 'Different model');
  assert.notEqual(loaded, other);
  const broken = fixture(); broken.vectors[0] = NaN;
  assert.throws(() => Joint.validateModel(broken), /Повреждены/);
  assert.throws(() => Joint.validateModel({ ...fixture(), weights: {} }), /веса/);
});

test('generated catalog results contain real evidence, no invented percentage and no excluded local match', async t => {
  const data = fixture(), dir = writeFixture(t, data);
  const local = [{ ...data.catalog.tracks[1], id: 'local-song' }];
  const result = await Joint.generateJointPlaylist([data.catalog.tracks[0]], local, dir, { excludedTracks: ['local-song'], maxPerArtist: 5 });
  assert.ok(result.tracks.length);
  assert.ok(result.tracks.every(t => t.id !== '1' && t.matchPercent === null && Number.isFinite(t.score)));
  assert.ok(result.tracks.every(t => t.referenceTitle === 'Song 0'));
});

test('local playlists work without a catalog, obey exclusions and keep the library immutable', async () => {
  const tracks = fixture().catalog.tracks.map(t => ({ ...t, duration: 180000 }));
  const before = JSON.stringify(tracks);
  const result = await Joint.generateJointPlaylist([tracks[0]], tracks, '/missing-catalog', {
    localOnly: true, targetCount: 50, maxPerArtist: 1, excludedTracks: new Set(['4'])
  });
  assert.equal(result.source, 'local');
  assert.ok(result.tracks.length > 0 && result.tracks.length < 50);
  assert.ok(result.tracks.every(t => t.isLocal && t.id !== '0' && t.id !== '4' && t.matchPercent === null));
  assert.equal(new Set(result.tracks.map(t => t.artist)).size, result.tracks.length);
  assert.equal(JSON.stringify(tracks), before);
  const noAudio = await Joint.generateJointPlaylist([tracks[0]], tracks, '', { localOnly: true, requireAudio: true });
  assert.deepEqual(noAudio.tracks, []);
});

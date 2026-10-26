const test = require('node:test');
const assert = require('node:assert/strict');
const { metadata, matches, queries } = require('../src/cover-matching');
test('find original artwork for labelled uploads and collaborations', () => {
  const track = metadata({ artist: 'Artist, Guest', title: 'Song (Slowed + Reverb).mp3' });
  assert.ok(matches({ artistName: 'Artist feat. Guest', trackName: 'Song' }, track));
  assert.equal(queries(track)[1].term, 'Artist Song');
  assert.ok(!matches({ artistName: 'Unrelated', trackName: 'Song' }, track));
  assert.ok(!matches({ artistName: 'Artist', trackName: 'Different' }, track));
});
test('preserve meaningful title parentheses and require exact album and artist', () => {
  const track = metadata({ artist: 'Artist', title: 'Song (Part Two)', album: 'Album' });
  assert.ok(!matches({ artistName: 'Artist', trackName: 'Song' }, track));
  assert.ok(matches({ artistName: 'Artist', collectionName: 'Album' }, track, true));
  assert.ok(!matches({ artistName: 'Another', collectionName: 'Album' }, track, true));
});
test('recover artist from filename, ignore generic albums and unidentified recordings', () => {
  assert.deepEqual(metadata({ artist: 'Неизвестный исполнитель', title: 'Artist — Song', album: 'Telegram' }), { artist: 'Artist', title: 'Song', album: '' });
  assert.equal(metadata({ title: '20240801-173446', artist: 'Неизвестный исполнитель' }), null);
  assert.equal(queries(metadata({ artist: 'Artist', title: 'Song' })).length, 1);
});

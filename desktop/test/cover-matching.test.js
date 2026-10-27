const test = require('node:test');
const assert = require('node:assert/strict');
const { metadata, matches, queries } = require('../src/cover-matching');
test('reverbed edits retain the original title and search every credited performer',()=>{
 const track=metadata({title:'Faster n Harder - Slowed & Reverbed',artist:'Sassy Scene, 6arelyhuman'});
 assert.equal(track.title,'Faster n Harder');
 assert.ok(queries(track).some(q=>q.term==='6arelyhuman Faster n Harder'));
 assert.ok(matches({artistName:'6arelyhuman',trackName:'Faster n Harder'},track));
 assert.ok(!matches({artistName:'Someone Else',trackName:'Faster n Harder'},track));
});
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
test('recover artist suffixes from real library-style filenames without guessing', () => {
  const { fromFilename } = require('../src/cover-matching');
  const known = ['Гражданская оборона', 'Alex G', 'daryana'];
  assert.equal(fromFilename({ title:'Беспонтовый_пирожок_Гражданская_оборона',artist:'<unknown>' },known).title,'Беспонтовый пирожок');
  assert.equal(fromFilename({ title:'Advice_Alex_G',artist:'<unknown>' },known).artist,'Alex G');
  assert.equal(fromFilename({ title:'juice - daryana',artist:'<unknown>' },known).title,'juice');
  assert.equal(fromFilename({ title:'random song',artist:'<unknown>' },known).artist,'<unknown>');
});

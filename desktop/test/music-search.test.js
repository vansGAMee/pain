const test=require('node:test'),assert=require('node:assert/strict');
const search=require('../src/music-search');
const tracks=[
 {id:'muse',title:'Space Dementia',artist:'Muse',album:'Origin of Symmetry'},
 {id:'molchat',title:'Судно (Борис Рыжий)',artist:'Молчат Дома'},
 {id:'radiohead',title:'Everything in Its Right Place',artist:'Radiohead'},
 {id:'leave',title:'leave',artist:'Whirr'},
 {id:'queen',title:'Love of My Life',artist:'Queen'},
 {id:'live',title:'Space Dementia (Live)',artist:'Muse'}
];
test('normalization handles accents, full-width and mixed-script lookalikes',()=>{
 assert.ok(search.same('Beyoncé','Beyonce'));assert.ok(search.same('Ｍｕｓｅ','Muse'));assert.ok(search.same('Spаce','Space'));
 assert.equal(search.clean('01. Muse_-_Space_Dementia_(Official Audio)_[www.music.ru].mp3'),'Muse - Space Dementia');
});
test('Damerau edits include insertions, deletions and swaps with a strict bound',()=>{
 for(const [a,b] of [['whirr','whir'],['muse','msue'],['radiohead','raidohead'],['dementia','demantia']])assert.equal(search.distance(a,b),1);
 assert.ok(search.distance('muse','queen')>2);assert.equal(search.titleDistance('love','live'),1);
});
test('search handles combined fields, typos, transliteration and wrong keyboard layout',()=>{
 for(const [query,id] of [['space dementai msue','muse'],['молчат судно','molchat'],['molchat doma sudno','molchat'],['vjknfn ljvf','molchat'],['кфвшщруфв','radiohead'],['beyonce','none'],['whir leav','leave']]){
  const result=search.filter(tracks,query);assert.equal(result[0]?.id,id==='none'?undefined:id,query);
 }
 assert.equal(search.filter(tracks,'Space Dementia')[0].id,'muse');
 assert.deepEqual(search.filter(tracks,'xyzzzzzz unrelated').map(t=>t.id),[]);
 assert.deepEqual(search.filter(tracks,'lo').map(t=>t.id),['queen'],'short queries do not fuzzily match everything');
});
test('cached index follows metadata edits without mutating track objects or the input order',()=>{
 const rows=structuredClone(tracks),copy=JSON.stringify(rows);search.filter(rows,'dementai');assert.equal(JSON.stringify(rows),copy);
 rows[0].title='Different title';assert.equal(search.filter(rows,'different')[0].id,'muse');
});
const {Index}=require('../src/music-search-index');
test('ranking preserves exact titles before typo neighbours and lyrics; words may be reordered or mixed-layout',()=>{
 const rows=[{id:'noise',title:'Whirring',artist:'Muses'},{id:'exact',title:'Muse',artist:'Nobody'},...tracks];
 const index=new Index(rows);
 assert.equal(index.search('muse')[0].id,'exact');
 for(const query of ['msue dementai space','muse ызфсу','spacedementia','space demen tia','radiho','eiirp']){
  const expected=query==='radiho'||query==='eiirp'?'radiohead':'muse';
  assert.equal(index.search(query)[0]?.id,expected,query);
 }
 assert.deepEqual(index.search('zzzznever matching xyz'),[]);
 assert.deepEqual(index.search('lo').map(h=>h.id),['queen']);
});
test('searching genres uses actual track tags, their translations and saved catalogue data',()=>{
 const index=new Index([{id:'a',title:'Rain',artist:'One',genre:['Indie Rock','Shoegaze']},{id:'b',title:'Rock',artist:'Two',genre:'Jazz'},{id:'c',title:'Third',artist:'One'}]);
 index.updateExtras([{id:'c',genres:['Phonk','Electronic']}]);
 for(const q of ['genre:рок','жанр:шугейз','жанр:shoegze','one indie rock'])assert.equal(index.search(q)[0]?.id,'a',q);
 for(const q of ['фонк','genre:электроника'])assert.equal(index.search(q)[0]?.id,'c',q);
 assert.deepEqual(index.search('genre:rock').map(h=>h.id),['a'],'a song called Rock is not proof of its genre');
 assert.deepEqual(index.search('genre:classical'),[],'no genre is inferred from an artist/title');
});
test('saved lyrics support phrases, mistakes, genre+lyrics queries and natural lyrics frames',()=>{
 const index=new Index([{id:'lyrics',title:'A Different Name',artist:'Singer',genre:'Rock'},{id:'title',title:'The rain stays',artist:'Other'}]);
 index.updateExtras([{id:'lyrics',lyrics:'The rain stays outside\nWhile the quiet room waits\nСлова остаются здесь'}]);
 for(const q of ['quiet room waits','quiiet room watis','рок quiet room','текст:"rain stays outside"','та песня где quiet room waits','песня со словами слова остаются','song that goes quiet room waits']){
  const hit=index.search(q)[0];assert.equal(hit?.id,'lyrics',q);assert.equal(hit.reason,'lyrics');assert.ok(hit.snippet);
 }
 assert.equal(index.search('the rain stays')[0].id,'title','exact titles keep priority over matching text');
 assert.deepEqual(index.search('lyrics:"outside stays rain"'),[],'quotes preserve word order');
 assert.deepEqual(index.search('quiet room',{lyrics:false}),[]);
 assert.deepEqual(index.search('male whispers sadly in the rain'),[],'unverified audio descriptions do not become fake matches');
 index.updateExtras([{id:'lyrics',lyrics:''}]);assert.deepEqual(index.search('quiet room'),[],'manual deletion removes old text from search');
});
test('filters distinguish editions, constrain fields and require distinct word occurrences',()=>{
 const index=new Index(tracks);
 assert.deepEqual(index.search('muse dementia -live').map(h=>h.id),['muse']);
 assert.deepEqual(index.search('artist:queen title:love').map(h=>h.id),['queen']);
 assert.deepEqual(index.search('artist:space'),[]);
 assert.deepEqual(index.search('dementia dementia'),[]);
 const tricky=new Index([{id:'a',title:'muses must',artist:'Band'}]);
 assert.equal(tricky.search('muse muses')[0]?.id,'a','matching can reassign the initially preferred word');
 const boundary=new Index([{id:'alive',title:'Alive',artist:'Muse'},{id:'live',title:'Song (Live)',artist:'Muse'}]);
 assert.deepEqual(boundary.search('muse -live').map(h=>h.id),['alive'],'exclude a version word, not letters inside Alive');
});
test('incremental updates remove vanished songs and stale lyrics without changing input metadata',()=>{
 const rows=structuredClone(tracks),copy=JSON.stringify(rows),index=new Index(rows);
 index.updateExtras([{id:'muse',lyrics:'Secret constellation words',genres:['Rock']}]);
 assert.equal(index.search('secret constellation')[0]?.id,'muse');assert.equal(JSON.stringify(rows),copy);
 rows[0]={...rows[0],title:'Updated'};index.setTracks(rows);assert.deepEqual(index.search('secret constellation'),[]);
 assert.equal(index.search('updated')[0]?.id,'muse');index.setTracks(rows.slice(1));assert.deepEqual(index.search('updated'),[]);
});
test('the end of long lyrics and languages without spaces remain searchable',()=>{
 const index=new Index([{id:'long',title:'Long song'},{id:'jp',title:'カントリーロード',artist:'歌手'},{id:'accent',title:'Beyoncé',artist:'Ｒａｍｍｓｔｅｉｎ'}]);
 index.updateExtras([{id:'long',lyrics:'Ordinary opening words\n'.repeat(250)+'Final constellation memory'}]);
 assert.equal(index.search('final constellation memory')[0]?.id,'long');
 assert.equal(index.search('lyrics:"final constellation memory"')[0]?.id,'long');
 assert.equal(index.search('ロード')[0]?.id,'jp');assert.equal(index.search('beyonce')[0]?.id,'accent');
 assert.equal(index.search('rammsteein')[0]?.id,'accent');
});
test('heard English words typed in Russian can match by a labelled phonetic fallback',()=>{
 const index=new Index([{id:'love',title:'A hidden name',artist:'Artist'},{id:'muse',title:'Space Dementia',artist:'Muse'},{id:'literal',title:'Лав',artist:'Other'}]);
 index.updateExtras([{id:'love',lyrics:'I love you\nAnd the stars wait'}]);
 const hit=index.search('ай лав ю')[0];assert.equal(hit?.id,'love');assert.equal(hit.reason,'lyrics');assert.equal(hit.phonetic,true);
 assert.equal(index.search('мьюз')[0]?.id,'muse');assert.equal(index.search('лав')[0].id,'literal','a real exact name outranks phonetic guesses');
 assert.deepEqual(index.search('genre:лав'),[],'pronunciation never assigns an invented genre');
});

const test=require('node:test'),assert=require('node:assert/strict'),Duo=require('../src/duo-playlist');
test('two libraries alternate, deduplicate and resolve different local IDs without losing missing audio',()=>{
 const a=[{id:'pc2',artist:'A',title:'Mine'},{id:'pc1',artist:'Band',title:'Shared',path:'/private/music'}];
 const b=[{id:'phone1',artist:'B',title:'Yours'},{id:'phone2',artist:'band',title:'Shared'}];
 const exchange=Duo.parse(JSON.stringify(Duo.pack(b)));
 const joined=Duo.combine(a,exchange.tracks);
 assert.deepEqual(joined.map(t=>t.title),['Shared','Mine','Yours']);
 assert.deepEqual(Duo.resolve(joined,a).ids,['pc1','pc2']);
 assert.deepEqual(Duo.resolve(joined,b).ids,['phone2','phone1']);
 assert.equal(Duo.resolve(joined,a).missing[0].title,'Yours');
 const returned=Duo.parse(JSON.stringify(Duo.pack(joined,'playlist','Together')));
 assert.deepEqual(returned.tracks,joined);assert.equal(returned.kind,'playlist');
 assert.ok(!JSON.stringify(Duo.pack(a)).includes('/private'));assert.ok(!JSON.stringify(Duo.pack(a)).includes('pc1'));
 assert.equal(Duo.resolve(joined,[...a,{id:'new',artist:'B',title:'Yours'}]).missing.length,0);
});
test('invalid formats, damaged files and oversized selections are rejected',()=>{
 for(const value of ['{}','null','{',JSON.stringify({format:'pain-duo',version:2,kind:'selection',tracks:[]})])assert.throws(()=>Duo.parse(value));
 assert.throws(()=>Duo.pack([{title:''}]));assert.throws(()=>Duo.pack(Array(10001).fill({title:'x'})));
});
test('history selection uses completed-listen frequency without changing the library or exporting counts',()=>{
 const Queue=require('../src/queue-engine');
 const library=[{id:'a',title:'Once'},{id:'b',title:'Repeated'},{id:'c',title:'Skipped'}];
 const q=new Queue({stats:{plays:[{track:'a',started:1,finished:1},{track:'b',started:2,finished:1},{track:'b',started:3,finished:1},{track:'c',started:4,finished:0,skipped:1}]}});
 const chosen=Duo.select(library,'history',q.completedCounts());
 assert.deepEqual(chosen.map(t=>t.id),['b','a']);assert.deepEqual(library.map(t=>t.id),['a','b','c']);
 assert.ok(!JSON.stringify(Duo.pack(chosen)).includes('started'));
 assert.deepEqual(Duo.select(library,'history'),[]);
});

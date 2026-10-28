const test=require('node:test'),assert=require('node:assert/strict'),Model=require('../src/companion-model');
const track=(id,title=id)=>({id,title,artist:'Artist',album:'',duration:180000,bytes:12345});
test('three-way playlist membership merges additions and respects acknowledged removals',()=>{
 const a=track('a'),b=track('b'),c=track('c'),d=track('d'),pl=tracks=>({kind:'playlist',name:'List',tracks});
 const result=Model.merge({p:pl([a,b])},{p:pl([b,c])},{p:pl([a,b,d])});assert.deepEqual(result.entities.p.tracks.map(t=>t.id),['b','c','d']);
 assert.equal(Object.keys(Model.merge({p:pl([a])},{},{p:pl([a])}).entities).length,0);
 assert.ok(Model.merge({p:pl([a])},{},{p:pl([a,b])}).entities.p,'a concurrent edit survives a deletion');
});
test('changed file IDs resolve only an exact recording, and conflicting lyrics retain both versions',()=>{
 const a=track('old'),b=track('new','old');assert.equal(Model.resolve(a,[b]),b);assert.ok(Model.canonical(a)===Model.canonical(b));
 assert.equal(Model.resolve(a,[b,{...b,id:'ambiguous'}]),null);
 const doc=body=>({kind:'lyrics',track:a,body,offset:0}),result=Model.merge({l:doc('base')},{l:doc('local')},{l:doc('remote')});
 assert.equal(result.entities.l.body,'local');assert.equal(result.conflicts[0].remote.body,'remote');
});

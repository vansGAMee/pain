const test=require('node:test'),assert=require('node:assert/strict'),Taste=require('../src/taste-model');
const NOW=Date.UTC(2026,9,20),DAY=86400000;
const play=(track,good,started)=>({track,started,heard:good?180000:5000,duration:180000,finished:good?1:0,skipped:good?0:1});

test('rare consistent preferences survive a much larger number of opposite outcomes',()=>{
 const tracks=[{id:'known',artist:'Known'},{id:'new',artist:'Known'},{id:'neutral',artist:'Unseen'},
  ...Array.from({length:40},(_,i)=>({id:'other'+i,artist:'Other '+i}))];
 for(const liked of [true,false]){
  const plays=[...[1,2,3].map(day=>play('known',liked,NOW-day*DAY)),
   ...tracks.slice(3).map((t,i)=>play(t.id,!liked,NOW-1000000-i*10000))];
  const model=new Taste(tracks,plays,NOW),known=model.score(null,tracks[1]).probability,unseen=model.score(null,tracks[2]).probability;
  assert.ok((known-unseen)*(liked?1:-1)>.15,'minority evidence must not disappear into the global listening bias');
 }
});

test('balancing handles empty, one-sided and ambiguous histories without inventing an opposite class',()=>{
 const tracks=[{id:'a',artist:'A'},{id:'b',artist:'B'}];
 for(const outcome of [true,false]){
  const plays=[1,2,3].map(day=>play('a',outcome,NOW-day*DAY));
  const model=new Taste(tracks,plays,NOW),score=model.score(null,tracks[0]);
  assert.ok(Number.isFinite(score.score));assert.equal(score.probability>.5,outcome);
  assert.equal(model.score(null,tracks[0]).score,new Taste(tracks,[...plays,...plays],NOW).score(null,tracks[0]).score);
 }
 for(const plays of [[],[{...play('a',false,NOW-DAY),heard:90000}],[{...play('a',false,NOW-DAY),skipped:0}]]){
  const model=new Taste(tracks,plays,NOW);for(const track of tracks)assert.ok(Number.isFinite(model.score(null,track).score));
 }
});

test('default time context belongs to the model snapshot, making the same decision reproducible',()=>{
 const tracks=[{id:'a',artist:'A'},{id:'b',artist:'A'}];
 const plays=[1,2,3,4].map(day=>play('a',true,NOW-day*DAY));
 const model=new Taste(tracks,plays,NOW),hour=new Date(NOW).getHours();
 assert.deepEqual(model.score(null,tracks[1]),model.score(null,tracks[1],{},{hour}));
});

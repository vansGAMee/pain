const test=require('node:test'),assert=require('node:assert/strict'),Taste=require('../src/taste-model'),Queue=require('../src/queue-engine');
test('learns real completion and skip fields, generalises to an unheard track by the liked artist',()=>{
 const tracks=[{id:'a',artist:'Liked'},{id:'b',artist:'Skipped'},{id:'newA',artist:'Liked'},{id:'newB',artist:'Skipped'}];
 const now=Date.now(),plays=[];
 for(let i=0;i<18;i++)for(const id of ['a','b'])plays.push({track:id,started:now-(i*2+(id==='a'?1:2))*3600000,duration:180000,heard:id==='a'?180000:6000,finished:id==='a'?1:0});
 const model=new Taste(tracks,plays,now),good=model.score(null,tracks[2]),bad=model.score(null,tracks[3]);
 assert.ok(good.probability>bad.probability+.3);
 const reverse=plays.map(p=>({...p,track:p.track==='a'?'b':'a'})),changed=new Taste(tracks,reverse,now);
 assert.ok(changed.score(null,tracks[3]).probability>changed.score(null,tracks[2]).probability+.3);
 assert.equal(good.bpm,null);
 assert.equal(new Taste(tracks,[...plays,...plays],now).samples,plays.length);
});
test('prefetch agrees with smart next; queue remains isolated and does not repeat before exhaustion',()=>{
 const q=new Queue({shuffleMode:'smart'});q.setContext('library',[{id:'a'},{id:'b'},{id:'c'}],0);
 const peek=q.peekNext().id;assert.equal(q.next().id,peek);const second=q.next().id;assert.notEqual(second,peek);assert.notEqual(second,'a');
});

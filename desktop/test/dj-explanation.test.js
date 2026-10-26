const test=require('node:test'),assert=require('node:assert/strict');
const Explanation=require('../src/dj-explanation');
test('queue records the real tempo reference and like at selection time',()=>{
 const Queue=require('../src/queue-engine');
 const tracks=[{id:'a',title:'Reference',bpm:90},{id:'b',title:'Selected',bpm:180,favorite:true}];
 const q=new Queue({shuffleMode:'smart'});q.setContext('library',tracks,0,'Library');q.next();
 const decision=q.getLastTransition();
 assert.equal(decision.explanation.referenceTitle,null);assert.equal(decision.explanation.referenceBpm,90);
 assert.equal(decision.bpm,180);assert.equal(decision.explanation.liked,true);
 tracks[1].favorite=false;q.setStats({plays:[]});
 assert.equal(decision.explanation.liked,true,'later actions must not rewrite the recorded reason');
});
test('explains the recorded audio reference and octave tempo without claiming genre or accuracy',()=>{
 const decision={reasons:['Близкое звучание','Близкий темп'],bpm:140,explanation:{referenceTitle:'Late night',referenceBpm:70,liked:true}};
 const before=structuredClone(decision),text=Explanation.describe(decision);
 assert.match(text,/Late night/);assert.match(text,/140 BPM/);assert.match(text,/70 BPM/);assert.match(text,/половинного/);assert.match(text,/лайк/);
 assert.match(Explanation.describe(decision,'en'),/half-time/);assert.deepEqual(decision,before);
});
test('missing evidence does not manufacture measurements, a reference or a like',()=>{
 const text=Explanation.describe({reasons:['По вашим прослушиваниям'],bpm:NaN});
 assert.doesNotMatch(text,/BPM|лайк|NaN|undefined/);
 assert.match(Explanation.describe({reasons:[]}),/не сохранена/);
 assert.equal(Explanation.summary({reasons:['unrecognised']}),'');
});
test('saved vibe and session explanations do not incorrectly name the preceding track',()=>{
 const d={reasons:['Звучание сохранённого вайба','В настроении последних прослушанных треков'],explanation:{referenceTitle:'Skipped track'}};
 assert.doesNotMatch(Explanation.describe(d),/Skipped track/);
 assert.match(Explanation.describe(d,'en'),/saved vibe/);
});

const test=require('node:test'),assert=require('node:assert/strict');
const Engine=require('../src/mobile-engine'),Queue=require('../src/queue-engine'),Audio=require('../src/audio-profile'),State=require('../src/dj-state');
const tracks=Array.from({length:12},(_,i)=>({id:'t'+i,title:'Title '+i,artist:'Artist '+i,duration:180000,uri:'content://media/'+i,favorite:i===2?1:0}));
const profile=(t,v=.5)=>({version:4,signature:Audio.signature(t),vector:[.4,.2,.6,.2,.2,.1],variance:Array(6).fill(.01),timbre:Array(12).fill(v),timbreVariance:Array(12).fill(.001),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),updatedAt:1});
const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,profile(t,i<7?.5:.9)]));

test('Android and desktop choose the same sequence with the same inputs, without repeats',()=>{
 const mobile=new Engine();mobile.update({tracks,stats:{plays:[]},profiles});
 const desktop=new Queue({shuffleMode:'smart',loopMode:'off',audioProfiles:profiles,stats:{plays:[]}});desktop.smartSeed=123;desktop.setContext('library',tracks);
 let current=tracks[0].id;const seen=new Set([current]);
 for(let i=0;i<tracks.length;i++){
  const choice=mobile.choose({ids:tracks.map(t=>t.id),current,seed:123}),next=desktop.next();
  assert.equal(choice.next,next?.id||null);
  if(!next)break;assert.ok(!seen.has(next.id));seen.add(next.id);current=next.id;
 }
 assert.equal(seen.size,tracks.length);
});
test('mobile accepts exclusions, scope changes, fast skips and portable vibe bookmarks',()=>{
 const mobile=new Engine();mobile.update({tracks,stats:{plays:[]},profiles,excluded:['t1']});
 mobile.feedback({track:'t0',started:Date.now()-5000,heard:5000,duration:180000,skipped:1});
 const choice=mobile.choose({ids:['t0','t1','t2','t8'],current:'t0',seed:123});
 assert.ok(['t2','t8'].includes(choice.next),'feedback must preserve the allowed scope');
 assert.deepEqual(mobile.q.tasteModel().outcomes.get('t0'),[0,1],'explicit skip is preserved without an invented acoustic penalty');
 const saved=mobile.vibe({action:'save',track:'t2',name:'My sound'});assert.ok(saved.activeId);
 const second=new Engine();second.update({tracks,profiles,vibes:saved});assert.equal(second.vibes.activeId,saved.activeId);
 const released=second.vibe({action:'activate'});assert.equal(released.activeId,null);
 const selected=mobile.choose({ids:['t2','t3'],current:'t2'});assert.equal(selected.next,'t3');
});
test('portable cache merge retains stronger evidence, rejects stale file identity and propagates deleted vibes',()=>{
 const p=profiles.t0,newer={...p,frames:72,seconds:36,positions:Array.from({length:72},(_,i)=>i),updatedAt:2};
 const merged=State.merge({profiles:{t0:newer}},{profiles:{t0:p,corrupt:{vector:[]}}});assert.equal(merged.profiles.t0.frames,72);assert.equal(merged.profiles.corrupt,undefined);
 assert.equal(Audio.get(merged.profiles,{...tracks[0],bytes:100}),null);
 const old={items:[{id:'v',name:'Test',profile:p}],activeId:'v',updatedAt:1},deleted={items:[],activeId:null,updatedAt:2};
 assert.deepEqual(State.merge({vibes:old},{vibes:deleted}).vibes,deleted);
 assert.deepEqual(State.merge({vibes:deleted},{vibes:old}).vibes,deleted);
});
test('native PCM yields cached acoustic evidence, respects budgets and is gain and stereo-phase independent',()=>{
 const measure=(gain,opposite)=>{
  const e=new Engine();e.update({tracks:[tracks[0]],profiles:{}});
  const wave=Array.from({length:2048},(_,i)=>gain*Math.sin(2*Math.PI*700*i/48000));let result;
  for(let i=0;i<=160;i++)result=e.audio({track:'t0',rate:48000,wall:i*500,position:i*500,speed:1,playing:true,channels:[wave,opposite?wave.map(x=>-x):wave]});
  assert.equal(e.profiles.t0.frames,72);assert.equal(result.sampleAfter,null);assert.equal(result.eq.ready,true);
  return e.profiles.t0;
 };
 assert.ok(Audio.similarity(measure(.2,false),measure(.4,true))>.9999);
});

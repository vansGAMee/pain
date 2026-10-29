const test=require('node:test'),assert=require('node:assert/strict');
const EQ=require('../src/auto-eq');
const profile=(vector=[.35,.3,.5,.2,.2,.25],extra={})=>({vector,variance:Array(6).fill(0),frames:40,seconds:20,...extra});
const entries=Array.from({length:32},(_,i)=>({id:String(i),profile:profile([.35,.25+i*.003,.55-i*.002,.2-i*.001,.2,.25])}));
const reference=()=>EQ.createReference(entries);
const low=()=>profile([.35,.85,.1,.05,.1,.1]);

test('no source evidence, metadata fallback, silence or malformed measurements remain neutral',()=>{
 for(const p of [null,{},profile([.4,.3,.5,.2,.2,NaN]),profile(undefined,{frames:4,seconds:2}),
  profile(undefined,{frames:361}),profile(undefined,{frames:20,seconds:100}),profile(undefined,{analysis:{method:'metadata-fallback-v1'}}),profile([0,0,0,0,0,0])]){
  const r=EQ.recommend({},p,null,reference());assert.equal(r.ready,false);assert.deepEqual(r.bands,Array(8).fill(0));assert.equal(r.preamp,0);
 }
});

test('reference is the normalized per-band median, excluding the playing track',()=>{
 const four=entries.slice(0,4),ref=EQ.createReference(four);
 assert.equal(ref.limits('0').count,3);assert.equal(ref.limits('0').target,null);
 const medians=[1,2,3].map(i=>{const a=four.map(e=>e.profile.vector[i]/e.profile.vector.slice(1,4).reduce((a,b)=>a+b)).sort((a,b)=>a-b);return (a[1]+a[2])/2;});
 const sum=medians.reduce((a,b)=>a+b);assert.deepEqual(ref.limits('other').target,medians.map(v=>v/sum));
 const before=JSON.stringify(entries);reference().limits('0');assert.equal(JSON.stringify(entries),before);
});

test('standard power-ratio matching is subtle, signed and repeatable',()=>{
 const ref=reference();
 const result=EQ.recommend({id:'outlier'},low(),null,ref);
 assert.equal(result.adjusted,true);assert.equal(result.referenceTracks,32);
 assert.ok(result.bands[0]<0);assert.ok(result.bands.some(v=>v>0));
 assert.ok(result.bands.every(v=>Math.abs(v)<=1));assert.ok(result.preamp<0);
 assert.ok(result.bands.reduce((a,b)=>a+Math.abs(b),0)<=3,'fallback conservatively bounds overlap');
 assert.deepEqual(EQ.recommend({id:'outlier'},low(),null,ref),result);
 const target=ref.limits('new').target;
 const measured=profile([.35,...target,.2,.25]);
 assert.deepEqual(EQ.recommend({id:'new'},measured,null,ref).bands,Array(8).fill(0));
});

test('the reference comes from this library, not a preset or artist/genre guess',()=>{
 const first=EQ.recommend({},low(),null,reference());assert.equal(first.adjusted,true);
 const bassLibrary=EQ.createReference(Array.from({length:12},(_,i)=>({id:i,profile:profile([.35,.80+i*.005,.15-i*.003,.05-i*.002,.1,.1])})));
 const own=EQ.recommend({title:'anything',artist:'anyone',genre:'made up'},low(),null,bassLibrary);
 assert.ok(Math.abs(own.bands[0])<Math.abs(first.bands[0]));
 for(const ref of [null,EQ.createReference(entries.slice(0,3))]){
  const r=EQ.recommend({},low(),null,ref);assert.equal(r.reason,'reference');assert.deepEqual(r.bands,Array(8).fill(0));
 }
});

test('arrangement variance prevents reacting to a changing intro or a single dominant section',()=>{
 const ref=reference(),stable=EQ.recommend({},low(),null,ref);
 const changing=EQ.recommend({},profile(low().vector,{variance:[0,.25,.25,.25,0,0]}),null,ref);
 assert.equal(stable.adjusted,true);assert.ok(changing.bands.reduce((a,b)=>a+Math.abs(b),0)<stable.bands.reduce((a,b)=>a+Math.abs(b),0));
 for(const variance of [null,[],Array(6).fill(NaN),Array(6).fill(-1)]){
  const r=EQ.recommend({},profile(low().vector,{variance}),null,ref);assert.equal(r.adjusted,false);assert.deepEqual(r.bands,Array(8).fill(0));
 }
});

test('absent ranges are never boosted and source bandwidth is respected',()=>{
 const ref=reference();
 for(const v of [[.35,1,0,0,0,0],[.35,0,0,1,.8,.9],[.35,.01,.04,.95,.8,.8]]){
  const r=EQ.recommend({},profile(v,{analysis:{sampleRate:8000}}),null,ref);
  assert.ok(r.bands.every(v=>Number.isFinite(v)&&Math.abs(v)<=1));assert.equal(r.bands[6],0);assert.equal(r.bands[7],0);
 }
});

test('invalid/duplicate/metadata-only references do not bias the library distribution',()=>{
 const ref=EQ.createReference([...entries,...entries.map(e=>({...e,id:'alias'+e.id})),{id:'bad',profile:profile([NaN,0,0,1,0,0])},{id:'fake',profile:profile(undefined,{analysis:{method:'metadata-fallback-v1'}})}]);
 assert.equal(ref.count,entries.length);assert.deepEqual(ref.limits('outside'),reference().limits('outside'));
 assert.deepEqual(ref.limits('alias0'),ref.limits('0'),'aliases must also exclude their own reference measurement');
});

test('native response enables more precise cuts while failed measurement keeps the conservative bound',()=>{
 const ref=reference(),measure=()=>0;measure.response=()=>({attenuation:2,peak:1.1});
 const precise=EQ.recommend({},low(),measure,ref),fallback=EQ.recommend({},low(),null,ref);
 assert.ok(precise.bands[0]<fallback.bands[0]);
 for(const fn of [()=>NaN,()=>{throw Error('unsupported');}]){
  fn.response=fn;const result=EQ.recommend({},low(),fn,ref);assert.deepEqual(result,fallback);
 }
});


test('rolling EQ follows the current section instead of permanently cutting a whole song',()=>{
 const tracker=EQ.createTracker(),track={id:'changing'},ref=reference();let live;
 for(let i=0;i<20;i++)live=tracker.observe(track,low().vector,.5,i*.5);
 assert.ok(live);assert.equal(EQ.recommend(track,live,null,ref).adjusted,true);
 const centered=[.35,...ref.limits(track.id).target,.2,.25];
 for(let i=20;i<40;i++)live=tracker.observe(track,centered,.5,i*.5);
 assert.equal(EQ.recommend(track,live,null,ref).adjusted,false,'correction must release after the troublesome section has ended');
 assert.equal(tracker.get({id:'other'}),null,'a different song must not inherit the section');
 assert.equal(tracker.observe(track,low().vector,.5,1),null,'seek discards the old section');
 tracker.reset();assert.equal(tracker.get(track),null);
});

test('rolling measurements tolerate half-second timer jitter and reject silence, invalid frames and stalled time',()=>{
 const tracker=EQ.createTracker(),track={id:'jitter'};let live;
 for(let i=0;i<21;i++)live=tracker.observe(track,low().vector,.499,i*.5);
 assert.ok(live);assert.equal(live.frames,21);assert.ok(live.seconds>=10);
 const before=tracker.get(track);
 assert.equal(tracker.observe(track,[NaN,0,0,0,0,0],.5,20),null);assert.deepEqual(tracker.get(track),before);
 assert.equal(tracker.observe(track,low().vector,10,20),null);assert.deepEqual(tracker.get(track),before);
 assert.equal(tracker.observe(track,low().vector,.5,10),null,'stalled/backwards position resets evidence');
});

test('Bass Boost and automatic correction combine; base stays unchanged and headroom covers the sum',()=>{
 const manual={enabled:true,preset:'bass',preamp:0,bands:[6,4,2,0,0,0,0,0]},before=JSON.stringify(manual);
 const correction=EQ.recommend({},low(),null,reference()),combined=EQ.combine(manual,correction);
 assert.deepEqual(combined.bands,manual.bands.map((v,i)=>v+correction.bands[i]));
 assert.equal(combined.preamp,-combined.bands.reduce((s,v)=>s+Math.max(0,v),0));
 assert.equal(JSON.stringify(manual),before);
 assert.deepEqual(EQ.combine({...manual,enabled:false},correction).bands,correction.bands);
 assert.deepEqual(EQ.combine(manual,null).bands,manual.bands);
 assert.ok(EQ.combine({...manual,preamp:-12},correction,()=>3).preamp<=-12);
});

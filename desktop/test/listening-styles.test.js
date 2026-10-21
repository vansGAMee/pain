const test=require('node:test'),assert=require('node:assert/strict');
const Taste=require('../src/taste-model'),Audio=require('../src/audio-profile');
const NOW=Date.UTC(2026,9,21,12),DAY=86400000;
const track=(id,duration=3600000)=>({id,artist:id,duration});
const play=(t,heard,day,extra={})=>({track:t.id,duration:t.duration,started:NOW-day*DAY,heard,skipped:1,...extra});
const profile=(t,n)=>({version:4,signature:Audio.signature(t),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),
 vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbre:Array(12).fill(n),timbreVariance:Array(12).fill(.001)});

test('sustained listening to long music transfers positive sound preference, unlike quick skips',()=>{
 const tracks=[track('mix'),track('rejected'),track('similar',180000),track('unwanted',180000)];
 const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,profile(t,i%2?.8:.2)]));
 const plays=[1,2,3,4].flatMap(day=>[play(tracks[0],180000,day),play(tracks[1],5000,day)]);
 const model=new Taste(tracks,plays,NOW,profiles),near=model.score(null,tracks[2]),far=model.score(null,tracks[3]);
 assert.ok(near.soundPreference>0,'minutes of voluntary listening must not become a lasting dislike');
 assert.ok(far.soundPreference<0,'repeated quick rejection still transfers to similar sound');
 assert.ok(near.score>far.score);
 assert.ok(Math.abs(model.evidence.get('mix').reward/model.evidence.get('mix').count-.75)<1e-12,'partial listening must not count as a full completion');
});

test('interruptions, legacy ambiguity and repeated seeking cannot manufacture long-track approval',()=>{
 const t=track('mix'),profiles={mix:profile(t,.2)};
 const interrupted=new Taste([t],[1,2,3].map(day=>play(t,300000,day,{skipped:0})),NOW,profiles);
 assert.equal(interrupted.samples,0);assert.equal(interrupted.soundPreferences.length,0);
 const legacy=new Taste([t],[1,2,3].map(day=>play(t,180000,day,{skipped:undefined})),NOW,profiles);
 assert.equal(legacy.soundPreferences.length,0);
 const seeking=new Taste([t],[1,2,3].map(day=>play(t,300000,day,{media_heard:10000})),NOW,profiles);
 assert.equal(seeking.soundPreferences.filter(p=>p.polarity>0).length,0);
});

test('ordinary songs retain completion ratios and rapid long-track previews do not reject a whole mood',()=>{
 const short=track('short',180000),a=track('a'),b=track('b');
 const normal=new Taste([short],[play(short,60000,1)],NOW);
 const e=normal.evidence.get(short.id);assert.ok(Math.abs(e.reward/e.count-1/3)<1e-12);
 const quick=new Taste([a,b],[play(a,5000,.0001),play(b,5000,.00005)],NOW);
 assert.equal(quick.recentSkips.length,0);assert.equal(quick.searching,true);
 const full=new Taste([a],[play(a,3600000,1,{finished:1,skipped:0})],NOW);
 const f=full.evidence.get(a.id);assert.equal(f.reward/f.count,1);
});

test('browsing and skipping a familiar song preserve learned sound preference',()=>{
 const a=track('a',180000),b=track('b',180000),near=track('near',180000),tracks=[a,b,near];
 const profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t,.2)]));
 const history=[1,2,3,4].flatMap(day=>[a,b].map(t=>play(t,t.duration,day,{finished:1,skipped:0})));
 const skips=[a,b].map((t,i)=>play(t,5000,0,{started:NOW-20000+i*10000}));
 const model=new Taste(tracks,[...history,...skips],NOW,profiles);
 assert.ok(model.score(null,near).soundPreference>.5,'a browsing burst must not erase repeated enjoyment');
 assert.ok(model.score(null,near).skipPenalty<13,'searching must not blacklist the sound');
 assert.equal(model.trackRejections.size,0);assert.equal(model.recentSkips.length,0);
 const familiar=new Taste(tracks,[...history,skips[0]],NOW,profiles);
 const unfamiliar=new Taste(tracks,[skips[0]],NOW,profiles);
 assert.ok(familiar.score(null,near).skipPenalty<unfamiliar.score(null,near).skipPenalty/2);
 assert.ok(familiar.score(null,near).soundPreference>0);
 const liked={...a,favorite:true};
 assert.ok(new Taste([liked,near],[skips[0]],NOW,profiles).score(null,near).skipPenalty<30);
});

test('long browsing runs keep the last enjoyed sound and never force a discovery turn',()=>{
 const good=track('good',180000),near=track('near',180000),far=track('far',180000),unknown=track('unknown',180000);
 const previews=Array.from({length:8},(_,i)=>track('preview'+i,180000)),tracks=[good,near,far,unknown,...previews];
 const profiles=Object.fromEntries(tracks.filter(t=>t!==unknown).map(t=>[t.id,profile(t,t===far?.8:.2)]));
 const history=[1,2,3].map(day=>play(near,near.duration,day,{finished:1,skipped:0}));
 const accepted=play(good,good.duration,0,{started:NOW-300000,finished:1,skipped:0});
 const skips=previews.map((t,i)=>play(t,5000,0,{started:NOW-80000+i*10000}));
 const plays=[...history,accepted,...skips],before=JSON.stringify(plays),model=new Taste(tracks,plays,NOW,profiles);
 const context={recentTrackIds:previews.slice(-4).reverse().map(t=>t.id)};
 assert.equal(model.score(previews.at(-1),near,{},context).soundSimilarity,1);
 for(const step of [0,1,3,7])for(let seed=1;seed<=30;seed++){
  const pick=model.choose(previews.at(-1),[near,far,unknown],{},{...context,step,seed});
  assert.equal(pick.track.id,near.id);
  assert.ok(!pick.reasons.includes('Открываем новое'));
 }
 assert.equal(new Taste(tracks,[...plays,...skips],NOW,profiles).score(null,near).score,model.score(null,near).score,'sync duplicates must not amplify feedback');
 assert.equal(JSON.stringify(plays),before,'listening records stay untouched');
 assert.equal(new Taste(tracks,plays,NOW+11*60000,profiles).searching,false);
 for(const extra of [{finished:1,heard:180000,skipped:0},{heard:30000,skipped:0}]){
  const ended=new Taste(tracks,[...plays,play(good,5000,0,{started:NOW-1000,...extra})],NOW,profiles);
  assert.equal(ended.searching,false);
 }
});

test('only adjacent distinct quick previews soften feedback; repeated independent rejection still counts',()=>{
 const a=track('a',180000),b=track('b',180000),tracks=[a,b];
 const first=play(a,5000,0,{started:NOW-60000}),second=play(b,5000,0,{started:NOW-15000,skipped:true});
 const quality=(m,id)=>m.evidence.get(id).reward/m.evidence.get(id).count;
 assert.ok(quality(new Taste(tracks,[first,second],NOW),'a')>.4);
 for(const rows of [[first,{...second,started:NOW-14999}],[first,{...second,track:'a'}],[first,{...second,skipped:0}],[first,{...second,heard:40000}],[first,{...second,finished:1}]]){
  assert.ok(quality(new Taste(tracks,rows,NOW),'a')<.1);
 }
 const excluded=new Taste(tracks,[first,second],NOW,{}, {excludedTracks:['b']});
 assert.ok(quality(excluded,'a')<.1);
 const repeated=new Taste(tracks,[1,2,3,4].map(day=>play(a,5000,day)),NOW);
 assert.ok(repeated.score(null,a).rejectionPenalty>10,'independent repeated rejection stays meaningful');
});

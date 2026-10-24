const test=require('node:test'),assert=require('node:assert/strict');
const Audio=require('../src/audio-profile'),Taste=require('../src/taste-model'),Queue=require('../src/queue-engine');
const NOW=Date.UTC(2026,9,23,12);
const song=(id,title='Song '+id,artist='Artist '+id)=>({id,title,artist,bpm:120,duration:180000});
const profile=(track,timbre=.2)=>({version:4,signature:Audio.signature(track),frames:48,seconds:24,
 positions:Array.from({length:48},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
 timbre:Array(12).fill(timbre),timbreVariance:Array(12).fill(.001)});
const finished=(track,age=300000)=>({track:track.id,started:NOW-age,finished:1,heard:180000,duration:180000});
const skipped=track=>({track:track.id,started:NOW-5000,heard:5000,duration:180000,skipped:1});

test('a candidate cannot earn sound or tempo bonuses by becoming its own fallback reference',()=>{
 const candidate=song(7),current=song('current'),tracks=[candidate,current];
 const profiles={7:profile(candidate)};
 for(const plays of [[],[finished(candidate),skipped(current)]]){
  const m=new Taste(tracks,plays,NOW,profiles);
  for(const context of [{recentTrackIds:['7']},{recentTrackIds:[7]}]){
   const pick=m.score(current,candidate,{},context);
   assert.equal(pick.soundSimilarity,null);assert.equal(pick.dist,null);
   assert.equal(pick.explanation.referenceTitle,null);
   assert.ok(!pick.reasons.includes('Близкое звучание'));
   assert.ok(!pick.reasons.includes('Близкий темп'));
  }
 }
 // The searching fallback also uses lastAcceptedTrack without recentTrackIds.
 const m=new Taste(tracks,[finished(candidate),skipped(current)],NOW,profiles);
 assert.equal(m.score(current,candidate).soundSimilarity,null);
 const neighbour=song('neighbour');profiles.neighbour=profile(neighbour);
 assert.equal(m.score(current,neighbour).soundSimilarity,1,'other songs still compare to the accepted sound');
});

test('a self reference keeps the neutral audio scale, not an unscaled history advantage',()=>{
 const t=song('one'),m=new Taste([t],[],NOW,{one:profile(t)}),pick=m.score(t,t);
 assert.equal(pick.soundSimilarity,null);assert.equal(pick.dist,null);
 assert.equal(pick.score,35+.25*(50+5)-9);
 assert.equal(pick.explanation.referenceTitle,null);
 const saved=m.score(t,t,{},{vibeProfile:profile(t)});
 assert.equal(saved.soundSimilarity,1,'an explicitly saved vibe remains a valid target');
 assert.ok(saved.reasons.includes('Звучание сохранённого вайба'));
});

test('the self reference cannot be mistaken for an unanalysed discovery',()=>{
 const anchor=song('anchor','Song','Telegram'),current=song('current'),next=song('next'),tracks=[anchor,current,next];
 const profiles={anchor:profile(anchor),next:profile(next)};
 const m=new Taste(tracks,[finished(anchor)],NOW,profiles);
 for(let seed=1;seed<=20;seed++){
  const pick=m.choose(current,[anchor,next],{},{recentTrackIds:['anchor'],step:7,seed});
  assert.equal(pick.track.id,'next','discovery must not force the already analysed reference back into playback');
 }
});

test('session continuity never counts the candidate as independent supporting evidence',()=>{
 const current=song('current'),other=song('other'),candidate=song('candidate');
 const tracks=[current,other,candidate],profiles={current:profile(current,.2),other:profile(other,.22),candidate:profile(candidate,.24)};
 const m=new Taste(tracks,[finished(other),finished(candidate,200000)],NOW,profiles);
 assert.equal(m.score(current,candidate).soundSimilarity,Audio.similarity(profiles.current,profiles.candidate));
 assert.ok(!m.score(current,candidate).reasons.includes('В настроении последних прослушанных треков'));
});

test('Smart DJ spaces speed edits of one song when a comparable different song is available',()=>{
 for(const suffix of [' - Slowed & Reverbed',' (slowed + reverb)',' — Sped Up',' [sped-up version]']){
  const current=song('current','Faster n Harder'+suffix,'Sassy Scene, 6arelyhuman');
  const version=song('version','Faster n Harder - Sped Up','Sassy Scene, 6arelyhuman');
  const next=song('next','Another song'),tracks=[current,version,next];
  const profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)])),m=new Taste(tracks,[],NOW,profiles);
  for(let seed=1;seed<=30;seed++)assert.equal(m.choose(current,[version,next],{},{seed,step:seed%8}).track.id,'next');
  assert.equal(m.choose(current,[version]).track.id,'version','do not strand a queue containing only edits');
  const q=new Queue({shuffleMode:'smart',loopMode:'off',audioProfiles:profiles});q.setContext('library',tracks,0,'Test');
  assert.equal(q.peekNext().id,'next');assert.equal(q.next().id,'next');
  assert.equal(q.peekNext().id,'version');assert.equal(q.next().id,'version');assert.equal(q.next(),null);
 }
});

test('spacing does not confuse different artists, source tags or meaningful title suffixes',()=>{
 for(const [first,second,artist] of [
  ['Song - Slowed','Song - Sped Up','Different artist'],
  ['Song - Slowed','Song - Sped Up','Telegram'],
  ['Song - Live','Song - Sped Up','Artist'],
  ['Song - Part Two','Song - Sped Up','Artist'],
  ['Slowed','Sped Up','Artist']
 ]){
  const current=song('current',first,artist==='Different artist'?'Artist':artist),version=song('version',second,artist),next=song('next');
  const tracks=[current,version,next],profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)]));
  const m=new Taste(tracks,[],NOW,profiles),choices=new Set();
  for(let seed=1;seed<=50;seed++)choices.add(m.choose(current,[version,next],{},{seed}).track.id);
  assert.ok(choices.has('version'),`${first} / ${second} / ${artist} must not be grouped`);
 }
});

test('a speed edit is not replaced with an unrelated, unknown or explicitly rejected track',()=>{
 const current=song('current','Song - Slowed','Artist'),version=song('version','Song - Sped Up','Artist'),far=song('far');
 const tracks=[current,version,far],profiles={current:profile(current),version:profile(version)};
 for(const farProfile of [null,profile(far,.9),profile(far)]){
  if(farProfile)profiles.far=farProfile;else delete profiles.far;
  const plays=farProfile?.timbre[0]===.2?[skipped(far)]:[];
  const m=new Taste(tracks,plays,NOW,profiles);
  const chosen=m.choose(current,[version,far],{},{seed:1,step:0});
  assert.equal(chosen.track.id,'version');
 }
});

test('a one-song smart queue still loops without claiming similarity to itself',()=>{
 const t=song('one'),q=new Queue({shuffleMode:'smart',loopMode:'all',audioProfiles:{one:profile(t)}});
 q.setContext('library',[t],0,'Test');assert.equal(q.peekNext().id,t.id);assert.equal(q.next().id,t.id);
 assert.ok(!q.getLastTransition().reasons.includes('Близкое звучание'));
 q.setLoopMode('one');assert.equal(q.next().id,t.id);
});

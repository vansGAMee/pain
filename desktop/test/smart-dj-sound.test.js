const test=require('node:test'),assert=require('node:assert/strict');
const Audio=require('../src/audio-profile'),Timbre=require('../src/audio-timbre');
const Taste=require('../src/taste-model'),Queue=require('../src/queue-engine');
const NOW=Date.UTC(2026,9,20,12);
const song=(id,bpm=120)=>({id,artist:'Artist '+id,bpm,duration:180000});
// Equal coarse descriptors/BPM: only the measured spectral envelope differs.
const tone=peak=>Timbre.frame(Float32Array.from({length:1024},(_,i)=>{
 const f=i*48000/2048;return -80+55*Math.exp(-(((f-peak)/350)**2))+12*Math.exp(-(((f-5000)/900)**2));
}),48000);
const profile=(track,peak=700,frames=48)=>({version:4,signature:Audio.signature(track),frames,seconds:frames/2,
 positions:Array.from({length:frames},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),
 timbre:tone(peak),timbreVariance:Array(12).fill(.001)});
const completed=(track,i=1)=>({track:track.id,started:NOW-i*86400000,finished:1,heard:180000,duration:180000});
const skip=track=>({track:track.id,started:NOW-5000,heard:5000,duration:180000,skipped:1});

test('timbre beats BPM, favourite and repeated historical preference for an acoustically distant song',()=>{
 const current=song('current'),near=song('near',95),far={...song('far'),favorite:1};
 const profiles={current:profile(current),near:profile(near,720),far:profile(far,1500)};
 const model=new Taste([current,near,far],Array.from({length:40},(_,i)=>completed(far,i+1)),NOW,profiles);
 const a=model.score(current,near),b=model.score(current,far);
 assert.ok(a.soundSimilarity>b.soundSimilarity+.5);
 assert.ok(a.score>b.score+15,`near ${a.score}, distant favourite ${b.score}`);
 assert.equal(a.reasons[0],'Близкое звучание');
 let matches=0;
 for(let seed=1;seed<=100;seed++)if(model.choose(current,[near,far],{},{seed,step:seed%4}).track.id==='near')matches++;
 assert.ok(matches>=95,`${matches}/100 acoustic matches`);
});

test('sampling varies among strong acoustic neighbours, with stable preview and no forced distant discovery',()=>{
 const current=song('current'),near=Array.from({length:5},(_,i)=>song('near'+i)),far=Array.from({length:7},(_,i)=>song('far'+i));
 const tracks=[current,...near,...far],profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t,t.id.startsWith('far')?1500:700)]));
 // Familiar good fits must not lose to a wholly different unplayed sound every fourth turn.
 const plays=near.flatMap(t=>[completed(t),completed(t,2),completed(t,3)]);
 const model=new Taste(tracks,plays,NOW,profiles),chosen=new Set();
 for(let seed=1;seed<=120;seed++){
  const context={seed,step:seed%4},a=model.choose(current,[...near,...far],{},context);
  assert.ok(a.track.id.startsWith('near'));chosen.add(a.track.id);
  assert.equal(model.choose(current,[...near,...far],{},context).track.id,a.track.id);
 }
 assert.ok(chosen.size>=4,'not stuck on top-1');
 const q=new Queue({shuffleMode:'smart',now:()=>NOW,audioProfiles:profiles,stats:{plays}});
 q.setContext('library',tracks);q.smartSeed=123;
 for(let i=1;i<tracks.length;i++)assert.equal(q.peekNext().id,q.next().id);
});

test('a quick skip suppresses similar timbre across artists even with only two seconds of cached sound',()=>{
 const rejected=song('rejected'),near=song('near'),far=song('far'),tracks=[rejected,near,far];
 const profiles={rejected:profile(rejected,700,4),near:profile(near,720),far:profile(far,1500)};
 const model=new Taste(tracks,[skip(rejected)],NOW,profiles);
 assert.equal(Audio.get(profiles,rejected),null,'provisional sound is not positive evidence');
 assert.ok(model.score(rejected,near).skipPenalty>30);
 assert.ok(model.score(rejected,far).skipPenalty<5);
 let alternatives=0;
 for(let seed=1;seed<=200;seed++)if(model.choose(rejected,[near,far],{},{seed}).track.id==='far')alternatives++;
 assert.ok(alternatives>=180,`${alternatives}/200 choices move away from rejected sound`);
 for(const [plays,now] of [[[skip(rejected)],NOW+31*60000],[[{...skip(rejected),skipped:0}],NOW],[[{...skip(rejected),heard:500}],NOW],[[skip(rejected),{...completed(rejected),started:NOW-1000}],NOW]]){
  assert.equal(new Taste(tracks,plays,now,profiles).score(null,near).skipPenalty,0);
 }
});

test('after a skip, recent accepted sound anchors the transition; missing and replaced files remain safe',()=>{
 const good=song('good'),rejected=song('rejected'),near=song('near'),unknown=song('unknown');
 const tracks=[good,rejected,near,unknown],profiles={good:profile(good),rejected:profile(rejected,1500),near:profile(near)};
 const model=new Taste(tracks,[completed(good),skip(rejected)],NOW,profiles);
 assert.equal(model.score(rejected,near,{}, {recentTrackIds:['rejected','good']}).soundSimilarity,1);
 assert.equal(model.score(good,unknown).soundSimilarity,null);
 assert.ok(model.score(good,near).score>model.score(good,unknown).score);
 assert.equal(model.score(good,{...near,bytes:99}).soundSimilarity,null);
 const empty=new Taste(tracks,[],NOW,{});
 assert.equal(empty.score(good,near).soundSimilarity,null);
 assert.ok(Number.isFinite(empty.choose(good,[near,unknown]).score));
});

test('equally fitting songs beyond the first six can be selected without destabilizing preview',()=>{
 const tracks=Array.from({length:21},(_,i)=>song('equal'+i));
 const profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)]));
 const model=new Taste(tracks,[],NOW,profiles),choices=new Set();
 for(let seed=1;seed<=100;seed++){
  const a=model.choose(tracks[0],tracks.slice(1),{},{seed});choices.add(a.track.id);
  assert.equal(model.choose(tracks[0],tracks.slice(1),{},{seed}).track.id,a.track.id);
 }
 assert.ok(choices.size>15,`only ${choices.size} equally good songs explored`);
 const excluded=new Taste(tracks,[],NOW,profiles,{excludedTracks:[tracks[0].id]});
 assert.equal(excluded.score(tracks[0],tracks[1]).soundSimilarity,null);
});

test('excluded songs never re-enter an exhausted smart queue, including forward navigation',()=>{
 const tracks=['a','b','c'].map(id=>song(id));
 for(const loopMode of ['off','all']){
  const q=new Queue({shuffleMode:'smart',loopMode,excludedTracks:['b','c']});q.setContext('library',tracks);
  assert.equal(q.peekNext()?.id,loopMode==='all'?'a':undefined);
  assert.equal(q.next()?.id,loopMode==='all'?'a':undefined);
  q.excludeTrack('a');assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
 }
 const q=new Queue({shuffleMode:'smart',loopMode:'off',excludedTracks:['c']});q.setContext('library',tracks);
 assert.equal(q.next().id,'b');assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
 q.prev();q.excludeTrack('b');assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
 q.unexcludeTrack('b');q.setLoopMode('all');assert.equal(q.peekNext().id,'b');assert.equal(q.next().id,'b');
});

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

test('an accepted sound resolves conflicting preview penalties without erasing durable feedback',()=>{
 const a=song('a'),b=song('b'),found=song('found'),next=song('next');
 const tracks=[a,b,found,next],profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)]));
 const browsing=[{...skip(a),started:NOW-300000},{...skip(b),started:NOW-290000}];
 const success={...completed(found),started:NOW-270000};
 const before=new Taste(tracks,browsing,NOW,profiles);
 const after=new Taste(tracks,[...browsing,success],NOW,profiles);
 assert.ok(before.score(found,next).skipPenalty>0);
 assert.equal(after.score(found,next).skipPenalty,0);
 assert.deepEqual(after.evidence.get(a.id),before.evidence.get(a.id),'do not rewrite historical feedback');
 assert.equal(after.evidence.get(b.id).count,before.evidence.get(b.id).count);
 assert.equal(new Taste(tracks,[success,...browsing,success],NOW,profiles).score(found,next).skipPenalty,0,'sync duplicates and ordering are harmless');
 for(const ending of [{...success,finished:0,skipped:0,heard:5000},{...success,finished:0,skipped:1,heard:5000}]){
  assert.ok(new Taste(tracks,[...browsing,ending],NOW,profiles).score(found,next).skipPenalty>0,'an interruption or more browsing is not success');
 }
 const excluded=new Taste(tracks,[...browsing,success],NOW,profiles,{excludedTracks:[found.id]});
 assert.ok(excluded.score(null,next).skipPenalty>0,'excluded feedback cannot end a search');
 const missing={...profiles};delete missing.found;
 assert.ok(new Taste(tracks,[...browsing,success],NOW,missing).score(null,next).skipPenalty>0,'missing audio must not invent a successful sound match');
 const different={...profiles,found:profile(found,1500)};
 assert.equal(new Taste(tracks,[...browsing,success],NOW,different).score(found,next).skipPenalty,before.score(found,next).skipPenalty,'a different chosen sound must not pardon the skipped direction');
});

test('finding a song retains confident refusals and later skips still apply',()=>{
 const rejected=song('rejected'),found=song('found'),next=song('next');
 const tracks=[rejected,found,next],profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t)]));
 const refusal={...skip(rejected),started:NOW-300000};
 const success={...completed(found),started:NOW-270000};
 const before=new Taste(tracks,[refusal],NOW,profiles),after=new Taste(tracks,[refusal,success],NOW,profiles);
 assert.equal(after.score(found,next).skipPenalty,before.score(found,next).skipPenalty);
 const familiar={...rejected,favorite:1};
 assert.equal(new Taste([familiar,found,next],[refusal,success],NOW,profiles).score(found,next).skipPenalty,0);
 assert.ok(new Taste([familiar,found,next],[refusal,success,skip(rejected)],NOW,profiles).score(found,next).skipPenalty>0);
});

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

test('an incomplete timbre profile cannot gain extra history weight against a measured acoustic match',()=>{
 const current=song('current'),near=song('near'),coarse={...song('coarse'),favorite:1};
 const profiles={current:profile(current),near:profile(near),coarse:{...profile(coarse),timbre:null,timbreVariance:null}};
 const model=new Taste([current,near,coarse],Array.from({length:80},(_,i)=>completed(coarse,i+1)),NOW,profiles);
 assert.ok(model.score(current,near).score>model.score(current,coarse).score,
  'missing timbre should reduce confidence, not amplify habitual favourites');
 for(const candidate of [near,coarse,song('unknown')])assert.ok(Number.isFinite(model.score(current,candidate).score));
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

test('unusable skipped profiles do not erase recent acoustic rejection, and only three usable skips count',()=>{
 const rejected=song('rejected'),near=song('near'),far=song('far');
 const unknown=song('unknown'),stale=song('stale'),brief=song('brief');
 const later=Array.from({length:3},(_,i)=>song('later'+i));
 const tracks=[rejected,near,far,unknown,stale,brief,...later];
 const profiles={rejected:profile(rejected,700,4),near:profile(near,720),far:profile(far,1500),
  stale:profile({...stale,bytes:99}),brief:profile(brief,700,2),
  ...Object.fromEntries(later.map(t=>[t.id,profile(t,1500)]))};
 // Independent skips, rather than a rapid browsing burst (which is deliberately weak).
 const plays=[rejected,unknown,stale,brief].map((t,i)=>({...skip(t),started:NOW-240000+i*60000}));
 const model=new Taste(tracks,plays,NOW,profiles);
 const original=new Taste(tracks,[plays[0]],NOW,profiles);
 assert.ok(original.score(null,near).skipPenalty>0);
 assert.equal(model.score(null,near).skipPenalty,original.score(null,near).skipPenalty,'unmeasured skips must not erase rejected sound');
 assert.ok(model.score(null,far).skipPenalty<5,'different timbre stays available');
 let alternatives=0;
 for(let seed=1;seed<=100;seed++)if(model.choose(null,[near,far],{},{seed}).track.id==='far')alternatives++;
 assert.ok(alternatives>=90,`${alternatives}/100 choices respect rejected sound`);
 const newer=later.map((t,i)=>({...skip(t),started:NOW+60000+i*60000}));
 const bounded=new Taste(tracks,[...plays,...newer],NOW+185000,profiles);
 assert.equal(bounded.soundSkips.length,3);
 assert.ok(bounded.score(null,near).skipPenalty<5,'older rejection yields to three newer usable skips');
 assert.ok(bounded.score(null,far).skipPenalty>60);
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

test('unmeasured songs get a bounded discovery turn without changing normal acoustic choices',()=>{
 const current=song('current'),near=song('near'),unknown=Array.from({length:9},(_,i)=>song('unknown'+i));
 const tracks=[current,near,...unknown],profiles={current:profile(current),near:profile(near)};
 const model=new Taste(tracks,[],NOW,profiles),chosen=new Set();
 for(let step=0;step<32;step++){
  const context={seed:step+17,step},pick=model.choose(current,[near,...unknown],{},context);
  assert.equal(pick.track.id==='near',step%8!==7);
  assert.equal(pick.track.id,model.choose(current,[near,...unknown],{},context).track.id);
 }
 for(let seed=1;seed<=40;seed++)chosen.add(model.choose(current,[near,...unknown],{},{seed,step:7}).track.id);
 assert.ok(chosen.size>=5,'discovery must not stay on the first unmeasured song');
 assert.equal(model.choose(current,[near],{},{step:7}).track.id,'near');
 assert.equal(model.choose(current,[],{},{step:7}),null);
 const q=new Queue({shuffleMode:'smart',now:()=>NOW,audioProfiles:profiles});q.setContext('library',tracks);q.smartStep=7;
 const preview=q.peekNext();assert.ok(preview.id.startsWith('unknown'));assert.equal(q.next().id,preview.id);
 const visited=new Set([current.id,preview.id]);
 for(let i=2;i<tracks.length;i++){const next=q.next();assert.ok(next);assert.ok(!visited.has(next.id));visited.add(next.id);}
});

test('unmeasured discovery respects rejection, exclusions and provisional acoustic skip evidence',()=>{
 const current=song('current'),near=song('near'),rejected=song('rejected'),excluded=song('excluded'),partial=song('partial'),oldSkip=song('oldSkip');
 const tracks=[current,near,rejected,excluded,partial,oldSkip];
 const profiles={current:profile(current,1500),near:profile(near,1500),rejected:profile(rejected,700,4),partial:profile(partial,700,4)};
 const plays=[{...skip(oldSkip),started:NOW-86400000},skip(rejected),{...completed(current),started:NOW-1000}];
 const model=new Taste(tracks,plays,NOW,profiles,{excludedTracks:[excluded.id]});
 assert.ok(model.score(current,partial).skipPenalty>0);
 for(let seed=1;seed<=20;seed++)assert.equal(model.choose(current,tracks.slice(1),{},{seed,step:7}).track.id,'near');
 // A newly skipped song with no profile must not be mistaken for a discovery candidate.
 const unknown=song('unknown');
 const recent=new Taste([current,near,unknown],[skip(unknown)],NOW,profiles);
 assert.equal(recent.choose(current,[near,unknown],{},{step:7}).track.id,'near');
 const accepted=new Taste([current,near,unknown],[{...skip(unknown),started:NOW-10000},{...completed(unknown),started:NOW-1000}],NOW,profiles);
 assert.equal(accepted.choose(current,[near,unknown],{},{step:7}).track.id,'unknown');
 const allExcluded=new Taste(tracks,[],NOW,profiles,{excludedTracks:tracks.map(t=>t.id)});
 assert.equal(allExcluded.choose(current,tracks,{},{step:7}),null);
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

test('accepted session recordings hold a nuanced vibe without averaging opposite styles',()=>{
 const current=song('bridge'),a=song('a'),b=song('b'),near=song('near'),drift=song('drift');
 const tracks=[current,a,b,near,drift],profiles={bridge:profile(current,780),a:profile(a,700),b:profile(b,720),near:profile(near,710),drift:profile(drift,860)};
 const plays=[a,b].map((t,i)=>({...completed(t),started:NOW-(i+1)*240000}));
 const model=new Taste(tracks,plays,NOW,profiles),baseline=new Taste(tracks,[],NOW,profiles);
 const context={recentTrackIds:['a','b']};
 const improvement=(m)=>m.score(current,near,{},context).soundSimilarity-m.score(current,drift,{},context).soundSimilarity;
 assert.ok(improvement(model)>improvement(baseline)+.05,'sustained accepted sound resists drifting to the other side of a bridge track');
 // A deliberate change to a distant style or a frozen reference must win over old mood.
 const frozen={vibeProfile:profiles.drift};
 assert.equal(model.score(current,near,{},frozen).soundSimilarity,baseline.score(current,near,{},frozen).soundSimilarity);
 const changed={...profiles,bridge:profile(current,2000)};
 assert.equal(new Taste(tracks,plays,NOW,changed).score(current,near).soundSimilarity,new Taste(tracks,[],NOW,changed).score(current,near).soundSimilarity);
 for(const rows of [plays.map(p=>({...p,started:p.started-3600000})),plays.map(p=>({...p,finished:0,heard:5000,skipped:1}))]){
  assert.equal(new Taste(tracks,rows,NOW,profiles).score(current,near).soundSimilarity,baseline.score(current,near).soundSimilarity);
 }
 const excluded=new Taste(tracks,plays,NOW,profiles,{excludedTracks:['a']});
 assert.equal(excluded.score(current,near).soundSimilarity,baseline.score(current,near).soundSimilarity);
});

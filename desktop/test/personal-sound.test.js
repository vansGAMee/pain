const test=require('node:test'),assert=require('node:assert/strict');
const Taste=require('../src/taste-model'),Audio=require('../src/audio-profile'),Timbre=require('../src/audio-timbre'),Queue=require('../src/queue-engine');
const NOW=Date.UTC(2026,9,20,12),DAY=86400000;
const track=id=>({id,artist:'Artist '+id,duration:180000,bpm:120});
const profile=(song,peak)=>({version:4,signature:Audio.signature(song),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),
 vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbreVariance:Array(12).fill(.001),
 timbre:Timbre.frame(Float32Array.from({length:1024},(_,i)=>{const f=i*48000/2048;return -80+55*Math.exp(-(((f-peak)/350)**2))+12*Math.exp(-(((f-5000)/900)**2));}),48000)});
const play=(song,day,good)=>({track:song.id,started:NOW-day*DAY,duration:180000,heard:good?180000:5000,finished:good?1:0,skipped:good?0:1});
function fixture(){
 const [liked,rejected,newGood,newBad]=['liked','rejected','newGood','newBad'].map(track),tracks=[liked,rejected,newGood,newBad];
 const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,profile(t,i%2?1500:700)]));
 const plays=Array.from({length:6},(_,i)=>[play(liked,i+1,true),play(rejected,i+1,false)]).flat();
 return {liked,rejected,newGood,newBad,tracks,profiles,plays};
}

test('repeated listening and skips transfer to unheard timbre across unrelated artists',()=>{
 const f=fixture(),m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 assert.ok(m.score(null,f.newGood).soundPreference>.8);
 assert.ok(m.score(null,f.newBad).soundPreference<-.8);
 assert.ok(m.score(null,f.newGood).score>m.score(null,f.newBad).score+25);
 let good=0;
 for(let seed=1;seed<=100;seed++)if(m.choose(null,[f.newGood,f.newBad],{},{seed}).track.id===f.newGood.id)good++;
 assert.ok(good>=90,`${good}/100 choices reflect learned sound`);
 // Reversing the listening outcomes must reverse preference, not the track tags.
 const reversed=f.plays.map(p=>({...p,heard:p.finished?5000:180000,finished:p.finished?0:1,skipped:p.finished?1:0}));
 const other=new Taste(f.tracks,reversed,NOW,f.profiles);
 assert.ok(other.score(null,f.newGood).soundPreference<-.8);
 assert.ok(other.score(null,f.newBad).soundPreference>.8);
});

test('one skip, pauses, sync duplicates, stale profiles and exclusions cannot define a lasting sound dislike',()=>{
 const f=fixture(),one=play(f.rejected,1,false);
 for(const plays of [[one],Array(20).fill(one),[1,2,3].map(day=>({...play(f.rejected,day,false),skipped:0}))]){
  const m=new Taste(f.tracks,plays,NOW,f.profiles);
  assert.equal(m.score(null,f.newBad).soundPreference,0);
  assert.equal(m.score(null,f.rejected).rejectionPenalty,0);
 }
 const excluded=new Taste(f.tracks,f.plays,NOW,f.profiles,{excludedTracks:[f.liked.id,f.rejected.id]});
 assert.equal(excluded.score(null,f.newBad).soundPreference,0);
 const stale={...f.profiles,rejected:{...f.profiles.rejected,signature:'replaced file'}};
 assert.equal(new Taste(f.tracks,f.plays,NOW,stale).score(null,f.newBad).soundPreference,0);
 const noCache=new Taste(f.tracks,f.plays,NOW,{});
 assert.equal(noCache.score(null,f.newGood).soundPreference,0);
 assert.ok(Number.isFinite(noCache.score(null,f.newBad).score));
});

test('repeatedly rejected tracks stay down after the short skip window, but recover on completion and with time',()=>{
 const f=fixture(),m=new Taste(f.tracks,f.plays,NOW,f.profiles);
 const rejected=m.score(f.newBad,f.rejected);
 assert.equal(rejected.skipPenalty,0);assert.ok(rejected.rejectionPenalty>20);
 assert.equal(m.choose(null,[f.rejected]).track.id,f.rejected.id,'a restricted queue must still play');
 const recovered=new Taste(f.tracks,[...f.plays,play(f.rejected,.001,true)],NOW,f.profiles);
 assert.equal(recovered.score(null,f.rejected).rejectionPenalty,0);
 assert.ok(recovered.score(null,f.newBad).soundPreference>=0);
 const old=new Taste(f.tracks,f.plays,NOW+180*DAY,f.profiles);
 assert.equal(old.score(null,f.rejected).rejectionPenalty,0);
 assert.equal(old.score(null,f.newBad).soundPreference,0);
});

test('opposite liked styles remain separate and acoustic feedback stays bounded and deterministic',()=>{
 const f=fixture(),allLiked=f.plays.map(p=>({...p,heard:180000,finished:1,skipped:0}));
 const m=new Taste(f.tracks,allLiked,NOW,f.profiles);
 assert.ok(m.score(null,f.newGood).soundPreference>.8);assert.ok(m.score(null,f.newBad).soundPreference>.8);
 const tracks=Array.from({length:60},(_,i)=>track('s'+i));
 const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,profile(t,i%2?1500:700)]));
 const plays=tracks.flatMap((t,i)=>[1,2,3].map(day=>play(t,day,i%2===0)));
 const bounded=new Taste(tracks,plays,NOW,profiles);
 assert.ok(bounded.soundPreferences.length>0&&bounded.soundPreferences.length<=24);
 for(const t of tracks){const a=bounded.score(null,t),b=bounded.score(null,t);assert.deepEqual(a,b);assert.ok(Math.abs(a.soundPreference)<=1);}
 const q=new Queue({shuffleMode:'smart',loopMode:'off',now:()=>NOW,audioProfiles:profiles,stats:{plays}});
 q.setContext('library',tracks);q.smartSeed=42;const seen=new Set([q.getCurrentTrack().id]);
 for(let i=1;i<tracks.length;i++){const preview=q.peekNext(),next=q.next();assert.equal(preview.id,next.id);assert.ok(!seen.has(next.id));seen.add(next.id);}
 assert.equal(q.next(),null);
});

test('many near-identical favourites cannot evict a second liked sound from the bounded memory',()=>{
 const copies=Array.from({length:20},(_,i)=>track('copy'+i)),other=track('other'),unheard=track('unheard');
 const tracks=[...copies,other,unheard],profiles=Object.fromEntries(tracks.map(t=>[t.id,profile(t,t.id.startsWith('copy')?700:1500)]));
 const plays=[...copies.flatMap(t=>[1,2,3,4,5,6].map(day=>play(t,day,true))),...[1,2,3].map(day=>play(other,day,true))];
 const m=new Taste(tracks,plays,NOW,profiles);
 assert.ok(m.score(null,unheard).soundPreference>.4);
 assert.equal(m.soundPreferences.length,2,'keep representatives of both sounds');
});

test('many distinct variations of a frequent style cannot erase a less frequent confirmed taste',()=>{
 const frequent=Array.from({length:12},(_,i)=>track('frequent'+i)),rare=track('rare'),unheard=track('unheard');
 const tracks=[...frequent,rare,unheard],profiles=Object.fromEntries(tracks.map((t,i)=>{
  const p=profile(t,700);p.timbre=Array(12).fill(i<12?.2:.8);
  if(i<12)p.timbre[i]=.32;
  return [t.id,p];
 }));
 const history=[...frequent.flatMap(t=>[1,2,3,4,5,6].map(day=>play(t,day,true))),...[1,2,3].map(day=>play(rare,day,true))];
 const model=new Taste(tracks,history,NOW,profiles);
 assert.ok(model.score(null,unheard).soundPreference>.4,'a repeated but less frequent taste must remain audible');
 assert.ok(model.soundPreferences.some(p=>p.id===rare.id));
 assert.equal(model.soundPreferences.length,12,'memory and scoring cost stay bounded');
 // Diversity is not an assumption that every style is liked: reverse the evidence.
 const rejected=history.map(p=>p.track===rare.id?{...p,finished:0,skipped:1,heard:5000}:p);
 assert.ok(new Taste(tracks,rejected,NOW,profiles).score(null,unheard).soundPreference<-.4);
 const excluded=new Taste(tracks,history,NOW,profiles,{excludedTracks:[rare.id]});
 assert.equal(excluded.score(null,unheard).soundPreference,0);
 const reversed=new Taste([...tracks].reverse(),[...history].reverse(),NOW,profiles);
 assert.equal(reversed.score(null,unheard).soundPreference,model.score(null,unheard).soundPreference);
});

test('skipping several minutes into a long recording is not a quick-skip mood pivot',()=>{
 const tracks=[track('a'),track('b')].map(t=>({...t,duration:3600000}));
 const plays=tracks.map((t,i)=>({...play(t,.001+i*.001,false),duration:t.duration,heard:120000}));
 const m=new Taste(tracks,plays,NOW);
 assert.deepEqual(m.recentSkips,[]);assert.equal(m.trackRejections.size,0);
});

test('cold start transfers a first accepted sound gently, and follows the actual listener',()=>{
 const f=fixture(),first=play(f.liked,.001,true);
 const model=new Taste(f.tracks,[first],NOW,f.profiles);
 const near=model.score(null,f.newGood),far=model.score(null,f.newBad);
 assert.ok(near.soundPreference>.15&&near.soundPreference<=.25);
 assert.equal(far.soundPreference,0);assert.ok(near.score>far.score);
 assert.equal(model.soundPreferences.length,1);assert.equal(model.soundPreferences[0].provisional,true);
 // A listener who starts with the opposite sound gets the opposite encouragement.
 const other=new Taste(f.tracks,[play(f.rejected,.001,true)],NOW,f.profiles);
 assert.ok(other.score(null,f.newBad).soundPreference>.15);assert.equal(other.score(null,f.newGood).soundPreference,0);
 const duplicated=new Taste(f.tracks,Array(20).fill(first),NOW,f.profiles);
 assert.deepEqual(duplicated.score(null,f.newGood),near,'sync copies must not accelerate or amplify taste');
});

test('cold-start encouragement fades away; repeated feedback keeps its established weight',()=>{
 const f=fixture(),first=play(f.liked,.001,true),neutral=track('neutral'),tracks=[...f.tracks,neutral];
 const notes=Array.from({length:11},(_,i)=>({...play(neutral,1+i*.01,false),heard:60000}));
 const early=new Taste(tracks,[first],NOW,f.profiles),later=new Taste(tracks,[first,...notes.slice(0,6)],NOW,f.profiles);
 assert.ok(later.score(null,f.newGood).soundPreference>0);
 assert.ok(later.score(null,f.newGood).soundPreference<early.score(null,f.newGood).soundPreference/2);
 const established=new Taste(tracks,[first,...notes],NOW,f.profiles);
 assert.equal(established.samples,12);assert.equal(established.score(null,f.newGood).soundPreference,0);
 assert.equal(established.soundPreferences.some(p=>p.provisional),false);
 const confirmed=new Taste(f.tracks,f.plays,NOW,f.profiles);
 assert.equal(confirmed.soundPreferences.some(p=>p.provisional),false);
 assert.ok(confirmed.score(null,f.newGood).soundPreference>.8);
});

test('cold start cannot invent sound from tags, pauses, skips, stale data or exclusions',()=>{
 const f=fixture();
 for(const rows of [[play(f.liked,.001,false)],[{...play(f.liked,.001,false),skipped:0}],[play(f.liked,8,true)]]){
  assert.equal(new Taste(f.tracks,rows,NOW,f.profiles).score(null,f.newGood).soundPreference,0);
 }
 const first=play(f.liked,.001,true);
 for(const profiles of [{},{...f.profiles,liked:{...f.profiles.liked,signature:'replaced'}},{...f.profiles,liked:{...f.profiles.liked,timbre:null,timbreVariance:null}}]){
  assert.equal(new Taste(f.tracks,[first],NOW,profiles).score(null,f.newGood).soundPreference,0);
 }
 const excluded=new Taste(f.tracks,[first],NOW,f.profiles,{excludedTracks:[f.liked.id]});
 assert.equal(excluded.score(null,f.newGood).soundPreference,0);
 const browsing=[first,{...play(f.liked,0,false),started:NOW-5000}];
 assert.ok(new Taste(f.tracks,browsing,NOW,f.profiles).score(null,f.newGood).soundPreference>0,'a familiar-song preview must not erase the first good evidence');
 const q=new Queue({shuffleMode:'smart',loopMode:'off',now:()=>NOW,audioProfiles:f.profiles,stats:{plays:[first]}});
 q.setContext('library',f.tracks);q.smartSeed=42;const seen=new Set([q.getCurrentTrack().id]);
 for(let i=1;i<f.tracks.length;i++){const preview=q.peekNext(),next=q.next();assert.equal(preview.id,next.id);assert.ok(!seen.has(next.id));seen.add(next.id);}
});

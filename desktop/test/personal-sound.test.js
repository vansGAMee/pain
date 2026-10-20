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

test('skipping several minutes into a long recording is not a quick-skip mood pivot',()=>{
 const tracks=[track('a'),track('b')].map(t=>({...t,duration:3600000}));
 const plays=tracks.map((t,i)=>({...play(t,.001+i*.001,false),duration:t.duration,heard:120000}));
 const m=new Taste(tracks,plays,NOW);
 assert.deepEqual(m.recentSkips,[]);assert.equal(m.trackRejections.size,0);
});


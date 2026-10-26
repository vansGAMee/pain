const test=require('node:test'),assert=require('node:assert/strict');
const Model=require('../src/recommendation-model'),Audio=require('../src/audio-profile');
const now=100000,tracks=[{id:'a'},{id:'b'},{id:'c'}];
const profile=(track,value)=>({version:4,signature:Audio.signature(track),frames:48,seconds:24,positions:Array.from({length:48},(_,i)=>i),
 vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbre:Array(12).fill(value),timbreVariance:Array(12).fill(.001)});

test('no audio: ranking is the completed-frequency baseline; duplicates, future and unknown outcomes are not positives',()=>{
 const plays=[{track:'b',started:10,finished:1},{track:'b',started:10,skipped:1},{track:'b',started:20,finished:1},
  {track:'c',started:30,skipped:1},{track:'c',started:40},{track:'c',started:now+1,finished:1}];
 const m=new Model(tracks,plays,now);
 assert.equal(m.score(tracks[0],tracks[1]).score,Math.log(3));
 assert.equal(m.score(tracks[0],tracks[2]).score,0);
 assert.equal(m.score(tracks[0],tracks[2]).probability,1/3);
 assert.equal(m.score(tracks[0],tracks[2]).soundSimilarity,null);
 assert.deepEqual(new Model(tracks,null,now).distribution(null,[]),[]);
});

test('renaming metadata never invents sound, mood, key or tempo',()=>{
 const a=new Model(tracks,[],now).score(tracks[0],tracks[1]);
 const renamed=tracks.map(t=>({...t,title:'Vivaldi phonk '+t.id,artist:'Random',genre:'Rock'}));
 const b=new Model(renamed,[],now).score(renamed[0],renamed[1]);
 assert.equal(a.score,b.score);assert.equal(b.soundSimilarity,null);assert.equal(b.bpm,null);
 assert.equal(b.explanation.referenceTitle,null);
});

test('measured Gaussian likelihood uses data covariance and Scott bandwidth; vibe changes the reference',()=>{
 const profiles={a:profile(tracks[0],.2),b:profile(tracks[1],.2),c:profile(tracks[2],.8)};
 const m=new Model(tracks,[],now,profiles);
 assert.equal(m.score(tracks[0],tracks[1]).soundSimilarity,1);
 assert.ok(m.score(tracks[0],tracks[2]).score<m.score(tracks[0],tracks[1]).score);
 assert.ok(m.score(tracks[0],tracks[2],{},{vibeProfile:profiles.c}).score>m.score(tracks[0],tracks[1],{},{vibeProfile:profiles.c}).score);
 const rows=m.distribution(tracks[0],tracks.slice(1));
 assert.ok(Math.abs(rows.reduce((s,r)=>s+r.weight,0)-1)<1e-12);
 assert.equal(m.choose(tracks[0],tracks.slice(1),{},{seed:123}).track.id,m.choose(tracks[0],tracks.slice(1),{},{seed:123}).track.id);
 assert.equal(m.choose(tracks[0],tracks.slice(1),{},{excludedTracks:new Set(['b','c'])}),null);
});

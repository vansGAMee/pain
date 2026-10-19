const test=require('node:test'),assert=require('node:assert/strict');
const Queue=require('../src/queue-engine'),Taste=require('../src/taste-model');
const NOW=new Date(2026,9,19,15).getTime(),DAY=86400000;
const tracks=Array.from({length:24},(_,i)=>({id:'t'+i,artist:'Artist '+(i%8),duration:180000}));
const complete=(id,stamp)=>({track:id,started:stamp,duration:180000,heard:180000,finished:1});

test('100 smart-shuffle cycles stay complete, bounded and predictable at cycle boundaries',()=>{
 let now=NOW;const plays=[];
 for(let day=1;day<10;day++)for(let i=0;i<tracks.length;i++)plays.push(complete(tracks[i].id,NOW-day*DAY+i*180000));
 const q=new Queue({shuffleMode:'smart',loopMode:'all',stats:{plays},now:()=>now});q.setContext('library',tracks);q.smartSeed=123;
 for(let cycle=0;cycle<100;cycle++){
  const seen=new Set(cycle===0?[q.getCurrentTrack().id]:[]);
  for(let i=seen.size;i<tracks.length;i++){
   const current=q.getCurrentTrack(),preview=q.peekNext(),next=q.next();
   assert.equal(next.id,preview.id);assert.notEqual(next.id,current.id);
   assert.ok(!seen.has(next.id),`early repeat in cycle ${cycle}`);seen.add(next.id);
  }
  assert.equal(seen.size,tracks.length);assert.equal(q.unplayedIndices.size,0);
  assert.ok(q.playedHistory.length<=500);assert.ok(q.recentArtists.length<=30);
 }
 q.setLoopMode('off');assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
});

test('back/forward retraces history, including the transition between shuffle cycles',()=>{
 const q=new Queue({shuffleMode:'smart',loopMode:'all',now:()=>NOW});q.setContext('library',tracks.slice(0,3));
 const visited=[q.getCurrentTrack()];for(let i=0;i<7;i++)visited.push(q.next());
 for(let i=visited.length-2;i>=0;i--)assert.equal(q.prev().id,visited[i].id);
 for(let i=1;i<visited.length;i++){assert.equal(q.peekNext().id,visited[i].id);assert.equal(q.next().id,visited[i].id);}
 q.prev();q.jumpToTrack('t2');assert.equal(q.forwardHistory.length,0);
});

test('library changes and duplicated imports cannot leak deleted tracks into a new context',()=>{
 const q=new Queue({shuffleMode:'smart',loopMode:'off'});
 q.setContext('library',[tracks[0],null,tracks[0],tracks[1],tracks[2]],3);
 assert.equal(q.getCurrentTrack().id,'t1');assert.equal(q.getTracks().length,3);
 q.next();q.prev();q.setContext('playlist',[tracks[3],tracks[4]],0,'New playlist');
 assert.equal(q.forwardHistory.length,0);assert.equal(q.next().id,'t4');assert.equal(q.next(),null);
 q.setContext('library',[]);assert.equal(q.next(),null);assert.equal(q.prev(),null);assert.equal(q.peekNext(),null);
});

test('sync duplicates, malformed records and future timestamps do not poison learned taste',()=>{
 const a=complete('t0',NOW-DAY),b=complete('t1',NOW-2*DAY);
 const dirty=[null,{},42,{track:'t0',started:Infinity,finished:1},{track:'t0',started:NOW+DAY,finished:1},b,...Array(7000).fill(a)];
 const clean=new Taste(tracks,[a,b],NOW),model=new Taste(tracks,dirty,NOW);
 assert.equal(model.samples,2);
 for(const track of tracks)assert.equal(model.score(null,track).score,clean.score(null,track).score);
 const partial={...a,finished:0,heard:5000,skipped:1};
 for(const history of [[partial,a],[a,partial]])assert.equal(new Taste(tracks,history,NOW).score(null,tracks[0]).probability,new Taste(tracks,[a],NOW).score(null,tracks[0]).probability);
});

test('closing the app mid-song does not train dislike; intentional skips still do',()=>{
 const library=[{id:'old',artist:'Band'},{id:'new',artist:'Band'}];
 const interrupted=Array.from({length:40},(_,i)=>({track:'old',started:NOW-(i+1)*3600000,duration:180000,heard:30000,skipped:0}));
 const neutral=new Taste(library,interrupted,NOW),rejected=new Taste(library,interrupted.map(p=>({...p,skipped:1})),NOW);
 assert.equal(neutral.samples,0);assert.equal(neutral.score(null,library[1]).probability,.5);
 assert.ok(rejected.score(null,library[1]).probability<.4);
});

test('temporary skip feedback expires after a long pause without requiring new listening events',()=>{
 let now=NOW;const q=new Queue({shuffleMode:'smart',now:()=>now,stats:{plays:[0,1].map(i=>({track:'t'+i,started:now-(i+1)*60000,duration:180000,heard:5000,skipped:1}))}});
 q.setContext('library',tracks);q.peekNext();assert.equal(q._taste.recentSkips.length,2);
 now+=11*60000;q.peekNext();assert.equal(q._taste.recentSkips.length,0);
 now-=DAY;q.peekNext();assert.equal(q._taste.now,now);assert.equal(q._taste.samples,0);
});

test('skipping a song stops its tempo and transition influence; a later completion restores it',()=>{
 const a={id:'a',artist:'A',bpm:120},b={id:'b',artist:'B',bpm:120},plays=[];
 for(let i=1;i<=8;i++)plays.push(complete('a',NOW-i*3600000),complete('b',NOW-i*3600000+180000));
 const skip={track:'a',started:NOW-60000,duration:180000,heard:5000,skipped:1};
 const rejected=new Taste([a,b],[...plays,skip],NOW);
 assert.deepEqual(rejected.score(a,b),rejected.score(null,b));
 for(const history of [[],plays,[...plays,{...skip,skipped:0}],[...plays,skip,complete('a',NOW-1000)]]){
  const model=new Taste([a,b],history,NOW);
  assert.equal(model.score(a,b).dist,0);
  assert.ok(model.score(a,b).score>model.score(null,b).score);
 }
});

test('years of listening stay bounded and a sustained new preference can replace an old one',()=>{
 const library=[{id:'a',artist:'A'},{id:'b',artist:'B'},{id:'new-a',artist:'A'},{id:'new-b',artist:'B'}],history=[];
 for(let i=0;i<9000;i++)history.push({...complete(i%2?'a':'b',NOW-(60+i/12)*DAY),heard:i%2?180000:5000,finished:i%2?1:0,skipped:i%2?0:1});
 const before=new Taste(library,history,NOW);assert.equal(before.samples,6000);
 assert.ok(before.score(null,library[2]).probability>before.score(null,library[3]).probability);
 for(let i=0;i<60;i++)for(const id of ['a','b'])history.push({track:id,started:NOW-(1+i/10)*DAY+(id==='b'?180000:0),duration:180000,heard:id==='b'?180000:5000,finished:id==='b'?1:0,skipped:id==='a'?1:0});
 const after=new Taste(library,history,NOW);assert.equal(after.samples,6000);
 assert.ok(after.score(null,library[3]).probability>after.score(null,library[2]).probability);
 const restarted=new Taste(library,JSON.parse(JSON.stringify(history)),NOW);
 assert.equal(after.choose(null,library,{},{seed:99}).track.id,restarted.choose(null,library,{},{seed:99}).track.id);
 for(const t of library){const s=after.score(null,t);assert.ok(Number.isFinite(s.score)&&s.probability>=0&&s.probability<=1);}
});

test('syncing a growing library preserves played tracks, navigation and the current song',()=>{
 const q=new Queue({shuffleMode:'smart',loopMode:'off'});q.setContext('library',tracks.slice(0,4));
 const next=q.next();q.prev();
 q.refreshLibrary([tracks[3],tracks[2],tracks[1],{...tracks[0],title:'Updated'},tracks[4]],true);
 assert.equal(q.getCurrentTrack().id,'t0');assert.equal(q.getCurrentTrack().title,'Updated');
 assert.equal(q.next().id,next.id);
 const seen=new Set(['t0',next.id]);let t;
 while((t=q.next())){assert.ok(!seen.has(t.id));seen.add(t.id);}
 assert.equal(seen.size,5);
 q.refreshLibrary([tracks[5]],true);assert.equal(q.next().id,'t5');assert.equal(q.next(),null);
});
test('sync refreshes restricted queues without adding unrelated new songs',()=>{
 const q=new Queue({shuffleMode:'smart'});q.setContext('favorites',[tracks[0],tracks[1]]);
 q.refreshLibrary([tracks[0],tracks[2]],false);
 assert.deepEqual(q.getTracks().map(t=>t.id),['t0']);assert.equal(q.peekNext().id,'t0');
 q.refreshLibrary([],false);assert.equal(q.peekNext(),null);assert.equal(q.next(),null);
});

test('an initially empty library starts at its first imported song without an immediate repeat',()=>{
 const q=new Queue({shuffleMode:'smart'});q.refreshLibrary(tracks.slice(0,2),q.getContext().allowNew);
 assert.equal(q.getCurrentTrack().id,'t0');assert.equal(q.next().id,'t1');
 q.setContext('library',[tracks[0]],0,'Filtered');assert.equal(q.getContext().allowNew,false);
});
test('random shuffle prefetch matches actual playback through 100 cycles',()=>{
 const q=new Queue({shuffleMode:'random'});q.setContext('library',tracks);q.smartSeed=7;
 for(let i=0;i<2400;i++){
  const peek=q.peekNext().id;assert.equal(q.peekNext().id,peek);assert.equal(q.next().id,peek);
 }
});

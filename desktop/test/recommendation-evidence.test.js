const test=require('node:test');
const assert=require('node:assert/strict');
const Taste=require('../src/taste-model');
const SessionGraph=require('../src/session-graph');

const NOW=Date.UTC(2026,9,24,12),DAY=86400000;
const play=(track,accepted,day)=>({track,started:NOW-day*DAY,duration:180000,
 heard:accepted?180000:5000,media_heard:accepted?180000:5000,
 finished:accepted?1:0,skipped:accepted?0:1});

test('cold start learns explicit hearts without inventing plays or taste for unrelated artists',()=>{
 const tracks=[{id:'heart',artist:'Chosen',favorite:1},{id:'related',artist:'Chosen'},{id:'unrelated',artist:'Other'}];
 const before=JSON.stringify(tracks),model=new Taste(tracks,[],NOW);
 assert.equal(model.samples,0);
 assert.equal(model.favoriteSamples,1);
 assert.equal(model.counts.size,0);
 assert.equal(model.lastFeedback.size,0);
 assert.equal(model.score(null,tracks[2]).probability,.5,'a heart supplies no global completion bias');
 assert.ok(model.score(null,tracks[1]).probability>.5,'explicit preference generalises to its actual artist');
 assert.ok(model.score(null,tracks[0]).probability>model.score(null,tracks[1]).probability);
 const removed=new Taste(tracks.map(track=>({...track,favorite:0})),[],NOW);
 assert.equal(removed.score(null,tracks[1]).probability,.5);
 const excluded=new Taste(tracks,[],NOW,{}, {excludedTracks:['heart']});
 assert.equal(excluded.score(null,tracks[1]).probability,.5);
 assert.equal(JSON.stringify(tracks),before);
});

test('a heart is one observation and cannot override repeated explicit refusals',()=>{
 const favorite={id:'old',artist:'Old',favorite:1},other={id:'other',artist:'New'};
 const history=Array.from({length:20},(_,i)=>play(favorite.id,false,i+1));
 const model=new Taste([favorite,other],history,NOW);
 assert.equal(model.samples,history.length);
 assert.equal(model.favoriteSamples,1);
 assert.ok(model.score(null,favorite).probability<model.score(null,other).probability);
 for(let seed=1;seed<=50;seed++)assert.equal(model.choose(null,[favorite,other],{}, {seed,step:7}).track.id,other.id);
 const duplicate=new Taste([favorite,{...favorite},other],[...history,...history],NOW);
 assert.equal(duplicate.favoriteSamples,1);
 assert.deepEqual(duplicate.score(null,favorite),model.score(null,favorite));
});

test('artist variety cannot force a repeatedly rejected artist over a relevant familiar one',()=>{
 const tracks=[{id:'liked',artist:'Liked'},{id:'new-liked',artist:'Liked'},{id:'bad',artist:'Rejected'},{id:'new-bad',artist:'Rejected'}];
 const history=[];
 for(let day=1;day<=15;day++)history.push(play('liked',true,day),play('bad',false,day+.5));
 const model=new Taste(tracks,history,NOW);
 for(let seed=1;seed<=100;seed++)for(const step of [0,3,7]){
  const chosen=model.choose(tracks[0],[tracks[1],tracks[3]],{}, {seed,step,recentArtists:['liked']});
  assert.equal(chosen.track.id,'new-liked','variety must stay inside the relevance shortlist');
 }
});

test('numeric IDs and string IDs from sync refer to the same listening evidence',()=>{
 const tracks=[{id:42,artist:'Artist'},{id:43,artist:'Other'}];
 const canonical=play(42,true,1),synced={...canonical,track:'42'};
 const model=new Taste(tracks,[canonical],NOW);
 assert.equal(model.samples,1);
 for(const records of [[synced],[canonical,synced],[synced,canonical]]){
  const merged=new Taste(tracks,records,NOW);
  assert.equal(merged.samples,1);
  assert.deepEqual(merged.score(null,tracks[0]),model.score(null,tracks[0]));
 }
});

test('sync volume cannot erase independent session support before the history bound',()=>{
 const events=[1,2].flatMap(day=>['a','b'].map((id,i)=>({id,started:NOW-day*DAY+i*180000,quality:1,skipped:false})));
 const baseline=new SessionGraph(events,NOW).affinity(['a'],'b');
 assert.ok(baseline>0);
 const duplicateBurst=Array.from({length:7000},()=>({...events[1]}));
 assert.equal(new SessionGraph([...events,...duplicateBurst],NOW).affinity(['a'],'b'),baseline);
});

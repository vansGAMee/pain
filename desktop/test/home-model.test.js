const test=require('node:test'),assert=require('node:assert/strict');
const Home=require('../src/home-model'),Queue=require('../src/queue-engine');
const NOW=new Date(2026,9,23,12).getTime(),DAY=86400000;
const tracks=Array.from({length:12},(_,i)=>({id:String(i),title:'Song '+i,artist:'Artist '+i,duration:180000,favorite:i===0}));
const play=(id,days=0,heard=180000)=>({track:id,id:id+'-'+days,started:NOW-days*DAY-300000,heard,duration:180000,finished:heard===180000?1:0});
test('Home reuses deduplicated accounting and distinguishes recent, new, past and likes',()=>{
 const stats={plays:[play('0',10),play('0'),play('0'),play('1',8),play('2',0,2000),play('3'),play('missing')]};
 const before=JSON.stringify([tracks,stats]),m=Home.build(tracks,stats,NOW);
 assert.equal(m.recent.filter(t=>t.id==='0').length,1);
 assert.ok(!m.recent.some(t=>t.id==='2'),'a quick preview is not a meaningful listen');
 assert.deepEqual(m.past.map(t=>t.id),['1']);assert.deepEqual(m.favorites.map(t=>t.id),['0']);
 assert.equal(m.details.plays.length,6);assert.equal(m.todayMs,542000);
 assert.equal(m.weekMs,m.todayMs);assert.equal(m.week.length,7);
 assert.equal(JSON.stringify([tracks,stats]),before);
});
test('newly discovered means first recorded listen, not a replay of an older song',()=>{
 const m=Home.build(tracks,{plays:[play('0',40),play('0'),play('1',2)]},NOW);
 assert.deepEqual(m.fresh.map(t=>t.id),['1']);
 assert.equal(Home.build([],{},NOW).details.totalMs,0);
 assert.equal(Home.build([],{},NOW).details.librarySize,0);
});
test('DJ Home mix is reproducible, bounded and never changes live playback or evidence',()=>{
 const q=new Queue({shuffleMode:'random',loopMode:'one',stats:{plays:[play('0')]},now:()=>NOW});
 q.setContext('library',tracks,0,'Library');q.excludeTrack('2');q.smartSeed=42;
 const before=JSON.stringify(q),first=Home.mix(tracks,q,6),second=Home.mix(tracks,q,6);
 assert.deepEqual(first,second);assert.equal(first.length,6);
 assert.equal(new Set(first.map(x=>x.track.id)).size,6);
 assert.ok(first.every(x=>x.track.id!=='2'&&x.track.id!=='0'));
 assert.equal(JSON.stringify(q),before,'opening Home cannot reset queue, step, history or shuffle');
});
test('empty, excluded, removed anchors and a one-song library do not strand a mix',()=>{
 const q=new Queue({now:()=>NOW});q.setContext('library',tracks,0);
 assert.deepEqual(Home.mix([],q),[]);assert.equal(Home.mix([tracks[0]],q).length,1);
 q.excludeTrack('0');assert.deepEqual(Home.mix([tracks[0]],q),[]);
 assert.deepEqual(Home.mix([tracks[1]],q).map(x=>x.track.id),['1']);
 assert.deepEqual(Home.mix(tracks,q,0),[]);
});

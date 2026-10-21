const test=require('node:test'),assert=require('node:assert/strict'),Insights=require('../src/listening-insights');
const NOW=new Date(2026,9,21,12).getTime();
const at=(days,hour=10)=>new Date(2026,9,21-days,hour).getTime();
const track=(id,favorite=0)=>({id,title:id,duration:180000,favorite});
const play=(id,days,extra={})=>({id:`${id}-${days}`,track:id,started:at(days),heard:180000,duration:180000,...extra});
test('empty history shows no invented rituals, returns, records or percentages',()=>{
 const x=Insights.build([track('a')],{},NOW);
 assert.equal(x.totalMs,0);assert.equal(x.ritual,null);assert.equal(x.comeback,null);assert.equal(x.record,null);
 assert.equal(x.discoveries,0);assert.equal(x.knownTime,0);assert.equal(x.calendar.length,28);
 assert.equal(new Set(x.calendar.map(d=>d.day)).size,28);assert.ok(x.calendar.every(d=>d.ms===0));
});
test('discoveries must return on a different day; sync duplicates and short previews do not count',()=>{
 const rows=[play('a',5),play('a',5,{id:'relay-a'}),play('a',5,{id:'again',started:at(5,11)}),play('a',1),play('b',4),play('preview',2,{heard:2000}),play('old',40),play('old',2)];
 const x=Insights.build(['a','b','preview','old'].map(id=>track(id)),{plays:rows},NOW);
 assert.equal(x.discoveries,2);assert.equal(x.retained,1);assert.equal(x.heardLibrary,3);
 assert.deepEqual(x.ritual,{track:'a',days:2});assert.equal(x.plays.length,7);
 assert.equal(x.comeback.track,'old');assert.equal(x.comeback.days,38);
});
test('time combines phone slices and unsliced PC plays, deduplicating intervals across midnight',()=>{
 const midnight=new Date(2026,9,21).getTime(),start=midnight-60000;
 const phone=play('phone',1,{id:'phone',started:start,heard:120000});
 const slices=[{id:1,play:'phone',at:start,ms:60000},{id:2,play:'phone',at:midnight,ms:60000},{id:99,play:'relay',at:start,ms:60000}];
 const x=Insights.build([track('phone'),track('pc')],{plays:[phone,{...phone,id:'relay'},play('pc',0)],slices},NOW);
 assert.equal(x.totalMs,300000);assert.equal(x.days.get('2026-10-20'),60000);assert.equal(x.days.get('2026-10-21'),240000);
 assert.equal(x.hours[23],60000);assert.equal(x.hours[0],60000);assert.equal(x.hours[10],180000);
 assert.equal(x.record.day,'2026-10-21');assert.equal(x.record.ms,240000);
});
test('current likes and library coverage have honest denominators when old files are gone',()=>{
 const rows=[play('liked',1),play('plain',2),play('gone',3)];
 const library=[track('liked',true),track('plain'),track('unheard')];
 const x=Insights.build(library,{plays:rows},NOW);
 assert.equal(x.knownTime,360000);assert.equal(x.outsideFavorites,180000);assert.equal(x.heardLibrary,2);assert.equal(x.librarySize,3);
 library[1].favorite=1;assert.equal(Insights.build(library,{plays:rows},NOW).outsideFavorites,0);
});
test('malformed/future records do not inflate activity and future interval tails are clipped',()=>{
 const x=Insights.build([track('a')],{plays:[play('a',0,{started:NOW-60000}),play('future',-1),play('bad',1,{heard:Infinity}),null],slices:[{play:'a-0',at:NOW-60000,ms:180000},{play:'absent',at:at(1),ms:999999},null]},NOW);
 assert.equal(x.totalMs,60000);assert.equal(x.plays.length,1);assert.equal(x.hours[11],60000);
});
test('local calendar and hourly totals survive daylight-saving fall-back',()=>{
 const previous=process.env.TZ;process.env.TZ='America/New_York';
 try{
  const started=Date.parse('2026-11-01T01:30:00-04:00'),now=Date.parse('2026-11-01T12:00:00-05:00');
  const x=Insights.build([track('a')],{plays:[play('a',0,{started,heard:7200000})]},now);
  assert.equal(x.totalMs,7200000);assert.equal(x.days.get('2026-11-01'),7200000);
  assert.equal(x.hours[1],5400000);assert.equal(x.hours[2],1800000);assert.equal(x.calendar.length,28);
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

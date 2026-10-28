const test=require('node:test'),assert=require('node:assert/strict'),Top=require('../src/track-leaderboard');
test('returns fifty real ranked tracks and deduplicates sync events',()=>{
 const now=new Date(2026,9,28).getTime(),tracks=Array.from({length:65},(_,i)=>({id:String(i),duration:180000})),plays=[];
 for(let i=0;i<65;i++)for(let n=0;n<=i;n++)plays.push({track:String(i),started:now-(n+1)*60000,heard:60000});
 const report=Top.rank(tracks,[...plays,...plays], 'all',now);assert.equal(report.rows.length,50);assert.equal(report.rows[0].track.id,'64');assert.equal(report.rows[0].count,65);assert.equal(report.total,2145);
});
test('calendar years, rolling months and short accidental plays remain distinct',()=>{
 const now=new Date(2026,9,28,12).getTime(),tracks=[{id:'song',duration:180000}],plays=[{track:'song',started:new Date(2025,11,31,23,59).getTime(),heard:60000},{track:'song',started:new Date(2026,0,1).getTime(),heard:60000},{track:'song',started:now-60000,heard:60000},{track:'song',started:now-1000,heard:500},{track:'song',started:now+1000,heard:60000}];
 assert.equal(Top.rank(tracks,plays,'year:2025',now).rows[0].count,1);assert.equal(Top.rank(tracks,plays,'this-year',now).rows[0].count,2);assert.equal(Top.rank(tracks,plays,'30',now).rows[0].count,1);assert.deepEqual(Top.rank(tracks,plays,'all',now).years,[2026,2025]);
});

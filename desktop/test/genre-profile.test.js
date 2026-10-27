const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,build}=require('../src/genre-profile-model');
const Insights=require('../src/listening-insights');
test('genre spelling aliases merge without guessing moods or splitting R&B',()=>{
 assert.deepEqual(normalize(' Hip-Hop;hip hop / R&B;Unknown;<script>'),['hip hop','r&b']);
 assert.deepEqual(normalize('123;Other;Музыка'),[]);
});
test('genre shares conserve real listening time, including unknown tracks and mixed genres',()=>{
 const now=new Date(2026,9,27,12).getTime(),at=new Date(2026,9,26,23,59).getTime();
 const tracks=[{id:'a',genre:'Hip-Hop;R&B'},{id:'b'}];
 const stats={plays:[{id:'1',track:'a',started:at,heard:120000},{id:'1',track:'a',started:at,heard:120000},{id:'2',track:'b',started:at-300000,heard:60000}]};
 const data=build(tracks,Insights.build(tracks,stats,now),{},'all',now);
 assert.equal(data.total,180000);assert.equal(data.identified,120000);assert.equal(data.known,1);assert.equal(data.listened,2);
 assert.deepEqual(data.genres.map(g=>g.ms),[60000,60000,60000]);
 assert.equal(data.weeks.reduce((s,w)=>s+w.total,0),180000);
 assert.equal(data.weeks.reduce((s,w)=>s+w.genres.reduce((n,g)=>n+g.ms,0),0),180000);
});
test('28-day profile excludes older time, never classifies missing metadata as a genre',()=>{
 const now=new Date(2026,9,27,12).getTime(),tracks=[{id:'a'},{id:'b'}];
 const stats={plays:[{track:'a',started:new Date(2026,7,1).getTime(),heard:60000},{track:'b',started:now-60000,heard:60000}]};
 const details=Insights.build(tracks,stats,now),entries={a:{names:['rock']},b:{names:[]}};
 const data=build(tracks,details,entries,'28',now);
 assert.equal(data.total,60000);assert.equal(data.known,0);assert.equal(data.genres[0].name,'');
 assert.equal(build(tracks,details,entries,'all',now).total,120000);
});

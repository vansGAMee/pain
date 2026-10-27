const test=require('node:test'),assert=require('node:assert/strict'),{build}=require('../src/insight-charts-model');
const NOW=new Date(2026,9,27,12).getTime(),DAY=86400000;
const tracks=[{id:'a',title:'A',artist:'Artist',album:'Album',duration:120000,favorite:1},{id:'b',title:'B',artist:'Other',duration:120000}];
const play=(track,started,extra={})=>({id:track+started,track,started,heard:120000,media_heard:120000,duration:120000,finished:1,session:'s',...extra});
const chart=(r,id)=>r.cards.find(c=>c.id===id);
test('twenty distinct charts have honest empty defaults, finite data and no invented sessions',()=>{
 const r=build(tracks,{},'28',NOW);assert.equal(r.cards.length,20);assert.equal(new Set(r.cards.map(c=>c.id)).size,20);assert.equal(r.total,0);
 assert.equal(chart(r,'sessions').count,0);assert.deepEqual(chart(r,'transitions').rows,[]);assert.equal(chart(r,'skips').median,null);
 assert.ok(!JSON.stringify(r).includes('NaN'));assert.equal(chart(r,'exploration').points.at(-1).y,0);
});
test('duplicate sync events do not inflate time, outcomes, new songs or repeat counts',()=>{
 const one=play('a',NOW-DAY),two=play('a',NOW-DAY+180000),stats={plays:[one,{...one},two]};
 const r=build(tracks,stats,'28',NOW);assert.equal(r.total,240000);assert.equal(r.plays,2);
 assert.equal(chart(r,'outcomes').rows.reduce((s,v)=>s+v.value,0),2);
 assert.equal(chart(r,'discoveries').series[0].values.reduce((s,v)=>s+v,0),1);
 assert.equal(chart(r,'discoveries').series[1].values.reduce((s,v)=>s+v,0),1);
 assert.ok(chart(r,'repeat').points.some(p=>p.y===50));assert.equal(chart(r,'sessions').values[2],4);
});
test('range filters retain the true first discovery and transitions only use explicit sessions',()=>{
 const plays=[play('a',NOW-40*DAY),play('a',NOW-DAY),play('b',NOW-DAY+180000,{session:'different'}),play('a',NOW-DAY+360000,{session:null})];
 const r=build(tracks,{plays},'28',NOW);assert.equal(chart(r,'discoveries').series[0].values.reduce((s,v)=>s+v,0),1);
 assert.equal(chart(r,'discoveries').series[1].values.reduce((s,v)=>s+v,0),2);
 assert.deepEqual(chart(r,'transitions').rows,[]);assert.equal(chart(r,'exploration').points.at(-1).y,100);
});
test('heatmap and day totals conserve an audible interval that crosses the range boundary',()=>{
 const from=new Date(2026,8,30).getTime(),start=from-60000;
 const r=build(tracks,{plays:[play('a',start)]},'28',NOW);
 assert.equal(r.total,60000);assert.equal(chart(r,'clock').matrix.flat().reduce((s,v)=>s+v,0),60000);
 assert.equal(chart(r,'accumulation').points.at(-1).y,1);
});
test('completion uses heard media and skip timing is a monotonic empirical distribution',()=>{
 const r=build(tracks,{plays:[play('a',NOW-100000,{heard:30000,media_heard:30000,skipped:1,finished:0}),play('b',NOW-50000,{heard:10000,media_heard:10000,skipped:1,finished:0})]},'28',NOW);
 const c=chart(r,'skips');assert.equal(c.count,2);assert.equal(c.median,20);assert.deepEqual(c.points.map(p=>p.y),[50,100]);
 assert.equal(chart(r,'outcomes').rows[1].value,1);assert.equal(chart(r,'completion').points.at(-1).x,25);
});

const test=require('node:test'),assert=require('node:assert/strict'),Records=require('../src/listening-records'),merge=require('../src/stats-store');
test('a near-end checkpoint stays unfinished and preserves its identity until one terminal finish',()=>{
 const Ledger=require('../src/listening'),ledger=new Ledger('a',10000,1000),id=ledger.playId;
 ledger.anchor(0,0);for(let i=1;i<=95;i++)ledger.sample(i*100,i/10);
 assert.equal(ledger.snapshot().finished,0);assert.equal(ledger.snapshot().media_heard,9500);assert.equal(ledger.closed,false);
 assert.equal(ledger.finish().finished,1);assert.equal(ledger.playId,id);assert.equal(ledger.finish(),null);
});
test('one stable play ID cannot count twice when a relay changes its start timestamp',()=>{
 const rows=[{id:'a',track:'t',started:100,heard:30000,media_heard:30000},{id:'a',track:'t',started:200,heard:40000,media_heard:35000,finished:1}];
 const before=JSON.stringify(rows),out=Records.canonical(rows);assert.equal(out.length,1);assert.equal(out[0].heard,40000);assert.equal(out[0].media_heard,35000);assert.equal(out[0].started,100);assert.equal(JSON.stringify(rows),before);
});
test('bridging ID/start aliases merge transitively and remap slices without multiplying time',()=>{
 const a={plays:[{id:'a',track:'t',started:100,heard:30000},{id:'b',track:'t',started:200,heard:20000}],slices:[{play:'b',at:100,ms:20000}]};
 const b={plays:[{id:'a',track:'t',started:200,heard:40000}],slices:[{play:'a',at:100,ms:20000}]};
 const out=merge(a,b);assert.equal(out.plays.length,1);assert.equal(out.plays[0].heard,40000);assert.equal(out.slices.length,1);assert.deepEqual(merge(out,b),out);
});
test('genuine repeat plays stay separate even if their time intervals overlap',()=>{
 assert.equal(Records.canonical([{id:'a',track:'t',started:100,heard:30000},{id:'b',track:'t',started:200,heard:30000}]).length,2);
});
test('identity links survive save/reload and cannot resurrect a previously merged relay',()=>{
 let stats=merge({plays:[{id:'pc',track:'t',started:100,heard:30000}]},{plays:[{id:'pc',track:'t',started:200,heard:40000}]});
 stats=JSON.parse(JSON.stringify(stats));stats=merge(stats,{plays:[{id:'phone',track:'t',started:200,heard:40000}]});
 stats=JSON.parse(JSON.stringify(stats));stats=merge(stats,{plays:[{id:'pc',track:'t',started:100,heard:30000}]});
 assert.equal(stats.plays.length,1);assert.equal(stats.plays[0].heard,40000);assert.deepEqual(new Set(stats.plays[0].syncAliases.ids),new Set(['pc','phone']));
});

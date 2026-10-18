const test=require('node:test'),assert=require('node:assert/strict');
const Ledger=require('../src/listening'),range=require('../src/range');
test('seeking cannot fabricate listening time',()=>{const l=new Ledger('a',60000);l.anchor(0,0);l.sample(1000,1);l.sample(1100,59);l.sample(2100,60);assert.equal(l.finish(),null);});
test('pause, buffering and repeated segments are not completion',()=>{const l=new Ledger('a',10000);l.anchor(0,0);l.sample(5000,5);l.anchor(5000,5,false);l.sample(20000,5,false);l.anchor(20000,0);l.sample(25000,5);const r=l.finish();assert.equal(r.heard,10000);assert.equal(r.media_heard,5000);assert.equal(r.finished,0);assert.equal(l.finish(),null);});
test('speed distinguishes wall time from media coverage',()=>{const l=new Ledger('a',10000);l.anchor(0,0);l.sample(5000,10,true,2);const r=l.finish();assert.equal(r.heard,5000);assert.equal(r.finished,1);});
test('range parsing handles suffix, open end, clamping and malformed requests',()=>{assert.deepEqual(range('bytes=-10',100),{start:90,end:99});assert.deepEqual(range('bytes=40-',100),{start:40,end:99});assert.deepEqual(range('bytes=0-999',100),{start:0,end:99});for(const h of ['bytes=100-','bytes=20-10','bytes=-0','bytes=0-1,4-5','bytes=-','bad'])assert.equal(range(h,100),null);});
const mergeStats=require('../src/stats-store');
test('phone refresh retains offline PC plays and deduplicates relayed plays',()=>{
 const local={plays:[{id:'pc1',track:'a',started:100},{id:'pc2',track:'b',started:200}],slices:[]};
 const remote={plays:[{id:'phone1',track:'a',started:100}],slices:[]};
 const result=mergeStats(local,remote);assert.equal(result.plays.length,2);assert.equal(result.plays.find(p=>p.track==='a').id,'phone1');
});

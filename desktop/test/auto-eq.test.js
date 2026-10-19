const test=require('node:test'),assert=require('node:assert/strict');
const AutoEq=require('../src/auto-eq');

const profile=vector=>({vector,frames:20,seconds:10});

test('auto EQ waits for real sound evidence and stays neutral while learning',()=>{
 for(const value of [null,{},profile([.4,.3,.5,.2,.2,NaN]),{vector:[.4,.3,.5,.2,.2,.4],frames:3,seconds:2}]){
  const result=AutoEq.recommend({},value);
  assert.equal(result.ready,false);assert.deepEqual(result.bands,Array(8).fill(0));assert.equal(result.preamp,0);
 }
});

test('auto EQ distinguishes deep, vocal and bright sound without extreme gains',()=>{
 const deep=AutoEq.recommend({},profile([.45,.62,.28,.1,.12,.25]));
 const vocal=AutoEq.recommend({},profile([.42,.18,.68,.14,.16,.22]));
 const bright=AutoEq.recommend({},profile([.4,.18,.42,.4,.36,.3]));
 assert.equal(deep.character,'deep');assert.equal(vocal.character,'vocal');assert.equal(bright.character,'bright');
 assert.notDeepEqual(deep.bands,vocal.bands);assert.notDeepEqual(vocal.bands,bright.bands);
 for(const result of [deep,vocal,bright]){
  assert.equal(result.ready,true);assert.equal(result.bands.length,8);
  assert.ok(result.bands.every(value=>Number.isFinite(value)&&Math.abs(value)<=3));
  assert.ok(result.preamp<=0&&result.preamp>=-3);
  assert.ok(Math.max(...result.bands)+result.preamp<=.5,'preamp reserves headroom for the largest boost');
 }
});

test('dense masters receive gentler correction and recommendation is deterministic',()=>{
 const dynamic=AutoEq.recommend({},profile([.35,.3,.5,.2,.2,.25]));
 const dense=AutoEq.recommend({},profile([.75,.3,.5,.2,.2,.25]));
 const movement=result=>result.bands.reduce((sum,value)=>sum+Math.abs(value),0);
 assert.ok(movement(dense)<=movement(dynamic));
 assert.deepEqual(AutoEq.recommend({},profile([.35,.3,.5,.2,.2,.25])),dynamic);
});

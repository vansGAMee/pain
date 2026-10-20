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

test('balanced sound stays neutral and dominant ranges are reduced instead of reinforced',()=>{
 const balanced=AutoEq.recommend({},profile([.4,.3,.5,.2,.2,.25]));
 assert.deepEqual(balanced.bands,Array(8).fill(0));assert.equal(balanced.preamp,0);
 for(const [vector,index] of [[[.35,.7,.2,.1,.1,.2],1],[[.35,.1,.8,.1,.2,.2],3],[[.35,.1,.3,.6,.4,.2],6]]){
  assert.ok(AutoEq.recommend({},profile(vector)).bands[index]<0);
 }
});

test('small spectral changes cannot jump between different preset curves',()=>{
 for(const bass of [.4599,.4601])for(const mid of [.5799,.5801]){
  const a=AutoEq.recommend({},profile([.4,bass,.35,.65-bass,.2,.2]));
  const b=AutoEq.recommend({},profile([.4,.2,mid,.8-mid,.2,.2]));
  for(const result of [a,b])assert.deepEqual(result.bands,Array(8).fill(0));
 }
 const a=AutoEq.recommend({},profile([.4,.2,.5201,.2799,.2799,.2]));
 const b=AutoEq.recommend({},profile([.4,.2,.5199,.2801,.2801,.2]));
 assert.deepEqual(a.bands,b.bands);
});

test('short, changing and dense excerpts receive less correction than stable evidence',()=>{
 const p={...profile([.35,.8,.15,.05,.1,.2]),variance:Array(6).fill(0)};
 const movement=result=>result.bands.reduce((sum,v)=>sum+Math.abs(v),0);
 const full=movement(AutoEq.recommend({},p));assert.ok(full>0);
 for(const partial of [{...p,frames:4,seconds:2},{...p,variance:Array(6).fill(.09)},{...p,vector:[.75,...p.vector.slice(1)]}]){
  assert.ok(movement(AutoEq.recommend({},partial))<full);
 }
 const copy=structuredClone(p);AutoEq.recommend({},p);assert.deepEqual(p,copy);
});

test('missing spectrum and noise are not boosted; overlapping filters have conservative headroom',()=>{
 const absent=AutoEq.recommend({},profile([.35,1,0,0,0,0]));
 assert.ok(absent.bands[6]<=0&&absent.bands[7]<=0);
 const noise=AutoEq.recommend({},profile([.35,.1,.2,.7,.6,.9]));
 assert.ok(noise.bands.every(v=>v<=0));
 // Sweep a fixed grid, including pure tones and near-empty frequency ranges.
 for(let bass=0;bass<=20;bass++)for(let mid=0;mid<=20-bass;mid++){
  const result=AutoEq.recommend({},profile([.35,bass/20,mid/20,(20-bass-mid)/20,.2,.2]));
  assert.ok(result.bands.every(v=>Number.isFinite(v)&&v>=-3&&v<=1));
  assert.ok(result.bands.reduce((sum,v)=>sum+Math.max(0,v),0)+result.preamp<=0);
  assert.ok(result.preamp>=-12);
 }
});

test('impossible measurements stay neutral and malformed optional variance stays safe',()=>{
 const p=profile([.4,.6,.3,.1,.2,.2]);
 for(const corrupt of [{...p,frames:4.5},{...p,frames:361},{...p,seconds:1000},{...p,seconds:Infinity},{...p,vector:[0,0,0,0,0,0]}]){
  assert.equal(AutoEq.recommend({},corrupt).ready,false);
 }
 for(const variance of [null,[],[NaN],Array(6).fill(Infinity),Array(6).fill(-1)]){
  assert.ok(AutoEq.recommend({}, {...p,variance}).bands.every(Number.isFinite));
 }
});

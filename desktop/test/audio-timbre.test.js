const test=require('node:test'),assert=require('node:assert/strict');
const Timbre=require('../src/audio-timbre'),Audio=require('../src/audio-profile'),Taste=require('../src/taste-model');
const spectrum=(rate,peak)=>Float32Array.from({length:1024},(_,i)=>{
 const f=i*rate/2048;return -80+55*Math.exp(-(((f-peak)/350)**2))+12*Math.exp(-(((f-5000)/900)**2));
});
const distance=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2,0);
function profile(track,timbre){return {version:4,signature:Audio.signature(track),frames:100,seconds:50,positions:Array.from({length:100},(_,i)=>i),vector:[.4,.1,.7,.2,.25,.1],variance:Array(6).fill(.01),timbre,timbreVariance:Array(12).fill(0)};}

test('mel timbre preserves spectral envelope differences hidden inside broad frequency bands',()=>{
 const a=Timbre.frame(spectrum(48000,700),48000),b=Timbre.frame(spectrum(48000,1500),48000);
 assert.equal(a.length,12);assert.ok(a.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
 assert.ok(distance(a,b)>.2);
 const track={id:'a'},p=profile(track,a),q=profile(track,b);
 assert.ok(Audio.similarity(p,p)>Audio.similarity(p,q)+.05);
});
test('timbre ignores gain and remains comparable across 44.1/48/96 kHz',()=>{
 const bins=spectrum(48000,1000),a=Timbre.frame(bins,48000);
 assert.ok(distance(a,Timbre.frame(bins.map(n=>n-35),48000))<1e-10);
 for(const rate of [44100,96000])assert.ok(distance(a,Timbre.frame(spectrum(rate,1000),rate))<.005);
});
test('missing, invalid and spectrally unresolved input does not manufacture timbre',()=>{
 for(const [bins,rate] of [[new Float32Array(),48000],[new Float32Array(1024).fill(-Infinity),48000],[new Float32Array(1024).fill(NaN),48000],[new Float32Array(1024).fill(Infinity),48000],[spectrum(48000,1000),0],[spectrum(48000,1000),384000]])assert.equal(Timbre.frame(bins,rate),null);
 const track={id:'a'},good=profile(track,Array(12).fill(.5));
 for(const bad of [[],Array(12).fill(NaN),Array(12).fill(2),null])assert.equal(Audio.get({a:{...good,timbre:bad}},track),null);
 assert.equal(Audio.texture({...good,timbre:null,timbreVariance:null}),null);
 assert.ok(Audio.get({a:{...good,timbre:null,timbreVariance:null}},track),'broad audio evidence remains usable');
});
test('heard timbre preferences transfer to unplayed songs without relying on tags or likes',()=>{
 const now=Date.now(),tracks=['liked-sound','skipped-sound','new-similar','new-other'].map(id=>({id,duration:180000}));
 const a=Timbre.frame(spectrum(48000,700),48000),b=Timbre.frame(spectrum(48000,1500),48000);
 const profiles=Object.fromEntries(tracks.map((t,i)=>[t.id,profile(t,i%2?b:a)]));
 const plays=[];for(let i=0;i<30;i++)for(let j=0;j<2;j++)plays.push({track:tracks[j].id,started:now-(i*2+j+1)*86400000,duration:180000,heard:j?5000:180000,finished:j?0:1});
 const m=new Taste(tracks,plays,now,profiles),good=m.score(null,tracks[2]),bad=m.score(null,tracks[3]);
 assert.ok(good.probability>bad.probability+.02);
 const missing=new Taste(tracks,plays,now,{});
 assert.equal(missing.score(null,tracks[2]).probability,missing.score(null,tracks[3]).probability);
});

test('instrument texture distinguishes harmonic structure and short envelopes without gain dependence',()=>{
 const wave=Float32Array.from({length:2048},(_,i)=>.2*Math.sin(i*Math.PI/16));
 const harmonic=Float32Array.from({length:1024},(_,i)=>i%8===0?-20:-70),noise=new Float32Array(1024).fill(-30);
 const a=Timbre.detail(wave,harmonic,48000),b=Timbre.detail(wave,noise,48000);
 assert.equal(a.length,7);assert.ok(a.slice(0,6).every((n,i)=>n>b[i]+.5));
 assert.ok(distance(a,Timbre.detail(wave.map(x=>x*.1),harmonic.map(x=>x-20),48000))<1e-10);
 const hit=Timbre.detail(wave.map((x,i)=>x*Math.exp(-i/180)),harmonic,48000);
 assert.ok(hit[6]>a[6]+.5,'short decays differ from sustained tones');
 for(const bins of [new Float32Array(1024).fill(NaN),new Float32Array(1024).fill(Infinity),[]])assert.equal(Timbre.detail(wave,bins,48000),null);
 for(const rate of [8000,12000])assert.equal(Timbre.detail(wave,harmonic,rate),null,'truncated octave bands must not invent a comparable texture');
});

test('instrument texture refines sound similarity while old or malformed caches retain baseline behavior',()=>{
 const track={id:'a'},base=profile(track,Array(12).fill(.5));
 const detail=mean=>({version:1,frames:24,seconds:12,positions:Array.from({length:24},(_,i)=>i),mean});
 const a={...base,detail:detail(Array(7).fill(.8))},b={...base,detail:detail(Array(7).fill(.1))};
 assert.equal(Audio.similarity(a,a),1);assert.ok(Audio.similarity(a,b)<.6);
 assert.equal(Audio.similarity(a,base),1,'missing evidence must not manufacture a difference');
 for(const d of [{},detail([NaN]),{...detail(Array(7).fill(.1)),frames:2},{...detail(Array(7).fill(.1)),positions:Array(24).fill(1)}]){
  assert.equal(Audio.detail({...base,detail:d}),null);assert.equal(Audio.similarity(a,{...base,detail:d}),1);
 }
 const m=new Taste([track],[],Date.now(),{a});
 assert.equal(m.features(track,12,null).filter(([key])=>key.startsWith('instrument-texture:')).length,7);
 assert.deepEqual(Audio.restore(JSON.stringify({a})).a.detail,a.detail);
});

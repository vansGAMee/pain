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

const test=require('node:test'),assert=require('node:assert/strict'),Audio=require('../src/audio-profile');
const wave=Float32Array.from({length:2048},(_,i)=>.25*Math.sin(i*.17));
const spectrum=(rate,low,high)=>Float32Array.from({length:1024},(_,i)=>{const hz=i*rate/2048;return hz>=low&&hz<=high?-20:-120;});
const profile=vector=>({vector,frames:40,seconds:20});

test('silence, empty input and invalid samples do not create sound evidence',()=>{
 const bins=spectrum(48000,50,200);
 for(const args of [[new Float32Array(2048),bins,48000],[wave,new Float32Array(1024).fill(-Infinity),48000],[wave,new Float32Array(16384).fill(-Infinity),48000],[new Float32Array(),bins,48000],[wave,new Float32Array(),48000],[wave,bins,0],[Float32Array.of(NaN),bins,48000]])assert.equal(Audio.frame(...args),null);
});
test('equally loud bass and treble have distinct normalized sound profiles',()=>{
 const bass=Audio.frame(wave,spectrum(48000,50,200),48000),treble=Audio.frame(wave,spectrum(48000,5000,10000),48000);
 for(const vector of [bass,treble]){assert.equal(vector.length,6);assert.ok(vector.every(v=>Number.isFinite(v)&&v>=0&&v<=1));}
 assert.equal(bass[0],treble[0]);assert.ok(bass[1]>treble[1]);assert.ok(treble[3]>bass[3]);
 const self=Audio.similarity(profile(bass),profile(bass)),other=Audio.similarity(profile(bass),profile(treble));
 assert.ok(self>=0&&self<=1);assert.ok(other>=0&&other<self);
});
test('the same physical frequency band remains comparable across sample rates',()=>{
 const a=Audio.frame(wave,spectrum(44100,600,1800),44100),b=Audio.frame(wave,spectrum(48000,600,1800),48000);
 assert.ok(Audio.similarity(profile(a),profile(b))>.95);
});
test('missing, malformed and insufficient profiles are ignored',()=>{
 const good=profile([.3,.2,.5,.3,.4,.1]);
 for(const bad of [null,{},profile([1,2]),profile([NaN,.2,.5,.3,.4,.1]),profile([2,.2,.5,.3,.4,.1]),{...good,frames:19},{...good,seconds:9},{...good,frames:NaN},{...good,seconds:Infinity}]){
  assert.equal(Audio.similarity(good,bad),null);assert.equal(Audio.similarity(bad,good),null);
 }
 assert.ok(Number.isFinite(Audio.similarity({...good,frames:20,seconds:10},good)));
});

test('measured sound affects ranking; unavailable or stale profiles do not invent audio similarity',()=>{
 const Taste=require('../src/taste-model');
 const tracks=[{id:'current',duration:180000},{id:'near',duration:180000},{id:'far',duration:180000}],profiles={};
 for(const t of tracks)profiles[t.id]={version:4,timbre:Array(12).fill(.5),timbreVariance:Array(12).fill(0),variance:[0,0,0,0,0,0],positions:Array.from({length:100},(_,i)=>i),signature:Audio.signature(t),frames:100,seconds:50,vector:t.id==='far'?[.4,0,0,1,.9,.01]:[.4,1,0,0,.02,.01]};
 const model=new Taste(tracks,[],Date.now(),profiles);
 assert.ok(model.score(tracks[0],tracks[1]).score>model.score(tracks[0],tracks[2]).score+5);
 assert.equal(Audio.get(profiles,{...tracks[1],duration:999}),null);
 const blank=new Taste(tracks);assert.equal(blank.score(tracks[0],tracks[1]).score,blank.score(tracks[0],tracks[2]).score);
});

const saved=(track={id:'a'})=>({...profile([.3,.2,.5,.3,.4,.1]),version:4,timbre:Array(12).fill(.5),timbreVariance:Array(12).fill(0),variance:[0,0,0,0,0,0],signature:Audio.signature(track),positions:Array.from({length:40},(_,i)=>i),updatedAt:1});
test('DC offset is not sound evidence and does not change centered dynamics',()=>{
 const bins=spectrum(48000,50,200);
 assert.equal(Audio.frame(new Float32Array(2048).fill(.5),bins,48000),null);
 const a=Audio.frame(wave,bins,48000),b=Audio.frame(wave.map(x=>x+.4),bins,48000);
 assert.ok(Audio.similarity(profile(a),profile(b))>.9999);
});
test('cache restore rejects corrupt data and obsolete formats and caps its size',()=>{
 for(const raw of ['broken','null','[]',JSON.stringify({a:{...saved(),version:1}}),JSON.stringify({a:{...saved(),positions:[0]}})])assert.equal(Object.keys(Audio.restore(raw)).length,0);
 const many=Object.fromEntries(Array.from({length:800},(_,i)=>[String(i),{...saved(),updatedAt:i}]));
 const restored=Audio.restore(JSON.stringify(many),750);assert.equal(Object.keys(restored).length,750);assert.equal(restored['0'],undefined);assert.ok(restored['799']);
 const defaultRestored=Audio.restore(JSON.stringify(many));assert.equal(Object.keys(defaultRestored).length,800);
 const special=Audio.restore('{"__proto__":'+JSON.stringify(saved())+'}');assert.equal(Object.getPrototypeOf(special),null);assert.ok(Object.hasOwn(special,'__proto__'));assert.equal({}.version,undefined);
});
test('storage quota pressure evicts old evidence; denied storage does not throw',()=>{
 const store=Object.fromEntries(Array.from({length:100},(_,i)=>[String(i),{...saved(),updatedAt:i}]));let calls=0;
 assert.equal(Audio.persist(store,{setItem(key,value){calls++;assert.equal(key,'pain_audio_profiles_v4');if(Object.keys(JSON.parse(value)).length>50)throw Error('quota');}}),true);
 assert.equal(calls,2);assert.equal(Object.keys(store).length,100);assert.ok(store['99']);assert.ok(store['0']);
 assert.equal(Audio.persist(store,{setItem(){throw Error('denied');}}),false);assert.equal(Object.keys(store).length,100);
 assert.equal(Audio.persist({a:saved()},{setItem(){throw Error('denied');}}),false);
});
test('file identity changes invalidate otherwise valid profiles',()=>{
 const track={id:'a',duration:10000,bytes:40000,uri:'/music/a',modified:1},store={a:saved(track)};
 assert.ok(Audio.get(store,track));
 for(const patch of [{duration:10001},{bytes:40001},{uri:'/music/b'},{modified:2},{mime:'audio/flac'}])assert.equal(Audio.get(store,{...track,...patch}),null);
});

test('changing playback gain does not change the sound identity',()=>{
 const a=Audio.frame(wave,spectrum(44100,100,900),44100);
 const b=Audio.frame(wave.map(x=>x*.2),spectrum(44100,100,900).map(x=>x-14),44100);
 assert.ok(Audio.similarity({vector:a,frames:40,seconds:20},{vector:b,frames:40,seconds:20})>.999);
});

test('section contrast distinguishes tracks with identical average sound',()=>{
 const steady=saved(),contrast={...saved(),variance:[.09,.09,.09,.09,.09,.09]};
 assert.ok(Audio.similarity(contrast,contrast)>Audio.similarity(contrast,steady));
 const track={id:'a'};
 for(const variance of [[NaN,0,0,0,0,0],[-.1,0,0,0,0,0],[1,0,0,0,0,0],[],null]){
  const corrupt={...saved(track),variance};
  assert.equal(Audio.get({a:corrupt},track),null);assert.equal(Audio.variation(corrupt),null);
 }
 assert.equal(Audio.get({a:{...saved(track),version:2}},track),null);
});
test('listening evidence learns section contrast for unheard tracks without artist or genre tags',()=>{
 const Taste=require('../src/taste-model'),now=Date.now();
 const tracks=['dynamic','steady','new-dynamic','new-steady'].map(id=>({id,duration:180000}));
 const profiles=Object.fromEntries(tracks.map(t=>[t.id,{...saved(t),variance:Array(6).fill(t.id.includes('dynamic')?.09:0)}]));
 const plays=[];
 for(let i=0;i<24;i++)for(const id of ['dynamic','steady'])plays.push({track:id,started:now-(i*2+(id==='steady'?1:0)+1)*86400000,duration:180000,heard:id==='dynamic'?180000:5000,finished:id==='dynamic'?1:0});
 const model=new Taste(tracks,plays,now,profiles);
 assert.ok(model.score(null,tracks[2]).probability>model.score(null,tracks[3]).probability+.02);
});

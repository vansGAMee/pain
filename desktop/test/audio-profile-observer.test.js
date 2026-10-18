const test=require('node:test'),assert=require('node:assert/strict'),Audio=require('../src/audio-profile');

const wave=Float32Array.from({length:2048},(_,i)=>.25*Math.sin(i*.17));
const bins=Float32Array.from({length:1024},(_,i)=>i*48000/2048>=50&&i*48000/2048<=200?-20:-120);
const track=id=>({id,duration:180000,bytes:4000000,mime:'audio/wav'});
const cached=(song,extra={})=>({version:2,signature:Audio.signature(song),vector:Audio.frame(wave,bins,48000),frames:20,seconds:10,positions:Array.from({length:20},(_,i)=>i+1),...extra});

function fixture(t,{store={},onProfile=()=>{}}={}){
 const listeners=new Map(),timers=new Map(),saved=[];let wall=0,nextTimer=0;
 const audio={paused:false,seeking:false,readyState:4,currentTime:0,playbackRate:1,muted:false,volume:1,currentSrc:'file:///a.wav',
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
  emit(name){for(const fn of [...(listeners.get(name)||[])])fn({type:name,target:audio,currentTarget:audio});}
 };
 const analyser={fftSize:2048,frequencyBinCount:1024,getFloatTimeDomainData(target){target.set(wave);},getFloatFrequencyData(target){target.set(bins);}};
 const context={state:'running',sampleRate:48000,createAnalyser:()=>analyser};
 const source={connections:[],disconnections:[],connect(node){this.connections.push(node);},disconnect(node){this.disconnections.push(node);}};
 const f={audio,context,source,store,saved,listeners,timers,track:track('a'),trackError:null,
  advance(seconds=.5,media=seconds){wall+=seconds*1000;audio.currentTime+=media;for(const callback of [...timers.values()])callback();},
  prime(){this.advance(0,0);},
  frames(count){for(let i=0;i<count;i++)this.advance();},
  pause(){audio.paused=true;audio.emit('pause');},
  play(){audio.paused=false;audio.emit('playing');this.prime();}
 };
 f.dispose=Audio.observe(context,source,audio,()=>{if(f.trackError)throw f.trackError;return f.track;},(song,profile)=>{saved.push({id:song.id,profile:structuredClone(profile)});onProfile(song,profile);},store,{
  now:()=>wall,setInterval(callback){const id=nextTimer++;timers.set(id,callback);return id;},clearInterval(id){timers.delete(id);}
 });
 t.after(()=>f.dispose());f.prime();return f;
}
function assertProfile(profile,frames){
 assert.ok(profile);assert.equal(profile.version,2);assert.equal(profile.frames,frames);assert.equal(profile.seconds,frames/2);
 assert.equal(profile.positions.length,frames);assert.equal(new Set(profile.positions).size,frames);
 assert.ok(profile.positions.every(n=>Number.isInteger(n)&&n>=0));
}

test('pausing flushes all measured frames, including those after the periodic save',t=>{
 const f=fixture(t);f.frames(25);f.pause();
 assertProfile(f.store.a,25);assert.ok(Audio.get(f.store,f.track));assertProfile(f.saved.at(-1).profile,25);
});

test('repeated playing events keep one timer and ending playback flushes evidence',t=>{
 const f=fixture(t);f.audio.emit('playing');f.audio.emit('playing');assert.equal(f.timers.size,1);
 f.frames(25);f.audio.paused=true;f.audio.emit('ended');assertProfile(f.store.a,25);assert.equal(f.timers.size,0);
});

test('partial evidence survives pause and resume and becomes available only when ready',t=>{
 const f=fixture(t);f.frames(10);f.pause();
 assertProfile(f.store.a,10);assert.equal(Audio.get(f.store,f.track),null);
 f.play();f.frames(10);f.pause();
 assertProfile(f.store.a,20);assert.ok(Audio.get(f.store,f.track));
});

test('a new observer resumes persisted partial evidence without counting replayed positions',t=>{
 const store={},first=fixture(t,{store});first.frames(10);first.pause();first.dispose();
 const second=fixture(t,{store});second.frames(10);second.pause();
 assertProfile(store.a,10);assert.equal(Audio.get(store,second.track),null);
 second.play();second.frames(10);second.pause();assertProfile(store.a,20);
});

test('seeking and replaying already measured media do not inflate evidence',t=>{
 const f=fixture(t);f.frames(25);
 f.audio.seeking=true;f.audio.emit('seeking');f.audio.currentTime=0;
 f.frames(4);f.audio.currentTime=0;f.audio.seeking=false;f.audio.emit('seeked');f.prime();
 f.frames(25);f.pause();assertProfile(f.store.a,25);
});

test('paused, buffering, muted, seeking and nonstandard playback states add no evidence',async t=>{
 const states={paused:f=>f.audio.paused=true,buffering:f=>f.audio.readyState=2,muted:f=>f.audio.muted=true,
  zeroVolume:f=>f.audio.volume=0,seeking:f=>f.audio.seeking=true,fast:f=>f.audio.playbackRate=2,
  slow:f=>f.audio.playbackRate=.5,suspended:f=>f.context.state='suspended'};
 for(const [name,change] of Object.entries(states))await t.test(name,t=>{
  const f=fixture(t);f.frames(5);change(f);f.frames(8);f.pause();assertProfile(f.store.a,5);
 });
});

test('timer gaps and media jumps do not turn unobserved time into evidence',async t=>{
 for(const [name,seconds,media] of [['timer gap',8,8],['media jump',.5,20],['stalled media',.5,0],['backward seek',.5,-2]])await t.test(name,t=>{
  const f=fixture(t);f.frames(5);f.advance(seconds,media);f.pause();assertProfile(f.store.a,5);
 });
});

test('switching tracks flushes the old profile and starts the new track with a fresh baseline',t=>{
 const f=fixture(t);f.frames(25);f.track=track('b');f.audio.currentSrc='file:///b.wav';f.audio.currentTime=0;f.prime();
 f.frames(5);f.pause();assertProfile(f.store.a,25);assertProfile(f.store.b,5);
 assert.equal(Audio.get(f.store,f.track),null);assert.equal(f.store.b.signature,Audio.signature(f.track));
});

test('switching sources for the same track keeps evidence but resets the sampling baseline',t=>{
 const f=fixture(t);f.frames(25);f.audio.currentSrc='file:///replacement.wav';f.advance();
 f.frames(5);f.pause();assertProfile(f.store.a,30);
});

test('malformed cached positions and impossible profile sizes are ignored',async t=>{
 const rest=Array.from({length:19},(_,i)=>i+2);
 const invalid=[null,undefined,{},'positions',3,[1,1],[-1,...rest],[.5,...rest],[NaN,...rest],[Infinity,...rest],Array.from({length:20},()=>1)];
 const corrupt=invalid.map(positions=>({positions})).concat([
  {frames:1000000000,seconds:500000000},{seconds:1000000000},
  {frames:21},{frames:361,seconds:180.5,positions:Array.from({length:361},(_,i)=>i)},
  {seconds:NaN},{seconds:Infinity},{version:1}
 ]);
 for(let i=0;i<corrupt.length;i++)await t.test(`corrupt cache ${i+1}`,t=>{
  const song=track('a'),store={a:cached(song,corrupt[i])};assert.equal(Audio.get(store,song),null);
  let f;assert.doesNotThrow(()=>{f=fixture(t,{store});f.frames(5);f.pause();});assertProfile(store.a,5);
 });
});

test('throwing profile callbacks do not stop observation or prevent flushing',t=>{
 const f=fixture(t,{onProfile(){throw Error('consumer failed');}});
 assert.doesNotThrow(()=>{f.frames(25);f.pause();});assertProfile(f.store.a,25);
 f.play();assert.doesNotThrow(()=>{f.frames(5);f.pause();});assertProfile(f.store.a,30);
});

test('throwing track callbacks skip measurement safely and recover',t=>{
 const f=fixture(t);f.frames(5);f.trackError=Error('track unavailable');
 assert.doesNotThrow(()=>f.frames(5));f.trackError=null;f.prime();f.frames(5);f.pause();assertProfile(f.store.a,10);
});

test('disposal flushes evidence, removes listeners and timers, and cannot restart',t=>{
 const f=fixture(t);f.frames(25);f.dispose();assertProfile(f.store.a,25);
 assert.equal(f.timers.size,0);assert.equal([...f.listeners.values()].reduce((n,set)=>n+set.size,0),0);
 assert.equal(f.source.disconnections.length,1);assert.equal(f.source.disconnections[0],f.source.connections[0]);
 const callbacks=f.saved.length;f.audio.emit('playing');f.audio.emit('seeked');f.frames(5);f.audio.emit('pause');f.dispose();
 assert.equal(f.timers.size,0);assert.equal(f.saved.length,callbacks);assert.equal(f.source.disconnections.length,1);
});

const test=require('node:test'),assert=require('node:assert/strict');
const Transition=require('../src/smart-transition');
const profile=(duration=20,level=.2)=>({version:1,duration,leading:0,trailing:0,
 intro:{start:0,step:.02,rms:Array(400).fill(level),peak:Array(400).fill(level*Math.SQRT2)},
 outro:{start:duration-8,step:.02,rms:Array(400).fill(level),peak:Array(400).fill(level*Math.SQRT2)}});

test('fallback uses canonical equal-power curves, including native automation endpoints',()=>{
 const {fadeOut:a,fadeIn:b}=Transition.curves();
 assert.equal(a[0],1);assert.equal(b[0],0);assert.equal(a.at(-1),0);assert.equal(b.at(-1),1);
 for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]**2+b[i]**2-1)<1e-7);
 const held=Transition.curves({outGain:.6,inGain:.2});assert.ok(Math.abs(held.fadeOut[0]-.6)<1e-7);assert.ok(Math.abs(held.fadeIn[0]-.2)<1e-7);
});
test('measured energy reduces excessive overlap and never boosts quiet sections',()=>{
 const out=profile(),into=profile();out.outro.rms.fill(.8,210,300);into.intro.rms.fill(.8,30,90);
 const a=Transition.curves({duration:2,outgoing:out,incoming:into,outPosition:16}),plain=Transition.curves();
 assert.ok(a.fadeOut.some((v,i)=>v<plain.fadeOut[i]-.1));
 for(let i=0;i<a.fadeOut.length;i++){
  assert.ok(a.fadeOut[i]<=plain.fadeOut[i]+1e-7);assert.ok(a.fadeIn[i]<=plain.fadeIn[i]+1e-7);
 }
 const quiet=Transition.curves({duration:2,outgoing:profile(20,.001),incoming:profile(20,.001),outPosition:16});
 assert.deepEqual(quiet,plain);
});
test('automatic edges respect available duration, playback speed, manual seeks and album continuity',()=>{
 const out=profile(),into=profile();out.trailing=.4;into.leading=.3;
 const a={album:'Album',artist:'Artist',number:1,duration:20000},b={...a,number:2};
 assert.equal(Transition.plan(a,b,out,into,4,{position:16}).continuous,true);
 assert.equal(Transition.plan(a,b,out,into,4,{position:16}).start,0);
 const p=Transition.plan(a,{...b,album:'Other'},out,into,4,{position:18,rate:2});
 assert.ok(Math.abs(p.duration-.8)<1e-8);assert.equal(p.start,.3);assert.equal(p.end,19.6);
 const manual=Transition.plan(a,b,out,into,4,{automatic:false,position:10});assert.equal(manual.continuous,false);assert.equal(manual.start,0);assert.equal(manual.end,20);
 assert.equal(Transition.plan(a,b,null,null,0).duration,0);
 assert.equal(Transition.valid({...out,leading:1000}),false);assert.equal(Transition.valid({...out,intro:{...out.intro,rms:[NaN]}}),false);
});
test('edge decoding is stereo-safe, bounded, cached and invalidated by changed audio',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 if(spawnSync('ffmpeg',['-version']).status!==0||spawnSync('ffprobe',['-version']).status!==0){t.skip('ffmpeg unavailable: player uses equal-power fallback');return;}
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-transition-'));
 try{
  const file=path.join(dir,'song.wav'),rate=44100,seconds=12,wav=Buffer.alloc(44+rate*seconds*4);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  for(let i=rate*.4;i<rate*11.4;i++){const value=Math.round(2000*Math.sin(2*Math.PI*440*i/rate));wav.writeInt16LE(value,44+i*4);wav.writeInt16LE(-value,46+i*4);}
  await fs.writeFile(file,wav);const create=require('../src/transition-audio'),get=create(dir);
  assert.equal(await get(file,{cachedOnly:true}),null);
  const p=await get(file);assert.equal(Transition.valid(p),true);assert.ok(Math.abs(p.leading-.4)<.021);assert.ok(Math.abs(p.trailing-.6)<.021);
  assert.ok(Math.max(...p.intro.rms)>.04,'opposite stereo phases must not cancel');assert.ok(p.intro.rms.length<=400);assert.ok(p.outro.rms.length<=400);
  assert.equal(await get(file),p);assert.deepEqual(await create(dir)(file,{cachedOnly:true}),p);
  const now=new Date(Date.now()+2000);await fs.utimes(file,now,now);assert.equal(await get(file,{cachedOnly:true}),null);
  const controller=new AbortController();controller.abort();assert.equal(await get(file,{signal:controller.signal}),null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

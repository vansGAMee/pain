const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 try{
  const page=await browser.newPage();await page.addScriptTag({path:path.resolve(__dirname,'../src/mix-reduction.js')});
  const results=await page.evaluate(async()=>{
   async function render(settings={},frequency=1000,opposite=false,disable=false,mono=false){
    const rate=48000,length=rate*3,ctx=new OfflineAudioContext(2,length,rate),source=ctx.createBufferSource();
    const buffer=ctx.createBuffer(mono?1:2,length,rate);
    for(let ch=0;ch<buffer.numberOfChannels;ch++){const values=buffer.getChannelData(ch);for(let i=0;i<length;i++)values[i]=(opposite&&ch===1?-1:1)*.25*Math.sin(2*Math.PI*frequency*i/rate);}
    source.buffer=buffer;const node=MixReduction.create(ctx);node.update(settings);source.connect(node.input);node.output.connect(ctx.destination);source.start();
    const suspension=disable?ctx.suspend(1.5).then(()=>{node.update(settings,false);return ctx.resume();}):null;
    const output=await ctx.startRendering();if(suspension)await suspension;
    const a=output.getChannelData(0),b=output.getChannelData(1);let energy=0,error=0,phase=0;
    for(let i=rate*2;i<length;i++){energy+=a[i]*a[i];error=Math.max(error,Math.abs(a[i]-buffer.getChannelData(0)[i]));phase=Math.max(phase,Math.abs(a[i]+b[i]));if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('non-finite sample');}
    node.destroy();return {rms:Math.sqrt(energy/rate),error,phase};
   }
   return {flat:await render(),centre:await render({vocal:100}),side:await render({vocal:100},1000,true),bass:await render({bass:100},60),mid:await render({mid:100},1100),treble:await render({treble:100},12000),off:await render({vocal:100,bass:100,mid:100,treble:100},1000,false,true),mono:await render({vocal:100},1000,false,false,true)};
  });
  const baseline=.25/Math.sqrt(2);assert.equal(results.flat.error,0,'zero settings preserve every decoded sample');
  assert.ok(results.centre.rms<baseline*.08,'centre content is attenuated');
  assert.ok(Math.abs(results.side.rms-baseline)<.00001&&results.side.phase<1e-7,'vocal control preserves side content and stereo polarity');
  assert.ok(results.bass.rms<baseline*.12);assert.ok(results.mid.rms<baseline*.15);assert.ok(results.treble.rms<baseline*.15);
  assert.ok(results.off.error<1e-6,'power-off restores original audio');assert.ok(results.mono.rms>0,'mono remains finite and non-silent');
  console.log(JSON.stringify({nativeWebAudio:true,zeroIsExact:true,centreAndSides:true,frequencyCuts:true,bypass:true,results}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

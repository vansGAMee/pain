// Bounded edge analysis: two 8-second excerpts, never a full decoded song.
const {parentPort,workerData}=require('node:worker_threads');
const {spawn}=require('node:child_process');
const {probeDuration}=require('./audio-decode');
const rate=44100,seconds=8,step=.02,controller=new AbortController();
parentPort.on('message',m=>{if(m==='abort')controller.abort();});
function excerpt(file,start){return new Promise((resolve,reject)=>{
 const args=['-nostdin','-v','error','-threads','1','-ss',String(start),'-i',file,'-t',String(seconds),'-map','0:a:0','-f','f32le','-ac','2','-ar',String(rate),'-threads','1','pipe:1'];
 const child=spawn('ffmpeg',args,{signal:controller.signal,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let size=0,error='',chunks=[],settled=false;
 const timer=setTimeout(()=>{child.kill();finish(Error('Transition analysis timed out'));},12000);
 const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(result);};
 child.stdout.on('data',b=>{size+=b.length;if(size>(seconds*rate+4096)*8){child.kill();finish(Error('PCM budget exceeded'));}else chunks.push(b);});
 child.stderr.on('data',b=>{error=(error+b).slice(-1000);});child.once('error',finish);
 child.once('close',code=>{
  if(code!==0)return finish(Error(error||'Decoder unavailable'));
  try{
   const pcm=Buffer.concat(chunks),frames=Math.floor(pcm.length/8),width=Math.round(rate*step),rms=[],peak=[];
   for(let begin=0;begin<frames;begin+=width){let energy=0,max=0,count=0;
    for(let i=begin;i<Math.min(frames,begin+width);i++)for(let ch=0;ch<2;ch++){
     const v=pcm.readFloatLE(i*8+ch*4);if(!Number.isFinite(v))throw Error('Invalid PCM');energy+=v*v;max=Math.max(max,Math.abs(v));count++;
    }
    rms.push(Math.sqrt(energy/count));peak.push(max);
   }
   finish(null,{start,step,rms,peak});
  }catch(e){finish(e);}
 });
});}
(async()=>{
 try{
  const duration=await probeDuration(workerData.file,controller.signal),intro=await excerpt(workerData.file,0);
  const outro=duration<=seconds?intro:await excerpt(workerData.file,Math.max(0,duration-seconds));
  // A 16-bit quantization step: trim digital silence, not quiet musical intros.
  const first=intro.peak.findIndex(p=>p>1/32768),last=outro.peak.findLastIndex(p=>p>1/32768);
  parentPort.postMessage({result:{version:1,duration,intro,outro,leading:first>=0?first*step:0,
   trailing:last>=0?Math.max(0,duration-(outro.start+(last+1)*step)):0}});
 }catch(e){parentPort.postMessage({error:e.message});}finally{parentPort.close();}
})();

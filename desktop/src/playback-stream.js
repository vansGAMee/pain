// Stream immediately, sharing the same recording recovery as audio analysis.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=({cacheDir,resolveFile,streamFile,mimeFor,openRemote})=>async(req,res,id,{phoneUrl,refresh=false}={})=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 const controller=new AbortController();let response,output,temp;
 const discard=()=>{output?.destroy();if(temp)fs.promises.unlink(temp).catch(()=>{});};
 res.once('close',()=>{if(!res.writableFinished)controller.abort();});
 try{
  const file=!refresh&&resolveFile(id);if(file){streamFile(file,req,res,mimeFor(id));return;}
  response=await openRemote(id,{signal:controller.signal,method:req.method,range:req.headers.range,...(phoneUrl?{base:phoneUrl}:{})});
  if(controller.signal.aborted){response.destroy();return;}
  const headers={'Content-Type':response.headers['content-type']||mimeFor(id),'Accept-Ranges':'bytes'};
  for(const key of ['content-length','content-range'])if(response.headers[key])headers[key]=response.headers[key];
  res.writeHead(response.statusCode,headers);
  if(req.method==='HEAD'){response.resume();res.end();return;}
  response.on('aborted',discard);response.on('error',()=>{discard();res.destroy();});
  const cr=/^bytes 0-(\d+)\/(\d+)$/.exec(response.headers['content-range']||'');
  const whole=response.statusCode===200||(response.statusCode===206&&cr&&Number(cr[1])+1===Number(cr[2]));
  if(whole){
   await fs.promises.mkdir(cacheDir,{recursive:true});
   const target=path.join(cacheDir,id.replace(/[/\\?%*:|"<>]/g,'_')+'.mp3');temp=target+'.'+crypto.randomUUID()+'.tmp';
   output=fs.createWriteStream(temp,{flags:'wx'});output.on('error',discard);
   output.on('finish',async()=>{
    try{const stat=await fs.promises.stat(temp),expected=Number(response.headers['content-length'])||0;
     if(response.complete&&stat.size>=4096&&(!expected||stat.size===expected)){await fs.promises.rename(temp,target);temp=null;}else discard();
    }catch(_){discard();}
   });
   response.pipe(output);
  }
  response.pipe(res);
 }catch(error){
  discard();if(res.destroyed)return;
  if(res.headersSent){res.destroy();return;}
  const code=['AUDIO_NOT_ON_PHONE','AUDIO_PHONE_UNREADABLE'].includes(error.code)?error.code:'PHONE_UNAVAILABLE';
  res.writeHead(code==='PHONE_UNAVAILABLE'?502:404,{'Content-Type':'text/plain; charset=utf-8','X-Pain-Audio-Error':code});res.end(code);
 }
};

const fs=require('fs'),path=require('path'),crypto=require('crypto');
module.exports=function lyricsRoute(req,res,url,dataDir){
 if(url.pathname!=='/api/lyrics')return false;
 const id=url.searchParams.get('track');
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(!id||id.length>1024){send(400,{error:'Invalid track'});return true;}
 const dir=path.join(dataDir,'lyrics');
 const file=path.join(dir,crypto.createHash('sha256').update(id).digest('hex')+'.json');
 if(req.method==='GET'){
  try{send(200,JSON.parse(fs.readFileSync(file,'utf8')));}catch(e){send(e.code==='ENOENT'?200:500,e.code==='ENOENT'?{lines:[]}:{error:'Read failed'});}
 }else if(req.method==='PUT'){
  let chunks=[],size=0,tooLarge=false;
  req.on('data',b=>{size+=b.length;if(size>512*1024){tooLarge=true;chunks=[];}else if(!tooLarge)chunks.push(b);});
  req.on('end',()=>{
   if(tooLarge){send(413,{error:'Text too large'});return;}
   let value;
   try{value=JSON.parse(Buffer.concat(chunks).toString());
    if(!Array.isArray(value.lines)||value.lines.length>2000||value.lines.some(l=>!l||typeof l.text!=='string'||l.text.length>2000||!(l.time===null||(Number.isFinite(l.time)&&l.time>=0&&l.time<86400))))throw Error();
    let last=-1;for(const l of value.lines)if(l.time!==null){if(l.time<last)throw Error();last=l.time;}
   }catch(_){send(400,{error:'Invalid lyrics or timing order'});return;}
   try{fs.mkdirSync(dir,{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify({lines:value.lines.map(l=>({text:l.text,time:l.time})),updatedAt:Date.now()}));fs.renameSync(tmp,file);send(200,{ok:true});}catch(_){send(500,{error:'Save failed'});}
  });
 }else send(405,{error:'Method not allowed'});
 return true;
};

'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const {readBody}=require('./http-safety');
// Images live separately from playlists and audio. Replacing a cover never rewrites them.
module.exports=function artworkStore(dir,getPlaylists){
 const folder=path.join(dir,'playlist-artwork');
 return (req,res,pathname)=>{
  const match=/^\/api\/playlist-artwork\/([^/]+)(\/image)?$/.exec(pathname);
  const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(!match){reply(404,{error:'Playlist cover not found'});return;}
  let id;try{id=decodeURIComponent(match[1]);}catch(_){reply(400,{error:'Invalid playlist'});return;}
  if(!id||id.length>256||!getPlaylists().some(pl=>String(pl.id)===id)){reply(404,{error:'Плейлист не найден'});return;}
  const file=path.join(folder,createHash('sha256').update(id).digest('hex')+'.webp');
  if(req.method==='GET'&&match[2]){
   fs.promises.stat(file).then(stat=>{
    res.writeHead(200,{'Content-Type':'image/webp','Content-Length':stat.size,'Cache-Control':'private, max-age=31536000, immutable'});
    fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
   }).catch(()=>reply(404,{error:'Обложка не найдена'}));return;
  }
  if(req.method!=='POST'||match[2]){reply(405,{error:'Method not allowed'});return;}
  readBody(req,res,3*1024*1024,async body=>{
   try{
    const input=JSON.parse(body),data=/^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
    if(!data)throw Error('Не удалось прочитать обложку');
    const bytes=Buffer.from(data[1],'base64');
    if(bytes.length<20||bytes.length>2*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('Некорректное изображение обложки');
    await fs.promises.mkdir(folder,{recursive:true});
    const temp=file+'.'+randomUUID()+'.tmp';
    try{await fs.promises.writeFile(temp,bytes);await fs.promises.rename(temp,file);}finally{await fs.promises.unlink(temp).catch(()=>{});}
    reply(200,{version:createHash('sha256').update(bytes).digest('hex').slice(0,16)});
   }catch(error){reply(400,{error:error.message});}
  });
 };
};

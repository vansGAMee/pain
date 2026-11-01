'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto'),{safeWrite}=require('./data-guard'),{readBody}=require('./http-safety');
module.exports=function wallpaper(dir){
 const config=path.join(dir,'home-appearance.json'),file=path.join(dir,'home-wallpaper.bin');
 let saved={enabled:true,userSet:false,mime:null};try{saved={...saved,...JSON.parse(fs.readFileSync(config,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
 function status(){return {...saved,custom:!!saved.mime&&fs.existsSync(file),version:fs.existsSync(file)?fs.statSync(file).mtimeMs:0};}
 return (req,res,pathname)=>{
  if(pathname==='/api/appearance/wallpaper/image'&&req.method==='GET'){
   const custom=status().custom,image=custom?file:path.join(__dirname,'../assets/sakura-evening.png');res.writeHead(200,{'Content-Type':custom?saved.mime:'image/png','Cache-Control':'no-store'});fs.createReadStream(image).on('error',()=>res.destroy()).pipe(res);return;
  }
  const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(req.method==='GET'){reply(200,status());return;}if(req.method!=='POST'){reply(405,{error:'Method not allowed'});return;}
  readBody(req,res,8*1024*1024,body=>{
   try{
    const input=JSON.parse(body),next={...saved,userSet:true};
    if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')throw Error('Invalid wallpaper option');next.enabled=input.enabled;}
    if(input.dataUrl!==undefined){
     const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);if(!match)throw Error('Выберите PNG, JPEG или WebP');
     const bytes=Buffer.from(match[2],'base64');if(bytes.length>5*1024*1024||bytes.length<16)throw Error('Изображение должно быть не больше 5 МБ');
     const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!valid)throw Error('Не удалось прочитать формат изображения');
     const temporary=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,file);}finally{try{fs.unlinkSync(temporary);}catch(_){}}
     next.mime='image/'+match[1];next.enabled=true;
    }
    if(input.reset===true){next.mime=null;next.enabled=true;try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
    safeWrite(config,next);saved=next;reply(200,status());
   }catch(error){reply(400,{error:error.message});}
  });
 };
};

'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {readBody}=require('./http-safety');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
async function read(file){
  try{
    const handle=await fs.open(file,'r');
    try{if((await handle.stat()).size>1024*1024)return null;return JSON.parse(await handle.readFile('utf8'));}
    finally{await handle.close();}
  }catch(_){return null;}
}
// Disk cache only. This endpoint never downloads lyrics or probes audio files.
module.exports=function lyricsSearch(req,res,url,dir,online){
  if(url.pathname!=='/api/lyrics/search-index')return false;
  if(req.method!=='POST'){res.writeHead(405);res.end();return true;}
  readBody(req,res,512*1024,async body=>{
    let ids;try{ids=JSON.parse(body).ids;if(!Array.isArray(ids)||ids.length>128||ids.some(id=>typeof id!=='string'||!id||id.length>1024))throw Error();}
    catch(_){res.writeHead(400);res.end('{}');return;}
    const rows=[],queue=[...new Set(ids)];
    await Promise.all(Array.from({length:4},async()=>{while(queue.length&&!res.destroyed){
      const id=queue.shift();let value=await read(path.join(dir,'lyrics',hash(id)+'.json'));
      if(!value)value=await online?.cached?.(id);
      const lines=Array.isArray(value?.lines)?value.lines:[];
      const lyrics=lines.slice(0,2000).filter(l=>typeof l?.text==='string').map(l=>l.text.slice(0,2000)).join('\n').slice(0,200000);
      rows.push({id,lyrics});
    }}));
    if(!res.destroyed){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({rows}));}
  });return true;
};
module.exports.read=read;
module.exports.key=hash;

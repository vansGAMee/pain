'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {readBody}=require('./http-safety');
module.exports=function createCheckpoint(dir,{getTracks=()=>[]}={}){
  const file=path.join(dir,'last-playback.json');let saved=null,tail=Promise.resolve();
  const valid=value=>value&&typeof value.id==='string'&&value.id.length<=1024&&Number.isFinite(value.position)&&value.position>=0&&value.position<=86400&&Number.isFinite(value.updatedAt)&&value.updatedAt>0;
  const ready=fs.readFile(file,'utf8').then(JSON.parse).then(value=>{if(valid(value))saved=value;}).catch(()=>{});
  return function route(req,res,url){
    if(url.pathname!=='/api/playback-checkpoint')return false;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return true;}
    const send=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
    if(req.method==='GET'){ready.then(()=>send(200,{value:saved}));return true;}
    if(req.method!=='POST'){send(405,{});return true;}
    readBody(req,res,4096,async body=>{
      let value;try{value=JSON.parse(body);if(!valid(value))throw Error();}catch(_){send(400,{});return;}
      await ready;const track=getTracks().find(t=>String(t.id)===value.id);
      if(!track){send(404,{});return;}
      if(saved&&value.updatedAt<saved.updatedAt){send(200,{ok:true});return;}
      saved={id:value.id,position:value.position,updatedAt:value.updatedAt,title:track.title||'',artist:track.artist||'',duration:Number(track.duration)||0};
      // Serial atomic writes preserve the newest snapshot when timeupdate,
      // pause and quit arrive together. Nothing blocks the audio event loop.
      const snapshot=JSON.stringify(saved);
      const job=tail.catch(()=>{}).then(async()=>{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});tail=job;
      try{await job;send(200,{ok:true});}catch(_){send(500,{});}
    });return true;
  };
};

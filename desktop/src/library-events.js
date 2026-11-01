'use strict';
const fs=require('node:fs');
// One filesystem watcher, no per-window polling. Bounded clients and output.
module.exports=function libraryEvents(dir,onChange){
 const clients=new Set();let timer,revision=Date.now();
 const watcher=fs.watch(dir,(event,name)=>{if(!['library.json','library-removals.json'].includes(String(name)))return;clearTimeout(timer);timer=setTimeout(()=>{onChange();revision++;for(const res of clients){if(res.writableLength>4096){res.destroy();clients.delete(res);}else res.write('data: '+revision+'\n\n');}},80);timer.unref();});watcher.unref();
 return {route(req,res){if(clients.size>=8){res.writeHead(429);res.end();return;}res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});clients.add(res);res.write('data: '+revision+'\n\n');req.on('close',()=>clients.delete(res));},close(){clearTimeout(timer);watcher.close();for(const res of clients)res.end();clients.clear();}};
};

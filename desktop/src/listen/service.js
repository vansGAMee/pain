'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto'),{pipeline}=require('node:stream');
const WebSocket=require('ws'),connect=require('./connection'),recordings=require('../companion-model');
module.exports=function createListening(dataDir,{getTracks,getPort,defaults={}}){
 const file=path.join(dataDir,'listen-settings.json');let settings={server:'',pin:'',name:'Слушатель',...defaults};
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));settings={...settings,server:String(saved.server||settings.server),pin:String(saved.pin||''),name:String(saved.name||'Слушатель').slice(0,40)};}catch(_){}
 let socket,transport,state=null,identity=null,credentials=null,error='',retryTimer,pingTimer,attempt=0,closed=false,clockOffset=0,clockRtt=null;
 const watchers=new Set(),waiting=new Map(),uploads=new Set(),offered=new Set();
 function snapshot(){const library=state?recordings.index(getTracks()):null;return {settings,connected:socket?.readyState===WebSocket.OPEN&&!!state,connecting:!!credentials&&!state,identity,error,clockRtt,serverNow:Date.now()+clockOffset,
  state:state?{...state,queue:state.queue.map(item=>{const local=recordings.resolve({id:item.trackId,...item},library);return {...item,localId:local?String(local.id):null};})}:null};}
 function notify(){const message='data: '+JSON.stringify(snapshot())+'\n\n';for(const response of watchers){if(response.writableLength>65536){response.destroy();watchers.delete(response);}else response.write(message);}}
 function send(message){if(socket?.readyState!==WebSocket.OPEN)throw Error('Нет соединения с комнатой');socket.send(JSON.stringify(message));}
 function cancelPending(){for(const job of waiting.values()){clearTimeout(job.timer);job.reject(Error('Соединение закрыто'));}waiting.clear();for(const request of uploads)request.destroy();uploads.clear();}
 function stop(leave=true){
  closed=true;clearTimeout(retryTimer);clearInterval(pingTimer);if(leave&&identity)try{send({type:'leave'});}catch(_){}
  socket?.close();socket=null;transport?.close();transport=null;cancelPending();state=identity=credentials=null;offered.clear();notify();
 }
 function dial(){
  closed=false;clearTimeout(retryTimer);transport?.close();transport=connect(settings.server,settings.pin);
  const ws=socket=new WebSocket(transport.websocket,{agent:transport.agent,perMessageDeflate:false,maxPayload:262144,handshakeTimeout:15000});
  ws.on('error',e=>{if(ws===socket){error=e.message;notify();}});
  ws.on('open',()=>{
   if(ws!==socket)return;attempt=0;error='';
   ws.send(JSON.stringify({...credentials,name:settings.name}));
   clearInterval(pingTimer);const ping=()=>{try{send({type:'ping',sent:Date.now()});}catch(_){}};ping();pingTimer=setInterval(ping,10000);pingTimer.unref();
  });
  ws.on('message',raw=>{
   if(ws!==socket)return;
   try{
    const message=JSON.parse(raw);
    if(message.type==='welcome'){identity=message.member;credentials={type:'resume',room:message.room,member:identity,resume:message.resume};credentials.secret=message.secret;notify();}
    else if(message.type==='state'){
     const p=message.playback;
     if(!Array.isArray(message.queue)||message.queue.length>100||!Array.isArray(message.proposals)||message.proposals.length>100||!Array.isArray(message.members)||message.members.length>8||!p||!Number.isFinite(p.position)||!Number.isFinite(p.at)||typeof p.paused!=='boolean'||!Number.isInteger(p.epoch))throw Error('Сервер прислал неверное состояние комнаты');
     for(const item of [...message.queue,...message.proposals])if(!item||typeof item.uid!=='string'||!/^[\w-]{1,100}$/.test(item.uid)||typeof item.trackId!=='string'||item.trackId.length>1024||typeof item.title!=='string'||item.title.length>300||typeof item.artist!=='string'||item.artist.length>300||!Number.isFinite(item.duration)||item.duration<=0)throw Error('Сервер прислал неверный трек');
     if(message.queue.length+message.proposals.length>100||!['host','equal'].includes(message.mode)||!message.members.every(m=>m&&typeof m.id==='string'&&/^[\w-]{1,100}$/.test(m.id)&&typeof m.name==='string'&&m.name.length<=40&&typeof m.connected==='boolean')||!message.members.some(m=>m.id===message.host)||p.position<0||p.position>86400||p.epoch<0||(p.uid!==null&&!message.queue.some(item=>item.uid===p.uid)))throw Error('Сервер прислал неверное состояние комнаты');
     state=message;error='';notify();
    }else if(message.type==='closed'){stop(false);error='Ведущий закрыл комнату';notify();}
    else if(message.type==='error'){if(!identity||message.code==='ROOM_CLOSED')stop(false);error=message.message;notify();}
    else if(message.type==='pong'){
     const now=Date.now(),rtt=now-message.sent;if(Number.isFinite(rtt)&&rtt>=0&&Number.isFinite(message.serverNow)){clockRtt=rtt;clockOffset=message.serverNow-(message.sent+now)/2;}
    }else if(message.type==='stream-ready'){
     const job=waiting.get(message.request);if(job){waiting.delete(message.request);clearTimeout(job.timer);job.resolve(message.ticket);}
    }else if(message.type==='serve')serve(message);
   }catch(e){error=e.message;notify();}
  });
  ws.on('close',()=>{
   if(ws!==socket)return;cancelPending();clearInterval(pingTimer);state=null;notify();
   if(!closed&&credentials){retryTimer=setTimeout(()=>{try{dial();}catch(e){error=e.message;notify();}},Math.min(30000,1000*2**Math.min(attempt++,5)));retryTimer.unref();}
  });
 }
 function serve(message){
  if(!/^[\w-]{32}$/.test(message.ticket)||!/^[\w-]{32}$/.test(message.upload))return;
  // Only an explicitly offered library item can be read. No arbitrary paths,
  // URLs, library enumeration or commands are accepted from a relay.
  const id=String(message.track),track=getTracks().find(t=>String(t.id)===id);
  if(!offered.has(id)||!track)return;
  const source=http.get({hostname:'127.0.0.1',port:getPort(),path:'/api/cached-track/'+encodeURIComponent(id),headers:message.range?{Range:message.range}:{}},response=>{
   const headers={'X-Pain-Upload':message.upload,'X-Pain-Audio-Status':String(response.statusCode)};
   for(const name of ['content-type','content-length','content-range'])if(response.headers[name])headers[name]=response.headers[name];
   const upload=transport.request('/stream/'+message.ticket,{method:'POST',headers},ack=>ack.resume());uploads.add(upload);
   pipeline(response,upload,()=>{uploads.delete(upload);uploads.delete(source);});upload.on('error',()=>{});
  });
  uploads.add(source);source.setTimeout(30000,()=>source.destroy(Error('Audio source timed out')));
  source.on('error',()=>{uploads.delete(source);try{send({type:'stream-error',ticket:message.ticket});}catch(_){}});
 }
 async function stream(req,res,uid){
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const item=state?.queue.find(t=>t.uid===uid);if(!item){res.writeHead(404);res.end();return;}
  const local=recordings.resolve({id:item.trackId,...item},getTracks());
  if(local){
   const upstream=http.request({hostname:'127.0.0.1',port:getPort(),path:'/api/cached-track/'+encodeURIComponent(local.id),method:req.method,headers:req.headers.range?{Range:req.headers.range}:{}},response=>{res.writeHead(response.statusCode,response.headers);pipeline(response,res,()=>{});});
   res.once('close',()=>upstream.destroy());upstream.on('error',()=>res.destroy());upstream.end();return;
  }
  if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'audio/mpeg','Accept-Ranges':'bytes'});res.end();return;}
  try{
   if(waiting.size>=4){res.writeHead(429);res.end();return;}
   const request=randomUUID(),ticket=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(request);reject(Error('Источник не отвечает'));},20000);waiting.set(request,{resolve,reject,timer});send({type:'stream',request,uid,range:req.headers.range});});
   if(res.destroyed){try{send({type:'cancel-stream',ticket});}catch(_){}return;}
   const download=transport.request('/stream/'+ticket,{method:'GET'},response=>{
    if(res.destroyed){response.destroy();return;}res.writeHead(response.statusCode,response.headers);pipeline(response,res,()=>{});
   });
   res.once('close',()=>download.destroy());download.setTimeout(60000,()=>download.destroy(Error('Поток не отвечает')));download.on('error',()=>res.destroy());download.end();
  }catch(e){if(!res.destroyed){res.writeHead(502);res.end(e.message);}}
 }
 async function route(req,res,pathname){
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return;}
  if(pathname.startsWith('/api/listen/audio/'))return stream(req,res,decodeURIComponent(pathname.slice('/api/listen/audio/'.length)));
  if(pathname==='/api/listen/events'&&req.method==='GET'){
   if(watchers.size>=8){res.writeHead(429);res.end();return;}res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});watchers.add(res);notify();res.once('close',()=>watchers.delete(res));return;
  }
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'){res.end(JSON.stringify(snapshot()));return;}
  if(req.method!=='POST'||req.headers['x-pain-update']!=='listen'){res.writeHead(403);res.end('{}');return;}
  try{
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)throw Error('Request too large');}const input=JSON.parse(body);
   if(input.action==='settings'){
    const checked=connect(input.server,input.pin);checked.close();settings={server:checked.base,pin:checked.pin,name:String(input.name||'Слушатель').slice(0,40)};
    require('../data-guard').safeWrite(file,settings);notify();
   }else if(input.action==='create'||input.action==='join'){
    stop();error='';clockRtt=null;clockOffset=0;
    if(input.action==='join'){
     const invite=new URL(input.invite);if(invite.protocol!=='pain-listen:')throw Error('Нужна ссылка приглашения Pain');
     const checked=connect(invite.searchParams.get('server'),invite.searchParams.get('pin')||'');checked.close();
     settings={...settings,server:checked.base,pin:checked.pin};credentials={type:'join',room:invite.searchParams.get('room'),secret:invite.searchParams.get('key')};
    }else credentials={type:'create',mode:input.mode};
    dial();
   }else if(input.action==='leave'){stop();error='';}
   else if(input.action==='invite'){
    if(!credentials?.secret||!identity)throw Error('Сначала создайте комнату');const url=new URL('pain-listen://join');for(const [key,value]of Object.entries({server:settings.server,pin:settings.pin,room:credentials.room,key:credentials.secret}))url.searchParams.set(key,value);res.end(JSON.stringify({invite:url.href}));return;
   }else if(input.action==='add'){
    const track=getTracks().find(t=>String(t.id)===String(input.trackId));if(!track)throw Error('Трек не найден в вашей фонотеке');offered.add(String(track.id));send({type:'add',track:recordings.pack(track)});
   }else{
    const allowed=new Set(['play','transport','next','accept','remove','move','mode']);if(!allowed.has(input.action))throw Error('Unknown action');
    send({type:input.action,uid:input.uid,position:input.position,paused:input.paused,to:input.to,mode:input.mode,automatic:input.automatic,epoch:input.epoch});
   }
   res.end(JSON.stringify(snapshot()));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}
 }
 return {route,snapshot,close(){stop();for(const response of watchers)response.end();watchers.clear();}};
};

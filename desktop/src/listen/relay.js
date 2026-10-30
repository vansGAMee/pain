'use strict';
// A stateless, independently hosted room relay. Audio is piped, never stored.
const {randomBytes,randomUUID,timingSafeEqual}=require('node:crypto');
const {pipeline}=require('node:stream');
const {WebSocketServer,WebSocket}=require('ws');
const token=()=>randomBytes(24).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const position=(p,now=Date.now())=>p.position+(p.paused?0:Math.max(0,now-p.at)/1000);
const boundedText=(v,n=300)=>String(v||'').slice(0,n);

function createRelay(server,{maxRooms=32,maxClients=96,idleMs=30*60*1000}={}){
 const rooms=new Map(),transfers=new Map();
 const wss=new WebSocketServer({server,maxPayload:32768,perMessageDeflate:false});
 function send(ws,value){if(ws?.readyState===WebSocket.OPEN&&ws.bufferedAmount<65536)ws.send(JSON.stringify(value));}
 function broadcast(room){
  room.touched=Date.now();
  const state={type:'state',room:room.id,mode:room.mode,host:room.host,revision:++room.revision,
   members:[...room.members.values()].map(m=>({id:m.id,name:m.name,connected:!!m.ws})),
   queue:room.queue,proposals:room.proposals,playback:room.playback,serverNow:Date.now()};
  for(const member of room.members.values())send(member.ws,state);
 }
 function cancelTransfer(id){const transfer=transfers.get(id);if(!transfer)return;transfers.delete(id);clearTimeout(transfer.timer);transfer.input?.destroy();transfer.output?.destroy();}
 function attachTransfer(transfer){
  if(!transfer.input||!transfer.output)return;
  const {input,output}=transfer;clearTimeout(transfer.timer);
  // Node pipeline propagates backpressure and cancels the upload on disconnect.
  const headers={'Content-Type':/^audio\//.test(input.headers['content-type']||'')?input.headers['content-type']:'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store'};
  for(const name of ['content-length','content-range'])if(input.headers[name])headers[name]=input.headers[name];
  const status=Number(input.headers['x-pain-audio-status']);
  output.writeHead([200,206,416].includes(status)?status:502,headers);
  pipeline(input,output,()=>{transfer.ack?.end();cancelTransfer(transfer.id);});
 }
 function canControl(room,member){return room.mode==='equal'||room.host===member.id;}
 function start(room,uid,at=0,paused=false){
  const item=room.queue.find(t=>t.uid===uid);if(!item)throw Error('Трек отсутствует в очереди');
  room.playback={uid,position:Math.min(Math.max(0,Number(at)||0),item.duration/1000||86400),paused,at:Date.now(),epoch:room.playback.epoch+1};
 }
 wss.on('connection',(ws,req)=>{
  if(wss.clients.size>maxClients){ws.close(1013,'Server busy');return;}
  let room,member,messages=0,windowStart=Date.now();ws.alive=true;
  const authTimer=setTimeout(()=>{if(!member)ws.close(1008,'Join a room first');},10000);authTimer.unref();
  ws.on('pong',()=>ws.alive=true);ws.on('error',()=>{});
  ws.on('message',(raw,binary)=>{
   try{
    if(binary)throw Error('Only control messages are accepted');
    if(Date.now()-windowStart>1000){windowStart=Date.now();messages=0;}
    if(++messages>30)throw Error('Too many commands');
    const m=JSON.parse(raw);
    if(m.type==='ping'){send(ws,{type:'pong',sent:m.sent,serverNow:Date.now()});return;}
    if(!member){
     if(m.type==='create'){
      if(rooms.size>=maxRooms)throw Error('Сервер заполнен, попробуйте позже');
      room={id:token(),secret:token(),host:null,mode:m.mode==='equal'?'equal':'host',members:new Map(),queue:[],proposals:[],revision:0,touched:Date.now(),playback:{uid:null,position:0,paused:true,at:Date.now(),epoch:0}};rooms.set(room.id,room);
     }else{
      room=rooms.get(m.room);if(!room)throw Object.assign(Error('Комната закрыта или не существует'),{code:'ROOM_CLOSED'});
      if(m.type==='resume'){
       const old=room.members.get(m.member);if(!old||!equal(m.resume,old.resume))throw Error('Неверный ключ подключения');
       old.ws?.close(1000,'Reconnected');member=old;
      }else if(m.type!=='join'||!equal(m.secret,room.secret))throw Error('Неверная ссылка приглашения');
     }
     if(!member){if(room.members.size>=8)throw Error('В комнате уже 8 участников');member={id:randomUUID(),resume:token(),name:boundedText(m.name||'Слушатель',40),ws:null};room.members.set(member.id,member);}
     member.ws=ws;if(!room.host)room.host=member.id;clearTimeout(authTimer);
     send(ws,{type:'welcome',member:member.id,resume:member.resume,room:room.id,secret:room.secret});broadcast(room);return;
    }
    if(member.ws!==ws)return;
    room.touched=Date.now();
    if(m.type==='leave'){
     if(room.host===member.id){rooms.delete(room.id);for(const peer of room.members.values()){send(peer.ws,{type:'closed'});peer.ws?.close(1000,'Room closed');}}
     else{if(room.queue.find(t=>t.uid===room.playback.uid)?.owner===member.id)room.playback={uid:null,position:0,paused:true,at:Date.now(),epoch:room.playback.epoch+1};room.members.delete(member.id);room.queue=room.queue.filter(t=>t.owner!==member.id);room.proposals=room.proposals.filter(t=>t.owner!==member.id);broadcast(room);}
     return;
    }
    if(m.type==='stream'){
     const item=room.queue.find(t=>t.uid===m.uid),owner=item&&room.members.get(item.owner);
     if(!owner?.ws)throw Error('Владелец файла сейчас не подключён');
     if(transfers.size>=64||[...transfers.values()].filter(t=>t.member===member.id).length>=4)throw Error('Слишком много потоков');
     const id=token(),upload=token(),transfer={id,upload,member:member.id,room:room.id,source:item.owner};
     transfer.timer=setTimeout(()=>cancelTransfer(id),60000);transfer.timer.unref();transfers.set(id,transfer);
     send(ws,{type:'stream-ready',request:m.request,ticket:id});
     send(owner.ws,{type:'serve',ticket:id,upload,track:item.trackId,range:typeof m.range==='string'&&/^bytes=\d+-\d*$/.test(m.range)?m.range:null});return;
    }
    if(m.type==='cancel-stream'){const transfer=transfers.get(m.ticket);if(transfer?.member===member.id)cancelTransfer(transfer.id);return;}
    if(m.type==='stream-error'){const transfer=transfers.get(m.ticket);if(transfer?.source===member.id)cancelTransfer(transfer.id);return;}
    if(m.type==='add'){
     if(room.queue.length+room.proposals.length>=100)throw Error('Очередь заполнена (100 треков)');
     const t=m.track;if(!t||typeof t.id!=='string'||!t.id||t.id.length>1024||!Number.isFinite(t.duration)||t.duration<=0||t.duration>86400000)throw Error('Некорректная запись');
     const item={uid:randomUUID(),owner:member.id,trackId:t.id,title:boundedText(t.title),artist:boundedText(t.artist),album:boundedText(t.album),duration:t.duration,bytes:Number.isSafeInteger(t.bytes)&&t.bytes>=0?t.bytes:0};
     (canControl(room,member)?room.queue:room.proposals).push(item);broadcast(room);return;
    }
    if(!canControl(room,member))throw Error('Этот режим управляется ведущим. Можно предложить трек.');
    if(m.type==='accept'){
     const index=room.proposals.findIndex(t=>t.uid===m.uid);if(index>=0)room.queue.push(...room.proposals.splice(index,1));
    }else if(m.type==='remove'){
     room.proposals=room.proposals.filter(t=>t.uid!==m.uid);room.queue=room.queue.filter(t=>t.uid!==m.uid);
     if(room.playback.uid===m.uid)room.playback={uid:null,position:0,paused:true,at:Date.now(),epoch:room.playback.epoch+1};
    }else if(m.type==='move'){
     const index=room.queue.findIndex(t=>t.uid===m.uid),to=Number(m.to);if(index>=0&&Number.isInteger(to)&&to>=0&&to<room.queue.length)room.queue.splice(to,0,...room.queue.splice(index,1));
    }else if(m.type==='play')start(room,m.uid,m.position||0,!!m.paused);
    else if(m.type==='transport'){
     if(!room.playback.uid)return;
     const at=Number.isFinite(m.position)?m.position:position(room.playback);
     start(room,room.playback.uid,at,typeof m.paused==='boolean'?m.paused:room.playback.paused);
    }else if(m.type==='next'){
     // Concurrent natural endings advance once for the same playback epoch.
     if(m.automatic&&m.epoch!==room.playback.epoch)return;
     const index=room.queue.findIndex(t=>t.uid===room.playback.uid),next=room.queue[index+1];
     if(next)start(room,next.uid);else room.playback={...room.playback,position:position(room.playback),paused:true,at:Date.now(),epoch:room.playback.epoch+1};
    }else if(m.type==='mode'&&room.host===member.id)room.mode=m.mode==='equal'?'equal':'host';
    else throw Error('Неизвестная команда');
    broadcast(room);
   }catch(error){send(ws,{type:'error',message:error.message,code:error.code});}
  });
  ws.on('close',()=>{
   clearTimeout(authTimer);if(!room||!member||member.ws!==ws)return;member.ws=null;
   for(const [id,t]of transfers)if(t.member===member.id||t.source===member.id)cancelTransfer(id);
   if(room.queue.find(t=>t.uid===room.playback.uid)?.owner===member.id)room.playback={...room.playback,position:position(room.playback),paused:true,at:Date.now()};
   broadcast(room);
  });
 });
 const housekeeping=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.alive)ws.terminate();else{ws.alive=false;ws.ping();}}
  for(const [id,room]of rooms)if(![...room.members.values()].some(m=>m.ws)&&Date.now()-room.touched>idleMs)rooms.delete(id);
 },20000);housekeeping.unref();
 function route(req,res){
  const path=new URL(req.url,'https://relay.local').pathname;
  if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({service:'pain-listen',protocol:1,rooms:rooms.size,connections:wss.clients.size,streams:transfers.size}));return;}
  const match=/^\/stream\/([\w-]{32})$/.exec(path),transfer=match&&transfers.get(match[1]);
  if(!transfer){res.writeHead(404);res.end();return;}
  if(req.method==='GET'&&!transfer.output){transfer.output=res;res.once('close',()=>cancelTransfer(transfer.id));}
  else if(req.method==='POST'&&!transfer.input&&equal(req.headers['x-pain-upload'],transfer.upload)){transfer.input=req;transfer.ack=res;req.setTimeout(30000,()=>cancelTransfer(transfer.id));req.pause();}
  else{res.writeHead(403);res.end();return;}
  attachTransfer(transfer);
 }
 return {route,close(){clearInterval(housekeeping);for(const id of transfers.keys())cancelTransfer(id);for(const ws of wss.clients)ws.terminate();wss.close();},rooms,transfers};
}
module.exports={createRelay,position};
if(require.main===module){
 const fs=require('node:fs');let relay;
 const handler=(req,res)=>relay.route(req,res);
 const server=process.env.TLS_CERT&&process.env.TLS_KEY?require('node:https').createServer({cert:fs.readFileSync(process.env.TLS_CERT),key:fs.readFileSync(process.env.TLS_KEY)},handler):require('node:http').createServer(handler);
 relay=createRelay(server);server.headersTimeout=10000;server.requestTimeout=0;server.maxConnections=128;
 server.listen(Number(process.env.PORT)||8448,process.env.BIND||'0.0.0.0',()=>console.log('Pain listening relay ready'));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{relay.close();server.close(()=>process.exit(0));});
}

'use strict';
// Native Discord IPC: no OAuth token, bot, paid service or network listener.
const net=require('node:net'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const CLIENT_ID='1565047962818838568';
const PAIN_ICON='https://raw.githubusercontent.com/vansGAMee/pain/main/desktop/assets/app-icon.png';
const text=(s,n=128)=>String(s||'').replace(/[\x00-\x1f]/g,' ').slice(0,n).trim();
function paths(platform=process.platform,env=process.env){
 if(platform==='win32')return Array.from({length:10},(_,i)=>`\\\\?\\pipe\\discord-ipc-${i}`);
 const dirs=[env.XDG_RUNTIME_DIR,env.TMPDIR,env.TMP,env.TEMP,os.tmpdir(),'/tmp'];
 if(env.XDG_RUNTIME_DIR)dirs.push(path.join(env.XDG_RUNTIME_DIR,'app/com.discordapp.Discord'),path.join(env.XDG_RUNTIME_DIR,'snap.discord'));
 return [...new Set(dirs.filter(Boolean))].flatMap(dir=>Array.from({length:10},(_,i)=>path.join(dir,'discord-ipc-'+i)));
}
function frame(op,data){const body=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data)),head=Buffer.alloc(8);head.writeUInt32LE(op);head.writeUInt32LE(body.length,4);return Buffer.concat([head,body]);}
function activity(state,now=Date.now(),type=2){
 if(!state?.track||!state.track.title)return null;
 const t=state.track,title=text(t.title),artist=text(t.artist)||'Unknown artist',album=text(t.album);
 const line=text(artist+(t.favorite?' · ♥':'')+(state.smart?' · Smart DJ':''));
 const result={name:'PAIN',type,instance:true,status_display_type:2,details:title,state:state.playing?line:text(`⏸ ${line}`),assets:{large_image:PAIN_ICON,large_text:album||'PAIN · local music',small_image:PAIN_ICON,small_text:'PAIN · local music'},buttons:[{label:'Найти песню',url:'https://music.youtube.com/search?'+new URLSearchParams({q:artist+' '+title})},{label:'PAIN · локальная музыка',url:'https://github.com/vansGAMee/pain'}]};
 if(state.playing&&Number.isFinite(state.duration)&&state.duration>0){const rate=Math.min(4,Math.max(.25,Number(state.rate)||1)),position=Math.min(state.duration,Math.max(0,Number(state.position)||0)),start=Math.floor((state.observedAt||now)/1000-position/rate);result.timestamps={start,end:Math.floor(start+state.duration/rate)};}
 try{const image=new URL(state.image);if(image.protocol==='https:'&&/^(?:[a-z0-9.-]+\.mzstatic\.com|coverartarchive\.org|archive\.org)$/.test(image.hostname))result.assets.large_image=image.href;}catch(_){}
 return result;
}
module.exports=function createPresence(dir,{connect=net.createConnection,sockets=()=>paths(),now=Date.now}={}){
 const file=path.join(dir,'discord-presence.json');let enabled=false;try{enabled=JSON.parse(fs.readFileSync(file,'utf8')).enabled===true;}catch(_){}
 let socket,ready=false,closed=false,connecting=false,timer,updateTimer,handshake,buffer=Buffer.alloc(0),current,lastSent='',inflight,lastError=null,appName,generation=0,nextAttempt=0,published=false,lastPublished,sentAt=[];
 let transport='discord';
 const currentActivity=()=>activity(current,now(),transport==='arrpc'?0:2);
 const status=()=>{const pending=enabled&&!!current&&JSON.stringify(currentActivity())!==lastSent,window=sentAt.filter(stamp=>now()-stamp<20000);return {enabled,connected:ready,published,transport,visibility:'unknown',applicationId:CLIENT_ID,appName:appName||null,error:lastError,currentTrack:current?.track?.title||null,publishedTrack:published?lastPublished?.details||null:null,publishedState:published?lastPublished?.state||null:null,publishedTimestamps:published?lastPublished?.timestamps||null:null,pending,retryAfterMs:pending&&window.length>=5?Math.max(0,20000-(now()-window[0])):0};};
 function write(op,data){if(socket&&!socket.destroyed)socket.write(frame(op,data));}
 function retry(){clearTimeout(timer);nextAttempt=now()+15000;if(enabled&&!closed){timer=setTimeout(start,15000);timer.unref?.();}}
 function schedule(){if(updateTimer||!enabled||!ready)return;updateTimer=setTimeout(()=>{updateTimer=null;flush();},250);updateTimer.unref?.();}
 function flush(){
  if(!enabled||!ready||inflight||!current)return;
  const next=currentActivity(),key=JSON.stringify(next);if(key===lastSent)return;
  // Discord's documented ActivityManager limit: five updates in 20 seconds.
  // https://discord.com/developers/docs/developer-tools/game-sdk#activitymanager-updateactivity
  sentAt=sentAt.filter(stamp=>now()-stamp<20000);const wait=sentAt.length>=5?20000-(now()-sentAt[0])+1:0;
  if(wait>0){clearTimeout(timer);timer=setTimeout(flush,wait);timer.unref?.();return;}
  const nonce=crypto.randomUUID();inflight={nonce,key,activity:next};sentAt.push(now());write(1,{cmd:'SET_ACTIVITY',args:{pid:process.pid,activity:next},nonce});
  clearTimeout(handshake);handshake=setTimeout(()=>socket?.destroy(),8000);handshake.unref?.();
 }
 function receive(data){
  buffer=Buffer.concat([buffer,data]);if(buffer.length>1024*1024){socket?.destroy();return;}
  while(buffer.length>=8){const op=buffer.readUInt32LE(0),size=buffer.readUInt32LE(4);if(size>1024*1024){socket?.destroy();return;}if(buffer.length<size+8)return;const raw=buffer.subarray(8,8+size);buffer=buffer.subarray(8+size);
   if(op===3){write(4,raw);continue;}if(op===2){try{lastError=text(JSON.parse(raw.toString('utf8')).message)||'Discord closed the connection';}catch(_){lastError='Discord closed the connection';}socket?.destroy();return;}if(op!==1)continue;
   let reply;try{reply=JSON.parse(raw.toString('utf8'));}catch(_){socket?.destroy();return;}
   if(process.env.PAIN_RPC_DEBUG==='true'&&reply.evt!=='READY')console.log('[DiscordRPC]',JSON.stringify({cmd:reply.cmd,evt:reply.evt,matches:reply.nonce===inflight?.nonce,keys:Object.keys(reply.data||{}),error:reply.data?.message,name:reply.data?.name}));
   if(reply.evt==='READY'){
    // arRPC identifies itself with a documented mock user and acknowledges
    // before its web client publishes anything. Use its default Playing path;
    // keep native Discord's Listening activity and the same music details.
    transport=reply.data?.user?.id==='1045800378228281345'&&reply.data?.user?.username==='arrpc'?'arrpc':'discord';
    ready=true;connecting=false;lastError=null;clearTimeout(handshake);schedule();
   }
   else if(inflight&&reply.nonce===inflight.nonce){clearTimeout(handshake);if(reply.evt==='ERROR'){lastError=text(reply.data?.message);lastSent=inflight.key;published=false;}else{lastSent=inflight.key;lastPublished=inflight.activity;lastError=null;published=inflight.key!=='null';appName=reply.data?.name||reply.data?.activity?.name||appName;}inflight=null;schedule();}
  }
 }
 async function start(){
  if(!enabled||closed||connecting||ready||now()<nextAttempt)return;connecting=true;const stamp=generation;
  for(const candidate of sockets()){
   if(!enabled||closed||stamp!==generation)break;
   const connected=await new Promise(resolve=>{let done=false;const client=connect({path:candidate});const finish=ok=>{if(done)return;done=true;clearTimeout(timeout);if(!ok)client.destroy();resolve(ok);};const timeout=setTimeout(()=>finish(false),500);timeout.unref?.();
    client.on('error',()=>finish(false));client.once('connect',()=>{if(!enabled||closed||stamp!==generation){finish(false);return;}socket=client;buffer=Buffer.alloc(0);lastSent='';inflight=null;client.on('data',receive);client.once('close',()=>{if(socket!==client)return;ready=false;published=false;connecting=false;socket=null;clearTimeout(handshake);clearTimeout(updateTimer);updateTimer=null;inflight=null;retry();});write(0,{v:1,client_id:CLIENT_ID});handshake=setTimeout(()=>client.destroy(),5000);handshake.unref?.();finish(true);});
   });if(connected)return;
  }
  if(stamp!==generation)return;connecting=false;retry();
 }
 function stop(){generation++;clearTimeout(timer);clearTimeout(updateTimer);updateTimer=null;clearTimeout(handshake);sentAt=sentAt.filter(stamp=>now()-stamp<20000);if(ready&&sentAt.length<5){sentAt.push(now());write(1,{cmd:'SET_ACTIVITY',args:{pid:process.pid,activity:null},nonce:crypto.randomUUID()});}const old=socket;socket=null;ready=false;published=false;connecting=false;inflight=null;old?.end();setTimeout(()=>old?.destroy(),250).unref?.();}
 const api={status,start,update(value){
  const next=value?{...value,observedAt:value.observedAt||now()}:{track:null};
  // Playback clocks advance in Discord itself. A periodic heartbeat confirms
  // liveness; only real track/play/seek/rate events re-anchor the clock.
  if(value?.heartbeat&&current?.track&&next.track&&current.track.id===next.track.id&&current.playing===next.playing&&(current.rate||1)===(next.rate||1)){next.observedAt=current.observedAt;next.position=current.position;}
  current=next;if(enabled){if(ready)schedule();else start();}
 },setArtwork(id,image){if(current?.track?.id===id){current={...current,image};if(enabled)schedule();}},setEnabled(value){const before=enabled;enabled=value===true;if(enabled&&!before)current=undefined;fs.mkdirSync(dir,{recursive:true});require('./data-guard').safeWrite(file,{enabled});if(enabled){nextAttempt=0;start();}else stop();return status();},close(){closed=true;stop();}};
 if(enabled)start();return api;
};
module.exports.paths=paths;module.exports.frame=frame;module.exports.activity=activity;

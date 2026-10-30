'use strict';
const https=require('node:https'),tls=require('node:tls'),crypto=require('node:crypto');
function connection(address,pin=''){
 const base=new URL(address);base.protocol=base.protocol==='wss:'?'https:':base.protocol==='ws:'?'http:':base.protocol;
 if(base.username||base.password||!['http:','https:'].includes(base.protocol))throw Error('Нужен адрес HTTPS сервера');
 if(base.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('Для удалённого сервера нужен HTTPS');
 base.pathname='/';base.search='';base.hash='';
 pin=String(pin).replace(/:/g,'').toLowerCase();if(pin&&!/^[a-f0-9]{64}$/.test(pin))throw Error('Неверный SHA-256 сертификата');
 let agent;
 if(pin){
  agent=new https.Agent({keepAlive:true,maxSockets:8});
  agent.createConnection=(options,callback)=>{
   // No invitation, room token or audio request leaves this socket before
   // the exact certificate from the invitation has been verified.
   const socket=tls.connect({...options,rejectUnauthorized:false});let finished=false;
   socket.once('error',error=>{if(!finished){finished=true;callback(error);}});
   socket.once('secureConnect',()=>{
    const cert=socket.getPeerCertificate(),actual=cert.raw&&crypto.createHash('sha256').update(cert.raw).digest('hex');
    if(actual!==pin){finished=true;callback(Error('Сертификат сервера не совпадает с приглашением'));socket.destroy();return;}
    finished=true;callback(null,socket);
   });
  };
 }
 const url=path=>new URL(path,base),transport=base.protocol==='https:'?https:require('node:http');
 return {base:base.origin,pin,agent,url,websocket:base.href.replace(/^http/,'ws'),request:(pathname,options,callback)=>transport.request(url(pathname),{agent,...options},callback),close:()=>agent?.destroy()};
}
module.exports=connection;

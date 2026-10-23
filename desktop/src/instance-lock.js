// One Windows backend per user, shared by the standalone EXE and the ZIP copy.
// An exclusive loopback listener is released on exit/crash. Windows named pipes
// allow multiple servers with the same name, so they cannot be used as a mutex.
const net=require('net'),os=require('os'),{createHash}=require('crypto');
function endpoint(){return {host:'127.0.0.1',port:48000+createHash('sha256').update(os.userInfo().username).digest().readUInt16BE(0)%8000,exclusive:true};}
function claim({address=endpoint(),activate=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const lock=net.createServer(socket=>{
   socket.setTimeout(1000,()=>socket.destroy());
   socket.once('data',data=>{if(data.toString()==='activate')activate();socket.end();});
   socket.on('error',()=>{});
  });
  lock.once('error',error=>{
   if(error.code!=='EADDRINUSE'){reject(error);return;}
   const client=net.connect(address);let settled=false;
   const done=()=>{if(settled)return;settled=true;client.destroy();resolve(null);};
   client.setTimeout(1000,done);client.on('error',done);client.on('end',done);
   client.once('connect',()=>client.end('activate'));
  });
  lock.listen(address,()=>resolve(lock));
 });
}
module.exports={claim,endpoint};

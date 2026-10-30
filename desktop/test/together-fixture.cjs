const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawn}=require('node:child_process');
const {createRelay}=require('../src/listen/relay');
function wave(seconds=12){const rate=22050,body=Buffer.alloc(44+rate*seconds*2);body.write('RIFF');body.writeUInt32LE(body.length-8,4);body.write('WAVEfmt ',8);body.writeUInt32LE(16,16);body.writeUInt16LE(1,20);body.writeUInt16LE(1,22);body.writeUInt32LE(rate,24);body.writeUInt32LE(rate*2,28);body.writeUInt16LE(2,32);body.writeUInt16LE(16,34);body.write('data',36);body.writeUInt32LE(body.length-44,40);for(let i=44;i<body.length;i+=2)body.writeInt16LE(Math.round(5000*Math.sin((i-44)/2/rate*Math.PI*880)),i);return body;}
async function reserve(){const server=http.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pain-together-test-'));let relay;const relayServer=http.createServer((req,res)=>relay.route(req,res));relay=createRelay(relayServer);await new Promise(r=>relayServer.listen(0,'127.0.0.1',r));
 const relayURL='http://127.0.0.1:'+relayServer.address().port,children=[],bases=[],body=wave();
 try{
  for(const [index,name]of ['host','guest'].entries()){
   const dir=path.join(root,name);await fs.mkdir(path.join(dir,'data'),{recursive:true});await fs.mkdir(path.join(dir,'cache'));
   const tracks=[0,1,2].map(i=>({id:name+i,title:`${name} song ${i}`,artist:'Test artist',album:'Test',duration:12000,bytes:body.length,mime:'audio/wav'}));
   await fs.writeFile(path.join(dir,'data/library.json'),JSON.stringify({tracks}));await fs.writeFile(path.join(dir,'data/stats.json'),JSON.stringify({plays:[],slices:[]}));
   for(const track of tracks)await fs.writeFile(path.join(dir,'cache',track.id+'.mp3'),body);
   const port=await reserve(),base='http://127.0.0.1:'+port;bases.push(base);
   const child=spawn(process.execPath,[path.resolve(__dirname,'../src/server.js')],{env:{...process.env,PORT:String(port),PAIN_DATA_DIR:dir,PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',OPEN_BROWSER:'false'},stdio:['ignore','pipe','pipe']});children.push(child);
   await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error(output||'Server startup timeout')),15000);for(const pipe of [child.stdout,child.stderr])pipe.on('data',b=>{output+=b;if(output.includes('Web UI:')){clearTimeout(timeout);resolve();}});child.once('error',reject);});
  }
  const call=async(index,action,fields={})=>{const r=await fetch(bases[index]+'/api/listen/control',{method:'POST',headers:{'Content-Type':'application/json','X-Pain-Update':'listen'},body:JSON.stringify({action,...fields})});const body=await r.json();if(!r.ok)throw Error(body.error);return body;};
  const status=index=>fetch(bases[index]+'/api/listen/status').then(r=>r.json());
  const wait=async(index,predicate)=>{const until=Date.now()+10000;while(Date.now()<until){const s=await status(index);if(predicate(s))return s;await new Promise(r=>setTimeout(r,30));}throw Error('Room state timeout: '+JSON.stringify(await status(index)));};
  for(let i=0;i<2;i++)await call(i,'settings',{server:relayURL,name:i?'Guest':'Host'});
  return {root,bases,relayURL,call,status,wait,body,relay,async close(){relay.close();await new Promise(r=>relayServer.close(r));for(const child of children){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,1500))]);if(child.exitCode===null)child.kill('SIGKILL');}await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};
 }catch(error){relay.close();relayServer.close();for(const child of children)child.kill();await fs.rm(root,{recursive:true,force:true});throw error;}
}
module.exports={fixture,wave};

const {Worker}=require('node:worker_threads'),{EventEmitter}=require('node:events');
const path=require('node:path'),fs=require('node:fs');
module.exports=function createBackend(){
 const dir=path.join(process.env.PAIN_DATA_DIR||path.join(__dirname,'..'),'data');
 fs.mkdirSync(dir,{recursive:true});
 const preferences=require('./desktop-preferences')(dir);
 const updater=require('./native-updater')({dataDir:dir,appRoot:path.join(__dirname,'..'),currentVersion:require('../package.json').version});
 const server=new EventEmitter();let port,closed=false,stopping,restart;
 const worker=new Worker(path.join(__dirname,'server-worker.js'),{workerData:{preferences:preferences.state()}});
 server.address=()=>({port});server.listening=false;
 server.desktopPreferences={attachShell(callback){preferences.attachShell(callback);worker.postMessage({preferences:preferences.state()});}};
 worker.on('message',async message=>{
  if(message.event){if(message.event==='listening'){port=message.port;server.listening=true;}server.emit(message.event);return;}
  try{
   let result;
   if(message.method==='preferences')result=await preferences.update(...message.args);
   else if(message.method==='check')result=await updater.check(...message.args);
   else if(message.method==='install'){const installation=await updater.prepareInstall();result=installation.state;restart=installation.restart;}
   else if(message.method==='restart')restart?.();
   else throw new Error('Unknown native operation');
   if(!closed)worker.postMessage({id:message.id,result});
  }catch(error){if(!closed)worker.postMessage({id:message.id,error:error.message});}
 });
 worker.on('error',error=>{console.error('[Backend]',error);server.emit('backend-error',error);});
 worker.on('exit',code=>{closed=true;server.listening=false;if(!stopping)server.emit('backend-error',new Error('Backend stopped: '+code));});
 server.shutdown=()=>{
  if(closed)return Promise.resolve();
  if(stopping)return stopping;
  stopping=new Promise(resolve=>{
   const timer=setTimeout(()=>worker.terminate(),5000);
   worker.once('exit',()=>{clearTimeout(timer);resolve();});worker.postMessage({method:'shutdown'});
  });return stopping;
 };
 server.pulseflow={close:()=>server.shutdown()};
 return server;
};

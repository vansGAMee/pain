// All library, sync, backup and HTTP work runs outside Electron's window thread.
const {parentPort,workerData}=require('node:worker_threads');
let sequence=0, preferences=workerData.preferences;
const pending=new Map();
function call(method,args=[]){return new Promise((resolve,reject)=>{
 const id=++sequence;pending.set(id,{resolve,reject});parentPort.postMessage({id,method,args});
});}
globalThis.painShell={
 preferences:{state:()=>preferences,start(){},update:async body=>preferences=await call('preferences',[body])},
 updater:{check:force=>call('check',[force]),prepareInstall:async()=>{
  const state=await call('install');return {state,restart:()=>call('restart').catch(()=>{})};
 }}
};
const server=require('./server');
server.once('listening',()=>parentPort.postMessage({event:'listening',port:server.address().port}));
server.on('activate-window',()=>parentPort.postMessage({event:'activate-window'}));
parentPort.on('message',message=>{
 if(message.preferences){preferences=message.preferences;return;}
 if(message.method==='shutdown'){
  server.discordPresence?.close();
  server.pulseflow.close();server.personalRecommender?.close();server.close();server.closeAllConnections();process.exit(0);
 }
 const job=pending.get(message.id);if(!job)return;pending.delete(message.id);
 if(message.error)job.reject(new Error(message.error));else job.resolve(message.result);
});

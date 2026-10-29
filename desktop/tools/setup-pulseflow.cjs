// The CLI and the in-app button use the same isolated, verified installer.
const path=require('node:path');
const installer=require('../src/runtime-installer')(path.join(__dirname,'../data'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>installer.cancel());
const state=installer.start();
if(!state.running)console.log('Local analysis is installed. Open Settings to analyze the library.');
else{
 let previous='';const timer=setInterval(()=>{const status=installer.status();if(status.phase!==previous){previous=status.phase;console.log('Installing local analysis: '+status.phase);}},1000);
 installer.done().then(()=>{clearInterval(timer);const status=installer.status();
  if(status.state!=='ready'){console.error(status.error||'Installation interrupted');process.exitCode=1;}
  else console.log('Local analysis is ready. Open Settings to analyze the library.');
  installer.close();
 });
}

// A Wayland bar can register its tray host after PAIN's autostart. Electron
// otherwise keeps a valid Tray object whose GTK fallback is invisible there.
module.exports=function watchTrayHost({onReady,onMissing,spawn=require('node:child_process').spawn,execFile=require('node:child_process').execFile}={}){
 let stopped=false,monitor,buffer='',values=[],owner;
 function update(value){
  if(stopped||value===owner)return;owner=value;
  if(value)onReady?.();else onMissing?.();
 }
 try{
  monitor=spawn('dbus-monitor',['--session',"type='signal',interface='org.freedesktop.DBus',member='NameOwnerChanged',arg0='org.kde.StatusNotifierWatcher'"],{stdio:['ignore','pipe','ignore']});
  monitor.on('error',()=>{});
  monitor.stdout.on('data',chunk=>{
   buffer+=chunk.toString();let newline;
   while((newline=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
    if(/member=NameOwnerChanged/.test(line))values=[];
    const value=line.match(/^\s*string "([^"]*)"/);if(!value)continue;
    values.push(value[1]);if(values.length===3&&values[0]==='org.kde.StatusNotifierWatcher')update(values[2]);
   }
  });
 }catch(_){}
 execFile('gdbus',['call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.GetNameOwner','org.kde.StatusNotifierWatcher'],{timeout:3000},(error,stdout)=>{
  if(owner!==undefined)return;update(error?'':String(stdout).match(/'([^']+)'/)?.[1]||'');
 });
 return ()=>{stopped=true;monitor?.kill();};
};

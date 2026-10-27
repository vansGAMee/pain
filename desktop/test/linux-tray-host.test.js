const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const watch=require('../src/linux-tray-host');
function setup(){
 const child=new EventEmitter();child.stdout=new EventEmitter();child.kill=()=>{child.killed=true;};let probe;const events=[];
 const stop=watch({spawn:()=>child,execFile:(cmd,args,options,cb)=>{probe=cb;},onReady:()=>events.push('ready'),onMissing:()=>events.push('missing')});
 const signal=(old,next)=>child.stdout.emit('data',`signal interface=org.freedesktop.DBus; member=NameOwnerChanged\n string "org.kde.StatusNotifierWatcher"\n string "${old}"\n string "${next}"\n`);
 return {child,events,stop,signal,probe:(...args)=>probe(...args)};
}
test('late tray host and a restarted bar recreate the icon without a polling loop',()=>{
 const h=setup();h.probe(Error('no host'),'');assert.deepEqual(h.events,['missing']);
 h.signal('',':1.2');h.signal(':1.2',':1.2');h.signal(':1.2','');h.signal('',':1.3');
 assert.deepEqual(h.events,['missing','ready','missing','ready']);h.stop();assert.ok(h.child.killed);
 h.signal(':1.3','');assert.equal(h.events.length,4);
});
test('a host discovered by a signal wins over an older startup probe result',()=>{
 const h=setup();h.signal('',':1.2');h.probe(Error('old no host result'),'');assert.deepEqual(h.events,['ready']);h.stop();
});

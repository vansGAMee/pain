const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {claim}=require('../src/instance-lock');
const source=fs.readFileSync(require.resolve('../src/server'),'utf8');
const startup=source.slice(source.indexOf('let currentPort ='));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('every desktop browser script parses before shipping',()=>{
 const dir=path.resolve(__dirname,'../src');
 for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.js'))){
  assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(dir,name),'utf8'),{filename:name}),name);
 }
});
async function launch({occupied=3,duplicate=false}={}){
 const server=new EventEmitter(),opened=[],exits=[];let attempts=0,discovery=0,activate;
 server.address=()=>({port:3000+attempts-1});
 server.listen=(port,host,callback)=>{
  if(callback)server.once('listening',callback); // Match Node's retained callback on failure.
  attempts++;
  queueMicrotask(()=>{if(attempts<=occupied)server.emit('error',{code:'EADDRINUSE'});else{server.listening=true;server.emit('listening');}});
 };
 vm.runInNewContext(startup,{server,PORT:3000,process:{env:{PAIN_PULSEFLOW_AUTO_INDEX:'false'},platform:'win32',exit:code=>exits.push(code)},
  require:name=>name==='./windows-identity'?{apply(){}}:{claim:async options=>{activate=options.activate;return duplicate?null:{};}},
  console:{log(){},warn(){},error(){}},Date,parseInt,desktopPreferences:{start(){}},pulseflow:{close(){}},
  exec:(...args)=>opened.push(args),startDiscovery:()=>discovery++,setTimeout:()=>({unref(){}}),updater:{},module:{}});
 await tick();return {server,opened,exits,attempts,discovery,activate};
}
test('occupied ports launch exactly one window at the actual port, not one per retry',async()=>{
 const result=await launch();assert.equal(result.attempts,4);assert.equal(result.opened.length,1);
 assert.match(result.opened[0][0],/localhost:3003/);assert.equal(result.opened[0][1].windowsHide,true);
 assert.equal(result.discovery,1);assert.deepEqual(result.exits,[]);
 for(let i=0;i<20;i++)result.activate();
 assert.equal(result.opened.length,1,'rapid repeat launches cannot multiply windows');
});
test('a duplicate process exits before starting HTTP, discovery or a window',async()=>{
 const result=await launch({duplicate:true});assert.equal(result.attempts,0);assert.equal(result.discovery,0);
 assert.equal(result.opened.length,0);assert.deepEqual(result.exits,[0]);
});
test('port fallback is bounded and opens no window when all candidates are occupied',async()=>{
 const result=await launch({occupied:100});assert.equal(result.attempts,21);
 assert.deepEqual(result.exits,[1]);assert.equal(result.opened.length,0);assert.equal(result.discovery,0);
});
test('instance ownership is exclusive, activates the owner and can be acquired after it exits',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-lock-'));let activations=0,owner;
 const address={host:'127.0.0.1',port:0,exclusive:true};
 t.after(async()=>{if(owner?.listening)await new Promise(resolve=>owner.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 owner=await claim({address,activate:()=>activations++});assert.ok(owner.listening);
 address.port=owner.address().port;
 const copies=await Promise.all(Array.from({length:8},()=>claim({address})));
 assert.ok(copies.every(value=>value===null));assert.equal(activations,8);
 await new Promise(resolve=>owner.close(resolve));owner=await claim({address});assert.ok(owner.listening);
});

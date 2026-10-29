const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),{spawn}=require('node:child_process'),{once}=require('node:events');
test('analysis processes yield CPU priority without changing the player process',async()=>{
 const previous=os.getPriority(process.pid);const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{windowsHide:true,stdio:'ignore'});
 require('../src/background-priority')(child);
 try{await once(child,'spawn');assert.ok(os.getPriority(child.pid)>=os.constants.priority.PRIORITY_BELOW_NORMAL);assert.equal(os.getPriority(process.pid),previous);}
 finally{const exited=once(child,'exit');child.kill();await exited;}
});

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const serviceFactory=require('../src/pulseflow-service');
test('missing runtime never spawns a nonexistent Python or exposes its Windows path in status',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-runtime-missing-')),previous=process.env.PAIN_PULSEFLOW_PYTHON;
 process.env.PAIN_PULSEFLOW_PYTHON=path.join(root,'absent/Scripts/python.exe');let launches=0;
 const service=serviceFactory({dataDir:root,getTracks:()=>[],resolveAudio:()=>null,spawnImpl:()=>{launches++;throw Error('must never spawn');}});
 t.after(()=>{service.close();if(previous===undefined)delete process.env.PAIN_PULSEFLOW_PYTHON;else process.env.PAIN_PULSEFLOW_PYTHON=previous;fs.rmSync(root,{recursive:true,force:true});});
 await assert.rejects(service.recommend({eligible:[]}),/not installed/);assert.equal(launches,0);
 const status=await service.status();assert.equal(status.installed,false);assert.equal(status.state,'not-installed');assert.equal(status.lastError,null);
});
test('status includes every library track and reports missing audio instead of fake completion',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-pulseflow-coverage-'));fs.mkdirSync(path.join(root,'pulseflow'));
 fs.writeFileSync(path.join(root,'pulseflow/status.json'),JSON.stringify({state:'ready',total:1,indexed:1,indexedIds:['a']}));
 const service=serviceFactory({dataDir:root,getTracks:()=>[{id:'a',title:'Available'},{id:'z',title:'Last song'}],resolveAudio:id=>id==='a'?'/music/a':null});
 t.after(()=>{service.close();fs.rmSync(root,{recursive:true,force:true});});
 const status=await service.status();assert.equal(status.total,2);assert.equal(status.indexed,1);assert.equal(status.unavailable[0].id,'z');
});
test('simultaneous indexing requests cannot start duplicate model loaders',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-pulseflow-service-'));
 const previous=process.env.PAIN_PULSEFLOW_PYTHON;process.env.PAIN_PULSEFLOW_PYTHON=process.execPath;
 let launches=0;
 const service=serviceFactory({dataDir:root,getTracks:()=>[],resolveAudio:()=>null,spawnImpl:(...args)=>{launches++;return require('node:child_process').spawn(...args);}});
 t.after(async()=>{
  service.close();
  if(previous===undefined)delete process.env.PAIN_PULSEFLOW_PYTHON;else process.env.PAIN_PULSEFLOW_PYTHON=previous;
  await new Promise(resolve=>setTimeout(resolve,100));fs.rmSync(root,{recursive:true,force:true});
 });
 await Promise.all([service.start(),service.start(),service.start()]);assert.equal(launches,1);
 service.close();await assert.rejects(service.start(),/stopped/);
});
test('maximum savings cancels automatic indexing but leaves manual indexing available',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-pulseflow-saving-'));
 const previous=process.env.PAIN_PULSEFLOW_PYTHON;process.env.PAIN_PULSEFLOW_PYTHON=process.execPath;
 let launches=0;const service=serviceFactory({dataDir:root,getTracks:()=>[],resolveAudio:()=>null,spawnImpl:(...args)=>{launches++;return require('node:child_process').spawn(...args);}});
 t.after(async()=>{service.close();if(previous===undefined)delete process.env.PAIN_PULSEFLOW_PYTHON;else process.env.PAIN_PULSEFLOW_PYTHON=previous;await new Promise(r=>setTimeout(r,100));fs.rmSync(root,{recursive:true,force:true});});
 const pending=service.start({automatic:true});service.setBackgroundAllowed(false);
 await assert.rejects(pending,/cancelled/);
 const before=launches;await service.start({automatic:true});assert.equal(launches,before);
 await service.start();assert.equal(launches,before+1);
});

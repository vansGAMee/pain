const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const serviceFactory=require('../src/pulseflow-service');
test('simultaneous indexing requests cannot start duplicate model loaders',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-pulseflow-service-'));
 const previous=process.env.PAIN_PULSEFLOW_PYTHON;process.env.PAIN_PULSEFLOW_PYTHON=process.execPath;
 let scans=0;
 const service=serviceFactory({dataDir:root,getTracks:()=>{scans++;return [];},resolveAudio:()=>null});
 t.after(async()=>{
  service.close();
  if(previous===undefined)delete process.env.PAIN_PULSEFLOW_PYTHON;else process.env.PAIN_PULSEFLOW_PYTHON=previous;
  await new Promise(resolve=>setTimeout(resolve,100));fs.rmSync(root,{recursive:true,force:true});
 });
 await Promise.all([service.start(),service.start(),service.start()]);assert.equal(scans,1);
 service.close();await assert.rejects(service.start(),/stopped/);
});

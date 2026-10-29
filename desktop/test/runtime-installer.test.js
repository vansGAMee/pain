const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),createLayout=require('../src/music-runtime'),createInstaller=require('../src/runtime-installer');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('native packages install Python and tools in the user profile without writing program resources',t=>{
 const root=fixture(t),sourceDir=path.join(root,'program/resources/app.asar/src'),data=path.join(root,'profile/data'),layout=createLayout(data,{sourceDir,packaged:true});
 assert.equal(layout.root,path.dirname(data));assert.equal(layout.sources,sourceDir.replace('app.asar','app.asar.unpacked'));
 assert.ok(layout.python.startsWith(path.dirname(data)+path.sep));assert.equal(layout.installed(),false);assert.equal(fs.existsSync(path.join(root,'program')),false);
});
test('partially installed Python stays unavailable after failure or cancellation',t=>{
 const root=fixture(t),layout=createLayout(path.join(root,'data'),{root});fs.mkdirSync(path.dirname(layout.python),{recursive:true});fs.writeFileSync(layout.python,'partial');fs.mkdirSync(layout.home,{recursive:true});
 for(const state of ['installing','error','cancelled']){fs.writeFileSync(layout.stateFile,JSON.stringify({managed:true,state}));assert.equal(layout.installed(),false);}
 fs.writeFileSync(layout.stateFile,JSON.stringify({managed:true,state:'ready'}));assert.equal(layout.installed(),true);
});
test('bootstrap verifies SHA-256 before publishing a file and rejects untrusted download hosts',async t=>{
 const root=fixture(t),file=path.join(root,'download'),body=Buffer.from('verified artifact'),digest=crypto.createHash('sha256').update(body).digest('hex'),transport=async()=>Readable.from([body]);
 await assert.rejects(createInstaller.download('https://github.com/artifact',file,'0'.repeat(64),undefined,{transport}),/checksum/);
 assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(file+'.part'),false);
 await createInstaller.download('https://github.com/artifact',file,digest,undefined,{transport});assert.deepEqual(fs.readFileSync(file),body);
 await createInstaller.download('https://github.com/artifact',file,digest,undefined,{transport:()=>{throw Error('cache must be reused');}});
 await assert.rejects(createInstaller.download('http://localhost/unsafe',path.join(root,'unsafe'),digest),/Untrusted/);
});
test('concurrent requests share one install, failures are retryable and listening records stay unchanged',async t=>{
 const root=fixture(t),layout=createLayout(path.join(root,'data'),{root});fs.mkdirSync(path.join(root,'data'));const stats=path.join(root,'data/stats.json');fs.writeFileSync(stats,'personal history');let downloads=0,fail;
 const installer=createInstaller(path.join(root,'data'),{layout,download:()=>{downloads++;return new Promise((_,reject)=>{fail=reject;});}});t.after(()=>installer.close());
 installer.start();installer.start();while(!fail)await new Promise(resolve=>setImmediate(resolve));assert.equal(downloads,1);
 fail(Error('offline'));await installer.done();assert.equal(installer.status().state,'error');assert.equal(layout.installed(),false);assert.equal(fs.readFileSync(stats,'utf8'),'personal history');
 installer.start();while(downloads<2)await new Promise(resolve=>setImmediate(resolve));fail(Error('offline'));await installer.done();assert.equal(installer.status().running,false);
});
test('cancelling a download clears its job without starting Python',async t=>{
 const root=fixture(t),layout=createLayout(path.join(root,'data'),{root});let begun;
 const installer=createInstaller(path.join(root,'data'),{layout,download:(_u,_f,_h,signal)=>new Promise((_,reject)=>{begun=true;signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});})});
 installer.start();while(!begun)await new Promise(resolve=>setImmediate(resolve));installer.cancel();await installer.done();
 assert.equal(installer.status().state,'cancelled');assert.equal(fs.existsSync(layout.python),false);installer.close();
});
test('installation is local-only, requires the app header and never starts from a status read',async t=>{
 const root=fixture(t),http=require('node:http');let downloads=0;
 const layout=createLayout(path.join(root,'data'),{root}),installer=createInstaller(path.join(root,'data'),{layout,download:async()=>{downloads++;throw Error('offline');}});
 const server=http.createServer((req,res)=>installer.route(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{installer.close();await installer.done();await new Promise(resolve=>server.close(resolve));});
 const url='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(url)).status,200);assert.equal(downloads,0);
 assert.equal((await fetch(url,{method:'POST',body:'{"action":"install"}'})).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://example.com','X-Pain-Update':'runtime'},body:'{"action":"install"}'})).status,403);assert.equal(downloads,0);
 assert.equal((await fetch(url,{method:'POST',headers:{'X-Pain-Update':'runtime'},body:'{"action":"install"}'})).status,200);
 await installer.done();assert.equal(downloads,1);
});

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Updater,isNewer,assetName,parseChecksum}=require('../src/updater');
// Isolate the parent too: the host temp directory may itself contain .git.
function installedFixture(t,prefix){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),root=path.join(parent,'app');
 fs.mkdirSync(root);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));return root;
}

test('update versions, platform assets and checksums are strict',()=>{
 assert.equal(isNewer('v1.4.8','1.4.7'),true);assert.equal(isNewer('2.0.0','1.99.99'),true);
 for(const bad of ['1.4.7','latest','1.4','1.4.8.1','01.4.9','1.4.-1','999999999999999999999.0.0',''])assert.equal(isNewer(bad,'1.4.8'),false,bad);
 assert.equal(assetName('1.4.8','win32'),'Pain-v1.4.8.exe');
 assert.equal(assetName('1.4.8','linux'),'Pain-v1.4.8-Linux.tar.gz');assert.equal(assetName('1.4.8','darwin'),null);
 const hash='a'.repeat(64);assert.equal(parseChecksum(`${hash}  Pain-v1.4.8.exe\n`,'Pain-v1.4.8.exe'),hash);
 assert.equal(parseChecksum(`${hash}  other.exe\n`,'Pain-v1.4.8.exe'),null);
});

test('release check selects exact assets and does not offer source checkout replacement',async t=>{
 const root=installedFixture(t,'pain-updater-check-');
 const release={tag_name:'v1.5.0',body:'## Исправления\n- Перемотка без задержки',html_url:'https://github.com/vansGAMee/pain/releases/tag/v1.5.0',assets:[
  {name:'Pain-v1.5.0-Linux.tar.gz',browser_download_url:'https://github.com/linux'},
  {name:'SHA256SUMS-v1.5.0.txt',browser_download_url:'https://github.com/sums'}]};
 const updater=new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async()=>Buffer.from(JSON.stringify(release))});
 let state=await updater.check(true);assert.equal(state.available,true);assert.equal(state.canInstall,true);
 assert.equal(state.notes,'Исправления\nПеремотка без задержки');
 fs.mkdirSync(path.join(root,'.git'));state=await new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async()=>Buffer.from(JSON.stringify(release))}).check(true);
 assert.equal(state.available,true);assert.equal(state.canInstall,false);
});

test('download must match release checksum before an installer is prepared',async t=>{
 const root=installedFixture(t,'pain-updater-download-');
 const bytes=Buffer.from('safe release archive'),filename='Pain-v1.5.0-Linux.tar.gz';
 const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const release={tag_name:'v1.5.0',html_url:'https://github.com/release',assets:[
  {name:filename,browser_download_url:'https://github.com/archive'},
  {name:'SHA256SUMS-v1.5.0.txt',browser_download_url:'https://github.com/sums'}]};
 const fetch=async(url,options={})=>{
  if(url.includes('/releases/latest'))return Buffer.from(JSON.stringify(release));
  if(url.endsWith('/sums'))return Buffer.from(`${digest}  ${filename}\n`);
  fs.writeFileSync(options.streamTo,bytes,{flag:'wx'});return {path:options.streamTo,size:bytes.length,sha256:digest};
 };
 const updater=new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch,executable:'/usr/bin/node',tmpDir:root});
 const prepared=await updater.prepareInstall();assert.equal(prepared.state.status,'downloaded');assert.equal(typeof prepared.restart,'function');
 const scripts=fs.readdirSync(root).filter(name=>name.startsWith('pain-update-')).map(name=>path.join(root,name,'install.sh')).filter(fs.existsSync);
 assert.ok(scripts.length);assert.match(fs.readFileSync(scripts.at(-1),'utf8'),/tar -xzf/);
 assert.equal(await updater.prepareInstall(),prepared,'repeated requests must share the same installer');
 assert.equal((await updater.check(true)).status,'downloaded','background checks cannot replace an ongoing installation');
 const bad=new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async(url,options={})=>{
  if(url.includes('/releases/latest'))return Buffer.from(JSON.stringify(release));
  if(url.endsWith('/sums'))return Buffer.from(`${'0'.repeat(64)}  ${filename}\n`);
  fs.writeFileSync(options.streamTo,bytes,{flag:'wx'});return {path:options.streamTo,size:bytes.length,sha256:digest};
 },tmpDir:root});
 await assert.rejects(()=>bad.prepareInstall(),/checksum/);assert.equal(bad.publicState().status,'error');
});

test('failed or prerelease checks clear a previously installable release',async t=>{
 const root=installedFixture(t,'pain-update-stale-');
 const release={tag_name:'v1.5.1',assets:[{name:'Pain-v1.5.1-Linux.tar.gz'},{name:'SHA256SUMS-v1.5.1.txt'}]};
 let offline=false;
 const updater=new Updater({currentVersion:'1.5.0',platform:'linux',appRoot:root,dataDir:root,
  fetch:async()=>{if(offline)throw new Error('Offline');return Buffer.from(JSON.stringify(release));}});
 assert.equal((await updater.check(true)).canInstall,true);
 offline=true;await assert.rejects(()=>updater.prepareInstall(),/Offline/);
 assert.equal(updater.publicState().canInstall,false);assert.equal(updater.publicState().available,false);
 assert.equal(updater.release,null);assert.equal(fs.readdirSync(root).length,0);
 offline=false;release.prerelease=true;
 assert.equal((await updater.check(true)).canInstall,false);
});

test('installer startup failure keeps the running app alive; a successful restart launches only once',async t=>{
 const {EventEmitter}=require('node:events'),root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-update-spawn-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let exits=0,spawns=0,fail=true;
 const updater=new Updater({currentVersion:'1.5.0',appRoot:root,dataDir:root,exit:()=>exits++,
  spawn:(command,args,options)=>{assert.equal(options.windowsHide,true);spawns++;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit(fail?'error':'spawn',new Error('No installer')));return child;}});
 let restart=updater.launchInstaller('missing',[]);restart();restart();
 await new Promise(r=>setTimeout(r,300));
 assert.equal(exits,0);assert.equal(spawns,1);assert.equal(updater.publicState().status,'error');
 fail=false;restart=updater.launchInstaller('installer',[]);restart();restart();
 await new Promise(r=>setTimeout(r,300));assert.equal(exits,1);assert.equal(spawns,2);
});

test('Windows selects the exact executable, verifies its checksum and quotes installation paths',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pain Ива́н's update-"));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.from('MZ-test-executable'),digest=crypto.createHash('sha256').update(bytes).digest('hex'),filename='Pain-v1.5.1.exe';
 const release={tag_name:'v1.5.1',assets:[{name:filename,browser_download_url:'https://github.com/exe'},{name:'SHA256SUMS-v1.5.1.txt',browser_download_url:'https://github.com/sums'}]};
 const updater=new Updater({currentVersion:'1.5.0',platform:'win32',packaged:true,executable:path.join(root,'Pain.exe'),appRoot:root,dataDir:root,tmpDir:root,
  fetch:async(url,options={})=>{
   if(url.includes('/releases/latest'))return Buffer.from(JSON.stringify(release));
   if(url.endsWith('/sums'))return Buffer.from(`${digest}  ${filename}\n`);
   fs.writeFileSync(options.streamTo,bytes);return {sha256:digest};
  }});
 assert.equal((await updater.prepareInstall()).state.status,'downloaded');
 const script=fs.readFileSync(path.join(root,fs.readdirSync(root).find(n=>n.startsWith('pain-update-')),'install.ps1'),'utf8');
 assert.equal(script.charCodeAt(0),0xfeff);assert.match(script,/Ива́н''s update/);assert.match(script,/Move-Item -LiteralPath/);assert.match(script,/Start-Process -FilePath/);
});

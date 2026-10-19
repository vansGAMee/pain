const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Updater,isNewer,assetName,parseChecksum}=require('../src/updater');

test('update versions, platform assets and checksums are strict',()=>{
 assert.equal(isNewer('v1.4.8','1.4.7'),true);assert.equal(isNewer('2.0.0','1.99.99'),true);
 for(const bad of ['1.4.7','latest','1.4','1.4.8.1','01.4.9','1.4.-1','999999999999999999999.0.0',''])assert.equal(isNewer(bad,'1.4.8'),false,bad);
 assert.equal(assetName('1.4.8','win32'),'Pain-v1.4.8.exe');
 assert.equal(assetName('1.4.8','linux'),'Pain-v1.4.8-Linux.tar.gz');assert.equal(assetName('1.4.8','darwin'),null);
 const hash='a'.repeat(64);assert.equal(parseChecksum(`${hash}  Pain-v1.4.8.exe\n`,'Pain-v1.4.8.exe'),hash);
 assert.equal(parseChecksum(`${hash}  other.exe\n`,'Pain-v1.4.8.exe'),null);
});

test('release check selects exact assets and does not offer source checkout replacement',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-updater-check-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const release={tag_name:'v1.5.0',html_url:'https://github.com/vansGAMee/pain/releases/tag/v1.5.0',assets:[
  {name:'Pain-v1.5.0-Linux.tar.gz',browser_download_url:'https://github.com/linux'},
  {name:'SHA256SUMS-v1.5.0.txt',browser_download_url:'https://github.com/sums'}]};
 const updater=new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async()=>Buffer.from(JSON.stringify(release))});
 let state=await updater.check(true);assert.equal(state.available,true);assert.equal(state.canInstall,true);
 fs.mkdirSync(path.join(root,'.git'));state=await new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async()=>Buffer.from(JSON.stringify(release))}).check(true);
 assert.equal(state.available,true);assert.equal(state.canInstall,false);
});

test('download must match release checksum before an installer is prepared',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-updater-download-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
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
 const bad=new Updater({currentVersion:'1.4.8',platform:'linux',appRoot:root,dataDir:root,fetch:async(url,options={})=>{
  if(url.includes('/releases/latest'))return Buffer.from(JSON.stringify(release));
  if(url.endsWith('/sums'))return Buffer.from(`${'0'.repeat(64)}  ${filename}\n`);
  fs.writeFileSync(options.streamTo,bytes,{flag:'wx'});return {path:options.streamTo,size:bytes.length,sha256:digest};
 },tmpDir:root});
 await assert.rejects(()=>bad.prepareInstall(),/checksum/);assert.equal(bad.publicState().status,'error');
});

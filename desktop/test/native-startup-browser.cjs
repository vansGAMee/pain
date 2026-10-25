// Exercise the real Electron shell and HTTP server using an isolated copy of the library.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-native-startup-'));
 const source=process.env.PAIN_EVAL_DATA_DIR||path.resolve(__dirname,'../data');
 const library=JSON.parse(fs.readFileSync(path.join(source,'library.json')));
 const stats=JSON.parse(fs.readFileSync(path.join(source,'stats.json')));
 fs.mkdirSync(path.join(root,'data'));
 if(process.env.PAIN_EVAL_PROFILE_DIR)fs.cpSync(process.env.PAIN_EVAL_PROFILE_DIR,path.join(root,'profile'),{recursive:true});
 for(const name of fs.readdirSync(source))if(name.endsWith('.json'))fs.copyFileSync(path.join(source,name),path.join(root,'data',name));
 let app;
 try{
  const env={...process.env,PAIN_DATA_DIR:root,PAIN_USER_DATA_DIR:path.join(root,'profile'),PAIN_DISCOVERY:'false',PORT:'3197'};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env});
  const page=await app.firstWindow(),errors=[],crashes=[];
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));page.on('crash',()=>crashes.push('renderer crash'));
  await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length);
  const counts=await page.evaluate(async()=>({tracks:(await(await fetch('/api/saved-library')).json()).tracks.length,plays:(await(await fetch('/api/saved-stats')).json()).plays.length}));
  assert.deepEqual(counts,{tracks:library.tracks.length,plays:stats.plays.length});
  await page.locator('#sidebarSettingsBtn').click();
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  await page.locator('#trackUploadFileInput').setInputFiles({name:'Recovery test.wav',mimeType:'audio/wav',buffer:wav});
  await page.locator('#trackUploadSubmitBtn').click();
  await page.waitForFunction(()=>document.querySelector('#trackUploadProgressFill').style.width==='100%');
  const saved=await page.evaluate(async()=>(await(await fetch('/api/saved-library')).json()).tracks);
  assert.equal(saved.length,library.tracks.length+1);
  assert.equal(saved.find(t=>t.title==='Recovery test').duration,1000);
  await page.locator('#settingsCloseBtn').click();
  await page.locator('[data-view="library"]').first().click();
  await page.waitForSelector(`tr[data-track-id="${saved.at(-1).id}"]`);
  await page.reload();
  await page.waitForFunction(n=>window.painQueue?.tracks.length===n,library.tracks.length+1);
  assert.deepEqual(errors,[]);assert.deepEqual(crashes,[]);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  console.log(JSON.stringify({nativeStartup:'passed',...counts,uploadAndReload:'passed',errors,crashes}));
 }finally{if(app)await app.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

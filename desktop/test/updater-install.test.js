const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');

test('Linux update extracts, replaces code, restarts and preserves library/cache files', {skip:process.platform!=='linux'}, async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pain install's "));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const app=path.join(root,'installed'),payload=path.join(root,'payload'),bundle=path.join(payload,'Pain');
 for(const name of ['src','assets','data','cache','downloads'])fs.mkdirSync(path.join(app,name),{recursive:true});
 for(const name of ['src','assets','data'])fs.mkdirSync(path.join(bundle,name),{recursive:true});
 fs.writeFileSync(path.join(app,'package.json'),'{"version":"1.5.0"}');
 for(const name of ['data/library.json','data/stats.json','cache/song.mp3','downloads/song.mp3'])fs.writeFileSync(path.join(app,name),'user-data-'+name);
 fs.writeFileSync(path.join(bundle,'package.json'),'{"version":"1.5.1"}');
 fs.writeFileSync(path.join(bundle,'src/server.js'),'// new server');
 fs.writeFileSync(path.join(bundle,'src/dj-panel.js'),'// saved vibes');
 fs.writeFileSync(path.join(bundle,'assets/new.txt'),'new asset');
 fs.writeFileSync(path.join(bundle,'data/library.json'),'must not replace user data');
 let archive=process.env.PAIN_RELEASE_ARCHIVE;
 if(!archive){archive=path.join(root,'release.tar.gz');execFileSync('tar',['-czf',archive,'-C',payload,'Pain']);}
 const executable=path.join(root,'fake node'),marker=path.join(root,'restarted');
 const quote=s=>"'"+s.replace(/'/g,"'\"'\"'")+"'";
 fs.writeFileSync(executable,`#!/bin/sh\nprintf restarted > ${quote(marker)}\n`,{mode:0o700});
 const options={archive,root,app,executable,updater:process.env.PAIN_UPDATER_BASELINE||require.resolve('../src/updater')};
 const code=`
 const fs=require('fs'),crypto=require('crypto'),o=JSON.parse(process.argv[1]),{Updater}=require(o.updater);
 const bytes=fs.readFileSync(o.archive),sha=crypto.createHash('sha256').update(bytes).digest('hex'),name='Pain-v1.5.1-Linux.tar.gz';
 const release={tag_name:'v1.5.1',assets:[{name,browser_download_url:'https://github.com/archive'},{name:'SHA256SUMS-v1.5.1.txt',browser_download_url:'https://github.com/sums'}]};
 const u=new Updater({currentVersion:'1.5.0',platform:'linux',appRoot:o.app,dataDir:o.app+'/data',tmpDir:o.root,executable:o.executable,
 fetch:async(url,opts={})=>{
  if(url.includes('/releases/latest'))return Buffer.from(JSON.stringify(release));
  if(url.endsWith('/sums'))return Buffer.from(sha+'  '+name+'\\n');
  fs.writeFileSync(opts.streamTo,bytes);return {sha256:sha};
 }});
 u.prepareInstall().then(p=>p.restart()).catch(e=>{console.error(e);process.exit(1)});
 `;
 const child=spawn(process.execPath,['-e',code,JSON.stringify(options)],{stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',data=>stderr+=data);
 const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.equal(exit,0,stderr);
 const deadline=Date.now()+8000;
 while(!fs.existsSync(marker)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.ok(fs.existsSync(marker),'installer did not restart the updated app');
 assert.equal(JSON.parse(fs.readFileSync(path.join(app,'package.json'))).version,'1.5.1');
 assert.ok(fs.existsSync(path.join(app,'src/dj-panel.js')));
 for(const name of ['data/library.json','data/stats.json','cache/song.mp3','downloads/song.mp3'])assert.equal(fs.readFileSync(path.join(app,name),'utf8'),'user-data-'+name);
});

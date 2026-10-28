const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const create=require('../src/audio-download');
test('analysis waits for a whole phone file, coalesces requests and discards failed downloads',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-audio-download-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.alloc(8192,8);let calls=0;
 const server=http.createServer((req,res)=>{calls++;if(req.url.includes('missing')){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Length':bytes.length});res.write(bytes.subarray(0,4096));setTimeout(()=>res.end(bytes.subarray(4096)),30);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const target=path.join(root,'media_123.mp3');
 const ensure=create({cacheDir:root,resolveAudio:()=>fs.existsSync(target)?target:null,phoneBase:()=>`http://127.0.0.1:${server.address().port}`});
 const both=await Promise.all([ensure('media:123'),ensure('media:123')]);assert.equal(calls,1);assert.equal(both[0],target);assert.deepEqual(fs.readFileSync(target),bytes);
 await ensure('media:123');assert.equal(calls,1);fs.unlinkSync(target);
 await assert.rejects(ensure('missing'),/404/);assert.deepEqual(fs.readdirSync(root),[]);
});
test('recovers changed Android IDs using a unique exact recording and preserves the desktop ID',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-audio-id-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.alloc(8192,5),track={id:'media:old',title:'Any song',artist:'Any artist',duration:123456,bytes:bytes.length};
 const requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.url);if(req.url==='/api/library'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tracks:[{...track,id:'media:new'}]}));}else if(req.url.endsWith('media%3Anew')){res.end(bytes);}else{res.writeHead(404);res.end('Track not found: media:old');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const ensure=create({cacheDir:root,resolveAudio:()=>null,phoneBase:()=>`http://127.0.0.1:${server.address().port}`,getTrack:()=>track});
 const file=await ensure(track.id);assert.equal(path.basename(file),'media_old.mp3');assert.deepEqual(fs.readFileSync(file),bytes);
 assert.deepEqual(requests,['/api/track/media%3Aold','/api/library','/api/track/media%3Anew']);assert.equal(ensure.getStatus(track.id),null);
 assert.equal(create.replacement(track,[{...track,id:'a'},{...track,id:'b'}]),null,'ambiguous recordings are never guessed');
 assert.equal(create.replacement(track,[{...track,id:'a',bytes:100}]),null,'a different audio file is never substituted');
});
test('connected phones distinguish absent tracks from unreadable files and keep that diagnosis after restart',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-audio-missing-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>{res.writeHead(404);res.end(req.url.includes('unreadable')?'File unreadable':'Track not found');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const options={cacheDir:root,resolveAudio:()=>null,phoneBase:()=>`http://127.0.0.1:${server.address().port}`,availabilityFile:path.join(root,'issues.json')};
 const ensure=create(options);
 await assert.rejects(ensure('missing'),e=>e.code==='AUDIO_NOT_ON_PHONE');
 await assert.rejects(ensure('unreadable'),e=>e.code==='AUDIO_PHONE_UNREADABLE');
 assert.equal(ensure.getStatus('missing').code,'AUDIO_NOT_ON_PHONE');
 for(let i=0;i<20;i++){try{if(JSON.parse(fs.readFileSync(options.availabilityFile)).unreadable)break;}catch(_){}await new Promise(r=>setTimeout(r,10));}
 assert.equal(create(options).getStatus('unreadable').code,'AUDIO_PHONE_UNREADABLE');
});

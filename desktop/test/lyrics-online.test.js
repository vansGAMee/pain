const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const create=require('../src/lyrics-online'),route=require('../src/lyrics-store');
const track={id:'any-library-track',title:'Песня',artist:'Исполнитель',album:'Download',duration:180000};
const record={id:42,trackName:'Песня',artistName:'Исполнитель',duration:180,plainLyrics:'Первая\nВторая',syncedLyrics:'[00:01.20]Первая\n[00:02.50]Вторая\n[00:04.00]'};
const fixture=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-online-lyrics-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('LRC parses repeated lines, Cyrillic, fractional times, breaks and global offset',()=>{
 assert.deepEqual(create.parseLrc('[offset:+200]\n[00:01.50][01:02.200]Строка\n[01:04.00]'),[{text:'Строка',time:1.3},{text:'Строка',time:62},{text:'',time:63.8}]);
 assert.deepEqual(create.parseLrc('[00:90.00]Invalid'),[]);
});
test('matches exact recording; a different duration receives plain text, never incorrect timing',()=>{
 const meta=create.metadata(track);assert.equal(meta.album,'');
 assert.ok(create.select([record],meta).synced);
 assert.equal(create.select([{...record,artistName:'Someone else'}],meta),null);
 assert.equal(create.select([record],{...meta,title:'Песня - Slowed'}),null);
 const plain=create.select([record],{...meta,duration:200});assert.equal(plain.synced,false);assert.ok(plain.lines.every(l=>l.time===null));
 assert.equal(create.metadata({...track,title:'Песня - Slowed'}).title,'Песня - Slowed');
});
test('coalesces concurrent lookups, persists offline, and does not query an entire library',async t=>{
 const dir=fixture(t);let calls=0;
 const options={getTrack:()=>track,delay:0,fetchImpl:async url=>{calls++;assert.equal(new URL(url).searchParams.get('duration'),'180');return Response.json(record);}};
 const service=create(dir,options),results=await Promise.all([service.get(track.id),service.get(track.id)]);
 assert.equal(calls,1);assert.deepEqual(results[0],results[1]);assert.equal(results[0].lines[0].time,1.2);
 const offline=create(dir,{...options,fetchImpl:()=>{throw Error('offline');}});assert.ok((await offline.get(track.id)).synced);
});
test('search finds synced release when exact album lookup fails; honors Retry-After and negative cache',async t=>{
 const dir=fixture(t);let calls=0;
 const service=create(dir,{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls++;return url.includes('/get?')?new Response('{}',{status:404}):Response.json([{...record,artistName:'Wrong'},record]);}});
 assert.ok((await service.get(track.id)).synced);assert.equal(calls,2);
 const limited=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async()=>{calls++;return new Response('limit',{status:429,headers:{'retry-after':'90'}});}});
 assert.equal((await limited.get(track.id)).state,'error');const before=calls;
 assert.equal((await limited.get(track.id,{refresh:true})).state,'error');assert.equal(calls,before);
 const empty=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async()=>{calls++;return Response.json([]);}});
 assert.equal((await empty.get(track.id)).state,'not-found');const n=calls;await empty.get(track.id);assert.equal(calls,n);
});
test('an overloaded signature endpoint falls back to search without losing timing',async t=>{
 let calls=0;const service=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls++;return url.includes('/get?')?new Response('busy',{status:503,headers:{'retry-after':'0.01'}}):Response.json([record]);}});
 assert.ok((await service.get(track.id)).synced);assert.equal(calls,2);
});
test('manual text wins, disabling is durable, and saved automatic lyrics remain readable',async t=>{
 const dir=fixture(t);let calls=0;const service=create(dir,{getTrack:()=>track,delay:0,fetchImpl:async()=>{calls++;return Response.json(record);}});
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost'),dir,service));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 await fetch(base+'/api/lyrics?track='+track.id);assert.equal(calls,1);
 const response=await fetch(base+'/api/lyrics/settings',{method:'POST',headers:{'X-Pain-Update':'lyrics'},body:JSON.stringify({enabled:false})});assert.equal(response.status,200);
 assert.ok((await(await fetch(base+'/api/lyrics?track='+track.id)).json()).synced);
 assert.equal((await service.get('new-track')).state,'disabled');assert.equal(calls,1);
 const lines=[{text:'Manual',time:3}];await fetch(base+'/api/lyrics?track='+track.id,{method:'PUT',body:JSON.stringify({lines})});
 const manual=await(await fetch(base+'/api/lyrics?track='+track.id+'&refresh=1')).json();assert.deepEqual(manual.lines,lines);assert.ok(manual.manual);assert.equal(calls,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'lyrics-preferences.json'))).enabled,false);
});

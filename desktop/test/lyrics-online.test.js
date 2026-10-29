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
 const slowed=create.select([record],{...meta,title:'Песня - Slowed'});assert.equal(slowed.editionFallback,true);assert.ok(slowed.lines.every(l=>l.time===null));
 assert.equal(create.select([record],{...meta,title:'Песня (Live)'}),null);
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
 const empty=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls++;return url.includes('kugou.com')?backupResponse(url,[]):Response.json([]);}});
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
const candidate={id:'9182',accesskey:'ABC123',song:track.title,singer:track.artist,duration:180500};
function backupResponse(url,items=[candidate]) {
 if(url.includes('mobileservice.kugou.com'))return Response.json({status:1,data:{info:[]}});
 return url.includes('/download?')?Response.json({content:Buffer.from(record.syncedLyrics).toString('base64')}):Response.json({candidates:items});
}
test('unreachable primary switches hosts immediately and saves genuine backup timings offline',async t=>{
 const dir=fixture(t),calls=[];
 const service=create(dir,{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls.push(url);if(url.startsWith('https://lrclib.net/'))throw Error('connection timeout');return backupResponse(url);}});
 const found=await service.get(track.id);assert.equal(found.source.name,'KuGou');assert.equal(found.synced,true);assert.equal(found.lines[0].time,1.2);
 assert.equal(calls.length,3);assert.equal(calls.filter(u=>u.includes('lrclib')).length,1);
 const offline=create(dir,{getTrack:()=>track,fetchImpl:()=>{throw Error('offline');}});assert.deepEqual((await offline.get(track.id)).lines,found.lines);
});
test('primary rate limit does not block an independent fallback',async t=>{
 const calls=[];const service=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls.push(url);return url.includes('lrclib.net')?new Response('busy',{status:429,headers:{'retry-after':'90'}}):backupResponse(url);}});
 assert.equal((await service.get(track.id)).source.name,'KuGou');assert.equal(calls.length,3);
});
test('backup rejects other artists and live editions, and strips timing from a different recording',async t=>{
 for(const change of [{singer:'Another artist'},{song:track.title+' (Live)'},{duration:220000}]) {
  const calls=[];const service=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls.push(url);if(url.includes('lrclib.net'))return new Response('{}',{status:404});return backupResponse(url,[{...candidate,...change}]);}});
  const found=await service.get(track.id);
  if(change.duration){assert.equal(found.synced,false);assert.ok(found.lines.length);assert.ok(found.lines.every(l=>l.time===null));}
  else {assert.equal(found.state,'not-found');assert.ok(calls.every(u=>!u.includes('/download?')));}
 }
});
test('catalogue groups resolve the exact remix/speed edition by hash after an empty keyword lookup',async t=>{
 const song={...track,title:'Example (Hardstyle Remix) (Ultra Slowed)',artist:'Artist One/Artist Two',duration:121000};
 const calls=[];const service=create(fixture(t),{getTrack:()=>song,delay:0,fetchImpl:async url=>{
  calls.push(url);const u=new URL(url);
  if(u.hostname==='lrclib.net')return new Response('{}',{status:404});
  if(u.hostname==='mobileservice.kugou.com'){
   assert.equal(u.searchParams.get('keyword'),'Example Hardstyle Remix - Artist One');
   return Response.json({status:1,data:{info:[{hash:'1'.repeat(32),songname:'Example (Hardstyle Remix)',singername:'Artist One、Artist Two',duration:83,group:[{hash:'2'.repeat(32),songname:'Example (Ultra Slowed|Hardstyle Remix)(Explicit)',singername:'Artist One、Artist Two',duration:121}]}]}});
  }
  if(u.pathname==='/download')return backupResponse(url);
  if(u.searchParams.has('hash')){assert.equal(u.searchParams.get('hash'),'2'.repeat(32));return Response.json({status:200,candidates:[{...candidate,song:'Example',singer:'Artist One、Artist Two',duration:121224}]});}
  return Response.json({status:200,candidates:[]});
 }});
 const found=await service.get(song.id);assert.equal(found.source.name,'KuGou');assert.equal(found.synced,true);assert.equal(found.editionFallback,false);assert.equal(found.lines[0].time,1.2);
 assert.equal(calls.filter(u=>u.includes('/download?')).length,1);
});
test('another speed edition can supply words but never timing, while other remixes remain rejected',()=>{
 const meta=create.metadata({...track,title:'Песня (Hardstyle Remix) (Ultra Slowed)'});
 const found=create.select([{...record,trackName:'Песня (Super Slowed|Hardstyle Remix)',duration:180}],meta);
 assert.equal(found.editionFallback,true);assert.equal(found.synced,false);assert.ok(found.lines.every(l=>l.time===null));
 assert.equal(create.select([{...record,trackName:'Песня (Different Remix)'}],meta),null);
});
test('a source timeout plus an empty backup is an availability error, not a day-long cached miss',async t=>{
 let connected=false,calls=0;const service=create(fixture(t),{getTrack:()=>track,delay:0,fetchImpl:async url=>{calls++;if(url.includes('lrclib.net')){if(!connected)throw Error('TLS timeout');return Response.json(record);}return backupResponse(url,[]);}});
 const first=await service.get(track.id);assert.equal(first.state,'error');assert.deepEqual(first.checks,[{source:'LRCLIB',state:'unavailable'},{source:'KuGou',state:'not-found'}]);
 const before=calls;connected=true;assert.equal((await service.get(track.id)).synced,true);assert.ok(calls>before);
});
test('switching tracks cancels an old stalled lookup instead of queueing the current song behind it',async t=>{
 let started,aborted=false;const begun=new Promise(r=>{started=r;});
 const service=create(fixture(t),{getTrack:id=>({...track,id}),delay:0,fetchImpl:async(url,{signal})=>{
  if(!aborted){started();return new Promise((_,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});});}
  return Response.json(record);
 }});
 const previous=service.get('previous');await begun;const current=await service.get('current');
 assert.equal(aborted,true);assert.equal(current.synced,true);await previous;
});
test('source mode is durable, invalidates old misses, and primary-only never contacts backup',async t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'lyrics-preferences.json'),JSON.stringify({enabled:true,mode:'primary'}));
 let calls=[];let hasBackup=false;
 const options={getTrack:()=>track,delay:0,fetchImpl:async url=>{calls.push(url);if(url.includes('lrclib.net'))return new Response('{}',{status:404});return backupResponse(url,hasBackup?[candidate]:[]);}};
 const service=create(dir,options);assert.equal((await service.get(track.id)).state,'not-found');assert.ok(calls.every(u=>u.includes('lrclib.net')));
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost'),dir,service));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/lyrics/settings';
 let response=await fetch(endpoint,{method:'POST',headers:{'X-Pain-Update':'lyrics'},body:JSON.stringify({mode:'regional'})});assert.deepEqual(await response.json(),{enabled:true,mode:'regional'});
 calls=[];hasBackup=true;assert.equal((await service.get(track.id)).source.name,'KuGou');assert.ok(calls.every(u=>u.includes('kugou.com')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'lyrics-preferences.json'))).mode,'regional');
 response=await fetch(endpoint,{method:'POST',headers:{'X-Pain-Update':'lyrics'},body:JSON.stringify({mode:'unknown'})});assert.equal(response.status,400);
});

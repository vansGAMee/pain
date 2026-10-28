const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const Sync=require('../src/phone-sync'),Model=require('../src/companion-model');
test('portable collections preserve missing-song positions and mixed manual lyrics',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-portable-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const Store=require('../src/companion-store'),store=new Store(dir),songs=['a','b'].map(id=>({id,title:id,artist:'Artist',duration:180000,bytes:123456})),missing={...songs[0],id:'missing',title:'Unresolved'};
 fs.writeFileSync(path.join(dir,'library.json'),JSON.stringify({tracks:songs}));
 const entities={'playlist:portable':{kind:'playlist',name:'Ordered',tracks:[songs[0],missing,songs[1]]},['lyrics:'+Model.trackKey(songs[0])]:{kind:'lyrics',track:songs[0],body:'Intro note\n[00:01.00]Words\n[00:02.00]\n[Chorus]',offset:0}};
 store.apply(entities);const captured=store.capture();assert.deepEqual(captured['playlist:portable'].tracks.map(t=>t.title),['a','Unresolved','b']);
 assert.equal(captured['lyrics:'+Model.trackKey(songs[0])].body,entities['lyrics:'+Model.trackKey(songs[0])].body);
 const arrived={...missing,id:'new-media-id'};fs.writeFileSync(path.join(dir,'library.json'),JSON.stringify({tracks:[...songs,arrived]}));store.apply(store.capture());
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')))[0].trackIds,['a','new-media-id','b']);
 const list=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')));list[0].trackIds=['a','b'];fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify(list));assert.deepEqual(store.capture()['playlist:portable'].tracks.map(t=>t.title),['a','b'],'explicit removal must not be treated as a newly available song');
});
test('PC/phone exchange keeps playlists, timing, removals, unavailable songs and concurrent PC edits',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-companion-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const tracks=['a','b','c'].map(id=>({id,title:'Song '+id,artist:'Artist',album:'Album',duration:180000,bytes:123456})),[a,b,c]=tracks,unavailable={...c,id:'unavailable',title:'Not on this PC'};
 const sync=new Sync(dir);sync.saveLibrary({tracks});sync.saveStats({plays:[]});
 fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify([{id:'pc',name:'PC list',trackIds:['a','b']}]));
 fs.mkdirSync(path.join(dir,'lyrics'));const lyricFile=id=>path.join(dir,'lyrics',crypto.createHash('sha256').update(id).digest('hex')+'.json');
 fs.writeFileSync(lyricFile('a'),JSON.stringify({lines:[{text:'My words',time:1}]}));
 let entities={phone:{kind:'playlist',name:'Phone list',tracks:[c]},['lyrics:'+Model.trackKey(b)]:{kind:'lyrics',track:{...b,id:'different-phone-id'},body:'[00:02.00]Phone words',offset:250}},revision=1,fail=false,onApply;
 const server=http.createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):null;let result;
  if(req.url==='/api/library')result={tracks,capabilities:{companion:1}};
  else if(req.url==='/api/stats')result={plays:[]};
  else if(req.method==='POST'){
   if(fail||body.revision!==String(revision)){res.writeHead(409);res.end('{}');return;}
   entities=body.entities;revision++;if(onApply){onApply();onApply=null;}result={schema:1,revision:String(revision),entities};
  }else result={schema:1,revision:String(revision),entities};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 let result=await sync.synchronize(base);assert.equal(result.companion.error,undefined);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'playlists.json'))).length,2);
 assert.equal(JSON.parse(fs.readFileSync(lyricFile('b'))).lines[0].time,1.75,'phone offset is respected on desktop');
 const key='playlist:pc';entities[key]={...entities[key],name:'Phone rename',tracks:[...entities[key].tracks,unavailable]};revision++;
 const lists=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')));lists.find(p=>p.id==='pc').trackIds=['b','c'];fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify(lists));
 result=await sync.synchronize(base);const merged=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json'))).find(p=>p.id==='pc');
 assert.equal(merged.name,'Phone rename');assert.deepEqual(merged.trackIds,['b','c']);assert.ok(merged.companionTracks.some(t=>t.id==='unavailable'));
 delete entities['lyrics:'+Model.trackKey(a)];revision++;await sync.synchronize(base);assert.deepEqual(JSON.parse(fs.readFileSync(lyricFile('a'))).lines,[],'explicit deletion cannot revive an online cached lyric');
 fail=true;const pending=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')));pending.find(p=>p.id==='pc').name='Local change before failure';fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify(pending));const previous=fs.readFileSync(path.join(dir,'playlists.json'),'utf8');entities.new={kind:'playlist',name:'Needs retry',tracks:[a]};revision++;
 result=await sync.synchronize(base);assert.ok(result.companion.error);assert.equal(fs.readFileSync(path.join(dir,'playlists.json'),'utf8'),previous);fail=false;
 onApply=()=>{const current=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')));current.find(p=>p.id==='pc').name='Edited while syncing';fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify(current));};
 // Force a POST as well as a remote change.
 const current=JSON.parse(fs.readFileSync(path.join(dir,'playlists.json')));current.find(p=>p.id==='pc').trackIds.push('a');fs.writeFileSync(path.join(dir,'playlists.json'),JSON.stringify(current));
 await sync.synchronize(base);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'playlists.json'))).find(p=>p.id==='pc').name,'Edited while syncing');
 await sync.synchronize(base);assert.equal(entities[key].name,'Edited while syncing');
});

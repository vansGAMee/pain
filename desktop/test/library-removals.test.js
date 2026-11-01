const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const Sync=require('../src/phone-sync'),Model=require('../src/companion-model'),Guard=require('../src/data-guard');
const song={id:'pc-bad',title:'Horizon',artist:'Samsung',album:'',duration:150000,bytes:123456,favorite:1};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-remove-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Sync(dir);}
test('purge survives restart, stale phone imports, duplicate IDs, collections and old backups',t=>{
 const sync=setup(t),other={...song,id:'safe',title:'Other'};
 sync.saveLibrary({tracks:[song,other]});sync.play({id:'old-play',track:song.id,started:123456,heard:5000,duration:song.duration});
 sync.favorite(song.id,true);sync.write('playlists.json',[{id:'p',name:'Mix',trackIds:[song.id,other.id],companionTracks:[song,other]}]);
 sync.write('companion-retained.json',{'lyrics:old':{kind:'lyrics',track:song,body:'old',offset:0}});sync.write('excluded-tracks.json',[song.id]);
 const backup=Guard.exportBundle(sync.dir);sync.removeTrack(song);
 assert.deepEqual(sync.read('library.json',{}).tracks,[other]);assert.equal(sync.read('stats.json',{}).plays.length,0);assert.equal(sync.pending.plays.length,0);assert.equal(sync.pending.favorites.length,0);
 assert.deepEqual(sync.read('playlists.json',[])[0].trackIds,[other.id]);assert.deepEqual(sync.companion.capture()['playlist:p'].tracks.map(t=>t.title),['Other']);
 const restarted=new Sync(sync.dir);restarted.saveLibrary({tracks:[song,{...song,id:'media:77'},other]});restarted.saveStats({plays:[{id:'late',track:'media:77',started:987654,heard:3000,duration:150000}]});
 assert.deepEqual(restarted.read('library.json',{}).tracks,[other]);assert.equal(restarted.read('stats.json',{}).plays.length,0);
 Guard.importBundle(sync.dir,backup);const restored=new Sync(sync.dir);assert.deepEqual(restored.read('library.json',{}).tracks,[other]);
 assert.equal(Object.keys(restored.removals.entries).length,1);
});
test('removal is exchanged before stale stats and collections, across different device IDs',async t=>{
 const sync=setup(t);sync.saveLibrary({tracks:[song]});sync.removeTrack(song);let entries={},events=[];
 const phone=http.createServer(async(req,res)=>{let text='';for await(const b of req)text+=b;const body=text?JSON.parse(text):null;events.push(req.method+' '+req.url);
  let response;
  if(req.url==='/api/library')response={tracks:[{...song,id:'media:4'}],capabilities:{libraryRemovals:1}};
  else if(req.url==='/api/library-removals'){entries={...entries,...body?.entries};response={entries};}
  else response={plays:[{id:'stale',track:'media:4',started:1000,heard:5000,duration:150000}]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));
 });await new Promise(r=>phone.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>phone.close(r)));
 const result=await sync.synchronize('http://127.0.0.1:'+phone.address().port);assert.equal(result.library.tracks.length,0);assert.equal(result.stats.plays.length,0);
 assert.deepEqual(events.slice(0,3),['GET /api/library','GET /api/library-removals','POST /api/library-removals']);assert.ok(entries[Model.trackKey(song)]);
});
test('invalid removal batches are atomic and never match unrelated recording variants',t=>{
 const sync=setup(t);sync.saveLibrary({tracks:[song,{...song,id:'other-version',bytes:99}]});
 assert.throws(()=>sync.mergeRemovals({[Model.trackKey(song)]:song,wrong:song}));assert.equal(sync.read('library.json',{}).tracks.length,2);
 sync.removeTrack(song);assert.deepEqual(sync.read('library.json',{}).tracks.map(t=>t.id),['other-version']);
});

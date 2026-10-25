const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const Sync=require('../src/phone-sync'),merge=require('../src/stats-store');
const play={id:'pc_one',track:'трек 🎵',started:1000,heard:120000,media_heard:60000,duration:180000,finished:0,skipped:1};
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pain-sync-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));return dir;}
async function phone(t,handler){const s=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;handler(req,res,body?JSON.parse(body):null);});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return 'http://127.0.0.1:'+s.address().port;}
const reply=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
test('older phone snapshots preserve unique coverage, skips, completions and distinct rapid replays',()=>{
 const a={...play,finished:1};
 const result=merge({plays:[a],slices:[{id:1,play:a.id,at:1000,ms:100}]},
  {plays:[{id:'legacy',track:a.track,started:1000,heard:30000,finished:0},{...a,id:'pc_two',started:1001}],
   slices:[{id:1,play:'pc_two',at:1001,ms:50},{id:42,play:'legacy',at:1000,ms:100}]});
 assert.equal(result.plays.length,2);const merged=result.plays.find(p=>p.started===1000);
 assert.equal(merged.heard,120000);assert.equal(merged.media_heard,60000);assert.equal(merged.skipped,1);assert.equal(merged.finished,1);
 assert.equal(result.slices.length,2);assert.equal(result.slices.reduce((s,p)=>s+p.ms,0),150);
 assert.deepEqual(merge(result,result),result,'round trips are idempotent');
});
test('offline changes survive restart; retry sends complete metadata and preserves phone history',async t=>{
 const dir=temp(t);let sync=new Sync(dir),fail=true,remote={plays:[{...play,id:'phone',track:'other',started:2000}],slices:[]};
 let library={tracks:[{id:play.track,title:'Тёмная волна 🎵',favorite:0}]},sent=[];
 const base=await phone(t,(req,res,body)=>{
  if(fail)return reply(res,{error:'offline'},503);
  if(req.method==='POST'){
   sent.push(body);
   if(req.url==='/api/library')library.tracks[0].favorite=body.tracks[0].favorite;
   else remote=merge(remote,body);
   return reply(res,{status:'ok'});
  }
  reply(res,req.url==='/api/library'?library:remote);
 });
 sync.saveLibrary(library);sync.favorite(play.track,1);sync.play(play);
 await assert.rejects(sync.synchronize(base));
 sync=new Sync(dir);assert.equal(sync.pending.favorites.length,1);assert.equal(sync.pending.plays.length,1);
 fail=false;const result=await sync.synchronize(base);
 assert.equal(result.library.tracks[0].favorite,1);assert.equal(result.stats.plays.length,2);
 assert.deepEqual(sent[1].plays[0],{...play,session:'pc_companion'});
 assert.equal(sync.pending.plays.length,0);assert.equal(sync.pending.favorites.length,0);
 await sync.synchronize(base);assert.equal(sent.length,2,'no repeated upload after acknowledged delivery');
 // A later change on the phone is allowed to replace an acknowledged PC like.
 library.tracks[0].favorite=0;
 assert.equal((await sync.synchronize(base)).library.tracks[0].favorite,0);
});
test('a delayed acknowledgement cannot discard a newer unlike',async t=>{
 const sync=new Sync(temp(t));let release,arrived;
 const received=new Promise(r=>arrived=r);let favorite=0;
 const base=await phone(t,(req,res,body)=>{
  if(req.method==='POST'){
   favorite=body.tracks[0].favorite;
   if(favorite===1){release=()=>reply(res,{status:'ok'});arrived();}else reply(res,{status:'ok'});
  }else reply(res,req.url==='/api/library'?{tracks:[{id:play.track,favorite}]}:{plays:[]});
 });
 sync.favorite(play.track,1);const first=sync.flush(base);await received;
 sync.favorite(play.track,0);release();await first;
 assert.equal(sync.pending.favorites.length,1);assert.equal(sync.pending.favorites[0].favorite,0);
 assert.equal(sync.saveLibrary({tracks:[{id:play.track,favorite:1}]}).tracks[0].favorite,0);
 await sync.synchronize(base);assert.equal(favorite,0);assert.equal(sync.pending.favorites.length,0);
});
test('corrupt phone snapshots cannot erase the last good local library',async t=>{
 const sync=new Sync(temp(t)),library={tracks:[{id:play.track,favorite:1}]};sync.saveLibrary(library);
 const base=await phone(t,(req,res)=>reply(res,req.url==='/api/library'?{oops:true}:{plays:[]}));
 await assert.rejects(sync.synchronize(base));assert.deepEqual(sync.read('library.json',null),library);
 for(const invalid of [{...play,heard:-1},{...play,media_heard:NaN},{...play,started:0}])assert.throws(()=>sync.play(invalid));
});
test('lost responses retry safely and pre-outbox PC history is recovered',async t=>{
 const sync=new Sync(temp(t));sync.saveStats({plays:[{...play,session:'pc_companion'}]});
 let remote={plays:[],slices:[]},loseResponse=true,posts=0;
 const base=await phone(t,(req,res,body)=>{
  if(req.method==='POST'){
   posts++;remote=merge(remote,body);
   if(loseResponse){loseResponse=false;res.destroy();return;}
   return reply(res,{status:'ok'});
  }
  reply(res,req.url==='/api/library'?{tracks:[]}:remote);
 });
 await assert.rejects(sync.synchronize(base));
 assert.equal(sync.pending.plays.length,1);
 const result=await sync.synchronize(base);
 assert.equal(result.stats.plays.length,1);assert.equal(result.stats.plays[0].heard,120000);assert.equal(posts,2);
 await sync.synchronize(base);assert.equal(posts,2);
});

test('partial or empty phone libraries preserve PC tracks, favorites and history references', async t=>{
 const sync=new Sync(temp(t));
 const local={id:'pc_upload_1234567890abcdef',title:'Local recording',favorite:1};
 sync.saveLibrary({tracks:[local,{id:'media:1',title:'Phone track',favorite:0}]});
 const base=await phone(t,(req,res)=>reply(res,req.url==='/api/library'?{tracks:[]}:{plays:[]}));
 assert.deepEqual((await sync.synchronize(base)).library.tracks,[local,{id:'media:1',title:'Phone track',favorite:0}]);
 const merged=sync.saveLibrary({tracks:[{id:'media:1',title:'Updated phone title',favorite:1}]});
 assert.deepEqual(merged.tracks[0],local);
 assert.equal(merged.tracks[1].title,'Updated phone title');
 assert.equal(merged.tracks[1].favorite,1);
 assert.equal(new Sync(sync.dir).read('library.json',null).tracks.length,2);
});

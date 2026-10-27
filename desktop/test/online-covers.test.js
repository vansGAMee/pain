const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
test('current cover precedes queued covers; preempts old work; maximum skips library work; local covers survive network disable',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-cover-queue-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const find=require('../src/online-covers'),seen=[];
 let unblock;
 const gate=new Promise(r=>unblock=r);
 find.configure({localMedia:{
  async read(track){seen.push(track.id);if(track.id==='first')await gate;return {track};},
  async cover(data,file,signal){if(signal.aborted)return false;await fs.writeFile(file,'cover');return true;}
 }});
 find.setEnabled(true);find.setMode('full');
 const request=(id,priority=false)=>find({id,title:id,artist:'Artist'},path.join(dir,id),()=>true,{priority});
 const first=request('first');await new Promise(r=>setImmediate(r));
 const later=request('later'),current=request('current',true);unblock();
 assert.deepEqual(await Promise.all([first,later,current]),[false,true,true]);
 assert.deepEqual(seen,['first','current','later']);
 find.setMode('maximum');assert.equal(await request('offscreen'),false);
 assert.equal(await request('playing',true),true);
 find.setMode('full');const cancelled=request('cancelled');find.setEnabled(false);
 assert.equal(await cancelled,true);assert.ok(seen.includes('cancelled'),'embedded artwork remains available with internet disabled');
});
test('missing large artwork falls back to the smaller verified release cover',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-cover-fallback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 delete require.cache[require.resolve('../src/online-covers')];const find=require('../src/online-covers');
 const original=global.fetch;t.after(()=>global.fetch=original);const urls=[];
 const id='11111111-1111-1111-1111-111111111111';
 global.fetch=async url=>{urls.push(String(url));
  if(String(url).includes('itunes.apple.com'))return new Response(JSON.stringify({results:[]}),{headers:{'content-type':'application/json'}});
  if(String(url).endsWith('front-500'))return new Response('',{status:404});
  return new Response('small-cover',{headers:{'content-type':'image/jpeg'}});
 };
 find.configure({catalog:{lookup:async()=>({releases:[{id}]})}});find.setMode('full');
 const file=path.join(dir,'cover.jpg');assert.equal(await find({id:'a',artist:'Artist',title:'Song'},file),true);
 assert.equal(await fs.readFile(file,'utf8'),'small-cover');
 assert.ok(urls.some(url=>url.endsWith('front-500')));assert.ok(urls.some(url=>url.endsWith('front-250')));
});
test('successful searches survive a process restart without repeated catalog calls',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-cover-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const original=global.fetch;t.after(()=>global.fetch=original);let searches=0;
 global.fetch=async url=>{
  if(String(url).includes('itunes.apple.com')){searches++;return new Response(JSON.stringify({results:[{artistName:'Artist',trackName:'Song',artworkUrl100:'https://is1-ssl.mzstatic.com/cover.jpg'}]}));}
  return new Response('cover',{headers:{'content-type':'image/jpeg'}});
 };
 for(let i=0;i<2;i++){
  delete require.cache[require.resolve('../src/online-covers')];const find=require('../src/online-covers');find.configure({dataDir:dir});find.setMode('full');
  assert.equal(await find({id:'song'+i,artist:'Artist',title:'Song'},path.join(dir,'cover'+i+'.jpg')),true);
 }
 assert.equal(searches,1);
});

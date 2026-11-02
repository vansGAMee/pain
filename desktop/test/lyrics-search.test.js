const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const route=require('../src/lyrics-store'),create=require('../src/lyrics-online'),{key}=require('../src/lyrics-search');
test('lyrics search reads only matching disk caches, respects manual text and never starts an online lookup',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-lyrics-search-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const tracks=[{id:'a',title:'Title',artist:'Artist',duration:5000},{id:'b',title:'Another',artist:'Band',duration:6000},{id:'c',title:'Manual',artist:'Singer',duration:7000}];let calls=0;
 const online=create(dir,{getTrack:id=>tracks.find(t=>t.id===id),fetchImpl:async()=>{calls++;throw Error('Must stay offline');}});
 await fs.mkdir(path.join(dir,'lyrics-online'));await fs.mkdir(path.join(dir,'lyrics'));
 for(const track of tracks){const signature=JSON.stringify([track.title,track.artist,track.album,track.duration]);await fs.writeFile(path.join(dir,'lyrics-online',key(track.id+signature)+'.json'),JSON.stringify({lines:[{time:1,text:'Automatic '+track.id}]}));}
 await fs.writeFile(path.join(dir,'lyrics',key('a')+'.json'),JSON.stringify({lines:[{time:null,text:'Edited words'}]}));
 await fs.writeFile(path.join(dir,'lyrics',key('c')+'.json'),JSON.stringify({lines:[]}));
 const server=http.createServer((req,res)=>route(req,res,new URL(req.url,'http://localhost'),dir,online));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port+'/api/lyrics/search-index';
 const get=ids=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
 const response=await get(['a','b','c','unknown','../../etc/passwd','a']);assert.equal(response.status,200);
 assert.deepEqual(Object.fromEntries((await response.json()).rows.map(r=>[r.id,r.lyrics])),{a:'Edited words',b:'Automatic b',c:'',unknown:'','../../etc/passwd':''});
 tracks[1].title='Changed';assert.deepEqual((await(await get(['b'])).json()).rows,[{id:'b',lyrics:''}],'a different metadata signature cannot borrow old words');
 assert.equal((await get(Array(129).fill('a'))).status,400);assert.equal((await get([{}])).status,400);assert.equal((await fetch(url)).status,405);assert.equal(calls,0);
});

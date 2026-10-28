const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const create=require('../src/cached-tracks');
test('cache scans share concurrent work, bound disk concurrency and preserve download fallback',async()=>{
 let reads=0,active=0,peak=0;const files=Array.from({length:30},(_,i)=>'song'+i+'.mp3');
 const io={readdir:async dir=>{reads++;return dir==='/cache'?[...files,'tiny.mp3','folder.mp3']:['Artist - Title.flac'];},stat:async file=>{peak=Math.max(peak,++active);try{await new Promise(r=>setTimeout(r,1));return {size:file==='/cache/tiny.mp3'?1:8192,isFile:()=>!file.endsWith('folder.mp3')};}finally{active--;}}};
 const scan=create({cacheDir:'/cache',downloadsDir:'/downloads',getTracks:()=>[{id:'tiny',title:'Title',artist:'Artist',path:'Title.flac'}],io});
 const [a,b]=await Promise.all([scan(),scan()]);assert.strictEqual(a,b);assert.equal(reads,2);assert.ok(peak<=8);assert.equal(a.length,31);assert.ok(a.includes('tiny'));assert.ok(!a.includes('folder'));
 await scan();assert.equal(reads,4,'later scans are fresh');
});
test('a removed file does not fail the remaining library',async()=>{
 const scan=create({cacheDir:'/cache',downloadsDir:'/downloads',getTracks:()=>[],io:{readdir:async dir=>dir==='/cache'?['gone.mp3','ok.mp3']:[],stat:async file=>{if(path.basename(file)==='gone.mp3')throw Error('Removed');return {size:4096,isFile:()=>true};}}});assert.deepEqual(await scan(),['ok']);
});

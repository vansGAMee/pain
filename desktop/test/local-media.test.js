const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const run=require('node:util').promisify(require('node:child_process').execFile);
test('embedded tags and cover work offline without altering the audio file',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pain-embedded-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'song.mp3'),cover=path.join(dir,'out.jpg');
 await run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-f','lavfi','-i','color=c=blue:s=32x32:d=1','-map','0:a','-map','1:v','-c:a','libmp3lame','-c:v','mjpeg','-frames:v','1','-disposition:v','attached_pic','-metadata','artist=Hidden Artist','-metadata','title=Hidden Song','-metadata','album=Hidden Album',file]);
 const before=await fs.readFile(file);
 const media=require('../src/local-media')(dir,()=>file);
 const result=await media.read({id:'test',title:'download',artist:'<unknown>',album:'Download'});
 assert.equal(result.track.artist,'Hidden Artist');assert.equal(result.track.title,'Hidden Song');
 assert.equal(result.audio.sampleRate,44100);
 assert.equal(await media.cover(result,cover),true);
 assert.ok((await fs.stat(cover)).size>100);
 assert.deepEqual(await fs.readFile(file),before);
 assert.equal((await media.read({id:'test',artist:'<unknown>'})).track.artist,'Hidden Artist');
});

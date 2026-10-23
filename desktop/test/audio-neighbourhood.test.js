const test=require('node:test'),assert=require('node:assert/strict');
const Audio=require('../src/audio-profile'),Taste=require('../src/taste-model'),Queue=require('../src/queue-engine');
function fixture(){
 const tracks=Array.from({length:24},(_,i)=>({id:String(i),title:'Track '+i,duration:180000,bpm:120}));
 // All share bass/treble balance and tempo. Subtle measured timbre differences
 // form a ring, so neighbours and opposite sounds are known without genre tags.
 const profiles=tracks.map((t,i)=>({version:4,signature:Audio.signature(t),frames:48,seconds:24,
  positions:Array.from({length:48},(_,k)=>k),vector:[.4,.5,.4,.1,.08,.02],variance:Array(6).fill(.01),
  timbre:Array.from({length:12},(_,k)=>k<2?.5+.08*(k?Math.sin(i*Math.PI/12):Math.cos(i*Math.PI/12)):.5),timbreVariance:Array(12).fill(.008)}));
 return {tracks,profiles,store:Object.fromEntries(tracks.map((t,i)=>[t.id,profiles[i]]))};
}
test('library-relative sound separates nuanced timbre despite almost identical broad audio',()=>{
 const {profiles:p}=fixture(),match=Audio.calibratedSimilarity(p);
 assert.ok(Audio.similarity(p[0],p[12])>.9,'old absolute score overstates the remote sound');
 assert.ok(match(p[0],p[1])>.9,'nearby texture must remain a good fit');
 assert.ok(match(p[0],p[12])<.5,'same bass balance is not enough');
 assert.equal(match(p[0],p[0]),1);assert.equal(match(p[0],p[5]),match(p[5],p[0]));
 for(const a of p)for(const b of p){const s=match(a,b);assert.ok(s>=0&&s<=Audio.similarity(a,b));}
});
test('duplicates, ordering, missing evidence and a tiny library cannot manufacture neighbourhoods',()=>{
 const {profiles:p}=fixture(),before=JSON.stringify(p),a=Audio.calibratedSimilarity(p);
 assert.equal(Audio.calibratedSimilarity(p),a,'unchanged evidence reuses its geometry');
 const reversed=Audio.calibratedSimilarity([...p].reverse());
 const duplicates=Audio.calibratedSimilarity([...p,...p.map(x=>structuredClone(x))]);
 assert.equal(a(p[0],p[12]),reversed(p[0],p[12]));assert.equal(a(p[0],p[12]),duplicates(p[0],p[12]));
 const tiny=Audio.calibratedSimilarity(p.slice(0,5)),identical=Audio.calibratedSimilarity(Array(30).fill(p[0]));
 assert.equal(tiny(p[0],p[12]),Audio.similarity(p[0],p[12]));assert.equal(identical(p[0],p[12]),Audio.similarity(p[0],p[12]));
 for(const missing of [null,{}, {...p[0],frames:3,seconds:1.5}])assert.equal(a(missing,p[1]),null);
 const partial={...p[0],frames:4,seconds:2};assert.equal(a(partial,p[1],true),Audio.similarity(partial,p[1],true));
 assert.equal(JSON.stringify(p),before,'calibration never edits audio caches');
});
test('ranking gains separation without always selecting top one or inventing similarity',()=>{
 const {tracks:t,profiles:p,store}=fixture(),m=new Taste(t,[],Date.now(),store);
 const near=m.score(t[0],t[1]),far=m.score(t[0],t[12]);assert.ok(near.score>far.score+30);
 assert.ok(near.reasons.includes('Близкое звучание'));assert.ok(!far.reasons.includes('Близкое звучание'));
 const choices=new Set();for(let seed=1;seed<=40;seed++){const pick=m.choose(t[0],t.slice(1),{},{seed});choices.add(pick.track.id);assert.ok(pick.soundSimilarity>.65);}
 assert.ok(choices.size>2,'keep sampling several good neighbours');
 assert.equal(m.score(t[0],{...t[1],bytes:123}).soundSimilarity,null,'replaced files do not borrow old sound');
 const q=new Queue({shuffleMode:'smart',loopMode:'off',audioProfiles:store});q.setContext('library',t,0,'Test');q.excludeTrack('12');
 const seen=new Set(['0']);for(let i=1;i<t.length-1;i++){const preview=q.peekNext(),next=q.next();assert.equal(next.id,preview.id);assert.ok(!seen.has(next.id));assert.notEqual(next.id,'12');seen.add(next.id);}
 assert.equal(q.next(),null,'even a strict fit must eventually play the whole allowed queue');
});
test('updated immutable profiles refresh calibration while previous snapshots stay reproducible',()=>{
 const {profiles:p}=fixture(),old=Audio.calibratedSimilarity(p),before=old(p[0],p[12]);
 const next=[...p];next[12]={...p[12],timbre:[...p[0].timbre]};const current=Audio.calibratedSimilarity(next);
 assert.notEqual(current,old);assert.equal(current(next[0],next[12]),1);assert.equal(old(p[0],p[12]),before);
});
test('calibrated skips penalize the rejected texture without spilling into unrelated sounds',()=>{
 const {tracks:t,store}=fixture(),now=Date.now();
 const skip=(id,started)=>({track:id,started,heard:5000,duration:180000,skipped:1});
 const single=new Taste(t,[skip('0',now-5000)],now,store);
 assert.ok(single.score(null,t[1]).skipPenalty>50);
 assert.equal(single.score(null,t[12]).skipPenalty,0);
 const browsing=new Taste(t,[skip('0',now-15000),skip('1',now-5000)],now,store);
 assert.ok(browsing.score(null,t[2]).skipPenalty<15,'a browsing burst stays weaker than a clear rejection');
});

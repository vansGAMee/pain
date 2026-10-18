const test=require('node:test'),assert=require('node:assert/strict'),Taste=require('../src/taste-model'),Queue=require('../src/queue-engine');
test('learns real completion and skip fields, generalises to an unheard track by the liked artist',()=>{
 const tracks=[{id:'a',artist:'Liked'},{id:'b',artist:'Skipped'},{id:'newA',artist:'Liked'},{id:'newB',artist:'Skipped'}];
 const now=Date.now(),plays=[];
 for(let i=0;i<18;i++)for(const id of ['a','b'])plays.push({track:id,started:now-(i*2+(id==='a'?1:2))*3600000,duration:180000,heard:id==='a'?180000:6000,finished:id==='a'?1:0});
 const model=new Taste(tracks,plays,now),good=model.score(null,tracks[2]),bad=model.score(null,tracks[3]);
 assert.ok(good.probability>bad.probability+.3);
 const reverse=plays.map(p=>({...p,track:p.track==='a'?'b':'a'})),changed=new Taste(tracks,reverse,now);
 assert.ok(changed.score(null,tracks[3]).probability>changed.score(null,tracks[2]).probability+.3);
 assert.equal(good.bpm,null);
 assert.equal(new Taste(tracks,[...plays,...plays],now).samples,plays.length);
});
test('prefetch agrees with smart next; queue remains isolated and does not repeat before exhaustion',()=>{
 const q=new Queue({shuffleMode:'smart'});q.setContext('library',[{id:'a'},{id:'b'},{id:'c'}],0);
 const peek=q.peekNext().id;assert.equal(q.next().id,peek);const second=q.next().id;assert.notEqual(second,peek);assert.notEqual(second,'a');
});
test('discovery breaks a favourites bubble without promoting repeatedly skipped music',()=>{
 const now=Date.now(),liked={id:'liked',artist:'Familiar',favorite:1},fresh={id:'fresh',artist:'New'},skip={id:'skip',artist:'Avoided'};
 const plays=[];for(let i=0;i<30;i++)for(const track of ['liked','skip'])plays.push({track,started:now-(i*2+(track==='liked'?1:2))*60000,heard:track==='liked'?180000:3000,duration:180000,finished:track==='liked'?1:0});
 const model=new Taste([liked,fresh,skip],plays,now);
 for(let seed=1;seed<=30;seed++)assert.equal(model.choose(null,[liked,fresh,skip],{},{step:3,seed}).track.id,'fresh');
 assert.equal(model.score(null,liked).probability,model.score(null,{...liked,favorite:0}).probability);
});
test('shuffle varies between seeds and preview stays stable for the same decision',()=>{
 const tracks=Array.from({length:12},(_,i)=>({id:String(i),artist:'Artist '+i})),model=new Taste(tracks);
 const choices=new Set();for(let seed=1;seed<=50;seed++)choices.add(model.choose(null,tracks,{},{step:1,seed}).track.id);
 assert.ok(choices.size>=7);assert.equal(model.choose(null,tracks,{},{seed:7}).track.id,model.choose(null,tracks,{},{seed:7}).track.id);
});
test('discovery can recover forgotten music and avoids two recent artists when alternatives exist',()=>{
 const now=Date.now(),tracks=[{id:'old',artist:'Old'},{id:'recent',artist:'Recent'}];
 const model=new Taste(tracks,[{track:'old',started:now-40*86400000,finished:1},{track:'recent',started:now-60000,finished:1}],now);
 const result=model.choose(null,tracks,{},{step:3,seed:5,recentArtists:['recent']});assert.equal(result.track.id,'old');assert.equal(result.reasons[0],'Давно не звучало');
});
test('explicit early skips change session direction; completion and timeout clear the temporary signal',()=>{
 const now=Date.now(),tracks=[{id:'a',artist:'Rock'},{id:'b',artist:'Rock'},{id:'c',artist:'Jazz'}];
 const skip=(id,ago)=>({track:id,started:now-ago,duration:180000,heard:5000,skipped:1});
 const plays=[skip('a',120000),skip('b',60000)];
 const model=new Taste(tracks,plays,now);
 assert.equal(model.choose(tracks[1],[tracks[0],tracks[2]],{},{step:1,seed:3}).track.id,'c');
 assert.match(model.choose(tracks[1],[tracks[0],tracks[2]],{},{step:1,seed:3}).reasons[0],/пропусков/);
 assert.equal(new Taste(tracks,plays,now+11*60000).recentSkips.length,0);
 assert.equal(new Taste(tracks,[...plays,{track:'c',started:now-1000,finished:1}],now).recentSkips.length,0);
 assert.equal(new Taste(tracks,plays.map(p=>({...p,skipped:0})),now).recentSkips.length,0);
 assert.equal(model.choose(tracks[1],[tracks[0]],{},{step:1,seed:3}).track.id,'a');
});
test('a large discography does not crowd out another artist during discovery',()=>{
 const tracks=[{id:'solo',artist:'One song'},...Array.from({length:30},(_,i)=>({id:'catalog'+i,artist:'Large catalogue'}))];
 const model=new Taste(tracks);let solo=0;
 for(let seed=1;seed<=600;seed++)if(model.choose(null,tracks,{},{step:3,seed}).track.id==='solo')solo++;
 assert.ok(solo>220&&solo<380,`Expected balanced artist exposure, got ${solo}/600`);
});
test('sustained recent taste shifts beat old habits, but one contrary play does not',()=>{
 const now=new Date(2026,9,18,15).getTime(),tracks=[{id:'a',artist:'A'},{id:'b',artist:'B'},{id:'na',artist:'A'},{id:'nb',artist:'B'}],history=[];
 for(let i=0;i<160;i++)for(const id of ['a','b'])history.push({track:id,started:now-(40+i/20)*86400000,duration:180000,heard:id==='a'?180000:5000,finished:id==='a'?1:0});
 const recent=[];for(let i=0;i<8;i++)for(const id of ['a','b'])recent.push({track:id,started:now-(1+i/8)*86400000,duration:180000,heard:id==='b'?180000:5000,finished:id==='b'?1:0});
 const prediction=plays=>{const m=new Taste(tracks,plays,now);return [m.score(null,tracks[2],{},{hour:15}).probability,m.score(null,tracks[3],{},{hour:15}).probability];};
 const before=prediction(history),single=prediction([...history,...recent.slice(0,2)]),after=prediction([...history,...recent]);
 assert.ok(before[0]>before[1]);assert.ok(single[0]>single[1]);assert.ok(after[1]>after[0],`Recent preference was not learned: ${after}`);
});
test('session companions improve ranking across unrelated artist metadata',()=>{
 const now=Date.now(),tracks=['a','bridge','b','c','d'].map(id=>({id,artist:'Artist '+id})),plays=[];
 for(let day=1;day<=8;day++)for(const [group,ids] of [[0,['a','bridge','b']],[1,['c','bridge','d']]])ids.forEach((track,i)=>plays.push({track,started:now-day*86400000+group*3600000+i*180000,finished:1,duration:180000,heard:180000}));
 const model=new Taste(tracks,plays,now),a=tracks[0],b=tracks[2],d=tracks[4];
 const bBase=model.score(null,b),dBase=model.score(null,d),bContext=model.score(a,b),dContext=model.score(a,d);
 assert.ok(bContext.affinity>dContext.affinity);
 assert.ok(bContext.score-bBase.score>dContext.score-dBase.score+5);
 assert.ok(bContext.reasons.includes('Сочетается с вашей сессией'));
 const skipped=new Taste(tracks,[...plays,{track:'a',started:now-1000,duration:180000,heard:2000,skipped:1}],now);
 assert.equal(skipped.score(a,b).affinity,0);
});
test('download sources cannot become shared artist preferences or artist spacing penalties',()=>{
 const now=Date.now();
 for(const source of ['Telegram','ТЕЛЕГРАМ','https://t.me/music','@music_channel','www.music.ru','music.net','Unknown Artist','Various Artists','Скачано с сайта','Теле\u200bграм','AyuGram','Айограм','АюГрам','AyuGram Desktop','AYU-GRAM v1.5.0','Aiogram','NekoGram Android','exteraGram','Nicegram','Kotatogram Desktop','Telegram X','64Gram','Forkgram','Cherrygram','Unigram','Plus Messenger']){
  const tracks=[{id:'a',artist:source},{id:'b',artist:source},{id:'c',artist:''}],plays=Array.from({length:12},(_,i)=>({track:'a',started:now-(i+1)*3600000,finished:1}));
  const model=new Taste(tracks,plays,now);
  assert.equal(model.score(null,tracks[1]).probability,model.score(null,tracks[2]).probability,source);
  assert.equal(model.score(tracks[0],tracks[1]).score,model.score(tracks[0],tracks[2]).score,source);
 }
 for(const name of ['Radiohead','will.i.am','Portugal. The Man','Кино','Gram Parsons','Gramatik','Telegram Sam'])assert.ok(Taste.artistIdentity({artist:name}),name);
 assert.equal(Taste.artistIdentity({artist:'  RADIOHEAD  '}),Taste.artistIdentity({artist:'Radiohead'}));
});

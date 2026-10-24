// Durable local changes and one ordered exchange with the phone. No cloud service.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto');
const mergeStats=require('./stats-store');
const DjState=require('./dj-state');
const { safeWrite, createSnapshot } = require('./data-guard');
const flag=value=>value===true||value===1?1:0;
function request(base,route,body){
 return new Promise((resolve,reject)=>{
  const url=new URL(route,base);if(url.protocol!=='http:')return reject(new Error('Invalid phone URL'));
  const payload=body===undefined?null:JSON.stringify(body);
  const req=http.request(url,{method:payload===null?'GET':'POST',headers:payload===null?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
   const chunks=[];let size=0;
   res.on('data',b=>{size+=b.length;if(size>32*1024*1024)req.destroy(new Error('Sync response too large'));else chunks.push(b);});
   res.on('error',reject);
   res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Phone HTTP '+res.statusCode);resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){reject(e);}});
  });
  const timer=setTimeout(()=>req.destroy(new Error('Phone sync timed out')),5000);
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(payload);
 });
}
class PhoneSync{
 constructor(dir){
  this.dir=dir;this.pending=this.read('sync-pending.json',{favorites:[],plays:[]});this.chain=Promise.resolve();
 }
 read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
 write(name,data){const file=path.join(this.dir,name);safeWrite(file,data);return data;}
 persist(){this.write('sync-pending.json',this.pending);}
 saveLibrary(library){
  if(!library||!Array.isArray(library.tracks))throw new Error('Invalid library');
  const likes=new Map(this.pending.favorites.map(item=>[String(item.trackId),item.favorite]));
  return this.write('library.json',{...library,tracks:library.tracks.map(track=>likes.has(String(track.id))?{...track,favorite:likes.get(String(track.id))}:track)});
 }
 saveStats(stats){
  if(!stats||!Array.isArray(stats.plays))throw new Error('Invalid statistics');
  return this.write('stats.json',mergeStats(this.read('stats.json',{plays:[],slices:[]}),stats));
 }
 saveDjState(state){return this.write('dj-state.json',DjState.merge(this.read('dj-state.json',{}),state));}
 favorite(trackId,favorite){
  if(typeof trackId!=='string'||!trackId||trackId.length>1024)throw new Error('Invalid track');
  const item={trackId,favorite:flag(favorite)};
  this.pending.favorites=this.pending.favorites.filter(p=>p.trackId!==trackId).concat(item);this.persist();
  this.saveLibrary(this.read('library.json',{tracks:[]}));
 }
 play(input){
  if(!input||typeof input.track!=='string'||!input.track||!Number.isSafeInteger(input.started)||input.started<=0)throw new Error('Invalid play');
  if(input.id!==undefined&&(typeof input.id!=='string'||!input.id||input.id.length>1024))throw new Error('Invalid play ID');
  for(const key of ['heard','duration'])if(!Number.isFinite(input[key])||input[key]<0)throw new Error('Invalid '+key);
  const media=input.media_heard??input.heard;if(!Number.isFinite(media)||media<0)throw new Error('Invalid coverage');
  const play={...input,id:input.id||'pc_'+createHash('sha256').update(input.track+'\0'+input.started).digest('hex'),session:input.session||'pc_companion',
   media_heard:Math.min(media,input.duration||media),finished:flag(input.finished),skipped:flag(input.skipped)};
  const stats=this.saveStats({plays:[play]});
  const saved=stats.plays.find(p=>p.track===play.track&&p.started===play.started);
  this.pending.plays=mergeStats({plays:this.pending.plays},{plays:[saved]}).plays;this.persist();
 }
 serial(task){const job=this.chain.catch(()=>{}).then(task);this.chain=job;return job;}
 async sendPending(base){
  // Snapshot objects: an acknowledgement must never remove a newer local change.
  for(const [key,route,pack] of [['favorites','/api/library',items=>({tracks:items.map(p=>({id:p.trackId,favorite:p.favorite}))})],['plays','/api/stats',items=>({plays:items})]]){
   const snapshot=this.pending[key].slice();
   for(let i=0;i<snapshot.length;i+=200){
    const batch=snapshot.slice(i,i+200),reply=await request(base,route,pack(batch));
    if(reply.status!=='ok')throw new Error('Phone did not acknowledge sync');
    const sent=new Set(batch);this.pending[key]=this.pending[key].filter(item=>!sent.has(item));this.persist();
   }
  }
 }
 flush(base){return this.serial(()=>this.sendPending(base));}
 synchronize(base){return this.serial(async()=>{
  await this.sendPending(base);
  const [library,remote]=await Promise.all([request(base,'/api/library'),request(base,'/api/stats')]);
  let stats=remote;
  // Validate both before changing either snapshot.
  if(!Array.isArray(library?.tracks)||!Array.isArray(stats?.plays))throw new Error('Invalid phone snapshot');
  // Recover PC listening saved by older versions, which had no durable outbox.
  const identity=p=>JSON.stringify([p.track,Number(p.started)]);
  const known=new Set(stats.plays.map(identity));
  const missing=this.read('stats.json',{plays:[]}).plays.filter(p=>
   (String(p.id).startsWith('pc_')||String(p.session).startsWith('pc_'))&&p.track&&p.started>0&&!known.has(identity(p)));
  if(missing.length){
   this.pending.plays=mergeStats({plays:this.pending.plays},{plays:missing}).plays;this.persist();
   await this.sendPending(base);
   stats=await request(base,'/api/stats');
   if(!Array.isArray(stats?.plays))throw new Error('Invalid phone statistics');
  }
  let djState=this.read('dj-state.json',{});
  if(library.capabilities?.audioProfiles===1){
   // Optional for older phones. An unavailable analysis worker must not stop stats/likes.
   try{djState=this.saveDjState(await request(base,'/api/dj-state',djState));}catch(_){}
  }
  const result = {library:this.saveLibrary(library),stats:this.saveStats(stats),djState};
  try { createSnapshot(this.dir, 'phone-sync'); } catch (_) {}
  return result;
 });}
}
module.exports=PhoneSync;

'use strict';
// Deletions are monotonic recording identities, independent of device-local IDs.
// Keep this ledger when restoring a backup or reconciling an offline device.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Model=require('./companion-model'),{safeWrite}=require('./data-guard');
module.exports=class LibraryRemovals{
 constructor(dir){this.dir=dir;this.entries=this.read('library-removals.json',{});this.ids=new Set(this.read('removed-track-ids.json',[]));}
 read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(this.dir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
 write(name,value){safeWrite(path.join(this.dir,name),value);}
 reload(){
  const disk=this.read('library-removals.json',{}),changed=Object.keys(disk).some(key=>!Object.hasOwn(this.entries,key));
  this.entries={...disk,...this.entries};for(const id of this.read('removed-track-ids.json',[]))this.ids.add(String(id));return changed;
 }
 blocked(track){return !!track&&Object.hasOwn(this.entries,Model.trackKey(track));}
 filter(tracks){return tracks.filter(t=>!this.blocked(t));}
 collections(entities){
  const out=Object.create(null);
  for(const[key,v]of Object.entries(entities)){
   if(v.kind==='playlist')out[key]={...v,tracks:this.filter(v.tracks)};
   else if(!this.blocked(v.track))out[key]=v;
  }return out;
 }
 merge(entries){
  this.reload();
  if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).length>12000)throw Error('Invalid removal ledger');
  // Validate the complete request before persisting any of it.
  for(const[key,t]of Object.entries(entries)){
   Model.validate({item:{kind:'excluded',track:t}});
   if(key!==Model.trackKey(t))throw Error('Invalid removed recording identity');
  }
  const added=Object.entries(entries).filter(([key])=>!Object.hasOwn(this.entries,key));
  const next={...this.entries,...Object.fromEntries(added)};
  this.write('library-removals.json',next);this.entries=next;this.purge();return this.entries;
 }
 remove(track){return this.merge({[Model.trackKey(track)]:Model.pack(track)});}
 stats(stats){
  const removed=new Set((stats.plays||[]).filter(p=>this.ids.has(String(p.track))).map(p=>p.id));
  return {...stats,plays:(stats.plays||[]).filter(p=>!this.ids.has(String(p.track))),slices:(stats.slices||[]).filter(s=>!removed.has(s.play))};
 }
 purge(){
  const library=this.read('library.json',{tracks:[]}),removed=library.tracks.filter(t=>this.blocked(t));
  for(const t of removed)this.ids.add(String(t.id));
  // IDs must survive a crash between removing library rows and late play updates.
  this.write('removed-track-ids.json',[...this.ids]);
  this.write('library.json',{...library,tracks:this.filter(library.tracks)});
  this.write('stats.json',this.stats(this.read('stats.json',{plays:[],slices:[]})));
  const pending=this.read('sync-pending.json',{favorites:[],plays:[]});
  this.write('sync-pending.json',{favorites:pending.favorites.filter(p=>!this.ids.has(String(p.trackId))),plays:pending.plays.filter(p=>!this.ids.has(String(p.track)))});
  const playlists=this.read('playlists.json',[]).map(p=>({...p,trackIds:(p.trackIds||[]).filter(id=>!this.ids.has(String(id))),
   ...(p.companionTracks?{companionTracks:this.filter(p.companionTracks)}:{}),...(p.sharedTracks?{sharedTracks:this.filter(p.sharedTracks)}:{})}));
  this.write('playlists.json',playlists);
  this.write('pending-uploads.json',this.read('pending-uploads.json',[]).filter(p=>!this.ids.has(String(p.trackId||p.id))));
  this.write('companion-retained.json',this.collections(this.read('companion-retained.json',{})));
  this.write('excluded-tracks.json',this.read('excluded-tracks.json',[]).filter(id=>!this.ids.has(String(id))));
  for(const name of ['favorite-moments.json'])this.write(name,Object.fromEntries(Object.entries(this.read(name,{})).filter(([id])=>!this.ids.has(id))));
  // Delete only PAIN-managed copies. User-selected source files stay untouched.
  for(const t of removed){
   const safeId=String(t.id).replace(/[/\\?%*:|"<>]/g,'_');
   for(const suffix of ['.mp3','.tmp'])this.unlink(path.join(this.dir,'..','cache',safeId+suffix));
   if(t.path){const root=path.resolve(this.dir,'..','downloads'),file=path.resolve(root,t.path),relative=path.relative(root,file);
    if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&!library.tracks.some(other=>!this.blocked(other)&&other.path===t.path))this.unlink(file);
   }
   this.unlink(path.join(this.dir,'lyrics',crypto.createHash('sha256').update(String(t.id)).digest('hex')+'.json'));
  }
  return removed.map(t=>String(t.id));
 }
 unlink(file){try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT'&&e.code!=='EBUSY'&&e.code!=='EPERM')throw e;}}
};

// A replayed or older snapshot must not erase coverage or count one play twice.
module.exports=function mergeStats(local={},incoming={}){
 const rows=value=>Array.isArray(value)?value:[];
 const plays=require('./listening-records').canonical([...rows(local.plays),...rows(incoming.plays)].filter(p=>p&&typeof p.track==='string'&&p.track&&p.id));
 const aliases=new Map();for(const p of plays)for(const id of p.aliases)aliases.set(id,p.id);
 const slices=new Map();
 for(const s of [...rows(local.slices),...rows(incoming.slices)]){
  if(!s||!s.play||!Number.isFinite(s.at)||!Number.isFinite(s.ms)||s.ms<=0)continue;
  const play=aliases.get(String(s.play))||s.play;
  // SQLite row IDs belong to one device, not the merged history.
  slices.set(JSON.stringify([play,s.at,s.ms]),{...s,play});
 }
 return {...local,...incoming,plays,slices:[...slices.values()]};
};

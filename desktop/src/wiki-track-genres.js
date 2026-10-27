'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),match=require('./cover-matching');
const {normalize}=require('./genre-profile-model');
const field=(text,name)=>String(text).match(new RegExp('\\|\\s*(?:'+name+')\\s*=([^]*?)(?=\\n\\s*\\|[^\\n=]+?=|\\n\\}\\})','i'))?.[1]||'';
function parse(text,track,kind='track'){
 const type=kind==='album'?'album|альбом':'song|single|песня|сингл|музыкальный сингл';
 if(!new RegExp('\\{\\{\\s*(?:infobox\\s+)?(?:'+type+')(?:\\s|\\n|\\|)','i').test(text))return [];
 const owner=field(text,'artist|исполнитель|исполнители');
 const credited=[...owner.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)].flatMap(m=>[m[1],m[2]].filter(Boolean));
 credited.push(...match.artists(owner.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,'$2').replace(/\[\[|\]\]/g,'')));
 const identities=new Set(credited.map(s=>match.norm(s.replace(/\s*\([^)]*\)$/,''))));
 if(!match.artists(track.artist).some(a=>identities.has(match.norm(a))))return [];
 const value=field(text,'genre|жанр|жанры').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^/]*\/>/gi,'');
 const links=[...value.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(m=>m[1]);
 return normalize(links.length?links:value.replace(/\{\{[^|{}]+\|/g,'').replace(/[{}*]/g,'').split(/\||\n|<br\s*\/?>/i));
}
const key=(t,kind='track')=>JSON.stringify([kind,match.norm(t.artist),match.norm(kind==='album'?t.album:match.title(t.title))]);
module.exports=function createWikiGenres(dir,{fetcher=fetch}={}){
 const file=path.join(dir,'wiki-track-genres.json'),request=require('./source-fetch')({fetcher});let saved={},revision=0,tail=Promise.resolve();
 const ready=fs.readFile(file,'utf8').then(JSON.parse).then(data=>{saved=data;}).catch(()=>{});
 const get=t=>saved[key(t)]?.names?.length?{...saved[key(t)],scope:t.rawTitle&&match.norm(t.rawTitle)!==match.norm(t.title)?'original':'recording'}:saved[key(t,'album')]?.names?.length?saved[key(t,'album')]:null;
 const persist=()=>{tail=tail.catch(()=>{}).then(async()=>{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(saved));await fs.rename(file+'.tmp',file);});return tail;};
 async function warm(tracks,{signal}={}){
  await ready;const requests=new Map();
  for(const t of tracks)for(const kind of ['track','album']){
   const title=kind==='album'?t.album:match.title(t.title);if(!title||match.unknown(title))continue;
   const k=key(t,kind);if(saved[k]&&Date.now()-saved[k].at<(saved[k].names.length?30:1)*86400000)continue;
   requests.set(k,{...t,kind,lookup:title,key:k});
  }
  for(const lang of ['ru','en']){
   const wanted=[...requests.values()].filter(t=>!saved[t.key]?.names.length);
   const titles=[...new Set(wanted.map(t=>t.lookup))];
   for(let i=0;i<titles.length;i+=50){
    signal?.throwIfAborted();const batch=titles.slice(i,i+50);
    const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',titles:batch.join('|'),redirects:'1',prop:'revisions',rvprop:'content',rvslots:'main',rvsection:'0'});
    try{
     const response=await request(`https://${lang}.wikipedia.org/w/api.php?${params}`,{headers:{'User-Agent':'PAIN/1.8 (local music library; https://github.com/vansGAMee/pain)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
     if(!response.ok)break;const data=await response.json();if(data.error)break;
     const aliases=new Map([...(data.query?.normalized||[]),...(data.query?.redirects||[])].map(x=>[x.from,x.to]));
     for(const item of wanted.filter(t=>batch.includes(t.lookup))){
      let title=item.lookup;const seen=new Set();while(aliases.has(title)&&!seen.has(title)){seen.add(title);title=aliases.get(title);}
      const page=(data.query?.pages||[]).find(p=>match.norm(p.title)===match.norm(title));
      const names=parse(page?.revisions?.[0]?.slots?.main?.content||'',item,item.kind);
      if(names.length){saved[item.key]={names,scope:item.kind==='album'?'album':'recording',source:`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`,at:Date.now()};revision++;}
      else if(lang==='en')saved[item.key]={names:[],at:Date.now()};
     }
     await persist();
    }catch(error){if(signal?.aborted)throw error;break;}
   }
  }
  return revision;
 }
 return {ready,get,warm,revision:()=>revision};
};
module.exports.parse=parse;

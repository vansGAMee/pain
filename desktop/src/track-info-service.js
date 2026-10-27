// Public context and cached local facts, fetched only for the open track panel.
// API: https://www.mediawiki.org/wiki/Extension:TextExtracts#API
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const matching=require('./cover-matching');
const music=/music|singer|rapper|band|song|album|composer|musician|групп|музык|пев|рэп|альбом|песн|композитор|исполнител/i;
function stories(extract,topic){
 const parts=String(extract||'').split(/^={2,}\s*(.*?)\s*={2,}\s*$/m),result=[];
 for(let i=1;i<parts.length-1;i+=2){
  const relevant=topic&&normalize(parts[i+1]).includes(normalize(topic));
  if(!relevant&&!/background|composition|writing|recording|inspiration|meaning|lyrics|music video|history|career|musical style|истори|карьер|создан|смысл|запис|предыст|содерж|композици|звучани|музыкальн.*стиль/i.test(parts[i]))continue;
  if(/discography|track listing|references|дискограф|список композиц|примечан/i.test(parts[i]))continue;
  const paragraphs=parts[i+1].split('\n').map(s=>s.trim()).filter(s=>s.length>100);
  if(!paragraphs.length)continue;
  if(relevant)paragraphs.sort((a,b)=>Number(normalize(b).includes(normalize(topic)))-Number(normalize(a).includes(normalize(topic))));
  let text='';for(const p of paragraphs){if(text.length+p.length>1800)break;text+=(text?'\n\n':'')+p;}
  if(!text)continue;
  const item={heading:parts[i],text};if(relevant)result.unshift(item);else result.push(item);
 }
 return result.slice(0,2);
}
const names=matching.artists;
function matches(page,name,artist,loose=false){
 if(!page?.extract||page.pageprops?.disambiguation!==undefined||!music.test(page.extract))return false;
 const title=normalize(page.title.replace(/\s*\([^)]*\)\s*$/,'')),expected=normalize(name);
 const filenameParts=String(name).replace(/\.(mp3|flac|m4a|wav|ogg)$/i,'').split(/_|\s[-—]\s/).map(normalize);
 if(title!==expected&&!(loose&&filenameParts.includes(title)))return false;
 return !artist||names(artist).some(a=>normalize(page.extract).includes(normalize(a)));
}
module.exports=function createInfoService(dir,{fetcher=fetch,localMedia,catalog,getTracks=()=>[]}={}){
 const pending=new Map();
 const request=require('./source-fetch')({fetcher});
 async function article(name,artist,lang,loose=false,signal){
  if(!name)return null;
  const key=createHash('sha256').update(JSON.stringify([5,name,artist,lang,loose])).digest('hex'),file=path.join(dir,'track-info',key+'.json');
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   let cached;
   try{cached=JSON.parse(await fs.readFile(file,'utf8'));if(Date.now()-cached.at<7*86400000)return cached.value;}catch(_){}
   try{
    const queryName=loose?name.replace(/\.(mp3|flac|m4a|wav|ogg)$/i,'').replace(/_/g,' '):name;
    const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:[queryName,artist].filter(Boolean).join(' '),gsrlimit:'3',
     prop:'extracts|info|pageprops',exintro:'1',explaintext:'1',exchars:'1200',exlimit:'3',inprop:'url'});
    const response=await request(`https://${lang}.wikipedia.org/w/api.php?${params}`,{headers:{'User-Agent':'PAIN/1.0 (local music player; https://github.com/vansGAMee/pain)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('Wikipedia '+response.status);
    const data=await response.json();if(data.error)throw new Error(data.error.info);
    const page=(data.query?.pages||[]).find(p=>matches(p,name,artist,loose));
    const value=page?{title:page.title,text:page.extract,url:page.fullurl,language:lang,stories:[]}:null;
    if(page?.pageid){
     try{
      const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',pageids:String(page.pageid),prop:'extracts',explaintext:'1'});
      const full=await request(`https://${lang}.wikipedia.org/w/api.php?${params}`,{headers:{'User-Agent':'PAIN/1.0 (https://github.com/vansGAMee/pain)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(6000)]):AbortSignal.timeout(6000)});
      if(full.ok){value.fullText=String((await full.json()).query?.pages?.[0]?.extract||'').slice(0,60000);value.stories=stories(value.fullText);}
     }catch(_){} // The verified introduction remains useful if a section times out.
    }
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,JSON.stringify({at:Date.now(),value})).catch(()=>{});
    return value;
   }catch(error){if(cached?.value)return {...cached.value,offline:true};throw error;}
  })().finally(()=>pending.delete(key));pending.set(key,job);return job;
 }
 async function lookup(name,artist,lang,loose=false,signal){
  const primary=/\p{Script=Cyrillic}/u.test(name||'')?'ru':lang;
  let found,failed;
  try{found=await article(name,artist,primary,loose,signal);}catch(error){failed=error;}
  signal?.throwIfAborted();
  if(found)return found;
  try{return await article(name,artist,primary==='ru'?'en':'ru',loose,signal);}catch(error){throw failed||error;}
 }
 async function info(input,lang='ru',{signal}={}){
  const local=localMedia?await localMedia.read(input):{track:input};
  let track=local.track;
  const identity=matching.metadata(track);
  if(identity)track={...track,...identity};
  const recordJob=catalog?catalog.lookup(local.track,{signal}):Promise.resolve(null);
  const artist=String(track.artist||'').trim(),missingArtist=matching.unknown(artist);
  const search=async(name,who,loose=false)=>{
   const article=await lookup(name,who,lang,loose,signal);
   if(!article)return null;
   const {fullText,...result}=article;
   return {...result,stories:fullText?stories(fullText,matching.title(track.title)):result.stories};
  };
  if(missingArtist){
   const record=await recordJob;
   try{const found=await search(track.title||track.filename||track.name,null,true);return {articles:found?[{...found,kind:'possible-track'}]:[],missingArtist:true,catalog:record};}
   catch(_){return {articles:[],missingArtist:true,unavailable:true,catalog:record};}
  }
  const artistInfo=async()=>{
   const whole=await search(artist,null).catch(()=>null);
   if(whole)return [{...whole,kind:'artist'}];
   const found=[];
   for(const name of names(artist).slice(0,3)){
    signal?.throwIfAborted();
    if(name===artist)continue;
    const value=await search(name,null).catch(()=>null);
    if(value&&!found.some(a=>a.url===value.url))found.push({...value,kind:'artist'});
   }
   return found;
  };
  const results=await Promise.allSettled([artistInfo(),search(matching.title(track.title),artist).then(async value=>
   value?{...value,kind:'track'}:track.album?search(track.album,artist).then(a=>a&&({...a,kind:'album'})):null)]);
  const articles=results[0].status==='fulfilled'?results[0].value:[];
  if(results[1].status==='fulfilled'&&results[1].value)articles.unshift(results[1].value);
  return {articles,catalog:await recordJob,unavailable:results.some(r=>r.status==='rejected')};
 }
 info.local=async(track,lang='ru')=>{
  const [stats,moments,media]=await Promise.all([
   fs.readFile(path.join(dir,'stats.json'),'utf8').then(JSON.parse).catch(()=>({plays:[],slices:[]})),
   fs.readFile(path.join(dir,'favorite-moments.json'),'utf8').then(JSON.parse).catch(()=>({})),
   localMedia?localMedia.read(track):Promise.resolve({track})
  ]);
  const plays=(stats.plays||[]).filter(p=>p&&String(p.track)===String(track.id));
  const details=require('./listening-insights').build([track],{plays,slices:stats.slices});
  return {cards:require('./track-context').build(media.track,getTracks(),details,lang),metadata:media.metadata||{},audio:media.audio||null,plays:details.behavior.qualified,heard:details.totalMs,first:details.plays[0]?.started||null,
   last:details.plays.at(-1)?.started||null,moment:moments[String(track.id)]??null};
 };
 return info;
};
module.exports.matches=matches;
module.exports.stories=stories;

// Public encyclopedic context, fetched only when the listener opens the panel.
// API: https://www.mediawiki.org/wiki/Extension:TextExtracts#API
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const normalize=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const music=/music|singer|rapper|band|song|album|composer|musician|групп|музык|пев|рэп|альбом|песн|композитор|исполнител/i;
function stories(extract){
 const parts=String(extract||'').split(/^={2,}\s*(.*?)\s*={2,}\s*$/m),result=[];
 for(let i=1;i<parts.length-1;i+=2){
  if(!/background|composition|writing|recording|inspiration|meaning|lyrics|music video|history|истори|создан|смысл|запис|предыст|содерж|композици|звучани|музыкальн.*стиль/i.test(parts[i]))continue;
  const paragraphs=parts[i+1].split('\n').map(s=>s.trim()).filter(s=>s.length>100);
  if(!paragraphs.length)continue;
  let text='';for(const p of paragraphs){if(text.length+p.length>1800)break;text+=(text?'\n\n':'')+p;}
  if(!text)continue;
  result.push({heading:parts[i],text});if(result.length===2)break;
 }
 return result;
}
const names=value=>String(value||'').split(/[,;]|\s+(?:feat\.?|ft\.?)\s+/i).map(s=>s.trim()).filter(Boolean);
function matches(page,name,artist,loose=false){
 if(!page?.extract||page.pageprops?.disambiguation!==undefined||!music.test(page.extract))return false;
 const title=normalize(page.title.replace(/\s*\([^)]*\)\s*$/,'')),expected=normalize(name);
 const filenameParts=String(name).replace(/\.(mp3|flac|m4a|wav|ogg)$/i,'').split(/_|\s[-—]\s/).map(normalize);
 if(title!==expected&&!(loose&&filenameParts.includes(title)))return false;
 return !artist||names(artist).some(a=>normalize(page.extract).includes(normalize(a)));
}
module.exports=function createInfoService(dir,{fetcher=fetch}={}){
 const pending=new Map();
 async function article(name,artist,lang,loose=false){
  if(!name)return null;
  const key=createHash('sha256').update(JSON.stringify([3,name,artist,lang,loose])).digest('hex'),file=path.join(dir,'track-info',key+'.json');
  if(pending.has(key))return pending.get(key);
  const job=(async()=>{
   let cached;
   try{cached=JSON.parse(await fs.readFile(file,'utf8'));if(Date.now()-cached.at<7*86400000)return cached.value;}catch(_){}
   try{
    const queryName=loose?name.replace(/\.(mp3|flac|m4a|wav|ogg)$/i,'').replace(/_/g,' '):name;
    const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:[queryName,artist].filter(Boolean).join(' '),gsrlimit:'3',
     prop:'extracts|info|pageprops',exintro:'1',explaintext:'1',exchars:'1200',exlimit:'3',inprop:'url'});
    const response=await fetcher(`https://${lang}.wikipedia.org/w/api.php?${params}`,{headers:{'User-Agent':'PAIN/1.0 (local music player; https://github.com/vansGAMee/pain)'},signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('Wikipedia '+response.status);
    const data=await response.json();if(data.error)throw new Error(data.error.info);
    const page=(data.query?.pages||[]).find(p=>matches(p,name,artist,loose));
    const value=page?{title:page.title,text:page.extract,url:page.fullurl,language:lang,stories:[]}:null;
    if(page?.pageid){
     try{
      const params=new URLSearchParams({action:'query',format:'json',formatversion:'2',pageids:String(page.pageid),prop:'extracts',explaintext:'1'});
      const full=await fetcher(`https://${lang}.wikipedia.org/w/api.php?${params}`,{headers:{'User-Agent':'PAIN/1.0 (https://github.com/vansGAMee/pain)'},signal:AbortSignal.timeout(6000)});
      if(full.ok)value.stories=stories((await full.json()).query?.pages?.[0]?.extract);
     }catch(_){} // The verified introduction remains useful if a section times out.
    }
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,JSON.stringify({at:Date.now(),value})).catch(()=>{});
    return value;
   }catch(error){if(cached?.value)return {...cached.value,offline:true};throw error;}
  })().finally(()=>pending.delete(key));pending.set(key,job);return job;
 }
 async function lookup(name,artist,lang,loose=false){
  const primary=/\p{Script=Cyrillic}/u.test(name||'')?'ru':lang;
  const found=await article(name,artist,primary,loose);
  return found||article(name,artist,primary==='ru'?'en':'ru',loose);
 }
 async function info(track,lang='ru'){
  const artist=String(track.artist||'').trim();
  const missingArtist=!artist||/^(unknown(?: artist)?|неизвестный исполнитель|<unknown>)$/i.test(artist);
  if(missingArtist){
   try{const found=await lookup(track.title||track.filename||track.name,null,lang,true);return {articles:found?[{...found,kind:'possible-track'}]:[],missingArtist:true};}
   catch(_){return {articles:[],missingArtist:true,unavailable:true};}
  }
  const results=await Promise.allSettled([lookup(artist,null,lang).then(a=>a||(names(artist).length>1?lookup(names(artist)[0],null,lang):null)),lookup(track.title,artist,lang).then(async value=>
   value?{...value,kind:'track'}:track.album?lookup(track.album,artist,lang).then(a=>a&&({...a,kind:'album'})):null)]);
  const articles=[];
  if(results[0].status==='fulfilled'&&results[0].value)articles.push({...results[0].value,kind:'artist'});
  if(results[1].status==='fulfilled'&&results[1].value)articles.unshift(results[1].value);
  return {articles,unavailable:results.some(r=>r.status==='rejected')};
 }
 info.local=async track=>{
  const [stats,moments]=await Promise.all([
   fs.readFile(path.join(dir,'stats.json'),'utf8').then(JSON.parse).catch(()=>({plays:[],slices:[]})),
   fs.readFile(path.join(dir,'favorite-moments.json'),'utf8').then(JSON.parse).catch(()=>({}))
  ]);
  const plays=(stats.plays||[]).filter(p=>p&&String(p.track)===String(track.id));
  const details=require('./listening-insights').build([track],{plays,slices:stats.slices});
  return {plays:details.behavior.qualified,heard:details.totalMs,first:details.plays[0]?.started||null,
   last:details.plays.at(-1)?.started||null,moment:moments[String(track.id)]??null};
 };
 return info;
};
module.exports.matches=matches;
module.exports.stories=stories;

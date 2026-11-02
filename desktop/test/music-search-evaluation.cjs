// Deterministic metadata stress test, not an estimate of subjective/semantic relevance.
// Reads library/cache only; its report is written outside the data directory.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),data=process.env.PAIN_EVAL_DATA_DIR||path.join(root,'data'),text=require(root+'/src/music-search'),{Index}=require(root+'/src/music-search-index');
(async()=>{
 const raw=await fs.readFile(path.join(data,'library.json')),lib=JSON.parse(raw),start=performance.now(),index=new Index(lib.tracks),build=performance.now()-start;
 const genre=JSON.parse(await fs.readFile(path.join(data,'genres.json')));index.updateExtras(Object.entries(genre).map(([id,row])=>({id,genres:row.names||[]})));
 const {read,key}=require(root+'/src/lyrics-search');let lyricCount=0;
 for(const t of lib.tracks){const id=String(t.id),sig=JSON.stringify([t.title,t.artist,t.album,t.duration]);const doc=await read(path.join(data,'lyrics',key(id)+'.json'))||await read(path.join(data,'lyrics-online',key(id+sig)+'.json'));if(doc?.lines?.length){index.updateExtras([{id,lyrics:doc.lines.map(l=>l.text).join('\n')}]);lyricCount++;}}
 const sample=[...lib.tracks].sort((a,b)=>crypto.createHash('sha256').update(String(a.id)).digest('hex').localeCompare(crypto.createHash('sha256').update(String(b.id)).digest('hex'))).slice(0,100);
 const groups={},failures=[],times=[];
 for(const t of sample){let title=text.normalize(text.clean(t.title));const words=title.split(' '),pos=words.findIndex(w=>w.length>=4);
  const variants={exact:title,reordered:words.slice().reverse().join(' '),layout:text.swapLayout(title),translit:text.romanize(title),spacing:words.join('')};
  if(pos>=0){let w=[...words[pos]],i=Math.floor(w.length/2)-1;
   const swap=[...w];[swap[i],swap[i+1]]=[swap[i+1],swap[i]];variants.transposition=words.map((word,j)=>j===pos?swap.join(''):word).join(' ');
   variants.deletion=words.map((word,j)=>j===pos?w.filter((_,j)=>j!==i).join(''):word).join(' ');
  }
  for(const [kind,q]of Object.entries(variants)){if(!q)continue;const before=performance.now(),hits=index.search(q),ms=performance.now()-before;times.push(ms);
   const normalizedIdentity=x=>text.normalize(text.clean(x.title))===title&&text.same(x.artist,t.artist);
   const acceptable=new Set(lib.tracks.filter(normalizedIdentity).map(x=>String(x.id)));acceptable.add(String(t.id));
   const rank=hits.findIndex(h=>acceptable.has(h.id));const g=groups[kind]||={total:0,top1:0,top5:0,found:0};g.total++;if(rank===0)g.top1++;if(rank>=0&&rank<5)g.top5++;if(rank>=0)g.found++;
   if(rank<0||rank>=5)failures.push({kind,query:q,title:t.title,artist:t.artist,rank,top:hits.slice(0,3).map(h=>({title:h.title,artist:h.artist}))});
  }
 }
 times.sort((a,b)=>a-b);const result={tracks:lib.tracks.length,lyricCount,sample:sample.length,buildMs:build,latencyMs:{median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)},groups,failures,libraryUnchanged:crypto.createHash('sha256').update(raw).digest('hex')===crypto.createHash('sha256').update(await fs.readFile(path.join(data,'library.json'))).digest('hex')};
 await fs.writeFile(process.env.PAIN_SEARCH_REPORT||path.join(require('node:os').tmpdir(),'pain-search-evaluation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,failures:failures.slice(0,12)}));
})().catch(e=>{console.error(e);process.exitCode=1});

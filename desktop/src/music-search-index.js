/* Local full-text retrieval. MiniSearch supplies its unmodified BM25+ defaults;
 * edit tolerance follows Lucene AUTO, with OSA validation for adjacent swaps.
 * No feedback, playback, recommendation, or file-tag writes belong here. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./music-search'),require('./vendor/minisearch'),require('./vendor/double-metaphone'));
  else root.MusicSearchIndex=factory(root.MusicSearch,root.MiniSearch,root.PainPhonetics);
})(globalThis,(text,MiniSearch,phonetics)=>{
  'use strict';
  const fields=['title','artist','album','genre','lyrics'];
  const aliases={title:'title',track:'title',название:'title',трек:'title',artist:'artist',исполнитель:'artist',артист:'artist',album:'album',альбом:'album',genre:'genre',жанр:'genre',lyrics:'lyrics',текст:'lyrics'};
  const genreTranslations={rock:'рок',pop:'поп',phonk:'фонк',jazz:'джаз',classical:'классика классическая',electronic:'электроника электронная',metal:'метал металл',rap:'рэп реп',hiphop:'хипхоп',ambient:'эмбиент эмбиэнт',shoegaze:'шугейз шугейзинг',alternative:'альтернатива альтернативный',indie:'инди',punk:'панк',postpunk:'постпанк',folk:'фолк',dance:'танцевальная танцевальный',blues:'блюз',soul:'соул',funk:'фанк',house:'хаус',techno:'техно',trance:'транс',dubstep:'дабстеп',disco:'диско',reggae:'регги',soundtrack:'саундтрек',instrumental:'инструментальная инструментальный',lofi:'лофай'};
  const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'word'}):null;
  const contractionTokens=value=>{
    const words=[];for(const match of String(value||'').matchAll(/[\p{L}\p{N}]+['’ʼ][\p{L}\p{N}]+/gu))words.push(...text.normalize(match[0]).split(' '));return words;
  };
  const tokens=value=>{
    const normalized=text.normalize(String(value||'').replace(/['’ʼ]/g,''),200000);
    return segmenter&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(normalized)
      ?[...segmenter.segment(normalized)].filter(s=>s.isWordLike).map(s=>s.segment):normalized.split(' ').filter(Boolean);
  };
  const key=value=>text.romanize(value.replace(/['’ʼ]/g,''),200000);
  const compact=value=>key(value).replace(/ /g,'');
  const soundCache=new Map();
  function sounds(word){
    if(!/^[a-z]+$/.test(word))return [];
    if(soundCache.has(word))return soundCache.get(word);
    const result=[...new Set(phonetics.doubleMetaphone(word))].filter(Boolean);
    if(soundCache.size>=20000)soundCache.delete(soundCache.keys().next().value);soundCache.set(word,result);return result;
  }
  function genreText(value){
    const names=(Array.isArray(value)?value:typeof value==='string'?value.split(/[;,/]/):[]).filter(v=>typeof v==='string');
    return names.map(name=>{
      const words=tokens(name),extra=words.map(w=>genreTranslations[compact(w)]||'');
      const whole=genreTranslations[compact(name)];return [name,...extra,whole||''].join(' ');
    }).join(' ');
  }
  function parse(value){
    let source=String(value||'').slice(0,512),defaultField=null;
    const lyricFrame=/^(?:(?:найди|найти|покажи|ищу|find|search)\s+)?(?:(?:ту|та|эта|эту|the|that)\s+)?(?:песн[яю]|трек|song|track)\s+(?:со словами|в которой поют|где(?:\s+поют)?|with (?:the )?(?:words|lyrics)|that goes)\s+/i;
    if(lyricFrame.test(source)){source=source.replace(lyricFrame,'');defaultField='lyrics';}
    const terms=[],exclude=[],phrases=[];
    const re=/(?:(title|track|название|трек|artist|исполнитель|артист|album|альбом|genre|жанр|lyrics|текст):)?(-?)(?:"([^"]*)"|([^\s"]+))/giu;
    for(const m of source.matchAll(re)){
      const field=m[1]?aliases[m[1].toLowerCase()]:defaultField,words=tokens(m[3]??m[4]);
      if(!words.length)continue;
      if(m[2]){exclude.push({field,value:key(words.join(' '))});continue;}
      if(m[3]!==undefined)phrases.push({field,value:key(words.join(' '))});
      for(const word of words){if(terms.length===24)break;terms.push({word,field,quoted:m[3]!==undefined});}
      if(terms.length===24)break;
    }
    return {terms,exclude,phrases,value:key(terms.map(t=>t.word).join(' '))};
  }
  function forms(word){
    const direct=key(word),swapped=key(text.swapLayout(word));
    return [...new Set([direct,swapped,direct.replace(/(.)\1+/gu,'$1'),swapped.replace(/(.)\1+/gu,'$1')])].filter(Boolean);
  }
  function matchWord(term,word,phonetic=true){
    const cacheKey=(phonetic?'1':'0')+word;
    if(term.matches?.has(cacheKey))return term.matches.get(cacheKey);
    const choices=term.variants||forms(term.word);let best=null;
    for(let variant=0;variant<choices.length;variant++){
      const q=choices[variant],limit=term.quoted?0:text.edits(q);
      let cost=q===word?0:!term.quoted&&word.startsWith(q)?0:text.distance(q,word,limit);
      // Prefix completion with a typo (e.g. "radiho" -> "radiohead").
      if(!term.quoted&&limit&&word.length>q.length){
        for(let n=Math.max(1,q.length-limit);n<=Math.min(word.length,q.length+limit);n++)cost=Math.min(cost,text.distance(q,word.slice(0,n),limit));
      }
      if(cost<=limit&&(!best||cost<best.cost||cost===best.cost&&variant<best.variant))best={cost,variant};
      if(!term.quoted&&text.translitKey(q)===text.translitKey(word)&&!best)best={cost:0,variant:2};
    }
    if(!best&&phonetic&&term.phonetic&&!term.quoted&&choices.some(q=>sounds(q).some(code=>sounds(word).includes(code))))best={cost:0,variant:4};
    term.matches?.set(cacheKey,best);return best;
  }
  // A maximum bipartite matching prevents one word from satisfying every query
  // word. Augmenting paths avoid the old greedy, order-dependent assignment.
  function assess(doc,query,allowed){
    const words=doc.words.filter(w=>allowed.includes(w.field));
    const edges=query.terms.map(term=>words.flatMap((word,i)=>{
      if(term.field&&word.field!==term.field)return [];
      const match=matchWord(term,word.word,!['genre','album'].includes(word.field));return match?[{i,...match}]:[];
    }).sort((a,b)=>a.cost-b.cost||a.variant-b.variant));
    if(edges.some(e=>!e.length))return null;
    const owner=new Map(),assigned=new Map();
    function visit(i,seen){for(const edge of edges[i]){
      if(seen.has(edge.i))continue;seen.add(edge.i);
      if(!owner.has(edge.i)||visit(owner.get(edge.i),seen)){owner.set(edge.i,i);assigned.set(i,edge);return true;}
    }return false;}
    const order=edges.map((e,i)=>i).sort((a,b)=>edges[a].length-edges[b].length);
    if(!order.every(i=>visit(i,new Set())))return null;
    let edits=0,variant=0;for(const e of assigned.values()){edits+=e.cost;variant=Math.max(variant,e.variant);}
    return {edits,variant,fields:[...new Set([...assigned.values()].map(e=>words[e.i].field))]};
  }
  function lyricPhrase(doc,query){
    if(query.terms.some(t=>t.field&&t.field!=='lyrics'))return null;
    const words=doc.lyricWords;let best=null;
    for(let i=0;i<=words.length-query.terms.length;i++){
      let edits=0,variant=0,complete=true;
      for(let j=0;j<query.terms.length;j++){
        const match=matchWord(query.terms[j],words[i+j]);if(!match){complete=false;break;}
        edits+=match.cost;variant=Math.max(variant,match.variant);
      }
      if(complete&&(!best||variant<best.variant||variant===best.variant&&edits<best.edits))best={edits,variant,fields:['lyrics'],phrase:true};
    }
    return best;
  }
  function makeDoc(track,extra={},order=0){
    const source={title:text.clean(track.title||track.filename||''),artist:track.artist||'',album:track.album||'',genre:genreText([...(Array.isArray(track.genre)?track.genre:[track.genre]),...(extra.genres||[])]),lyrics:extra.lyrics||''};
    const normalized={},words=[];
    for(const field of fields){
      normalized[field]=tokens(source[field]).map(key).join(' ');
      // Keep just enough repeated occurrences to satisfy the longest query.
      const counts=new Map();for(const word of [...tokens(source[field]),...contractionTokens(source[field])].map(key)){
        const n=counts.get(word)||0;if(n<24)words.push({word,field});counts.set(word,n+1);
      }
    }
    const title=normalized.title,artist=normalized.artist;
    return {id:String(track.id),order,source,normalized,words,lyricWords:tokens(source.lyrics).map(key),
      compact:[title,artist,normalized.album,title+' '+artist,artist+' '+title].map(s=>s.replace(/ /g,'')),
      initials:[title,artist].map(s=>s.split(' ').map(w=>w[0]||'').join(''))};
  }
  class Index{
    constructor(tracks=[]){
      this.docs=new Map();this.extra=new Map();this.tracks=new Map();
      this.engine=new MiniSearch({fields,extractField:(doc,field)=>field==='id'?doc.id:doc.source[field],
        tokenize:value=>[...tokens(value),...contractionTokens(value)],processTerm:(term,field)=>{const raw=key(term),alias='~'+text.translitKey(raw);return [...new Set([raw,...(raw!==alias.slice(1)?[alias]:[]),...(!['genre','album'].includes(field)?sounds(raw).map(code=>'!'+code):[])])];}});
      this.completions=new MiniSearch({fields:fields.filter(f=>f!=='lyrics'),extractField:(doc,field)=>field==='id'?doc.id:doc.source[field],
        tokenize:value=>tokens(value).flatMap(word=>{const raw=key(word),parts=[raw];for(let n=3;n<Math.min(raw.length,32);n++)parts.push(raw.slice(0,n));return parts;}),processTerm:term=>term});
      this.setTracks(tracks);
    }
    setTracks(tracks){
      const retained=new Set();let order=0;
      for(const track of tracks){if(track?.id===undefined)continue;const id=String(track.id);if(retained.has(id))continue;retained.add(id);
        const stamp=JSON.stringify([track.title,track.artist,track.album,track.genre,track.filename,track.duration]);
        const previous=this.tracks.get(id);this.tracks.set(id,{track,stamp});
        if(previous?.stamp!==stamp){
          if(previous){this.engine.remove(this.docs.get(id));this.completions.remove(this.docs.get(id));this.extra.delete(id);}
          const doc=makeDoc(track,this.extra.get(id),order);this.docs.set(id,doc);this.engine.add(doc);this.completions.add(doc);
        }else this.docs.get(id).order=order;
        order++;
      }
      for(const id of this.docs.keys())if(!retained.has(id)){this.engine.remove(this.docs.get(id));this.completions.remove(this.docs.get(id));this.docs.delete(id);this.extra.delete(id);this.tracks.delete(id);}
    }
    updateExtras(rows){
      for(const row of rows){const id=String(row.id),track=this.tracks.get(id)?.track;if(!track)continue;
        const extra={...this.extra.get(id),...('lyrics'in row?{lyrics:String(row.lyrics||'').slice(0,200000)}:{}),...('genres'in row?{genres:row.genres.filter(g=>typeof g==='string')}: {})};
        if(JSON.stringify(extra)===JSON.stringify(this.extra.get(id)))continue;
        this.engine.remove(this.docs.get(id));this.completions.remove(this.docs.get(id));const doc=makeDoc(track,extra,this.docs.get(id).order);
        this.extra.set(id,extra);this.docs.set(id,doc);this.engine.add(doc);this.completions.add(doc);
      }
    }
    search(value,{lyrics=true}={}){
      const query=parse(value);if(!query.terms.length)return [];
      const wholeValues=[query.value,key(text.swapLayout(String(value||'').slice(0,512)))];
      for(const term of query.terms){term.variants=forms(term.word);term.matches=new Map();term.phonetic=query.terms.length>1||key(term.word).length>=3;}
      const searchLyrics=lyrics&&!(query.terms.length===1&&key(query.terms[0].word).length<3&&!query.terms[0].field);
      const allowed=searchLyrics?fields:fields.filter(f=>f!=='lyrics');
      const expression={combineWith:'AND',queries:query.terms.map(term=>({combineWith:'OR',queries:forms(term.word).flatMap(word=>{
        const options={fields:term.field?[term.field]:allowed,tokenize:s=>[s],processTerm:s=>s,prefix:!term.quoted};
        // MiniSearch uses Levenshtein: retrieve 2-edit neighbours for adjacent
        // transpositions, then enforce the tighter OSA/AUTO bound in assess().
        return [{...options,queries:[word],fuzzy:term.quoted||!text.edits(word)?false:Math.max(2,text.edits(word))},
          ...(!term.quoted?[{...options,queries:['~'+text.translitKey(word)],fuzzy:false},...(term.phonetic?sounds(word).map(code=>({...options,queries:['!'+code],prefix:false,fuzzy:false})):[])]:[])];
      })}))};
      const candidates=new Map(this.engine.search(expression).map(hit=>[String(hit.id),hit]));
      if(!query.phrases.length)for(const hit of this.completions.search(expression))if(!candidates.has(String(hit.id)))candidates.set(String(hit.id),{id:hit.id,score:0});
      const simple=!query.terms.some(t=>t.field||t.quoted),compactQueries=simple?[...new Set([compact(query.value),compact(text.swapLayout(String(value||'').slice(0,512)))])].filter(Boolean):[];
      // Whitespace and initials are deterministic aliases, never fabricated
      // song identities. Retain them even when normal token retrieval misses.
      const aliasKinds=new Map();
      if(simple)for(const doc of this.docs.values())for(const q of compactQueries){
        if((q.length>=3||/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(q))&&doc.compact.some(v=>v&&v.includes(q))){candidates.set(doc.id,candidates.get(doc.id)||{id:doc.id,score:0});aliasKinds.set(doc.id,'spacing');break;}
        if(q.length>=3&&doc.initials.includes(q)){candidates.set(doc.id,candidates.get(doc.id)||{id:doc.id,score:0});aliasKinds.set(doc.id,'initials');break;}
      }
      const hits=[];
      const metadataProofs=new Map();
      const singleMetadata=query.terms.length===1&&!query.terms[0].field&&[...candidates.keys()].some(id=>{
        const doc=this.docs.get(id),proof=doc&&assess(doc,query,allowed.filter(f=>f!=='lyrics'));metadataProofs.set(id,proof);return !!proof||aliasKinds.get(id)==='spacing';
      });
      for(const hit of candidates.values()){
        const doc=this.docs.get(String(hit.id));if(!doc)continue;
        const contains=(part)=> (part.field?[part.field]:allowed).some(f=>(' '+doc.normalized[f]+' ').includes(' '+part.value+' '));
        if(query.exclude.some(contains)||!query.phrases.every(contains))continue;
        let proof=metadataProofs.has(doc.id)?metadataProofs.get(doc.id):assess(doc,query,allowed.filter(f=>f!=='lyrics')),reason='metadata';
        const alias=aliasKinds.get(doc.id);
        if(alias==='spacing'&&(!proof||proof.edits||proof.variant))proof={edits:0,variant:0,fields:[]};
        if(!proof&&searchLyrics&&!singleMetadata){proof=lyricPhrase(doc,query)||assess(doc,query,allowed);reason='lyrics';}
        if(!proof&&!alias)continue;
        const exact=wholeValues.includes(doc.normalized.title)||compactQueries.includes(doc.compact[0])?0:
          wholeValues.includes(doc.normalized.artist)||compactQueries.includes(doc.compact[1])?1:
          [doc.normalized.album,doc.normalized.genre].some(v=>wholeValues.includes(v))?2:
          proof?.fields?.length===1&&proof.fields[0]==='title'&&tokens(doc.source.title).length===query.terms.length?3:
          doc.normalized.title.startsWith(query.value)?4:allowed.some(f=>doc.normalized[f].includes(query.value))?5:6;
        const phonetic=proof?.variant===4;
        const rank=[proof?reason==='lyrics'?(proof.phrase?1:3):phonetic?2:0:alias==='initials'?4:0,proof?.edits||0,proof?.variant||0,exact,alias==='initials'?1:0,-hit.score,doc.order];
        const result={id:doc.id,reason:proof?reason:alias,phonetic,rank,fields:proof?.fields||[],title:doc.source.title,artist:doc.source.artist};
        if(result.reason==='lyrics'){
          const lines=doc.source.lyrics.split(/\r?\n/).filter(Boolean);
          const ranked=lines.map((line,i)=>{
            const words=tokens(line).map(key),matches=query.terms.map(term=>words.map(word=>matchWord(term,word)).filter(Boolean).sort((a,b)=>a.cost-b.cost||a.variant-b.variant)[0]);
            return {line,rank:[-matches.filter(Boolean).length,matches.reduce((sum,m)=>sum+(m?.cost||0),0),i]};
          }).sort((a,b)=>compare(a.rank,b.rank));
          const line=lines.find(s=>key(s).includes(query.value))||ranked[0]?.line||'';
          result.snippet=line.slice(0,180);
        }
        hits.push(result);
      }
      const literal=hits.some(h=>!h.phonetic&&h.rank[0]<=1&&h.rank[1]===0&&h.rank[2]<=1);
      return hits.filter(h=>!literal||!h.phonetic).sort((a,b)=>compare(a.rank,b.rank));
    }
    get size(){return this.docs.size;}
  }
  function compare(a,b){for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;}
  let cachedTracks,cachedStamp,cachedIndex;
  function filter(tracks,value){
    if(!String(value||'').trim())return tracks.slice();
    const stamp=JSON.stringify(tracks.map(t=>[t.id,t.title,t.artist,t.album,t.genre]));
    if(tracks!==cachedTracks||stamp!==cachedStamp){cachedTracks=tracks;cachedStamp=stamp;cachedIndex=new Index(tracks);}
    const byId=new Map(tracks.map(t=>[String(t.id),t]));return cachedIndex.search(value,{lyrics:false}).map(h=>byId.get(h.id)).filter(Boolean);
  }
  return {Index,filter,parse,genreText};
});

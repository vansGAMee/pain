/* Shared text handling for search and catalogue identity. Never edits file tags. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MusicSearch = factory();
})(globalThis, () => {
  'use strict';
  const latin = ['a','b','v','g','d','e','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','ts','ch','sh','shch','','y','','e','yu','ya'];
  const cyrillic = [...'абвгдежзийклмнопрстуфхцчшщъыьэюя'];
  const translit = new Map(cyrillic.map((letter,i) => [letter,latin[i]]));
  const en = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.", ru = 'ёйцукенгшщзхъфывапролджэячсмитьбю';
  const keyboard = new Map([...en].map((c,i) => [c,ru[i]]).concat([...ru].map((c,i) => [c,en[i]])));
  const lookalikes = {а:'a',е:'e',о:'o',р:'p',с:'c',у:'y',х:'x',і:'i',ј:'j',к:'k',м:'m',т:'t',в:'b',н:'h'};
  function normalize(value,limit=2048) {
    return String(value || '').slice(0,Math.min(200000,limit)).normalize('NFKD').toLowerCase().replace(/ё/g,'е').replace(/\p{M}/gu,'')
      .replace(/[\p{L}\p{N}]+/gu, word => /[a-z]/.test(word) && /\p{Script=Cyrillic}/u.test(word) && [...word].filter(c=>/\p{Script=Cyrillic}/u.test(c)).every(c=>lookalikes[c])
        ? [...word].map(c=>lookalikes[c]||c).join('') : word)
      .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
  }
  const romanize = (value,limit=2048) => [...normalize(value,limit)].map(c=>translit.get(c)??c).join('');
  const swapLayout = value => [...String(value||'').toLowerCase()].map(c=>keyboard.get(c)||c).join('');
  // Alternate common Russian transliteration spellings. Search aliases only:
  // catalogue identity still uses the stricter same()/romanize() functions.
  const translitKey = value => romanize(value).replace(/shch|sch/g,'sh').replace(/kh/g,'h')
    .replace(/zh/g,'j').replace(/yo|jo/g,'e').replace(/yu|ju|iu/g,'u')
    .replace(/ya|ja|ia/g,'a').replace(/iy|ij|yj/g,'i').replace(/y/g,'i');
  const same = (a,b) => !!normalize(a) && (normalize(a)===normalize(b) || romanize(a)===romanize(b));
  function clean(value) {
    return String(value || '').normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g,'').replace(/_/g,' ')
      .replace(/\.(?:mp3|flac|m4a|wav|ogg|opus)$/i,'')
      .replace(/^\s*\d{1,2}[.)]\s+/,'')
      .replace(/[([][^()[\]]*(?:https?:\/\/|www\.|\.(?:ru|com|net|org|su|cc)\b)[^()[\]]*[)\]]/ig,'')
      .replace(/\s+(?:https?:\/\/|www\.)\S+$/i,'')
      .replace(/[([](?:official\s+)?(?:audio|music video|video|lyrics?|lyric video|\d{2,3}\s*kbps)[)\]]/ig,'')
      .replace(/\s+/g,' ').trim();
  }
  // Lucene/Elasticsearch AUTO: 0 edits for 0–2 chars, 1 for 3–5, 2 for 6+.
  // Optimal string alignment includes adjacent transpositions, with an early bound.
  const edits = word => [...word].length < 3 ? 0 : [...word].length < 6 ? 1 : 2;
  function distance(a,b,max=2) {
    if(a===b)return 0;
    a=[...a];b=[...b];if(Math.abs(a.length-b.length)>max)return max+1;
    let previous=Array.from({length:b.length+1},(_,i)=>i),before;
    for(let i=1;i<=a.length;i++){
      const row=[i];let minimum=i;
      for(let j=1;j<=b.length;j++){
        row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+Number(a[i-1]!==b[j-1]));
        if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],before[j-2]+1);
        minimum=Math.min(minimum,row[j]);
      }
      if(minimum>max)return max+1;
      before=previous;previous=row;
    }
    return previous[b.length];
  }
  function tokenDistance(query,words,prefix=false) {
    const used=new Set();let total=0;
    for(const token of query){
      let best=-1,cost=Infinity;const limit=edits(token);
      for(let i=0;i<words.length;i++){
        if(used.has(i))continue;
        const d=token===words[i]||prefix&&words[i].startsWith(token)?0:distance(token,words[i],limit);
        if(d<=limit&&d<cost){best=i;cost=d;if(d===0)break;}
      }
      if(best<0)return Infinity;used.add(best);total+=cost;
    }
    return total;
  }
  function titleDistance(a,b) {
    const first=romanize(a).split(' ').filter(Boolean),second=romanize(b).split(' ').filter(Boolean);
    if(!first.length||first.length!==second.length)return Infinity;
    return tokenDistance(first,second);
  }
  const cache=new WeakMap();
  function indexed(track) {
    const stamp=JSON.stringify([track.title,track.artist,track.album]);let entry=cache.get(track);
    if(entry?.stamp===stamp)return entry;
    const text=normalize([track.title,track.artist,track.album].filter(Boolean).join(' '));
    entry={stamp,text,roman:romanize(text),words:text.split(' '),latinWords:romanize(text).split(' ')};
    cache.set(track,entry);return entry;
  }
  function filter(tracks,value) {
    const engine=typeof module==='object'&&module.exports?require('./music-search-index'):globalThis.MusicSearchIndex;
    if(engine)return engine.filter(tracks,value);
    const query=normalize(String(value||'').slice(0,256));if(!query)return tracks.slice();
    const swapped=normalize([...String(value).toLowerCase()].map(c=>keyboard.get(c)||c).join(''));
    const variants=[...new Set([query,swapped])].filter(Boolean).map(text=>({text,roman:romanize(text),words:text.split(' ').slice(0,16),latinWords:romanize(text).split(' ').slice(0,16)}));
    const hits=[];
    for(const [index,track] of tracks.entries()){
      const entry=indexed(track);let rank=Infinity;
      for(const q of variants){
        if(entry.text.includes(q.text)||entry.roman.includes(q.roman)){rank=0;break;}
        const d=Math.min(tokenDistance(q.words,entry.words,true),tokenDistance(q.latinWords,entry.latinWords,true));
        if(Number.isFinite(d))rank=Math.min(rank,1+d);
      }
      if(Number.isFinite(rank))hits.push({track,rank,index});
    }
    return hits.sort((a,b)=>a.rank-b.rank||a.index-b.index).map(hit=>hit.track);
  }
  return {normalize,romanize,same,clean,distance,titleDistance,filter,swapLayout,translitKey,edits};
});

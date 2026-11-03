/* Local, descriptive Home copy. No network, model, timers, or history rescans.
 * Only existing HomeModel summaries are read. Novelty uses a fixed 128 KiB
 * Bloom filter: collisions reject a NEW sentence, never admit an old one.
 * Its small shards avoid rewriting the whole record on each visit. Storage
 * belongs only to this line; unavailable storage still works for this session.
 * A finite vocabulary cannot promise eternal uniqueness. After bounded attempts
 * in an exhausted pool, prefer the least recently displayed candidate; never
 * invent personal facts, counters, timestamps or invisible text for variety.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./home-message-copy'));
  else root.HomeMessages=factory(root.HomeMessageCopy);
})(globalThis,Copy=>{
  'use strict';
  const KEY='pain_home_messages_v1:',PAGE_BYTES=256,PAGES=512,BITS=PAGE_BYTES*PAGES*8;
  const MAX_CARDS=64,MAX_LENGTH=100,RECENT=24;
  const count=value=>Math.min(1e9,Math.max(0,Math.floor(Number(value)||0)));
  const plural=(n,one,few,many)=>`${n} ${n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many}`;
  const days=n=>plural(n,'день','дня','дней');
  const tracks=n=>plural(n,'трек','трека','треков');
  const dayGen=n=>plural(n,'дня','дней','дней');
  const trackGen=n=>plural(n,'трека','треков','треков');
  const stamp=at=>{const d=new Date(at);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000;};
  function name(value){
    if(typeof value!=='string')return '';
    const clean=value.slice(0,256).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,'').replace(/\s+/g,' ').trim();
    // Bound UTF-16 length as well as glyphs (two emoji titles can otherwise
    // exceed the line budget). Never split a surrogate pair.
    let short='';for(const char of clean){if(short.length+char.length>55)return short+'…';short+=char;}
    return short;
  }
  function candidates(model,now=Date.now(),variation=0){
    const m=model||{},d=m.details||{},library=m.library||new Map(),cards=[];
    const total=count(library.size),heard=Math.min(total,count(d.heardLibrary));
    function add(family,values={},anchor='',weight=1){
      const copy=Copy.families[family];
      if(values.days!==undefined)values.daySpanGen=dayGen(values.days);
      if(values.count!==undefined){
        values.trackCountGen=trackGen(values.count);
        values.listenCount=plural(values.count,'прослушивание','прослушивания','прослушиваний');
        values.listenCountGen=plural(values.count,'прослушивания','прослушиваний','прослушиваний');
      }
      if(copy&&cards.length<MAX_CARDS)cards.push({family,group:copy.group,values,anchor:String(anchor),weight});
    }
    function song(family,track,values={},weight=1){
      const title=name(track?.title);if(!title||!library.has(String(track.id)))return;
      add(family,{...values,title},track.id,weight);
    }
    if(!total){add('empty',{},'',1);return cards;}
    // Keep the latest anchors, then vary four more using direct array access.
    // Longer libraries add variety without extra history work or longer copy.
    function sample(items=[]){
      if(!variation||items.length<=6)return items.slice(0,6);
      const result=items.slice(0,2),remaining=items.length-2,start=(variation>>>0)%remaining;
      for(let i=0;i<4;i++)result.push(items[2+(start+i)%remaining]);
      return result;
    }
    const recent=sample(m.recent).filter(track=>{
      const at=m.last?.get(String(track.id)),gap=Number.isFinite(at)?stamp(now)-stamp(at):Infinity;
      return gap>=0&&gap<7;
    }),fresh=sample(m.fresh),past=sample(m.past),favorites=sample(m.favorites);
    if(!heard&&!d.behavior?.qualified){
      let inspected=0;
      for(const track of library.values()){
        song('ready',track);if(++inspected===6)break;
      }
    }
    if(d.ritual){const n=count(d.ritual.days);if(n>=2&&n<=28)song('ritual',library.get(String(d.ritual.track)),{days:n,daySpan:days(n)},1.5);}
    if(d.comeback){const n=count(d.comeback.days);if(n>=7)song('comeback',library.get(String(d.comeback.track)),{days:n,daySpan:days(n)},1.6);}
    for(const track of fresh)song('fresh',track,{},1.3);
    for(const track of past){
      const at=m.last?.get(String(track.id));
      const n=Number.isFinite(at)?Math.max(0,stamp(now)-stamp(at)):0;
      if(n>=7)song('past',track,{days:n,daySpan:days(n)},1.1);
    }
    for(const track of recent){
      song('recent',track);
      const n=count(d.behavior?.counts?.[String(track.id)]);
      if(n>=3)song('repeat',track,{count:n},1.1);
    }
    for(const track of favorites){
      song('favorite',track,{},.8);
      const at=m.last?.get(String(track.id));
      const n=Number.isFinite(at)?Math.max(0,stamp(now)-stamp(at)):0;
      if(n>=7)song('favoriteReturn',track,{days:n,daySpan:days(n)},1.2);
    }
    if(recent.length>1){
      const a=recent[0],b=recent.find(t=>t.id!==a.id&&name(t.artist)&&name(a.artist)&&t.artist!==a.artist);
      if(b&&name(b.title))song('range',a,{otherTitle:name(b.title)},1.2);
    }
    const unseen=total-heard;
    if(unseen)add('unexplored',{count:unseen,trackCount:tracks(unseen)},'',1.1);
    const explored=Math.round(100*heard/total);
    if(explored>0&&explored<100)add('explored',{percent:explored},'',.9);
    if(heard===total)add('allHeard',{},'',1);
    const discoveries=count(d.discoveries),retained=count(d.retained);
    if(discoveries)add('discoveries',{count:discoveries,trackCount:tracks(discoveries)},'',1.2);
    if(retained)add('retained',{count:retained,trackCount:tracks(retained)},'',1.4);
    if(m.todayMs>=60000)add('today',{minutes:Math.floor(m.todayMs/60000)},'',1);
    if(m.weekMs>=60000)add('week',{minutes:Math.floor(m.weekMs/60000)},'',1);
    const calendar=Array.isArray(d.calendar)?d.calendar:[];
    const active=calendar.slice(-28).filter(day=>day.ms>=60000).length;
    if(active)add('activeDays',{days:active,daySpan:days(active)},'',.8);
    const previous=calendar.slice(-14,-7).reduce((sum,day)=>sum+Math.max(0,Number(day.ms)||0),0);
    if(previous>=600000&&Number.isFinite(m.weekMs)){
      const delta=Math.round(100*(m.weekMs-previous)/previous);
      if(Math.abs(delta)>=20)add(delta>0?'weekUp':'weekDown',{percent:Math.abs(delta),minutes:Math.floor(m.weekMs/60000),previousMinutes:Math.floor(previous/60000)},'',1.4);
    }
    const streak=count(d.behavior?.streak);
    if(streak>=2)add('streak',{days:streak,daySpan:days(streak)},'',1.1);
    if(Array.isArray(d.hours)&&d.hours.length===24&&d.totalMs>=1800000){
      let peak=0;for(let i=1;i<24;i++)if(d.hours[i]>d.hours[peak])peak=i;
      if(d.hours[peak]>0)add('peakHour',{hour:`${String(peak).padStart(2,'0')}:00–${String((peak+1)%24).padStart(2,'0')}:00`},'',.8);
    }
    const outside=Math.round(100*d.outsideFavorites/d.knownTime);
    if(d.knownTime>=1200000&&Math.abs(d.totalMs-d.knownTime)<1&&outside>0&&outside<100){
      add('outside',{percent:outside},'',.8);
    }
    // Even a library with missing titles still has a truthful, usable sentence.
    if(!cards.length)add('unexplored',{count:unseen,trackCount:tracks(unseen)});
    return cards;
  }
  function shorten(value,limit){
    if(value.length<=limit)return value;
    let result='';for(const char of value){if(result.length+char.length>limit-1)break;result+=char;}
    return result+'…';
  }
  function format(card,lang='ru',variant=0){
    lang=lang==='ru'?'ru':'en';
    const template=Copy.families[card.family]?.[lang]?.[variant];
    if(!template)return null;
    const values={...card.values};
    if(values.minutes!==undefined){const n=values.minutes;values.time=lang==='ru'?(n>=60?`${Math.floor(n/60)} ч ${n%60} мин`:`${n} мин`):(n>=60?`${Math.floor(n/60)} h ${n%60} min`:`${n} min`);}
    if(lang==='en'){
      if(values.days!==undefined)values.daySpan=values.daySpanGen=`${values.days} ${values.days===1?'day':'days'}`;
      if(values.count!==undefined){
        values.trackCount=values.trackCountGen=`${values.count} ${values.count===1?'track':'tracks'}`;
        values.listenCount=values.listenCountGen=`${values.count} ${values.count===1?'listen':'listens'}`;
      }
    }
    const titles=template.match(/\{(?:title|otherTitle)\}/g)||[];
    const fixed=template.replace(/\{(\w+)\}/g,(_,key)=>key==='title'||key==='otherTitle'?'':String(values[key]??''));
    const titleLimit=titles.length?Math.min(36,Math.floor((MAX_LENGTH-fixed.length)/titles.length)):0;
    if(fixed.length>MAX_LENGTH||titles.length&&titleLimit<8)return null;
    const text=template.replace(/\{(\w+)\}/g,(_,key)=>{
      const value=String(values[key]??'');return key==='title'||key==='otherTitle'?shorten(value,titleLimit):value;
    });
    return text.length<=MAX_LENGTH?text:null;
  }
  function hash(text){
    let a=2166136261,b=2246822507;
    for(let i=0;i<text.length;i++){
      const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489909);
    }
    a=(a^(a>>>16))>>>0;b=((b^(b>>>13))|1)>>>0;
    return [a,b];
  }
  const identity=text=>hash(text).map(n=>n.toString(36)).join('.');
  function create(options={}){
    let storage=options.storage;
    if(storage===undefined){try{storage=globalThis.localStorage;}catch(_){storage=null;}}
    const pages=new Map();
    let recent=[],seed=0;
    function read(key){try{return storage?.getItem(KEY+key);}catch(_){return null;}}
    function write(key,value){try{storage?.setItem(KEY+key,value);}catch(_){/* session memory still prevents repetitions */}}
    try{
      const raw=read('state');
      const saved=raw&&raw.length<16000?JSON.parse(raw):null;
      if(saved?.version===1){
        seed=Number.isInteger(saved.seed)?saved.seed>>>0:0;
        if(Array.isArray(saved.recent))recent=saved.recent.slice(-RECENT).filter(r=>r&&typeof r.text==='string'&&r.text.length<=MAX_LENGTH&&typeof r.family==='string'&&r.family.length<32&&typeof r.anchor==='string'&&r.anchor.length<32&&typeof r.frame==='string'&&r.frame.length<64);
      }
    }catch(_){/* damaged optional state must not affect Home */}
    if(!seed)seed=(Math.floor((options.random||Math.random)()*4294967296)>>>0)||0x9e3779b9;
    function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
    function page(index){
      if(pages.has(index))return pages.get(index);
      const bytes=new Uint8Array(PAGE_BYTES),raw=read('bits:'+index);
      if(typeof raw==='string'&&raw.length===PAGE_BYTES*2&&/^[0-9a-f]+$/.test(raw)){
        for(let i=0;i<PAGE_BYTES;i++)bytes[i]=parseInt(raw.slice(i*2,i*2+2),16);
      }
      pages.set(index,bytes);return bytes;
    }
    function positions(text){const [a,b]=hash(text);return [0,1,2,3].map(i=>(a+Math.imul(i,b))&(BITS-1));}
    function seen(text){
      return positions(text).every(bit=>page(Math.floor(bit/(PAGE_BYTES*8)))[(bit>>>3)%PAGE_BYTES]&(1<<(bit&7)));
    }
    function remember(result){
      const dirty=new Set();
      for(const bit of positions(result.text)){
        const index=Math.floor(bit/(PAGE_BYTES*8));page(index)[(bit>>>3)%PAGE_BYTES]|=1<<(bit&7);dirty.add(index);
      }
      recent=recent.filter(item=>item.text!==result.text);
      recent.push(result);if(recent.length>RECENT)recent.shift();
      for(const index of dirty){let encoded='';for(const byte of page(index))encoded+=byte.toString(16).padStart(2,'0');write('bits:'+index,encoded);}
      write('state',JSON.stringify({version:1,seed:seed>>>0,recent}));
      return result.text;
    }
    function next(model,{lang='ru',now=Date.now()}={}){
      lang=lang==='ru'?'ru':'en';
      const cards=candidates(model,now,seed);
      const weights=cards.map(card=>{
        let weight=card.weight;
        if(recent.slice(-3).some(r=>r.family===card.family))weight*=.08;
        if(card.anchor&&recent.slice(-5).some(r=>r.anchor===identity(card.anchor)))weight*=.15;
        return weight;
      });
      function choose(pool,weightAt){
        let sum=0;for(let i=0;i<pool.length;i++)sum+=weightAt(i);
        let cursor=random()*sum;
        for(let i=0;i<pool.length;i++){cursor-=weightAt(i);if(cursor<0)return pool[i];}
        return pool[pool.length-1];
      }
      let fallback=null,fallbackAge=Infinity;
      function resultFor(card,variant){
        const text=format(card,lang,variant);if(!text)return null;
        const result={text,family:card.family,anchor:card.anchor?identity(card.anchor):'',frame:card.family+':'+variant};
        let age=-1;
        for(let i=recent.length-1;i>=0;i--)if(recent[i].text===text){age=i;break;}
        if(age<fallbackAge){fallback=result;fallbackAge=age;}
        return result;
      }
      // A fixed work budget, independent of the size/age of the listening log.
      for(let attempt=0;attempt<96;attempt++){
        const primary=choose(cards,i=>weights[i]),variant=Math.floor(random()*Copy.families[primary.family][lang].length);
        const result=resultFor(primary,variant);if(!result)continue;
        // Also discourage the same wording with a different track name.
        if(attempt<24&&recent.slice(-6).some(r=>r.frame===result.frame))continue;
        if(!seen(result.text)&&!recent.some(r=>r.text===result.text))return remember(result);
      }
      // Compact copy has fewer combinations: use every remaining sentence
      // before revisiting an old one. This scan is capped by 64 small cards.
      for(const card of cards)for(let variant=0;variant<Copy.families[card.family][lang].length;variant++){
        const result=resultFor(card,variant);
        if(result&&!seen(result.text)&&!recent.some(r=>r.text===result.text))return remember(result);
      }
      if(!fallback)fallback={text:lang==='ru'?'Ваша музыка, в вашем ритме.':'Your music, at your pace.',family:'empty',anchor:'',frame:'empty:fallback'};
      return remember(fallback);
    }
    return {next};
  }
  return {create,candidates,format};
});

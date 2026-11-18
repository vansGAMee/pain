/* Choose a short fact from the existing Home summaries. Recent topics, track
 * names and sentence shapes influence the choice independently of exact text. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./home-message-copy'));
  else root.HomeMessages=factory(root.HomeMessageCopy);
})(globalThis,Copy=>{
  'use strict';
  const KEY='pain_home_messages_v1:state',MAX_CARDS=64,MAX_LENGTH=82,RECENT=18,SEEN=384;
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
  function candidates(model,now=Date.now(),variation=0,displayTitle){
    const m=model||{},d=m.details||{},library=m.library||new Map(),cards=[];
    const total=count(library.size),heard=Math.min(total,count(d.heardLibrary));
    function add(family,values={},anchor='',weight=1,related=''){
      const copy=Copy.families[family];
      if(values.days!==undefined)values.daySpanGen=dayGen(values.days);
      if(values.count!==undefined){
        values.trackCountGen=trackGen(values.count);
        values.listenCount=plural(values.count,'прослушивание','прослушивания','прослушиваний');
        values.listenCountGen=plural(values.count,'прослушивания','прослушиваний','прослушиваний');
      }
      if(copy&&cards.length<MAX_CARDS)cards.push({family,group:copy.group,values,anchor:String(anchor),related,weight});
    }
    function song(family,track,values={},weight=1,related=''){
      const title=name(track&&(displayTitle?.(track)||track.title));if(!title||!library.has(String(track.id)))return;
      add(family,{...values,title},track.id,weight,related);
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
    const today=stamp(now);
    const recent=sample(m.recent).filter(track=>{
      const at=m.last?.get(String(track.id)),gap=Number.isFinite(at)?today-stamp(at):Infinity;
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
    for(const track of fresh){
      const id=String(track.id),first=m.first?.get(id),last=m.last?.get(id);
      if(Number.isFinite(first)&&Number.isFinite(last)&&stamp(last)>stamp(first))song('foundAgain',track,{},1.8);
      else song('fresh',track,{},1.1);
    }
    for(const track of past){
      const at=m.last?.get(String(track.id));
      const n=Number.isFinite(at)?Math.max(0,today-stamp(at)):0;
      if(n>=7)song('past',track,{days:n,daySpan:days(n)},1.1);
    }
    for(const track of recent){
      const id=String(track.id),n=count(d.behavior?.counts?.[id]),minutes=Math.floor((d.trackTime?.get(id)||0)/60000);
      const first=m.first?.get(id),age=Number.isFinite(first)?today-stamp(first):0;
      song('recent',track,{},.7);
      if(n>=3)song('repeat',track,{count:n},1.5);
      if(n>=3&&minutes>=20)song('trackTime',track,{minutes},1.65);
      if(n>=2&&age>=45)song('firstThen',track,{days:age,daySpan:days(age)},1.6);
    }
    for(const track of favorites){
      const at=m.last?.get(String(track.id));
      const n=Number.isFinite(at)?Math.max(0,today-stamp(at)):0;
      if(n>=7)song('favoriteReturn',track,{days:n,daySpan:days(n)},1.5);
      else if(!at)song('favoriteUnheard',track,{},1.4);
      else song('favorite',track,{},.8);
    }
    if(recent.length>1){
      const a=recent[0],b=recent.find(t=>t.id!==a.id&&name(t.artist)&&name(a.artist)&&t.artist!==a.artist);
      if(b&&name(b.title))song('range',a,{otherTitle:name(displayTitle?.(b)||b.title)},1.45,String(b.id));
    }
    const unseen=total-heard;
    if(unseen)add('unexplored',{count:unseen,trackCount:tracks(unseen)},'',1);
    if(unseen>0&&unseen<=5&&total>=10&&heard/total>=.8)add('almostAll',{count:unseen,trackCount:tracks(unseen)},'',1.8);
    const explored=Math.round(100*heard/total);
    if(explored>0&&explored<100)add('explored',{percent:explored},'',.9);
    if(heard===total)add('allHeard',{},'',1);
    const discoveries=count(d.discoveries),retained=count(d.retained);
    if(discoveries)add('discoveries',{count:discoveries,trackCount:tracks(discoveries)},'',1.2);
    if(retained>=2&&discoveries>=3&&retained<=discoveries)add('retained',{ratio:retained+' из '+discoveries,denominator:discoveries,count:retained},'',1.7);
    if(m.todayMs>=60000)add('today',{minutes:Math.floor(m.todayMs/60000)},'',1);
    if(m.weekMs>=60000)add('week',{minutes:Math.floor(m.weekMs/60000)},'',1);
    const calendar=Array.isArray(d.calendar)?d.calendar:[];
    const active=calendar.slice(-28).filter(day=>day.ms>=60000).length;
    if(active)add('activeDays',{days:active,daySpan:days(active)},'',.8);
    const weekActive=calendar.slice(-7).filter(day=>day.ms>=60000).length;
    if(weekActive>=2)add('weekActive',{days:weekActive,daySpan:days(weekActive)},'',1.1);
    const previous=calendar.slice(-14,-7).reduce((sum,day)=>sum+Math.max(0,Number(day.ms)||0),0);
    if(previous>=600000&&Number.isFinite(m.weekMs)){
      const delta=Math.round(100*(m.weekMs-previous)/previous);
      if(Math.abs(delta)>=20)add(delta>0?'weekUp':'weekDown',{percent:Math.abs(delta),minutes:Math.floor(m.weekMs/60000),previousMinutes:Math.floor(previous/60000)},'',1.4);
    }
    const streak=count(d.behavior?.streak);
    if(streak>=2)add('streak',{days:streak,daySpan:days(streak)},'',1.1);
    if(active>=3&&d.record?.ms>=1800000)add('recordDay',{minutes:Math.floor(d.record.ms/60000)},'',1.45);
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
    if(values.minutes!==undefined){const n=values.minutes;values.time=lang==='ru'?(n>=60?`${Math.floor(n/60)} ч${n%60?' '+n%60+' мин':''}`:`${n} мин`):(n>=60?`${Math.floor(n/60)} h${n%60?' '+n%60+' min':''}`:`${n} min`);}
    if(lang==='en'){
      if(values.days!==undefined)values.daySpan=values.daySpanGen=`${values.days} ${values.days===1?'day':'days'}`;
      if(values.count!==undefined){
        if(values.denominator!==undefined)values.ratio=values.count+' of '+values.denominator;
        values.trackCount=values.trackCountGen=`${values.count} ${values.count===1?'track':'tracks'}`;
        values.listenCount=values.listenCountGen=`${values.count} ${values.count===1?'listen':'listens'}`;
      }
    }
    const titles=template.match(/\{(?:title|otherTitle)\}/g)||[];
    if([...template.matchAll(/\{(\w+)\}/g)].some(([,key])=>values[key]==null||values[key]===''))return null;
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
  const shortKey=value=>typeof value==='string'&&value.length<=64;
  const leadOf=text=>identity((text.replace(/[«“][^»”]*[»”]|\{\w+\}/g,'').toLowerCase().match(/\p{L}+/gu)||[]).slice(0,2).join(' '));
  const leads=Object.fromEntries(Object.entries(Copy.families).map(([family,copy])=>[
    family,{ru:copy.ru.map(leadOf),en:copy.en.map(leadOf)}
  ]));
  const factKey=(family,anchor,related='')=>identity(family+'|'+[anchor,related].sort().join('|'));

  function create(options={}){
    let storage=options.storage;
    if(storage===undefined){try{storage=globalThis.localStorage;}catch(_){storage=null;}}
    const seen=new Map();
    let recent=[],seed=0,sequence=0;
    try{
      const raw=storage?.getItem(KEY),saved=raw&&raw.length<32000?JSON.parse(raw):null;
      if(saved?.version===1||saved?.version===2){
        seed=Number.isInteger(saved.seed)?saved.seed>>>0:0;
        const rows=Array.isArray(saved.recent)?saved.recent.slice(-RECENT):[];
        if(saved.version===2){
          for(const id of (Array.isArray(saved.seen)?saved.seen.slice(-SEEN):[])){
            if(typeof id==='string'&&/^[a-z0-9]{1,7}\.[a-z0-9]{1,7}$/.test(id))seen.set(id,sequence++);
          }
          recent=rows.filter(row=>row&&['group','family','fact','anchor','related','frame','lead'].every(key=>shortKey(row[key])));
        }else{
          // Keep the last displayed observations from 1.9.9. Its old text
          // pages are independent and need no scan during startup.
          for(const row of rows){
            if(!row||typeof row.text!=='string'||row.text.length>100||!Object.hasOwn(Copy.families,row.family)||!shortKey(row.anchor)||!shortKey(row.frame))continue;
            seen.set(identity(row.text),sequence++);
            recent.push({group:Copy.families[row.family].group,family:row.family,fact:factKey(row.family,row.anchor),
              anchor:row.anchor,related:'',frame:row.frame,lead:leadOf(row.text)});
          }
        }
      }
    }catch(_){/* Optional storage cannot prevent playback or render failures. */}
    if(!seed)seed=(Math.floor((options.random||Math.random)()*4294967296)>>>0)||0x9e3779b9;
    function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
    function remember(result){
      const {text,id,...entry}=result;
      seen.delete(id);
      seen.set(id,sequence++);
      if(seen.size>SEEN)seen.delete(seen.keys().next().value);
      recent.push(entry);
      if(recent.length>RECENT)recent.shift();
      try{storage?.setItem(KEY,JSON.stringify({version:2,seed:seed>>>0,recent,seen:[...seen.keys()]}));}catch(_){}
      return text;
    }

    function next(model,{lang='ru',now=Date.now(),displayTitle}={}){
      lang=lang==='ru'?'ru':'en';
      const ages=new Map();
      for(let i=recent.length-1;i>=0;i--){
        const row=recent[i],age=recent.length-1-i;
        for(const field of ['group','family','fact','frame','lead','anchor','related']){
          if(!row[field])continue;
          const key=(field==='related'?'anchor':field)+'|'+row[field];
          if(!ages.has(key))ages.set(key,age);
        }
      }
      const decay=(kind,id,window)=>Math.max(0,window-(ages.get(kind+'|'+id)??window));
      const choices=candidates(model,now,seed,displayTitle).map(card=>{
        const {family,group}=card,anchor=card.anchor?identity(card.anchor):'',related=card.related?identity(card.related):'';
        const fact=factKey(family,anchor,related);
        const score=card.weight+random()*.65
          -decay('group',group,4)*1.5
          -decay('family',family,6)*.65
          -decay('fact',fact,12)*.55
          -Math.max(decay('anchor',anchor,7),decay('anchor',related,7))*.8;
        return {card,group,family,anchor,related,fact,score};
      }).sort((a,b)=>b.score-a.score);

      let fallback=null,bestReturn=-Infinity;
      for(const {card,group,family,anchor,related,fact,score} of choices){
        const variants=leads[family][lang].map((lead,index)=>{
          const frame=family+':'+index;
          return {index,lead,frame,score:random()-decay('frame',frame,8)*.3-decay('lead',lead,5)*.4};
        }).sort((a,b)=>b.score-a.score);
        for(const {index,lead,frame} of variants){
          const text=format(card,lang,index);
          if(!text)continue;
          const id=identity(text),prior=seen.get(id);
          const result={id,text,group,family,fact,anchor,related,frame,lead};
          if(prior===undefined)return remember(result);
          const returnScore=sequence-prior+score*3-(prior===sequence-1?1000:0);
          if(returnScore>bestReturn){bestReturn=returnScore;fallback=result;}
        }
      }
      if(!fallback){
        const text=Copy.families.empty[lang][0];
        fallback={id:identity(text),text,group:'start',family:'empty',fact:factKey('empty',''),anchor:'',related:'',frame:'empty:0',lead:leadOf(text)};
      }
      return remember(fallback);
    }
    return {next};
  }
  return {create,candidates,format};
});

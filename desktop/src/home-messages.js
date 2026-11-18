/* Choose a short fact from the existing Home summaries. Recent topics, track
 * names and sentence shapes influence the choice independently of exact text. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./home-message-copy'));
  else root.HomeMessages=factory(root.HomeMessageCopy);
})(globalThis,Copy=>{
  'use strict';
  const KEY='pain_home_messages_v1:state',MAX_CARDS=96,MAX_LENGTH=82,RECENT=18,SEEN=384,FACT_HISTORY=192;
  const CATALOG_PROBES=24,EVENT_HISTORY=32,EVENT_LENGTH=64;
  const DAY=86400000;
  const weekdays={ru:['воскресенья','понедельника','вторника','среды','четверга','пятницы','субботы'],
    en:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']};
  const count=value=>Math.min(1e9,Math.max(0,Math.floor(Number(value)||0)));
  const plural=(n,one,few,many)=>`${n} ${n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many}`;
  const days=n=>plural(n,'день','дня','дней');
  const tracks=n=>plural(n,'трек','трека','треков');
  const dayGen=n=>plural(n,'дня','дней','дней');
  const trackGen=n=>plural(n,'трека','треков','треков');
  const stamp=at=>{const d=new Date(at);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;};
  function name(value){
    if(typeof value!=='string')return '';
    const clean=value.slice(0,256).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,'').replace(/\s+/g,' ').trim();
    // Bound UTF-16 length as well as glyphs (two emoji titles can otherwise
    // exceed the line budget). Never split a surrogate pair.
    let short='';for(const char of clean){if(short.length+char.length>55)return short+'…';short+=char;}
    return short;
  }
  function artistKey(track){
    const value=track?.artist;
    if(typeof value!=='string'||value.length>160)return '';
    const key=value.toLowerCase().trim().replace(/\s+/g,' ');
    return /^(?:unknown(?: artist)?|various(?: artists)?|неизвестн(?:ый исполнитель|о)|разные исполнители|[-—])$/.test(key)?'':key;
  }
  function albumKey(track){
    const artist=artistKey(track),value=track?.album;
    if(!artist||typeof value!=='string'||value.length>160)return '';
    const album=value.toLowerCase().trim().replace(/\s+/g,' ');
    return album&&!/^(?:unknown(?: album)?|untitled|неизвестн(?:ый альбом|о)|[-—])$/.test(album)?artist+'\0'+album:'';
  }
  const secondsOf=track=>Math.floor(Number(track.duration)/1000);
  const lengthOf=seconds=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  function sampleCatalog(catalog,library,variation,max=CATALOG_PROBES){
    if(!Array.isArray(catalog)){
      const items=library.values();
      return Array.from({length:Math.min(library.size,max)},()=>items.next().value);
    }
    const size=catalog.length;
    if(!size)return [];
    const limit=Math.min(size,max),offset=(variation>>>0)%size;
    return Array.from({length:limit},(_,i)=>catalog[(offset+Math.floor(i*size/limit))%size]);
  }
  function candidates(model,now=Date.now(),variation=0,displayTitle,isExcluded){
    const m=model||{},d=m.details||{},library=m.library||new Map(),cards=[];
    const total=count(library.size),heard=Math.min(total,count(d.heardLibrary));
    function add(family,values={},anchor='',weight=1,related='',event=''){
      const copy=Copy.families[family];
      if(values.days!==undefined)values.daySpanGen=dayGen(values.days);
      if(values.count!==undefined){
        values.trackCountGen=trackGen(values.count);
        values.listenCount=plural(values.count,'прослушивание','прослушивания','прослушиваний');
        values.listenCountGen=plural(values.count,'прослушивания','прослушиваний','прослушиваний');
      }
      if(copy&&cards.length<MAX_CARDS)cards.push({family,group:copy.group,values,anchor:String(anchor),related,weight,event});
    }
    const titleOf=track=>name(track&&(displayTitle?.(track)||track.title));
    const available=track=>track?.id!=null&&library.has(String(track.id))&&!isExcluded?.(String(track.id));
    function song(family,track,values={},weight=1,related='',event=''){
      if(!available(track))return false;
      const title=titleOf(track);if(!title)return false;
      add(family,{...values,title},track.id,weight,related,event);
      return true;
    }
    function pair(family,a,b,weight){
      const otherTitle=titleOf(b);
      if(available(a)&&available(b)&&String(a.id)!==String(b.id)&&otherTitle&&otherTitle.toLowerCase()!==titleOf(a).toLowerCase()){
        return song(family,a,{otherTitle},weight,String(b.id));
      }
      return false;
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
    for(const id of m.anniversaries||[]){
      song('anniversary',library.get(id),{},3,'',m.first.get(id));
    }
    const opening=m.openingReturn;
    if(opening&&opening.at<=now&&today-stamp(opening.at)<4){
      song('openingReturn',library.get(opening.id),{},1,'',opening.at);
    }
    if(d.totalMs>=DAY&&d.totalMs-m.todayMs<DAY){
      add('dayOfMusic',{},'',2,'','24h');
    }
    const lastGap=track=>{
      const at=m.last?.get(String(track.id));
      return Number.isFinite(at)?today-stamp(at):Infinity;
    };
    const recent=sample(m.recent).filter(track=>{
      const gap=lastGap(track);
      return available(track)&&gap>=0&&gap<7;
    }),fresh=sample(m.fresh),past=sample(m.past),favorites=sample(m.favorites);
    const unseen=total-heard;
    if(!heard&&!d.behavior?.qualified){
      const starters=sampleCatalog(m.catalog,library,variation,6).filter(available);
      for(const track of starters)song('ready',track);
      if(starters.length>1)pair('coldPair',starters[0],starters[1],1.35);
    }else if(heard&&unseen&&m.last){
      const familiar=new Set(recent.map(artistKey).filter(Boolean));
      const albums=new Set(recent.map(albumKey).filter(Boolean));
      let general=0,byArtist=0,byAlbum=0;
      for(const track of sampleCatalog(m.catalog,library,variation)){
        if(m.last.has(String(track.id)))continue;
        if(albums.has(albumKey(track))){
          if(byAlbum<2&&song('albumDiscovery',track,{album:name(track.album)},2.15))byAlbum++;
        }else if(familiar.has(artistKey(track))){
          if(byArtist<2&&song('artistDiscovery',track,{artist:name(track.artist)},2))byArtist++;
        }else if(general<2&&song('unheard',track,{},1.55))general++;
        if(general===2&&byArtist===2&&byAlbum===2)break;
      }
    }
    if(d.ritual){
      const id=String(d.ritual.track),track=library.get(id),n=count(d.ritual.days);
      const first=m.first?.get(id);
      if(track&&n>=3&&n<=7&&first<=now&&today-stamp(first)<7&&lastGap(track)<=1){
        song('newRitual',track,{days:n},.5,'',first);
      }
      if(n>=2&&n<=28)song('ritual',track,{days:n,daySpan:days(n)},1.5);
    }
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
    const calendar=Array.isArray(d.calendar)?d.calendar:[];
    const todayTracks=d.trackDays?.get(calendar.at(-1)?.day);
    for(const track of recent){
      const id=String(track.id),n=count(d.behavior?.counts?.[id]),minutes=Math.floor((d.trackTime?.get(id)||0)/60000);
      const first=m.first?.get(id),age=Number.isFinite(first)?today-stamp(first):0;
      song('recent',track,{},.7);
      if(n>=3)song('repeat',track,{count:n},1.5);
      if(n>=3&&minutes>=20){
        const seconds=secondsOf(track);
        if(minutes>=30&&seconds>=30&&seconds<180)song('shortLong',track,{minutes,length:lengthOf(seconds)},1.8);
        else song('trackTime',track,{minutes},1.65);
      }
      if(n>=2&&age>=45){
        if(age>366)song('yearTogether',track,{},1.9);
        else song('firstThen',track,{days:age,daySpan:days(age)},1.6);
      }
      const airTime=todayTracks?.get(id);
      if(airTime>=300000&&airTime>m.todayMs/2)song('todayHeadliner',track,{},1.85);
    }
    for(const track of favorites){
      const at=m.last?.get(String(track.id));
      const n=Number.isFinite(at)?Math.max(0,today-stamp(at)):0;
      if(n>=7)song('favoriteReturn',track,{days:n,daySpan:days(n)},1.5);
      else if(!at)song('favoriteUnheard',track,{},1.4);
      else song('favorite',track,{},.8);
    }
    let shortTracks=0;
    for(const track of favorites){
      const seconds=secondsOf(track);
      if(seconds>=45&&seconds<180&&m.last?.has(String(track.id))&&song('shortBreak',track,
        {length:lengthOf(seconds)},1.8))shortTracks++;
      if(shortTracks===2)break;
    }
    const longTrack=[...favorites,...recent].find(track=>{
      const seconds=secondsOf(track);
      return available(track)&&seconds>=420&&seconds<1200&&m.last?.has(String(track.id));
    });
    if(longTrack)song('slowListen',longTrack,{length:lengthOf(secondsOf(longTrack))},1.7);
    const newTrack=fresh.find(track=>{
      const first=m.first?.get(String(track.id));
      return available(track)&&Number.isFinite(first)&&first<=now&&today-stamp(first)<7;
    });
    if(newTrack){
      const dormantFavorite=[...favorites,...past].find(track=>{
        const gap=lastGap(track);
        return available(track)&&(track.favorite===1||track.favorite===true)&&Number.isFinite(gap)&&gap>=30;
      });
      if(dormantFavorite)pair('contrast',newTrack,dormantFavorite,1.95);
    }
    const artists=recent.map(artistKey),albums=recent.map(albumKey);
    let ranges=0,albumPairShown=false;
    for(let i=0;i<recent.length;i++){
      for(let j=i+1;j<recent.length;j++){
        if(!albumPairShown&&albums[i]&&albums[i]===albums[j]){
          albumPairShown=pair('albumPair',recent[i],recent[j],1.65);
        }else if(ranges<3&&artists[i]&&artists[j]&&artists[i]!==artists[j]&&pair('range',recent[i],recent[j],1.4)){
          ranges++;
        }
      }
    }
    if(unseen)add('unexplored',{count:unseen,trackCount:tracks(unseen)},'',1);
    if(unseen>0&&unseen<=5&&total>=10&&heard/total>=.8)add('almostAll',{count:unseen,trackCount:tracks(unseen)},'',1.8);
    const explored=Math.round(100*heard/total);
    if(explored>0&&explored<100)add('explored',{percent:explored},'',.9);
    if(heard===total)add('allHeard',{},'',1);
    const discoveries=count(d.discoveries),retained=count(d.retained);
    if(discoveries)add('discoveries',{count:discoveries,trackCount:tracks(discoveries)},'',1.2);
    if(retained>=2&&discoveries>=3&&retained<=discoveries)add('retained',{ratio:retained+' из '+discoveries,denominator:discoveries,count:retained},'',1.7);
    const weekBeforeToday=calendar.slice(-7,-1);
    const clearsWeek=m.todayMs>=900000&&weekBeforeToday.filter(day=>day.ms>=120000).length>=3&&
      m.todayMs>=Math.max(...weekBeforeToday.map(day=>day.ms))+300000;
    if(clearsWeek)add('weekPeak',{minutes:Math.floor(m.todayMs/60000)},'',1.72);
    else if(m.todayMs>=60000)add('today',{minutes:Math.floor(m.todayMs/60000)},'',1);
    if(m.weekMs>=60000)add('week',{minutes:Math.floor(m.weekMs/60000)},'',1);
    const active=calendar.slice(-28).filter(day=>day.ms>=60000).length;
    if(active)add('activeDays',{days:active,daySpan:days(active)},'',.8);
    const weekActive=calendar.slice(-7).filter(day=>day.ms>=60000).length;
    if(weekActive===7)add('fullWeek',{},'',1.35);
    else if(weekActive>=2)add('weekActive',{days:weekActive,daySpan:days(weekActive)},'',1.1);
    const localDay=new Date(now).getDay();
    if([8,15,22].every(index=>calendar.at(-index)?.ms>=60000))add('weekdayHabit',{localDay},'',1.55);
    if(m.todayMs>=120000){
      const gap=calendar.slice(0,-1).reverse().findIndex(day=>day.ms>0);
      if(gap>=7)add('breakEnded',{days:gap,daySpan:days(gap)},'',1.75);
    }
    const previous=calendar.slice(-14,-7).reduce((sum,day)=>sum+Math.max(0,Number(day.ms)||0),0);
    if(previous>=600000&&Number.isFinite(m.weekMs)){
      const delta=Math.round(100*(m.weekMs-previous)/previous);
      if(Math.abs(delta)>=20)add(delta>0?'weekUp':'weekDown',{percent:Math.abs(delta),minutes:Math.floor(m.weekMs/60000),previousMinutes:Math.floor(previous/60000)},'',1.4);
    }
    const streak=count(d.behavior?.streak);
    if(streak>=2)add('streak',{days:streak,daySpan:days(streak)},'',1.1);
    if(active>=3&&d.record?.ms>=1800000)add('recordDay',{minutes:Math.floor(d.record.ms/60000)},'',1.45);
    const hour=new Date(now).getHours(),fortnight=calendar.slice(-15,-1);
    const daysAtHour=fortnight.filter(day=>d.dayHours?.get(day.day)?.[hour]>=60000).length;
    if(fortnight.length===14&&daysAtHour>=4&&daysAtHour*2>=fortnight.filter(day=>day.ms>=60000).length){
      add('hourRoutine',{days:daysAtHour},'',1.7);
    }else if(Array.isArray(d.hours)&&d.hours.length===24&&d.totalMs>=1800000){
      let peak=0;for(let i=1;i<24;i++)if(d.hours[i]>d.hours[peak])peak=i;
      if(d.hours[peak]>0)add('peakHour',{hour:`${String(peak).padStart(2,'0')}:00–${String((peak+1)%24).padStart(2,'0')}:00`},'',.8);
    }
    if(active>=3&&d.dayHours){
      let night=0,nightDays=0,morning=0,morningDays=0;
      for(const day of calendar){
        const hours=d.dayHours.get(day.day);
        if(!hours)continue;
        let early=0,late=0;
        for(let i=0;i<6;i++){late+=hours[i];early+=hours[i+6];}
        night+=late;morning+=early;
        if(late>=60000)nightDays++;
        if(early>=60000)morningDays++;
      }
      if(nightDays>=3&&night>=1200000)add('nightTime',{minutes:Math.floor(night/60000)},'',1.45);
      if(morningDays>=3&&morning>=1800000)add('morningTime',{minutes:Math.floor(morning/60000)},'',1.45);
    }
    const outside=Math.round(100*d.outsideFavorites/d.knownTime);
    if(d.knownTime>=1200000&&Math.abs(d.totalMs-d.knownTime)<1&&outside>0&&outside<100){
      if(outside<=30)add('favoritesLed',{percent:100-outside},'',1.15);
      else add('outside',{percent:outside},'',.8);
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
    const template=templates[card.family]?.[lang]?.[variant];
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
    if(values.localDay!==undefined)values.weekday=weekdays[lang][values.localDay];
    let room=(card.event?EVENT_LENGTH:MAX_LENGTH)-template.fixedLength;
    for(const key of template.fields){
      const value=values[key];
      if(value==null||value==='')return null;
      values[key]=String(value);
      if(!namedField.has(key))room-=values[key].length;
    }
    const names=template.names.length>1?[...template.names].sort((a,b)=>values[a].length-values[b].length):template.names;
    if(room<8*names.length)return null;
    for(let i=0;i<names.length;i++){
      const key=names[i];
      values[key]=shorten(values[key],Math.min(36,Math.floor(room/(names.length-i))));
      room-=values[key].length;
    }
    let text=template.parts[0];
    for(let i=1;i<template.parts.length;i+=2)text+=values[template.parts[i]]+template.parts[i+1];
    return text;
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
  const isIdentity=value=>typeof value==='string'&&/^[a-z0-9]{1,7}\.[a-z0-9]{1,7}$/.test(value);
  const shortKey=value=>typeof value==='string'&&value.length<=64;
  const leadOf=text=>identity((text.replace(/[«“][^»”]*[»”]|\{\w+\}/g,'').toLowerCase().match(/\p{L}+/gu)||[]).slice(0,2).join(' '));
  const namedField=new Set(['title','otherTitle','artist','album']);
  function compile(text){
    const parts=text.split(/\{(\w+)\}/g),fields=[];
    let fixedLength=parts[0].length;
    for(let i=1;i<parts.length;i+=2){fields.push(parts[i]);fixedLength+=parts[i+1].length;}
    return {parts,fields,fixedLength,names:fields.filter(key=>namedField.has(key)),lead:leadOf(text)};
  }
  const templates=Object.fromEntries(Object.entries(Copy.families).map(([family,copy])=>[
    family,{ru:copy.ru.map(compile),en:copy.en.map(compile)}
  ]));
  const factKey=(family,anchor,related='')=>identity((Copy.families[family]?.fact||family)+'|'+[anchor,related].sort().join('|'));

  function create(options={}){
    let storage=options.storage;
    if(storage===undefined){try{storage=globalThis.localStorage;}catch(_){storage=null;}}
    const seen=new Map(),shownEvents=new Set(),seenFacts=new Set();
    let recent=[],seed=0,sequence=0,eventDay=null;
    try{
      const raw=storage?.getItem(KEY),saved=raw&&raw.length<32000?JSON.parse(raw):null;
      if(saved?.version===1||saved?.version===2){
        seed=Number.isInteger(saved.seed)?saved.seed>>>0:0;
        const rows=Array.isArray(saved.recent)?saved.recent.slice(-RECENT):[];
        if(saved.version===2){
          for(const id of (Array.isArray(saved.seen)?saved.seen.slice(-SEEN):[])){
            if(isIdentity(id))seen.set(id,sequence++);
          }
          for(const id of (Array.isArray(saved.events)?saved.events.slice(-EVENT_HISTORY):[])){
            if(isIdentity(id))shownEvents.add(id);
          }
          if(Number.isSafeInteger(saved.eventDay))eventDay=saved.eventDay;
          for(const id of (Array.isArray(saved.facts)?saved.facts.slice(-FACT_HISTORY):[])){
            if(isIdentity(id))seenFacts.add(id);
          }
          recent=rows.filter(row=>row&&['group','family','fact','anchor','related','frame','lead'].every(key=>shortKey(row[key])))
            .map(row=>({...row,fact:factKey(row.family,row.anchor,row.related)}));
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
    function rememberFact(fact){
      seenFacts.delete(fact);
      seenFacts.add(fact);
      if(seenFacts.size>FACT_HISTORY)seenFacts.delete(seenFacts.values().next().value);
    }
    for(const entry of recent)rememberFact(entry.fact);
    if(!seed)seed=(Math.floor((options.random||Math.random)()*4294967296)>>>0)||0x9e3779b9;
    function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
    function remember(result,event,day){
      const {text,id,...entry}=result;
      seen.delete(id);
      seen.set(id,sequence++);
      if(seen.size>SEEN)seen.delete(seen.keys().next().value);
      recent.push(entry);
      if(recent.length>RECENT)recent.shift();
      rememberFact(entry.fact);
      if(event){
        shownEvents.add(event);
        if(shownEvents.size>EVENT_HISTORY)shownEvents.delete(shownEvents.values().next().value);
        eventDay=day;
      }
      try{storage?.setItem(KEY,JSON.stringify({version:2,seed:seed>>>0,recent,seen:[...seen.keys()],
        facts:[...seenFacts],eventDay,events:[...shownEvents]}));}catch(_){}
      return text;
    }

    function next(model,{lang='ru',now=Date.now(),displayTitle,isExcluded}={}){
      lang=lang==='ru'?'ru':'en';
      const today=stamp(now);
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
      const choices=candidates(model,now,seed,displayTitle,isExcluded).map(card=>{
        const {family,group}=card,anchor=card.anchor?identity(card.anchor):'',related=card.related?identity(card.related):'';
        const fact=factKey(family,anchor,related);
        const repeatedFact=seenFacts.has(fact);
        const leadPenalty=Math.min(...templates[family][lang].map(template=>decay('lead',template.lead,5)))*.35;
        const score=card.event?card.weight:card.weight+random()*.65-leadPenalty
          -decay('group',group,4)*1.5
          -decay('family',family,6)*.65
          -decay('fact',fact,12)*.55
          -Math.max(decay('anchor',anchor,7),decay('anchor',related,7))*.8;
        return {card,group,family,anchor,related,fact,repeatedFact,score};
      }).sort((a,b)=>Number(Boolean(b.card.event))-Number(Boolean(a.card.event))||
        Number(a.repeatedFact)-Number(b.repeatedFact)||b.score-a.score);

      let fallback=null,bestReturn=-Infinity;
      for(const {card,group,family,anchor,related,fact,score} of choices){
        // Dated observations have one chance a day, even across launches or languages.
        const event=card.event&&identity(family+'|'+anchor+'|'+card.event);
        if(event&&(eventDay===today||shownEvents.has(event)))continue;
        const variants=templates[family][lang].map(({lead},index)=>{
          const frame=family+':'+index;
          return {index,lead,frame,score:random()-decay('frame',frame,8)*.3-decay('lead',lead,5)*.4};
        }).sort((a,b)=>b.score-a.score);
        for(const {index,lead,frame,score:variantScore} of variants){
          const text=format(card,lang,index);
          if(!text)continue;
          const id=identity(text),prior=seen.get(id);
          const result={id,text,group,family,fact,anchor,related,frame,lead};
          if(event)return remember(result,event,today);
          if(prior===undefined)return remember(result);
          const returnScore=sequence-prior+score*3+variantScore*2-(prior===sequence-1?1000:0);
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

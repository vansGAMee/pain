/* All values are descriptive statistics of saved events; no mood prediction. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./listening-insights'));else root.InsightChartStats=factory(root.ListeningInsights);})(globalThis,Insights=>{
 'use strict';
 const DAY=86400000;
 const definitions=[
  ['clock','heat','time','Когда неделя звучит','When your week plays','Каждая ячейка — время музыки в этот день недели и час.','Each cell is music time at this weekday and hour.'],
  ['variety','line','time','Сколько разных песен в день','Daily musical variety','Только учтённые прослушивания, без случайных коротких включений.','Counted listens only; accidental previews stay out.'],
  ['accumulation','area','time','Твоя музыка накапливается','Your music adds up','Как росло фактическое время музыки за выбранный период.','How actual listening time accumulated during this period.'],
  ['discoveries','stack','discovery','Первый раз или возвращение','New finds or familiar songs','Первые учтённые прослушивания в истории рядом с повторными.','First counted listens in your history alongside returning ones.'],
  ['retention','hbars','discovery','Какие открытия остались','Discoveries that stayed','Доля открытий, к которым вернулись в другой день: до восьми последних недель с новыми песнями. Для недавних открытий история ещё копится.','New songs heard again on a different day, for up to eight recent discovery weeks. Recent cohorts are still developing.'],
  ['outcomes','donut','listening','Чем заканчивается прослушивание','How listens turn out','Дослушано: услышано 90% записи. Ранний пропуск: до 30 секунд. Остальное показано отдельно.','Completed: 90% of the recording heard. Early skip: before 30 seconds. Remaining cases are separate.'],
  ['skips','cdf','listening','Когда рука тянется к «Далее»','When you reach for Next','Кривая показывает, какая доля отмеченных пропусков случилась к этой секунде.','The curve shows the share of recorded skips that happened by this second.'],
  ['completion','cdf','listening','Насколько глубоко слушаешь','How deeply you listen','Кривая распределения услышанной доли трека. Перемотки не считаются прослушанным звуком.','Distribution of the fraction of a track actually heard. Seeking is not listening.'],
  ['duration','scatter','listening','Длинная песня — больше внимания?','Do longer songs hold your attention?','По горизонтали — длина песни, по вертикали — средняя услышанная доля. Размер точки — число прослушиваний. Показаны 80 самых слушаемых записей.','Song length versus average fraction heard; dot size is the listen count. The 80 most played recordings are shown.'],
  ['artists','stream','habits','Кто звучал по дням','Who filled your days','Время по исполнителям из тегов записей: пять ведущих и остальные.','Listening time by credited performer: the leading five and the rest.'],
  ['favourites','stack','habits','Внутри и вне избранного','Inside and outside your favourites','По текущим лайкам: сколько времени звучали любимые песни и остальная фонотека.','Using current likes: time spent on favourites and the rest of your library.'],
  ['returns','cdf','habits','Через сколько песня возвращается','How soon songs return','Время между соседними учтёнными прослушиваниями одной песни.','Time between consecutive counted listens of the same song.'],
  ['repeat','line','habits','Дни, когда хочется на повтор','Days made for repeat','Доля прослушиваний, которые повторяли уже звучавшую в тот день песню.','Share of counted listens repeating a song already heard that day.'],
  ['exploration','area','discovery','Как открывалась твоя фонотека','Exploring your library','Накопленная доля нынешней фонотеки, услышанная хотя бы раз. Учитывается вся сохранённая история до каждой даты.','Cumulative share of your current library heard at least once, using history up to each date.'],
  ['transitions','links','habits','Песни, которые встречаются','Songs that meet','Самые частые соседние учтённые треки в одной сохранённой сессии. Сессии не угадываются по паузам.','Most frequent adjacent counted songs in a recorded session. Sessions are never inferred from gaps.'],
  ['albums','lollipop','habits','Издания, в которых остаёшься','Releases you spend time with','По общему времени и названиям из тегов. Записи без альбома не объединяются в выдуманное издание.','Ranked by actual time and tagged release names. Untagged recordings are not treated as an album.'],
  ['discoveryClock','radial','discovery','В какое время открываешь новое','Your hours of discovery','В какой час впервые услышал каждую песню в сохранённой истории.','The hour of each song’s first counted listen in saved history.'],
  ['weekQuality','dumbbell','listening','В какие дни слушаешь внимательнее','Which days hold your attention?','Доли дослушиваний и ранних пропусков по дням недели, среди записей с известной длительностью.','Completion and early-skip shares by weekday, for recordings with known duration.'],
  ['concentration','lorenz','habits','Широкий вкус или верные любимцы','A broad rotation or loyal favourites?','Кривая Лоренца: доля времени от менее к более слушаемым песням. Диагональ означает равное время на каждую запись.','Lorenz curve: time share from least to most played recordings. The diagonal means equal time per recording.'],
  ['sessions','box','time','Сколько музыки за один заход','How much music in one sitting?','Минимум, квартиль, медиана, квартиль и максимум времени музыки в сохранённых сессиях. Паузы между песнями сюда не входят.','Minimum, quartiles, median and maximum music time in recorded sessions; gaps between songs are excluded.']
 ];
 const thin=(a,n=180)=>a.length<=n?a:Array.from({length:n},(_,i)=>a[Math.round(i*(a.length-1)/(n-1))]);
 const quantile=(a,p)=>{if(!a.length)return null;const x=(a.length-1)*p,i=Math.floor(x);return a[i]+(a[Math.ceil(x)]-a[i])*(x-i);};
 const cdf=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {points:thin(a.map((v,i)=>({x:v,y:(i+1)/a.length*100,label:String(v)}))),count:a.length,median:quantile(a,.5)};};
 const known=s=>s&&!/^(?:<unknown>|unknown(?: artist| album)?|неизвестн.*|download|telegram|n\/a)$/i.test(s.trim())&&!/https?:\/\//i.test(s);
 function build(tracks,stats,range='28',now=Date.now()){
  const all=Insights.build(tracks,stats,now),map=new Map(tracks.map(t=>[String(t.id),t])),today=new Date(now);today.setHours(0,0,0,0);
  const from=new Date(today);from.setDate(from.getDate()-(range==='90'?89:27));
  if(range==='all')from.setTime(Math.min(today.getTime(),all.plays[0]?.started||now)),from.setHours(0,0,0,0);
  const firstDay=Insights.dayKey(from),dayKeys=[];
  // Bounded chart resolution; exact totals and source counts still use all days.
  const ordinal=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY;
  const span=ordinal(today)-ordinal(from)+1,step=Math.max(1,Math.ceil(span/180));
  for(let i=0;i<span;i+=step){const d=new Date(from);d.setDate(d.getDate()+i);dayKeys.push(Insights.dayKey(d));}
  const bucket=day=>{let lo=0,hi=dayKeys.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(dayKeys[m]<=day)lo=m;else hi=m-1;}return lo;};
  const daily=dayKeys.map(day=>({day,ms:0,unique:new Set(),new:0,returning:0,repeat:0,plays:0,liked:0,other:0,unknown:0,artists:new Map()}));
  const selected=all.plays.filter(p=>p.started>=from.getTime()),first=new Map(),last=new Map(),returned=new Set(),selectedTime=new Map(),trackAttention=new Map(),sessions=new Map(),pairs=new Map();
  const discoveryHours=Array(24).fill(0),outcomes=[0,0,0,0],week=Array.from({length:7},()=>({count:0,completed:0,early:0})),skipTimes=[],coverage=[],gaps=[];
  const qualified=p=>{const duration=Number(p.duration||map.get(p.track)?.duration);return p.heard>=(duration>0?Math.min(30000,Math.max(1000,duration/2)):30000);};
  const title=id=>map.get(id)?.title||'—',artist=t=>known(t?.artist)?t.artist:null;
  for(const p of all.plays)if(qualified(p)){
   if(!first.has(p.track))first.set(p.track,p.started);
   if(Insights.dayKey(first.get(p.track))!==Insights.dayKey(p.started))returned.add(p.track);
  }
  let previous=null;const daySeen=new Map();
  for(const p of selected){
   const t=map.get(p.track),duration=Number(p.duration||t?.duration),index=bucket(Insights.dayKey(p.started)),d=daily[index],isQualified=qualified(p);
   if(isQualified){
    const day=Insights.dayKey(p.started);if(!daySeen.has(day))daySeen.set(day,new Set());const seen=daySeen.get(day);
    d.plays++;if(seen.has(p.track))d.repeat++;seen.add(p.track);d.unique.add(p.track);
    if(first.get(p.track)===p.started){d.new++;discoveryHours[new Date(p.started).getHours()]++;}else d.returning++;
    if(last.has(p.track))gaps.push((p.started-last.get(p.track))/3600000);last.set(p.track,p.started);
    if(previous&&p.session!=null&&p.session!==''&&String(previous.session)===String(p.session)){
     const k=JSON.stringify([previous.track,p.track]);pairs.set(k,(pairs.get(k)||0)+1);
    }
    previous=p;
   }
   const heard=all.playTime.get(JSON.stringify([p.track,p.started]))||0;
   if(p.session!=null&&p.session!=='')sessions.set(String(p.session),(sessions.get(String(p.session))||0)+heard);
   if(p.skipped)skipTimes.push(p.heard/1000);
   if(Number.isFinite(duration)&&duration>0){
    const fraction=Math.min(1,Math.max(0,p.media_heard/duration));coverage.push(fraction*100);
    if(!trackAttention.has(p.track))trackAttention.set(p.track,{sum:0,count:0,duration:duration/60000});
    const a=trackAttention.get(p.track);a.sum+=fraction;a.count++;
    const w=week[(new Date(p.started).getDay()+6)%7];w.count++;
    if(fraction>=.9){outcomes[0]++;w.completed++;}else if(p.skipped&&p.heard<30000){outcomes[1]++;w.early++;}else outcomes[2]++;
   }else outcomes[3]++;
  }
  for(const [day,rows] of all.trackDays){
   if(day<firstDay)continue;const d=daily[bucket(day)];
   for(const [id,ms] of rows){
    d.ms+=ms;selectedTime.set(id,(selectedTime.get(id)||0)+ms);const track=map.get(id),name=artist(track);
    if(name)d.artists.set(name,(d.artists.get(name)||0)+ms);
    if(!track)d.unknown+=ms;else if(track.favorite===1||track.favorite===true)d.liked+=ms;else d.other+=ms;
   }
  }
  const total=[...selectedTime.values()].reduce((s,x)=>s+x,0),totalArtist=new Map(),albumTime=new Map();
  for(const [id,ms] of selectedTime){const t=map.get(id),a=artist(t);if(a)totalArtist.set(a,(totalArtist.get(a)||0)+ms);
   if(known(t?.album)){const k=JSON.stringify([t.artist||'',t.album]);albumTime.set(k,(albumTime.get(k)||0)+ms);}}
  const artistLeaders=[...totalArtist].sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
  const line=(values,unit='count',labels=dayKeys)=>({unit,points:values.map((y,i)=>({x:i,y,label:labels[i]}))});
  const stack=(labels,values,unit='count')=>({unit,labels:dayKeys,series:labels.map((label,i)=>({label,values:values.map(v=>v[i]||0)}))});
  const data={};
  const heat=Array.from({length:7},()=>Array(24).fill(0));
  for(const [day,hours] of all.dayHours)if(day>=firstDay){const row=heat[new Date(day+'T12:00:00').getDay()];hours.forEach((ms,h)=>row[h]+=ms);}
  data.clock={unit:'time',matrix:heat};
  data.variety=line(daily.map(d=>d.unique.size));
  let accumulated=0;data.accumulation=line(daily.map(d=>(accumulated+=d.ms)/60000),'minutes');
  data.discoveries=stack([['Новые','New'],['Возвращения','Returning']],daily.map(d=>[d.new,d.returning]));
  const cohorts=new Map();for(const [id,at] of first){if(at<from.getTime())continue;const date=new Date(at);date.setDate(date.getDate()-(date.getDay()+6)%7);const k=Insights.dayKey(date);if(!cohorts.has(k))cohorts.set(k,{count:0,returned:0});const c=cohorts.get(k);c.count++;if(returned.has(id))c.returned++;}
  data.retention={unit:'percent',rows:[...cohorts].sort((a,b)=>a[0].localeCompare(b[0])).slice(-8).map(([label,v])=>({label,value:v.returned/(v.count||1)*100,detail:`${v.returned} / ${v.count}`}))};
  data.outcomes={unit:'count',rows:[[['Дослушано','Completed'],outcomes[0]],[['Ранний пропуск','Early skip'],outcomes[1]],[['Остальное','Other'],outcomes[2]],[['Нет длительности','No duration'],outcomes[3]]].map(([label,value])=>({label,value}))};
  data.skips={...cdf(skipTimes),xUnit:'seconds',unit:'percent'};data.completion={...cdf(coverage),xUnit:'percent',unit:'percent'};
  data.duration={unit:'percent',xUnit:'minutes',points:[...trackAttention].sort((a,b)=>b[1].count-a[1].count).slice(0,80).map(([id,v])=>({x:v.duration,y:v.sum/v.count*100,r:v.count,label:title(id),liked:!!map.get(id)?.favorite})),count:trackAttention.size};
  data.artists=stack([...artistLeaders,['Другие / без тегов','Other / untagged']],daily.map(d=>[...artistLeaders.map(a=>(d.artists.get(a)||0)/60000),Math.max(0,d.ms-artistLeaders.reduce((s,a)=>s+(d.artists.get(a)||0),0))/60000]),'minutes');
  data.favourites=stack([['Избранное','Favourites'],['Остальная фонотека','Other library songs'],['Вне фонотеки','Outside the library']],daily.map(d=>[d.liked/60000,d.other/60000,d.unknown/60000]),'minutes');
  data.returns={...cdf(gaps),xUnit:'hours',unit:'percent'};
  data.repeat=line(daily.map(d=>d.plays?d.repeat/d.plays*100:0),'percent');
  const knownFirst=[...first].filter(([id])=>map.has(id)).map(([,at])=>Insights.dayKey(at)).sort();let pointer=0;
  data.exploration=line(dayKeys.map((day,i)=>{const end=dayKeys[i+1]||Insights.dayKey(new Date(today.getFullYear(),today.getMonth(),today.getDate()+1));while(pointer<knownFirst.length&&knownFirst[pointer]<end)pointer++;return tracks.length?pointer/tracks.length*100:0;}),'percent');
  data.transitions={unit:'count',rows:[...pairs].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,value])=>{const [a,b]=JSON.parse(k);return {label:title(a),target:title(b),value};})};
  data.albums={unit:'minutes',rows:[...albumTime].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,ms])=>{const [artist,label]=JSON.parse(k);return {label,value:ms/60000,detail:artist};})};
  data.discoveryClock={unit:'count',values:discoveryHours};
  data.weekQuality={unit:'percent',rows:week.map((w,i)=>({day:i,a:w.count?w.completed/w.count*100:0,b:w.count?w.early/w.count*100:0,count:w.count})),labels:[['Дослушано','Completed'],['Ранний пропуск','Early skip']]};
  const sorted=[...selectedTime.values()].filter(v=>v>0).sort((a,b)=>a-b);let sum=0;
  data.concentration={unit:'percent',xUnit:'percent',points:thin([{x:0,y:0},...sorted.map((v,i)=>({x:(i+1)/sorted.length*100,y:(sum+=v)/(total||1)*100}))]),topShare:sorted.slice(-10).reduce((s,v)=>s+v,0)/(total||1)*100,count:sorted.length};
  const sessionTimes=[...sessions.values()].map(v=>v/60000).filter(v=>v>0).sort((a,b)=>a-b);
  data.sessions={unit:'minutes',count:sessionTimes.length,values:[0,.25,.5,.75,1].map(p=>quantile(sessionTimes,p))};
  return {range,total,plays:selected.length,from:firstDay,to:Insights.dayKey(today),resolution:step,cards:definitions.map(([id,type,group,ru,en,description,english])=>({id,type,group,title:[ru,en],description:[description,english],...data[id]}))};
 }
 return {build,definitions};
});

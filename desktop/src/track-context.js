'use strict';
const match=require('./cover-matching');
const versions=[
 [/\bslowed\b/i,'Замедленная версия','Slowed version','Пометка Slowed означает замедленную обработку: ритм растягивается, а звучание часто становится ниже.','Slowed labels a slowed-down edit: the rhythm stretches and pitch often drops.'],
 [/\breverb(?:ed)?\b/i,'Пространство в звуке','Space in the sound','Reverb — реверберация: затухающий звуковой хвост создаёт ощущение пространства вокруг голоса и инструментов. В названии этой версии указана такая обработка.','Reverb adds a decaying tail that creates a sense of space around vocals and instruments. This version is labelled with that effect.'],
 [/\b(?:sped up|speed up|nightcore)\b/i,'Ускоренная версия','Sped-up version','В названии отмечена ускоренная обработка. У таких версий короче длительность и часто выше тон голоса.','The title identifies a sped-up edit. Such versions are shorter and often raise vocal pitch.'],
 [/\bremaster(?:ed)?\b/i,'Новый мастер','Remastered edition','Remaster обычно означает новую обработку существующей записи для выпуска: могут отличаться громкость, динамика и частотный баланс. Это не обязательно новая запись исполнения.','Remaster usually means a new mastering of an existing recording: loudness, dynamics and tonal balance may differ. It does not necessarily mean a newly recorded performance.'],
 [/\b(?:live|concert)\b|концертн/i,'Концертная версия','Live version','Пометка в названии указывает на концертное исполнение. Оно может отличаться аранжировкой, длительностью и звуками зала от студийной версии.','The title labels a live performance, which can differ from a studio recording in arrangement, duration and audience sound.'],
 [/\binstrumental\b|инструментальн/i,'Инструментальная версия','Instrumental version','Так помечают версии без основной вокальной партии: легче услышать ритм, мелодические слои и аранжировку.','This label denotes a version without the main vocal, making the rhythm, melodic layers and arrangement easier to hear.']
];
function build(track,library=[],details={},lang='ru'){
 const ru=lang!=='en',cards=[],text=String(track.title||'');
 // Only edition labels, never words inside a song title such as “Live Forever”.
 const labels=[...text.matchAll(/[([]([^()[\]]+)[)\]]/g)].map(m=>m[1]);
 const suffix=text.match(/\s+[-–—]\s+(.+)$/);if(suffix)labels.push(suffix[1]);
 const marked=versions.filter(([pattern])=>labels.some(label=>pattern.test(label)));
 if(marked.length)cards.push({heading:ru?'Что это за версия':'About this version',text:marked.map(row=>row[ru?3:4]).join('\n\n'),source:'title'});
 const identity=match.metadata(track);
 if(identity){
  const related=library.filter(t=>String(t.id)!==String(track.id)&&match.matches({artistName:t.artist,trackName:t.title},identity));
  if(related.length){
   const time=ms=>{const sec=Math.floor(Number(ms)/1000);return sec>0?`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`:'';};
   cards.push({heading:ru?'Одна песня — разные версии':'One song, different versions',text:(ru?'В твоей фонотеке также есть: ':'Also in your library: ')+related.slice(0,3).map(t=>`«${t.title}»${time(t.duration)?' ('+time(t.duration)+')':''}`).join('; ')+'.',source:'library'});
  }
  const names=new Set(match.artists(track.artist).map(match.norm));
  const siblings=library.filter(t=>String(t.id)!==String(track.id)&&match.artists(t.artist).some(a=>names.has(match.norm(a))));
  if(siblings.length&&!related.length)cards.push({heading:ru?'Связь с твоей коллекцией':'Connected to your collection',text:ru?`Ещё треков с этими исполнителями в фонотеке: ${siblings.length}. Среди них — ${siblings.slice(0,3).map(t=>'«'+t.title+'»').join(', ')}.`:`Other tracks with these performers in your library: ${siblings.length}, including ${siblings.slice(0,3).map(t=>'“'+t.title+'”').join(', ')}.`,source:'library'});
 }
 const days=details.days?.size||0,plays=details.behavior?.qualified||0;
 if(days>1&&plays)cards.push({heading:ru?'Песня, к которой ты возвращаешься':'A song you return to',text:ru?`В сохранённой истории она звучала в ${days} разных дней. Учтено прослушиваний: ${plays}. Эти числа относятся только к истории этого плеера.`:`Your saved history includes this song on ${days} different days and ${plays} counted listens. These figures cover this player’s history only.`,source:'history'});
 if(!cards.length){
  const added=Number(track.added),date=added>0&&added<=Date.now()?new Date(added).toLocaleDateString(ru?'ru-RU':'en-US',{day:'numeric',month:'long',year:'numeric'}):null;
  cards.push({heading:ru?'Эта запись в твоей коллекции':'This recording in your collection',text:date?(ru?`По данным фонотеки запись добавлена ${date}. `:`Library metadata dates this addition to ${date}. `):'',source:'library'});
  cards[0].text+=plays?(ru?`Учтено прослушиваний: ${plays}.`:`Counted listens: ${plays}.`):(ru?'Прослушивания ещё не накопились. Здесь будет появляться твоя история с этой записью.':'There are no counted listens yet. Your history with this recording will appear here.');
 }
 return cards;
}
module.exports={build};

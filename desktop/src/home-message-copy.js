/* Each family expresses a different observation or a usable suggestion. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.HomeMessageCopy=factory();
})(globalThis,()=>{
  'use strict';
  const families={
    ritual:{group:'rhythm',ru:['С треком «{title}» за четыре недели было {daySpan}.'],en:['“{title}” played on {days} of the last 28 days.']},
    comeback:{group:'return',ru:['После {daySpanGen} паузы снова звучал трек «{title}».'],en:['“{title}” made a comeback after {daySpan}.']},
    recent:{group:'suggestion',ru:['Захочется знакомого — включите «{title}».','Продолжите с недавнего трека «{title}».'],en:['For something familiar, play “{title}”.','Pick up with a recent track, “{title}”.']},
    fresh:{group:'discovery',ru:['Недавно впервые звучал трек «{title}».','Из недавних находок можно переслушать «{title}».'],en:['A recent first listen was “{title}”.','Revisit a recent discovery, “{title}”.']},
    past:{group:'return',ru:['Трек «{title}» звучал {daySpan} назад.','Попробуйте снова включить «{title}» после долгой паузы.'],en:['Your last recorded listen to “{title}” was {daySpan} ago.','Try “{title}” again after {daySpan} away.']},
    favorite:{group:'collection',ru:['Поставьте старое доброе «{title}» из избранного.','Из избранного сегодня можно включить «{title}».'],en:['Put on a favourite, “{title}”.','Pick “{title}” from your favourites today.']},
    favoriteReturn:{group:'return',ru:['После {daySpanGen} паузы можно вернуть в очередь «{title}».'],en:['Try favourite “{title}” again after {daySpan} away.']},
    favoriteUnheard:{group:'suggestion',ru:['В избранном есть «{title}», его ещё нет в истории.'],en:['Favourite “{title}” has no recorded listen here yet.']},
    repeat:{group:'repeat',ru:['У трека «{title}» уже {listenCount}.','«{title}» вы включали снова и снова — всего {listenCount}.'],en:['“{title}” has reached {listenCount}.','You keep coming back to “{title}” — {listenCount} so far.']},
    firstThen:{group:'return',ru:['«{title}» впервые звучал {daySpan} назад.'],en:['Your first recorded listen to “{title}” was {daySpan} ago.']},
    foundAgain:{group:'discovery',ru:['К недавней находке «{title}» вы вернулись в другой день.'],en:['You came back to the recent discovery “{title}” on another day.']},
    trackTime:{group:'repeat',ru:['На трек «{title}» уже пришлось {time}.'],en:['You’ve spent {time} with “{title}”.']},
    unexplored:{group:'collection',ru:['Впереди ещё {trackCount} без записи в истории.','Сколько ещё музыки впереди — {trackCount}.'],en:['There are {trackCount} still without a recorded listen.','Your library still has {trackCount} to explore.']},
    explored:{group:'collection',ru:['В истории уже есть {percent}% вашей фонотеки.'],en:['Your history now covers {percent}% of your library.']},
    almostAll:{group:'milestone',ru:['До знакомства со всей фонотекой осталось {trackCount}.'],en:['Only {trackCount} left to hear across your library.']},
    allHeard:{group:'milestone',ru:['В вашей истории есть каждый трек из фонотеки.','Фонотека пройдена целиком — хороший повод вернуться к старому.'],en:['Every track in your library appears in your history.','You’ve explored the whole library — time for a return visit.']},
    discoveries:{group:'discovery',ru:['{trackCount} впервые попали в историю за последние 30 дней.'],en:['{trackCount} entered your listening history in the past 30 days.']},
    retained:{group:'repeat',ru:['К {ratio} новых треков вы вернулись в другой день.'],en:['You revisited {ratio} new tracks on another day.']},
    today:{group:'time',ru:['Сегодня музыка звучала уже {time}.'],en:['You’ve listened for {time} today.']},
    week:{group:'time',ru:['За семь дней с музыкой набралось {time}.'],en:['The past seven days held {time} of listening.']},
    weekUp:{group:'trend',ru:['За неделю музыки стало на {percent}% больше.','Нынешняя неделя обогнала прошлую по музыке на {percent}%.'],en:['Listening is up {percent}% over the previous week.','This week has {percent}% more music than the last.']},
    weekDown:{group:'trend',ru:['За неделю музыки стало на {percent}% меньше.'],en:['Listening is down {percent}% from the previous week.']},
    weekActive:{group:'rhythm',ru:['Из последних семи дней с музыкой — {daySpan}.'],en:['Music played on {days} of the last seven days.']},
    streak:{group:'milestone',ru:['С музыкой уже {daySpan} подряд.'],en:['You’ve had music for {daySpan} in a row.']},
    activeDays:{group:'rhythm',ru:['За четыре недели с музыкой набралось {daySpan}.'],en:['Music played on {days} of the last 28 days.']},
    peakHour:{group:'rhythm',ru:['Самый музыкальный час по истории — {hour}.'],en:['Your busiest hour for music is {hour}.']},
    recordDay:{group:'milestone',ru:['Ваш рекорд за день — {time} музыки.'],en:['Your busiest listening day reached {time}.']},
    outside:{group:'collection',ru:['За пределами избранного — {percent}% времени с музыкой.'],en:['{percent}% of listening time was outside your favourites.']},
    range:{group:'suggestion',ru:['Сегодня на выбор два недавних трека — «{title}» и «{otherTitle}».','Недавно звучали «{title}» и «{otherTitle}» — с чего начнёте?'],en:['Two recent picks to revisit — “{title}” and “{otherTitle}”.','Start with either recent pick, “{title}” or “{otherTitle}”.']},
    empty:{group:'start',ru:['Добавьте несколько треков, которые хочется переслушать.','Начните фонотеку с альбома, к которому давно не возвращались.','Соберите здесь музыку для следующей прогулки.','Добавьте любимый альбом и включите его с начала.'],en:['Add a few tracks you’d like to hear again.','Start with an album you haven’t revisited in a while.','Collect some music for your next walk.','Add a favourite album and play it from the start.']},
    ready:{group:'start',ru:['Для первого прослушивания подойдёт «{title}».','Начните с любого трека, например «{title}».'],en:['Try “{title}” for your first listen.','Start anywhere — “{title}”, for example.']}
  };
  return {families};
});

/* Explanatory controls, separate from the player: no user library or audio. */
(() => {
 const tabs=[...document.querySelectorAll('[data-dj]')],panel=document.querySelector('#dj-explanation'),study=document.querySelector('.sound-study');
 const explanations={
  sound:['Одинаковый темп ещё не значит похожую музыку.','PAIN анализирует короткие фрагменты треков и сохраняет звуковой профиль. Так у подбора появляется опора в самом аудио, даже когда в тегах пусто или указан канал загрузки.'],
  taste:['Один пропуск — ещё не история отношений.','Лайки и прослушивания помогают узнать ваш вкус. Пропуски учитываются вместе с контекстом: поиск нужной песни и устойчивое нежелание слушать похожее — разные ситуации. По мере прослушивания подбор уточняется.'],
  freedom:['Близко к вашему вкусу. Открыто новому.','Следующий трек выбирается среди нескольких подходящих кандидатов, а не всегда с первого места. Сохраните вайб, чтобы остаться в нужном звучании, или отпустите его для свободного подбора. Все кандидаты — из вашей фонотеки.']
 };
 let transition;
 function select(tab){
  const value=explanations[tab.dataset.dj];if(!value)return;
  transition?.cancel();
  tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;});
  panel.setAttribute('aria-labelledby',tab.id);panel.querySelector('h3').textContent=value[0];panel.querySelector('p').textContent=value[1];study.dataset.view=tab.dataset.dj;
  transition=window.PainMotion?.animate(panel,[{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:330});
 }
 for(const tab of tabs){tab.addEventListener('click',()=>select(tab));tab.addEventListener('keydown',event=>{
  let index=tabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%tabs.length;else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;
  event.preventDefault();tabs[index].focus();select(tabs[index]);
 });}
 const habits=[...document.querySelectorAll('.habit-details details')];
 habits.forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open)for(const other of habits)if(other!==detail)other.open=false;}));
})();

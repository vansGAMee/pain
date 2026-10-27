(function(){
 'use strict';
 const root=document.getElementById('insightGallery'),grid=document.getElementById('insightGalleryGrid'),status=document.getElementById('insightGalleryStatus');if(!root)return;
 const ru=()=>localStorage.getItem('pain_lang')!=='en',t=(a,b)=>ru()?a:b,pick=s=>Array.isArray(s)?s[ru()?0:1]:String(s??'');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const palette=['#826394','#548b82','#b98b49','#688bb2','#bd747d','#94995e'];
 const weekdays=()=>ru()?['пн','вт','ср','чт','пт','сб','вс']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 let worker,sequence=0,range='all',group='all',cards=new Map(),fingerprint='',timer;
 const active=()=>!document.hidden&&document.getElementById('view-insights')?.classList.contains('active');
 const motion=()=>!document.documentElement.hasAttribute('data-reduced-motion')&&document.documentElement.dataset.performanceMode!=='maximum'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const value=(n,unit)=>{
  if(!Number.isFinite(n))return '—';
  if(unit==='percent')return Math.round(n)+'%';if(unit==='time')return value(n/60000,'minutes');
  if(unit==='minutes')return n>=60?`${Math.floor(n/60)} ${t('ч','h')} ${Math.round(n%60)} ${t('мин','m')}`:`${n<10?Number(n.toFixed(1)):Math.round(n)} ${t('мин','m')}`;
  if(unit==='seconds')return Math.round(n)+' '+t('с','s');if(unit==='hours')return Number(n.toFixed(n<10?1:0))+' '+t('ч','h');return Number(n.toFixed(n<10?1:0)).toLocaleString(ru()?'ru-RU':'en-US');
 };
 const label=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?new Date(s+'T12:00:00').toLocaleDateString(ru()?'ru-RU':'en-US',{day:'numeric',month:'short'}):pick(s);
 const empty=()=>`<text x="240" y="118" text-anchor="middle" class="ic-empty">${t('Для этого графика пока мало истории','Not enough history for this chart yet')}</text>`;
 const tip=(text,extra='')=>`data-ic-tip="${esc(text)}" ${extra}`;
 const text=(x,y,s,extra='')=>`<text x="${x}" y="${y}" ${extra}>${esc(s)}</text>`;
 const axis=(max,unit,xLabels=[])=>[0,.5,1].map(f=>`<path d="M42 ${202-f*166}H464" class="ic-gridline"/>`+text(34,206-f*166,value(f*max,unit),'text-anchor="end" class="ic-axis"')).join('')+xLabels.map(([x,s])=>text(x,225,label(s),'text-anchor="middle" class="ic-axis"')).join('');
 function path(points,x,y){return points.map((p,i)=>(i?'L':'M')+x(p.x).toFixed(2)+','+y(p.y).toFixed(2)).join(' ');}
 function drawing(c){
  const rows=c.rows||[],points=c.points||[],unit=c.unit;
  if(['line','area','cdf','lorenz','scatter'].includes(c.type)){
   if(!points.length||!points.some(p=>p.y>0))return empty();
   const maxX=Math.max(...points.map(p=>p.x),1),maxY=unit==='percent'?100:Math.max(...points.map(p=>p.y),1),x=v=>42+422*v/maxX,y=v=>202-166*v/maxY;
   const first=points[0],last=points.at(-1),xLabels=c.xUnit?[[42,value(0,c.xUnit)],[253,value(maxX/2,c.xUnit)],[464,value(maxX,c.xUnit)]]:[[42,first.label],[464,last.label]];
   let out=axis(maxY,unit,xLabels);
   if(c.type==='scatter')return out+points.map(p=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${Math.min(14,3+Math.sqrt(p.r))}" fill="${p.liked?palette[4]:palette[0]}" fill-opacity=".62" class="ic-dot" ${tip(`${p.label}\n${value(p.x,c.xUnit)} · ${value(p.y,unit)}\n${t('Прослушиваний','Listens')}: ${p.r}`)}/>`).join('');
   if(c.type==='lorenz')out+='<path d="M42 202L464 36" class="ic-reference"/>';
   const d=path(points,x,y);
   if(c.type==='area')out+=`<path d="${d}L${x(last.x)} 202L${x(first.x)} 202Z" class="ic-area" fill="${palette[0]}"/>`;
   out+=`<path d="${d}" class="ic-line" pathLength="1" stroke="${palette[0]}"/>`;
   out+=points.filter((p,i)=>points.length<48||i===0||i===points.length-1).map(p=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="3.5" fill="${palette[0]}" class="ic-dot" ${tip(`${c.xUnit?value(p.x,c.xUnit):label(p.label)} · ${value(p.y,unit)}`)}/>`).join('');
   return out;
  }
  if(c.type==='stack'||c.type==='stream'){
   const n=c.labels.length;if(!n||!c.series.some(s=>s.values.some(v=>v>0)))return empty();
   const totals=c.labels.map((_,i)=>c.series.reduce((sum,s)=>sum+s.values[i],0)),max=Math.max(...totals,1),x=i=>42+i*422/Math.max(n-1,1),y=v=>202-166*v/max;
   let out=axis(max,unit,[[42,c.labels[0]],[464,c.labels.at(-1)]]),base=Array(n).fill(0);
   c.series.forEach((series,k)=>{
    if(c.type==='stream'){
     const upper=series.values.map((v,i)=>({x:i,y:base[i]+v})),lower=base.map((v,i)=>({x:i,y:v})).reverse();
     out+=`<path d="${path(upper,x,y)} ${path(lower,x,y).replace(/^M/,'L')}Z" fill="${palette[k%6]}" fill-opacity=".82" class="ic-fade" ${tip(pick(series.label)+' · '+value(series.values.reduce((s,v)=>s+v,0),unit))}/>`;
    }else{
     const w=422/n;
     out+=series.values.map((v,i)=>v?`<rect x="${42+i*w+1}" y="${y(base[i]+v)}" width="${Math.max(.5,w-2)}" height="${166*v/max}" fill="${palette[k%6]}" class="ic-grow-y" ${tip(`${label(c.labels[i])}\n${pick(series.label)} · ${value(v,unit)}`)}/>`:'').join('');
    }
    base=base.map((v,i)=>v+series.values[i]);
   });return out;
  }
  if(c.type==='heat'){
   const vals=c.matrix.flat(),max=Math.max(...vals,1);if(!vals.some(Boolean))return empty();
   let out='';for(let d=0;d<7;d++){
    out+=text(30,52+d*23,weekdays()[d],'text-anchor="end" class="ic-axis"');
    for(let h=0;h<24;h++){const ms=c.matrix[(d+1)%7][h];out+=`<rect x="${42+h*17.5}" y="${37+d*23}" width="15" height="19" rx="3" fill="${palette[0]}" fill-opacity="${ms?.2+.8*ms/max:.055}" class="ic-cell" ${tip(`${weekdays()[d]} ${String(h).padStart(2,'0')}:00 · ${value(ms,'time')}`)}/>`;}
   }for(let h=0;h<24;h+=4)out+=text(49+h*17.5,220,String(h).padStart(2,'0'),'text-anchor="middle" class="ic-axis"');return '<g class="ic-fade">'+out+'</g>';
  }
  if(c.type==='donut'){
   const total=rows.reduce((s,r)=>s+r.value,0);if(!total)return empty();let offset=0;
   return rows.map((r,i)=>{const share=r.value/total*100,arc=`<circle cx="137" cy="116" r="71" pathLength="100" fill="none" stroke="${palette[i%6]}" stroke-width="23" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-offset}" transform="rotate(-90 137 116)" class="ic-fade" ${tip(`${pick(r.label)} · ${r.value} (${Math.round(share)}%)`)}/>`;offset+=share;return arc;}).join('')+text(137,116,value(total,'count'),'text-anchor="middle" class="ic-donut-value"')+text(137,137,t('прослушиваний','listens'),'text-anchor="middle" class="ic-axis"')+rows.map((r,i)=>`<circle cx="257" cy="${61+i*35}" r="4" fill="${palette[i%6]}"/>`+text(271,66+i*35,pick(r.label),'class="ic-legend-text"')+text(454,66+i*35,Math.round(r.value/total*100)+'%','text-anchor="end" class="ic-axis"')).join('');
  }
  if(c.type==='hbars'||c.type==='lollipop'){
   if(!rows.length)return empty();const max=c.unit==='percent'?100:Math.max(...rows.map(r=>r.value),1),space=178/rows.length;
   return rows.map((r,i)=>{const y=35+i*space,x=185+228*r.value/max;return text(174,y+4,label(r.label).slice(0,25),'text-anchor="end" class="ic-axis"')+`<path d="M185 ${y}H413" class="ic-gridline"/>`+(c.type==='lollipop'?`<path d="M185 ${y}H${x}" stroke="${palette[0]}" stroke-width="3" class="ic-line" pathLength="1"/><circle cx="${x}" cy="${y}" r="5" fill="${palette[0]}" ${tip(`${pick(r.label)} · ${value(r.value,unit)}\n${r.detail||''}`)}/>`:`<rect x="185" y="${y-5}" width="${Math.max(0,x-185)}" height="10" rx="5" fill="${palette[0]}" class="ic-grow-x" ${tip(`${label(r.label)} · ${value(r.value,unit)}\n${r.detail||''}`)}/>`)+text(466,y+4,value(r.value,unit),'text-anchor="end" class="ic-axis"');}).join('');
  }
  if(c.type==='links'){
   if(!rows.length)return empty();const max=Math.max(...rows.map(r=>r.value),1),space=180/rows.length;
   return rows.map((r,i)=>{const y=30+i*space;return `<path d="M165 ${y}C220 ${y-18},265 ${y+18},320 ${y}" stroke="${palette[i%6]}" style="stroke-width:${1+5*r.value/max}" fill="none" class="ic-line" pathLength="1" ${tip(`${r.label} → ${r.target} · ${r.value}`)}/><circle cx="165" cy="${y}" r="3" fill="${palette[i%6]}"/><circle cx="320" cy="${y}" r="3" fill="${palette[i%6]}"/>`+text(154,y+4,r.label.slice(0,24),'text-anchor="end" class="ic-axis"')+text(331,y+4,r.target.slice(0,22),'class="ic-axis"');}).join('');
  }
  if(c.type==='radial'){
   if(!c.values.some(Boolean))return empty();const max=Math.max(...c.values,1),point=(angle,r)=>[240+Math.sin(angle)*r,118-Math.cos(angle)*r];
   let out=[35,60,85].map(r=>`<circle cx="240" cy="118" r="${r}" class="ic-gridcircle"/>`).join('');
   c.values.forEach((v,h)=>{const a=h/24*Math.PI*2,[x,y]=point(a,35),[xx,yy]=point(a,35+60*v/max);out+=`<path d="M${x} ${y}L${xx} ${yy}" stroke="${palette[h<12?0:1]}" stroke-width="9" stroke-linecap="round" class="ic-line" pathLength="1" ${tip(`${String(h).padStart(2,'0')}:00 · ${v}`)}/>`;if(h%6===0){const [tx,ty]=point(a,107);out+=text(tx,ty+4,String(h).padStart(2,'0'),'text-anchor="middle" class="ic-axis"');}});return out;
  }
  if(c.type==='dumbbell'){
   if(!rows.some(r=>r.count))return empty();return rows.map((r,i)=>{const y=32+i*26,a=83+340*r.a/100,b=83+340*r.b/100;return text(53,y+4,weekdays()[i],'class="ic-axis"')+`<path d="M${Math.min(a,b)} ${y}H${Math.max(a,b)}" stroke="var(--border-strong)" stroke-width="3"/><circle cx="${a}" cy="${y}" r="5" fill="${palette[0]}" class="ic-dot" ${tip(`${weekdays()[i]} · ${pick(c.labels[0])}: ${value(r.a,'percent')} · n=${r.count}`)}/><circle cx="${b}" cy="${y}" r="4" fill="${palette[4]}" class="ic-dot" ${tip(`${weekdays()[i]} · ${pick(c.labels[1])}: ${value(r.b,'percent')} · n=${r.count}`)}/>`;}).join('');
  }
  if(c.type==='box'){
   if(!c.count)return empty();const max=Math.max(c.values[4],1),x=v=>42+422*v/max,[min,q1,median,q3,high]=c.values;
   return axis(1,'count',[[42,value(0,'minutes')],[464,value(max,'minutes')]]).replace(/<text[^>]*class="ic-axis"[^>]*>[^<]*<\/text>/g,'')+`<path d="M${x(min)} 110H${x(high)}" stroke="${palette[0]}" stroke-width="2"/><rect x="${x(q1)}" y="75" width="${Math.max(1,x(q3)-x(q1))}" height="70" rx="8" fill="${palette[0]}" fill-opacity=".2" class="ic-grow-x"/><path d="M${x(median)} 75V145" stroke="${palette[0]}" stroke-width="3"/>`+c.values.map((v,i)=>`<circle cx="${x(v)}" cy="110" r="5" fill="${palette[0]}" class="ic-dot" ${tip(`${['min','Q1',t('Медиана','Median'),'Q3','max'][i]} · ${value(v,'minutes')}`)}/>`).join('')+text(42,202,value(min,'minutes'),'class="ic-axis"')+text(253,202,t('Медиана: ','Median: ')+value(median,'minutes'),'text-anchor="middle" class="ic-axis"')+text(464,202,value(high,'minutes'),'text-anchor="end" class="ic-axis"');
  }
  return empty();
 }
 function legend(c){
  const entries=c.type==='stream'||c.type==='stack'?c.series.map((s,i)=>[s.label,palette[i%6]]):c.type==='dumbbell'?c.labels.map((s,i)=>[s,palette[i?4:0]]):[];
  return entries.map(([s,color])=>`<span><i style="background:${color}"></i>${esc(pick(s))}</span>`).join('');
 }
 function summary(c){
  if(c.type==='cdf')return c.count?`${t('Медиана','Median')}: ${value(c.median,c.xUnit)} · n=${c.count}`:t('Пока нет событий','No events yet');
  if(c.type==='box')return `${c.count} ${t('сохранённых сессий','recorded sessions')}`;
  if(c.type==='scatter')return `${c.count} ${t('разных записей','distinct recordings')}`;
  if(c.type==='lorenz')return `${t('10 самых слушаемых','Top 10 recordings')}: ${value(c.topShare,'percent')} ${t('всего времени','of all time')}`;
  return '';
 }
 function mount(card){
  if(card.dataset.mounted)return;const c=cards.get(card.dataset.chart);if(!c)return;
  card.querySelector('.insight-plot').innerHTML=`<svg viewBox="0 0 480 240" role="img" aria-label="${esc(pick(c.title)+'. '+pick(c.description))}">${drawing(c)}</svg><div class="ic-tooltip" role="status" hidden></div>`;
  card.querySelector('.insight-legend').innerHTML=legend(c);card.dataset.mounted='true';card.classList.toggle('ic-animate',motion());
 }
 function table(c){
  let rows=[];
  if(c.points)rows=c.points.map(p=>[c.xUnit?value(p.x,c.xUnit):label(p.label),value(p.y,c.unit),p.r?`${p.r} ${t('прослушиваний','listens')}`:'']);
  else if(c.series)rows=c.labels.map((day,i)=>[label(day),...c.series.map(s=>pick(s.label)+': '+value(s.values[i],c.unit))]);
  else if(c.type==='heat')for(let d=0;d<7;d++)for(let h=0;h<24;h++)rows.push([weekdays()[d]+' '+String(h).padStart(2,'0')+':00',value(c.matrix[(d+1)%7][h],'time')]);
  else if(c.type==='box')rows=['min','Q1',t('Медиана','Median'),'Q3','max'].map((s,i)=>[s,value(c.values[i],'minutes')]);
  else if(c.type==='radial')rows=c.values.map((v,h)=>[String(h).padStart(2,'0')+':00',value(v,c.unit)]);
  else if(c.type==='dumbbell')rows=c.rows.map((r,i)=>[weekdays()[i],pick(c.labels[0])+': '+value(r.a,'percent'),pick(c.labels[1])+': '+value(r.b,'percent'),'n='+r.count]);
  else rows=(c.rows||[]).map(r=>[label(r.label),r.target||'',value(r.value,c.unit),r.detail||'']);
  return `<table><tbody>${rows.map(r=>`<tr>${r.filter(s=>s!=='').map(s=>`<td>${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 }
 const observer=new IntersectionObserver(entries=>{for(const e of entries){e.target.classList.toggle('ic-visible',e.isIntersecting);if(e.isIntersecting)mount(e.target);}},{rootMargin:'80px 0px',threshold:.05});
 function render(report){
  const open=new Set([...grid.querySelectorAll('details[open]')].map(d=>d.closest('[data-chart]').dataset.chart));
  for(const node of grid.children)observer.unobserve(node);cards=new Map(report.cards.map(c=>[c.id,c]));
  grid.innerHTML=report.cards.map(c=>`<article class="insight-figure" data-chart="${c.id}" data-group="${c.group}"${group!=='all'&&group!==c.group?' hidden':''}><div class="insight-figure-heading"><h3>${esc(pick(c.title))}</h3><p>${esc(pick(c.description))}</p></div><div class="insight-plot"></div><div class="insight-legend"></div><p class="insight-figure-summary">${esc(summary(c))}</p><details class="ic-data"${open.has(c.id)?' open':''}><summary>${t('Посмотреть числа','View the numbers')}</summary><div></div></details></article>`).join('');
  for(const node of grid.children)observer.observe(node);
  status.textContent=t(`${report.plays.toLocaleString('ru-RU')} событий · ${value(report.total,'time')} · наведи на график, чтобы увидеть точные значения.`,`${report.plays.toLocaleString('en-US')} events · ${value(report.total,'time')} · hover for exact values.`)+(report.resolution>1?t(` Одна точка: ${report.resolution} дней.`,` One point: ${report.resolution} days.`):'');
 }
 function refresh(force=false){
  if(!active())return;
  if(!worker){worker=new Worker('insight-charts-worker.js');worker.onmessage=({data})=>{if(data.id!==sequence)return;root.setAttribute('aria-busy','false');if(data.error){status.textContent=t('Не удалось прочитать историю.','Could not read listening history.');return;}const key=JSON.stringify([ru(),data.result]);if(key!==fingerprint){fingerprint=key;render(data.result);}};worker.onerror=()=>{status.textContent=t('Не удалось построить графики.','Could not build charts.');root.setAttribute('aria-busy','false');};}
  root.setAttribute('aria-busy','true');worker.postMessage({id:++sequence,range,force});
 }
 root.addEventListener('click',event=>{
  const rangeButton=event.target.closest('[data-insight-range]'),groupButton=event.target.closest('[data-insight-group]');
  if(rangeButton){range=rangeButton.dataset.insightRange;root.querySelectorAll('[data-insight-range]').forEach(b=>b.setAttribute('aria-pressed',String(b===rangeButton)));refresh();}
  if(groupButton){group=groupButton.dataset.insightGroup;root.querySelectorAll('[data-insight-group]').forEach(b=>b.setAttribute('aria-pressed',String(b===groupButton)));for(const card of grid.children)card.hidden=group!=='all'&&card.dataset.group!==group;}
  if(event.target.closest('[data-insight-replay]')&&motion()){
   const visible=[...grid.children].filter(c=>c.classList.contains('ic-visible'));for(const c of visible)c.classList.remove('ic-animate');requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const c of visible)c.classList.add('ic-animate');}));
  }
 });
 grid.addEventListener('toggle',event=>{const d=event.target;if(d.matches?.('details.ic-data')&&d.open&&!d.dataset.loaded){const c=cards.get(d.closest('[data-chart]').dataset.chart);if(c){d.querySelector('div').innerHTML=table(c);d.dataset.loaded='true';}}},true);
 let hoverFrame=0,hover;
 grid.addEventListener('pointermove',event=>{
  hover={target:event.target,x:event.clientX,y:event.clientY};if(hoverFrame)return;
  hoverFrame=requestAnimationFrame(()=>{
   hoverFrame=0;const {target,x,y}=hover,plot=target.closest('.insight-plot');if(!plot)return;
   const tooltip=plot.querySelector('.ic-tooltip'),mark=target.closest('[data-ic-tip]'),rect=plot.getBoundingClientRect(),c=cards.get(plot.closest('[data-chart]').dataset.chart);let message=mark?.dataset.icTip;
   if(!message&&c?.points?.length&&c.type!=='scatter'){
    const desired=Math.max(0,Math.min(1,(480*(x-rect.left)/rect.width-42)/422))*Math.max(...c.points.map(p=>p.x),1);
    const p=c.points.reduce((best,p)=>Math.abs(p.x-desired)<Math.abs(best.x-desired)?p:best,c.points[0]);message=(c.xUnit?value(p.x,c.xUnit):label(p.label))+' · '+value(p.y,c.unit);
   }
   if(!message){tooltip.hidden=true;return;}tooltip.hidden=false;tooltip.textContent=message;tooltip.style.left=Math.max(8,Math.min(x-rect.left,rect.width-190))+'px';tooltip.style.top=Math.max(8,y-rect.top-60)+'px';
  });
 });
 grid.addEventListener('pointerout',event=>{const plot=event.target.closest('.insight-plot');if(plot&&!plot.contains(event.relatedTarget))plot.querySelector('.ic-tooltip').hidden=true;});
 function visibility(){root.classList.toggle('ic-paused',!active());if(!active()){clearTimeout(timer);return;}clearTimeout(timer);timer=setTimeout(()=>refresh(),150);}
 window.addEventListener('pain:view',visibility);window.addEventListener('pain:insights',()=>{clearTimeout(timer);timer=setTimeout(()=>refresh(true),150);});
 window.addEventListener('pain:performance',()=>{for(const card of grid.children)card.classList.toggle('ic-animate',motion());});
 function motionUI(){const replay=root.querySelector('[data-insight-replay]');replay.disabled=!motion();replay.title=motion()?t('Повторить анимацию','Replay animation'):t('Анимация отключена в настройках движения или производительности','Animation is disabled by your motion or performance settings');for(const card of grid.children)card.classList.toggle('ic-animate',motion());}
 new MutationObserver(motionUI).observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced-motion','data-performance-mode']});motionUI();
 document.addEventListener('visibilitychange',visibility);visibility();
})();

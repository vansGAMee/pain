'use strict';
document.documentElement.classList.add('js-ready');
// Static first: every page and download works before JavaScript or the network.
const repo='https://github.com/vansGAMee/pain';
const base=repo+'/releases/download/v1.7.2/';
const releases={
 windows:{name:'Windows',file:'Pain-v1.7.2.exe',size:39012052,info:'Windows 10 и новее · без установки',label:'Скачать .exe',sha:'804db6a8aa08121b17ad0de4ff3229b9883cf8fc3f75bfd6705168380d6f5230'},
 android:{name:'Android',file:'Pain-v1.7.2-Android.apk',size:7158841,info:'Android 8 и новее · приложение для телефона',label:'Скачать .apk',sha:'48c9206908e036dd7b339441f9a1d41c7fdf55b646a832f28951401c810656d1'},
 linux:{name:'Linux',file:'Pain-v1.7.2-Linux.tar.gz',size:471880,info:'Node.js 18+ · архив с плеером',label:'Скачать .tar.gz',sha:'fcc4b6b91f9b0e618203778f057b25998615912e3b52b3c552b84d24020e5ad0'}
};
for(const data of Object.values(releases))data.url=base+data.file;
let platform=/Android/i.test(navigator.userAgent)?'android':/Linux|X11/i.test(navigator.userAgent)?'linux':'windows';
let toastTimer;
function announce(text){const box=document.querySelector('.toast');box.textContent=text;box.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('visible'),4000);}
const menu=document.querySelector('.menu-toggle'),nav=document.querySelector('#navigation');
function closeMenu(){menu.setAttribute('aria-expanded','false');nav.classList.remove('open');}
menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
nav.addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.getAttribute('aria-expanded')==='true'){closeMenu();menu.focus();}});
document.addEventListener('click',e=>{if(!e.target.closest('.header'))closeMenu();});
const currentPage=location.pathname.split('/').pop().replace(/\.html$/,'');
for(const link of nav.querySelectorAll('a'))if(currentPage&&new URL(link.href).pathname.split('/').pop().replace(/\.html$/,'')===currentPage)link.setAttribute('aria-current','page');
function revealAnchor(){const id=decodeURIComponent(location.hash.slice(1));const target=document.getElementById(id);if(target?.tagName==='DETAILS')target.open=true;}
window.addEventListener('hashchange',revealAnchor);try{revealAnchor();}catch(_){}

const screenNames={player:'Плеер',library:'Фонотека',insights:'Статистика',karaoke:'Тексты'};
const tabs=[...document.querySelectorAll('[data-screen]')];let screen='player',screenRequest=0;
function selectTab(name){for(const tab of tabs){const active=tab.dataset.screen===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}}
async function showScreen(name){
 if(!screenNames[name])return;const request=++screenRequest,previous=screen;
 selectTab(name);const panel=document.querySelector('#screen-panel');panel.setAttribute('aria-busy','true');
 try{
  const sources=['desktop','android'].map(device=>device==='desktop'?`assets/screenshots/tour-${name}.png`:`assets/screenshots/android_${name}.png`);
  await Promise.all(sources.map(src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=src;})));
  if(request!==screenRequest)return;
  screen=name;
  for (const [index,id] of ['desktop-preview','phone-preview'].entries()) {
    const image=document.getElementById(id);
    if(window.PainMotion) PainMotion.swapImage(image,sources[index]); else image.src=sources[index];
  }
  document.querySelector('#desktop-preview').alt=`${screenNames[name]} PAIN на ПК, демонстрационная коллекция`;document.querySelector('#phone-preview').alt=`${screenNames[name]} PAIN на Android`;
  document.querySelector('#screen-caption').textContent=screenNames[name];
  const descriptions={player:'Тактильный винил, мягкий свет и музыка на первом плане. На большом экране и в ладони.',library:'Свои альбомы, любимые треки и порядок, который вы выбираете сами. Вся коллекция в одном месте.',insights:'Календарь прослушиваний, привычки и возвращения. История, которая постепенно становится вашей.',karaoke:'Крупный синхронный текст. Добавляйте свои слова и отмечайте строки в момент звучания.'};
  const description=document.querySelector('#tour-description');if(description)description.textContent=descriptions[name];
  panel.setAttribute('aria-labelledby','screen-'+name);
 }catch(_){if(request===screenRequest){selectTab(previous);announce('Скриншот не загрузился. Попробуйте ещё раз.');}}
 finally{if(request===screenRequest)panel.setAttribute('aria-busy','false');}
}
for(const tab of tabs){tab.addEventListener('click',()=>showScreen(tab.dataset.screen));tab.addEventListener('keydown',e=>{
 let index=tabs.indexOf(tab);if(e.key==='ArrowRight')index=(index+1)%tabs.length;else if(e.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;
 e.preventDefault();tabs[index].focus();showScreen(tabs[index].dataset.screen);
});}
const lightbox=document.querySelector('.lightbox');let lastZoom;
for(const button of document.querySelectorAll('[data-zoom]'))button.addEventListener('click',()=>{const source=button.querySelector('img');lastZoom=button;const image=lightbox.querySelector('img');image.src=source.src;image.alt=source.alt;lightbox.showModal();});
lightbox.querySelector('button').addEventListener('click',()=>lightbox.close());
lightbox.addEventListener('click',e=>{if(e.target===lightbox){const b=lightbox.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)lightbox.close();}});
lightbox.addEventListener('close',()=>lastZoom?.focus({preventScroll:true}));
for(const detail of document.querySelectorAll('.detail-list details'))detail.addEventListener('toggle',()=>{if(detail.open)for(const other of document.querySelectorAll('.detail-list details'))if(other!==detail)other.open=false;});

const download=document.querySelector('#download-link');
function renderDownload(){
 if(!download)return;const data=releases[platform];
 document.querySelector('#download-platform').textContent='PAIN для '+data.name;
 document.querySelector('#download-info').textContent=data.info;document.querySelector('#download-label').textContent=data.label;download.href=data.url;
 document.querySelector('#download-size').textContent=data.size>=1048576?(data.size/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ':Math.round(data.size/1024)+' КБ';
 document.querySelector('#install-help').href='guide.html#'+platform;
 document.querySelector('#copy-checksum').hidden=!data.sha;
 for(const button of document.querySelectorAll('[data-platform]'))button.setAttribute('aria-pressed',String(button.dataset.platform===platform));
}
for(const button of document.querySelectorAll('[data-platform]'))button.addEventListener('click',()=>{if(releases[button.dataset.platform]){platform=button.dataset.platform;renderDownload();}});
renderDownload();
document.querySelector('#copy-checksum')?.addEventListener('click',async()=>{const sha=releases[platform].sha;if(!sha)return;try{await navigator.clipboard.writeText(sha);announce('SHA-256 скопирован');}catch(_){announce('Копирование недоступно. Откройте файл контрольных сумм ниже.');}});
// Update only complete public releases. Offline and API limits keep the verified links above.
async function refreshRelease(){
 if(!download)return;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
 try{
  const response=await fetch('https://api.github.com/repos/vansGAMee/pain/releases/latest',{signal:controller.signal,headers:{Accept:'application/vnd.github+json'}});
  if(!response.ok)return;const release=await response.json();
  if(release.draft||release.prerelease||!/^v\d+\.\d+\.\d+$/.test(release.tag_name)||!Array.isArray(release.assets))return;
  const assets=release.assets.filter(a=>a.state==='uploaded'&&typeof a.browser_download_url==='string'&&a.browser_download_url.startsWith(repo+'/releases/download/'+release.tag_name+'/'));
  const patterns={windows:/^Pain-v[\d.]+\.exe$/i,android:/^Pain-v[\d.]+-Android\.apk$/i,linux:/^Pain-v[\d.]+-Linux\.tar\.gz$/i};
  const matches=Object.fromEntries(Object.entries(patterns).map(([key,pattern])=>[key,assets.find(a=>pattern.test(a.name))]));
  if(Object.values(matches).some(a=>!a||!Number.isFinite(a.size)||a.size<=0))return;
  for(const [key,a] of Object.entries(matches))Object.assign(releases[key],{file:a.name,size:a.size,url:a.browser_download_url,sha:/^sha256:[a-f0-9]{64}$/i.test(a.digest||'')?a.digest.slice(7):null});
  for(const element of document.querySelectorAll('[data-version]'))element.textContent=release.tag_name.slice(1);
  document.querySelector('[data-release]').href=repo+'/releases/tag/'+release.tag_name;
  for(const [selector,pattern] of [['[data-windows-zip]',/-Windows\.zip$/i],['[data-source]',/-Source\.zip$/i],['[data-checksums]',/^SHA256SUMS.*\.txt$/i]]){
   const asset=assets.find(a=>pattern.test(a.name)),link=document.querySelector(selector);link.hidden=!asset;if(asset)link.href=asset.browser_download_url;
  }
  renderDownload();
 }catch(_){}finally{clearTimeout(timer);}
}
window.addEventListener('load',refreshRelease,{once:true});

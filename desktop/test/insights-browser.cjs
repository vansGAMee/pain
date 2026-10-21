const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('pain_lang','ru'));
  const tracks=[{id:'night',title:'Ночная сторона города',artist:'Электронные сны',duration:180000,favorite:1},
   {id:'long',title:'Город, который никогда не засыпает — длинная версия для ночных прогулок',artist:'Север',duration:180000},
   {id:'silent',title:'<img src=x onerror=alert(1)>',duration:180000}];
  const now=new Date(),plays=[];
  for(let day=0;day<28;day++){
   const started=new Date(now.getFullYear(),now.getMonth(),now.getDate()-day,0).getTime();
   if(day%5===0)continue;
   for(let i=0;i<day%7+1;i++)plays.push({id:`${day}-${i}`,track:day%3?'night':'long',started:started+i*200000,heard:180000,duration:180000,finished:1});
  }
  plays.push({id:'old',track:'long',started:Date.now()-65*86400000,heard:180000,duration:180000});
  let empty=false;
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
   if(url.pathname.startsWith('/api/'))return json(url.pathname==='/api/saved-library'?{tracks}:url.pathname==='/api/saved-stats'?{plays:empty?[]:plays,slices:[]}:url.pathname==='/api/cached-tracks'?{cached:[]}:[]);
   if(url.origin!=='http://pain.test')return route.abort();
   const file=url.pathname.startsWith('/assets/')?path.join(__dirname,'..',url.pathname):path.join(__dirname,'../src',url.pathname==='/'?'index.html':url.pathname);
   try{await route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){await route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test/#insights');
  await page.locator('.listening-detail-card').first().waitFor();
  assert.equal(await page.locator('.listening-detail-card').count(),6);
  assert.equal(await page.locator('.listening-calendar-day').count(),28);
  assert.equal(await page.locator('#listeningDetailCards img').count(),0);
  assert.ok((await page.locator('#listeningDetailCards').textContent()).includes('Долгожданное возвращение'));
  await page.locator('.listening-calendar-day').first().focus();
  assert.equal(await page.locator('.listening-day-tooltip').first().isVisible(),true);
  await page.locator('.listening-details').screenshot({path:'/tmp/pain-insights-desktop.png'});
  await page.setViewportSize({width:850,height:1000});
  const overflow=await page.locator('.listening-detail-card').evaluateAll(cards=>cards.some(c=>c.scrollWidth>c.clientWidth+1));
  assert.equal(overflow,false,'cards must wrap long titles at narrow desktop widths');
  await page.locator('#langToggle').click();
  assert.ok((await page.locator('#listeningDetailCards').textContent()).includes('Discoveries that stayed'));
  empty=true;await page.reload();await page.locator('.listening-detail-card').first().waitFor();
  assert.equal(await page.locator('.listening-calendar-day[data-level="0"]').count(),28);
  const text=await page.locator('#listeningDetailCards').textContent();assert.ok(!text.includes('NaN')&&!text.includes('Infinity'));
  assert.deepEqual(errors,[]);console.log('PASS: six metrics, calendar, focus details, long titles, localization and empty history');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

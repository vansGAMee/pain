// Isolated fixture: never contacts the user's phone or library.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage(),errors=[],likes=[],syncs=[];page.on('pageerror',e=>errors.push(e.message));
  const track={id:'song',title:'Ночная волна',artist:'Исполнитель',duration:180000,favorite:0};
  let release,arrived;const received=new Promise(r=>arrived=r);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   const json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
   if(url.pathname==='/api/sync-phone'){
    syncs.push(request.postDataJSON());
    if(syncs.length===1){arrived();await new Promise(r=>release=r);}
    return json({library:{tracks:[{...track,favorite:syncs.length===1?0:1}]},stats:{plays:[],slices:[]}});
   }
   if(url.pathname==='/api/sync-like'){likes.push(request.postDataJSON());return json({status:'ok',syncedToPhone:true});}
   if(url.pathname.startsWith('/api/'))return json(url.pathname==='/api/saved-library'?{tracks:[track]}:url.pathname==='/api/saved-stats'?{plays:[],slices:[]}:url.pathname==='/api/cached-tracks'?{cached:[]}:[]);
   if(url.origin!=='http://pain.test')return route.abort();
   const file=url.pathname.startsWith('/assets/')?path.join(__dirname,'..',url.pathname):path.join(__dirname,'../src',url.pathname==='/'?'index.html':url.pathname);
   try{return await route.fulfill({contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://pain.test');
  const favorite=page.locator(':is(.row-fav-btn,.card-fav-btn):visible').first();await favorite.waitFor();
  await page.locator('#phoneIpInput').evaluate(input=>input.value='http://phone.test:8865/');
  await page.locator('#syncAllBtn').evaluate(button=>button.click());await received;
  await page.locator('#syncAllBtn').evaluate(button=>button.click());
  const likeResponse=page.waitForResponse(r=>r.url().endsWith('/api/sync-like'));await favorite.click();await likeResponse;
  const response=page.waitForResponse(r=>r.url().endsWith('/api/sync-phone'));release();await response;
  await page.waitForFunction(()=>!document.getElementById('progressBanner')?.classList.contains('active'));
  assert.equal(syncs.length,1,'overlapping exchanges');assert.equal(syncs[0].phoneUrl,'http://phone.test:8865');
  assert.equal(likes.length,1,'duplicate relay');assert.equal(likes[0].favorite,1);
  assert.equal(await favorite.evaluate(b=>b.classList.contains('active')),true,'stale snapshot cannot undo a like');
  const next=page.waitForResponse(r=>r.url().endsWith('/api/sync-phone'));await page.locator('#syncAllBtn').evaluate(button=>button.click());await next;
  assert.equal(await favorite.evaluate(b=>b.classList.contains('active')),true);
  assert.deepEqual(errors,[]);console.log('PASS: manual address, single exchange, like during sync, no rollback or page errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

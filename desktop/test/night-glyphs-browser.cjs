// Compare actual painted glyphs, including ink outside tight line boxes.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const samples=[
 ['Geist','Добрый вечер',false,'ltr',700],['Manrope','Добрый вечер',false,'ltr',700],
 ['Noto Serif','Добрый вечер, музыка',true,'ltr',700],['Noto Serif','Good evening, gypsy',true,'ltr',700],
 ['Manrope','Chào buổi tối',false,'ltr',700],['Noto Sans Arabic','مساء الخير',false,'rtl',700],
 ['Noto Sans Devanagari','शुभ संध्या',false,'ltr',700],['Noto Sans Thai','สวัสดีตอนเย็น',false,'ltr',700],
 ['Noto Sans CJK JP','こんばんは、音楽',false,'ltr',700],['Noto Serif','Добрый вечер, музыка',true,'ltr',260]
];
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pain-glyphs-')),browser=await chromium.launch({headless:true,args:['--disable-lcd-text']});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:900}}),source=path.resolve(__dirname,'../src'),old=process.env.PAIN_METAL_CSS_FILE;
  await page.route('http://glyph.test/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<html data-theme="form-night"><head><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/font-settings.css"><link rel="stylesheet" href="/form-night-theme.css"><style>body{display:block;background:#0d0d0d}#sample{margin:30px;padding:55px 50px;background:#0d0d0d;width:850px;min-height:210px}#target{font-size:72px;line-height:1.05;width:700px;margin:0;overflow:visible}.view-pane{display:block}</style></head><body><div id="sample" class="view-pane active"><h1 id="target" class="view-heading">Добрый вечер</h1></div><script>const cadence=new Map;let id=0;const nativeTimeout=setTimeout,nativeClear=clearTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===14000||ms>=65000&&ms<=110000){const key=--id;cadence.set(key,fn);return key;}return nativeTimeout(fn,ms,...args)};window.clearTimeout=key=>{if(key<0)cadence.delete(key);else nativeClear(key)};window.fireNight=()=>{const item=cadence.entries().next().value;if(!item)throw Error('No decorative timer');cadence.delete(item[0]);item[1]()};</script><script src="/form-night-motion.js"></script></body></html>`});
   const file=url.pathname.startsWith('/assets/')?path.resolve(source,'..','.'+url.pathname):old&&url.pathname==='/form-night-theme.css'?old:path.resolve(source,'.'+url.pathname);
   try{return route.fulfill({contentType:({'.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[path.extname(file)]||'application/octet-stream',body:await fs.readFile(file)});}catch(_){return route.fulfill({status:404,body:''});}
  });
  await page.goto('http://glyph.test');await page.evaluate(()=>document.fonts.ready);const reports=[];
  for(let i=0;i<samples.length;i++){
   const [font,text,italic,direction,width]=samples[i];
   await page.evaluate(({font,text,italic,direction,width})=>{window.dispatchEvent(new Event('pain:theme'));const e=document.getElementById('target');document.documentElement.dataset.appFont='test';document.documentElement.style.setProperty('--app-font',JSON.stringify(font));e.style.fontStyle=italic?'italic':'normal';e.style.direction=direction;e.style.width=width+'px';e.textContent=text;},{font,text,italic,direction,width});
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(300);
   const aria=await page.locator('#target').ariaSnapshot(),before=await page.locator('#target').boundingBox();
   const baseline=path.join(root,i+'-base.png'),during=path.join(root,i+'-glint.png');await page.locator('#sample').screenshot({path:baseline});
   await page.evaluate(()=>{window.fireNight();for(const a of document.getElementById('target').getAnimations({subtree:true}))if(a.animationName==='night-metal'){a.pause();a.currentTime=650;}});
   assert.equal(await page.locator('#target').textContent(),text);assert.deepEqual(await page.locator('#target').boundingBox(),before,'glint must not move the layout');
   if(!old)assert.equal(await page.locator('#target').ariaSnapshot(),aria,'decorative text must not be read twice');
   await page.locator('#sample').screenshot({path:during});
   const pixels=JSON.parse(execFileSync('python3',['-W','ignore::DeprecationWarning','-c',"from PIL import Image\nimport sys,json\na=Image.open(sys.argv[1]).convert('RGB');b=Image.open(sys.argv[2]).convert('RGB');pairs=list(zip(a.getdata(),b.getdata()));print(json.dumps({'lost':sum(min(x)>85 and max(y)<45 for x,y in pairs),'changed':sum(x!=y for x,y in pairs)}))",baseline,during],{encoding:'utf8'}));
   reports.push({font,text,wrapped:width<300,...pixels});if(!old)assert.equal(pixels.lost,0,JSON.stringify(reports.at(-1)));
   if(i===2&&!old)await page.screenshot({path:'/tmp/pain-metal-glyphs.png'});
  }
  if(old)assert.ok(reports.some(r=>r.lost>0),'the original clipping must be reproduced');
  else{
   assert.ok(reports.some(row=>row.changed>0),'the highlight must actually be painted');
   await page.evaluate(()=>document.getElementById('target').textContent='New language during a glint');await page.waitForFunction(()=>!document.querySelector('.night-metal-glint'));
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#target').evaluate(e=>getComputedStyle(e).webkitTextFillColor),await page.locator('#target').evaluate(e=>getComputedStyle(e).color));
  }
  console.log(JSON.stringify({original:!!old,samples:reports}));
 }finally{await browser.close();await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});

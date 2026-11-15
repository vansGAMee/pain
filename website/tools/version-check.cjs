const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 try{
  for(const route of ['/','/guide.html','/inside.html']){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.github.com/repos/vansGAMee/pain/releases/latest',r=>r.fulfill({json:{tag_name:'v9.9.9',draft:false,prerelease:false,assets:['Setup.exe','Android.apk','Linux.AppImage'].map(s=>({name:'Pain-v9.9.9-'+s,state:'uploaded',size:100,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/vansGAMee/pain/releases/download/v9.9.9/Pain-v9.9.9-'+s}))}}));
   await page.goto((process.env.PAIN_SITE_URL||'http://127.0.0.1:4173')+route);
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-version]')].every(e=>e.textContent==='9.9.9'));
   assert.ok((await page.locator('[data-version]').count())>0);assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: current release updates every download label on home, guide and inside');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const test=require('node:test'),assert=require('node:assert/strict');
const install=require('../src/runtime-pytorch'),artifacts=require('../src/pytorch-artifacts.json');
test('CPU installation uses the alternative official CDN directly with pinned hashes for both platforms',async()=>{
 for(const platform of ['win32','linux']){
  const calls=[],sources=[];await install(async args=>calls.push(args),{python:'private-python',platform,onSource:host=>sources.push(host)});
  assert.equal(calls.length,1);assert.deepEqual(sources,['download.pytorch.org']);
  const urls=calls[0].filter(x=>x.startsWith('https://download.'));assert.equal(urls.length,3);
  for(const url of urls){const u=new URL(url);assert.equal(u.hostname,'download.pytorch.org');assert.match(decodeURIComponent(u.pathname),/\+cpu-cp311-cp311-/);assert.match(u.hash,/^#sha256=[a-f0-9]{64}$/);assert.ok(artifacts[platform].some(w=>url.endsWith(w.file+'#sha256='+w.sha256)));}
  assert.ok(calls[0].includes('https://pypi.org/simple'));assert.ok(!calls[0].includes('https://download.pytorch.org/whl/cpu'));
 }
});
test('a CDN timeout switches to the other official CDN with exactly the same files and hashes',async()=>{
 const calls=[];await install(async args=>{calls.push(args);if(calls.length===1)throw Error('error sending request: operation timed out');},{python:'private-python',platform:'win32'});
 assert.equal(calls.length,2);const urls=args=>args.filter(x=>/^https:\/\/download(?:-r2)?\.pytorch\.org\//.test(x));
 assert.deepEqual(urls(calls[1]).map(u=>u.replace('download-r2.','download.')),urls(calls[0]));
});
test('integrity failures and cancellation never retry through another source',async()=>{
 for(const scenario of ['integrity','cancel']){
  let calls=0;const controller=new AbortController();
  await assert.rejects(install(async()=>{calls++;if(scenario==='cancel')controller.abort();throw Error(scenario==='cancel'?'connection cancelled':'error downloading: hash mismatch');},{python:'private-python',platform:'win32',signal:controller.signal}));
  assert.equal(calls,1);
 }
});

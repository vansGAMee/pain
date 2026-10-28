const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const safety=require('../src/http-safety');
test('local API rejects foreign sites, rebinding hosts and oversized/chunked requests; native clients still work',async t=>{
 const server=http.createServer((req,res)=>{const url=safety.guard(req,res);if(!url)return;safety.readBody(req,res,1024,body=>res.end(body||'ok'));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port,root='http://127.0.0.1:'+port;
 const request=(headers={},data,method='GET')=>new Promise((resolve,reject)=>{const req=http.request(root+'/api/test',{method,headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);if(data)req.write(data);req.end();});
 assert.equal((await request()).status,200);assert.equal((await request({Origin:root},'{}','POST')).status,200);
 for(const headers of [{Origin:'https://evil.example'},{Origin:'null'},{Host:'evil.example:'+port},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request(headers,'{}','POST')).status,403);
 assert.equal((await request({},'x'.repeat(2048),'POST')).status,413);
 assert.equal((await request({'Content-Length':String(200*1024*1024)},undefined,'POST')).status,413);
 const good=await request();assert.equal(good.headers['access-control-allow-origin'],undefined);assert.equal(good.headers['x-content-type-options'],'nosniff');assert.equal(good.headers['x-frame-options'],'DENY');
});
test('static file lookup cannot leave its root through traversal or a symlink',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-static-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'public'));fs.writeFileSync(path.join(root,'secret'),'private');fs.writeFileSync(path.join(root,'public','index.html'),'page');
 assert.ok(await safety.staticFile(path.join(root,'public'),'index.html'));assert.equal(await safety.staticFile(path.join(root,'public'),'../secret'),null);
 if(process.platform!=='win32'){fs.symlinkSync(path.join(root,'secret'),path.join(root,'public','escape'));assert.equal(await safety.staticFile(path.join(root,'public'),'escape'),null);}
});
test('real server preserves music and playlists after hostile or interrupted writes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-security-'));for(const dir of ['data','cache','covers'])fs.mkdirSync(path.join(root,dir));
 const audio=Buffer.alloc(8192,7),cover=Buffer.alloc(4096,8);fs.writeFileSync(path.join(root,'cache','song.mp3'),audio);fs.writeFileSync(path.join(root,'covers','song.jpg'),cover);fs.writeFileSync(path.join(root,'data','playlists.json'),'[]');fs.writeFileSync(path.join(root,'data','last_phone_ip.txt'),'127.0.0.1:9');
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{env:{...process.env,PORT:String(port),PAIN_DATA_DIR:root,PAIN_DISCOVERY:'false',PAIN_PULSEFLOW_AUTO_INDEX:'false',OPEN_BROWSER:'false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}fs.rmSync(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Startup timeout')),5000);child.stdout.on('data',b=>{output+=b;if(output.includes('Web UI:')){clearTimeout(timer);resolve();}});child.once('error',reject);});
 const base='http://127.0.0.1:'+port,post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers,body});
 assert.equal((await post('/api/delete-cache','{"clearAll":true}',{Origin:'https://evil.example'})).status,403);assert.deepEqual(fs.readFileSync(path.join(root,'cache/song.mp3')),audio);
 assert.equal((await post('/api/playlists','broken JSON')).status,400);assert.equal(fs.readFileSync(path.join(root,'data/playlists.json'),'utf8'),'[]');
 const lists=[{id:'mine',name:'Мой плейлист',trackIds:['song'],custom:'preserved'}];assert.equal((await post('/api/playlists',JSON.stringify(lists),{Origin:base})).status,200);assert.deepEqual(await (await fetch(base+'/api/playlists')).json(),lists);
 assert.equal((await post('/api/save-audio',audio,{'X-Filename':'%bad'})).status,400);
 for(const [route,headers]of [['/api/save-cover/song',{}],['/api/save-audio',{'X-Track-Id':'song'}]]){
  await new Promise(resolve=>{const req=http.request(base+route,{method:'POST',headers:{...headers,'Content-Length':65536}},()=>{});req.on('error',()=>{});req.write(Buffer.alloc(512,9));setTimeout(()=>{req.destroy();resolve();},40);});
 }
 await new Promise(r=>setTimeout(r,100));assert.deepEqual(fs.readFileSync(path.join(root,'cache/song.mp3')),audio);assert.deepEqual(fs.readFileSync(path.join(root,'covers/song.jpg')),cover);assert.equal(fs.readdirSync(path.join(root,'cache')).filter(f=>f.includes('.tmp')).length,0);assert.equal(fs.readdirSync(path.join(root,'covers')).filter(f=>f.includes('.tmp')).length,0);
 const outside=Buffer.alloc(8192,65);fs.writeFileSync(path.join(root,'secret.txt'),outside);await post('/api/save-library',JSON.stringify({tracks:[{id:'escape',title:'Escape',artist:'Fixture',path:'../secret.txt'}]}));
 const escaped=await fetch(base+'/api/cached-track/escape');assert.notEqual(escaped.status,200);assert.notDeepEqual(Buffer.from(await escaped.arrayBuffer()),outside);
 const response=await fetch(base+'/api/cached-track/song',{headers:{Range:'bytes=100-199'}});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),audio.subarray(100,200));
});

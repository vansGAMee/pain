const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),WebSocket=require('ws');
test('self-hosted TLS certificate is pinned before any room credential or HTTP path is sent',async t=>{
 try{execFileSync('openssl',['version'],{stdio:'ignore'});}catch(_){t.skip('OpenSSL is required to generate an isolated test certificate');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pain-relay-cert-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const key=path.join(root,'key.pem'),cert=path.join(root,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 const certificate=new crypto.X509Certificate(fs.readFileSync(cert)),pin=crypto.createHash('sha256').update(certificate.raw).digest('hex');
 let requests=0;const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{requests++;res.end('ok');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const connection=require('../src/listen/connection'),base='https://127.0.0.1:'+server.address().port;
 const wrong=connection(base,'0'.repeat(64));t.after(()=>wrong.close());
 await assert.rejects(new Promise((resolve,reject)=>{const request=wrong.request('/room-secret',{method:'GET'},resolve);request.on('error',reject);request.end();}),/Сертификат/);assert.equal(requests,0);
 const right=connection(base,pin);t.after(()=>right.close());const result=await new Promise((resolve,reject)=>{const request=right.request('/health',{method:'GET'},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end();});assert.equal(result,200);assert.equal(requests,1);
 assert.throws(()=>connection('http://example.com'),/HTTPS/);assert.throws(()=>connection(base,'bad'),/SHA-256/);
});

'use strict';
const os=require('node:os'),path=require('node:path'),fs=require('node:fs');
// pkg's virtual filesystem supports callback realpath; its promises.realpath
// asks Windows for nonexistent C:\snapshot files and makes the whole UI 404.
const realpath=require('node:util').promisify(fs.realpath);
const MiB=1024*1024;
let localHosts,hostsUntil=0;
function trustedHosts(){
 if(localHosts&&Date.now()<hostsUntil)return localHosts;
 localHosts=new Set(['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),os.hostname().toLowerCase()+'.local']);
 for(const rows of Object.values(os.networkInterfaces()))for(const row of rows||[])localHosts.add(row.address.toLowerCase());
 hostsUntil=Date.now()+5000;return localHosts;
}
function reject(req,res,status,message){
 if(res.headersSent||res.destroyed)return;
 res.writeHead(status,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify({error:message}));req.resume();
}
function bodyLimit(pathname){
 if(['/api/upload-to-phone','/api/save-audio'].includes(pathname))return 1024*MiB;
 if(pathname.startsWith('/api/save-cover/'))return 8*MiB;
 if(pathname==='/api/backup/import')return 100*MiB;
 if(pathname==='/api/save-stats')return 64*MiB;
 return 32*MiB;
}
function guard(req,res){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
 let url;
 try{
  if(!req.url.startsWith('/')||req.url.startsWith('//')||!req.headers.host)throw Error();
  const base=new URL('http://'+req.headers.host);if(base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error();
  const host=base.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if(!trustedHosts().has(host))return reject(req,res,403,'Unrecognized local host');
  url=new URL(req.url,base);decodeURIComponent(url.pathname);
  if(req.headers.origin&&req.headers.origin!==base.origin)return reject(req,res,403,'Cross-origin request denied');
  if(req.headers['sec-fetch-site']==='cross-site'&&url.pathname.startsWith('/api/'))return reject(req,res,403,'Cross-site request denied');
 }catch(_){return reject(req,res,400,'Invalid request URL');}
 if(req.headers['content-length']&&Number(req.headers['content-length'])>bodyLimit(url.pathname))return reject(req,res,413,'Request too large');
 if(req.method==='OPTIONS'){
  res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, PUT, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Filename, X-Pain-Update, Range');res.writeHead(204);res.end();return;
 }
 return url;
}
function readBody(req,res,limit,done){
 let size=0,chunks=[],failed=false;
 if(Number(req.headers['content-length'])>limit){reject(req,res,413,'Request too large');return;}
 req.on('error',()=>{failed=true;chunks=[];});req.on('aborted',()=>{failed=true;chunks=[];});
 req.on('data',chunk=>{if(failed)return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
  if(size>limit){failed=true;chunks=[];reject(req,res,413,'Request too large');}else chunks.push(bytes);
 });
 req.on('end',()=>{if(!failed&&!res.destroyed)try{Promise.resolve(done(Buffer.concat(chunks,size).toString('utf8'))).catch(()=>reject(req,res,500,'Request failed'));}catch(_){reject(req,res,500,'Request failed');}});
}
function limitUpload(req,res,stream,file,limit){
 let size=0,stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;req.unpipe(stream);stream.destroy();stream.once('close',()=>fs.promises.unlink(file).catch(()=>{}));};
 req.on('aborted',stop);req.on('error',stop);
 req.on('data',chunk=>{size+=chunk.length;if(size>limit&&!stopped){stop();reject(req,res,413,'File too large');}});
 res.on('close',()=>{if(!req.complete)stop();});
}
async function staticFile(root,relative){
 const base=path.resolve(root),candidate=path.resolve(base,relative),within=file=>file===base||file.startsWith(base+path.sep);
 if(!within(candidate))return null;
 try{const real=await realpath(candidate);if(!within(real))return null;const stat=await fs.promises.stat(real);return stat.isFile()?{file:real,size:stat.size}:null;}catch(_){return null;}
}
module.exports={guard,readBody,limitUpload,staticFile,bodyLimit};

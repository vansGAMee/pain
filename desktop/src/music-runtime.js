// Per-user tools and Python. Never install into or modify the system Python.
const fs=require('node:fs'),path=require('node:path');
module.exports=function musicRuntime(dataDir,options={}){
 const sourceDir=options.sourceDir||__dirname,platform=options.platform||process.platform;
 const packaged=options.packaged??(sourceDir.includes('app.asar')||!!process.pkg);
 const root=options.root||(packaged?path.dirname(dataDir):path.join(sourceDir,'..'));
 const home=path.join(root,'.pain-runtime'),bin=path.join(home,'bin');
 const python=process.env.PAIN_PULSEFLOW_PYTHON||path.join(root,'.pulseflow-venv',platform==='win32'?'Scripts/python.exe':'bin/python');
 const stateFile=path.join(home,'install-state.json');
 let sources=sourceDir.replace('app.asar','app.asar.unpacked');
 if(process.pkg&&!options.sourceDir)sources=path.join(home,'sources',require('../package.json').version,'src');
 const readState=()=>{try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch(_){return {};}};
 function installed(){
  if(!fs.existsSync(python))return false;
  if(process.env.PAIN_PULSEFLOW_PYTHON)return true;
  const state=readState();return !state.managed||state.state==='ready';
 }
 function env(){
  const result=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
  const delimiter=platform==='win32'?';':':';
  result[platform==='win32'?'Path':'PATH']=[bin,...(process.env.PATH||process.env.Path||'').split(delimiter).filter(p=>p&&p!==bin)].join(delimiter);
  return {...result,UV_CACHE_DIR:path.join(home,'cache'),UV_PYTHON_INSTALL_DIR:path.join(home,'python'),
   UV_NO_PROGRESS:'1',UV_LINK_MODE:'copy',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1',
   OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1',MKL_NUM_THREADS:'1'};
 }
 async function ensureSources(){
  if(!process.pkg||options.sourceDir)return;
  if(fs.existsSync(path.join(sources,'.complete')))return;
  const copy=async(from,to)=>{await fs.promises.mkdir(to,{recursive:true});for(const item of await fs.promises.readdir(from,{withFileTypes:true})){
   if(item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;
   const a=path.join(from,item.name),b=path.join(to,item.name);if(item.isDirectory())await copy(a,b);else if(item.isFile())await fs.promises.copyFile(a,b);
  }};
  for(const folder of ['personal','vendor/pulseflow','pulseflow'])await copy(path.join(sourceDir,folder),path.join(sources,folder));
  await fs.promises.writeFile(path.join(sources,'.complete'),'ready');
 }
 return {root,home,bin,python,stateFile,sources,platform,installed,readState,env,ensureSources};
};

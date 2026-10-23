const fs=require('fs'),path=require('path'),os=require('os'),{execFile}=require('child_process');
function apply(){
 if(process.platform!=='win32'||!process.pkg)return;
 try{
  // Keep the icon outside the temporary/archive/executable download location.
  const directory=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Pain','shell');
  fs.mkdirSync(directory,{recursive:true});
  const icon=path.join(directory,'app-icon.ico'),script=path.join(directory,'window-identity.ps1');
  fs.writeFileSync(icon,fs.readFileSync(path.join(__dirname,'..','assets','app-icon.ico')));
  fs.writeFileSync(script,fs.readFileSync(path.join(__dirname,'windows-identity.ps1')));
  execFile('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',script,'-Executable',process.execPath,'-IconPath',icon],{windowsHide:true,timeout:25000},()=>{});
 }catch(_){/* Shell branding cannot prevent playback or trigger a relaunch. */}
}
module.exports={apply};

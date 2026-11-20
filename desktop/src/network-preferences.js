'use strict';
const fs=require('node:fs'),path=require('node:path');
const {safeWrite}=require('./data-guard');
const defaults={sync:'auto',covers:'current',profileGenres:true,lyricsAhead:false,trackInfoAuto:false,autoUpdates:true,autoUpdateDownloads:false};
const choices={sync:['auto','sparse','manual'],covers:['current','visible']};

module.exports=function networkPreferences(dir){
 const file=path.join(dir,'network-preferences.json');
 const normalize=input=>Object.fromEntries(Object.entries(defaults).map(([key,initial])=>[
  key,(choices[key]?.includes(input?.[key])||typeof initial==='boolean'&&typeof input?.[key]==='boolean')?input[key]:initial
 ]));
 let state={...defaults};
 try{state=normalize(JSON.parse(fs.readFileSync(file,'utf8')));}catch(_){}
 return {
  state:()=>state,
  update(input){
   const next=normalize({...state,...input});
   if(JSON.stringify(next)!==JSON.stringify(state)){safeWrite(file,next);state=next;}
   return state;
  }
 };
};

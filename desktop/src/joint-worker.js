/* Isolated inference: messages contain snapshots; no user storage is written. */
importScripts('/audio-timbre.js','/audio-profile.js','/taste-model.js','/joint-ai.js');
self.onmessage=async({data})=>{
  try{self.postMessage({result:await JointAI.generateJointPlaylist(data.songs,data.localTracks,data.base,data.options)});}
  catch(error){self.postMessage({error:String(error?.message||error)});}
};

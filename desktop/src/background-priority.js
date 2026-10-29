// Analysis yields CPU time to the audio renderer and native decoder.
const os=require('node:os');
module.exports=child=>{
 child.once('spawn',()=>{try{os.setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch(_){}});
 return child;
};

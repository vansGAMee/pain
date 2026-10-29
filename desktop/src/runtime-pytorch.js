// The CPU index now points at download-r2, which can be unreachable on some ISPs.
// Both official CDNs serve the same pinned wheels; hashes come from that index.
const artifacts=require('./pytorch-artifacts.json');
const hosts=['download.pytorch.org','download-r2.pytorch.org'];
const networkFailure=error=>/timed?\s*out|timeout|connect|network|dns|failed to fetch|error (?:sending|downloading)|http (?:error )?(?:403|408|429|5\d\d)/i.test(String(error.message));
module.exports=async function installPytorch(run,{python,platform,signal,onSource=()=>{}}){
 const wheels=artifacts[platform];if(!wheels)throw Error('Unsupported PyTorch platform');
 for(let index=0;index<hosts.length;index++){
  if(signal?.aborted)throw Error('Installation cancelled');
  const host=hosts[index];await onSource(host);
  const urls=wheels.map(w=>`https://${host}/whl/cpu/${w.file}#sha256=${w.sha256}`);
  try{return await run(['--no-config','pip','install','--python',python,...urls,'--index-url','https://pypi.org/simple']);}
  catch(error){if(signal?.aborted||index===hosts.length-1||/hash (?:mismatch|check)|checksum|integrity/i.test(error.message)||!networkFailure(error))throw error;}
 }
};

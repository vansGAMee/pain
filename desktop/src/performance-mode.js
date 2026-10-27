(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PerformanceMode=factory();})(globalThis,()=>{
 const modes={
  full:{ saver:false,discoveryMs:5000,coverPollMs:5000 },
  balanced:{ saver:true,discoveryMs:15000,coverPollMs:10000 },
  maximum:{ saver:true,discoveryMs:60000,coverPollMs:20000 }
 };
 const normalize=value=>Object.hasOwn(modes,value)?value:'balanced';
 return {normalize,get:value=>modes[normalize(value)]};
});

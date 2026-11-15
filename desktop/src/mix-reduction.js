// Frequency cuts and centre-channel attenuation. This does not separate stems.
// Native audio nodes only: no analysis loop, model, download or extra decoder.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MixReduction=factory();})(globalThis,()=>{
 const keys=['vocal','bass','mid','treble'];
 function normalize(value){
  return Object.fromEntries(keys.map(key=>{const n=Number(value?.[key]);return [key,Number.isFinite(n)?Math.max(0,Math.min(100,n)):0];}));
 }
 function create(context){
  const input=context.createGain(),dry=context.createGain(),output=context.createGain();
  input.connect(dry);dry.connect(output);
  let wet=null,filters=null,centre=null,disposed=false;
  const nodes=[input,dry,output],targets=new WeakMap();
  function gain(value){const node=context.createGain();node.gain.value=value;nodes.push(node);return node;}
  function filter(type,frequency,q=1){
   const node=context.createBiquadFilter();node.type=type;node.frequency.value=Math.min(frequency,context.sampleRate*.45);node.Q.value=q;node.gain.value=0;nodes.push(node);return node;
  }
  function set(param,value){
   if(targets.get(param)===value)return;const now=context.currentTime;
   if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
   else {const held=param.value;param.cancelScheduledValues(now);param.setValueAtTime(held,now);}
   param.setTargetAtTime(value,now,.025);targets.set(param,value);
  }
  function build(){
   const stereo=gain(1);stereo.channelCount=2;stereo.channelCountMode='explicit';input.connect(stereo);
   const split=context.createChannelSplitter(2),merge=context.createChannelMerger(2);nodes.push(split,merge);stereo.connect(split);
   // M=(L+R)/2, S=(L-R)/2. Cut vocal frequencies in M, retain S.
   const middle=gain(1),side=gain(1),ml=gain(.5),mr=gain(.5),sl=gain(.5),sr=gain(-.5);
   split.connect(ml,0);split.connect(mr,1);ml.connect(middle);mr.connect(middle);
   split.connect(sl,0);split.connect(sr,1);sl.connect(side);sr.connect(side);
   centre=[filter('peaking',350,.8),filter('peaking',1000,.8),filter('peaking',2800,.8)];
   let last=middle;for(const node of centre){last.connect(node);last=node;}
   const left=gain(1),right=gain(1),negativeSide=gain(-1);
   last.connect(left);side.connect(left);last.connect(right);side.connect(negativeSide);negativeSide.connect(right);
   left.connect(merge,0,0);right.connect(merge,0,1);
   filters=[filter('lowshelf',180),filter('peaking',1100,.55),filter('highshelf',6500)];
   last=merge;for(const node of filters){last.connect(node);last=node;}
   wet=gain(0);last.connect(wet);wet.connect(output);
  }
  return {input,output,
   update(value,enabled=true){
    if(disposed)return;const settings=normalize(value),active=enabled&&keys.some(key=>settings[key]>0);
    if(!wet&&!active)return; // Default playback does not construct a filter graph.
    if(!wet)build();
    centre.forEach(node=>set(node.gain,-18*settings.vocal/100));
    filters.forEach((node,i)=>set(node.gain,-[24,18,24][i]*settings[keys[i+1]]/100));
    set(dry.gain,active?0:1);set(wet.gain,active?1:0);
   },
   destroy(){disposed=true;for(const node of nodes)try{node.disconnect();}catch(_){};}
  };
 }
 return {normalize,create};
});

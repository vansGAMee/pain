/* Android adapter. Ranking, acoustic profiles, EQ and insights use the desktop modules. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./queue-engine'),require('./audio-profile'),require('./dj-state'),require('./listening-insights'),require('./auto-eq'),require('./smart-volume'));else root.MobileEngine=factory(root.QueueEngine,root.AudioProfile,root.DjState,root.ListeningInsights,root.AutoEqualizer,root.SmartVolume);})(globalThis,(Queue,Audio,State,Insights,EQ,Volume)=>{
 // Same Blackman window and FFT normalization as Web Audio's AnalyserNode.
 function spectrum(wave){
  const n=wave.length,re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<n;i++)re[i]=wave[i]*(.42-.5*Math.cos(2*Math.PI*i/n)+.08*Math.cos(4*Math.PI*i/n));
  for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
  for(let len=2;len<=n;len*=2){const angle=-2*Math.PI/len;
   for(let at=0;at<n;at+=len)for(let j=0;j<len/2;j++){
    const c=Math.cos(angle*j),s=Math.sin(angle*j),a=at+j,b=a+len/2,x=re[b]*c-im[b]*s,y=re[b]*s+im[b]*c;
    re[b]=re[a]-x;im[b]=im[a]-y;re[a]+=x;im[a]+=y;
   }
  }
  return Float32Array.from({length:n/2},(_,i)=>20*Math.log10(Math.max(1e-12,Math.hypot(re[i],im[i])/n)));
 }
 class Engine{
  constructor(emit=()=>{}){this.emit=emit;this.tracks=[];this.stats={plays:[]};this.profiles={};this.scope='';this.q=null;this.dispose=null;this.leveler=Volume.createLeveler();this.eqTracker=EQ.createTracker();this.levelTrack='';this.vibes={items:[],activeId:null};this.excluded=[];}
  update(data){
   if(Array.isArray(data.tracks)){this.tracks=data.tracks;this.eqReference=null;}
   if(data.stats?.plays)this.stats=data.stats;
   if(data.profiles){this.eqReference=null;this.dispose?.();this.dispose=null;this.observer=null;this.profiles=State.merge({profiles:this.profiles},data).profiles;}
   if(this.q){this.q.audioProfiles=this.profiles;this.q.refreshLibrary(this.tracks);this.q.setStats(this.stats);}
   if(Array.isArray(data.excluded))this.excluded=data.excluded.map(String);
   if(data.vibes){this.vibes=State.merge({vibes:this.vibes},{vibes:data.vibes}).vibes||this.vibes;}
   if(this.q){this.q.setExcludedTracks(this.excluded);this.q.setVibeProfile(this.vibes.items.find(v=>v.id===this.vibes.activeId)?.profile||null);}
   return {ready:true};
  }
  state(data={}){this.update(data);return {version:1,profiles:this.profiles,vibes:this.vibes};}
  boundary(){this.dispose?.();this.dispose=null;this.observer=null;return {};}
  feedback(play){
   const i=this.stats.plays.findIndex(p=>p.track===play.track&&p.started===play.started);
   if(i<0)this.stats.plays.push(play);else this.stats.plays[i]=play;
   this.q?.setStats(this.stats);return {};
  }
  choose(data){
   const byId=new Map(this.tracks.map(t=>[String(t.id),t])),ids=[...new Set(data.ids||[])].filter(id=>byId.has(String(id))),scope=JSON.stringify(ids);
   if(this.q&&!data.reset&&this.scope!==scope){this.scope=scope;this.q.refreshLibrary(ids.map(id=>byId.get(String(id))),true);}
   if(!this.q||data.reset){
    this.scope=scope;this.q=new Queue({shuffleMode:'smart',loopMode:data.loop||'off',stats:this.stats,audioProfiles:this.profiles,excludedTracks:this.excluded});
    if(Number.isInteger(data.seed))this.q.smartSeed=data.seed;
    this.q.setContext('library',ids.map(id=>byId.get(String(id))),Math.max(0,ids.indexOf(data.current)));
    if(!ids.includes(data.current)){this.q.currentIndex=-1;this.q.resetCycle();}
    this.q.setVibeProfile(this.vibes.items.find(v=>v.id===this.vibes.activeId)?.profile||null);
    this.planned=null;
   }else if(String(this.q.getCurrentTrack()?.id)!==String(data.current)){
    const before=this.q.getCurrentTrack(),previous=this.q.tracks[this.q.playedHistory.at(-2)];
    if(data.back&&previous?.id===data.current)this.q.prev();
    else if(String(this.q.peekNext()?.id)===String(data.current))this.q.next();
    else{
     if(this.q.loopMode==='all'&&![...this.q.unplayedIndices].some(i=>!this.q.isExcluded(this.q.tracks[i]?.id)))this.q.resetCycle(false);
     this.q.jumpToTrack(data.current);
     if(this.planned?.next===data.current&&this.planned.from===before?.id)
      this.q.lastTransition={fromTrack:before,toTrack:this.q.getCurrentTrack(),reasons:this.planned.reasons};
    }
   }
   this.q.setLoopMode(data.loop||'off');
   const next=this.q.peekNext(),decision=this.q.getLastTransition();
   const choice=next&&this.q.forwardHistory.length===0?this.q.smartChoose(this.q.getCurrentTrack(),this.q.smartCandidates()):null;
   this.planned={from:data.current,next:next?.id,reasons:next&&choice?.track?.id===next.id?choice.reasons:[]};
   return {next:next?.id||null,current:data.current,reasons:decision?.toTrack?.id===data.current?decision.reasons:[],measured:!!Audio.get(this.profiles,byId.get(String(data.current)))};
  }
  vibe(data){
   if(data.action==='save'){
    const track=this.tracks.find(t=>t.id===data.track),profile=Queue.validateVibeProfile(Audio.get(this.profiles,track));
    if(!profile)throw Error('Послушайте трек немного дольше: пока мало данных о звучании.');
    if(this.vibes.items.length>=8)throw Error('Сохранено 8 вайбов. Сначала удалите один.');
    const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    this.vibes.items.push({id,name:String(data.name||track.title).trim().slice(0,80),source:track.title,profile});this.vibes.activeId=id;
   }else if(data.action==='delete'){this.vibes.items=this.vibes.items.filter(v=>v.id!==data.id);if(this.vibes.activeId===data.id)this.vibes.activeId=null;}
   else this.vibes.activeId=this.vibes.items.some(v=>v.id===data.id)?data.id:null;
   this.vibes.updatedAt=Date.now();
   if(this.q)this.q.setVibeProfile(this.vibes.items.find(v=>v.id===this.vibes.activeId)?.profile||null);
   return this.vibes;
  }
  insights(){const d=Insights.build(this.tracks,this.stats);return {...d,plays:undefined,days:Object.fromEntries(d.days)};}
  equalize(track,profile){
   if(!this.eqReference){
    this.eqReference=EQ.createReference(this.tracks.map(t=>({id:t.id,profile:Audio.get(this.profiles,t)})));
   }
   const live=this.eqTracker.get(track);
   return EQ.recommend(track,live?{...live,analysis:{...live.analysis,sampleRate:profile?.analysis?.sampleRate}}:profile,null,this.eqReference);
  }
  audio(data){
   if(this.autoEqActive!==(data.autoEq!==false)){this.autoEqActive=data.autoEq!==false;this.eqTracker.reset();}
   const track=this.tracks.find(t=>t.id===data.track);if(!track)return {};
   if(!this.observer||this.observer.rate!==data.rate){
    this.dispose?.();const o=this.observer={rate:data.rate,tick:()=>{},time:0,track:null,channels:[],spectra:[],audio:{paused:false,seeking:false,readyState:4,volume:1,playbackRate:1,currentTime:0}};
    let channel=0;
    const context={sampleRate:data.rate,state:'running',createChannelSplitter:()=>({connect(){},disconnect(){}}),createAnalyser:()=>{
     const index=channel++;return {fftSize:2048,frequencyBinCount:1024,disconnect(){},getFloatTimeDomainData:out=>out.set(o.channels[index]||o.channels[0]),getFloatFrequencyData:out=>{
      const i=o.channels[index]?index:0;if(!o.spectra[i])o.spectra[i]=spectrum(o.channels[i]);out.set(o.spectra[i]);
     }};
    }};
    this.dispose=Audio.observe(context,{connect(){},disconnect(){}},o.audio,()=>o.track,(t,p)=>{
     this.eqReference=null;this.profiles[t.id]=p;this.q?.setAudioProfile(t.id,p);this.emit({type:'profile',track:t.id,profile:p});
    },this.profiles,{now:()=>o.time,setInterval:fn=>{o.tick=fn;return 1;},clearInterval:()=>{},active:()=>this.autoEqActive,onFrame:(t,v,seconds,position)=>this.eqTracker.observe(t,v,seconds,position)});
   }
   const o=this.observer;o.time=data.wall;o.track=track;o.channels=data.channels.map(a=>Float32Array.from(a));o.spectra=[];
   Object.assign(o.audio,{paused:!data.playing,currentTime:data.position/1000,playbackRate:data.speed,currentSrc:track.uri});o.tick();
   if(this.levelTrack!==track.id){this.leveler.reset();this.levelTrack=track.id;}
   let volumeDb=0;
   if(data.smartVolume){const result=this.leveler.sample(data.rms,data.peak,data.elapsed);if(result!==null)volumeDb=result;else volumeDb=this.lastGain||0;}
   else this.leveler.reset();this.lastGain=volumeDb;
   const profile=Audio.get(this.profiles,track,true),duration=Number(track.duration)/1000;
   let sampleAfter=0;
   if(profile?.frames>=48&&(profile.detail?.frames>=24||data.rate<16000||data.rate>192000)){
    const step=Math.max(.5,Math.ceil(duration/360*2)/2),body=Math.ceil(Math.max(30,duration*.35)/step);
    const fullFile=profile.analysis?.method==='stratified-pcm-v1'&&!!Audio.detail(profile);
    const bodyDetail=Audio.detailFrames(profile,body*step);
    const needsDetail=!fullFile&&data.rate>=16000&&data.rate<=192000&&bodyDetail<24;
    sampleAfter=duration>=60&&(profile.frames<72&&profile.positions.filter(p=>p>=body).length<24||needsDetail)?body*step*1000:null;
   }
   return {track:track.id,eq:data.autoEq===false?null:this.equalize(track,profile),volumeDb,sampleAfter:data.autoEq===true?0:sampleAfter};
  }
 }
 Engine.spectrum=spectrum;return Engine;
});

/* Empirical categorical prior + Gaussian observation likelihood (Bayes).
 * Prior: Dirichlet(1,...,1) posterior predictive, counts are completed listens
 * and one current explicit favourite. No skip penalties or synthetic audio.
 * Gaussian bandwidth: Scott n^(-1/(d+4)); diagonal sample covariance.
 * https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.gaussian_kde.html
 * https://nlp.stanford.edu/IR-book/html/htmledition/naive-bayes-text-classification-1.html
 * This is a local statistical model, NOT a port of PulseFlow/CLAP.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./audio-profile'));
  else root.RecommendationModel=factory(root.AudioProfile);
})(globalThis,Sound=>{
  const complete=p=>p.finished===true||p.finished===1||p.completed===true||p.completed===1;
  const artistIdentity=t=>String(t?.artist||t?.albumArtist||'').trim().toLowerCase().replace(/\s+/g,' ');
  const recordingIdentity=t=>{
    const title=String(t?.title||'').trim().toLowerCase().normalize('NFKC').replace(/\s+/g,' ')
      .replace(/\s*(?:[-–—]\s*|\(\s*|\[\s*)(?:(?:(?:super|ultra)\s+)?slowed(?:\s+down)?(?:\s*(?:\+|&|and)\s*reverb(?:ed)?)?|(?:sped|speed)[\s-]*up)(?:\s+(?:version|edit|mix))?\s*[\])]?$/,'').trim();
    return title&&artistIdentity(t)?JSON.stringify([artistIdentity(t),title]):String(t?.id??'');
  };
  const knownBpm=(t,cache={})=>Number.isFinite(cache[t?.id])&&cache[t.id]>0?cache[t.id]:Number.isFinite(t?.bpm)&&t.bpm>0?t.bpm:null;
  function vector(p){
    if(!Sound.texture(p)||!Array.isArray(p.variance)||p.variance.length!==6||!p.variance.every(v=>Number.isFinite(v)&&v>=0&&v<=.25))return null;
    return [...p.vector,...p.variance.map(Math.sqrt),...p.timbre,...p.timbreVariance.map(Math.sqrt)];
  }
  class RecommendationModel{
    constructor(tracks=[],plays=[],now=Date.now(),profiles={},options={}){
      this.tracks=Array.isArray(tracks)?tracks.filter(t=>t?.id!=null):[];
      this.now=now;this.excluded=new Set(Array.from(options.excludedTracks||[],String));this.counts=new Map();this.outcomes=new Map();
      this.audioProfiles=profiles||{};this.features=new Map();const seen=new Map();
      for(const p of Array.isArray(plays)?plays:[]){
        const time=Number(p?.started||p?.timestamp);
        if(p?.track==null||!Number.isFinite(time)||time<=0||time>now)continue;
        const key=JSON.stringify([String(p.track),time]),old=seen.get(key);
        // Duplicate sync records represent one outcome; completion wins.
        if(!old||complete(p))seen.set(key,p);
      }
      for(const p of seen.values()){
        const id=String(p.track),yes=complete(p),no=!yes&&(p.skipped===true||p.skipped===1);
        if(yes)this.counts.set(id,(this.counts.get(id)||0)+1);
        if(yes||no){const c=this.outcomes.get(id)||[0,0];c[yes?0:1]++;this.outcomes.set(id,c);}
      }
      this.samples=seen.size;
      for(const t of this.tracks){
        const id=String(t.id);
        const v=vector(Sound.get(this.audioProfiles,t));if(v)this.features.set(id,v);
      }
      const rows=[...this.features.values()],n=rows.length;
      this.variance=[];this.dimensions=[];
      if(n>1){
        for(let j=0;j<rows[0].length;j++){
          const mean=rows.reduce((s,v)=>s+v[j],0)/n;
          const variance=rows.reduce((s,v)=>s+(v[j]-mean)**2,0)/(n-1);
          if(variance>0){this.variance[j]=variance;this.dimensions.push(j);}
        }
      }
      this.bandwidth=n>1?n**(-1/(this.dimensions.length+4)):null;
    }
    static artistIdentity=artistIdentity;
    static recordingIdentity=recordingIdentity;
    static knownBpm=knownBpm;
    artistIdentity=artistIdentity;
    recordingIdentity=recordingIdentity;
    knownBpm=knownBpm;
    reference(current,context){return context.vibeProfile?vector(context.vibeProfile):this.features.get(String(current?.id))||null;}
    logLikelihood(a,b){
      if(!a||!b||!this.bandwidth)return null;
      let distance=0;for(const j of this.dimensions)distance+=(a[j]-b[j])**2/this.variance[j];
      return -distance/(2*this.bandwidth**2);
    }
    score(current,track,bpmCache={},context={}){
      const reference=this.reference(current,context),target=this.features.get(String(track?.id));
      const logKernel=this.logLikelihood(reference,target),count=(this.counts.get(String(track?.id))||0)+Number(track?.favorite===1||track?.favorite===true);
      const score=Math.log(count+1)+(logKernel??0);
      const outcomes=this.outcomes.get(String(track?.id))||[0,0];
      const reasons=logKernel!==null?[context.vibeProfile?'Звучание сохранённого вайба':'Близкое звучание']:
        [this.counts.get(String(track?.id))?'Вы возвращаетесь к этому треку':count?'Любимый трек':'Знакомимся с вашим вкусом'];
      return {score,bpm:knownBpm(track,bpmCache),soundSimilarity:logKernel===null?null:Math.exp(logKernel),
        // Beta(1,1)-Bernoulli mean is diagnostic only, never a manual ranking bonus.
        probability:(outcomes[0]+1)/(outcomes[0]+outcomes[1]+2),reasons,
        explanation:{method:logKernel===null?'completed-frequency':'gaussian-conditional',
          referenceTitle:logKernel===null||context.vibeProfile?null:current?.title||null,
          referenceArtist:logKernel===null||context.vibeProfile?null:current?.artist||null,
          referenceBpm:context.vibeProfile?null:knownBpm(current,bpmCache),
          liked:track?.favorite===1||track?.favorite===true}};
    }
    distribution(current,candidates=[],bpmCache={},context={}){
      const excluded=context.excludedTracks?new Set(Array.from(context.excludedTracks,String)):this.excluded;
      let pool=candidates.filter(t=>t?.id!=null&&!excluded.has(String(t.id)));
      const currentId=recordingIdentity(current);
      if(pool.some(t=>recordingIdentity(t)!==currentId))pool=pool.filter(t=>recordingIdentity(t)!==currentId);
      // Missing features do not masquerade as perfect matches. Use measured
      // candidates when available; frequency backoff when that pool is empty.
      const reference=this.reference(current,context);
      if(reference&&this.bandwidth){const measured=pool.filter(t=>this.features.has(String(t.id)));if(measured.length)pool=measured;}
      const rows=pool.map(track=>({track,...this.score(current,track,bpmCache,context)}));
      const max=Math.max(...rows.map(r=>r.score));let sum=0;
      for(const r of rows){r.weight=Math.exp(r.score-max);sum+=r.weight;}
      for(const r of rows)r.weight/=sum;
      return rows;
    }
    choose(current,candidates=[],bpmCache={},context={}){
      const rows=this.distribution(current,candidates,bpmCache,context);if(!rows.length)return null;
      // Reproducible categorical draw; no top-percent cutoff or exploration weight.
      let z=(Number(context.seed)||0)>>>0;z=(z+0x6d2b79f5)>>>0;
      z=Math.imul(z^(z>>>15),z|1);z^=z+Math.imul(z^(z>>>7),z|61);
      let draw=((z^(z>>>14))>>>0)/4294967296;
      for(const row of rows){draw-=row.weight;if(draw<=0)return row;}
      return rows.at(-1);
    }
  }
  return RecommendationModel;
});

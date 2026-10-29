// Audible time and unique media coverage; usable by the browser and node:test.
(function(root) {
  class ListeningLedger {
    constructor(id, duration, started = Date.now()) {
      this.playId='pc_'+(globalThis.crypto?.randomUUID?.()||Date.now()+'_'+Math.random().toString(36).slice(2));
      this.id=id; this.duration=Math.max(0, Number(duration)||0);this.started=started;
      this.heard=0;this.ranges=[];this.previous=null;this.closed=false;
    }
    anchor(now, position, active=true) {this.previous={now,position,active};}
    sample(now, position, active=true, rate=1) {
      const p=this.previous;this.anchor(now,position,active);
      if(this.closed||!p||!p.active||!active)return;
      const wall=(now-p.now)/1000,media=position-p.position;
      if(wall<=0||media<=0||media>wall*rate+.3)return;
      this.heard+=Math.min(wall,media/rate)*1000;
      this.ranges.push([p.position,position]);
      this.ranges.sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for(const r of this.ranges){const last=merged.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push([...r]);}
      this.ranges=merged;
    }
    snapshot(terminal=false) {
      const coverage=this.ranges.reduce((n,r)=>n+r[1]-r[0],0)*1000;
      if(this.heard<Math.min(30000,this.duration>0?this.duration/2:30000))return null;
      return {track:this.id,started:this.started,duration:this.duration,heard:Math.round(this.heard),media_heard:Math.round(coverage),finished:terminal&&this.duration>0&&coverage>=this.duration*.9?1:0,skipped:0};
    }
    finish() {if(this.closed)return null;this.closed=true;return this.snapshot(true);}
  }
  if(typeof module==='object')module.exports=ListeningLedger;else root.ListeningLedger=ListeningLedger;
})(globalThis);

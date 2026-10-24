/* Taste Map: visualise co-listening neighbours, plays, likes, skips. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TasteGraph=factory();})(globalThis,()=>{
 const SessionGraph=typeof module==='object'&&module.exports?require('./session-graph'):globalThis.SessionGraph;
 const MAX_NODES=150;

 function buildGraph(tracks,plays,options={}){
  const now=options.now||Date.now(),excluded=options.excludedTracks||new Set();
  const byId=new Map((Array.isArray(tracks)?tracks:[]).filter(t=>t&&t.id!=null).map(t=>[String(t.id),t]));
  const stats=new Map();
  for(const id of byId.keys())stats.set(id,{id,title:byId.get(id).title||'Untitled',artist:byId.get(id).artist||'',plays:0,skipped:0,minutes:0,favorite:byId.get(id).favorite===1||byId.get(id).favorite===true});
  const events=[];
  for(const p of Array.isArray(plays)?plays:[]){
   if(!p||p.track==null)continue;
   const id=String(p.track);if(!byId.has(id))continue;
   const heard=Number(p.media_heard??p.heard)||0;
   const skipped=p.skipped===1||p.skipped===true;
   const finished=p.finished===1||p.finished===true||p.completed===1||p.completed===true;
   const s=stats.get(id);
   if(finished||heard>30000)s.plays++;
   if(skipped)s.skipped++;
   s.minutes+=heard/60000;
   events.push({id,started:Number(p.started||p.timestamp)||0,quality:finished?1:Math.min(1,heard/60000),skipped});
  }
  const session=new SessionGraph(events,now);
  let nodes=[];
  for(const [id,s] of stats){
   if(excluded.has(id))continue;
   if(s.plays===0&&s.skipped===0)continue;
   const score=s.plays+s.minutes*0.1;
   nodes.push({id,label:s.title,artist:s.artist,plays:s.plays,skipped:s.skipped,minutes:s.minutes,favorite:s.favorite,_score:score,
    size:Math.min(24,6+Math.log(1+s.plays)*4+Math.log(1+s.minutes)*2),
    color:s.favorite?'#d4a017':(s.skipped>s.plays?'#c75c5c':'#7c4dff')});
  }
  nodes.sort((a,b)=>b._score-a._score);
  nodes=nodes.slice(0,MAX_NODES);
  nodes.forEach(n=>{delete n._score;});
  const nodeIds=new Set(nodes.map(n=>n.id));
  const edges=[];
  for(const [a,neighbors] of session.neighbors){
   if(!nodeIds.has(a))continue;
   for(const [b,weight] of neighbors){
    if(!nodeIds.has(b))continue;
    if(a<b)edges.push({a,b,weight});
   }
  }
  return {nodes,edges};
 }

 function layout(graph,options={}){
  const iterations=options.iterations||250,width=options.width||800,height=options.height||600;
  const {nodes,edges}=graph;
  if(nodes.length===0)return graph;
  const cx=width/2,cy=height/2,radius=Math.min(width,height)*0.35;
  nodes.forEach((n,i)=>{const a=(i/nodes.length)*Math.PI*2;n.x=cx+Math.cos(a)*radius*(0.5+Math.random()*0.5);n.y=cy+Math.sin(a)*radius*(0.5+Math.random()*0.5);n.vx=0;n.vy=0;});
  const idMap=new Map(nodes.map(n=>[n.id,n]));
  const edgeList=edges.map(e=>({a:idMap.get(e.a),b:idMap.get(e.b),weight:e.weight})).filter(e=>e.a&&e.b);
  const repulsion=5000,springLength=80,springStrength=0.02,damping=0.85,centerPull=0.01;
  for(let iter=0;iter<iterations;iter++){
   const alpha=1-iter/iterations;
   for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j];let dx=b.x-a.x,dy=b.y-a.y;
    const d2=dx*dx+dy*dy||1,d=Math.sqrt(d2),force=repulsion/d2;
    const fx=(dx/d)*force,fy=(dy/d)*force;
    a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy;
   }
   for(const e of edgeList){
    let dx=e.b.x-e.a.x,dy=e.b.y-e.a.y;
    const d=Math.sqrt(dx*dx+dy*dy||1),diff=d-springLength,force=diff*springStrength*e.weight;
    const fx=(dx/d)*force,fy=(dy/d)*force;
    e.a.vx+=fx;e.a.vy+=fy;e.b.vx-=fx;e.b.vy-=fy;
   }
   for(const n of nodes){n.vx+=(cx-n.x)*centerPull;n.vy+=(cy-n.y)*centerPull;}
   for(const n of nodes){n.vx*=damping;n.vy*=damping;n.x+=n.vx*alpha;n.y+=n.vy*alpha;n.x=Math.max(30,Math.min(width-30,n.x));n.y=Math.max(30,Math.min(height-30,n.y));}
  }
  return graph;
 }

 function render(container,graph,options={}){
  if(!container)return;
  const width=options.width||container.clientWidth||800,height=options.height||600;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('width','100%');svg.setAttribute('height',height);
  const edgeGroup=document.createElementNS('http://www.w3.org/2000/svg','g');
  edgeGroup.setAttribute('opacity','0.15');
  const idMap=new Map(graph.nodes.map(n=>[n.id,n]));
  for(const e of graph.edges){
   const a=idMap.get(e.a),b=idMap.get(e.b);if(!a||!b)continue;
   const line=document.createElementNS('http://www.w3.org/2000/svg','line');
   line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);
   line.setAttribute('stroke','#888');line.setAttribute('stroke-width',Math.min(3,1+e.weight*2));
   edgeGroup.appendChild(line);
  }
  svg.appendChild(edgeGroup);
  const nodeGroup=document.createElementNS('http://www.w3.org/2000/svg','g');
  for(const n of graph.nodes){
   const g=document.createElementNS('http://www.w3.org/2000/svg','g');
   const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
   circle.setAttribute('cx',n.x);circle.setAttribute('cy',n.y);circle.setAttribute('r',n.size);
   circle.setAttribute('fill',n.color);circle.setAttribute('fill-opacity','0.7');
   circle.setAttribute('stroke',n.color);circle.setAttribute('stroke-width','1.5');
   g.appendChild(circle);
   if(n.size>10){
    const text=document.createElementNS('http://www.w3.org/2000/svg','text');
    text.setAttribute('x',n.x);text.setAttribute('y',n.y+n.size+12);
    text.setAttribute('text-anchor','middle');text.setAttribute('font-size','9');text.setAttribute('fill','#666');
    text.textContent=n.label.slice(0,20);
    g.appendChild(text);
   }
   const title=document.createElementNS('http://www.w3.org/2000/svg','title');
   title.textContent=`${n.label}\n${n.artist}\n${n.plays} plays · ${n.skipped} skips · ${Math.round(n.minutes)} min${n.favorite?' · ★':''}`;
   g.appendChild(title);
   nodeGroup.appendChild(g);
  }
  svg.appendChild(nodeGroup);
  container.innerHTML='';container.appendChild(svg);
 }

 return {buildGraph,layout,render};
});

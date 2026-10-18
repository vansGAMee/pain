const test=require('node:test'),assert=require('node:assert/strict'),Graph=require('../src/session-graph');
const minute=60000,day=24*60*minute,now=Date.UTC(2026,9,18);
const event=(id,started,extra={})=>({id,started,quality:1,skipped:false,...extra});
const session=(ids,daysAgo,spacing=3*minute)=>ids.map((id,i)=>event(id,now-daysAgo*day+i*spacing));

test('repeated good sessions link companions while disconnected, unknown and self candidates score zero',()=>{
 const graph=new Graph([...session(['a','b'],4),...session(['a','b'],3),...session(['c','d'],2),...session(['c','d'],1)],now);
 const affinity=graph.affinity(['a'],'b');
 assert.ok(affinity>0&&affinity<=1,`Expected bounded positive affinity, got ${affinity}`);
 for(const [seeds,candidate] of [[['a'],'c'],[['a'],'missing'],[['missing'],'a'],[['a'],'a'],[[],'b']])assert.equal(graph.affinity(seeds,candidate),0);
 assert.equal(new Graph([],now).affinity(['a'],'b'),0);
 assert.equal(new Graph(session(['a','b'],1),now).affinity(['a'],'b'),0);
});

test('long gaps and the two hour session cap prevent repeated false links',()=>{
 const separated=[...session(['a','b'],2,31*minute),...session(['a','b'],1,31*minute)];
 assert.equal(new Graph(separated,now).affinity(['a'],'b'),0);
 const long=[];
 for(const daysAgo of [2,1])long.push(...session(['start','fill1','fill2','fill3','a','b'],daysAgo,25*minute));
 assert.equal(new Graph(long,now).affinity(['a'],'b'),0);
});

test('an explicit skip or incomplete listen breaks the good-listen context',()=>{
 for(const interruption of [{skipped:true},{quality:.74}]){
  const events=[];
  for(const daysAgo of [3,2,1]){
   const batch=session(['a','interruption','b'],daysAgo);
   Object.assign(batch[1],interruption);events.push(...batch);
  }
  const graph=new Graph(events,now);
  assert.equal(graph.affinity(['a'],'b'),0);
  assert.equal(graph.affinity(['a'],'interruption'),0);
 }
});

test('duplicate records and repeated loops cannot manufacture independent session support',()=>{
 const events=[...session(['a','b'],2),...session(['a','b'],1)],baseline=new Graph(events,now).affinity(['a'],'b');
 const duplicated=new Graph([...events,...events.map(play=>({...play})),...events.map(play=>({...play}))],now);
 assert.equal(duplicated.affinity(['a'],'b'),baseline);
 const loops=session(Array.from({length:40},(_,i)=>i%2?'b':'a'),1,minute);
 assert.equal(new Graph(loops,now).affinity(['a'],'b'),0);
});

test('independently repeated neighbours provide a weaker two hop recommendation',()=>{
 const events=[...session(['a','b'],4),...session(['a','b'],3),...session(['b','c'],2),...session(['b','c'],1)];
 const graph=new Graph(events,now),direct=graph.affinity(['a'],'b'),indirect=graph.affinity(['a'],'c');
 assert.ok(indirect>0,`Expected a supported two hop affinity, got ${indirect}`);
 assert.ok(indirect<direct,`Expected direct affinity ${direct} to exceed two hop affinity ${indirect}`);
});

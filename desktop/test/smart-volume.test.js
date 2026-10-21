const test=require('node:test'),assert=require('node:assert/strict');
const {createLeveler}=require('../src/smart-volume');
const settle=(leveler,rms,peak,seconds=45)=>{
 let gain;for(let i=0;i<seconds*4;i++)gain=leveler.sample(rms,peak,.25);return gain;
};

test('level matching reduces loud masters and raises quiet music only gently',()=>{
 const loud=settle(createLeveler(),.4,.65),quiet=settle(createLeveler(),.04,.08);
 assert.ok(loud<-9&&loud>=-18);assert.ok(quiet>2.5&&quiet<=3);
 const dynamic=settle(createLeveler(),.04,.95);
 assert.ok(dynamic<0,'high crest recordings must retain peak headroom');
 const initial=createLeveler();assert.equal(settle(initial,.04,.08,2),0,'do not amplify a short quiet intro');
});

test('EQ and level matching converge on the same level without undoing tonal correction',()=>{
 const plain=createLeveler(),equalized=createLeveler();
 const plainGain=settle(plain,.3,.5),eqGain=settle(equalized,.15,.3);
 const a=.3*10**(plainGain/20),b=.15*10**(eqGain/20);
 assert.ok(Math.abs(20*Math.log10(a/b))<.5,'EQ attenuation must be included in level matching');
 assert.ok(eqGain>plainGain+5,'one uniform gain compensates level, not individual EQ bands');
});

test('silence, fades, invalid measurements and suspended timers cannot wind up gain',()=>{
 const leveler=createLeveler(),before=settle(leveler,.2,.4);
 for(const [rms,peak,elapsed] of [[0,0,.25],[.0001,.001,.25],[.01,.02,.25],[NaN,1,.25],[1,Infinity,.25],[.2,.1,.25],[.2,.4,0],[.2,.4,10]]){
  for(let i=0;i<100;i++)assert.equal(leveler.sample(rms,peak,elapsed),null);
 }
 assert.ok(Math.abs(leveler.sample(.2,.4,.25)-before)<.1);
 assert.equal(leveler.reset(),0,'new tracks must not inherit the previous gain');
 assert.equal(leveler.sample(.04,.08,.25),0);
});

test('large level changes are bounded and a seek can retain the current gain',()=>{
 const leveler=createLeveler();let last=settle(leveler,.04,.08);
 for(let i=0;i<32;i++){
  const next=leveler.sample(.5,.9,.25);
  assert.ok(next-last>=-1.5-1e-9&&next-last<=.0875+1e-9);last=next;
 }
 assert.ok(last<0);assert.equal(leveler.reset(true),last);
 assert.ok(Number.isFinite(leveler.sample(.5,.9,.25)));
});

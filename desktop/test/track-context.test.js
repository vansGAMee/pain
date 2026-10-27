const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../src/track-context');
test('version context connects the real slowed and sped up editions without inventing audio measurements',()=>{
 const track={id:'a',title:'Faster n Harder - Slowed & Reverbed',artist:'Sassy Scene, 6arelyhuman'};
 const cards=build(track,[track,{id:'b',title:'Faster n Harder - Sped Up',artist:track.artist,duration:115264}],{days:new Set(['2026-10-01','2026-10-02']),behavior:{qualified:34}});
 assert.ok(cards.find(c=>c.source==='title').text.includes('Reverb'));
 assert.ok(cards.find(c=>c.source==='library').text.includes('Sped Up» (1:55)'));
 assert.ok(cards.find(c=>c.source==='history').text.includes('34'));
});
test('ordinary song names are not classified as effects or live performances',()=>{
 for(const title of ['Live Forever','The Slowed Song','Reverb']){
  assert.ok(!build({title,artist:'Artist'}).some(c=>c.source==='title'));
 }
});
test('unidentified recordings still have truthful local context, in either language',()=>{
 const track={id:'unknown',title:'recording_037',artist:'<unknown>'};
 for(const lang of ['ru','en']){
  const cards=build(track,[],{},lang);
  assert.equal(cards.length,1);assert.equal(cards[0].source,'library');assert.ok(cards[0].text);
  assert.ok(!cards[0].text.includes('Wikipedia'));
 }
});

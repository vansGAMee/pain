const test=require('node:test'),assert=require('node:assert/strict'),visuals=require('../src/dj-visuals');
test('visual explanation uses recorded metrics exactly and never labels mixture share as audio similarity',()=>{
 const report={method:'personal-taste',listens:15,completed:3,heardFraction:.27,liked:true,historyEvents:5024,learnedShare:.5,audioUsed:true,anchors:[{id:'a',title:'Song <script>'}]},before=structuredClone(report);
 const html=visuals.render(report,[{id:'a',artist:'Credited artist'}]);assert.match(html,/15/);assert.match(html,/27%/);assert.match(html,/50%/);assert.match(html,/Частотный подбор/);assert.match(html,/Модель всего вкуса/);assert.match(html,/не проценты похожести/);assert.match(html,/Song &lt;script&gt;/);assert.match(html,/Credited artist/);assert.deepEqual(report,before);
 const missing=visuals.render({method:'personal-taste'});assert.doesNotMatch(missing,/NaN|undefined|0%|50%/);assert.equal(visuals.render({method:'other'}),'');
});

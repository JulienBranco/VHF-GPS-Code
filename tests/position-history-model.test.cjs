"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let model;
test.before(async()=>{model=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../sources/position-history-model.js')).toString('base64'));});
const entry=(extra={})=>({id:'a'.repeat(32),kind:'generated',at:1791000000000,lat:46.2,lon:-2.4,phrase:'THON MYSTIQUE ET ALBATROS ALTRUISTE',zone:{id:'test',name:'Zone du jour',type:'builtin',lat:46,lon:-2},...extra});
test('journal lié à la sortie, liste blanche et validation des points',()=>{
 const e=entry({secret:'ne jamais mémoriser',zone:{...entry().zone,key:'ne jamais mémoriser'}});
 const raw=model.encodeHistory([e],'sortie');assert(!raw.includes('ne jamais'));
 assert.deepEqual(model.decodeHistory(raw,'sortie'),[model.copyEntry(e)]);
 assert.throws(()=>model.decodeHistory(raw,'autre sortie'));
 assert.deepEqual(model.decodeHistory(null,'sortie'),[]);
 for(const value of [entry({lat:91}),entry({lon:NaN}),entry({kind:'provisional'}),entry({at:0}),entry({zone:{...entry().zone,lon:181}})])assert(!model.validEntry(value));
 assert.throws(()=>model.decodeHistory('{','sortie'));
 assert.throws(()=>model.decodeHistory(model.encodeHistory([entry(),entry()],'sortie'),'sortie'));
});
test('tri unique par date décroissante et dernière insertion à heure égale',()=>{
 const a=entry({id:'1'.repeat(32)}),b=entry({id:'2'.repeat(32),kind:'received',at:a.at+2000}),c=entry({id:'3'.repeat(32),at:b.at});
 const list=[a,b,c];assert.deepEqual(model.newestFirst(list).map(e=>e.id),[c.id,b.id,a.id]);assert.equal(list[0],a);
});
test('saturation explicite sans supprimer les points existants et format marin',()=>{
 assert.throws(()=>model.encodeHistory(Array.from({length:2000},(_,i)=>entry({id:i.toString(16).padStart(32,'0')})),'sortie'),/plein/);
 assert.equal(model.marineAxis(-2.4,false),'002° 24.000′ W');
 assert.equal(model.marineAxis(46.9999999,true),'47° 0.000′ N');
});

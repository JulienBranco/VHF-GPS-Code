"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let m;
test.before(async()=>{m=await import('data:text/javascript;base64,'+fs.readFileSync(path.join(__dirname,'../sources/point-tracking-math.js')).toString('base64'));});
const now=1791000000000;
const fix=(extra={})=>({lat:0,lon:0,time:now,accuracy:5,speed:3.0866666667,heading:0,...extra});
const fixes=(extra={})=>[-10000,-5000,0].map(dt=>fix({lat:dt/1000*3.0866666667/111195,time:now+dt,...extra}));
test('distance et projection nord en haut, y compris passage de l’antiméridien',()=>{
 assert(Math.abs(m.distance({lat:0,lon:0},{lat:0,lon:1})-111195)<1);
 const a={lat:0,lon:179.999},b={lat:0,lon:-179.999};
 assert(Math.abs(m.distance(a,b)-222.39)<.1);assert.equal(Math.round(m.bearing(a,b)),90);
 const east=m.project(b,a);assert(Math.abs(east.x-222.39)<.1);assert(Math.abs(east.y)<.01);
 assert(m.project({lat:1,lon:0},{lat:0,lon:0}).y>0);
});
test('vitesse GPS nulle ou absente : ne pas convertir une absence en zéro',()=>{
 const position={coords:{latitude:0,longitude:0,accuracy:5,speed:null,heading:null},timestamp:now};
 assert.equal(m.readFix(position,now).speed,null);assert.equal(m.readFix(position,now).heading,null);
 assert.equal(m.readFix({...position,coords:{...position.coords,speed:0}},now).speed,0);
 for(const invalid of [NaN,-1,null])assert.equal(m.readFix({...position,coords:{...position.coords,accuracy:invalid}},now),null);
 assert.equal(m.readFix({...position,timestamp:now+3000},now),null);
});
test('arrivée estimée selon la vitesse de rapprochement et après stabilisation',()=>{
 const target={lat:.04,lon:0},samples=fixes(),g=m.guidance(target,samples.at(-1),samples,now);
 assert.equal(g.reason,'moving');assert(Math.abs(g.eta-g.distance/3.0866666667)<.01);
 const angled=fixes({heading:60}),a=m.guidance(target,angled.at(-1),angled,now);
 assert(Math.abs(a.eta-2*g.eta)<.01);
 assert.equal(m.guidance(target,fix(),[fix()],now).eta,null);
});
test('estimation suspendue à l’arrêt, en éloignement, transversalement ou avec une position obsolète',()=>{
 const target={lat:.04,lon:0};
 for(const [extra,reason] of [[{speed:0},'stopped'],[{heading:180},'away'],[{heading:80},'across'],[{accuracy:101},'accuracy']]){
  const samples=fixes(extra),g=m.guidance(target,samples.at(-1),samples,now);assert.equal(g.reason,reason);assert.equal(g.eta,null);
 }
 const samples=fixes(),g=m.guidance(target,samples.at(-1),samples,now+21000);
 assert.equal(g.reason,'stale');assert.equal(g.eta,null);assert.equal(g.heading,null);
});
test('vitesse et route déduites des déplacements, petites oscillations GPS ignorées',()=>{
 const moving=fixes({speed:null,heading:null}),motion=m.motion(moving,now);
 assert(Math.abs(motion.speed-3.08667)<.01);assert.equal(Math.round(motion.heading),0);
 const jitter=moving.map((f,i)=>({...f,lat:(i%2)*.00001}));
 assert.equal(m.motion(jitter,now).speed,null);assert.equal(m.motion(jitter,now).heading,null);
});
test('proximité adaptée à la cellule et au GPS, sans arrivée précise artificielle',()=>{
 const g=m.guidance({lat:.0005,lon:0},fix(),fixes(),now);
 assert.equal(g.near,true);assert.equal(g.eta,null);assert.equal(g.reason,'near');
 assert.equal(m.guidance({lat:.0005,lon:0},fix({accuracy:300}),[],now).near,false);
});
test('rejet d’un saut GPS impossible et des timestamps qui reculent',()=>{
 const previous=fix({time:now-1000});
 assert.equal(m.plausible(fix({lat:1}),previous),false);
 assert.equal(m.plausible(fix({lat:.00001}),previous),true);
 assert.equal(m.plausible(fix({time:previous.time}),previous),false);
 assert.equal(m.plausible(fix({time:previous.time-1000}),previous),false);
});

test('arrêt détecté immédiatement malgré les vitesses précédentes lissées',()=>{
 const samples=fixes();samples[samples.length-1].speed=0;
 const g=m.guidance({lat:.04,lon:0},samples.at(-1),samples,now);
 assert.equal(g.reason,'stopped');assert.equal(g.speed,0);assert.equal(g.eta,null);assert.equal(g.heading,null);
});

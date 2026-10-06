"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.resolve(__dirname,"../sources/engine.js"),"utf8");
const zones=JSON.parse(JSON.stringify(vm.runInNewContext(source.match(/const BUILTIN_ZONES = (\[[\s\S]*?\]);/)[1])));
const importSource=name=>import("data:text/javascript;base64,"+fs.readFileSync(path.resolve(__dirname,"../sources/"+name)).toString("base64"));
function bounds(z){const lat=125/111.32,lon=lat/Math.cos(z.lat*Math.PI/180);return {minLat:z.lat-lat,maxLat:z.lat+lat,minLon:z.lon-lon,maxLon:z.lon+lon};}
function contains(b,[lon,lat]){return lon>=b.minLon&&lon<=b.maxLon&&lat>=b.minLat&&lat<=b.maxLat;}
function inside([x,y],ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!=(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)yes=!yes;}return yes;}
test("catalogue national : dix zones atlantiques conservées, identifiants et centres distincts",()=>{
 const legacy=[
  ["iroise-brest","IROISE / BREST",48.3,-5.2],["lorient-groix","LORIENT / GROIX",47.65,-4.2],
  ["belle-ile-quiberon","BELLE-ILE / QUIBERON",47.35,-3.9],["yeu-noirmoutier","YEU / NOIRMOUTIER",46.85,-3],
  ["sables","LES SABLES / LARGE",46.5,-2.85],["rochebonne","ROCHEBONNE",46.217334,-2.429111],
  ["la-rochelle-re","LA ROCHELLE / ILE DE RE",46.15,-2.05],["gironde-cordouan","GIRONDE / CORDOUAN",45.55,-2.2],
  ["arcachon","ARCACHON / LARGE",44.65,-2.1],["bayonne-capbreton","BAYONNE / CAPBRETON",43.6,-2.15]
 ];
 assert.deepEqual(zones.slice(0,10).map(z=>[z.id,z.name,z.lat,z.lon]),legacy);
 assert.deepEqual(Object.fromEntries([...new Set(zones.map(z=>z.region))].map(r=>[r,zones.filter(z=>z.region===r).length])),{Atlantique:10,Manche:10,"Mer du Nord":2,"Méditerranée":8,Corse:4});
 assert.equal(new Set(zones.map(z=>z.id)).size,zones.length);assert.equal(new Set(zones.map(z=>z.lat.toFixed(5)+"|"+z.lon.toFixed(5))).size,zones.length);
 for(const z of zones)assert(z.builtin&&Number.isFinite(z.lat)&&Number.isFinite(z.lon),z.id);
});
test("catalogue national : centres en mer et toutes les emprises dans le fond embarqué",async()=>{
 const {MAP_DATA}=await importSource("catalog-map-data.js"),{COVERAGE}=await importSource("catalog-map-model.js");
 for(const z of zones){
  assert(!MAP_DATA.land.some(r=>inside([z.lon,z.lat],r)),z.id+" : centre sur terre");
  const b=bounds(z);assert(contains(COVERAGE,[b.minLon,b.minLat])&&contains(COVERAGE,[b.maxLon,b.maxLat]),z.id+" : emprise hors du fond");
 }
});
test("catalogue national : couverture des côtes, îles et recouvrements entre façades",async()=>{
 const {MAP_DATA}=await importSource("catalog-map-data.js"),areas=zones.map(bounds);
 // Fenêtres géographiques du littoral métropolitain sur le fond embarqué.
 // Au sud du golfe de Gascogne, exclure la côte espagnole à l'ouest de la frontière.
 // En Manche, exclure la côte britannique au nord ; conserver les îles proches.
 const sectors={
  Atlantique:([x,y])=>x>=-5.6&&x<=-.9&&y>=43.36&&y<=48.5&&(y>=43.8||x>=-1.79),
  MancheNord:([x,y])=>x>=-5.6&&x<=2.6&&y>=48.5&&y<=(x<-3.5?49.5:x<-1?49.95:x<.5?50.05:51.1),
  Mediterranee:([x,y])=>x>=3.03&&x<=7.6&&y>=42.43&&y<=43.86,
  Corse:([x,y])=>x>=8.52&&x<=9.58&&y>=41.36&&y<=43.02
 };
 for(const [name,filter]of Object.entries(sectors)){
  const points=MAP_DATA.coast.flat().filter(filter);assert(points.length>250,name+" : échantillon insuffisant");
  for(const p of points)assert(areas.some(b=>contains(b,p)),name+" : côte non couverte "+p.join(","));
 }
 const chains=[["iroise-brest",...zones.filter(z=>["Manche","Mer du Nord"].includes(z.region)).map(z=>z.id)],zones.filter(z=>z.region==="Méditerranée").map(z=>z.id),[...zones.filter(z=>z.region==="Corse").map(z=>z.id),"cap-corse-bastia"]];
 for(const chain of chains)for(let i=1;i<chain.length;i++){
  const a=bounds(zones.find(z=>z.id===chain[i-1])),b=bounds(zones.find(z=>z.id===chain[i]));
  assert(Math.min(a.maxLat,b.maxLat)>Math.max(a.minLat,b.minLat)&&Math.min(a.maxLon,b.maxLon)>Math.max(a.minLon,b.minLon),chain[i-1]+" / "+chain[i]+" : absence de recouvrement");
 }
});

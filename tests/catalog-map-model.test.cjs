"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const importSource=name=>import("data:text/javascript;base64,"+require("node:fs").readFileSync(require("node:path").resolve(__dirname,"../sources/"+name)).toString("base64"));
test("projection : aller-retour, nord en haut et cadrage sans déformation",async()=>{
 const {project,unproject,fitBounds,boundsRect,scaleBar}=await importSource("catalog-map-model.js");
 for(const [lon,lat]of [[-5.2,48.3],[-2.05,46.15],[8.8,42]]){const back=unproject(...project(lon,lat));assert(Math.abs(back[0]-lon)<1e-10);assert(Math.abs(back[1]-lat)<1e-10);assert(project(lon,lat+.1)[1]<project(lon,lat)[1]);}
 const bounds={minLon:-6,minLat:47,maxLon:-4,maxLat:49},rect=boundsRect(bounds);
 for(const aspect of [.7,1.6]){const fit=fitBounds(bounds,aspect);assert(Math.abs(fit.width/fit.height-aspect)<1e-10);assert(fit.x<rect.x&&fit.y<rect.y);assert(fit.x+fit.width>rect.x+rect.width&&fit.y+fit.height>rect.y+rect.height);const scale=scaleBar(fit,390);assert(scale.km>0&&scale.pixels>0&&scale.pixels<=390*.24);}
});
test("fond embarqué : coordonnées couvertes, îles conservées et taille bornée",async()=>{
 const {MAP_DATA}=await importSource("catalog-map-data.js"),fs=require("node:fs"),path=require("node:path");
 assert.equal(MAP_DATA.source,"Natural Earth");assert(MAP_DATA.land.length>50&&MAP_DATA.coast.length>50);assert(fs.statSync(path.resolve(__dirname,"../sources/catalog-map-data.js")).size<400000);
 for(const line of [...MAP_DATA.land,...MAP_DATA.coast])for(const [lon,lat]of line){assert(lon>=-10&&lon<=14);assert(lat>=39&&lat<=54);}
 assert(MAP_DATA.coast.some(line=>line.some(([lon,lat])=>lon>8&&lon<10&&lat>41&&lat<43)),"Corse");
 assert(MAP_DATA.coast.some(line=>line.some(([lon,lat])=>lon>-2&&lon<-1&&lat>46&&lat<46.3)),"Île de Ré / littoral rochelais");
});
test("conversion : segments découpés sans relier les passages hors emprise",()=>{
 const {clipLine,clipPolygon}=require("../tools/import-map-coast.cjs");
 const lines=clipLine([[-12,45],[-8,45],[-12,46],[-8,47]]);assert.equal(lines.length,2);assert.equal(lines[0][0][0],-10);assert.equal(lines[0].at(-1)[0],-10);assert.equal(lines[1][0][0],-10);
 const ring=clipPolygon([[-12,38],[15,38],[15,55],[-12,55],[-12,38]]);assert.deepEqual(new Set(ring.map(p=>p.join(","))),new Set(["-10,39","14,39","14,54","-10,54"]));
});

test("couverture : emprise entière exigée, frontières incluses et coordonnées invalides refusées",async()=>{
 const {COVERAGE,isWithinMapCoverage}=await importSource("catalog-map-model.js");
 assert.equal(isWithinMapCoverage(COVERAGE),true);assert.equal(isWithinMapCoverage({minLon:-5,maxLon:-2,minLat:45,maxLat:48}),true);
 for(const [key,delta]of [["minLon",-.001],["maxLon",.001],["minLat",-.001],["maxLat",.001]])assert.equal(isWithinMapCoverage({...COVERAGE,[key]:COVERAGE[key]+delta}),false,key);
 for(const bounds of [null,{}, {...COVERAGE,minLat:NaN},{...COVERAGE,maxLon:Infinity},{...COVERAGE,minLon:15},{...COVERAGE,minLat:55}])assert.equal(isWithinMapCoverage(bounds),false);
});

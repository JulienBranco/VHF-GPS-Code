"use strict";
// Conversion locale des SHP Natural Earth 10m : aucune dépendance ni téléchargement.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const BOUNDS=[-10,39,14,54],TOLERANCE=.001;
function parts(file){
 const bytes=fs.readFileSync(file),out=[];
 if(bytes.readInt32BE(0)!==9994)throw Error("SHP invalide");
 for(let offset=100;offset<bytes.length;){
  const length=bytes.readInt32BE(offset+4)*2,start=offset+8,type=bytes.readInt32LE(start);offset=start+length;
  if(type===0)continue;
  if(![3,5].includes(type))throw Error("Géométrie SHP non prise en charge");
  const bounds=[0,1,2,3].map(i=>bytes.readDoubleLE(start+4+i*8));
  if(bounds[0]>BOUNDS[2]||bounds[2]<BOUNDS[0]||bounds[1]>BOUNDS[3]||bounds[3]<BOUNDS[1])continue;
  const count=bytes.readInt32LE(start+36),points=bytes.readInt32LE(start+40),base=start+44+count*4;
  for(let i=0;i<count;i++){
   const from=bytes.readInt32LE(start+44+i*4),to=i+1<count?bytes.readInt32LE(start+48+i*4):points,ring=[];
   for(let j=from;j<to;j++)ring.push([bytes.readDoubleLE(base+j*16),bytes.readDoubleLE(base+j*16+8)]);
   out.push(ring);
  }
 }
 return out;
}
function clipPolygon(ring){
 let points=ring.slice(0,-1);
 for(const [axis,limit,side]of [[0,BOUNDS[0],1],[0,BOUNDS[2],-1],[1,BOUNDS[1],1],[1,BOUNDS[3],-1]]){
  const next=[];if(!points.length)break;
  for(let i=0;i<points.length;i++){
   const a=points[(i+points.length-1)%points.length],b=points[i],insideA=side*(a[axis]-limit)>=0,insideB=side*(b[axis]-limit)>=0;
   if(insideA!==insideB){const t=(limit-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
   if(insideB)next.push(b);
  }
  points=next;
 }
 if(points.length)points.push(points[0]);return points;
}
function clipSegment(a,b){
 let low=0,high=1;const dx=b[0]-a[0],dy=b[1]-a[1];
 for(const [p,q]of [[-dx,a[0]-BOUNDS[0]],[dx,BOUNDS[2]-a[0]],[-dy,a[1]-BOUNDS[1]],[dy,BOUNDS[3]-a[1]]]){
  if(p===0){if(q<0)return null;continue;}
  const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return null;
 }
 return [[a[0]+low*dx,a[1]+low*dy],[a[0]+high*dx,a[1]+high*dy]];
}
function clipLine(points){
 const out=[];let current=[];
 for(let i=1;i<points.length;i++){
  const segment=clipSegment(points[i-1],points[i]);
  if(!segment){if(current.length>1)out.push(current);current=[];continue;}
  const last=current.at(-1);
  if(last&&(Math.abs(last[0]-segment[0][0])>1e-9||Math.abs(last[1]-segment[0][1])>1e-9)){if(current.length>1)out.push(current);current=[];}
  if(!current.length)current.push(segment[0]);current.push(segment[1]);
 }
 if(current.length>1)out.push(current);return out;
}
function simplify(points){
 if(points.length<3)return points;
 const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
 while(stack.length){
  const [first,last]=stack.pop(),a=points[first],b=points[last],dx=b[0]-a[0],dy=b[1]-a[1],norm=dx*dx+dy*dy;
  let distance=TOLERANCE*TOLERANCE,index=-1;
  for(let i=first+1;i<last;i++){
   const p=points[i],t=norm?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/norm)):0;
   const d=(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
   if(d>distance){distance=d;index=i;}
  }
  if(index>=0){keep.add(index);stack.push([first,index],[index,last]);}
 }
 return [...keep].sort((a,b)=>a-b).map(i=>points[i].map(n=>Number(n.toFixed(5))));
}
function convert(directory){
 const land=parts(path.join(directory,"ne_10m_land.shp")).map(clipPolygon).map(simplify).filter(r=>r.length>=4);
 const coast=parts(path.join(directory,"ne_10m_coastline.shp")).flatMap(clipLine).map(simplify).filter(r=>r.length>=2);
 const archives={};for(const name of ["ne_10m_land","ne_10m_coastline"])archives[name]=crypto.createHash("sha256").update(fs.readFileSync(path.join(directory,name+".zip"))).digest("hex");
 const header="// Natural Earth 10m, domaine public. Extrait simplifié : tools/import-map-coast.cjs.\n";
 const source=header+"export const MAP_DATA="+JSON.stringify({source:"Natural Earth",bounds:BOUNDS,toleranceDegrees:TOLERANCE,archives,land,coast})+";\n";
 fs.writeFileSync(path.resolve(__dirname,"../sources/catalog-map-data.js"),source);
 console.log(`${Buffer.byteLength(source)} octets, ${land.length} polygones, ${coast.length} lignes de côte.`);
}
if(require.main===module){if(!process.argv[2])throw Error("Indiquer le dossier des archives Natural Earth décompressées");convert(process.argv[2]);}
module.exports={clipPolygon,clipLine,simplify};

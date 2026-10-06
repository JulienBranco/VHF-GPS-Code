// Projection et cadrage réutilisables pour une future sous-couche du suivi.
export const FRANCE_BOUNDS={minLon:-7.8,minLat:40.5,maxLon:10.2,maxLat:51.8};
export const COVERAGE={minLon:-10,minLat:39,maxLon:14,maxLat:54};
export function project(lon,lat){
 if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lat)>=85)throw Error("Coordonnées cartographiques hors couverture");
 return [lon,-180/Math.PI*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
}
export function unproject(x,y){return [x,(2*Math.atan(Math.exp(-y*Math.PI/180))-Math.PI/2)*180/Math.PI];}
export function fitBounds(bounds,aspect=1.4,padding=.12){
 const a=project(bounds.minLon,bounds.maxLat),b=project(bounds.maxLon,bounds.minLat),cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2;
 let width=(b[0]-a[0])*(1+padding*2),height=(b[1]-a[1])*(1+padding*2);
 if(width/height<aspect)width=height*aspect;else height=width/aspect;
 return {x:cx-width/2,y:cy-height/2,width,height};
}
export function geometryPath(parts,closed=false){return parts.map(points=>points.map(([lon,lat],i)=>{const [x,y]=project(lon,lat);return (i?"L":"M")+x.toFixed(5)+","+y.toFixed(5);}).join("")+(closed?"Z":"")).join("");}
export function boundsRect(bounds){const [x,y]=project(bounds.minLon,bounds.maxLat),[right,bottom]=project(bounds.maxLon,bounds.minLat);return {x,y,width:right-x,height:bottom-y};}
export function scaleBar(view,pixels){
 const [,latitude]=unproject(view.x+view.width/2,view.y+view.height/2),kmPerUnit=111.32*Math.cos(latitude*Math.PI/180),maxKm=view.width*kmPerUnit*.24;
 const power=10**Math.floor(Math.log10(maxKm)),km=[1,2,5,10].map(n=>n*power).filter(n=>n<=maxKm).at(-1)||power/2;
 return {km,pixels:km/kmPerUnit/view.width*pixels};
}

export function isWithinMapCoverage(bounds){
 if(!bounds||!["minLon","maxLon","minLat","maxLat"].every(key=>Number.isFinite(bounds[key])))return false;
 return bounds.minLon<=bounds.maxLon&&bounds.minLat<=bounds.maxLat&&bounds.minLon>=COVERAGE.minLon&&bounds.maxLon<=COVERAGE.maxLon&&bounds.minLat>=COVERAGE.minLat&&bounds.maxLat<=COVERAGE.maxLat;
}

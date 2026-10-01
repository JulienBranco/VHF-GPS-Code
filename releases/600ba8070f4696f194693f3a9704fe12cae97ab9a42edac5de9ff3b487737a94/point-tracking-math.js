// Calculs de navigation indépendants du moteur radio, du DOM et du stockage.
const R = 6371000, RAD = Math.PI / 180;
export const STALE_MS = 20000, MAX_ACCURACY = 100, MIN_SPEED = 0.8;
export function distance(a, b) {
  const p = (b.lat-a.lat)*RAD, q = (b.lon-a.lon)*RAD;
  const h = Math.sin(p/2)**2 + Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(q/2)**2;
  return 2*R*Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function bearing(a, b) {
  const p=a.lat*RAD, q=b.lat*RAD, d=(b.lon-a.lon)*RAD;
  const y=Math.sin(d)*Math.cos(q), x=Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(d);
  return Math.abs(x)+Math.abs(y)<1e-12 ? null : (Math.atan2(y,x)/RAD+360)%360;
}
export function angleDelta(from, to) { return ((to-from+540)%360)-180; }
export function readFix(position, now=Date.now()) {
  const c=position?.coords, time=position?.timestamp;
  if(!c || !Number.isFinite(c.latitude) || Math.abs(c.latitude)>90 ||
     !Number.isFinite(c.longitude) || Math.abs(c.longitude)>180 ||
     !Number.isFinite(c.accuracy) || c.accuracy<0 ||
     !Number.isFinite(time) || time<=0 || time>now+2000) return null;
  return {lat:c.latitude,lon:c.longitude,accuracy:c.accuracy,time,
    speed:Number.isFinite(c.speed)&&c.speed>=0&&c.speed<=80 ? c.speed : null,
    heading:Number.isFinite(c.heading)&&c.heading>=0&&c.heading<360 ? c.heading : null};
}
export function isFresh(fix, now=Date.now()) { return !!fix && now-fix.time<=STALE_MS; }
export function reliable(fix, now=Date.now()) { return isFresh(fix,now) && fix.accuracy<=MAX_ACCURACY; }
export function plausible(fix, previous) {
  if(!previous) return true;
  const seconds=(fix.time-previous.time)/1000;
  return seconds>0 && (seconds>STALE_MS/1000 || distance(previous,fix)<=80*seconds+previous.accuracy+fix.accuracy);
}
export function motion(fixes, now=Date.now()) {
  const last=fixes.at(-1);
  if(!reliable(last,now)) return {speed:null,heading:null};
  if(last.speed!==null && last.speed<MIN_SPEED) return {speed:last.speed,heading:null,stable:false};
  const recent=fixes.filter(f=>last.time-f.time<=30000 && f.accuracy<=MAX_ACCURACY);
  // Le cap GPS est une route sur le fond. Aucune boussole du téléphone n'est utilisée.
  const speeds=recent.filter(f=>Number.isFinite(f.speed)).map(f=>f.speed);
  let speed=speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : null;
  let heading=last.heading;
  const first=recent.find(f=>last.time-f.time>=5000);
  if(first && distance(first,last)>Math.max(10,first.accuracy+last.accuracy)) {
    if(speed===null) speed=distance(first,last)/((last.time-first.time)/1000);
    if(heading===null) heading=bearing(first,last);
  }
  // Plusieurs relevés sont nécessaires pour annoncer une arrivée.
  return {speed,heading,stable:recent.length>=3 && last.time-recent[0].time>=5000};
}
export function guidance(target, fix, fixes, now=Date.now()) {
  if(!fix) return {distance:null,direction:null,speed:null,heading:null,eta:null,reason:"waiting",near:false};
  const metres=distance(fix,target), direction=bearing(fix,target), m=motion(fixes,now);
  const near=metres<=Math.max(100,Math.SQRT2*50+fix.accuracy);
  let reason="warming", eta=null, delta=null;
  if(!isFresh(fix,now)) reason="stale";
  else if(fix.accuracy>MAX_ACCURACY) reason="accuracy";
  else if(near) reason="near";
  else if(m.speed!==null && m.speed<MIN_SPEED) reason="stopped";
  else if(m.heading!==null && m.speed>=MIN_SPEED && direction!==null) {
    delta=angleDelta(m.heading,direction);
    const closing=m.speed*Math.cos(delta*RAD);
    if(closing<=0) reason="away";
    else if(Math.abs(delta)>75) reason="across";
    else if(m.stable) { reason="moving"; eta=metres/closing; }
  }
  const good=reliable(fix,now);
  return {distance:metres,direction,speed:good?m.speed:null,
    heading:good&&m.speed>=MIN_SPEED?m.heading:null,
    eta,delta:good?delta:null,reason,near:good&&near};
}
// Projection azimutale équidistante centrée sur la destination : nord en haut,
// passage de l'antiméridien correct et distances depuis le point préservées.
export function project(point, target) {
  const d=distance(target,point), angle=bearing(target,point);
  return angle===null ? {x:0,y:0} : {x:d*Math.sin(angle*RAD),y:d*Math.cos(angle*RAD)};
}
export function distanceLabel(metres) {
  if(metres===null) return "—";
  return metres<1000 ? Math.round(metres)+" m" :
    (metres/1852).toLocaleString("fr-FR",{maximumFractionDigits:metres<1852?2:1})+" milles";
}
export function durationLabel(seconds) {
  if(seconds===null) return "—";
  const mins=Math.max(1,Math.round(seconds/60));
  return mins<60 ? mins+" min" : Math.floor(mins/60)+" h "+String(mins%60).padStart(2,"0");
}

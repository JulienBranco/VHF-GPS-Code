// Données du journal uniquement : aucun secret, calcul radio ou appel réseau.
export const HISTORY_KEY="vhfGpsPositionHistoryV1";
export const MAX_HISTORY_CHARS=300000;
export function validEntry(e){
  return !!e && typeof e.id==="string" && /^[a-f0-9]{32}$/.test(e.id) &&
    ["generated","received"].includes(e.kind) && Number.isSafeInteger(e.at) && e.at>0 && Number.isFinite(new Date(e.at).getTime()) &&
    Number.isFinite(e.lat) && Math.abs(e.lat)<=90 && Number.isFinite(e.lon) && Math.abs(e.lon)<=180 &&
    typeof e.phrase==="string" && e.phrase.length>0 && e.phrase.length<=300 &&
    !!e.zone && typeof e.zone.id==="string" && e.zone.id.length<=160 &&
    typeof e.zone.name==="string" && e.zone.name.length>0 && e.zone.name.length<=300 &&
    ["builtin","ephemeral","custom"].includes(e.zone.type) &&
    Number.isFinite(e.zone.lat) && Math.abs(e.zone.lat)<=90 && Number.isFinite(e.zone.lon) && Math.abs(e.zone.lon)<=180;
}
// Une liste blanche évite de mémoriser par mégarde des objets du moteur (clés incluses).
export function copyEntry(e){return {id:e.id,kind:e.kind,at:e.at,lat:e.lat,lon:e.lon,phrase:e.phrase,zone:{id:e.zone.id,name:e.zone.name,type:e.zone.type,lat:e.zone.lat,lon:e.zone.lon}};}
export function decodeHistory(raw,outingId){
  if(raw===null)return [];
  const data=JSON.parse(raw);
  if(data?.format!==1 || data.outingId!==outingId || !Array.isArray(data.entries) ||
    data.entries.some(e=>!validEntry(e)) || new Set(data.entries.map(e=>e.id)).size!==data.entries.length){
    throw Error("L’historique mémorisé de cette sortie ne peut pas être lu.");
  }
  return data.entries.map(copyEntry);
}
export function encodeHistory(entries,outingId){
  if(entries.some(e=>!validEntry(e)))throw Error("Point invalide pour l’historique.");
  const raw=JSON.stringify({format:1,outingId,entries:entries.map(copyEntry)});
  // Ne jamais éliminer des points silencieusement pour respecter la limite de stockage.
  if(raw.length>MAX_HISTORY_CHARS)throw Error("L’historique est plein. Ce nouveau point n’a pas pu être enregistré.");
  return raw;
}
export function newestFirst(entries){
  // En cas d’heure identique, la dernière entrée enregistrée est présentée en premier.
  return entries.map((e,i)=>({e,i})).sort((a,b)=>b.e.at-a.e.at || b.i-a.i).map(row=>row.e);
}
export function marineAxis(value,latitude){
  let degrees=Math.floor(Math.abs(value)),minutes=Number(((Math.abs(value)-degrees)*60).toFixed(3));
  if(minutes===60){degrees++;minutes=0;}
  return String(degrees).padStart(latitude?2:3,"0")+"° "+minutes.toFixed(3)+"′ "+(latitude?(value<0?"S":"N"):(value<0?"W":"E"));
}

import {hash,releaseCache,manifestCheck} from "./protocol.js";
export const base=new URL("./",import.meta.url);
export const LAUNCH_KEY="vhfgps-main-launch-v1",ERROR_KEY="vhfgps-main-error-v1";
// Copie de ce module placée dans chaque publication : retrouver le lanceur sans URL externe.
export function distributionBase(){return base.pathname.includes("/releases/")?new URL("../../",base):base;}
export function fileURL(id,name){releaseCache(id);return new URL("releases/"+id+"/"+name,distributionBase());}
export async function network(url){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
 try{const response=await fetch(url,{cache:"no-store",headers:{"X-VHF-Integration-Download":"1"},signal:abort.signal});if(!response.ok)throw Error("Téléchargement indisponible ("+response.status+").");const bytes=await response.arrayBuffer();if(bytes.byteLength>2500000)throw Error("Fichier trop volumineux.");return bytes;}
 catch(error){if(error.name==="AbortError"||error instanceof TypeError)throw Error("Connexion indisponible. La sortie précédente est conservée.");throw error;}
 finally{clearTimeout(timer);}
}
export async function verify(id,manifest){
 manifestCheck(manifest);if(await hash(JSON.stringify(manifest))!==id)throw Error("Publication incohérente.");
 const cache=await caches.open(releaseCache(id));
 for(const f of manifest.files){const response=await cache.match(fileURL(id,f.path));if(!response||await hash(await response.arrayBuffer())!==f.sha256)throw Error("Version de cette sortie incomplète sur ce téléphone. Réimporte son invitation avec Internet.");}
}
export async function download(id,known){
 if(known){try{await verify(id,known);return known;}catch{}}
 const bytes=await network(fileURL(id,"manifest.json"));if(await hash(bytes)!==id)throw Error("La version reçue n’est pas celle demandée.");
 const manifest=manifestCheck(JSON.parse(new TextDecoder().decode(bytes))),cache=await caches.open(releaseCache(id));
 for(const f of manifest.files){
  const cached=await cache.match(fileURL(id,f.path));if(cached&&await hash(await cached.arrayBuffer())===f.sha256)continue;
  const body=await network(fileURL(id,f.path));if(await hash(body)!==f.sha256)throw Error("Un fichier est incomplet ou altéré. La sortie précédente est conservée.");
  const type=f.path.endsWith(".html")?"text/html":f.path.endsWith(".js")?"text/javascript":f.path.endsWith(".css")?"text/css":"application/octet-stream";
  await cache.put(fileURL(id,f.path),new Response(body,{headers:{"Content-Type":type+"; charset=utf-8"}}));
 }
 await cache.put(fileURL(id,"manifest.json"),new Response(bytes,{headers:{"Content-Type":"application/json"}}));await verify(id,manifest);return manifest;
}

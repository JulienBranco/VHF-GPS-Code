"use strict";
const SHELL_BUILD=__BUILD__,ASSETS=__ASSETS__;
const PREFIX="vhfgps-main-shell-",CACHE=PREFIX+SHELL_BUILD,CONTROL="vhfgps-main-control-v1",BASE=self.registration.scope;
const absolute=path=>new URL(path,BASE).href;
const shellURLs=new Set(ASSETS.map(file=>absolute(file.path)));
const inScope=client=>client.url.startsWith(BASE);
const releaseId=url=>new URL(url).pathname.slice(new URL(BASE).pathname.length).match(/^releases\/([a-f0-9]{64})\//)?.[1];
const controlURL=key=>absolute("__control__/"+encodeURIComponent(key));
async function controlRead(key){const response=await(await caches.open(CONTROL)).match(controlURL(key));return response?response.text():null;}
async function controlWrite(key,value){
 const cache=await caches.open(CONTROL);await cache.put(controlURL(key),new Response(value));
 if(/^(page|download):/.test(key))await cache.put(controlURL("created:"+key.slice(key.indexOf(":")+1)),new Response(String(Date.now())));
}
async function hash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),n=>n.toString(16).padStart(2,"0")).join("");}
async function windows(){return(await self.clients.matchAll({type:"window",includeUncontrolled:true})).filter(inScope);}
function openStore(){return new Promise((resolve,reject)=>{
 const request=indexedDB.open("vhfgps-main-v1",1);
 request.onupgradeneeded=()=>request.result.createObjectStore("state");
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function activeRelease(){
 const db=await openStore();try{return await new Promise((resolve,reject)=>{
  const request=db.transaction("state").objectStore("state").get("active");
  request.onsuccess=()=>resolve(request.result?.deleted?null:request.result?.release);request.onerror=()=>reject(request.error);
 });}finally{db.close();}
}
async function resetState(){
 const db=await openStore();try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction("state","readwrite"),store=tx.objectStore("state");let revision;
  const request=store.get("active");request.onsuccess=()=>{
   revision=(request.result?.revision||0)+1;store.clear();store.put({deleted:true,revision},"active");
  };
  tx.oncomplete=()=>resolve(revision);tx.onabort=()=>reject(tx.error||Error("Remise à zéro interrompue"));
 });}finally{db.close();}
}
async function applyReset(){
 const response=await(await caches.open(CACHE)).match(absolute("releases.json"));
 const token=(await response.json()).reset||"initial";
 if(token!=="initial"&&!/^[a-f0-9]{32}$/.test(token))throw Error("Remise à zéro invalide");
 const previous=await controlRead("reset");if(previous===token)return false;
 // Une mise à jour ordinaire adopte le marqueur initial sans effacer les sorties.
 if(token!=="initial"){
  await resetState();
  for(const name of await caches.keys())if(name.startsWith("vhfgps-main-release-"))await caches.delete(name);
 }
 await controlWrite("reset",token);return token!=="initial";
}
async function pruneReleases(){
 // L'état sauvegardé et toutes les pages de sortie encore ouvertes sont protégés.
 const keep=new Set(),active=await activeRelease();if(active)keep.add(active);
 for(const client of await windows()){
  const id=releaseId(client.url);if(id)keep.add(id);
  const pending=await controlRead("download:"+client.id);if(pending)keep.add(pending);
 }
 for(const name of await caches.keys()){
  const id=name.slice("vhfgps-main-release-".length);
  if(!name.startsWith("vhfgps-main-release-")||keep.has(id))continue;
  // Une autre page peut avoir enregistré une sortie depuis notre premier relevé.
  if(await activeRelease()===id||(await windows()).some(client=>releaseId(client.url)===id))continue;
  await caches.delete(name);
 }
}
async function cleanShells(){
 const clients=await windows(),keep=new Set([SHELL_BUILD]),live=new Set(clients.map(client=>client.id));
 for(const client of clients){const build=await controlRead("page:"+client.id);if(build)keep.add(build);}
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&!keep.has(name.slice(PREFIX.length)))await caches.delete(name);
 const control=await caches.open(CONTROL);
 for(const request of await control.keys()){
  const key=decodeURIComponent(new URL(request.url).pathname.split("/").pop());
  if(/^(page|download):/.test(key)){
   const id=key.slice(key.indexOf(":")+1),created=Number(await controlRead("created:"+id)||Date.now());
   // Ne pas supprimer la réservation d'une navigation encore en cours.
   if(!live.has(id)&&Date.now()-created>86400000){await control.delete(request);await control.delete(controlURL("created:"+id));}
  }
 }
}
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 await controlWrite("upgrade:"+SHELL_BUILD,self.registration.active?"yes":"no");
 try{
  for(const file of ASSETS){
   const response=await fetch(absolute(file.path),{cache:"no-store"});
   if(!response.ok||await hash(await response.clone().arrayBuffer())!==file.sha256)throw Error("Shell incomplet");
   await cache.put(absolute(file.path),response);
  }
 }catch(error){await caches.delete(CACHE);throw error;}
 // Activer uniquement après le téléchargement et la vérification de l'accueil entier.
 await self.skipWaiting();
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 const reset=await applyReset(),upgrade=await controlRead("upgrade:"+SHELL_BUILD)==="yes";
 await self.clients.claim();
 for(const client of await windows()){
  const url=new URL(client.url),relative=url.pathname.slice(new URL(BASE).pathname.length);
  // Les anciennes pages n'ont pas de version d'accueil épinglée : les débloquer une fois.
  // Une mise à jour normale ne navigue jamais une page de publication.
  if(reset||(upgrade&&["","index.html","vhf_gps_code.html"].includes(relative)&&!await controlRead("page:"+client.id))){
   client.navigate(reset?absolute("?reset=1"):BASE).catch(()=>{});
  }else if(!releaseId(client.url))client.postMessage({type:"VHF_LAUNCHER_UPDATED",api:1,build:SHELL_BUILD});
 }
 await cleanShells();
 for(const name of await caches.keys())if(name.startsWith("vhfgps-integration-")||name.startsWith("vhfgps-distribution-")||name.startsWith("vhf-gps-code-app-"))await caches.delete(name);
})()));
self.addEventListener("message",event=>{
 const data=event.data;if(data?.api!==1||!event.source||!inScope(event.source))return;
 if(data.type==="VHF_LAUNCHER_ACTIVATE")self.skipWaiting();
 if(data.type==="VHF_LAUNCHER_INFO"&&event.ports[0]){event.ports[0].postMessage({type:"VHF_LAUNCHER_INFO",api:1,build:SHELL_BUILD});event.ports[0].close();}
 if(data.type==="VHF_RELEASE_PRUNE")event.waitUntil(pruneReleases().then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));
});
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||!url.href.startsWith(BASE))return;
 const relative=url.pathname.slice(new URL(BASE).pathname.length),release=relative.match(/^releases\/([a-f0-9]{64})\/([a-zA-Z0-9_./-]+)$/);
 if(request.headers.get("X-VHF-Integration-Download")==="1"){
  event.respondWith((async()=>{
   if(release&&event.clientId)await controlWrite("download:"+event.clientId,release[1]);
   return fetch(request,{cache:"no-store"});
  })());return;
 }
 if(release){
  event.respondWith((async()=>{
   const cache=await caches.open("vhfgps-main-release-"+release[1]);
   return await cache.match(url.origin+url.pathname)||new Response("Version de sortie absente du téléphone.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  })());return;
 }
 const navigation=request.mode==="navigate"&&["","index.html","vhf_gps_code.html"].includes(relative);
 const target=navigation?absolute("index.html"):url.origin+url.pathname;
 if(shellURLs.has(target))event.respondWith((async()=>{
  let build=SHELL_BUILD;
  if(navigation&&event.resultingClientId)await controlWrite("page:"+event.resultingClientId,build);
  else if(event.clientId)build=await controlRead("page:"+event.clientId)||build;
  const cache=await caches.open(PREFIX+build),response=await cache.match(target);
  if(!response)return new Response("Lanceur incomplet. Revenir en ligne.",{status:503});
  if(navigation){
   const html=(await response.text()).replace('content="__VHF_LAUNCHER_BUILD__"','content="'+build+'"');
   return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
  }
  return response;
 })());
});

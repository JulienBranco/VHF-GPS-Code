"use strict";
const SHELL_BUILD=__BUILD__, ASSETS=__ASSETS__;
const PREFIX="vhfgps-prototype-shell-",CACHE=PREFIX+SHELL_BUILD,BASE=self.registration.scope;
const absolute=path=>new URL(path,BASE).href;
const shellURLs=new Set(ASSETS.map(file=>absolute(file.path)));
async function hash(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),n=>n.toString(16).padStart(2,"0")).join("");}
self.addEventListener("install",event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 for(const file of ASSETS){
  const response=await fetch(absolute(file.path),{cache:"no-store"});
  if(!response.ok||await hash(await response.clone().arrayBuffer())!==file.sha256)throw new Error("Shell incomplet");
  await cache.put(absolute(file.path),response);
 }
 // Le lanceur attend la fermeture de ses fenêtres ; les sorties gardent leurs fichiers.
})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||!url.href.startsWith(BASE))return;
 if(request.headers.get("X-VHF-Prototype-Download")==="1"){
  event.respondWith(fetch(request,{cache:"no-store"}));return;
 }
 const relative=url.pathname.slice(new URL(BASE).pathname.length);
 const release=relative.match(/^releases\/([a-f0-9]{64})\/(app\.html|engine\.js|manifest\.json)$/);
 if(release){
  event.respondWith((async()=>{
   const cache=await caches.open("vhfgps-prototype-release-"+release[1]);
   return await cache.match(url.origin+url.pathname)||new Response("Version de sortie absente du téléphone.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  })());return;
 }
 const target=(relative===""||relative==="index.html")?absolute("index.html"):url.origin+url.pathname;
 if(shellURLs.has(target))event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  return await cache.match(target)||new Response("Lanceur incomplet. Revenir en ligne.",{status:503});
 })());
});

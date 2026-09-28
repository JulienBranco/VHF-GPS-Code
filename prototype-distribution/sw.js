"use strict";
const SHELL_BUILD="3b301e01a1373158ba0eeb1eda48297df82b3fe1ab6688a30f8d737487c0b25b", ASSETS=[{"path":"index.html","sha256":"6c804ac1cfba86b054fc970b54ac745c0e371863b37874180c77b85687f25aa4"},{"path":"style.css","sha256":"951d1ff430a7216693d0ab9a71da0fffe3eb56ee0c6e62eac753a99843602fd1"},{"path":"boot.js","sha256":"f76cfa89951af38231254530595d2552f2c644ff51b539f03741d74ae160ccb3"},{"path":"protocol.js","sha256":"f76f3c3f82f679f2ade95af6fc4cfd11c5062b919f89e22a1dbdd9b239b51856"},{"path":"storage.js","sha256":"560c657c345d813aedcfb4840b83cff5635620a7685ca0d0d7901ece7329c4d0"},{"path":"manifest.webmanifest","sha256":"d3a8e5ac24e0765532fd32a8f3d47b98658fb3cf068cb0e52335939901fed15f"},{"path":"GUIDE.html","sha256":"d5e78025bcd9e8770b36d30f6012cff2eb63603edf3cd407ff76476cb6999d28"},{"path":"icons/icon-192.png","sha256":"8f702f6805967c996d5231ec966033cadac97b3de8126fdbb745f197d081ae46"},{"path":"icons/icon-512.png","sha256":"97f4df8ada34a30a70f3e4b8ec880f2256564cf75b0ef8009ff37a6f087c347f"},{"path":"icons/apple-touch-icon.png","sha256":"e9fed353eee82789cbd42f960e9f952add6f176bde8c6434e32c74820d4cd8c2"}];
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

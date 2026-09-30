"use strict";
const SHELL_BUILD="614377e76bab0ea9309f646ea4865c7a21c5ec530ec8530becd153b79564047f", ASSETS=[{"path":"index.html","sha256":"e7bfe20aad37b57c8b1e280241ffbfe89bc756b77668c87d60ed80b8d4ef8184"},{"path":"boot.js","sha256":"1a4d0e36aa476e0dc4b8a32b1efd75bd9df1f856dfadc5b7f3d3bd69916b28f1"},{"path":"protocol.js","sha256":"bf50659d81a85c93c53258f4cc8341bd498a9573f6c04f24a56072a89a77cac1"},{"path":"storage.js","sha256":"2e29a1a8e4b322d29d5723c6758cdb2a065c7f42a49b2ee3bc6b12394e78a3f8"},{"path":"release.js","sha256":"00c10517b0e60de8238fbd3898403e82a6b7c2f3e9885fb3ff41d6fc9781bb71"},{"path":"transition.js","sha256":"ca157b2f01462c9ee46f2174c69ef32444ea81f074cb9f535cd40adcde4a2058"},{"path":"transition.css","sha256":"af984953bfc51e6f14d11a5842d13131197334208d305310fff99226f3a10274"},{"path":"install.js","sha256":"10b9b9d68196b1cc7cf716fa20f944b4bc6bc5787bcefacf504683537a642db6"},{"path":"style.css","sha256":"7d168502937abd69b6a37c2f7ebe2832d7202e2c5452273424b23dc5591265ff"},{"path":"manifest.webmanifest","sha256":"250db6c3c7521ab59072f305acc342cbdb8bda449d0b0dc04a073879ed11a2c5"},{"path":"GUIDE.html","sha256":"bec0d4114c24447459efc97fd806ec868153927705a4e118c2dc263c52bcdb55"},{"path":"releases.json","sha256":"16ed67b7f36c181dde0ed4f99585b9240fc6d6a4568014cf91cad43881955576"},{"path":"icons/icon-192.png","sha256":"63c838271aee50128a3d81a96a5da894a0059bce222821d957fa9b44b16ff28c"},{"path":"icons/icon-512.png","sha256":"15ed068868ef69c6778c95d97a241211cf577027a744214dfc9b2d33b0bf4550"},{"path":"icons/apple-touch-icon.png","sha256":"535e3d651e487c4b891a3c9c2b5f1d2c1be69c670a204fd98f57829409fc97ab"}];
const PREFIX="vhfgps-main-shell-",CACHE=PREFIX+SHELL_BUILD,BASE=self.registration.scope;
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
 for(const name of await caches.keys())if((name.startsWith(PREFIX)&&name!==CACHE)||name.startsWith("vhfgps-integration-shell-")||name.startsWith("vhfgps-integration-release-")||name.startsWith("vhfgps-distribution-shell-")||name.startsWith("vhfgps-distribution-release-")||name.startsWith("vhf-gps-code-app-"))await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener("fetch",event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=="GET"||url.origin!==self.location.origin||!url.href.startsWith(BASE))return;
 if(request.headers.get("X-VHF-Integration-Download")==="1"){
  event.respondWith(fetch(request,{cache:"no-store"}));return;
 }
 const relative=url.pathname.slice(new URL(BASE).pathname.length);
 const release=relative.match(/^releases\/([a-f0-9]{64})\/([a-zA-Z0-9_./-]+)$/);
 if(release){
  event.respondWith((async()=>{
   const cache=await caches.open("vhfgps-main-release-"+release[1]);
   return await cache.match(url.origin+url.pathname)||new Response("Version de sortie absente du téléphone.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  })());return;
 }
 const target=(relative===""||relative==="index.html")?absolute("index.html"):url.origin+url.pathname;
 if(shellURLs.has(target))event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  return await cache.match(target)||new Response("Lanceur incomplet. Revenir en ligne.",{status:503});
 })());
});

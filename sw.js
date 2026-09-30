"use strict";
const SHELL_BUILD="24bc7b489e60b1831e0af176b7978479947f00b0c94123fd2806234e8b627a16", ASSETS=[{"path":"index.html","sha256":"d933b6ee867bd32e00ac257baf95e2887adff1eba026f1fc4a2552ca11e341d8"},{"path":"boot.js","sha256":"48068bcacc3d9db762b415650056b9b2d2b8be10fe2325c8acb8a4af6a2cad38"},{"path":"protocol.js","sha256":"e221c63501fbd3f4ea02adeaa61260bb838edfedb63756d83a4f4e2375b89a9b"},{"path":"storage.js","sha256":"09597f5fb7f022a5e3e2ca32734bc6b2fbfe4c4f8f252235bcebb99a517fcde9"},{"path":"release.js","sha256":"63a4f95c6676957f4e49a6580a7d645c9b01e8d60ac2035954a297873201f97b"},{"path":"transition.js","sha256":"ca157b2f01462c9ee46f2174c69ef32444ea81f074cb9f535cd40adcde4a2058"},{"path":"transition.css","sha256":"af984953bfc51e6f14d11a5842d13131197334208d305310fff99226f3a10274"},{"path":"technical-info.js","sha256":"42b4ad1f34f2d8583a3510d792fa316ae9f304ad55bf0da3e9f6d94864018186"},{"path":"install.js","sha256":"10b9b9d68196b1cc7cf716fa20f944b4bc6bc5787bcefacf504683537a642db6"},{"path":"style.css","sha256":"5c71004112effc92dd9ae7c44ca0754bd6ac10bbe88cdb1b1892ae18d5c31961"},{"path":"manifest.webmanifest","sha256":"db8f807be14080682cf9176c0a2beed3fb3342788ac2fb5e58861f0aa37e207f"},{"path":"releases.json","sha256":"91a2fb6100b0f3868249017cac6399e11ead3e542966257757a0887da030c249"},{"path":"icons/icon-192.png","sha256":"c642823301de114ac0a87a02123d6a63d48dcd9f78dabd100722224f51ba147b"},{"path":"icons/icon-512.png","sha256":"b2514c68ecda4900b909d6209f326f85255ca77845df5db794e45f59028cc8c4"},{"path":"icons/icon-maskable-192.png","sha256":"4b708c534e1b2bc1c869be46d6fb1acbccd6d014bb16de40e351e981a994aa26"},{"path":"icons/icon-maskable-512.png","sha256":"0b962ff9cafd0b89b0191d3f4a0d6437135161375f778151e9b19afa5c59e4a8"},{"path":"icons/apple-touch-icon.png","sha256":"c6b9b5b9f264c2a4fad6bbe6a18ac1e846d2ba06e5a9510869f13759a5aa495c"}];
const PREFIX="vhfgps-main-shell-",CACHE=PREFIX+SHELL_BUILD,BASE=self.registration.scope;
const absolute=path=>new URL(path,BASE).href;
const shellURLs=new Set(ASSETS.map(file=>absolute(file.path)));
self.addEventListener("message",event=>{
 if(event.data?.type==="VHF_LAUNCHER_INFO"&&event.data.api===1&&event.ports[0]){
  event.ports[0].postMessage({type:"VHF_LAUNCHER_INFO",api:1,build:SHELL_BUILD});
 }
});
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

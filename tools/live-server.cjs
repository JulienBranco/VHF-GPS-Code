"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const LIVE_ID="d".repeat(64);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".png":"image/png"};
const releaseFiles=new Map([
 ["app.html","sources/app.html"],["engine.js","sources/engine.js"],
 ["app-adapter.js","sources/app-adapter.js"],["runtime.js","sources/runtime.js"],
 ...["point-tracking.js","point-tracking-math.js","point-tracking.css","position-history.js","position-history-model.js","position-history.css","vhf-channels.js","vhf-channels-model.js"].map(name=>[name,"sources/"+name]),
 ...["protocol.js","storage.js","transition.js","transition.css","technical-info.js"].map(name=>[name,name])
]);
const liveWorker=`"use strict";\nself.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));\nself.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));\nself.addEventListener("fetch",event=>{if(event.request.url.startsWith(self.registration.scope))event.respondWith(fetch(event.request,{cache:"no-store"}));});\n`;
const previewInfo=`self.addEventListener("message",event=>{if(event.data?.type==="VHF_LAUNCHER_INFO"&&event.data.api===1&&event.ports[0])event.ports[0].postMessage({type:"VHF_LAUNCHER_INFO",api:1,preview:true});});\n`;
const liveRelease=`import {manifestCheck} from "./protocol.js";
export const base=new URL("./",import.meta.url);
export const LAUNCH_KEY="vhfgps-live-launch-v1",ERROR_KEY="vhfgps-live-error-v1";
const ID="${LIVE_ID}";
export function distributionBase(){return base.pathname.includes("/releases/")?new URL("../../",base):base;}
export function fileURL(id,name){if(id!==ID)throw Error("Cette invitation ne vient pas de l’aperçu local.");return new URL("releases/"+id+"/"+name,distributionBase());}
export async function network(url){try{const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw Error("Fichier indisponible ("+response.status+").");return response.arrayBuffer();}catch(error){if(error instanceof TypeError)throw Error("Serveur local indisponible.");throw error;}}
export function verify(id,manifest){if(id!==ID)throw Error("Publication hors aperçu local.");manifestCheck(manifest);}
export async function download(id){if(id!==ID)throw Error("Une invitation publiée ne peut pas être installée dans l’aperçu local.");const bytes=await network(fileURL(id,"manifest.json"));return manifestCheck(JSON.parse(new TextDecoder().decode(bytes)));}
`;
const badge='<style id="live-preview-style">body::after{content:"APERÇU LOCAL · ne pas partager les invitations";position:fixed;right:8px;bottom:8px;z-index:99999;pointer-events:none;background:#742929;color:white;border-radius:6px;padding:5px 7px;font:700 11px system-ui;box-shadow:0 2px 8px #0005}</style>';
function manifest(){
 const engine=fs.readFileSync(path.join(root,"sources/engine.js"),"utf8");
 const version=engine.match(/const APP_VERSION="([^"]+)"/)?.[1],protocol=engine.match(/const PROTOCOL_ID="([^"]+)"/)?.[1];
 if(!version||!protocol)throw Error("Version ou protocole manquant dans les sources.");
 return JSON.stringify({format:2,api:2,version,protocol,files:[...releaseFiles.keys(),"release.js"].map(name=>({path:name,sha256:"0".repeat(64)}))});
}
function content(pathname,state){
 if(pathname==="/latest.json")return [JSON.stringify({format:2,release:LIVE_ID}),".json"];
 if(pathname==="/sw.js")return [liveWorker+previewInfo,".js"];
 if(pathname==="/release.js")return [liveRelease,".js"];
 const release=pathname.match(/^\/releases\/([a-f0-9]{64})\/([a-zA-Z0-9_.-]+)$/);
 if(release){
  if(release[1]!==LIVE_ID)throw Error("Publication hors aperçu local.");
  if(release[2]==="manifest.json")return [manifest(),".json"];
  if(release[2]==="release.js")return [liveRelease,".js"];
  const source=releaseFiles.get(release[2]);if(!source)throw Error("Fichier de publication inconnu.");
  pathname="/"+source;
 }
 if(pathname==="/")pathname="/index.html";
 const target=path.resolve(root,"."+pathname);
 if(!target.startsWith(root+path.sep))throw Error("Fichier hors périmètre.");
 const data=state.overrides.get(pathname)||fs.readFileSync(target);
 if(pathname==="/sources/app.html"||pathname==="/index.html")return [String(data).replace("</head>",badge+"</head>"),".html"];
 return [data,path.extname(target)];
}
function createLiveServer(port=0){
 const state={overrides:new Map(),requests:[]};
 const server=http.createServer((req,res)=>{
  try{
   if(req.method!=="GET"&&req.method!=="HEAD")throw Error("Méthode refusée.");
   const pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
   state.requests.push(pathname);
   const [body,ext]=content(pathname,state);
   res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});res.end(req.method==="HEAD"?undefined:body);
  }catch(error){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});res.end(error.message);}
 });
 return new Promise(resolve=>server.listen(port,"127.0.0.1",()=>resolve({server,state,url:"http://127.0.0.1:"+server.address().port+"/"})));
}
module.exports={createLiveServer,LIVE_ID};
if(require.main===module)createLiveServer(Number(process.argv[2]||8083)).then(({url})=>console.log("Aperçu local VHF GPS : "+url));

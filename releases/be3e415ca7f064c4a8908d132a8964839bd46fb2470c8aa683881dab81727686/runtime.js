import {showLoading,showPage,rememberView,restoreView,applyLoadingTheme,VIEW_KEY} from "./transition.js";
import {API,wrap,unwrap,stateCheck,sameInvitationContent} from "./protocol.js";
import {initTechnicalInfo} from "./technical-info.js";
// Désactiver ici le suivi expérimental sans toucher au moteur radio.
const POINT_TRACKING_ENABLED=true;
import {openStore,read,writeActive,retainActiveOuting} from "./storage.js";
import {distributionBase,LAUNCH_KEY,ERROR_KEY,verify} from "./release.js";
const root=distributionBase(),release=location.pathname.split("/releases/")[1]?.split("/")[0];
const banner=document.getElementById("testBanner");
applyLoadingTheme();
// Aucun bouton de l’application n’agit avant la vérification et la reprise complètes.
document.body.inert=true;
let db,record,mode="resume",expected=0,installed=false,booted=false,stopped=false,dirty=false,scheduled=false,writing=0;
let state=Object.create(null),chain=Promise.resolve(),pointTracking=null,positionHistory=null;
const broadcast=new BroadcastChannel("vhfgps-main-state-v1");
async function pruneUnusedReleases(){
 try{
  const registration=await navigator.serviceWorker.getRegistration(root.href),worker=registration?.active;
  if(worker)worker.postMessage({type:"VHF_RELEASE_PRUNE",api:1});
 }catch{}
}
async function checkLauncherUpdate(){
 if(!navigator.onLine)return;
 try{await(await navigator.serviceWorker.getRegistration(root.href))?.update();}catch{}
}
window.addEventListener("online",checkLauncherUpdate);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkLauncherUpdate();});
setInterval(()=>{if(!document.hidden)checkLauncherUpdate();},300000);
function status(text,kind="info"){banner.textContent=text;banner.dataset.kind=kind;banner.hidden=kind==="success";}
function stop(error){pointTracking?.close();showPage();stopped=true;document.body.inert=true;status((error.message||String(error))+" Rouvre VHF GPS pour continuer.","error");banner.style.background="#941c25";}
function returnHome(error,action=""){
 showLoading();sessionStorage.removeItem(LAUNCH_KEY);sessionStorage.removeItem(ERROR_KEY+"-details");
 if(error){
  const message=error.message||String(error);sessionStorage.setItem(ERROR_KEY,message);
  if(error.code==="OUTING_VERSION_MISMATCH")sessionStorage.setItem(ERROR_KEY+"-details",JSON.stringify({code:error.code,message,...error.diagnostic}));
 }
 location.replace(action?new URL("#"+action,root):root);
}
function snapshot(){return {...state};}
function outingSummary(){return {zoneName:window.activeZone()?.name||"Sortie enregistrée",createdAt:window.sessionCreatedAt()};}
function equal(a,b){return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);}
function persist(){
 if(!installed||!booted||stopped)return chain;
 dirty=false;const next=stateCheck(snapshot()),summary=outingSummary();
 chain=chain.then(async()=>{
  if(stopped)throw Error("Enregistrement interrompu.");
  if(equal(next,record.state)&&equal(summary,record.summary||{}))return;
  writing++;
  try{record=await writeActive(db,{...record,state:next,summary},record.revision);broadcast.postMessage(record.revision);}
  finally{writing--;}
 });
 chain.catch(stop);return chain;
}
function changed(){
 dirty=true;if(!installed||!booted||scheduled)return;
 scheduled=true;queueMicrotask(()=>{scheduled=false;if(dirty)persist();});
}
const storage={
 getItem:key=>Object.hasOwn(state,String(key))?state[String(key)]:null,
 setItem:(key,value)=>{key=String(key);value=String(value);if(!key.startsWith("vhfGps"))throw Error("Clé hors périmètre de l’application");if(state[key]===value)return;state[key]=value;changed();},
 removeItem:key=>{key=String(key);if(!Object.hasOwn(state,key))return;delete state[key];changed();}
};
async function commit(){if(stopped)throw Error("Enregistrement interrompu.");if(dirty)persist();await chain;}
window.VHFIntegration={
 storage,commit,
 async importContent(text){
  const incoming=await unwrap(text);
  if(!record.envelope||incoming.id!==record.id||incoming.release!==record.release||!sameInvitationContent(incoming.content,record.envelope.content)){
   throw Error("Cette invitation ne correspond pas à la sortie en cours de vérification. Annule puis reçois-la depuis l’accueil pour charger sa publication.");
  }
  return incoming.content;
 },
 async checkpoint(key,value){
  if(!installed||stopped)throw Error("Aucune sortie active.");
  document.body.inert=true;
  try{await commit();storage.setItem(key,value);await commit();}
  finally{if(!stopped)document.body.inert=false;}
 },
 share:content=>wrap({format:2,api:API,id:record.id,release:record.release,content}),
 async activate(content){
  if(installed)throw Error("Aucune préparation en cours.");
  if(record.envelope&&!sameInvitationContent(record.envelope.content,content))throw Error("L’invitation activée diffère de celle reçue.");
  try{
  await verify(record.release,record.manifest);
  const envelope={format:2,api:API,id:record.id,release:record.release,content};
  record=await writeActive(db,{...record,envelope,state:snapshot(),summary:outingSummary()},expected,{install:true});
  installed=true;dirty=false;pruneUnusedReleases();sessionStorage.removeItem(LAUNCH_KEY);sessionStorage.removeItem(VIEW_KEY);broadcast.postMessage(record.revision);
  status("Sortie enregistrée.","success");
  }catch(error){sessionStorage.removeItem(LAUNCH_KEY);status(error.message,"error");throw error;}
 },
 async navigate(action){
  if(!installed||stopped)return;
  try{rememberView(record.id);showLoading();await positionHistory?.flush();persist();await commit();location.replace(new URL("#"+action,root));}catch(error){stop(error);}
 },
 cancel:(destination="resume")=>{if(!installed)returnHome(null,destination==="resume"?"resume":"");}
};
async function changedElsewhere(){
 if(!installed||!booted||stopped||writing)return;
 const next=await read(db,"active");
 if(next?.revision!==record.revision)stop(Error("La sortie a été modifiée dans une autre fenêtre."));
}
broadcast.onmessage=()=>changedElsewhere().catch(stop);
document.addEventListener("visibilitychange",()=>{if(document.hidden){if(dirty)persist();}else changedElsewhere().catch(stop);});
function script(name){return new Promise((resolve,reject)=>{const el=document.createElement("script");el.src="./"+name;el.onload=resolve;el.onerror=()=>reject(Error("Moteur indisponible. Réimporte l’invitation avec Internet."));document.body.append(el);});}
async function start(){
 db=await openStore();
 await retainActiveOuting(db);
 const raw=sessionStorage.getItem(LAUNCH_KEY),config=raw?JSON.parse(raw):null;
 if(config){record=config.record;mode=config.mode;expected=config.expected;}else{record=await read(db,"active");expected=record?.revision||0;}
 if(!record||record.release!==release){returnHome();return;}
 stateCheck(record.state);await verify(record.release,record.manifest);
 installed=mode==="resume";
 if(installed){const current=await read(db,"active");if(current?.revision!==record.revision)throw Error("La sortie a changé pendant le chargement.");sessionStorage.removeItem(LAUNCH_KEY);}
 state=Object.assign(Object.create(null),record.state||{});
 await script("engine.js");await script("app-adapter.js");
 const info=await window.startDistributedApp({mode,content:record.envelope?.content||""});
 if(info.version!==record.manifest.version||info.protocol!==record.manifest.protocol){
  const error=Error("La version ouverte de VHF GPS ne correspond pas à celle prévue pour cette sortie.");
  error.code="OUTING_VERSION_MISMATCH";
  error.diagnostic={expectedVersion:record.manifest.version,expectedProtocol:record.manifest.protocol,loadedVersion:info.version,loadedProtocol:info.protocol};
  throw error;
 }
 if(POINT_TRACKING_ENABLED){
  try{
   const {initPointTracking}=await import("./point-tracking.js");
   pointTracking=initPointTracking({getTarget:()=>window.confirmedTrackingPoint()});
  }catch(error){
   const button=document.getElementById("startPointTracking");
   button.disabled=true;button.textContent="Suivi GPS indisponible";
   console.warn("Module de suivi indisponible",error);
  }
 }else document.getElementById("startPointTracking").hidden=true;
 try{
  const {initPositionHistory}=await import("./position-history.js");
  positionHistory=initPositionHistory({storage,commit,outingId:record.id,
    canUse:()=>installed&&!stopped,
    track:pointTracking?getTarget=>pointTracking.open(getTarget):null});
 }catch(error){
  const message=document.getElementById("positionHistoryStatus");
  message.hidden=false;message.textContent="Historique indisponible pour cette ouverture.";
  console.warn("Module d’historique indisponible",error);
 }
 initTechnicalInfo({root,outing:record});
 booted=true;checkLauncherUpdate();
 if(installed){await commit();await changedElsewhere();if(!stopped)status("Sortie retrouvée.","success");}
 else status("Confirme la sortie dans la fenêtre de l’application.");
 if(!stopped){if(mode==="resume")restoreView(record.id);document.body.inert=false;showPage();}
}
start().catch(returnHome);

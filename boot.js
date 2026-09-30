import {showLoading,showPage,applyLoadingTheme,VIEW_KEY} from "./transition.js";
import {initInstallUI} from "./install.js";
import {randomId,wrap,unwrap} from "./protocol.js";
import {openStore,read} from "./storage.js";
import {base,LAUNCH_KEY,ERROR_KEY,network,download,verify,fileURL} from "./release.js";
const $=id=>document.getElementById(id);let db,busy=true;
applyLoadingTheme();initInstallUI();
function status(text,kind="info"){$("status").textContent=text;$("status").dataset.kind=kind;if(kind==="error")showPage();}
let versionRefreshRevision=0;
function showCatalogVersion(catalog,revision){
 if(revision!==versionRefreshRevision||catalog?.format!==1||!/^[a-f0-9]{64}$/.test(catalog.latest)||!Array.isArray(catalog.releases))return;
 const latest=catalog.releases.find(row=>row.release===catalog.latest);
 if(!latest||!/^\d+(?:\.\d+){2}$/.test(latest.version))return;
 $("latestVersion").textContent="· Dernière publication v"+latest.version;
 $("latestVersion").hidden=false;
}
async function refreshLatestVersion(){
 const revision=++versionRefreshRevision,url=new URL("releases.json",base);
 try{const response=await fetch(url);if(response.ok)showCatalogVersion(await response.json(),revision);}catch{}
 if(!navigator.onLine)return;
 try{showCatalogVersion(JSON.parse(new TextDecoder().decode(await network(url))),revision);}catch{}
}
function busySet(value){busy=value;$("create").disabled=busy;$("receive").disabled=busy;$("resume").disabled=busy;$("deleteOuting").disabled=busy;$("confirmDelete").disabled=busy;$("cancelDelete").disabled=busy;$("receiveForm").querySelector("button[type=submit]").disabled=busy;}
function createdLabel(record){const created=Number(record.summary?.createdAt||record.state?.vhfGpsSessionCreatedAtV312||0);return Number.isFinite(created)&&created>0&&Number.isFinite(new Date(created).getTime())?"Créée le "+new Date(created).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"}):"";}
function enter(record,mode,expected){
 showLoading();sessionStorage.setItem(LAUNCH_KEY,JSON.stringify({record,mode,expected}));
 location.replace(fileURL(record.release,"app.html"));
}
async function restore(){
 const record=await read(db,"active");if(!record||record.deleted){status("Prêt à préparer une sortie.");return false;}
 await verify(record.release,record.manifest);enter(record,"resume",record.revision);return true;
}
async function prepare(imported=null){
 if(busy)return;showLoading();busySet(true);status("Préparation… La sortie précédente est conservée.");
 try{
  const expected=(await read(db,"active"))?.revision||0;let release,id,known;
  if(imported){
   release=imported.release;id=imported.id;known=await read(db,"outing:"+id);
   if(known&&(known.envelope.release!==release||known.envelope.content!==imported.content))throw Error("Cette sortie connue ne correspond pas au message reçu.");
  }else{const latest=JSON.parse(new TextDecoder().decode(await network(new URL("latest.json",base))));if(latest.format!==2)throw Error("Publication annoncée invalide.");release=latest.release;id=randomId();}
  const manifest=await download(release,known?.manifest);
  enter({id,release,manifest,state:imported&&known?known.state:{},envelope:imported},imported?"import":"create",expected);
 }catch(error){status(error.message,"error");$("importError").textContent=error.message;busySet(false);}
}
function openReceive(){$("invitation").value="";$("importError").textContent="";$("receiveDialog").showModal();showPage();}
async function resumePrevious(){
 showLoading();try{if(!await restore()){delete document.documentElement.dataset.receiveOnly;showPage();}}
 catch(error){delete document.documentElement.dataset.receiveOnly;status(error.message,"error");}
}
$("resume").onclick=resumePrevious;
let pendingDeletion=null;
function removeActiveOuting(target){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("state","readwrite"),store=tx.objectStore("state");let failure;
  const request=store.get("active");
  request.onsuccess=()=>{
   const current=request.result;
   if(!current||current.deleted||current.id!==target.id||current.revision!==target.revision){
    failure=Error("La sortie a changé dans une autre fenêtre. Recharge l’accueil.");tx.abort();return;
   }
   store.delete("outing:"+target.id);
   // La révision reste monotone sans conserver le secret ni l’invitation.
   store.put({deleted:true,revision:current.revision+1},"active");
  };
  tx.oncomplete=()=>resolve(target.revision+1);
  tx.onabort=()=>reject(failure||tx.error||Error("Suppression impossible. La sortie est conservée."));
 });
}
async function openDelete(){
 if(busy)return;
 const current=await read(db,"active");
 if(!current||current.deleted){$("resume").hidden=true;$("deleteOuting").hidden=true;status("Aucune sortie active à supprimer.");return;}
 pendingDeletion={id:current.id,revision:current.revision};
 $("deleteSummary").textContent="Zone : "+(current.summary?.zoneName||"Sortie enregistrée")+(createdLabel(current)?" · "+createdLabel(current):"");
 $("deleteError").textContent="";$("deleteDialog").showModal();
}
$("deleteOuting").onclick=()=>openDelete().catch(error=>status(error.message,"error"));
$("cancelDelete").onclick=()=>{$("deleteDialog").close();pendingDeletion=null;};
$("deleteDialog").addEventListener("cancel",event=>{if(busy)event.preventDefault();else pendingDeletion=null;});
$("confirmDelete").onclick=async()=>{
 if(busy||!pendingDeletion)return;
 const target=pendingDeletion;busySet(true);$("deleteError").textContent="";
 try{
  const revision=await removeActiveOuting(target);
  sessionStorage.removeItem(LAUNCH_KEY);sessionStorage.removeItem(ERROR_KEY);sessionStorage.removeItem(VIEW_KEY);
  if("BroadcastChannel" in window){const channel=new BroadcastChannel("vhfgps-main-state-v1");channel.postMessage(revision);channel.close();}
  $("deleteDialog").close();pendingDeletion=null;$("resume").hidden=true;$("deleteOuting").hidden=true;
  $("resumeZone").textContent="";$("resumeDate").textContent="";
  status("");
 }catch(error){$("deleteError").textContent=error.message;}
 finally{busySet(false);}
};
$("create").onclick=()=>prepare();$("receive").onclick=openReceive;
function cancelReceive(){delete document.documentElement.dataset.receiveOnly;status("");showPage();}
$("closeReceive").onclick=()=>{$("receiveDialog").close();cancelReceive();};
$("receiveDialog").addEventListener("cancel",cancelReceive);
$("receiveForm").onsubmit=async event=>{event.preventDefault();try{await prepare(await unwrap($("invitation").value));}catch(error){$("importError").textContent=error.message;}};
// Un rechargement forcé peut laisser controller à null malgré une installation active.
// Attendre cette inscription précise, sans forcer une mise à jour en attente.
function waitForInstalledWorker(registration){
 const expected=new URL("sw.js",base).href;
 if(registration.scope!==base.href)throw Error("L’installation ne correspond pas à cette application.");
 return new Promise((resolve,reject)=>{
  const workers=new Set();let finished=false;
  function finish(error){
   if(finished)return;finished=true;clearTimeout(timer);
   registration.removeEventListener("updatefound",check);
   for(const worker of workers)worker.removeEventListener("statechange",check);
   if(error)reject(error);else resolve();
  }
  function check(){
   if(finished)return;
   const active=registration.active;
   if(active?.state==="activated"&&active.scriptURL===expected){finish();return;}
   for(const worker of [registration.installing,registration.waiting,active]){
    if(worker&&!workers.has(worker)){workers.add(worker);worker.addEventListener("statechange",check);}
   }
   if(!active&&!registration.installing&&!registration.waiting&&[...workers].some(worker=>worker.state==="redundant")){
    finish(Error("La préparation hors connexion a échoué. Vérifie la connexion puis recharge la application."));
   }
  }
  const timer=setTimeout(()=>finish(Error("L’installation prend trop de temps. Vérifie la connexion puis recharge la application.")),20000);
  registration.addEventListener("updatefound",check);check();
 });
}
function watchLauncherUpdate(registration){
 const seen=new WeakSet();
 const refresh=()=>{$("updateNotice").hidden=!(registration.active&&registration.waiting);};
 const watchInstalling=()=>{
  const worker=registration.installing;
  if(worker&&!seen.has(worker)){
   seen.add(worker);
   worker.addEventListener("statechange",()=>{refresh();if(worker.state==="installed")setTimeout(refresh,0);});
  }
  refresh();
 };
 registration.addEventListener("updatefound",watchInstalling);
 navigator.serviceWorker.addEventListener("controllerchange",refresh);
 window.addEventListener("online",()=>{registration.update().catch(()=>{});refreshLatestVersion();});
 document.addEventListener("visibilitychange",()=>{if(!document.hidden){registration.update().catch(()=>{});refreshLatestVersion();}});
 watchInstalling();registration.update().catch(()=>{});
}async function start(){
 if(!isSecureContext||!navigator.serviceWorker||!indexedDB)throw Error("Ouvre cette application en HTTPS ou sur localhost.");
 const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
 await waitForInstalledWorker(registration);
 refreshLatestVersion();
 db=await openStore();
 const active=await read(db,"active"),hasActive=!!active&&!active.deleted;$("resume").hidden=!hasActive;$("deleteOuting").hidden=!hasActive;
 if(hasActive){
  $("resumeZone").textContent=active.summary?.zoneName||"Sortie enregistrée";
  $("resumeDate").textContent=createdLabel(active);
 }
 const message=sessionStorage.getItem(ERROR_KEY);sessionStorage.removeItem(ERROR_KEY);
 const action=location.hash;history.replaceState(null,"",base);
 if(message){busySet(false);status(message,"error");$("importError").textContent=message;}else if(action==="#new"){busySet(false);await prepare();}else if(action==="#receive"){document.documentElement.dataset.receiveOnly="true";busySet(false);openReceive();}else if(action==="#resume"){busySet(false);if(!await restore())showPage();}else{busySet(false);status("");showPage();}
 watchLauncherUpdate(registration);navigator.storage?.persist?.().catch(()=>{});
}
start().catch(error=>{status(error.message,"error");busySet(!db);});

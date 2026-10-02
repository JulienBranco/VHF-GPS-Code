import {showLoading,showPage,applyLoadingTheme,VIEW_KEY} from "./transition.js";
import {initInstallUI} from "./install.js";
import {initTechnicalInfo} from "./technical-info.js";
import {randomId,wrap,unwrap,sameInvitationContent,splitContent} from "./protocol.js";
import {openStore,read,retainActiveOuting} from "./storage.js";
import {base,LAUNCH_KEY,ERROR_KEY,network,download,verify,fileURL} from "./release.js";
const $=id=>document.getElementById(id);let db,busy=true,technicalInfo;
applyLoadingTheme();initInstallUI();
function status(text,kind="info"){$("status").textContent=text;$("status").dataset.kind=kind;if(kind==="error")showPage();}
function clearImportError(){$("importError").replaceChildren();$("importError").classList.remove("import-error-box");}
function showImportError(error){
 clearImportError();
 if(!["RELEASE_UNAVAILABLE","RELEASE_INCOMPLETE"].includes(error.code)){$("importError").textContent=error.message;return;}
 const unavailable=error.code==="RELEASE_UNAVAILABLE",title=document.createElement("strong");
 title.textContent=unavailable?"⛔ Version de cette sortie indisponible":"⛔ Téléchargement incomplet";
 $("importError").classList.add("import-error-box");$("importError").append(title);
 function paragraph(text){const p=document.createElement("p");p.textContent=text;$("importError").append(p);return p;}
 paragraph(unavailable?"La version de VHF GPS nécessaire à cette invitation ne peut plus être téléchargée.":error.message);
 if(unavailable)paragraph("Demande au créateur une nouvelle invitation préparée avec la version actuelle.");
 if(!$("resume").hidden)paragraph("Ta sortie active est conservée.").className="import-error-preserved";
}
function showStartupError(message,rawDetails){
 let details=null;try{details=JSON.parse(rawDetails||"null");}catch{}
 if(details?.code!=="OUTING_VERSION_MISMATCH"||details.message!==message||
  ["expectedVersion","expectedProtocol","loadedVersion","loadedProtocol"].some(key=>typeof details[key]!=="string"||details[key].length>100))details=null;
 const versionMismatch=message==="Le moteur ne correspond pas à la publication."||!!details;
 if(!versionMismatch){status(message,"error");$("importError").textContent=message;return;}
 status("");$("importError").textContent="";
 const diagnostic=$("outingLoadDiagnostic");
 diagnostic.textContent=details?
  "Version attendue : "+details.expectedVersion+" · "+details.expectedProtocol+"\nVersion ouverte : "+details.loadedVersion+" · "+details.loadedProtocol:"";
 $("outingLoadDetails").hidden=!details;
 showPage();$("outingLoadErrorDialog").showModal();
}
$("closeOutingLoadError").onclick=()=>$("outingLoadErrorDialog").close();
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
function busySet(value){busy=value;if(!value)applyLauncherUpdate();$("create").disabled=busy;$("receive").disabled=busy;$("resume").disabled=busy;$("deleteOuting").disabled=busy;$("confirmDelete").disabled=busy;$("cancelDelete").disabled=busy;$("receiveForm").querySelector("button[type=submit]").disabled=busy;}
function dateLabel(value,label){const time=Number(value||0);return Number.isFinite(time)&&time>0&&Number.isFinite(new Date(time).getTime())?label+new Date(time).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"}):"";}
function createdLabel(record){return dateLabel(record.summary?.createdAt||record.state?.vhfGpsSessionCreatedAtV312,"Créée le ");}
function sessionFingerprintLabel(record){
 // Lire le résumé de l'invitation déjà validée par sa publication, sans recalculer son empreinte.
 try{
  const {summary}=splitContent(record.envelope.content);
  const rows=summary.normalize("NFC").split(/\r?\n/).map(line=>line.match(/^(?:🔐 )?Alias de session \(empreinte radio\) : (.+)$/u)).filter(Boolean);
  return rows.length===1&&rows[0][1].length<=200?rows[0][1].trim():"";
 }catch{return "";}
}
function renderOutingDetails(record,prefix){
 $(prefix+"Zone").textContent=record?.summary?.zoneName|| (record?"Sortie enregistrée":"");
 const values={Fingerprint:record?sessionFingerprintLabel(record):"",Date:record?createdLabel(record):"",Installed:record?dateLabel(record.state?.vhfGpsOutingInstalledAtV1,"Installée sur ce téléphone le "):""};
 for(const [suffix,value] of Object.entries(values)){const el=$(prefix+suffix);(suffix==="Fingerprint"?$(prefix+"FingerprintWords"):el).textContent=value;el.hidden=!value;}
}
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
  const active=await read(db,"active"),expected=active?.revision||0;let release,id,known;
  if(imported){
   release=imported.release;id=imported.id;known=!active?.deleted&&active?.id===id?active:null;
   if(known){
    if(known.envelope.release!==release||!sameInvitationContent(known.envelope.content,imported.content))throw Error("Cette sortie connue ne correspond pas au message reçu.");
    // Rejouer la sortie encore active conserve son invitation et son journal.
    imported={...imported,content:known.envelope.content};
   }
  }else{const latest=JSON.parse(new TextDecoder().decode(await network(new URL("latest.json",base))));if(latest.format!==2)throw Error("Publication annoncée invalide.");release=latest.release;id=randomId();}
  const manifest=await download(release,known?.manifest);
  enter({id,release,manifest,state:imported&&known?known.state:{},envelope:imported},imported?"import":"create",expected);
 }catch(error){
  if(imported){status("");showImportError(error);showPage();}
  else status(error.message,"error");
  busySet(false);
 }
}
function openReceive(){$("invitation").value="";clearImportError();$("receiveDialog").showModal();showPage();}
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
 renderOutingDetails(current,"delete");
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
  renderOutingDetails(null,"resume");renderOutingDetails(null,"delete");
  technicalInfo?.setOuting(null);
  // La suppression enlève la dernière protection d'un moteur déjà retiré du
  // catalogue. Les moteurs encore publiés restent disponibles pour un rejeu.
  navigator.serviceWorker.getRegistration(base.href).then(registration=>registration?.active?.postMessage({type:"VHF_RELEASE_PRUNE",api:1})).catch(()=>{});
  status("");
 }catch(error){$("deleteError").textContent=error.message;}
 finally{busySet(false);}
};
$("create").onclick=()=>prepare();$("receive").onclick=openReceive;
function cancelReceive(){delete document.documentElement.dataset.receiveOnly;status("");clearImportError();showPage();}
$("closeReceive").onclick=()=>{$("receiveDialog").close();cancelReceive();};
$("receiveDialog").addEventListener("cancel",cancelReceive);
$("invitation").addEventListener("input",clearImportError);
$("receiveForm").onsubmit=async event=>{event.preventDefault();clearImportError();try{await prepare(await unwrap($("invitation").value));}catch(error){showImportError(error);}};
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
const DRAFT_KEY="vhfgps-main-launcher-draft-v1";
let launcherUpdateReady=false,refreshingLauncher=false;
function applyLauncherUpdate(){
 if(!launcherUpdateReady||busy||refreshingLauncher)return;
 refreshingLauncher=true;
 // Une actualisation conserve le texte collé, y compris si la fenêtre de réception est ouverte.
 sessionStorage.setItem(DRAFT_KEY,JSON.stringify({invitation:$("invitation").value,receive:$("receiveDialog").open,technical:$("technicalInfo")?.open===true}));
 showLoading();location.reload();
}
function workerInfo(worker){return new Promise((resolve,reject)=>{
 const channel=new MessageChannel(),timer=setTimeout(()=>finish(Error("Accueil indisponible")),3000);
 function finish(error,value){clearTimeout(timer);channel.port1.close();channel.port2.close();error?reject(error):resolve(value);}
 channel.port1.onmessage=event=>finish(null,event.data);
 try{worker.postMessage({type:"VHF_LAUNCHER_INFO",api:1},[channel.port2]);}catch(error){finish(error);}
});}
function watchLauncherUpdate(registration){
 let revision=0;const seen=new WeakSet();
 async function check(){
  registration.waiting?.postMessage({type:"VHF_LAUNCHER_ACTIVATE",api:1});
  // Ne pas interroger l’ancien worker pendant son remplacement.
  if(registration.installing||registration.waiting)return;
  const request=++revision,worker=registration.active;
  if(worker?.state!=="activated")return;
  try{
   const info=await workerInfo(worker);
   if(request!==revision||info.preview)return;
   const loaded=document.querySelector('meta[name="vhf-launcher-build"]')?.content;
   if(/^[a-f0-9]{64}$/.test(info.build)&&info.build!==loaded){
    launcherUpdateReady=true;$("updateNotice").hidden=false;applyLauncherUpdate();
   }
  }catch{}
 }
 function watch(){
  const worker=registration.installing;
  if(worker&&!seen.has(worker)){seen.add(worker);worker.addEventListener("statechange",()=>{if(worker.state==="installed")worker.postMessage({type:"VHF_LAUNCHER_ACTIVATE",api:1});check();});}
  check();
 }
 registration.addEventListener("updatefound",watch);
 navigator.serviceWorker.addEventListener("controllerchange",check);
 navigator.serviceWorker.addEventListener("message",event=>{if(event.data?.type==="VHF_LAUNCHER_UPDATED"&&event.data.api===1)check();});
 function update(){if(navigator.onLine){registration.update().catch(()=>{});refreshLatestVersion();}check();}
 window.addEventListener("online",update);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)update();});
 setInterval(()=>{if(!document.hidden)update();},300000);
 watch();update();
}
async function start(){
 if(!isSecureContext||!navigator.serviceWorker||!indexedDB)throw Error("Ouvre cette application en HTTPS ou sur localhost.");
 const registration=await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
 await waitForInstalledWorker(registration);
 const installedInfo=await workerInfo(registration.active);
 if(!installedInfo.preview&&!/^[a-f0-9]{64}$/.test(document.querySelector('meta[name="vhf-launcher-build"]')?.content||"")){location.reload();return;}
 refreshLatestVersion();
 db=await openStore();
 await retainActiveOuting(db);
 const active=await read(db,"active"),hasActive=!!active&&!active.deleted;$("resume").hidden=!hasActive;$("deleteOuting").hidden=!hasActive;
 technicalInfo=initTechnicalInfo({root:base,outing:hasActive?active:null});
 if(hasActive)renderOutingDetails(active,"resume");
 const message=sessionStorage.getItem(ERROR_KEY);sessionStorage.removeItem(ERROR_KEY);
 const errorDetails=sessionStorage.getItem(ERROR_KEY+"-details");sessionStorage.removeItem(ERROR_KEY+"-details");
 const action=location.hash,wasReset=new URL(location.href).searchParams.has("reset");history.replaceState(null,"",base);
 if(message){busySet(false);showStartupError(message,errorDetails);}else if(action==="#new"){busySet(false);await prepare();}else if(action==="#receive"){document.documentElement.dataset.receiveOnly="true";busySet(false);openReceive();}else if(action==="#resume"){busySet(false);if(!await restore())showPage();}else{busySet(false);status("");showPage();}
 if(wasReset&&!message){status("Application remise à zéro. Prépare ou reçois une nouvelle sortie.");setTimeout(()=>{if($("status").textContent==="Application remise à zéro. Prépare ou reçois une nouvelle sortie.")status("");},10000);}
 let draft=null;try{draft=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||"null");}catch{}sessionStorage.removeItem(DRAFT_KEY);
 if(draft&&!wasReset&&!message){if(draft.receive&&!$("receiveDialog").open)openReceive();if(typeof draft.invitation==="string")$("invitation").value=draft.invitation;if(draft.technical&&$("technicalInfo"))$("technicalInfo").open=true;}
 watchLauncherUpdate(registration);navigator.storage?.persist?.().catch(()=>{});
}
start().catch(error=>{status(error.message,"error");busySet(!db);});

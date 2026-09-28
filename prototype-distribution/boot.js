import {PUBLICATION_API,digest,randomId,validatePayload,validateManifest,releaseCache,invitationText,parseInvitation} from "./protocol.js";
import {openStore,read,saveScenario,commit} from "./storage.js";

const $=id=>document.getElementById(id),base=new URL("./",location.href);
let db,active=null,candidate=null,busy=false,operation=0,controller=null;
const channel=typeof BroadcastChannel==="function"?new BroadcastChannel("vhfgps-prototype-state-v1"):null;
function status(message,kind="info"){$("status").textContent=message;$("status").dataset.kind=kind;}
function setBusy(value){
  busy=value;
  for(const id of ["create","receive","confirm","scenario"])$(id).disabled=value||!db;
  $("receive-form").querySelector("button[type=submit]").disabled=value;
}
function releaseUrl(id,path){releaseCache(id);return new URL("releases/"+id+"/"+path,base);}
async function networkBytes(url,signal){
  const timeout=new AbortController(),abort=()=>timeout.abort();
  if(signal?.aborted)timeout.abort();else signal?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(abort,15000);
  try{
    const response=await fetch(url,{cache:"no-store",headers:{"X-VHF-Prototype-Download":"1"},signal:timeout.signal});
    if(!response.ok)throw new Error("Téléchargement indisponible ("+response.status+").");
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>1000000)throw new Error("Fichier d’essai trop volumineux.");
    return bytes;
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
function jsonBytes(bytes){return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
async function verifyCache(id,manifest){
  validateManifest(manifest);
  if(await digest(JSON.stringify(manifest))!==id)throw new Error("La référence de publication ne correspond pas à ses fichiers.");
  const cache=await caches.open(releaseCache(id));
  for(const file of manifest.files){
    const response=await cache.match(releaseUrl(id,file.path).href);
    if(!response||await digest(await response.arrayBuffer())!==file.sha256){
      throw new Error("Les fichiers de cette sortie ne sont pas tous présents. Recolle son invitation avec une connexion pour les récupérer.");
    }
  }
}
async function prepareRelease(id,known,signal){
  if(known){
    try{await verifyCache(id,known);return known;}catch{/* Réparer uniquement cette publication. */}
  }
  const raw=await networkBytes(releaseUrl(id,"manifest.json"),signal);
  if(await digest(raw)!==id)throw new Error("La publication téléchargée ne correspond pas à la version demandée.");
  const manifest=validateManifest(jsonBytes(raw)),cache=await caches.open(releaseCache(id));
  for(const file of manifest.files){
    const url=releaseUrl(id,file.path),existing=await cache.match(url.href);
    if(existing&&await digest(await existing.arrayBuffer())===file.sha256)continue;
    const bytes=await networkBytes(url,signal);
    if(await digest(bytes)!==file.sha256)throw new Error("Un fichier téléchargé est incomplet ou incorrect. La sortie précédente est conservée.");
    if(signal.aborted)throw new DOMException("Annulé","AbortError");
    await cache.put(url.href,new Response(bytes,{headers:{"Content-Type":file.path.endsWith(".html")?"text/html; charset=utf-8":"text/javascript; charset=utf-8"}}));
  }
  await cache.put(releaseUrl(id,"manifest.json").href,new Response(raw,{headers:{"Content-Type":"application/json"}}));
  await verifyCache(id,manifest);
  return manifest;
}
function showFrame(frame){
  for(const other of $("active-frame").querySelectorAll("iframe"))if(other!==frame)other.remove();
  frame.hidden=false;
}
function loadFrame(record){
  return new Promise((resolve,reject)=>{
    const frame=document.createElement("iframe"),ports=new MessageChannel(),nonce=randomId();
    frame.title="Application figée de la sortie d’essai";frame.hidden=true;
    frame.setAttribute("sandbox","allow-scripts allow-same-origin");
    let done=false;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);ports.port1.close();
      if(error){frame.remove();reject(error);}else resolve({frame,result});
    };
    const timer=setTimeout(()=>finish(new Error("La version de cette sortie n’a pas pu démarrer. La sortie précédente est conservée.")),12000);
    ports.port1.onmessage=event=>{
      const data=event.data;
      if(data?.nonce!==nonce)return;
      if(data.api!==PUBLICATION_API||data.code==="API_UNSUPPORTED"){
        finish(new Error("Dialogue incompatible avec cette version de démonstration. La sortie active n’est pas remplacée."));return;
      }
      if(data.type!=="ready"||data.protocol!==record.payload.protocol||data.label!==record.manifest.label){
        finish(new Error("Le contrôle de la version d’essai a échoué."));return;
      }
      finish(null,data);
    };
    frame.onload=()=>frame.contentWindow.postMessage({type:"initialize",api:PUBLICATION_API,nonce,payload:record.payload},location.origin,[ports.port2]);
    frame.onerror=()=>finish(new Error("Impossible de charger cette version."));
    frame.src=releaseUrl(record.payload.release,"app.html").href;
    $("active-frame").append(frame);
  });
}
async function restoreActive(){
  const record=await read(db,"active");
  if(!record){
    active=null;$("active-frame").replaceChildren();$("empty").hidden=false;$("ready").hidden=true;$("share").hidden=true;
    status("Prêt à préparer une première sortie d’essai.");return;
  }
  validatePayload(record.payload);
  active=record;
  $("share").hidden=false;
  try{
    await verifyCache(record.payload.release,record.manifest);
    const loaded=await loadFrame(record);
    const current=await read(db,"active");
    if(current?.revision!==record.revision){loaded.frame.remove();return restoreActive();}
    showFrame(loaded.frame);
    $("empty").hidden=true;$("ready").hidden=false;
    status("Sortie retrouvée avec sa version "+record.manifest.label+".");
  }catch(error){
    $("active-frame").replaceChildren();$("empty").hidden=true;$("ready").hidden=true;
    status(error.message,"error");
  }
}
function cancelPreparation(){
  operation++;controller?.abort();controller=null;
  candidate?.loaded.frame.remove();candidate=null;
  setBusy(false);
}
async function prepare(payload=null,source=null){
  if(busy)return;
  const token=++operation;
  controller=new AbortController();
  setBusy(true);status("Préparation en cours… La sortie précédente reste disponible.");
  $("receive-error").textContent="";$("review-error").textContent="";
  let loaded;
  try{
    const before=await read(db,"active"),expectedRevision=before?.revision||0;
    let known;
    if(!payload){
      const scenario=$("scenario").value;
      const pointer=jsonBytes(await networkBytes(new URL(scenario==="live"?"latest.json":"channels/"+scenario+".json",base),controller.signal));
      if(pointer?.format!==1)throw new Error("Publication annoncée invalide.");
      payload={format:1,id:randomId(),session:randomId(32),createdAt:Date.now(),
        release:pointer.release,protocol:pointer.protocol,lat:46.2,lon:-2.4};
      validatePayload(payload);
      source=await invitationText(payload);
    }else{
      known=await read(db,"outing:"+payload.id);
      if(known&&known.invitation!==source)throw new Error("Cette sortie connue ne correspond pas au message collé.");
    }
    const manifest=await prepareRelease(payload.release,known?.manifest,controller.signal);
    if(payload.protocol!==manifest.protocol)throw new Error("Le protocole de l’invitation ne correspond pas à sa publication.");
    const record={payload,manifest,invitation:source,installedAt:Date.now()};
    loaded=await loadFrame(record);
    if(token!==operation){loaded.frame.remove();return;}
    candidate={record,loaded,expectedRevision};
    $("review-title").textContent=known?"Restaurer cette sortie d’essai ?":"Activer cette sortie d’essai ?";
    $("review-summary").replaceChildren();
    for(const [label,value] of [["Version de la sortie",manifest.label+" · "+manifest.protocol],["Coordonnées fictives",payload.lat.toFixed(5)+" / "+payload.lon.toFixed(5)],["Code d’essai",loaded.result.code],["Disponibilité","Fichiers téléchargés et contrôlés"]]){
      const row=document.createElement("div"),strong=document.createElement("strong"),span=document.createElement("span");
      row.className="review-row";strong.textContent=label;span.textContent=value;row.append(strong,span);$("review-summary").append(row);
    }
    if($("receive-dialog").open)$("receive-dialog").close();
    $("review-dialog").showModal();
    status("Sortie vérifiée. Confirme son activation.");
  }catch(error){
    loaded?.frame.remove();
    if(token!==operation)return;
    const message=error.name==="AbortError"?"La préparation n’a pas pu être terminée. Réessaie avec une connexion Internet.":error instanceof TypeError?"Connexion indisponible. La sortie précédente est conservée.":error.message;
    status(message,"error");
    if($("receive-dialog").open)$("receive-error").textContent=message;
  }finally{if(token===operation)setBusy(false);}
}
$("create").onclick=()=>prepare();
$("receive").onclick=()=>{
  $("receive-error").textContent="";$("invitation-input").value="";$("receive-dialog").showModal();
};
$("receive-form").onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  try{
    const payload=await parseInvitation($("invitation-input").value);
    await prepare(payload,await invitationText(payload));
  }catch(error){$("receive-error").textContent=error.message;}
};
$("confirm").onclick=async()=>{
  if(!candidate||busy)return;
  const pending=candidate;setBusy(true);
  try{
    // Vérifier à nouveau les fichiers juste avant la transaction d'activation.
    await verifyCache(pending.record.payload.release,pending.record.manifest);
    const record=await commit(db,pending.record,pending.expectedRevision);
    active=record;candidate=null;
    showFrame(pending.loaded.frame);
    $("empty").hidden=true;$("ready").hidden=false;$("share").hidden=false;
    $("review-dialog").close();
    status("✓ Sortie d’essai activée · version "+record.manifest.label+".","success");
    channel?.postMessage({revision:record.revision});
  }catch(error){$("review-error").textContent=error.message;}
  finally{setBusy(false);}
};
$("review-dialog").addEventListener("close",()=>{
  if(candidate){cancelPreparation();restoreActive().catch(e=>status(e.message,"error"));}
});
$("receive-dialog").addEventListener("cancel",()=>{if(busy)cancelPreparation();});
for(const button of document.querySelectorAll("[data-close]"))button.onclick=()=>{
  if(button.dataset.close==="receive-dialog"&&busy)cancelPreparation();
  if(button.dataset.close==="review-dialog"&&busy)return;
  $(button.dataset.close).close();
};
$("review-dialog").addEventListener("cancel",event=>{if(busy)event.preventDefault();});
$("share").onclick=()=>{
  if(!active)return;
  $("invitation-output").value=active.invitation;$("copy-status").textContent="";
  $("native-share").hidden=typeof navigator.share!=="function";
  $("share-dialog").showModal();
};
$("copy").onclick=async()=>{
  try{await navigator.clipboard.writeText($("invitation-output").value);$("copy-status").textContent="Invitation copiée.";}
  catch{$("invitation-output").focus();$("invitation-output").select();$("copy-status").textContent="Sélectionne et copie le texte ci-dessus.";}
};
$("native-share").onclick=async()=>{
  try{await navigator.share({title:"VHF GPS TEST",text:$("invitation-output").value});}
  catch(error){if(error.name!=="AbortError")$("copy-status").textContent="Utilise le bouton Copier l’invitation.";}
};
$("scenario").onchange=async()=>{
  try{await saveScenario(db,$("scenario").value);showScenario();}
  catch(error){status(error.message,"error");}
};
function showScenario(){
  $("scenario-state").textContent=$("scenario").value==="live"?"Les nouvelles sorties suivent la publication annoncée par l’hébergement.":"Les prochaines créations vérifieront en ligne la version "+$("scenario").value+". La sortie active conserve sa version.";
}
async function synchronize(){
  if(!db||busy||$("review-dialog").open)return;
  const next=await read(db,"active");
  if((next?.revision||0)!==(active?.revision||0))await restoreActive();
}
channel?.addEventListener("message",()=>synchronize().catch(e=>status(e.message,"error")));
window.addEventListener("pageshow",()=>synchronize().catch(e=>status(e.message,"error")));
document.addEventListener("visibilitychange",()=>{if(!document.hidden)synchronize().catch(e=>status(e.message,"error"));});
window.addEventListener("focus",()=>synchronize().catch(e=>status(e.message,"error")));
async function start(){
  if(!isSecureContext||!navigator.serviceWorker||!window.caches||!window.indexedDB){
    throw new Error("Ouvre ce prototype en HTTPS depuis ton hébergement, ou sur localhost pour un essai sur ordinateur.");
  }
  await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
  await navigator.serviceWorker.ready;
  if(navigator.serviceWorker.controller?.scriptURL!==new URL("sw.js",base).href){
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Le mode hors connexion n’est pas encore actif. Recharge le prototype.")),10000);
      navigator.serviceWorker.addEventListener("controllerchange",()=>{clearTimeout(timer);resolve();},{once:true});
    });
  }
  db=await openStore();
  const scenario=await read(db,"scenario");
  $("scenario").value=["A","B"].includes(scenario)?scenario:"live";showScenario();
  await restoreActive();setBusy(false);
  navigator.storage?.persist?.().catch(()=>{});
}
start().catch(error=>{status(error.message,"error");setBusy(true);});

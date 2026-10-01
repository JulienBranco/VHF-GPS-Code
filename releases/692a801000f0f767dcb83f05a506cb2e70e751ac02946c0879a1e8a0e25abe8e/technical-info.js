// Informations de dépannage, sans secret ni données de position.
export function initTechnicalInfo({root,outing=null}){
 const existingPanel=document.getElementById("technicalInfo");
 const panel=existingPanel||document.createElement("details"),summary=existingPanel?.querySelector(":scope > summary")||document.createElement("summary"),list=document.createElement("dl");
 panel.id="technicalInfo";list.className="technical-info-list";
 if(!existingPanel){panel.className="technical-info";summary.textContent="Informations techniques";}
 function row(label,value,parent=list){const term=document.createElement("dt"),detail=document.createElement("dd");term.textContent=label;detail.textContent=value;parent.append(term,detail);return detail;}
 const launcher=row("Accueil installé","Déplie ce panneau pour afficher son identifiant.");
 const outingRows=document.createElement("div");
 function setOuting(value){
  outingRows.replaceChildren();
  if(!value){outingRows.remove();return;}
  const version=row("Application de cette sortie","v"+value.manifest.version+" · "+value.release.slice(0,8),outingRows);
  version.title=value.release;
  if(!panel.querySelector("#compatShort"))row("Protocole de cette sortie",value.manifest.protocol.replace("VHF-GPS-PROTO-","PROTO "),outingRows);
  list.append(outingRows);
 }
 setOuting(outing);
 if(existingPanel)(panel.querySelector(".utility-body")||panel).prepend(list);
 else{panel.append(summary,list);(document.getElementById("empty")||document.querySelector("main")).append(panel);}
 if(!document.getElementById("technicalInfoStyle")){
  const style=document.createElement("style");style.id="technicalInfoStyle";
  style.textContent=".technical-info{margin:24px 0 12px;font:13px/1.5 system-ui,sans-serif;color:var(--muted,#d5e8e7)}.technical-info>summary{cursor:pointer;font-weight:600}.technical-info-list{margin:12px 0}.technical-info-list dt{margin-top:10px;font-weight:700}.technical-info-list dd{margin:2px 0;overflow-wrap:anywhere;color:var(--text,#edf9f7)}html[data-theme=day] .technical-info{color:var(--muted,#364e57)}html[data-theme=day] .technical-info-list dd{color:var(--text,#173b45)}";
  document.head.append(style);
 }
 let revision=0;
 async function refresh(){
  const request=++revision;launcher.textContent="Lecture de l’identifiant…";launcher.removeAttribute("title");
  try{
   const registration=await navigator.serviceWorker?.getRegistration(root.href);
   if(request!==revision)return;
   const worker=navigator.serviceWorker.controller||registration?.active;
   if(!worker||worker.scriptURL!==new URL("sw.js",root).href||registration?.scope!==root.href)throw Error("Accueil indisponible");
   const info=await new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const finish=(error,value)=>{clearTimeout(timer);channel.port1.close();channel.port2.close();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(Error("Identifiant indisponible")),3000);
    channel.port1.onmessage=event=>finish(null,event.data);
    try{worker.postMessage({type:"VHF_LAUNCHER_INFO",api:1},[channel.port2]);}catch(error){finish(error);}
   });
   if(request!==revision)return;
   // Le numéro d'une mise à jour en attente n'est jamais interrogé.
   if(info?.type!=="VHF_LAUNCHER_INFO"||info.api!==1)throw Error("Réponse inconnue");
   if(info.preview===true){launcher.textContent="Aperçu local — sources";return;}
   if(!/^[a-f0-9]{64}$/.test(info.build))throw Error("Identifiant invalide");
   launcher.textContent=info.build.slice(0,8);launcher.title=info.build;
  }catch{if(request===revision)launcher.textContent="Identifiant indisponible";}
 }
 panel.addEventListener("toggle",()=>{if(panel.open)refresh();});
 navigator.serviceWorker?.addEventListener("controllerchange",()=>{revision++;if(panel.open)refresh();});
 return {setOuting};
}

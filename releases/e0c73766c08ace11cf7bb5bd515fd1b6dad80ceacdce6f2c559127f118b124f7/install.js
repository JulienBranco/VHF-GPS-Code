// Une seule gestion de l’installation, dans le lanceur comme dans la publication.
export function initInstallUI(){
 const button=document.getElementById("installAppBtn"),help=document.getElementById("installHelp");
 if(!button||!help)return;
 let prompt=null,completed=false,busy=false;
 const standalone=window.matchMedia("(display-mode: standalone)");
 function installed(){return completed||navigator.standalone===true||standalone.matches;}
 function refresh(){
  const available=isSecureContext&&!!navigator.serviceWorker&&(location.protocol==="https:"||location.protocol==="http:")&&!installed();
  button.classList.remove("hidden");button.hidden=!available;button.disabled=busy;
  if(!available){help.hidden=true;help.classList.remove("hidden");button.setAttribute("aria-expanded","false");}
 }
 function instructions(){
  const ua=navigator.userAgent,ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);
  if(ios)return "Sur iPhone/iPad : ouvre cette adresse dans Safari, touche Partager, puis « Sur l’écran d’accueil » et « Ajouter ». Ouvre ensuite l’icône VHF GPS.";
  if(/Android/i.test(ua))return "Sur Android : menu ⋮ de Chrome → « Installer l’application » ou « Ajouter à l’écran d’accueil ». Si elle est déjà installée, ouvre l’icône VHF GPS.";
  return "Dans le menu de ton navigateur, choisis « Installer l’application ». Si elle est déjà installée, ouvre l’icône VHF GPS.";
 }
 function explain(){help.textContent=instructions();help.classList.remove("hidden");help.hidden=false;button.setAttribute("aria-expanded","true");}
 window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();prompt=event;refresh();});
 window.addEventListener("appinstalled",()=>{completed=true;prompt=null;refresh();});
 if(standalone.addEventListener)standalone.addEventListener("change",refresh);
 else standalone.addListener?.(refresh);
 button.onclick=async()=>{
  if(busy)return;
  if(prompt){
   const current=prompt;prompt=null;busy=true;refresh();
   try{await current.prompt();await current.userChoice;}catch{explain();}
   finally{busy=false;refresh();}
  }else if(help.hidden||help.classList.contains("hidden")){explain();}
  else{help.hidden=true;button.setAttribute("aria-expanded","false");}
 };
 help.hidden=true;refresh();
}

// L’installation de la PWA se gère depuis le lanceur.
export function initInstallUI(){
 const $=id=>document.getElementById(id),button=$("installAppBtn"),dialog=$("installDialog");
 if(!button||!dialog)return;
 const ua=navigator.userAgent,ios=/iPhone|iPad|iPod/i.test(ua)||(/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1);
 const androidChrome=/Android/i.test(ua)&&/Chrome\//.test(ua)&&!/Firefox|Edg|OPR|SamsungBrowser/i.test(ua);
 const address=new URL("./",import.meta.url).href,standalone=window.matchMedia("(display-mode: standalone)");
 let prompt=null,completed=false,busy=false;
 function installed(){return completed||navigator.standalone===true||standalone.matches;}
 function refresh(){
  const available=isSecureContext&&!!navigator.serviceWorker&&!installed()&&(ios||androidChrome||!!prompt);
  button.classList.remove("hidden");button.hidden=!available;button.disabled=busy;
  button.textContent=ios?"Ajouter à l’écran d’accueil":"Installer l’application";
  if(!available&&dialog.open)dialog.close();
 }
 function explain(){
  $("installTitle").textContent=ios?"Installer sur iPhone / iPad":"Installer avec Chrome";
  $("installHelp").textContent=ios?"L’ajout se fait dans Safari. Voici l’adresse de VHF GPS Code à copier et les étapes à suivre.":"Si la fenêtre d’installation n’apparaît pas, ajoute VHF GPS Code depuis le menu de Chrome.";
  $("installAddress").value=address;$("installCopyStatus").textContent="";
  const steps=ios?[
   "Copie l’adresse ci-dessus, ouvre Safari, puis colle-la dans la barre d’adresse.",
   "Dans Safari, touche Partager (le carré avec une flèche vers le haut). Selon la disposition, ouvre d’abord le menu de la page, puis Partager.",
   "Fais défiler les actions et choisis « Sur l’écran d’accueil ». Si cette action manque, ajoute-la depuis « Modifier les actions ».",
   "Si l’option « Ouvrir comme app web » est proposée, active-la. Termine avec « Ajouter »."
  ]:[
   "Ouvre cette adresse dans Chrome sur ton téléphone Android.",
   "Ouvre le menu ⋮, puis choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».",
   "Confirme l’installation."
  ];
  $("installSteps").replaceChildren(...steps.map(text=>{const li=document.createElement("li");li.textContent=text;return li;}));
  if(!dialog.open)dialog.showModal();button.setAttribute("aria-expanded","true");
 }
 window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();if(!ios){prompt=event;refresh();}});
 window.addEventListener("appinstalled",()=>{completed=true;prompt=null;refresh();});
 if(standalone.addEventListener)standalone.addEventListener("change",refresh);else standalone.addListener?.(refresh);
 button.onclick=async()=>{
  if(busy)return;
  if(ios||!prompt){explain();return;}
  const current=prompt;prompt=null;busy=true;refresh();
  try{await current.prompt();await current.userChoice;}catch{if(androidChrome)explain();}
  finally{busy=false;refresh();}
 };
 $("closeInstall").onclick=()=>dialog.close();
 dialog.addEventListener("close",()=>button.setAttribute("aria-expanded","false"));
 $("copyInstallAddress").onclick=async()=>{
  const copy=$("copyInstallAddress"),status=$("installCopyStatus");copy.disabled=true;
  try{
   if(!navigator.clipboard?.writeText)throw Error("Copie manuelle nécessaire");
   await navigator.clipboard.writeText(address);
   if(dialog.open)status.textContent=ios?"✓ Adresse copiée. Ouvre Safari et colle-la dans sa barre d’adresse.":"✓ Adresse copiée.";
  }catch{
   if(dialog.open){$("installAddress").focus({preventScroll:true});$("installAddress").select();status.textContent="L’adresse est sélectionnée. Maintiens le doigt dessus, puis choisis « Copier ».";}
  }finally{copy.disabled=false;}
 };
 refresh();
}

import {distance,bearing,readFix,isFresh,reliable,plausible,guidance,project,distanceLabel,durationLabel,STALE_MS,MAX_ACCURACY} from "./point-tracking-math.js";

// Un seul raccord au moteur : getTarget() fournit uniquement un point confirmé.
// Pas de stockage, de secret, d'appel réseau ni de dépendance cartographique.
export function initPointTracking({getTarget}) {
  const start=document.getElementById("startPointTracking");
  if(!start) return {close(){}};
  const dialog=document.createElement("dialog");
  dialog.id="pointTrackingDialog";dialog.className="point-tracking-dialog";
  dialog.setAttribute("aria-labelledby","trackingTitle");
  dialog.innerHTML=`
    <div class="tracking-header"><h2 id="trackingTitle">🧭 Suivre le point reçu</h2><button type="button" class="tracking-close" id="closePointTracking" aria-label="Fermer et arrêter le suivi" autofocus>✕ Fermer</button></div>
    <div class="tracking-body">
      <strong id="trackingDistance" class="tracking-main-value">Recherche GPS…</strong>
      <span id="trackingDirection" class="tracking-direction">Direction du point : —</span>
      <div class="tracking-stats">
        <div class="tracking-stat"><span>🚤 Vitesse sur le fond</span><strong id="trackingSpeed">—</strong></div>
        <div class="tracking-stat"><span>⏱️ Temps estimé</span><strong id="trackingDuration">—</strong></div>
        <div class="tracking-stat"><span>🕒 Arrivée estimée</span><strong id="trackingArrival">—</strong></div>
      </div>
      <p id="trackingGpsStatus" class="tracking-status" role="status" aria-live="polite">🛰️ Recherche de ta position GPS…</p>
      <p id="trackingCourse" class="tracking-status" hidden></p>
      <div class="tracking-meta"><span id="trackingAccuracy">Précision GPS : —</span><span id="trackingAge">Dernier relevé : —</span><span id="trackingWakeStatus" role="status" aria-live="polite">Maintien de l’écran…</span></div>
      <svg id="trackingMap" class="tracking-map" viewBox="0 0 600 420" role="img" aria-labelledby="trackingMapTitle trackingMapDesc">
        <title id="trackingMapTitle">Déplacement vers le point reçu</title><desc id="trackingMapDesc">Vue relative avec le nord en haut, sans carte marine. Le point reçu est fixe.</desc>
        <defs><clipPath id="trackingMapClip"><rect width="600" height="420"/></clipPath></defs>
        <g clip-path="url(#trackingMapClip)">
          <path id="trackingGrid" class="tracking-grid" fill="none"/>
          <circle id="trackingCell" class="tracking-cell"/>
          <path id="trackingTrace" class="tracking-trace"/>
          <line id="trackingDirect" class="tracking-direct"/>
          <circle id="trackingAccuracyCircle" class="tracking-accuracy"/>
          <g id="trackingTarget"><circle r="10" class="tracking-target"/><path d="M -16 0 H 16 M 0 -16 V 16" class="tracking-target" fill="none"/><text x="17" y="-14">Point reçu</text></g>
          <g id="trackingBoat"><path id="trackingBoatArrow" d="M 0 -16 L 11 13 L 0 7 L -11 13 Z" class="tracking-boat"/><circle id="trackingBoatDot" r="7" class="tracking-boat"/><text x="17" y="20">Toi</text></g>
        </g>
        <g transform="translate(560 35)"><path d="M 0 30 V 0 M -5 7 L 0 0 L 5 7" class="tracking-north" fill="none"/><text x="-5" y="-10">N</text></g>
        <g transform="translate(22 390)"><path id="trackingScaleLine" class="tracking-north" fill="none"/><text id="trackingScaleText" y="-9"/></g>
      </svg>
      <div class="tracking-map-controls" role="group" aria-label="Zoom de la vue relative"><button id="trackingZoomIn" type="button" aria-label="Zoomer">＋</button><button id="trackingZoomOut" type="button" aria-label="Dézoomer">−</button><button id="trackingFit" type="button">Cadrer les deux points</button></div>
      <div class="tracking-legend"><span><i class="legend-line" aria-hidden="true"></i>Direction directe</span><span><i class="legend-line legend-trace" aria-hidden="true"></i>Ton déplacement</span><span id="trackingFraming">Cadrage automatique</span></div>
      <p class="tracking-note">Vue relative — sans carte marine. La ligne directe ne tient pas compte des dangers. Le point reçu reste fixe et représente une cellule de 100 m. L’arrivée est estimée à ton allure et ta direction actuelles.</p>
      <p id="trackingTargetCoords" class="tracking-note"></p>
    </div>
    <div class="tracking-footer"><button id="stopPointTracking" type="button" class="tracking-close">ARRÊTER LE SUIVI ET FERMER</button></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector("#"+id);
  let running=false,generation=0,watch=null,timer=null,wake=null,wakePending=false;
  let target=null,fix=null,samples=[],trail=[],gap=true,errorText="",errorKind="warn";
  let autoFrame=true,camera={x:0,y:0,span:500},drag=null,minFixTime=0;
  const MAX_TRAIL=1000;
  const sameTarget=()=>{
    const current=getTarget();
    return current && target && current.identity===target.identity && current.lat===target.lat && current.lon===target.lon;
  };
  function status(text,kind="") {
    const el=$("trackingGpsStatus");
    if(el.textContent!==text) el.textContent=text;
    el.dataset.kind=kind;
  }
  function clearWatch(){if(watch!==null){navigator.geolocation?.clearWatch(watch);watch=null;}}
  function releaseWake(){const previous=wake;wake=null;if(previous)previous.release().catch(()=>{});}
  async function requestWake() {
    if(!running || document.hidden || wake || wakePending) return;
    const revision=generation;wakePending=true;
    if(!navigator.wakeLock){$("trackingWakeStatus").textContent="⚠️ Maintien de l’écran indisponible";wakePending=false;return;}
    try{
      const lock=await navigator.wakeLock.request("screen");
      if(!running || revision!==generation || document.hidden){await lock.release();return;}
      wake=lock;$("trackingWakeStatus").textContent="☀️ Écran maintenu allumé";
      lock.addEventListener("release",()=>{
        if(wake!==lock) return;
        wake=null;if(running)$("trackingWakeStatus").textContent="⚠️ Maintien de l’écran interrompu";
      });
    }catch{
      if(running && revision===generation)$("trackingWakeStatus").textContent="⚠️ Maintien de l’écran indisponible";
    }finally{
      wakePending=false;
      // Une ancienne demande peut se terminer après une fermeture / réouverture.
      if(running && revision!==generation && !document.hidden)requestWake();
    }
  }
  function accept(position,revision) {
    if(!running || revision!==generation || document.hidden) return;
    if(!sameTarget()){close();return;}
    const next=readFix(position);
    if(!next || !isFresh(next) || next.time<minFixTime) {errorText="⚠️ Relevé GPS invalide ou trop ancien — attente d’une nouvelle position.";errorKind="warn";render();return;}
    // Ne pas faire reculer la position avec un callback arrivé en retard.
    if(fix && next.time<=fix.time) return;
    if(!plausible(next,fix)){errorText="⚠️ Déplacement GPS incohérent — attente d’une nouvelle position.";errorKind="warn";gap=true;samples=[];render();return;}
    const interrupted=fix && next.time-fix.time>STALE_MS;
    fix=next;errorText="";
    if(next.accuracy>MAX_ACCURACY){samples=[];gap=true;}
    else{
      if(interrupted){samples=[];gap=true;}
      samples.push(next);samples=samples.filter(f=>next.time-f.time<=30000).slice(-40);
      const last=trail.at(-1);
      // Les oscillations plus petites que la précision annoncée ne dessinent pas de trajet.
      if(!last || gap || distance(last,next)>=Math.max(10,last.accuracy,next.accuracy)){
        trail.push({...next,breakBefore:gap});if(trail.length>MAX_TRAIL)trail.shift();gap=false;
      }
    }
    render();
  }
  function beginGps() {
    if(!running || document.hidden) return;
    clearWatch();const revision=++generation;
    if(!navigator.geolocation){errorText="⛔ GPS indisponible sur ce téléphone. Ferme le suivi pour utiliser la saisie manuelle.";errorKind="bad";render();return;}
    status("🛰️ Recherche de ta position GPS…","warn");
    try{
      watch=navigator.geolocation.watchPosition(position=>accept(position,revision),error=>{
        if(!running || revision!==generation || document.hidden) return;
        samples=[];gap=true;
        errorKind=error.code===1?"bad":"warn";
        errorText=error.code===1?"⛔ Autorisation GPS refusée. Autorise la localisation pour utiliser le suivi.":
          error.code===3?"⚠️ Acquisition GPS trop longue — attente du signal.":"⚠️ Signal GPS indisponible — attente d’une nouvelle position.";
        if(error.code===1)clearWatch();
        render();
      },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    }catch{errorText="⛔ Le GPS n’a pas pu démarrer. Ferme le suivi pour utiliser la saisie manuelle.";errorKind="bad";render();}
  }
  function coords(point) {
    const axis=(v,lat)=>{
      let degrees=Math.floor(Math.abs(v)),minutes=Number(((Math.abs(v)-degrees)*60).toFixed(3));
      if(minutes===60){degrees++;minutes=0;}
      return String(degrees).padStart(lat?2:3,"0")+"° "+minutes.toFixed(3)+"′ "+(lat?(v<0?"S":"N"):(v<0?"W":"E"));
    };
    return axis(point.lat,true)+" / "+axis(point.lon,false);
  }
  function render() {
    if(!running) return;
    if(!sameTarget()){close();return;}
    const now=Date.now(),g=guidance(target,fix,samples,now),hasError=!!errorText;
    const usable=!document.hidden && !hasError && reliable(fix,now);
    $("trackingDistance").textContent=g.distance===null?"Recherche GPS…":distanceLabel(g.distance)+(g.near?" · À proximité":" du point");
    $("trackingDirection").textContent="Direction du point : "+(g.direction===null?"—":String(Math.round(g.direction)%360).padStart(3,"0")+"° vrai");
    $("trackingSpeed").textContent=usable&&g.speed!==null?(g.speed*3600/1852).toLocaleString("fr-FR",{maximumFractionDigits:1})+" nd":"—";
    const eta=usable?g.eta:null;
    $("trackingDuration").textContent=durationLabel(eta);
    let arrival="—";
    if(eta!==null){
      const date=new Date(fix.time+eta*1000),today=new Date(now);
      arrival=(date.toDateString()!==today.toDateString()?date.toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit"})+" · ":"")+date.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
    }
    $("trackingArrival").textContent=arrival;
    $("trackingAccuracy").textContent=fix?"Précision GPS : ±"+Math.round(fix.accuracy)+" m":"Précision GPS : —";
    $("trackingAge").textContent=fix?"Dernier relevé : il y a "+Math.max(0,Math.floor((now-fix.time)/1000))+" s":"Dernier relevé : —";
    const course=$("trackingCourse");course.hidden=!usable || g.heading===null;
    if(!course.hidden){
      const delta=g.delta;
      course.textContent="🚤 Route sur le fond : "+String(Math.round(g.heading)%360).padStart(3,"0")+"° vrai"+
        (delta===null?"":Math.abs(delta)<5?" · Dans la direction du point":
          " · Point à "+Math.round(Math.abs(delta))+"° "+(delta>0?"à droite":"à gauche")+" de ton déplacement");
    }
    if(document.hidden) status("⏸️ Suivi en pause — application en arrière-plan.","warn");
    else if(hasError)status(errorText,errorKind);
    else if(!fix)status("🛰️ Recherche de ta position GPS…","warn");
    else if(g.reason==="stale")status("⚠️ Position GPS ancienne — estimation suspendue jusqu’au prochain relevé.","warn");
    else if(g.reason==="accuracy")status("⚠️ Précision GPS insuffisante — direction indicative, estimation suspendue.","warn");
    else if(g.reason==="near")status("✓ À proximité du point reçu, à la précision du GPS et de la cellule de 100 m.");
    else if(g.reason==="stopped")status("🚤 À l’arrêt ou à faible vitesse — arrivée non estimée.");
    else if(g.reason==="away")status("↗️ Tu t’éloignes du point — arrivée non estimée.","warn");
    else if(g.reason==="across")status("↗️ Déplacement transversal au point — arrivée non estimée.");
    else if(g.reason==="warming")status("🛰️ GPS reçu — estimation en cours, avance pour stabiliser les mesures.");
    else status("✓ Suivi GPS actif · arrivée estimée à ton allure et ta direction actuelles.");
    drawMap(usable?g.heading:null);
  }
  function drawMap(heading) {
    const boat=fix?project(fix,target):null;
    if(autoFrame){
      const x=boat?.x||0,y=boat?.y||0;
      camera={x:x/2,y:y/2,span:Math.min(40000000,Math.max(400,Math.abs(x)*1.5,Math.abs(y)*1.5*600/420))};
    }
    const k=600/camera.span,screen=p=>({x:300+(p.x-camera.x)*k,y:210-(p.y-camera.y)*k});
    const dest=screen({x:0,y:0}),own=boat?screen(boat):null;
    const transform=p=>"translate("+p.x.toFixed(2)+" "+p.y.toFixed(2)+")";
    $("trackingTarget").setAttribute("transform",transform(dest));
    $("trackingCell").setAttribute("cx",dest.x);$("trackingCell").setAttribute("cy",dest.y);$("trackingCell").setAttribute("r",Math.SQRT2*50*k);
    for(const id of ["trackingBoat","trackingDirect","trackingAccuracyCircle"])$(id).style.display=own?"":"none";
    if(own){
      $("trackingBoat").setAttribute("transform",transform(own));
      $("trackingBoatArrow").style.display=heading===null?"none":"";$("trackingBoatDot").style.display=heading===null?"":"none";
      $("trackingBoatArrow").setAttribute("transform","rotate("+(heading||0)+")");
      for(const [key,value] of Object.entries({x1:own.x,y1:own.y,x2:dest.x,y2:dest.y}))$("trackingDirect").setAttribute(key,value);
      $("trackingAccuracyCircle").setAttribute("cx",own.x);$("trackingAccuracyCircle").setAttribute("cy",own.y);$("trackingAccuracyCircle").setAttribute("r",Math.min(4000,fix.accuracy*k));
    }
    let path="";
    for(let i=0;i<trail.length;i++){const p=screen(project(trail[i],target));path+=(i===0||trail[i].breakBefore?"M":"L")+p.x.toFixed(2)+" "+p.y.toFixed(2)+" ";}
    $("trackingTrace").setAttribute("d",path);
    const desired=camera.span/4,power=10**Math.floor(Math.log10(desired));
    const length=[1,2,5].map(n=>n*power).filter(n=>n<=desired).at(-1)||power;
    $("trackingScaleLine").setAttribute("d","M 0 -4 V 4 M 0 0 H "+(length*k)+" M "+(length*k)+" -4 V 4");
    $("trackingScaleText").textContent=distanceLabel(length);
    const spacing=length*k;
    let grid="";for(let x=((dest.x%spacing)+spacing)%spacing;x<600;x+=spacing)grid+="M "+x+" 0 V 420 ";
    for(let y=((dest.y%spacing)+spacing)%spacing;y<420;y+=spacing)grid+="M 0 "+y+" H 600 ";
    $("trackingGrid").setAttribute("d",grid);
    $("trackingFraming").textContent=autoFrame?"Cadrage automatique":"Vue déplacée / zoom manuel";
    $("trackingZoomIn").disabled=camera.span<=40;$("trackingZoomOut").disabled=camera.span>=40000000;
  }
  function cleanup() {
    running=false;generation++;clearWatch();if(timer!==null){clearInterval(timer);timer=null;}
    releaseWake();fix=null;samples=[];trail=[];target=null;drag=null;errorText="";minFixTime=0;
  }
  function close() {
    cleanup();if(dialog.open)dialog.close();
  }
  function open() {
    if(running || document.body.inert) return;
    const point=getTarget();
    if(!point || !Number.isFinite(point.lat) || Math.abs(point.lat)>90 || !Number.isFinite(point.lon) || Math.abs(point.lon)>180) return;
    cleanup();target=Object.freeze({...point});running=true;autoFrame=true;camera={x:0,y:0,span:500};gap=true;
    $("trackingTargetCoords").textContent="🎯 Point reçu : "+coords(target);
    $("trackingWakeStatus").textContent="Maintien de l’écran…";
    dialog.showModal();render();beginGps();requestWake();timer=setInterval(render,1000);
  }
  start.addEventListener("click",open);
  $("closePointTracking").addEventListener("click",close);
  $("stopPointTracking").addEventListener("click",close);
  dialog.addEventListener("cancel",event=>{event.preventDefault();close();});
  dialog.addEventListener("close",()=>{if(!dialog.open)cleanup();});
  document.addEventListener("vhf-position-reset",close);
  window.addEventListener("pagehide",close);
  document.addEventListener("visibilitychange",()=>{
    if(!running) return;
    generation++;clearWatch();releaseWake();samples=[];gap=true;
    if(document.hidden){$("trackingWakeStatus").textContent="Écran libre · suivi en pause";render();}
    else{
      // Le dernier point reste sur la vue, mais aucune estimation n'utilise son ancienne mesure.
      minFixTime=Date.now();
      errorText="🛰️ Reprise du suivi — attente d’un relevé GPS frais.";errorKind="warn";
      beginGps();requestWake();render();
    }
  });
  for(const [id,factor] of [["trackingZoomIn",0.5],["trackingZoomOut",2]])$(id).addEventListener("click",()=>{autoFrame=false;camera.span=Math.min(40000000,Math.max(40,camera.span*factor));render();});
  $("trackingFit").addEventListener("click",()=>{autoFrame=true;render();});
  const map=$("trackingMap");
  map.addEventListener("pointerdown",event=>{
    if(!running || !event.isPrimary || event.button!==0) return;
    const rect=map.getBoundingClientRect(),pixelScale=Math.min(rect.width/600,rect.height/420);
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,center:{...camera},pixelScale};map.setPointerCapture(event.pointerId);
  });
  map.addEventListener("pointermove",event=>{
    if(!drag || drag.id!==event.pointerId) return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.abs(dx)+Math.abs(dy)<3) return;
    autoFrame=false;camera.x=drag.center.x-dx/drag.pixelScale*drag.center.span/600;camera.y=drag.center.y+dy/drag.pixelScale*drag.center.span/600;render();
  });
  for(const name of ["pointerup","pointercancel","lostpointercapture"])map.addEventListener(name,()=>{drag=null;});
  return {close};
}

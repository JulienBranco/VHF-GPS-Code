import {FRANCE_BOUNDS,COVERAGE,project,fitBounds,boundsRect,geometryPath,scaleBar,unproject,isWithinMapCoverage} from "./catalog-map-model.js";
const NS="http://www.w3.org/2000/svg";
const encodingGuide='<p class="catalog-map-guide"><strong>Le carré délimite les positions que vous pouvez coder.</strong> Choisissez une zone qui couvre votre secteur de pêche.</p>';
function svgElement(name,attributes={}){const node=document.createElementNS(NS,name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,value);return node;}
function mapMarkup(prefix){return `<div class="catalog-map-tools"><button type="button" id="${prefix}France">Vue France</button><button type="button" id="${prefix}Focus">Centrer</button><div class="catalog-map-zoom"><button type="button" id="${prefix}ZoomIn" aria-label="Agrandir la carte">+</button><button type="button" id="${prefix}ZoomOut" aria-label="Réduire la carte">−</button></div></div>
 <div class="catalog-map-surface"><svg id="${prefix}Svg" class="catalog-map-svg" role="img" aria-labelledby="${prefix}SvgTitle ${prefix}SvgDescription"><title id="${prefix}SvgTitle">France et zones du catalogue</title><desc id="${prefix}SvgDescription">Côte simplifiée et limites encodables des zones. Choisissez une zone dans la liste ou touchez son point sur la carte.</desc><g class="catalog-map-land"></g><g class="catalog-map-coast"></g><g class="catalog-map-zones"></g></svg><span class="catalog-map-north" aria-hidden="true">↑ N</span><div class="catalog-map-scale" aria-hidden="true"><span></span><b></b></div><p id="${prefix}Status" class="catalog-map-status" role="status">Préparation de la carte…</p></div><div id="${prefix}Selection" class="catalog-map-selection" aria-live="polite"></div>`;}
export function initCatalogMap({getZones,getPreparedEphemeralZone=()=>null,getApplicationState,activateZone}){
 const regions=["Atlantique","Manche","Mer du Nord","Méditerranée","Corse"];
 const zones=getZones().sort((a,b)=>regions.indexOf(a.region)-regions.indexOf(b.region)||a.name.localeCompare(b.name,"fr"));
 const overviewBounds=zones.reduce((bounds,z)=>({minLon:Math.min(bounds.minLon,z.bounds.minLon),maxLon:Math.max(bounds.maxLon,z.bounds.maxLon),minLat:Math.min(bounds.minLat,z.bounds.minLat),maxLat:Math.max(bounds.maxLat,z.bounds.maxLat)}),{...FRANCE_BOUNDS});
 let dataPromise=null;
 function loadPaths(){
  dataPromise??=import("./catalog-map-data.js").then(({MAP_DATA})=>({land:geometryPath(MAP_DATA.land,true),coast:geometryPath(MAP_DATA.coast)})).catch(error=>{dataPromise=null;throw error;});
  return dataPromise;
 }
 // Le même affichage et les mêmes gestes servent à la préparation et à la consultation.
 function createView(root,prefix,{visible,onChoose,canChoose=()=>true,onRender=()=>{},wheelZoom=true,listZones=()=>zones,getActiveId=()=>""}){
  const find=id=>root.querySelector("#"+prefix+id),svg=find("Svg"),status=find("Status"),selection=find("Selection");
  let selected="",view=fitBounds(overviewBounds),ready=false,drag=null,pinch=null,moved=false,focusMode="france",loading=null;
  const pointers=new Map();
  const aspect=()=>Math.max(.5,svg.clientWidth/Math.max(1,svg.clientHeight));
  const zone=()=>listZones().find(item=>item.id===selected);
  function constrain(){
   const area=boundsRect(COVERAGE),factor=Math.min(1,area.height/view.height,area.width/view.width);
   if(factor<1){const cx=view.x+view.width/2,cy=view.y+view.height/2;view.width*=factor;view.height*=factor;view.x=cx-view.width/2;view.y=cy-view.height/2;}
   const cx=Math.max(area.x+view.width/2,Math.min(area.x+area.width-view.width/2,view.x+view.width/2)),cy=Math.max(area.y+view.height/2,Math.min(area.y+area.height-view.height/2,view.y+view.height/2));view.x=cx-view.width/2;view.y=cy-view.height/2;
  }
  function render(){
   if(!visible())return;
   const item=zone(),covered=!item||isWithinMapCoverage(item.bounds);
   root.querySelector(".catalog-map-surface").hidden=!covered;root.querySelector(".catalog-map-tools").hidden=!covered;
   root.dataset.zone=selected;onRender(selected);if(!ready||!covered||!svg.clientWidth)return;constrain();svg.setAttribute("viewBox",`${view.x} ${view.y} ${view.width} ${view.height}`);
   const unit=view.width/svg.clientWidth,layer=svg.querySelector(".catalog-map-zones");layer.replaceChildren();
   const available=listZones().filter(item=>isWithinMapCoverage(item.bounds)),ordered=[...available.filter(item=>item.id!==selected),...available.filter(item=>item.id===selected)];
   for(const item of ordered){
    const index=listZones().indexOf(item)+1,rect=boundsRect(item.bounds),[x,y]=project(item.lon,item.lat),group=svgElement("g",{"data-zone":item.id,class:[item.id===selected?"is-selected":"",item.id===getActiveId()?"is-active":""].filter(Boolean).join(" ")}),compact=focusMode==="france"&&item.id!==selected;
    const title=svgElement("title");title.textContent=`${index} · ${item.name} · 250 × 250 km${item.id===getActiveId()?" · Zone active":""}`;
    group.append(title,svgElement("rect",{...rect,class:"catalog-map-zone-area"}),svgElement("circle",{cx:x,cy:y,r:(compact?3.5:10)*unit,class:"catalog-map-center"}));
    if(!compact){const text=svgElement("text",{x,y,"font-size":12*unit,"text-anchor":"middle","dominant-baseline":"central",class:"catalog-map-number"});text.textContent=index;group.append(text);}layer.append(group);
   }
   const scale=scaleBar(view,svg.clientWidth);root.querySelector(".catalog-map-scale span").style.width=scale.pixels+"px";root.querySelector(".catalog-map-scale b").textContent=scale.km+" km";
   find("Focus").disabled=!item;
   const strong=document.createElement("strong"),detail=document.createElement("span");strong.textContent=item?item.name:`${listZones().length} zones disponibles`;
   detail.textContent=item?"250 × 250 km · le contour coloré montre ses limites encodables.":"Choisissez une zone dans la liste ou touchez son point sur la carte.";
   selection.replaceChildren(strong,detail);svg.querySelector("title").textContent=item?`Emprise de ${item.name}`:"France et zones disponibles";
  }
  function fit(mode=focusMode){focusMode=mode;const item=zone();view=fitBounds(mode==="zone"&&item&&isWithinMapCoverage(item.bounds)?item.bounds:overviewBounds,aspect(),mode==="zone"?.28:.04);render();}
  function setSelected(id){resetGesture();selected=listZones().some(item=>item.id===id)?id:"";fit(selected?"zone":"france");}
  function choose(id){if(!canChoose())return;setSelected(id);onChoose?.(selected);}
  async function activate(id){
   setSelected(id);if(ready)return;
   if(loading)return loading;
   status.hidden=false;status.textContent="Préparation de la carte…";
   loading=(async()=>{
    try{const paths=await loadPaths();svg.querySelector(".catalog-map-land").replaceChildren(svgElement("path",{d:paths.land,"fill-rule":"evenodd"}));svg.querySelector(".catalog-map-coast").replaceChildren(svgElement("path",{d:paths.coast}));ready=true;status.hidden=true;fit();}
    catch(error){status.textContent="Carte indisponible. Vous pouvez choisir une zone dans la liste et continuer.";console.warn("Module cartographique indisponible",error);}
    finally{loading=null;}
   })();return loading;
  }
  function zoom(factor,anchor=null){
   if(!ready)return;const cx=anchor?.[0]??view.x+view.width/2,cy=anchor?.[1]??view.y+view.height/2;if(view.width*factor<.15)return;
   view={x:cx+(view.x-cx)*factor,y:cy+(view.y-cy)*factor,width:view.width*factor,height:view.height*factor};focusMode="manual";render();
  }
  find("France").onclick=()=>fit("france");find("Focus").onclick=()=>fit("zone");find("ZoomIn").onclick=()=>zoom(.72);find("ZoomOut").onclick=()=>zoom(1/.72);
  svg.addEventListener("wheel",event=>{if(!ready||(!wheelZoom&&!event.ctrlKey))return;event.preventDefault();const rect=svg.getBoundingClientRect();zoom(event.deltaY>0?1.18:1/1.18,[view.x+(event.clientX-rect.left)/rect.width*view.width,view.y+(event.clientY-rect.top)/rect.height*view.height]);},{passive:false});
  function nearestPoint(clientX,clientY){
   const rect=svg.getBoundingClientRect();let nearest=null,distance=14;
   for(const item of listZones().filter(item=>isWithinMapCoverage(item.bounds))){const [x,y]=project(item.lon,item.lat),sx=rect.left+(x-view.x)/view.width*rect.width,sy=rect.top+(y-view.y)/view.height*rect.height;if(sx<rect.left||sx>rect.right||sy<rect.top||sy>rect.bottom)continue;const d=Math.hypot(sx-clientX,sy-clientY);if(d<distance){distance=d;nearest=item.id;}}
   return nearest;
  }
  function resetGesture(){
   drag=null;pinch=null;moved=false;
   for(const id of pointers.keys())if(svg.hasPointerCapture(id))svg.releasePointerCapture(id);
   pointers.clear();
  }
  function beginPinch(){
   const pair=[...pointers.entries()].slice(0,2),[a,b]=pair.map(([,point])=>point),rect=svg.getBoundingClientRect();
   const distance=Math.hypot(b.x-a.x,b.y-a.y);if(!distance||!rect.width||!rect.height)return;
   const x=(a.x+b.x)/2,y=(a.y+b.y)/2;
   pinch={ids:pair.map(([id])=>id),distance,view:{...view},anchor:[view.x+(x-rect.left)/rect.width*view.width,view.y+(y-rect.top)/rect.height*view.height]};
   drag=null;moved=true;
  }
  svg.addEventListener("pointerdown",event=>{
   if(!ready||!visible()||event.button!==0)return;
   pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});svg.setPointerCapture(event.pointerId);
   if(pointers.size===1){drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view},zoneId:nearestPoint(event.clientX,event.clientY)};pinch=null;moved=false;}
   else beginPinch();
  });
  svg.addEventListener("pointermove",event=>{
   if(!pointers.has(event.pointerId))return;
   pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
   if(pinch){
    const [a,b]=pinch.ids.map(id=>pointers.get(id));if(!a||!b)return;
    const distance=Math.hypot(b.x-a.x,b.y-a.y),rect=svg.getBoundingClientRect();if(!distance||!rect.width||!rect.height)return;
    const factor=Math.max(.15/pinch.view.width,pinch.distance/distance),width=pinch.view.width*factor,height=pinch.view.height*factor;
    view={x:pinch.anchor[0]-((a.x+b.x)/2-rect.left)/rect.width*width,y:pinch.anchor[1]-((a.y+b.y)/2-rect.top)/rect.height*height,width,height};
    focusMode="manual";render();return;
   }
   if(!drag||event.pointerId!==drag.id)return;
   const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)moved=true;if(!moved)return;
   view={...drag.view,x:drag.view.x-dx/svg.clientWidth*drag.view.width,y:drag.view.y-dy/svg.clientHeight*drag.view.height};focusMode="manual";render();
  });
  function endPointer(event,allowChoice){
   if(!pointers.has(event.pointerId))return;
   const id=allowChoice&&pointers.size===1&&!moved?drag?.zoneId:null;
   pointers.delete(event.pointerId);drag=null;pinch=null;
   if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
   if(pointers.size>=2)beginPinch();
   else if(pointers.size===1){
    const [remainingId,point]=pointers.entries().next().value;
    drag={id:remainingId,x:point.x,y:point.y,view:{...view},zoneId:null};moved=true;
   }
   if(id)choose(id);
  }
  svg.addEventListener("pointerup",event=>endPointer(event,true));
  for(const type of ["pointercancel","lostpointercapture"])svg.addEventListener(type,event=>endPointer(event,false));
  new ResizeObserver(()=>{if(!visible()||!ready)return;if(focusMode==="manual"){const [x,y]=project(...unproject(view.x+view.width/2,view.y+view.height/2));view.height=view.width/aspect();view.x=x-view.width/2;view.y=y-view.height/2;render();}else fit();}).observe(svg);
  return {activate,setSelected};
 }
 const dialog=document.createElement("dialog");dialog.id="catalogMapDialog";dialog.className="catalog-map-dialog";dialog.setAttribute("aria-labelledby","catalogMapTitle");
 dialog.innerHTML=`<header class="catalog-map-header"><div><h2 id="catalogMapTitle">🗺️ Carte des zones</h2></div><button type="button" id="catalogMapClose" aria-label="Fermer la carte">Fermer</button></header>
 <div class="catalog-map-body">${encodingGuide}<p id="catalogMapActive" class="catalog-map-active"></p><label for="catalogMapSelect">Zone à visualiser</label><select id="catalogMapSelect"></select>${mapMarkup("catalogMap")}
 <section id="catalogMapFallback" class="catalog-map-fallback" hidden><p>Le fond cartographique embarqué n’est pas disponible pour cette zone. Voici ses limites encodables.</p><div></div></section>
 <p id="catalogMapHint" class="catalog-map-hint">Déplacez la carte avec un doigt et zoomez avec deux doigts. Choisissez dans la liste ou touchez un point sur la carte. <strong>Pour changer de zone, utilisez le bouton ci-dessous.</strong></p>
 <div class="catalog-map-actions"><button type="button" id="catalogMapUse" disabled>Zone active</button><p id="catalogMapActionStatus" role="status" hidden></p></div>
 </div>`;
 document.body.append(dialog);
 const select=dialog.querySelector("#catalogMapSelect"),use=dialog.querySelector("#catalogMapUse"),fallback=dialog.querySelector("#catalogMapFallback");
 let applicationState=null,stateKey="",opener=null,applying=false;
 const availableZones=()=>applicationState?.zones||[];
 const groupLabel=zone=>zone.type==="builtin"?zone.region:zone.type==="ephemeral"?"Zones éphémères de la sortie":"Zones personnalisées";
 function selectionChanged(id){
  select.value=id;const item=availableZones().find(zone=>zone.id===id),active=applicationState?.activeId===id;
  use.disabled=!item||active||applying;use.textContent=active?"Zone active":"Changer de zone";
  const outside=!!item&&!isWithinMapCoverage(item.bounds);fallback.hidden=!outside;
  dialog.querySelector("#catalogMapHint").firstChild.textContent=outside?"Choisissez une zone dans la liste. ":"Déplacez la carte avec un doigt et zoomez avec deux doigts. Choisissez dans la liste ou touchez un point sur la carte. ";
  fallback.querySelector("div").innerHTML=outside?item.compass:"";
  dialog.querySelector("#catalogMapSelection").hidden=outside;
  if(outside)dialog.querySelector("#catalogMapStatus").hidden=true;
 }
 const consultation=createView(dialog,"catalogMap",{visible:()=>dialog.open,listZones:availableZones,getActiveId:()=>applicationState?.activeId,onRender:selectionChanged});
 function refreshApplicationState(){
  const next=getApplicationState(),key=JSON.stringify(next);if(key===stateKey)return false;
  if(dialog.open&&applicationState&&next.sessionRevision!==applicationState.sessionRevision){dialog.close();return false;}
  applicationState=next;stateKey=key;
  select.replaceChildren(new Option("Vue d’ensemble des zones du catalogue",""));const groups=new Map();
  applicationState.zones.sort((a,b)=>{const rank=z=>z.type==="builtin"?regions.indexOf(z.region):z.type==="ephemeral"?regions.length:regions.length+1;return rank(a)-rank(b)||a.name.localeCompare(b.name,"fr");});
  for(const [index,zone]of availableZones().entries()){
   const label=groupLabel(zone);if(!groups.has(label)){const group=document.createElement("optgroup");group.label=label;select.append(group);groups.set(label,group);}
   groups.get(label).append(new Option(`${index+1} · ${zone.name}${zone.id===applicationState.activeId?" · Zone active":""}`,zone.id));
  }
  const active=availableZones().find(zone=>zone.id===applicationState.activeId);dialog.querySelector("#catalogMapActive").textContent="Zone active · "+(active?.name||"—");
  return true;
 }
 select.onchange=()=>{dialog.querySelector("#catalogMapActionStatus").hidden=true;consultation.setSelected(select.value);};dialog.querySelector("#catalogMapClose").onclick=()=>dialog.close();
 dialog.addEventListener("close",()=>{if(opener?.isConnected)opener.focus({preventScroll:true});});
 use.onclick=async()=>{
  if(use.disabled||applying)return;const id=select.value,context={activeId:applicationState.activeId,sessionRevision:applicationState.sessionRevision};
  applying=true;use.disabled=true;dialog.close();
  try{await activateZone(id,context);}
  catch(error){
   if(getApplicationState().sessionRevision===context.sessionRevision){stateKey="";refreshApplicationState();dialog.showModal();await consultation.activate(applicationState.activeId);const status=dialog.querySelector("#catalogMapActionStatus");status.textContent=error.message||String(error);status.hidden=false;}
   else console.warn("Changement de zone annulé",error);
  }finally{applying=false;if(dialog.open)selectionChanged(select.value);if(opener?.isConnected&&!dialog.open)opener.focus({preventScroll:true});}
 };
 async function openFor(source,button){if(applying)return;opener=button;stateKey="";refreshApplicationState();dialog.querySelector("#catalogMapActionStatus").hidden=true;dialog.showModal();dialog.querySelector("#catalogMapClose").focus({preventScroll:true});await consultation.activate(source.value);}
 const outingSource=document.getElementById("outingBuiltinSelect"),outingDialog=document.getElementById("outingCreateDialog"),outingFields=document.getElementById("outingBuiltinFields"),preparation=document.createElement("section");
 preparation.id="outingCatalogMap";preparation.className="catalog-map-inline catalog-map-preparation";preparation.setAttribute("aria-label","Carte de sélection de la zone de la nouvelle sortie");
 preparation.innerHTML=encodingGuide+mapMarkup("outingCatalogMap")+'<p class="catalog-map-hint">Déplacez la carte avec un doigt, zoomez avec deux doigts et touchez un point pour choisir la zone.</p>';outingSource.after(preparation);
 const isVisible=()=>outingDialog.open&&!outingFields.classList.contains("hidden");
 const preparationView=createView(preparation,"outingCatalogMap",{visible:isVisible,wheelZoom:false,canChoose:()=>!outingSource.disabled&&isVisible(),onChoose:id=>{if(outingSource.value===id)return;outingSource.value=id;outingSource.dispatchEvent(new Event("change",{bubbles:true}));}});
 outingSource.addEventListener("change",()=>preparationView.setSelected(outingSource.value));
 new MutationObserver(()=>{if(isVisible())preparationView.activate(outingSource.value);}).observe(outingDialog,{attributes:true,attributeFilter:["open"]});
 new MutationObserver(()=>{preparation.inert=outingSource.disabled;}).observe(outingSource,{attributes:true,attributeFilter:["disabled"]});
 new MutationObserver(()=>{if(isVisible())preparationView.activate(outingSource.value);}).observe(outingFields,{attributes:true,attributeFilter:["class"]});
 if(isVisible())preparationView.activate(outingSource.value);
 // Les aperçus simples partagent le cadrage et le chargement du fond.
 function createPreview(id,caption){
  const preview=document.createElement("figure");preview.id=id;preview.className="catalog-map-inline";preview.hidden=true;
  preview.innerHTML='<div class="catalog-map-inline-caption"><span></span></div><div class="catalog-map-surface"><svg class="catalog-map-svg" role="img"><title></title><g class="catalog-map-land"></g><g class="catalog-map-coast"></g><g class="catalog-map-zones"></g></svg><span class="catalog-map-north" aria-hidden="true">↑ N</span><div class="catalog-map-scale" aria-hidden="true"><span></span><b></b></div><p class="catalog-map-inline-status" role="status">Préparation de la carte…</p></div>';
  preview.querySelector(".catalog-map-inline-caption span").textContent=caption;
  const map=preview.querySelector("svg"),message=preview.querySelector(".catalog-map-inline-status");let current=null,key="",request=0,paths=null;
  function render(){
   if(!current||!paths||preview.hidden||!map.clientWidth)return;
   const frame=fitBounds(current.bounds,map.clientWidth/map.clientHeight,.18),rect=boundsRect(current.bounds),unit=frame.width/map.clientWidth,[x,y]=project(current.lon,current.lat);
   map.setAttribute("viewBox",[frame.x,frame.y,frame.width,frame.height].join(" "));
   map.querySelector(".catalog-map-zones").replaceChildren(svgElement("g",{class:"is-selected"}));const layer=map.querySelector(".catalog-map-zones g");
   layer.append(svgElement("rect",{...rect,class:"catalog-map-zone-area"}),svgElement("path",{d:"M"+(x-6*unit)+" "+y+"H"+(x+6*unit)+"M"+x+" "+(y-6*unit)+"V"+(y+6*unit),class:"catalog-map-inline-center"}));
   map.querySelector("title").textContent="Emprise de "+current.name;map.setAttribute("aria-label","Carte centrée sur "+current.name+" · limites encodables de 250 × 250 km");
   const scale=scaleBar(frame,map.clientWidth);preview.querySelector(".catalog-map-scale span").style.width=scale.pixels+"px";preview.querySelector(".catalog-map-scale b").textContent=scale.km+" km";
  }
  function hide(){if(!current&&preview.hidden&&!preview.isConnected)return;++request;current=null;key="";preview.hidden=true;preview.remove();delete preview.dataset.zone;}
  async function show(item,compass){
   const nextKey=JSON.stringify([item.id,item.name,item.lat,item.lon,item.bounds]);
   if(preview.previousElementSibling===compass&&key===nextKey&&!preview.hidden)return;
   current=item;key=nextKey;preview.hidden=false;compass.after(preview);preview.dataset.zone=item.id;
   const revision=++request;message.hidden=false;message.textContent="Préparation de la carte…";
   try{
    paths=await loadPaths();if(revision!==request)return;
    if(!map.querySelector(".catalog-map-land path")){map.querySelector(".catalog-map-land").append(svgElement("path",{d:paths.land,"fill-rule":"evenodd"}));map.querySelector(".catalog-map-coast").append(svgElement("path",{d:paths.coast}));}
    message.hidden=true;render();
   }catch(error){if(revision===request){message.textContent="Aperçu indisponible. Vous pouvez continuer la préparation de la sortie.";console.warn("Aperçu cartographique indisponible",error);}}
  }
  new ResizeObserver(render).observe(map);return {preview,show,hide};
 }
 const ephemeralSummary=document.getElementById("outingBoundsPreview"),ephemeralPreview=createPreview("outingEphemeralMapPreview","Zone éphémère · 250 × 250 km");
 function updateEphemeralPreview(){
  const item=getPreparedEphemeralZone(),compass=ephemeralSummary.querySelector(".zone-bound-grid");
  if(!item||!compass||!isWithinMapCoverage(item.bounds)){ephemeralPreview.hide();return;}
  ephemeralPreview.show(item,compass);
 }
 new MutationObserver(updateEphemeralPreview).observe(ephemeralSummary,{subtree:true,childList:true});
 new MutationObserver(updateEphemeralPreview).observe(outingDialog,{attributes:true,attributeFilter:["open"]});updateEphemeralPreview();
 for(const id of ["sendZone","recvZone"]){
  const source=document.getElementById(id),button=document.createElement("button");button.type="button";button.id=id+"MapBtn";button.className="catalog-map-trigger";button.setAttribute("aria-haspopup","dialog");button.setAttribute("aria-controls",dialog.id);button.textContent="🗺️ Voir carte des zones";button.onclick=()=>openFor(source,button);
  const subtitle=source.closest(".active-zone-section").querySelector(".step-subtitle"),intro=document.createElement("div");
  intro.id=id+"MapIntro";intro.className="catalog-map-zone-intro";subtitle.before(intro);intro.append(subtitle,button);
  const summary=document.getElementById(id+"Summary"),inline=createPreview(id+"MapPreview","Aperçu de la zone · 250 × 250 km");
  inline.preview.querySelector(".catalog-map-surface").insertAdjacentHTML("beforebegin",encodingGuide);
  function update(){
   const item=getApplicationState().zones.find(zone=>zone.id===source.value),compass=summary?.querySelector(".zone-bound-grid");
   if(dialog.open){const selected=select.value;if(refreshApplicationState()&&dialog.open)consultation.setSelected(selected);}
   button.disabled=!item;
   if(!item||!compass){inline.hide();return;}
   if(!isWithinMapCoverage(item.bounds)){inline.hide();return;}
   inline.show(item,compass);
  }
  source.addEventListener("change",()=>queueMicrotask(update));if(summary)new MutationObserver(update).observe(summary,{subtree:true,childList:true});update();
 }
 return {close:()=>dialog.close()};
}

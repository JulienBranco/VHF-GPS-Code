import {HISTORY_KEY,validEntry,copyEntry,decodeHistory,encodeHistory,newestFirst,marineAxis} from "./position-history-model.js";

export function initPositionHistory({storage,commit,outingId,canUse,track=null}){
  const panel=document.getElementById("positionHistory"),list=document.getElementById("positionHistoryList");
  const count=document.getElementById("positionHistoryCount"),message=document.getElementById("positionHistoryStatus");
  let entries=[],chain=Promise.resolve(),unreadable=false;
  const seen=new Set();
  function status(text){message.textContent=text;message.hidden=!text;}
  try{entries=decodeHistory(storage.getItem(HISTORY_KEY),outingId);}
  catch(error){unreadable=true;status(error.message+" Les nouveaux points ne remplaceront pas cet historique.");}
  const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className;if(text!==undefined)el.textContent=text;return el;};
  function render(){
    count.textContent=String(entries.length);list.replaceChildren();
    if(!entries.length){list.append(element("p","history-empty","Les points générés et reçus après confirmation apparaîtront ici."));return;}
    // Les lignes sont rendues uniquement au dépliage, pas à chaque frappe ou mesure GPS.
    if(!panel.open)return;
    for(const entry of newestFirst(entries)){
      const row=element("li","history-entry history-"+entry.kind),header=element("div","history-entry-heading");
      const badge=element("strong","history-kind",entry.kind==="generated"?"🔒 Généré":"✅ Reçu et confirmé");
      const date=element("time","history-date",new Date(entry.at).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}));
      date.dateTime=new Date(entry.at).toISOString();header.append(badge,date);
      const coordinates=element("div","history-coordinates");
      coordinates.append(element("span","",marineAxis(entry.lat,true)),element("span","",marineAxis(entry.lon,false)));
      row.append(header,coordinates,element("div","history-zone","📍 "+entry.zone.name),element("div","history-phrase",entry.phrase));
      if(track){
        const button=element("button","history-track","🧭 Suivre ce point");button.type="button";button.dataset.historyId=entry.id;
        button.addEventListener("click",()=>{
          if(!canUse())return;
          const getPoint=()=>{
            if(!canUse())return null;
            const saved=entries.find(e=>e.id===entry.id);
            return saved?{lat:saved.lat,lon:saved.lon,identity:saved.id,kind:saved.kind}:null;
          };
          track(getPoint);
        });
        row.append(button);
      }
      list.append(row);
    }
  }
  panel.addEventListener("toggle",render);
  function record(detail){
    if(!canUse() || unreadable || !detail || typeof detail.eventId!=="string" || seen.has(detail.eventId))return chain;
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("");
    const candidate={...detail,id};
    if(!validEntry(candidate)){status("Ce point n’a pas pu être ajouté à l’historique.");return chain;}
    const entry=copyEntry(candidate);seen.add(detail.eventId);
    chain=chain.then(async()=>{
      if(!canUse())return;
      const next=[...entries,entry],raw=encodeHistory(next,outingId);
      storage.setItem(HISTORY_KEY,raw);
      await commit();
      entries=next;status("");render();
    }).catch(error=>{seen.delete(detail.eventId);status(error.message||"L’historique n’a pas pu être enregistré.");});
    return chain;
  }
  document.addEventListener("vhf-position-record",event=>record(event.detail));
  render();
  return {flush:()=>chain};
}

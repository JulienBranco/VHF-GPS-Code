import {channelTable} from "./vhf-channels-model.js";

export function initVhfChannels({getSession,words,canUse}){
  const panel=document.getElementById("vhfChannels"),body=document.getElementById("vhfChannelsRows"),status=document.getElementById("vhfChannelsStatus");
  let revision=0,lastSecret="";
  const example=document.getElementById("vhfChannelsExample"),exampleWord=document.getElementById("vhfChannelsExampleWord");
  function clear(){body.replaceChildren();example.hidden=true;exampleWord.textContent="";lastSecret="";}
  async function refresh(){
    const current=++revision,secret=canUse()?getSession():"";
    if(!secret){clear();status.hidden=false;status.textContent="Le tableau sera disponible une fois la sortie activée.";return;}
    if(secret!==lastSecret)clear();
    if(!panel.open||secret===lastSecret)return;
    status.hidden=false;status.textContent="Préparation du tableau…";
    try{
      const rows=await channelTable(secret,words);
      if(current!==revision||!canUse()||getSession()!==secret)return;
      body.replaceChildren(...rows.map(({channel,word})=>{
        const tr=document.createElement("tr"),number=document.createElement("th"),label=document.createElement("td");
        number.scope="row";
        const caption=document.createElement("span"),value=document.createElement("strong");
        caption.textContent="CANAL";value.textContent=String(channel);number.append(caption,value);
        label.textContent=word;tr.append(number,label);return tr;
      }));
      exampleWord.textContent=rows[0].word;example.hidden=false;
      lastSecret=secret;status.textContent="";status.hidden=true;
    }catch(error){
      if(current!==revision)return;
      clear();status.hidden=false;status.textContent=error.message||"Tableau indisponible.";
    }
  }
  panel.addEventListener("toggle",refresh);
  const observer=new MutationObserver(refresh);
  observer.observe(document.getElementById("fingerprintBlock"),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});
  refresh();
  return {refresh};
}

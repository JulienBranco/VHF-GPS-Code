export const PUBLICATION_API=1;
export const PREFIX="VHF-GPS-TEST-1";
export const BEGIN="DEBUT INVITATION VHF-GPS TEST";
export const END="FIN INVITATION VHF-GPS TEST";
const HEX=/^[a-f0-9]{64}$/;
export async function digest(value){
  const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
}
export function randomId(bytes=16){return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,"0")).join("");}
export function validatePayload(p){
  if(!p||p.format!==1||!HEX.test(p.release)||!/^DEMO-[AB]$/.test(p.protocol)||!HEX.test(p.session)||
     !/^[a-f0-9]{32}$/.test(p.id)||!Number.isSafeInteger(p.createdAt)||p.createdAt<0||
     !Number.isFinite(p.lat)||Math.abs(p.lat)>85||!Number.isFinite(p.lon)||Math.abs(p.lon)>180){
    throw new Error("Invitation d’essai invalide.");
  }
  return p;
}
export async function invitationText(payload){
  validatePayload(payload);
  const json=JSON.stringify(payload);
  const data=btoa(String.fromCharCode(...new TextEncoder().encode(json))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
  const code=PREFIX+"."+data;
  return "🧪 Invitation VHF GPS — TEST UNIQUEMENT\nNe pas utiliser à la VHF.\n\n"+BEGIN+"\n"+code+"."+await digest(code)+"\n"+END;
}
export async function parseInvitation(text){
  if(typeof text!=="string"||text.length>12000)throw new Error("Message d’essai trop long.");
  const parts=text.split(BEGIN);
  if(parts.length!==2||parts[1].split(END).length!==2)throw new Error("Colle une seule invitation d’essai complète.");
  const code=parts[1].split(END)[0].replace(/\s/g,"");
  const match=code.match(/^VHF-GPS-TEST-1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/);
  if(!match||await digest(PREFIX+"."+match[1])!==match[2])throw new Error("L’invitation est incomplète ou a été modifiée.");
  let payload;
  try{payload=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(match[1].replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0))));}
  catch{throw new Error("Invitation d’essai illisible.");}
  return validatePayload(payload);
}
export function validateManifest(m){
  if(!m||m.format!==1||!["A","B"].includes(m.label)||m.protocol!=="DEMO-"+m.label||
     !Array.isArray(m.files)||m.files.length!==2)throw new Error("Publication d’essai invalide.");
  if(m.api!==PUBLICATION_API)throw new Error("Cette version de démonstration utilise un dialogue non pris en charge par le lanceur. La sortie active n’est pas remplacée.");
  const names=new Set();
  for(const f of m.files){
    if(!["app.html","engine.js"].includes(f.path)||names.has(f.path)||!HEX.test(f.sha256))throw new Error("Fichiers de publication invalides.");
    names.add(f.path);
  }
  return m;
}
export function releaseCache(id){
  if(!HEX.test(id))throw new Error("Référence de publication invalide.");
  return "vhfgps-prototype-release-"+id;
}

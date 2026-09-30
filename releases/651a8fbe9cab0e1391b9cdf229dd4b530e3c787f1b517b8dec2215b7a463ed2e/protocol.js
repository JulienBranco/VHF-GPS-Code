export const API=2;
const HEX=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
export const BEGIN="----- DEBUT INVITATION SORTIE VHF-GPS -----",END="----- FIN INVITATION SORTIE VHF-GPS -----";
export const SUMMARY="----- RESUME SORTIE VHF-GPS -----";
const INNER_BEGIN="----- DEBUT INVITATION VHF-GPS -----",INNER_END="----- FIN INVITATION VHF-GPS -----";
export async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",typeof value==="string"?new TextEncoder().encode(value):value)),n=>n.toString(16).padStart(2,"0")).join("");}
export function randomId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("");}
export function releaseCache(id){if(!HEX.test(id))throw Error("Publication invalide.");return "vhfgps-main-release-"+id;}
export function manifestCheck(m){
 if(!m||m.format!==2||m.api!==API||typeof m.version!=="string"||typeof m.protocol!=="string"||!Array.isArray(m.files)||!m.files.length)throw Error("Publication non prise en charge.");
 const paths=new Set();
 for(const f of m.files){if(!f||typeof f.path!=="string"||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+$/.test(f.path)||paths.has(f.path)||!HEX.test(f.sha256))throw Error("Liste de fichiers invalide.");paths.add(f.path);}
 for(const name of ["app.html","runtime.js","engine.js","app-adapter.js"])if(!paths.has(name))throw Error("Publication incomplète.");
 return m;
}
export function envelopeCheck(p){
 if(!p||p.format!==2||p.api!==API||!ID.test(p.id)||!HEX.test(p.release)||typeof p.content!=="string"||p.content.length>16000)throw Error("Invitation invalide.");return p;
}
export function splitContent(content){
 const parts=content.split(INNER_BEGIN);
 if(parts.length!==2||parts[1].split(INNER_END).length!==2)throw Error("Invitation intérieure invalide.");
 const code=parts[1].split(INNER_END)[0].replace(/\s/g,"");
 if(!/^VHF1\.[A-Za-z0-9_-]+\.[a-f0-9]+$/i.test(code))throw Error("Code de sortie invalide.");
 return {summary:parts[0].trim(),code};
}
export function joinContent(summary,code){return summary+"\n\n"+INNER_BEGIN+"\n"+code+"\n"+INNER_END;}
export async function wrap(p){
 envelopeCheck(p);const {summary,code}=splitContent(p.content);
 // Le résumé est présent une seule fois, en clair. Le contrôle lie résumé et code.
 const bytes=new TextEncoder().encode(JSON.stringify({format:2,api:API,id:p.id,release:p.release,code}));
 const encoded=btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
 const token="VHF-SORTIE2."+encoded;
 return SUMMARY+"\n"+summary+"\n\n"+BEGIN+"\n"+token+"."+await hash(token+"\n"+summary)+"\n"+END;
}
export async function unwrap(text){
 if(typeof text!=="string"||text.length>24000)throw Error("Message trop long.");
 const parts=text.split(BEGIN);
 if(parts.length!==2||parts[1].split(END).length!==2||parts[0].split(SUMMARY).length!==2)throw Error("Colle une nouvelle invitation VHF GPS complète.");
 const summary=parts[0].split(SUMMARY)[1].trim(),token=parts[1].split(END)[0].replace(/\s/g,""),match=token.match(/^VHF-SORTIE2\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/);
 if(!match||summary.length>5000||await hash("VHF-SORTIE2."+match[1]+"\n"+summary)!==match[2])throw Error("Invitation incomplète ou modifiée.");
 try{
  const p=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob(match[1].replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0))));
  if(typeof p.code!=="string"||p.code.length>12000)throw Error("Code invalide");
  const content=joinContent(summary,p.code);splitContent(content);
  return envelopeCheck({format:p.format,api:p.api,id:p.id,release:p.release,content});
 }catch{throw Error("Invitation illisible ou incompatible.");}
}
export function stateCheck(state){
 if(!state||typeof state!=="object"||Array.isArray(state)||JSON.stringify(state).length>500000)throw Error("Données locales invalides.");
 for(const [key,value] of Object.entries(state))if(!key.startsWith("vhfGps")||typeof value!=="string")throw Error("Clé de stockage inattendue.");return state;
}

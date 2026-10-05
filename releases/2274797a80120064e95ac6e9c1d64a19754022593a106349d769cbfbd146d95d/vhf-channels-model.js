// Module facultatif, indépendant du codage et des confirmations de position.
export const CHANNELS=Object.freeze([6,8,72,77]);
export const CHANNEL_MAPPING_VERSION="VHF-CHANNELS-V1";
// Catalogue existant figé pour V1 : un changement doit être explicite, jamais silencieux.
export const CATALOG_SHA256="bb73f8fb096670ce85e7a227df7637b2f899957c64ec6a9eb188a6b900967415";
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
export async function channelTable(secret,words){
  if(typeof secret!=="string"||!secret.trim()||secret!==secret.normalize("NFC"))throw Error("Session radio indisponible.");
  if(!Array.isArray(words)||words.length!==1024||new Set(words).size!==words.length)throw Error("Catalogue de canaux incompatible.");
  const catalogue=await crypto.subtle.digest("SHA-256",encoder.encode(JSON.stringify(words)));
  if(hex(catalogue)!==CATALOG_SHA256)throw Error("Catalogue de canaux incompatible avec la version V1.");
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  // Écarter les quelques entrées composées de plusieurs mots.
  const available=words.filter(word=>! /\s/u.test(word)),rows=[];
  for(const channel of CHANNELS){
    const digest=await crypto.subtle.sign("HMAC",key,encoder.encode(`${CHANNEL_MAPPING_VERSION}|${CATALOG_SHA256}|CHANNEL|${channel}`));
    // Ordre des octets explicite, aucun tri dépendant de la langue du téléphone.
    const number=new DataView(digest).getUint32(0,false);
    const [word]=available.splice(number%available.length,1);
    rows.push({channel,word});
  }
  return rows;
}

import {stateCheck,envelopeCheck,sameInvitationContent} from "./protocol.js";
export function openStore(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open("vhfgps-main-v1",1);
 req.onupgradeneeded=()=>req.result.createObjectStore("state");
 req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result);};
 req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error("Ferme les autres fenêtres de l’application."));
});}
export function read(db,key){return new Promise((resolve,reject)=>{const r=db.transaction("state").objectStore("state").get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function deleteOtherOutings(store,keep=null){
 const request=store.openKeyCursor();
 request.onsuccess=()=>{
  const cursor=request.result;if(!cursor)return;
  try{
   if(typeof cursor.key==="string"&&cursor.key.startsWith("outing:")&&cursor.key!==keep)store.delete(cursor.primaryKey);
   cursor.continue();
  }catch{try{store.transaction.abort();}catch{}}
 };
}
// Nettoyage des archives créées par les anciennes versions, sans modifier la sortie active.
export function retainActiveOuting(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("state","readwrite"),store=tx.objectStore("state"),request=store.get("active");
  request.onsuccess=()=>{const active=request.result;deleteOtherOutings(store,active&&!active.deleted&&active.envelope?.id?"outing:"+active.envelope.id:null);};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||Error("Nettoyage des anciennes sorties impossible."));
 });
}
export function writeActive(db,record,expected,{install=false}={}){
 stateCheck(record.state);envelopeCheck(record.envelope);
 return new Promise((resolve,reject)=>{
  const tx=db.transaction("state","readwrite"),store=tx.objectStore("state");let error,result;
  const fail=message=>{error=Error(message);tx.abort();};
  const get=store.get("active");
  get.onsuccess=()=>{
   if((get.result?.revision||0)!==expected){fail("La sortie a changé dans une autre fenêtre. Rouvre cette application.");return;}
   if(!install&&get.result?.envelope.id!==record.envelope.id){fail("Cette sortie n’est plus active.");return;}
   const known=store.get("outing:"+record.envelope.id);
   known.onsuccess=()=>{
    if(known.result&&(known.result.envelope.release!==record.envelope.release||!sameInvitationContent(known.result.envelope.content,record.envelope.content))){
     fail("Cet identifiant correspond déjà à une autre invitation.");return;
    }
    result={...record,revision:expected+1};
    // Sauvegarde et suppression partagent la transaction : un échec restaure l'ancienne sortie.
    try{store.put(result,"outing:"+record.envelope.id);store.put(result,"active");deleteOtherOutings(store,"outing:"+record.envelope.id);}
    catch(cause){error=cause;try{tx.abort();}catch{}}
   };
  };
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error("Enregistrement impossible. La sortie précédente est conservée."));
 });
}

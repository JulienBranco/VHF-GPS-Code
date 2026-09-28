const NAME="vhfgps-distribution-prototype-v1";
export function openStore(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(NAME,1);
    request.onupgradeneeded=()=>request.result.createObjectStore("state");
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();resolve(db);};
    request.onerror=()=>reject(new Error("Le stockage du prototype est indisponible."));
    request.onblocked=()=>reject(new Error("Une autre fenêtre du prototype bloque son stockage."));
  });
}
export function read(db,key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("state"),request=tx.objectStore("state").get(key);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export function saveScenario(db,value){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("state","readwrite");
    tx.objectStore("state").put(value,"scenario");
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error("Réglage non enregistré."));
  });
}
// La référence active et la configuration complète changent dans la même transaction.
export function commit(db,record,expectedRevision){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("state","readwrite"),store=tx.objectStore("state");
    let reason;
    const request=store.get("active");
    request.onsuccess=()=>{
      const current=request.result;
      if((current?.revision||0)!==expectedRevision){
        reason=new Error("La sortie a changé dans une autre fenêtre. Recommence la préparation.");tx.abort();return;
      }
      const known=store.get("outing:"+record.payload.id);
      known.onsuccess=()=>{
        if(known.result&&known.result.invitation!==record.invitation){
          reason=new Error("Cet identifiant de sortie désigne déjà une autre invitation.");tx.abort();return;
        }
        store.put(record,"outing:"+record.payload.id);
        store.put({...record,revision:expectedRevision+1},"active");
      };
    };
    tx.oncomplete=()=>resolve({...record,revision:expectedRevision+1});
    tx.onabort=()=>reject(reason||tx.error||new Error("L’installation n’a pas été enregistrée. La sortie précédente est conservée."));
    tx.onerror=()=>{};
  });
}

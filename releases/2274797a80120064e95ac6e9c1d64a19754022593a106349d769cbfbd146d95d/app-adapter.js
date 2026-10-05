// Pont explicite entre l’interface et la distribution. Aucun remplacement de fonctions au démarrage.
let preparedInvitation="",preparingOuting=false;
// Le secret et le cache restent dans le pont : l'affichage ne reçoit que les quatre lignes.
window.getVhfChannelTable=(()=>{
 let cachedSecret="",pending=null;
 return async()=>{
  const value=validateOperationalSessionSecret(activeSecret());
  if(!value.ok){cachedSecret="";pending=null;return null;}
  const secret=value.canonical;
  if(secret!==cachedSecret||!pending){
   cachedSecret=secret;
   pending=import("./vhf-channels-model.js").then(({channelTable})=>channelTable(secret,FINGERPRINT_WORDS.slice()));
  }
  const calculation=pending;
  try{
   const rows=await calculation;
   if(activeSecret()!==secret)return null;
   return rows.map(({channel,word})=>({channel,word}));
  }catch(error){if(pending===calculation)pending=null;throw error;}
 };
})();
// Le module de suivi ne reçoit ni secret ni état du protocole.
window.confirmedTrackingPoint=()=>relativePositionReady() && protocolRuntimeState===PROTOCOL_STATE.OK
  ? {lat:currentDecodedResult.lat,lon:currentDecodedResult.lon,identity:decodeRevision}
  : null;
async function formatOutingInvitation(payload){
 const content=preparedInvitation||await formatRawOutingInvitation(payload);
 return window.VHFIntegration.share(content);
}
async function persistPreparedOuting(){
 const payload=await activeOutingPayload();
 const content=preparedInvitation||await formatRawOutingInvitation(payload);
 await window.VHFIntegration.activate(content);
 preparedInvitation=content;preparingOuting=false;
 setPwaStatus("✓ APPLICATION PRÊTE HORS RÉSEAU","ready");
}
window.startDistributedApp=async config=>{
 preparedInvitation=config.content||"";
 await Promise.all([appSessionReady,appRuntimeReady,appCompatReady]);
 assertProtocolReady();
 const compat=await protocolCompatDigestHex();
 if(config.mode==="resume"&&!validateOperationalSessionSecret(activeSecret()).ok)throw Error("La session mémorisée ne peut pas être restaurée. Réimporte son invitation.");
 $("backHomeBtn").onclick=()=>window.VHFIntegration.navigate("menu");
 preparingOuting=config.mode!=="resume";
 const cancel=()=>{if(preparingOuting&&!outingMutationBusy)window.VHFIntegration.cancel(config.mode==="import"?"menu":"resume");};
 $("outingCreateDialog").addEventListener("close",cancel);
 $("outingImportDialog").addEventListener("close",cancel);
 if(config.mode==="create")openOutingSetup();
 if(config.mode==="import"){
  $("outingImportDialog").showModal();
  await prepareOutingImport(config.content);
  if(!pendingOutingImport)throw Error($("outingImportDialogError").textContent||"Invitation refusée par le moteur.");
 }
 setPwaStatus(config.mode==="resume"?"✓ APPLICATION PRÊTE HORS RÉSEAU":"Sortie en préparation — activation à confirmer",config.mode==="resume"?"ready":"pending");
 return {version:APP_VERSION,protocol:PROTOCOL_ID,compat};
};

// Pont explicite entre l’interface et la distribution. Aucun remplacement de fonctions au démarrage.
let preparedInvitation="",preparingOuting=false;
// La carte reçoit uniquement les zones publiques du catalogue et leurs limites moteur.
window.getCatalogMapZones=()=>BUILTIN_ZONES.map(zone=>{
 const center={...zone,lat:canonicalCoord(zone.lat),lon:canonicalCoord(zone.lon)};
 return {id:center.id,name:center.name,region:center.region,lat:center.lat,lon:center.lon,bounds:zoneBounds(center)};
});
// Consultation locale : les centres virtuels sont déjà visibles dans l'application.
// Aucun secret ni point d'ancrage n'est transmis au module cartographique.
window.getApplicationMapState=()=>({
 activeId:activeZoneId,sessionRevision:activeSessionRevision,
 zones:zones.map(zone=>{
  const center={...zone,lat:canonicalCoord(zone.lat),lon:canonicalCoord(zone.lon)};
  return {id:center.id,name:center.name,region:center.region||"",type:center.builtin?"builtin":isAnchoredZone(center)?"ephemeral":"custom",lat:center.lat,lon:center.lon,bounds:zoneBounds(center),compass:zoneBoundsCompass(center)};
 })
});
window.activateMapZone=async(id,context)=>{
 if(context.sessionRevision!==activeSessionRevision||context.activeId!==activeZoneId)throw new Error("La sortie ou la zone active a changé. Rouvrez la carte pour choisir votre zone.");
 return switchToExistingZone(id,{clearPosition:true});
};
// Aperçu local du brouillon éphémère vérifié : uniquement le centre et ses limites.
window.getPreparedEphemeralMapZone=()=>{
 const draft=pendingOutingCreation;
 if(!draft?.position||draft.revision!==outingSetupRevision||draft.sessionRevision!==activeSessionRevision||draft.zoneId!==activeZoneId||!$("outingCreateDialog").open)return null;
 const center={...draft.candidate,lat:canonicalCoord(draft.candidate.lat),lon:canonicalCoord(draft.candidate.lon)};
 return {id:center.id,name:center.name,lat:center.lat,lon:center.lon,bounds:zoneBounds(center)};
};
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

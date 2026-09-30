// Pont explicite entre l’interface et la distribution. Aucun remplacement de fonctions au démarrage.
let preparedInvitation="",preparingOuting=false;
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

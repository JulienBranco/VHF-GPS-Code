// Pont explicite entre l’interface et la distribution. Aucun remplacement de fonctions au démarrage.
let preparedInvitation="",preparingOuting=false;
async function formatOutingInvitation(payload){
 const content=preparedInvitation||await formatRawOutingInvitation(payload);
 return window.VHFIntegration.share(content);
}
async function inspectOutingImportText(text){
 const content=await window.VHFIntegration.importContent(text);
 return inspectOutingInvitation(content);
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
 $("sessionKey").readOnly=true;$("generateSecret").disabled=true;
 $("sessionPasteHelp").textContent="Prépare ou importe une sortie complète pour changer de session.";
 $("sessionSettings").querySelector(".small").textContent="Réglages du secret en lecture seule dans cette application.";
 $("sessionSettings").open=false;
 $("backHomeBtn").onclick=()=>window.VHFIntegration.navigate("menu");
 preparingOuting=config.mode!=="resume";
 const cancel=()=>{if(preparingOuting&&!outingMutationBusy)window.VHFIntegration.cancel();};
 $("outingCreateDialog").addEventListener("close",cancel);
 $("outingImportDialog").addEventListener("close",cancel);
 if(config.mode==="create")openOutingSetup();
 if(config.mode==="import"){
  await inspectOutingInvitation(config.content);
  $("outingImportText").value=await window.VHFIntegration.share(config.content);
  invalidateOutingImportReview();$("outingImportDialog").showModal();
  await $("checkOutingBtn").onclick();
  if(!pendingOutingImport)throw Error($("outingImportDialogError").textContent||"Invitation refusée par le moteur.");
 }
 setPwaStatus(config.mode==="resume"?"✓ APPLICATION PRÊTE HORS RÉSEAU":"Sortie en préparation — activation à confirmer",config.mode==="resume"?"ready":"pending");
 return {version:APP_VERSION,protocol:PROTOCOL_ID,compat};
};

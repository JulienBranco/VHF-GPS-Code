const {waitAsync}=require("./wait-async.cjs");
"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {createServer}=require("../tools/server.cjs");
const {chromium,browserOptions}=require("../tools/test-browser.cjs");
let browser,host,url,sourceFiles;const contexts=[];
test.before(async()=>{browser=await chromium.launch(browserOptions());
 host=await createServer();url=host.url;
 // Tester les sources actuelles avec une publication virtuelle, sans écrire de release.
 sourceFiles=new Map([...require("../tools/build.cjs").prepareBuild().output].map(([name,bytes])=>["/"+name,bytes]));});
test.beforeEach(()=>{host.state.fail=null;host.state.corrupt=null;host.state.delay=0;host.state.virtual=new Map(sourceFiles);});
test.after(async()=>{for(const ctx of contexts)await ctx.close().catch(()=>{});await browser?.close();if(host)await new Promise(resolve=>host.server.close(resolve));});
async function phone(options={}){
 const context=await browser.newContext(options);contexts.push(context);
 const page=await context.newPage();page.on("pageerror",error=>console.log("Erreur navigateur :",error.message));
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 return {context,page};
}
function frame(page){return page;}
function actualFrame(page){return page;}
async function active(page){return page.evaluate(async()=>{const s=await import("/storage.js");return s.read(await s.openStore(),"active");});}
async function resume(page){
 await page.locator("#resume").waitFor({state:"visible"});await page.waitForFunction(()=>!document.getElementById("resume").disabled);await page.locator("#resume").click();
 await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
}
async function openHome(page){
 if(new URL(page.url()).pathname.includes("/releases/"))await page.locator("#backHomeBtn").click();
 await page.waitForFunction(()=>!!document.getElementById("create")&&!document.getElementById("create").disabled);

}
async function openNew(page){await openHome(page);await page.locator("#create").click();}
async function openReceive(page){
 await openHome(page);await page.locator("#receive").click();
 await page.locator("#invitation").waitFor({state:"visible"});
}
async function create(page,{ephemeral=false}={}){
 await openNew(page);
 await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Confirme la sortie"));
 const app=frame(page);await app.locator("#outingCreateDialog").waitFor({state:"visible"});
 if(ephemeral){
  await app.locator("#outingEphemeralChoice").click();await app.locator("#outingDecimalMode").click();
  await app.locator("#outingLat").fill("46.2");await app.locator("#outingLon").fill("-2.4");
 }else await app.locator("#outingBuiltinSelect").selectOption("iroise-brest");
 await app.locator("#checkOutingCreate").click();await app.locator("#confirmOutingCreate").waitFor({state:"visible"});
 await app.locator("#confirmOutingCreate").click();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie enregistrée"));
 await app.locator("#closeOutingSuccess").click();
 return active(page);
}
async function share(page){
 if(!new URL(page.url()).pathname.includes("/releases/"))await resume(page);
 await page.locator("#shareOutingBtn").waitFor({state:"visible"});await page.locator("#shareOutingBtn").click();
 const app=frame(page);
 await app.locator("#copyOutingMessageBtn").waitFor({state:"visible"});
 await app.locator("#copyOutingMessageBtn").isEnabled();
 await page.waitForFunction(()=>document.getElementById("outingShareText").value.includes("VHF-SORTIE2."));
 return app.locator("#outingShareText").inputValue();
}
async function importOuting(page,text){
 await openReceive(page);await page.locator("#invitation").fill(text);
 await page.locator("#receiveForm button[type=submit]").click();
 await frame(page).locator("#confirmOutingImport").waitFor({state:"visible"});
 await frame(page).locator("#confirmOutingImport").click();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie enregistrée"));
 await frame(page).locator("#closeOutingSuccess").click();
 return active(page);
}
async function aliases(page){return actualFrame(page).evaluate(()=>({session:document.getElementById("fingerprintWords").textContent,zone:document.getElementById("sendZoneAlias").textContent,secret:activeSecret(),zoneData:{...activeZone()},compat:document.getElementById("compatFull").textContent}));}
async function encode(page){
 const app=frame(page),center=await actualFrame(page).evaluate(()=>({lat:activeZone().lat,lon:activeZone().lon}));
 await app.locator("#positionModeDecimal").click();await app.locator("#lat").fill(center.lat.toFixed(6));await app.locator("#lon").fill(center.lon.toFixed(6));
 await app.locator("#encodeBtn").click();await app.locator("#encodedBlock").waitFor({state:"visible"});
 const phrase=(await app.locator("#encodedWords").innerText()).trim().split(/\s+/);
 assert.equal(phrase.length,5);
 return {words:[phrase[0],phrase[1],phrase[3],phrase[4]],connector:phrase[2],ack:await app.locator("#senderExpectedAckWord").innerText(),final:await app.locator("#senderFinalConfirmWord").innerText(),center};
}
async function decode(page,message){
 const app=frame(page);await app.locator("#tabReceive").click();
 for(let i=0;i<4;i++){
  const input=app.locator('#wordGrid input[data-i="'+i+'"]');
  await input.fill(message.words[i].slice(0,3));
  await app.locator(".wordbox").nth(i).locator(".suggestions button").filter({hasText:message.words[i]}).first().click();
 }
 await app.locator("#wordGrid .linkbox button").filter({hasText:new RegExp("^"+message.connector+"$")}).click();
 await app.locator("#finalConfirmChoices button").first().waitFor({state:"visible"});
 assert.equal(await app.locator("#receiverAckWord").innerText(),message.ack);
 assert.equal(await app.locator("#decodedCoordsWrap").isVisible(),false);
 await app.locator("#finalConfirmChoices button").filter({hasText:new RegExp("^"+message.final+"$")}).click();
 await app.locator("#decodedCoordsWrap").waitFor({state:"visible"});
 assert(await app.locator("#decodedBlock").evaluate(el=>el.classList.contains("position-confirmed")));
 return actualFrame(page).evaluate(()=>({lat:currentDecodedResult.lat,lon:currentDecodedResult.lon}));
}
test("échange réel complet entre deux appareils, alias et COMPAT identiques, coordonnées confirmées",async()=>{
 const sender=await phone();await create(sender.page);const invitation=await share(sender.page);
 assert.match(invitation,/VHF-SORTIE2\./);assert.match(invitation,/Alias de session/);assert.match(invitation,/Alias de zone/);
 assert.equal((invitation.match(/Alias de session/g)||[]).length,1);
 const originalText=(await active(sender.page)).envelope.content;
 assert(invitation.length<originalText.length*1.9);
 console.log("Invitation :",originalText.length,"→",invitation.length,"caractères");
 assert.equal(await sender.page.locator("iframe").count(),0);
 assert.equal(await sender.page.locator("#create").count(),0);
 await frame(sender.page).locator("#closeOutingShare").click();
 const receiver=await phone({timezoneId:"Pacific/Honolulu"});await importOuting(receiver.page,invitation);
 const first=await aliases(sender.page),second=await aliases(receiver.page);
 assert.equal(first.session,second.session);assert.equal(first.zone,second.zone);assert.equal(first.secret,second.secret);
 assert.equal(first.zoneData.lat,second.zoneData.lat);assert.equal(first.zoneData.lon,second.zoneData.lon);
 assert.equal(first.compat,"4043F648E26823B18361AAC243BC490C70FDC8401484759322464B8C29B16B81");assert.equal(second.compat,first.compat);
 const message=await encode(sender.page),position=await decode(receiver.page,message);
 assert(Math.abs(position.lat-message.center.lat)<.002);assert(Math.abs(position.lon-message.center.lon)<.002);
 assert.equal(await share(receiver.page),invitation);
});
test("moteur PROTO 6 : encodage et décodage dans chaque zone intégrée",async()=>{
 const {page}=await phone();await create(page);
 const results=await page.evaluate(async()=>{
  const secret=activeSecret(),rows=[];
  for(const zone of BUILTIN_ZONES){
   for(const [dLat,dLon] of [[0,0],[0.08,-0.08]]){
    const lat=zone.lat+dLat,lon=zone.lon+dLon;
    const encoded=await encodeCore(lat,lon,secret,zone);
    const decoded=await decodeCore(encoded.phrase.words,encoded.phrase.connector,secret,zone);
    rows.push({zone:zone.name,error:haversineM(lat,lon,decoded.lat,decoded.lon),ack:decoded.ack===encoded.ack,final:decoded.finalConfirm===encoded.finalConfirm,nacks:JSON.stringify(decoded.nacks)===JSON.stringify(encoded.nacks)});
   }
  }
  return rows;
 });
 assert(results.length>=2);for(const row of results){assert(row.error<75,row.zone+" : écart "+row.error+" m");assert(row.ack&&row.final&&row.nacks,row.zone);}
});

test("localStorage officiel préservé : création, changement de thème et import sans réglage manuel de session",async()=>{
 const {page}=await phone();
 const sentinel={vhfGpsSessionSecretV312:"SECRET-OFFICIEL-NE-PAS-TOUCHER",vhfGpsZonesV4Custom:'[{"id":"officiel"}]',vhfGpsThemeV1:"officiel"};
 await page.evaluate(values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);},sentinel);
 await create(page);await frame(page).locator("#themeMode").selectOption("night");
 await waitAsync(page,async()=>{const s=await import("/storage.js");const record=await s.read(await s.openStore(),"active");return Object.values(record.state).includes("night");});
 const text=await share(page);await frame(page).locator("#closeOutingShare").click();
 await importOuting(page,text);
 assert.equal(await frame(page).locator("#sessionSettings, #sessionKey, #generateSecret, #copySecret").count(),0);
 const official=await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.keys(sentinel));
 assert.deepEqual(official,sentinel);
 const registrations=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).map(r=>r.scope));
 assert.deepEqual(registrations,[url]);
});
test("zone éphémère : centre et alias recalculés identiquement sur le destinataire",async()=>{
 const first=await phone();await create(first.page,{ephemeral:true});const invitation=await share(first.page);
 const second=await phone();await importOuting(second.page,invitation);
 const a=await aliases(first.page),b=await aliases(second.page);
 assert(a.zoneData.ephemeral);assert(b.zoneData.ephemeral);
 assert.equal(a.zoneData.lat,b.zoneData.lat);assert.equal(a.zoneData.lon,b.zoneData.lon);assert.equal(a.session,b.session);assert.equal(a.zone,b.zone);
 await frame(first.page).locator("#closeOutingShare").click();
 const message=await encode(first.page);await decode(second.page,message);
});
test("sortie réelle retrouvée après fermeture complète et réouverture hors connexion",async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-real-profile-"));
 let context=await chromium.launchPersistentContext(profile,browserOptions());
 try{
  let page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
  await create(page,{ephemeral:true});const before=await aliases(page);
  await context.close();context=await chromium.launchPersistentContext(profile,browserOptions());
  await context.setOffline(true);page=await context.newPage();await page.goto(url);await resume(page);
  await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
  const after=await aliases(page);
  assert.equal(after.secret,before.secret);assert.equal(after.session,before.session);
  assert.equal(after.zoneData.lat,before.zoneData.lat);assert.equal(after.zoneData.lon,before.zoneData.lon);
  await encode(page);
 }finally{
  await context.close();const target=fs.realpathSync(profile);
  if(path.dirname(target)!==fs.realpathSync(os.tmpdir())||!path.basename(target).startsWith("vhfgps-real-profile-"))throw Error("Profil hors périmètre");
  fs.rmSync(target,{recursive:true,force:true});
 }
});
test("création hors ligne et annulation : sortie précédente conservée",async()=>{
 const {page,context}=await phone();await create(page);const before=await active(page);
 await context.setOffline(true);await openNew(page);
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).dataset.kind==="error"&&!document.getElementById("create").disabled);
 assert.equal((await active(page)).envelope.id,before.envelope.id);
 await context.setOffline(false);await openNew(page);
 await frame(page).locator("#cancelOutingCreate").waitFor({state:"visible"});await frame(page).locator("#cancelOutingCreate").click();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
 assert.equal((await active(page)).envelope.id,before.envelope.id);await encode(page);
});
test("cache manquant : aucun remplacement silencieux ; invitation connue répare en ligne",async()=>{
 const {page,context}=await phone();const record=await create(page),invitation=await share(page);
 await page.evaluate(async release=>{const cache=await caches.open("vhfgps-main-release-"+release);await cache.delete(new URL("/releases/"+release+"/engine.js",location.origin));},record.release);
 await context.setOffline(true);await page.reload();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).dataset.kind==="error");
 assert.equal(await page.locator("iframe").count(),0);assert.equal((await active(page)).envelope.id,record.envelope.id);
 await context.setOffline(false);await importOuting(page,invitation);assert.equal((await active(page)).envelope.id,record.envelope.id);
});
test("GPS avec permission Chromium, presse-papiers réel et partage natif simulé",async()=>{
 const {page,context}=await phone({geolocation:{latitude:48.3,longitude:-5},permissions:["geolocation","clipboard-read","clipboard-write"]});
 await create(page);
 await frame(page).locator("#gpsBtn").click();
 await page.waitForFunction(()=>readActivePosition().ok);
 const p=await actualFrame(page).evaluate(()=>readActivePosition());assert(Math.abs(p.lat-48.3)<.00001);
 await share(page);await frame(page).locator("#copyOutingMessageBtn").click();
 assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/VHF-SORTIE2\./);
 await actualFrame(page).evaluate(()=>{
  Object.defineProperty(navigator,"share",{configurable:true,value:async data=>{window.integrationSharedText=data.text;}});
  Object.defineProperty(navigator,"canShare",{configurable:true,value:()=>true});refreshOutingShareControls();
 });
 await frame(page).locator("#nativeShareOutingBtn").click();
 assert.match(await actualFrame(page).evaluate(()=>window.integrationSharedText),/VHF-SORTIE2\./);
});
test("mobile 390 px : modales, saisie et résultat sans débordement",async()=>{
 const {page}=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await create(page,{ephemeral:true});await encode(page);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await actualFrame(page).evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dir=path.join(os.tmpdir(),"vhfgps-real-tests");fs.mkdirSync(dir,{recursive:true});
 await page.screenshot({path:path.join(dir,"emission-mobile.png"),fullPage:true});
 console.log("Capture :",path.join(dir,"emission-mobile.png"));
});

test("enregistrement interrompu : ancienne sortie intacte, nouvelle tentative possible après annulation",async()=>{
 const {page}=await phone();const before=await create(page),oldAliases=await aliases(page);
 await openNew(page);
 await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 await page.evaluate(()=>{
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){
   const result=original.call(this,value,key);
   if(key==="active"&&window.integrationAbortOnce){window.integrationAbortOnce=false;this.transaction.abort();}
   return result;
  };
  window.integrationAbortOnce=true;
 });
 await frame(page).locator("#outingBuiltinSelect").selectOption("iroise-brest");
 await frame(page).locator("#checkOutingCreate").waitFor({state:"visible"});await frame(page).locator("#checkOutingCreate").click();
 await frame(page).locator("#confirmOutingCreate").waitFor({state:"visible"});await frame(page).locator("#confirmOutingCreate").click();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).dataset.kind==="error");
 assert.deepEqual(await active(page),before);
 await page.locator("#cancelOutingCreate").click();
 await page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
 assert.equal((await aliases(page)).secret,oldAliases.secret);
 const after=await create(page);assert.notEqual(after.envelope.id,before.envelope.id);
});
test("deux fenêtres : une préparation devenue obsolète ne remplace pas la sortie acceptée",async()=>{
 const {page,context}=await phone();await create(page);
 const second=await context.newPage();await second.goto(url);await resume(second);
 await openNew(second);
 await frame(second).locator("#outingBuiltinSelect").selectOption("iroise-brest");
 await frame(second).locator("#checkOutingCreate").waitFor({state:"visible"});await frame(second).locator("#checkOutingCreate").click();
 await frame(second).locator("#confirmOutingCreate").waitFor({state:"visible"});
 const accepted=await create(page);
 await frame(second).locator("#confirmOutingCreate").click();
 await second.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).dataset.kind==="error");
 assert.equal((await active(second)).envelope.id,accepted.envelope.id);
 await second.reload();await second.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
 assert.equal((await aliases(second)).secret,(await aliases(page)).secret);
});
test("contenu modifié avec une enveloppe recalculée : le vrai moteur refuse, la sortie actuelle reste active",async()=>{
 const {page}=await phone();const before=await create(page),original=await aliases(page);
 const invitation=await share(page);await frame(page).locator("#closeOutingShare").click();
 const modified=await page.evaluate(async text=>{
  const protocol=await import("/protocol.js"),payload=await protocol.unwrap(text);
  payload.id=protocol.randomId();
  // Altérer le code intérieur sans son contrôle d'intégrité.
  payload.content=payload.content.replace("VHF1.","VHF1.A");
  return protocol.wrap(payload);
 },invitation);
 await openReceive(page);await page.locator("#invitation").fill(modified);
 await page.locator("#receiveForm button[type=submit]").click();
 await page.waitForFunction(()=>document.getElementById("importError").textContent.length>0);
 assert.equal((await active(page)).envelope.id,before.envelope.id);
 await page.locator("#resume").click();
 await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
 assert.equal((await aliases(page)).secret,original.secret);
});

test("nouvelle publication réelle disponible : les imports et la réouverture gardent les fichiers de la sortie d'origine",async()=>{
 const {createHash}=require("node:crypto"),digest=value=>createHash("sha256").update(value).digest("hex");
 const first=await phone();const original=await create(first.page),invitation=await share(first.page);
 const root=path.resolve(__dirname,".."),newFiles=new Map();
 const manifest=JSON.parse(JSON.stringify(original.manifest));
 for(const file of manifest.files){
  let bytes=host.state.virtual.get("/releases/"+original.release+"/"+file.path)||fs.readFileSync(path.join(root,"releases",original.release,file.path));
  if(file.path==="app.html")bytes=Buffer.from(bytes.toString().replace("<body>","<body data-integration-fixture=new>"));
  file.sha256=digest(bytes);newFiles.set(file.path,bytes);
 }
 const raw=JSON.stringify(manifest),release=digest(raw);
 assert.notEqual(release,original.release);
 const prefix="/releases/"+release+"/";
 host.state.virtual.set(prefix+"manifest.json",Buffer.from(raw));
 for(const [name,bytes] of newFiles)host.state.virtual.set(prefix+name,bytes);
 host.state.virtual.set("/latest.json",Buffer.from(JSON.stringify({format:2,release})));
 await first.page.locator("#closeOutingShare").click();assert.equal(await share(first.page),invitation);assert.equal((await active(first.page)).release,original.release);
 const receiver=await phone();await importOuting(receiver.page,invitation);
 assert.equal((await active(receiver.page)).release,original.release);
 assert.equal(await frame(receiver.page).locator("body").getAttribute("data-integration-fixture"),null);
 await receiver.context.setOffline(true);await receiver.page.reload();
 await receiver.page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
 assert.equal((await active(receiver.page)).release,original.release);
 await first.page.goto(url);await first.page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(new URL(first.page.url()).pathname,"/");assert.equal((await active(first.page)).release,original.release);
 await create(first.page);assert.equal((await active(first.page)).release,release);
 const next=await phone();await create(next.page);
 assert.equal((await active(next.page)).release,release);
 assert.equal(await frame(next.page).locator("body").getAttribute("data-integration-fixture"),"new");
 await next.context.setOffline(true);await next.page.reload();
 await next.page.waitForFunction(()=>(document.getElementById("testBanner")||document.getElementById("status")).textContent.includes("Sortie retrouvée"));
 assert.equal(await frame(next.page).locator("body").getAttribute("data-integration-fixture"),"new");
});
test("résumé humain altéré dans le message partagé : refus avant installation",async()=>{
 const {page}=await phone();const before=await create(page),invitation=await share(page);
 await frame(page).locator("#closeOutingShare").click();
 await openReceive(page);await page.locator("#invitation").fill(invitation.replace("Alias de zone","Alias de la mauvaise zone"));
 await page.locator("#receiveForm button[type=submit]").click();
 await page.waitForFunction(()=>document.getElementById("importError").textContent.length>0);
 assert.equal((await active(page)).envelope.id,before.envelope.id);
});

async function changeZone(page){
 const id=await page.locator("#sendZone option").evaluateAll(options=>options.find(o=>!o.selected).value);
 await page.locator("#sendZone").selectOption(id);await page.locator("#confirmZoneSwitch").click();
 await page.waitForFunction(()=>!isZoneConfirmed(activeZone()));
 await page.evaluate(()=>window.VHFIntegration.commit());
}
test("confirmation radio affichée seulement après acquittement durable, conservée au rechargement",async()=>{
 const {page}=await phone();await create(page);await changeZone(page);
 await page.evaluate(()=>{
  const desc=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,"oncomplete");
  Object.defineProperty(IDBTransaction.prototype,"oncomplete",{...desc,set(callback){
   desc.set.call(this,function(event){if(this.mode==="readwrite"&&window.holdConfirmation){window.releaseConfirmation=()=>callback.call(this,event);}else callback.call(this,event);});
  }});window.holdConfirmation=true;
 });
 await page.locator("#sendZoneConfirmBtn").click();
 await page.waitForFunction(()=>typeof window.releaseConfirmation==="function");
 assert.equal(await page.evaluate(()=>isZoneConfirmed(activeZone())),false);
 assert.equal(await page.locator("#sendZoneConfirmBtn").evaluate(el=>el.classList.contains("zone-confirm-done")),false);
 await page.evaluate(()=>{window.holdConfirmation=false;window.releaseConfirmation();});
 await page.waitForFunction(()=>document.getElementById("sendZoneConfirmBtn").classList.contains("zone-confirm-done"));
 await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
 assert.equal(await page.evaluate(()=>isZoneConfirmed(activeZone())),true);
});
test("échec de sauvegarde d’une confirmation : pas d’état confirmé et reprise sans confirmation",async()=>{
 const {page}=await phone();await create(page);await changeZone(page);
 await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){const result=original.call(this,value,key);if(key==="active")this.transaction.abort();return result;};});
 await page.locator("#sendZoneConfirmBtn").click();
 await page.waitForFunction(()=>document.getElementById("testBanner").dataset.kind==="error");
 assert.equal(await page.evaluate(()=>isZoneConfirmed(activeZone())),false);
 assert.equal(await page.evaluate(()=>document.body.inert),true);
 await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
 assert.equal(await page.evaluate(()=>isZoneConfirmed(activeZone())),false);
});
test("nouveau lanceur activé automatiquement puis fermeture hors réseau : sortie et publications conservées",async()=>{
 const {createHash}=require("node:crypto"),digest=value=>createHash("sha256").update(value).digest("hex");
 const root=path.resolve(__dirname,".."),profile=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-real-profile-"));
 let ctx=await chromium.launchPersistentContext(profile,browserOptions());
 try{
  let page=await ctx.newPage();await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);const before=await create(page),identity=await aliases(page);
  const olderRelease="a".repeat(64);
  await page.evaluate(async id=>{const cache=await caches.open("vhfgps-main-release-"+id);await cache.put(new URL("/releases/"+id+"/manifest.json",location.origin),new Response("ancienne publication"));},olderRelease);
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator("#updateNotice").isVisible(),false);
  const boot=fs.readFileSync(path.join(root,"boot.js"),"utf8")+"\n// Second lanceur de test\n";
  const index=fs.readFileSync(path.join(root,"index.html"),"utf8").replace("<body>","<body data-shell-fixture=new>");
  let worker=host.state.virtual.get("/sw.js").toString();const match=worker.match(/ASSETS=(\[[^\n]+\]);/);const assets=JSON.parse(match[1]);
  for(const f of assets){if(f.path==="boot.js")f.sha256=digest(boot);if(f.path==="index.html")f.sha256=digest(index);}
  const serialized=JSON.stringify(assets);worker=worker.replace(match[1],serialized).replace(/(SHELL_BUILD=")[a-f0-9]{64}/,"$1"+digest(serialized));
  host.state.virtual.set("/boot.js",Buffer.from(boot));host.state.virtual.set("/index.html",Buffer.from(index));host.state.virtual.set("/sw.js",Buffer.from(worker));
  await page.evaluate(()=>window.dispatchEvent(new Event("online")));
  await page.waitForFunction(()=>document.body.dataset.shellFixture==="new"&&!document.getElementById("create").disabled);
  assert.equal(await page.locator("#updateNotice").isVisible(),false);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal((await active(page)).release,before.release);await resume(page);assert.equal((await aliases(page)).secret,identity.secret);
  await ctx.close();ctx=await chromium.launchPersistentContext(profile,browserOptions());await ctx.setOffline(true);page=await ctx.newPage();await page.goto(url);
  assert.equal(await page.locator("body").getAttribute("data-shell-fixture"),"new");
  assert.equal(await page.locator("#updateNotice").isVisible(),false);await resume(page);
  await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
  assert.equal((await active(page)).release,before.release);assert.equal((await aliases(page)).secret,identity.secret);await encode(page);
  assert.equal(await page.evaluate(async id=>{const cache=await caches.open("vhfgps-main-release-"+id);return (await cache.match(new URL("/releases/"+id+"/manifest.json",location.origin)))?.text();},olderRelease),"ancienne publication");
 }finally{
  await ctx.close();const target=fs.realpathSync(profile);if(path.dirname(target)!==fs.realpathSync(os.tmpdir())||!path.basename(target).startsWith("vhfgps-real-profile-"))throw Error("Profil hors périmètre");fs.rmSync(target,{recursive:true,force:true});
 }
});

test("rechargement forcé : démarrage sans controller, sans attendre un événement qui ne viendra pas",async()=>{
 const {page,context}=await phone();const cdp=await context.newCDPSession(page);
 await cdp.send("Page.enable");
 const loaded=page.waitForEvent("load");await cdp.send("Page.reload",{ignoreCache:true});await loaded;
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 await page.waitForFunction(()=>!document.getElementById("create").disabled,{},{timeout:5000});
 assert.equal(await page.locator("#status").innerText(),"");assert.equal(await page.locator("#receive").isEnabled(),true);
 await create(page);
});
test("ouverture file : une explication visible remplace Ouverture, sans dépendre des modules bloqués",async()=>{
 const context=await browser.newContext();contexts.push(context);const page=await context.newPage();
 const {pathToFileURL}=require("node:url");await page.goto(pathToFileURL(path.resolve(__dirname,"../index.html")).href);
 await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error",{},{timeout:2000});
 assert.match(await page.locator("#status").innerText(),/fichier|file:/i);
 assert.equal(await page.locator("#create").isEnabled(),false);
 assert.match(await page.locator("#localPreview").getAttribute("href"),/^http:\/\/127\.0\.0\.1:8082\/$/);
});

test("chargement lent : seul le chargement est visible jusqu’à la modale prête",async()=>{
 const {page,context}=await phone({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
  if(!location.pathname.includes("/releases/"))return;
  const original=SubtleCrypto.prototype.deriveBits;window.pendingCrypto=[];window.allowCrypto=false;
  SubtleCrypto.prototype.deriveBits=function(...args){
   if(window.allowCrypto)return original.apply(this,args);
   return new Promise((resolve,reject)=>{window.pendingCrypto.push(()=>original.apply(this,args).then(resolve,reject));});
  };
 });
 await openNew(page);await page.waitForFunction(()=>window.pendingCrypto?.length>0);
 assert(await page.locator("#loadingScreen").isVisible());assert.equal(await page.locator("#sessionCard").isVisible(),false);
 const dir=path.join(os.tmpdir(),"vhfgps-real-tests");fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,"chargement-mobile.png")});
 await page.evaluate(()=>{window.allowCrypto=true;window.pendingCrypto.forEach(run=>run());});
 await page.waitForFunction(()=>!document.documentElement.classList.contains("app-loading"));
 assert(await page.locator("#outingCreateDialog").isVisible());assert.equal(await page.locator("#loadingScreen").isVisible(),false);
 await page.screenshot({path:path.join(dir,"preparation-mobile.png")});
 await page.locator("#cancelOutingCreate").click();await page.locator("#create").waitFor({state:"visible"});
});
test("annuler la préparation restaure la position de lecture et la sortie",async()=>{
 const {page}=await phone({viewport:{width:390,height:844}});const before=await create(page);
 await page.evaluate(()=>window.scrollTo({top:350,behavior:"instant"}));const scroll=await page.evaluate(()=>window.scrollY);
 // Déclencher le bouton sans le scroll automatique de Playwright vers ce bouton.
 await page.locator("#backHomeBtn").dispatchEvent("click");await page.locator("#create").waitFor({state:"visible"});await page.locator("#create").click();
 await page.locator("#cancelOutingCreate").waitFor({state:"visible"});await page.locator("#cancelOutingCreate").click();
 await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée")&&!document.documentElement.classList.contains("app-loading"));
 assert.equal((await active(page)).id,before.id);assert(Math.abs((await page.evaluate(()=>window.scrollY))-scroll)<3);
});
test("installation Android : aide dans une modale du lanceur uniquement",async()=>{
 const {page,context}=await phone({userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36'});
 await context.addInitScript(()=>window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();event.stopImmediatePropagation();},true));
 await page.reload();await page.locator("#installAppBtn").waitFor({state:"visible"});
 await page.locator("#installAppBtn").click();assert(await page.locator("#installDialog").isVisible());
 assert.match(await page.locator("#installSteps").innerText(),/Chrome/);assert.equal(await page.locator('#installAddress').inputValue(),url);
 await page.locator("#closeInstall").click();assert.equal(await page.locator("#installDialog").isVisible(),false);
 await create(page);assert.equal(await page.locator("#installAppBtn, #installHelp").count(),0);
 await page.locator("#backHomeBtn").click();await page.locator("#installAppBtn").waitFor({state:"visible"});
 await page.evaluate(()=>window.dispatchEvent(new Event("appinstalled")));assert.equal(await page.locator("#installAppBtn").isVisible(),false);
});

test("installation directe proposée seulement au clic ; proposition consommée puis aide Android disponible",async()=>{
 const {page}=await phone({userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36'});
 await page.evaluate(()=>{window.promptCalls=0;const event=new Event("beforeinstallprompt",{cancelable:true});event.prompt=async()=>{window.promptCalls++;};event.userChoice=Promise.resolve({outcome:"dismissed"});window.dispatchEvent(event);window.promptPrevented=event.defaultPrevented;});
 assert.equal(await page.evaluate(()=>window.promptPrevented),true);assert.equal(await page.evaluate(()=>window.promptCalls),0);
 await page.locator("#installAppBtn").click();await page.waitForFunction(()=>window.promptCalls===1&&!document.getElementById("installAppBtn").disabled);
 await page.locator("#installAppBtn").click();assert(await page.locator("#installDialog").isVisible());assert.equal(await page.evaluate(()=>window.promptCalls),1);
});

test("installation iPhone : étapes Safari, adresse copiable et repli manuel sans modifier la sortie",async()=>{
 const {page,context}=await phone({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
 await create(page);await openHome(page);const before=await active(page);
 assert.equal(await page.locator('#installAppBtn').innerText(),'Ajouter à l’écran d’accueil');
 await page.locator('#installAppBtn').click();assert.equal(await page.locator('#installTitle').innerText(),'Installer sur iPhone / iPad');
 assert.match(await page.locator('#installSteps').innerText(),/Safari/);assert.match(await page.locator('#installSteps').innerText(),/Ouvrir comme app web/);
 assert.equal(await page.locator('#installAddress').inputValue(),url);assert.equal(await page.locator('#installAddress').getAttribute('readonly'),'');
 await page.locator('#copyInstallAddress').click();await page.waitForFunction(()=>document.getElementById('installCopyStatus').textContent.includes('Adresse copiée'));
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),url);
 fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../test-results/install-iphone-mobile.png')});
 await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('Permission refusée');}}));
 await page.locator('#copyInstallAddress').click();await page.waitForFunction(()=>document.getElementById('installCopyStatus').textContent.includes('sélectionnée'));
 assert.equal(await page.locator('#installAddress').evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('#installDialog').isVisible(),false);assert.deepEqual(await active(page),before);
 await page.setViewportSize({width:320,height:640});await page.locator('#installAppBtn').click();assert(await page.locator('#installDialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.locator('#closeInstall').click();await page.waitForFunction(()=>document.getElementById('installAppBtn').getAttribute('aria-expanded')==='false');
 await context.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));await page.reload();await page.waitForFunction(()=>!document.getElementById('create').disabled);
 assert.equal(await page.locator('#installAppBtn').isVisible(),false);
});

test("installation iPhone : adresse publique avec sous-répertoire, sans paramètres ni fragment",async()=>{
 const context=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'});contexts.push(context);
 const address='https://julienbranco.github.io/VHF-GPS-Code/';
 await context.route(address+'**',async route=>{
  const pathname=new URL(route.request().url()).pathname.slice('/VHF-GPS-Code/'.length);
  if(pathname==='boot.js')return route.fulfill({contentType:'text/javascript',body:'import {initInstallUI} from "./install.js";initInstallUI();'});
  const files={'':'index.html','install.js':'install.js','style.css':'style.css','icons/icon-192.png':'icons/icon-192.png'};
  if(!files[pathname])return route.fulfill({status:404,body:''});
  await route.fulfill({path:path.resolve(__dirname,'..',files[pathname]),contentType:pathname.endsWith('.js')?'text/javascript':undefined});
 });
 const page=await context.newPage();await page.goto(address+'?provenance=message#invitation');
 await page.locator('#installAppBtn').click();assert.equal(await page.locator('#installAddress').inputValue(),address);
});
test("installation : aide iPad détectée et aucun bouton générique pour Firefox sur PC",async()=>{
 const ipad=await phone({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15'});
 await ipad.context.addInitScript(()=>Object.defineProperty(navigator,'maxTouchPoints',{value:5}));await ipad.page.reload();await ipad.page.waitForFunction(()=>!document.getElementById('create').disabled);
 assert.equal(await ipad.page.locator('#installAppBtn').innerText(),'Ajouter à l’écran d’accueil');await ipad.page.locator('#installAppBtn').click();assert.match(await ipad.page.locator('#installSteps').innerText(),/Safari/);
 const firefox=await phone({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'});
 await firefox.context.addInitScript(()=>window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();event.stopImmediatePropagation();},true));await firefox.page.reload();await firefox.page.waitForFunction(()=>!document.getElementById('create').disabled);
 assert.equal(await firefox.page.locator('#installAppBtn').isVisible(),false);
});

test("mode installé : pas de bouton Installer dans le lanceur ni dans l’application",async()=>{
 const context=await browser.newContext();contexts.push(context);
 await context.addInitScript(()=>{const original=window.matchMedia.bind(window);window.matchMedia=query=>{const result=original(query);if(query==="(display-mode: standalone)")Object.defineProperty(result,"matches",{value:true});return result;};});
 const page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(await page.locator("#installAppBtn").isVisible(),false);await create(page);assert.equal(await page.locator("#installAppBtn").count(),0);
});

test("module de démarrage absent : le chargement ne reste pas bloqué et la sortie peut être réparée",async()=>{
 const {page,context}=await phone();const record=await create(page),invitation=await share(page);
 await page.evaluate(async release=>{const cache=await caches.open("vhfgps-main-release-"+release);await cache.delete(new URL("/releases/"+release+"/runtime.js",location.origin));},record.release);
 await context.setOffline(true);await page.reload();
 await page.waitForFunction(()=>document.getElementById("status")?.dataset.kind==="error"&&!document.documentElement.classList.contains("app-loading"));
 assert.match(await page.locator("#status").innerText(),/chargement.*incomplet/i);assert.equal((await active(page)).id,record.id);
 await context.setOffline(false);await importOuting(page,invitation);assert.equal((await active(page)).id,record.id);
});


test("nouvelle sortie : aucune zone intégrée présélectionnée, même après une zone éphémère",async()=>{
 const {page}=await phone();
 await openNew(page);await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 assert.equal(await page.locator("#outingBuiltinSelect").inputValue(),"");
 assert.equal(await page.locator("#outingBuiltinSelect option").first().innerText(),"Choisir une zone intégrée");
 assert.equal(await page.locator("#checkOutingCreate").isEnabled(),false);
 assert.equal(await page.locator("#outingBoundsPreview").isVisible(),false);
 await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");
 assert.equal(await page.locator("#checkOutingCreate").isEnabled(),true);
 assert.equal(await page.locator("#outingBoundsPreview").isVisible(),true);
 await page.locator("#cancelOutingCreate").click();await page.waitForURL(url);
 await create(page,{ephemeral:true});await openNew(page);
 await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 assert.equal(await page.locator("#outingBuiltinSelect").inputValue(),"");
 assert.equal(await page.locator("#checkOutingCreate").isEnabled(),false);
});
test("accueil sans sortie : deux choix disponibles et aucune redirection",async()=>{
 const {page}=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 assert.equal(new URL(page.url()).pathname,"/");assert.equal(await page.locator("#resume").isVisible(),false);
 assert.equal(await page.locator("#create").isEnabled(),true);assert.equal(await page.locator("#receive").isEnabled(),true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await openReceive(page);await page.locator("#closeReceive").click();assert.equal(new URL(page.url()).pathname,"/");
 {const empty=await active(page);if(empty!==undefined){assert(Number.isSafeInteger(empty.revision)&&empty.revision>0);assert.deepEqual(empty,{deleted:true,revision:empty.revision});}}
});

test("accueil avec sortie : zone et date visibles, état conservé puis reprise explicite hors réseau",async()=>{
 const {page,context}=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const before=await create(page,{ephemeral:true}),identity=await aliases(page);
 await context.setOffline(true);await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(new URL(page.url()).pathname,"/");assert.deepEqual(await active(page),before);
 await page.waitForFunction(()=>!document.getElementById("latestVersion").hidden);
 assert.match(await page.locator("#latestVersion").innerText(),/Dernière publication v/);
 assert.equal(await page.locator("#resumeZone").innerText(),identity.zoneData.name);assert.match(await page.locator("#resumeDate").innerText(),/^Créée le /);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dir=path.join(os.tmpdir(),"vhfgps-real-tests");fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,"accueil-mobile.png"),fullPage:true});
 await resume(page);assert.equal((await active(page)).release,before.release);assert.equal((await aliases(page)).secret,identity.secret);await encode(page);
});


test("accueil : suppression confirmée efface la sortie, bloque l’ancien onglet et permet de repartir",async()=>{
 const {page,context}=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const before=await create(page,{ephemeral:true}),invitation=await share(page);
 const stale=await context.newPage();await stale.goto(url);await resume(stale);
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById("deleteOuting").disabled);
 assert.equal(await page.locator("#deleteOuting").isVisible(),true);
 await page.locator("#deleteOuting").click();await page.locator("#deleteDialog").waitFor({state:"visible"});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.locator("#confirmDelete").evaluate(el=>{const rect=el.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight;}));
 assert.match(await page.locator("#deleteSummary").innerText(),/ÉPHÉMÈRE DE SORTIE/);
 await page.locator("#cancelDelete").click();assert.deepEqual(await active(page),before);
 await page.locator("#deleteOuting").click();await page.locator("#confirmDelete").click();
 await page.locator("#deleteDialog").waitFor({state:"hidden"});
 assert.equal(await page.locator("#resume").isVisible(),false);
 assert.equal(await page.locator("#deleteOuting").isVisible(),false);
 const tombstone=await active(page);assert.deepEqual(tombstone,{deleted:true,revision:before.revision+1});
 assert.equal(await page.evaluate(async id=>{const s=await import("/storage.js");return s.read(await s.openStore(),"outing:"+id);},before.id),undefined);
 await stale.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("modifiée dans une autre fenêtre"));
 await context.setOffline(true);await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(await page.locator("#resume").isVisible(),false);
 await context.setOffline(false);const restored=await importOuting(page,invitation);
 assert.equal(restored.id,before.id);assert(restored.revision>tombstone.revision);
});
test("annuler la réception : accueil visible par bouton ou Échap, sortie conservée sans reprise automatique",async()=>{
 const {page}=await phone();const before=await create(page),identity=await aliases(page);
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 for(const escape of [false,true]){
  await openReceive(page);await page.locator("#invitation").fill("message non validé");
  if(escape)await page.keyboard.press("Escape");else await page.locator("#closeReceive").click();
  await page.locator("#receiveDialog").waitFor({state:"hidden"});
  assert.equal(new URL(page.url()).pathname,"/");assert.equal(await page.locator("#empty").isVisible(),true);assert.equal(await page.locator("#resume").isEnabled(),true);
  assert.deepEqual(await active(page),before);
 }
 await resume(page);await openReceive(page);await page.locator("#closeReceive").click();
 await page.locator("#receiveDialog").waitFor({state:"hidden"});assert.equal(await page.locator("#empty").isVisible(),true);
 assert.equal(await page.locator("#status").innerText(),"");assert.deepEqual(await active(page),before);
 await resume(page);assert.equal((await aliases(page)).secret,identity.secret);await encode(page);
});


test("accueil et partage direct : actions visibles et invitation identique repartagée hors réseau",async()=>{
 const {page,context}=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 assert.equal(await page.locator("#share").count(),0);
 const record=await create(page,{ephemeral:true});assert.equal(await page.locator("#outingSettings, #createOutingBtn, #receiveOutingBtn, #copyOutingBtn").count(),0);
 assert.equal(await page.locator("#backHomeBtn").isVisible(),true);
 const invitation=await share(page);await page.locator("#closeOutingShare").click();await context.setOffline(true);
 await openHome(page);assert.equal(new URL(page.url()).pathname,"/");assert.equal(await page.locator("#outingMenu").count(),0);
 assert.equal(await page.locator("#create").isVisible(),true);assert.equal(await page.locator("#receive").isVisible(),true);
 assert.equal(await page.locator("#share").count(),0);assert.equal((await active(page)).release,record.release);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dir=path.join(os.tmpdir(),"vhfgps-real-tests");fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,"accueil-mobile.png"),fullPage:true});
 const again=await share(page);assert.equal(again,invitation);assert.equal((await active(page)).id,record.id);assert.equal((await active(page)).release,record.release);
});

test("partage dans l’application masqué après changement de zone, même après confirmation radio",async()=>{
 const {page}=await phone();const before=await create(page);
 const target=await page.locator("#sendZone").evaluate(select=>[...select.options].find(option=>option.value!==select.value).value);
 await page.locator("#sendZone").selectOption(target);await page.locator("#confirmZoneSwitch").click();
 await page.waitForFunction(id=>activeZone().id===id,target);
 await page.locator("#sendZoneConfirmBtn").waitFor({state:"visible"});await page.waitForFunction(()=>!document.getElementById("sendZoneConfirmBtn").disabled);
 await page.locator("#sendZoneConfirmBtn").click();await page.waitForFunction(()=>isZoneConfirmed(activeZone()));
 await openHome(page);assert.equal(await page.locator("#share").isVisible(),false);assert.equal(await page.locator("#resume").isVisible(),true);
 assert.equal((await active(page)).id,before.id);assert.equal((await active(page)).release,before.release);
});


test("première ouverture : anciens caches retirés, ancienne sortie ignorée et libellés définitifs",async()=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});contexts.push(context);const page=await context.newPage();
 const seed=new URL("seed-local.html",url).href;await page.route(seed,route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Préparation locale</title>"}));await page.goto(seed);
 await page.evaluate(async()=>{
  for(const name of ["vhfgps-integration-shell-legacy","vhfgps-integration-release-legacy","official-cache-sentinel"]){const cache=await caches.open(name);await cache.put("/old-file",new Response("ancien fichier"));}
  await new Promise((resolve,reject)=>{const req=indexedDB.open("vhfgps-real-integration-v2",1);req.onupgradeneeded=()=>req.result.createObjectStore("state");req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction("state","readwrite");tx.objectStore("state").put({id:"ancien",release:"ancienne-publication"},"active");tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
 });
 await page.goto(url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(await page.locator("#resume").isVisible(),false);{const empty=await active(page);if(empty!==undefined){assert(Number.isSafeInteger(empty.revision)&&empty.revision>0);assert.deepEqual(empty,{deleted:true,revision:empty.revision});}}
 const keys=await page.evaluate(()=>caches.keys());assert(!keys.some(name=>name.startsWith("vhfgps-integration-")));assert(keys.includes("official-cache-sentinel"));
 assert.doesNotMatch(await page.locator("body").innerText(),/\bessai\b|\bde test\b|🧪|ne pas utiliser en navigation/i);
 const manifest=await page.evaluate(()=>fetch("/manifest.webmanifest").then(response=>response.json()));assert.equal(manifest.name,"VHF GPS Code");assert.equal(manifest.short_name,"VHF GPS Code");
 await create(page);const invitation=await share(page);assert.match(invitation,/VHF-SORTIE2\./);assert.doesNotMatch(invitation,/\bessai\b|\bde test\b|🧪/i);
 assert.doesNotMatch(await page.locator("body").innerText(),/\bessai\b|\bde test\b|🧪|ne pas utiliser en navigation/i);
});


test("import : confirmation automatique sans saisie, résumé complet et installation explicite",async()=>{
 const sender=await phone();const expected=await create(sender.page,{ephemeral:true}),invitation=await share(sender.page),identity=await aliases(sender.page);
 const receiver=await phone({viewport:{width:320,height:640},isMobile:true,hasTouch:true});const previous=await create(receiver.page);
 await openReceive(receiver.page);await receiver.page.locator("#invitation").fill(invitation);await receiver.page.locator("#receiveForm button[type=submit]").click();
 const page=receiver.page;await page.locator("#confirmOutingImport").waitFor({state:"visible"});
 assert.equal(await page.locator("#outingImportTitle").innerText(),"Confirmer la sortie reçue");
 assert.equal(await page.locator("#outingImportDialog textarea, #checkOutingBtn, #outingImportDescription").count(),0);
 const summary=await page.locator("#outingImportSummary").innerText();assert(summary.includes(identity.session));assert(summary.includes(identity.zone));assert.match(summary,/Création de la sortie|Installation sur ce téléphone/);assert.match(summary,/ÉPHÉMÈRE DE SORTIE/);
 assert.equal(await page.locator("#outingImportDialogError").isVisible(),false);
 assert.deepEqual(await active(page),previous);assert(await page.locator("#outingImportDialog").evaluate(el=>el.scrollWidth<=el.clientWidth));
 fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../test-results/outing-import-confirmation-mobile.png')});
 await page.locator("#confirmOutingImport").click();await page.locator("#closeOutingSuccess").waitFor({state:"visible"});
 const result=await active(page);assert.equal(result.id,expected.id);assert.equal(result.release,expected.release);assert.equal((await aliases(page)).secret,identity.secret);
});

test("import : invitation liée à la sortie, annulation et garde-fou de session conservent la sortie active",async()=>{
 const sender=await phone();const first=await create(sender.page),invitation=await share(sender.page);
 const other=await phone();await create(other.page,{ephemeral:true});const different=await share(other.page);
 const receiver=await phone();const previous=await create(receiver.page),page=receiver.page;
 async function review(text){await openReceive(page);await page.locator("#invitation").fill(text);await page.locator("#receiveForm button[type=submit]").click();await page.locator("#confirmOutingImport").waitFor({state:"visible"});}
 await review(invitation);
 // Le contrat de distribution continue à refuser une invitation différente de celle chargée.
 await assert.rejects(page.evaluate(text=>VHFIntegration.importContent(text),different),/ne correspond pas/);
 assert.deepEqual(await active(page),previous);await page.locator("#cancelOutingImport").click();await page.waitForFunction(()=>document.getElementById("receive")&&!document.getElementById("receive").disabled);
 assert.equal(new URL(page.url()).pathname,"/");assert.deepEqual(await active(page),previous);
 await review(different);assert.match(await page.locator("#outingImportSummary").innerText(),/ÉPHÉMÈRE DE SORTIE/);await page.keyboard.press("Escape");await page.waitForFunction(()=>document.getElementById("receive")&&!document.getElementById("receive").disabled);assert.deepEqual(await active(page),previous);
 await review(invitation);await page.evaluate(()=>{activeSessionRevision++;});await page.locator("#confirmOutingImport").click();
 await page.locator("#outingImportDialogError").waitFor({state:"visible"});assert.match(await page.locator("#outingImportDialogError").innerText(),/session ou la zone active a changé/);assert.equal(await page.locator("#confirmOutingImport").isVisible(),false);assert.deepEqual(await active(page),previous);
 await page.locator("#cancelOutingImport").click();await page.waitForFunction(()=>document.getElementById("receive")&&!document.getElementById("receive").disabled);
 await review(invitation);await page.locator("#confirmOutingImport").click();await page.locator("#closeOutingSuccess").waitFor({state:"visible"});assert.equal((await active(page)).id,first.id);
});


test("partage direct : pas de navigation, position saisie et résultats radio conservés sur mobile",async()=>{
 const sender=await phone({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await create(sender.page);const message=await encode(sender.page);
 const page=sender.page,address=page.url(),position=await page.locator("#lat").inputValue(),phrase=await page.locator("#encodedWords").innerText();
 const invitation=await share(page);assert.equal(page.url(),address);await page.locator("#closeOutingShare").click();
 assert.equal(await page.locator("#lat").inputValue(),position);assert.equal(await page.locator("#encodedWords").innerText(),phrase);assert.equal(await page.locator("#encodedBlock").isVisible(),true);
 const buttons=await page.locator(".app-navigation button").evaluateAll(elements=>elements.filter(el=>!el.classList.contains("hidden")).map(el=>{const r=el.getBoundingClientRect();return {top:r.top,right:r.right};}));assert.equal(buttons.length,2);assert.equal(buttons[0].top,buttons[1].top);assert(buttons.every(r=>r.right<=390));
 const dir=path.join(os.tmpdir(),"vhfgps-real-tests");fs.mkdirSync(dir,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));await page.screenshot({path:path.join(dir,"app-header-mobile.png")});
 const receiver=await phone();await importOuting(receiver.page,invitation);await decode(receiver.page,message);
 const coords=await receiver.page.locator("#decodedCoords").innerText(),receiverAddress=receiver.page.url();
 await share(receiver.page);assert.equal(receiver.page.url(),receiverAddress);await receiver.page.locator("#closeOutingShare").click();
 assert.equal(await receiver.page.locator("#decodedCoords").innerText(),coords);assert.equal(await receiver.page.locator("#decodedCoordsWrap").isVisible(),true);assert(await receiver.page.locator("#decodedBlock").evaluate(el=>el.classList.contains("position-confirmed")));
});

test("accueil et suppression : icône, empreinte validée et dates distinctes de création et d'installation",async()=>{
 const sender=await phone({timezoneId:'Europe/Paris'});await create(sender.page);
 const identity=await aliases(sender.page),invitation=await share(sender.page);
 const receiver=await phone({timezoneId:'Europe/Paris',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const installedAt=Date.now()+2*60*60*1000;
 await receiver.context.addInitScript(value=>{Date.now=()=>value;},installedAt);
 await receiver.page.reload();await receiver.page.waitForFunction(()=>!document.getElementById('receive').disabled);
 await importOuting(receiver.page,invitation);await openHome(receiver.page);
 const page=receiver.page,before=await active(page);
 const dates=await page.evaluate(record=>({created:'Créée le '+new Date(record.summary.createdAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}),installed:'Installée sur ce téléphone le '+new Date(Number(record.state.vhfGpsOutingInstalledAtV1)).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}),before);
 assert.equal(Number(before.state.vhfGpsOutingInstalledAtV1),installedAt);
 assert.equal(await page.locator('#resumeFingerprintWords').innerText(),identity.session);
 assert.equal(await page.locator('#resumeDate').innerText(),dates.created);assert.equal(await page.locator('#resumeInstalled').innerText(),dates.installed);
 assert.equal(await page.locator('#resume .outing-icon').evaluate(img=>img.complete&&img.naturalWidth>0&&img.getBoundingClientRect().width===64),true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await receiver.context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('deleteOuting').disabled);
 assert.equal(await page.locator('#resumeFingerprintWords').innerText(),identity.session);
 await page.locator('#deleteOuting').click();await page.locator('#deleteDialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#deleteZone').innerText(),await page.locator('#resumeZone').innerText());
 assert.equal(await page.locator('#deleteFingerprintWords').innerText(),identity.session);
 assert.equal(await page.locator('#deleteDate').innerText(),dates.created);assert.equal(await page.locator('#deleteInstalled').innerText(),dates.installed);
 assert.equal(await page.locator('#deleteDialog .outing-icon').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 fs.mkdirSync(path.resolve(__dirname,'../test-results'),{recursive:true});
 await page.screenshot({path:path.resolve(__dirname,'../test-results/outing-delete-details-mobile.png')});
 await page.locator('#cancelDelete').click();assert.deepEqual(await active(page),before);
 await page.screenshot({path:path.resolve(__dirname,'../test-results/outing-resume-details-mobile.png')});
 await page.setViewportSize({width:320,height:640});await page.locator('#deleteOuting').click();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await page.locator('#deleteDialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await page.locator('#cancelDelete').click();assert.deepEqual(await active(page),before);
 // Les détails absents sur une ancienne sortie sont masqués, jamais inventés.
 await receiver.context.setOffline(false);
 await page.evaluate(async()=>{const s=await import('/storage.js'),db=await s.openStore(),record=await s.read(db,'active');delete record.state.vhfGpsOutingInstalledAtV1;delete record.envelope.content;
 await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(record,'active');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();});
 await page.reload();await page.waitForFunction(()=>!document.getElementById('deleteOuting').disabled);
 assert.equal(await page.locator('#resumeFingerprint').isVisible(),false);assert.equal(await page.locator('#resumeInstalled').isVisible(),false);assert.equal(await page.locator('#resumeDate').innerText(),dates.created);
 await page.locator('#deleteOuting').click();assert.equal(await page.locator('#deleteFingerprint').isVisible(),false);assert.equal(await page.locator('#deleteInstalled').isVisible(),false);
});

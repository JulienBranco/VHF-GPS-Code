"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {createServer}=require("../tools/server.cjs");
let chromium;
try{({chromium}=require("playwright"));}catch{
 const bundled=path.join(process.env.USERPROFILE||"","\\.cache".replace("\\",""),"codex-runtimes","codex-primary-runtime","dependencies","node","node_modules","playwright");
 ({chromium}=require(bundled));
}
const executablePath=process.env.PROTOTYPE_CHROME||(process.platform==="win32"?"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe":undefined);
let browser,host,contexts=[];
const root=path.resolve(__dirname,"..");
const channel=letter=>JSON.parse(fs.readFileSync(path.join(root,"channels",letter+".json")));
test.before(async()=>{host=await createServer();browser=await chromium.launch({headless:true,executablePath});});
test.after(async()=>{await Promise.all(contexts.map(c=>c.close().catch(()=>{})));await browser?.close();await new Promise(resolve=>host.server.close(resolve));});
test.beforeEach(()=>{host.state.latest="A";host.state.fail=null;host.state.corrupt=null;host.state.delay=0;host.state.shellUpdate=false;});
async function phone(options={}){
 const context=await browser.newContext(options);contexts.push(context);
 const page=await context.newPage();await page.goto(host.url);await page.locator("#create").waitFor({state:"visible"});
 await page.waitForFunction(()=>!document.getElementById("create").disabled);
 return {context,page};
}
async function stage(page){await page.locator("#create").click();await page.locator("#review-dialog").waitFor({state:"visible"});}
async function activate(page){await page.locator("#confirm").click();await page.locator("#review-dialog").waitFor({state:"hidden"});await page.locator("#ready").waitFor({state:"visible"});}
async function create(page){await stage(page);await activate(page);}
async function snapshot(page){return page.evaluate(async()=>{const s=await import("./storage.js");return s.read(await s.openStore(),"active");});}
async function code(page){const value=await page.frameLocator("#active-frame iframe:not([hidden])").locator("#code").innerText();assert.match(value,/^TEST [AB] · /);return value;}
async function importInvitation(page,invitation){
 await page.locator("#receive").click();await page.locator("#invitation-input").fill(invitation);
 await page.locator("#receive-form button[type=submit]").click();
 await page.locator("#review-dialog").waitFor({state:"visible"});
 await activate(page);
}
test("deux téléphones utilisent A malgré une publication serveur B ; aucun secret envoyé au serveur",async()=>{
 const first=await phone();await create(first.page);
 const active=await snapshot(first.page),firstCode=await code(first.page);
 host.state.latest="B";
 const second=await phone();
 await importInvitation(second.page,active.invitation);
 assert.equal((await snapshot(second.page)).payload.release,active.payload.release);
 assert.equal(await code(second.page),firstCode);
 assert(!host.state.requests.some(url=>url.includes(active.payload.session)));
 await second.context.setOffline(true);await second.page.reload();
 await second.page.locator("#ready").waitFor({state:"visible"});
 assert.equal(await code(second.page),firstCode);
});
test("page ouverte : publication réelle A vers B ; reprise A hors ligne puis nouvelle sortie B et rejeu A",async()=>{
 const {page,context}=await phone();await create(page);
 const a=await snapshot(page),aCode=await code(page);
 host.state.latest="B";
 await context.setOffline(true);await page.reload();await page.locator("#ready").waitFor({state:"visible"});
 assert.equal(await code(page),aCode);
 await page.locator("#create").click();
 await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error");
 assert.equal((await snapshot(page)).payload.id,a.payload.id);
 await context.setOffline(false);await create(page);
 assert.equal((await snapshot(page)).manifest.label,"B");
 assert.notEqual(await code(page),aCode);
 await context.setOffline(true);await importInvitation(page,a.invitation);
 assert.equal((await snapshot(page)).manifest.label,"A");assert.equal(await code(page),aCode);
});
test("premier import inconnu hors ligne refusé sans remplacement de la sortie",async()=>{
 const sender=await phone();await create(sender.page);const invitation=(await snapshot(sender.page)).invitation;
 const receiver=await phone();await create(receiver.page);const before=await snapshot(receiver.page);
 await receiver.context.setOffline(true);
 await receiver.page.locator("#receive").click();await receiver.page.locator("#invitation-input").fill(invitation);
 await receiver.page.locator("#receive-form button[type=submit]").click();
 await receiver.page.waitForFunction(()=>document.getElementById("receive-error").textContent.length>0);
 assert.equal((await snapshot(receiver.page)).payload.id,before.payload.id);
});
test("fichier corrompu puis téléchargement coupé : sortie A conservée, B réparable",async()=>{
 const {page}=await phone();await create(page);const before=await snapshot(page),original=await code(page);
 host.state.latest="B";host.state.corrupt=channel("B").release+"/engine.js";
 await page.locator("#create").click();await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error");
 assert.equal((await snapshot(page)).payload.id,before.payload.id);assert.equal(await code(page),original);
 host.state.corrupt=null;host.state.fail=channel("B").release+"/engine.js";
 await page.locator("#create").click();await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error"&&!document.getElementById("create").disabled);
 assert.equal((await snapshot(page)).payload.id,before.payload.id);
 host.state.fail=null;await create(page);assert.equal((await snapshot(page)).manifest.label,"B");
});
test("cache incomplet au redémarrage : aucun remplacement silencieux ; rejeu en ligne répare",async()=>{
 const {page,context}=await phone();await create(page);const a=await snapshot(page),aCode=await code(page);
 await page.evaluate(async release=>{const cache=await caches.open("vhfgps-prototype-release-"+release);await cache.delete(new URL("releases/"+release+"/engine.js",location.href));},a.payload.release);
 await context.setOffline(true);await page.reload();
 await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error");
 assert.equal(await page.locator("#active-frame iframe").count(),0);
 assert.equal((await snapshot(page)).payload.id,a.payload.id);
 await context.setOffline(false);await importInvitation(page,a.invitation);assert.equal(await code(page),aCode);
});
test("deux fenêtres : une préparation obsolète ne remplace pas une activation plus récente",async()=>{
 const {page,context}=await phone();await create(page);
 const other=await context.newPage();await other.goto(host.url);await other.waitForFunction(()=>!document.getElementById("create").disabled);
 await stage(page);await stage(other);await activate(page);const accepted=await snapshot(page);
 await other.locator("#confirm").click();
 await other.waitForFunction(()=>document.getElementById("review-error").textContent.length>0);
 assert.equal((await snapshot(other)).payload.id,accepted.payload.id);
 await other.locator('[data-close="review-dialog"]').click();
 await other.waitForFunction(()=>document.getElementById("status").textContent.includes("Sortie retrouvée"));
 assert.equal(await code(other),await code(page));
});
test("invitation altérée ou protocole différent refusés, données actuelles conservées",async()=>{
 const {page}=await phone();await create(page);const before=await snapshot(page);
 const corrupt=before.invitation.replace("VHF-GPS-TEST-1.","VHF-GPS-TEST-1.A");
 await page.locator("#receive").click();await page.locator("#invitation-input").fill(corrupt);
 await page.locator("#receive-form button[type=submit]").click();
 await page.waitForFunction(()=>document.getElementById("receive-error").textContent.length>0);
 await page.locator('[data-close="receive-dialog"]').click();
 const mismatch=await page.evaluate(async payload=>{const p=await import("./protocol.js");return p.invitationText({...payload,id:p.randomId(),protocol:"DEMO-B"});},before.payload);
 await page.locator("#receive").click();await page.locator("#invitation-input").fill(mismatch);
 await page.locator("#receive-form button[type=submit]").click();
 await page.waitForFunction(()=>document.getElementById("receive-error").textContent.includes("protocole"));
 assert.equal((await snapshot(page)).payload.id,before.payload.id);
});
test("transaction interrompue : aucun remplacement partiel de l'invitation active",async()=>{
 const {page}=await phone();await create(page);const before=await snapshot(page);
 const result=await page.evaluate(async()=>{
  const s=await import("./storage.js"),p=await import("./protocol.js"),db=await s.openStore(),old=await s.read(db,"active");
  const record={...old,payload:{...old.payload,id:p.randomId()}};
  record.invitation=await p.invitationText(record.payload);
  const broken={transaction(...args){
   const tx=db.transaction(...args),store=tx.objectStore.bind(tx);
   tx.objectStore=(...a)=>{const object=store(...a),put=object.put.bind(object);object.put=(value,key)=>{const request=put(value,key);if(key==="active")tx.abort();return request;};return object;};
   return tx;
  }};
  let failed=false;try{await s.commit(broken,record,old.revision);}catch{failed=true;}
  return {failed,active:await s.read(db,"active"),partial:await s.read(db,"outing:"+record.payload.id)};
 });
 assert(result.failed);assert.equal(result.active.payload.id,before.payload.id);assert.equal(result.partial,undefined);
});
test("mobile 390 px : aucun débordement, activation visible ; capture de contrôle",async()=>{
 const {page}=await phone({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await stage(page);
 assert(await page.locator("#confirm").isVisible());
 const shots=path.join(os.tmpdir(),"vhfgps-prototype-tests");fs.mkdirSync(shots,{recursive:true});
 await page.screenshot({path:path.join(shots,"confirmation-mobile.png"),fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await activate(page);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dir=path.join(os.tmpdir(),"vhfgps-prototype-tests");fs.mkdirSync(dir,{recursive:true});
 await page.screenshot({path:path.join(dir,"mobile.png"),fullPage:true});
 console.log("Capture mobile : "+path.join(dir,"mobile.png"));
});
test("nouveau boot.js et worker : fermeture complète puis ancienne sortie intacte hors connexion",async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-profile-"));
 let context=await chromium.launchPersistentContext(profile,{headless:true,executablePath});
 try{
  let page=await context.newPage();await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
  await create(page);const before=await code(page),saved=await snapshot(page);
  assert(!(await page.locator("#status").innerText()).includes("[Lanceur test 2]"));
  const oldShells=await page.evaluate(async()=>(await caches.keys()).filter(n=>n.startsWith("vhfgps-prototype-shell-")));
  host.state.shellUpdate=true;
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
  await page.waitForFunction(async()=>(await navigator.serviceWorker.getRegistration()).waiting!==null);
  assert.equal(await code(page),before);
  const observer=await context.newPage();await observer.goto(new URL("../observer.html",host.url).href);
  await page.close();
  await observer.waitForFunction(async old=>(await caches.keys()).every(name=>!old.includes(name)),oldShells);
  await context.close();
  host.state.latest="B";
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath});
  await context.setOffline(true);page=await context.newPage();await page.goto(host.url);
  await page.locator("#ready").waitFor({state:"visible"});
  assert.equal(await code(page),before);
  assert.equal(await page.locator("body").getAttribute("data-test-shell"),"updated");
  assert.match(await page.locator("#status").innerText(),/^\[Lanceur test 2\] Sortie retrouvée avec sa version A/);
  assert.deepEqual(await snapshot(page),saved);
 }finally{await context.close();const resolved=fs.realpathSync(profile);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith("vhfgps-profile-"))throw new Error("Profil temporaire hors périmètre");fs.rmSync(resolved,{recursive:true,force:true});}
});
test("installation du prototype depuis une page déjà contrôlée par le worker de production",async()=>{
 const context=await browser.newContext();contexts.push(context);const page=await context.newPage();
 await page.goto(new URL("../vhf_gps_code.html",host.url).href);
 await page.evaluate(async()=>{await navigator.serviceWorker.register("./sw.js");await navigator.serviceWorker.ready;});
 await page.reload();
 await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert((await page.evaluate(()=>navigator.serviceWorker.controller.scriptURL)).endsWith("/prototype-distribution/sw.js"));
 await create(page);assert.equal((await snapshot(page)).manifest.label,"A");
});

test("annuler une préparation téléchargée laisse la sortie et le code actifs inchangés",async()=>{
 const {page}=await phone();await create(page);const before=await snapshot(page),original=await code(page);
 host.state.latest="B";await stage(page);
 await page.locator('[data-close="review-dialog"]').click();
 await page.waitForFunction(()=>document.getElementById("status").textContent.includes("Sortie retrouvée"));
 assert.equal((await snapshot(page)).payload.id,before.payload.id);assert.equal(await code(page),original);
});
test("cache supprimé entre résumé et validation : activation refusée",async()=>{
 const {page}=await phone();await create(page);const before=await snapshot(page);
 host.state.latest="B";await stage(page);
 await page.evaluate(async id=>{await caches.delete("vhfgps-prototype-release-"+id);},channel("B").release);
 await page.locator("#confirm").click();
 await page.waitForFunction(()=>document.getElementById("review-error").textContent.length>0);
 assert.equal((await snapshot(page)).payload.id,before.payload.id);
});

for(const direction of ["initialize","ready"]){
 for(const missing of [false,true]){
  test("dialogue "+direction+" : API "+(missing?"absente":"inconnue")+" refusée sans remplacer la sortie",async()=>{
   const {page,context}=await phone();await create(page);
   const before=await snapshot(page),original=await code(page);
   // Simuler une autre version du dialogue, sans modifier les fichiers vérifiés.
   await context.addInitScript(({direction,missing})=>{
    const alter=message=>{if(missing)delete message.api;else message.api=99;};
    if(direction==="initialize"){
     // Conserver l'origine et la source du message réel envoyé par le parent.
     window.addEventListener("message",event=>{
      if(event.data?.type==="initialize")alter(event.data);
     },true);
    }else{
     const original=MessagePort.prototype.postMessage;
     MessagePort.prototype.postMessage=function(message,...args){
      if(message?.type==="ready"){message={...message};alter(message);}
      return original.call(this,message,...args);
     };
    }
   },{direction,missing});
   host.state.latest="B";await page.locator("#create").click();
   await page.waitForFunction(()=>document.getElementById("status").dataset.kind==="error"&&!document.getElementById("create").disabled);
   assert.match(await page.locator("#status").innerText(),/Dialogue incompatible/);
   assert.equal(await page.locator("#review-dialog").isVisible(),false);
   assert.deepEqual(await snapshot(page),before);
   assert.equal(await code(page),original);
  });
 }
}

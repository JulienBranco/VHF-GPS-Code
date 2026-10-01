"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {prepareBuild,prepareShell}=require("../tools/build.cjs");
const {createServer}=require("../tools/server.cjs");
const {chromium,browserOptions}=require("../tools/test-browser.cjs");
const root=path.resolve(__dirname,"..");
const buildId=bytes=>String(bytes).match(/SHELL_BUILD="([a-f0-9]{64})"/)[1];
async function fixture(t){
 const browser=await chromium.launch(browserOptions()),host=await createServer();
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 // Préparation uniquement en mémoire : aucune release ajoutée au projet.
 const prepared=prepareBuild(root);for(const [name,bytes] of prepared.output)host.state.virtual.set("/"+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 return {context,page,host,prepared};
}
async function openInfo(page){
 await page.locator("#technicalInfo summary").click();
 await page.waitForFunction(()=>{const field=document.querySelector("#technicalInfo dd");return field.hasAttribute("title")||/Identifiant indisponible|Aperçu local/.test(field.textContent);});
 return page.locator("#technicalInfo dd").first();
}
test("identifiant de l'accueil actif : actualisation automatique puis identifiant exact hors ligne",async t=>{
 const {context,page,host,prepared}=await fixture(t),first=buildId(prepared.output.get("sw.js"));
 const id=await openInfo(page);assert.equal(await id.getAttribute("title"),first);
 const next=new Map(prepared.output);
 next.set("boot.js",Buffer.from(fs.readFileSync(path.join(root,"boot.js"),"utf8").replace(/\r\n/g,"\n")+"\n// Nouvelle copie d’accueil pour le test.\n"));
 next.set("sw.js",prepareShell(root,next));const second=buildId(next.get("sw.js"));assert.notEqual(first,second);
 host.state.virtual.set("/boot.js",next.get("boot.js"));host.state.virtual.set("/sw.js",next.get("sw.js"));
 await page.evaluate(()=>{navigator.serviceWorker.getRegistration().then(reg=>reg.update());});
 await page.waitForFunction(expected=>document.querySelector('#technicalInfo dd')?.title===expected,second);
 assert.equal(await page.locator('#technicalInfo').getAttribute('open'),'');
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById("create").disabled);
 const reopened=await openInfo(page);assert.equal(await reopened.getAttribute("title"),second);
});

test("informations de sortie : version réellement chargée, reprise hors réseau, effacement après suppression",async t=>{
 const {page,context,host,prepared}=await fixture(t);
 await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();
 await page.locator("#confirmOutingCreate").waitFor({state:"visible"});await page.locator("#confirmOutingCreate").click();
 await page.waitForFunction(()=>document.getElementById("testBanner").textContent.includes("Sortie enregistrée"));await page.locator("#closeOutingSuccess").click();
 assert.equal(await page.locator('.app-header h1').innerText(),'VHF GPS Code');
 assert.equal(await page.locator('#appVersionHeading, #installAppBtn').count(),0);
 assert.equal(await page.locator('#testBanner').isVisible(),false);
 assert.match(await page.locator('#pwaStatus').innerText(),/APPLICATION PRÊTE HORS RÉSEAU/);
 assert.equal(await page.locator('.app-brand-icon').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 for(const theme of ['day','night']){
  await page.locator('#themeMode').selectOption(theme);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>scrollTo(0,0));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(root,'test-results','app-header-'+theme+'-'+width+'.png')});
  }
 }
 await openInfo(page);const panel=page.locator("#technicalInfo");
 assert.match(await panel.innerText(),new RegExp("v"+prepared.version.replaceAll(".","\\.")));
 assert.match(await panel.innerText(),/PROTO 6/);assert.equal(await panel.locator("dd").nth(1).getAttribute("title"),prepared.id);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner").textContent.includes("Sortie retrouvée"));
 assert.equal(await page.locator("#testBanner").isVisible(),false);
 await openInfo(page);assert.equal(await panel.locator("dd").first().getAttribute("title"),buildId(prepared.output.get("sw.js")));
 await page.locator("#backHomeBtn").click();await page.waitForFunction(()=>!document.getElementById("create").disabled);
 await openInfo(page);assert.equal(await panel.locator("dd").nth(1).getAttribute("title"),prepared.id);
 await page.locator("#deleteOuting").click();await page.locator("#confirmDelete").click();await page.locator("#deleteDialog").waitFor({state:"hidden"});
 assert.equal(await panel.locator("dd").count(),1);assert.doesNotMatch(await panel.innerText(),/Application de cette sortie/);
 assert.equal(new URL(page.url()).href,host.url);
});

test("diagnostic protocole déplacé : secret absent de l'interface, autotest et retest opérationnels",async t=>{
 const {page}=await fixture(t);
 await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").waitFor({state:"visible"});await page.locator("#confirmOutingCreate").click();await page.locator("#closeOutingSuccess").click();
 assert.equal(await page.locator("#sessionSettings, #sessionKey, #copySecret, #generateSecret").count(),0);
 const original=await page.evaluate(()=>activeSecret());
 assert.equal(await page.locator('details > summary').filter({hasText:/^Informations techniques$/}).count(),1);
 assert.equal(await page.locator('#technicalInfo .technical-info-list dt').filter({hasText:'Accueil installé'}).count(),1);
 assert.equal(await page.locator('#technicalInfo .technical-info-list dt').filter({hasText:'Application de cette sortie'}).count(),1);
 assert.equal(await page.locator('#technicalInfo .technical-info-list dt').filter({hasText:'Protocole de cette sortie'}).count(),0);
 assert.equal(await page.locator("#technicalInfo").getAttribute("open"),null);
 await page.locator("#technicalInfo summary").click();const panel=page.locator("#technicalInfo");
 assert.equal(await panel.locator("#compatFull").innerText(),'4043F648E26823B18361AAC243BC490C70FDC8401484759322464B8C29B16B81');
 assert.match(await panel.locator("#compatShort").innerText(),/PROTO 6.*4043F648/);
 assert.equal(await panel.locator("#protocolSelfTestStatus").innerText(),"Autotest protocole : OK.");
 assert.equal((await panel.innerText()).includes(original),false);
 await panel.locator("#protocolSelfTestBtn").click();await page.waitForFunction(()=>protocolRuntimeState===PROTOCOL_STATE.OK);
 assert.equal(await page.locator("#protocolFatalBanner").isVisible(),false);assert.equal(await page.evaluate(()=>activeSecret()),original);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await panel.screenshot({path:path.join(root,'test-results/protocol-details-mobile.png')});
 // Un retest échoué bloque toujours l'échange, même après déplacement du contrôle.
 await page.evaluate(()=>{window.savedProtocolCollector=collectProtocolVector;collectProtocolVector=async()=>{throw Error('Échec simulé du vecteur');};});
 await panel.locator("#protocolSelfTestBtn").click();await page.waitForFunction(()=>protocolRuntimeState===PROTOCOL_STATE.FAILED);
 assert.equal(await page.locator("#protocolFatalBanner").isVisible(),true);assert.match(await panel.locator("#protocolSelfTestStatus").innerText(),/AUTOTEST ÉCHOUÉ/);assert.equal(await page.locator("#encodeBtn").isEnabled(),false);
 await page.evaluate(()=>{collectProtocolVector=window.savedProtocolCollector;});await panel.locator("#protocolSelfTestBtn").click();await page.waitForFunction(()=>protocolRuntimeState===PROTOCOL_STATE.OK);
 assert.equal(await page.locator("#protocolFatalBanner").isVisible(),false);assert.equal(await page.evaluate(()=>activeSecret()),original);
});

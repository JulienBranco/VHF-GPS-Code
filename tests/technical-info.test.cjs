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
test("identifiant de l'accueil actif : mise à jour en attente ignorée, puis identifiant exact hors ligne après activation",async t=>{
 const {context,page,host,prepared}=await fixture(t),first=buildId(prepared.output.get("sw.js"));
 assert.equal(await page.locator("#technicalInfo").getAttribute("open"),null);
 const id=await openInfo(page);assert.equal(await id.textContent(),first.slice(0,8));assert.equal(await id.getAttribute("title"),first);
 const next=new Map(prepared.output);
 next.set("boot.js",Buffer.from(fs.readFileSync(path.join(root,"boot.js"),"utf8").replace(/\r\n/g,"\n")+"\n// Nouvelle copie d’accueil pour le test.\n"));
 next.set("sw.js",prepareShell(root,next));const second=buildId(next.get("sw.js"));assert.notEqual(first,second);
 host.state.virtual.set("/boot.js",next.get("boot.js"));host.state.virtual.set("/sw.js",next.get("sw.js"));
 await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
 await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
 await page.locator("#technicalInfo summary").click();await openInfo(page);
 assert.equal(await id.getAttribute("title"),first);
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(await (await openInfo(page)).getAttribute("title"),first);
 await page.close();
 const workers=context.serviceWorkers();
 await workers[workers.length-1].evaluate(()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{clearInterval(poll);reject(Error("Activation absente"));},10000);
  const poll=setInterval(()=>{if(!self.registration.waiting&&self.registration.active?.state==="activated"){clearInterval(poll);clearTimeout(timer);resolve();}},50);
 }));
 const reopened=await context.newPage();await reopened.goto(host.url);await reopened.waitForFunction(()=>!document.getElementById("create").disabled);
 assert.equal(await (await openInfo(reopened)).getAttribute("title"),second);
});
test("informations de sortie : version réellement chargée, reprise hors réseau, effacement après suppression",async t=>{
 const {page,context,host,prepared}=await fixture(t);
 await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor({state:"visible"});
 await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();
 await page.locator("#confirmOutingCreate").waitFor({state:"visible"});await page.locator("#confirmOutingCreate").click();
 await page.waitForFunction(()=>document.getElementById("testBanner").textContent.includes("Sortie enregistrée"));await page.locator("#closeOutingSuccess").click();
 await openInfo(page);const panel=page.locator("#technicalInfo");
 assert.match(await panel.innerText(),new RegExp("v"+prepared.version.replaceAll(".","\\.")));
 assert.match(await panel.innerText(),/PROTO 6/);assert.equal(await panel.locator("dd").nth(1).getAttribute("title"),prepared.id);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner").textContent.includes("Sortie retrouvée"));
 await openInfo(page);assert.equal(await panel.locator("dd").first().getAttribute("title"),buildId(prepared.output.get("sw.js")));
 await page.locator("#backHomeBtn").click();await page.waitForFunction(()=>!document.getElementById("create").disabled);
 await openInfo(page);assert.equal(await panel.locator("dd").nth(1).getAttribute("title"),prepared.id);
 await page.locator("#deleteOuting").click();await page.locator("#confirmDelete").click();await page.locator("#deleteDialog").waitFor({state:"hidden"});
 assert.equal(await panel.locator("dd").count(),1);assert.doesNotMatch(await panel.innerText(),/Application de cette sortie/);
 assert.equal(new URL(page.url()).href,host.url);
});

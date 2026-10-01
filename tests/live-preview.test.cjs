"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createLiveServer,LIVE_ID}=require("../tools/live-server.cjs");
const {chromium,browserOptions}=require("../tools/test-browser.cjs");
test("aperçu local : rechargement des sources sans créer une publication",async()=>{
 const root=path.resolve(__dirname,".."),before=fs.readdirSync(path.join(root,"releases")).sort(),latest=fs.readFileSync(path.join(root,"latest.json"),"utf8");
 const browser=await chromium.launch(browserOptions());let host;
 try{
  host=await createLiveServer();
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
  await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
  assert.equal(await page.locator("#outingMenu").count(),0);
  assert(await page.evaluate(()=>Math.abs(document.querySelector(".header-inner").getBoundingClientRect().left-document.getElementById("create").getBoundingClientRect().left)<1));
  assert.match(await page.locator("#create").innerText(),/🎣 Préparer une nouvelle sortie/);
  assert.equal(await page.locator("#receive").isVisible(),true);
  await page.locator("#technicalInfo summary").click();
  await page.waitForFunction(()=>document.querySelector("#technicalInfo dd").textContent==="Aperçu local — sources");
  const catalog=JSON.parse(fs.readFileSync(path.join(root,"releases.json"),"utf8"));
  const latestVersion=catalog.releases.find(row=>row.release===catalog.latest).version;
  await page.waitForFunction(()=>!document.getElementById("latestVersion").hidden);
  assert.match(await page.locator("#latestVersion").innerText(),new RegExp("v"+latestVersion.replaceAll(".","\\.")));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator("#create").click();await page.waitForURL("**/releases/"+LIVE_ID+"/app.html");
  await page.locator("#outingCreateDialog").waitFor({state:"visible"});
  assert.equal(await page.locator("#installAppBtn, #installHelp").count(),0);
  await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");
  await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").waitFor({state:"visible"});
  await page.locator("#confirmOutingCreate").click();await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie enregistrée"));
  await page.locator("#closeOutingSuccess").click();
  const source=fs.readFileSync(path.join(root,"sources/app.html"),"utf8");
  const edited=source.replace(" Accueil</button>"," Accueil modifié</button>");assert.notEqual(edited,source);
  host.state.overrides.set("/sources/app.html",Buffer.from(edited));
  host.state.overrides.set("/sources/engine.js",Buffer.from(fs.readFileSync(path.join(root,"sources/engine.js"),"utf8")+"\nwindow.__liveEngineEditSeen=true;\n"));
  await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
  assert.match(await page.locator("#backHomeBtn").innerText(),/Accueil modifié/);
  assert.equal(await page.evaluate(()=>window.__liveEngineEditSeen),true);
  assert.equal(await page.locator("#sessionCard").isVisible(),true);
  assert.equal(fs.readFileSync(path.join(root,"latest.json"),"utf8"),latest);
  assert.deepEqual(fs.readdirSync(path.join(root,"releases")).sort(),before);
  await context.close();
 }finally{await browser.close();if(host)await new Promise(resolve=>host.server.close(resolve));}
});

test("version différente au chargement : modale claire, sortie conservée et diagnostic consommé une seule fois",async()=>{
 const root=path.resolve(__dirname,".."),browser=await chromium.launch(browserOptions());let host;
 try{
  host=await createLiveServer();const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
  await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor({state:"visible"});
  await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();
  await page.locator("#confirmOutingCreate").waitFor({state:"visible"});await page.locator("#confirmOutingCreate").click();
  await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie enregistrée"));await page.locator("#closeOutingSuccess").click();
  await page.evaluate(()=>VHFIntegration.commit());
  const getActive=()=>page.evaluate(async()=>{const s=await import("/storage.js");return s.read(await s.openStore(),"active");});
  const original=await getActive(),engine=fs.readFileSync(path.join(root,"sources/engine.js"),"utf8");
  host.state.overrides.set("/sources/engine.js",Buffer.from(engine.replace(/const APP_VERSION="[^"]+"/,'const APP_VERSION="99.0.0"')));
  await page.reload();await page.locator("#outingLoadErrorDialog").waitFor({state:"visible"});
  assert.equal(page.url(),host.url);assert.match(await page.locator("#outingLoadErrorTitle").innerText(),/Impossible d’ouvrir cette sortie/);
  assert.match(await page.locator("#outingLoadErrorDialog").innerText(),/Réimporte.*invitation.*connexion Internet/);
  assert.match(await page.locator("#outingLoadErrorDialog").innerText(),/Ta sortie enregistrée est conservée/);
  assert.equal(await page.locator("#status").innerText(),"");assert.equal(await page.locator("#outingLoadDetails").getAttribute("open"),null);
  await page.locator("#outingLoadDetails summary").click();const diagnostic=await page.locator("#outingLoadDiagnostic").innerText();
  assert(diagnostic.includes(original.manifest.version));assert(diagnostic.includes("99.0.0"));
  assert.deepEqual(await getActive(),original);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.locator("#outingLoadErrorDialog").evaluate(el=>el.getBoundingClientRect().height<innerHeight*.8));
  fs.mkdirSync(path.join(root,"test-results"),{recursive:true});await page.screenshot({path:path.join(root,"test-results/outing-load-error-mobile.png")});
  host.state.overrides.set("/sources/engine.js",Buffer.from(engine));
  await page.locator("#closeOutingLoadError").click();await page.reload();await page.waitForFunction(()=>!document.getElementById("resume").disabled);
  assert.equal(await page.locator("#outingLoadErrorDialog").isVisible(),false);await page.locator("#resume").click();
  await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));assert.equal((await getActive()).id,original.id);
  await page.locator("#backHomeBtn").click();await page.waitForFunction(()=>!document.getElementById("resume").disabled);
  // Les publications déjà conservées peuvent encore transmettre l'ancien texte.
  await page.evaluate(()=>sessionStorage.setItem("vhfgps-live-error-v1","Le moteur ne correspond pas à la publication."));await page.reload();
  await page.locator("#outingLoadErrorDialog").waitFor({state:"visible"});assert.equal(await page.locator("#outingLoadDetails").isVisible(),false);
  assert.equal(await page.locator("#status").innerText(),"");await page.keyboard.press("Escape");assert.equal(await page.locator("#outingLoadErrorDialog").isVisible(),false);
  await context.close();
 }finally{await browser.close();if(host)await new Promise(resolve=>host.server.close(resolve));}
});

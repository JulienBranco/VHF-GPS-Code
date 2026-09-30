"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createLiveServer,LIVE_ID}=require("../tools/live-server.cjs");
let chromium;try{({chromium}=require("playwright"));}catch{({chromium}=require(path.join(process.env.USERPROFILE||process.env.HOME,".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")));}
const executablePath=process.env.VHF_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe";
test("aperçu local : rechargement des sources sans créer une publication",async()=>{
 const root=path.resolve(__dirname,".."),before=fs.readdirSync(path.join(root,"releases")).sort(),latest=fs.readFileSync(path.join(root,"latest.json"),"utf8");
 const host=await createLiveServer(),browser=await chromium.launch({headless:true,executablePath});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
  await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
  assert.equal(await page.locator("#outingMenu").count(),0);
  assert(await page.evaluate(()=>Math.abs(document.querySelector(".header-inner").getBoundingClientRect().left-document.getElementById("create").getBoundingClientRect().left)<1));
  assert.match(await page.locator("#create").innerText(),/🎣 Préparer une nouvelle sortie/);
  assert.equal(await page.locator("#receive").isVisible(),true);
  assert.equal(await page.locator(".install-guide").count(),1);
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
  host.state.overrides.set("/sources/app.html",Buffer.from(source.replace("⌂ Accueil</button>","⌂ Accueil modifié</button>")));
  host.state.overrides.set("/sources/engine.js",Buffer.from(fs.readFileSync(path.join(root,"sources/engine.js"),"utf8")+"\nwindow.__liveEngineEditSeen=true;\n"));
  await page.reload();await page.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));
  assert.match(await page.locator("#backHomeBtn").innerText(),/Accueil modifié/);
  assert.equal(await page.evaluate(()=>window.__liveEngineEditSeen),true);
  assert.equal(await page.locator("#sessionCard").isVisible(),true);
  assert.equal(fs.readFileSync(path.join(root,"latest.json"),"utf8"),latest);
  assert.deepEqual(fs.readdirSync(path.join(root,"releases")).sort(),before);
  await context.close();
 }finally{await browser.close();await new Promise(resolve=>host.server.close(resolve));}
});

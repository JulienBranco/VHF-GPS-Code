"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {prepareBuild}=require("../tools/build.cjs"),{createServer}=require("../tools/server.cjs"),{chromium,browserOptions}=require("../tools/test-browser.cjs");
async function fixture(t){
 const host=await createServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
 for(const [name,bytes]of prepareBuild().output)host.state.virtual.set("/"+name,bytes);
 const page=await browser.newPage();await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById("create").disabled);
 await page.locator("#create").click();await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").click();await page.locator("#closeOutingSuccess").click();
 const before=await active(page),secret=await page.evaluate(()=>activeSecret());
 await page.locator("#backHomeBtn").click();await page.locator("#create").click();await page.locator("#outingBuiltinSelect").selectOption("cap-corse-bastia");
 // Suivre la fin effective du contrôle, y compris après une sélection devenue obsolète.
 await page.evaluate(()=>{document.getElementById("checkOutingCreate").onclick=()=>{window.aliasSafetyReview=reviewOutingSetup();};});
 return {page,before,secret,preparingSecret:await page.evaluate(()=>activeSecret())};
}
async function active(page){return page.evaluate(async()=>{const s=await import("/storage.js");return s.read(await s.openStore(),"active");});}
async function review(page){await page.locator("#checkOutingCreate").click();await page.evaluate(()=>window.aliasSafetyReview);}

test("alias du catalogue : collision canonique rejetée avant activation, deuxième secret retenu",async t=>{
 const {page:p,before,preparingSecret:previous}=await fixture(t);
 await p.evaluate(()=>{
  window.aliasSafetyOriginalGenerate=generateSessionSecret;window.aliasSafetyOriginalAlias=zoneAlias;window.aliasSafetyAttempts=0;
  window.aliasSafetyBad="2222222-2222222-2222222-2222222";window.aliasSafetyGood="3333333-3333333-3333333-3333333";
  generateSessionSecret=()=>++window.aliasSafetyAttempts===1?window.aliasSafetyBad:window.aliasSafetyGood;
  zoneAlias=async(secret,z)=>{
   if(secret===window.aliasSafetyBad&&z.id===BUILTIN_ZONES[1].id){
    const alias=await window.aliasSafetyOriginalAlias(secret,BUILTIN_ZONES[0]);
    return {...alias,words:alias.words.map(w=>w.toLowerCase()),nato:alias.nato.toLowerCase(),text:alias.text.toLowerCase()};
   }
   return window.aliasSafetyOriginalAlias(secret,z);
  };
 });
 await review(p);
 assert.deepEqual(await active(p),before);assert.equal(await p.evaluate(()=>activeSecret()),previous);
 assert.deepEqual(await p.evaluate(()=>({attempts:window.aliasSafetyAttempts,pending:pendingOutingCreation.secret})),{attempts:2,pending:"3333333-3333333-3333333-3333333"});
 const summary=await p.locator("#outingCreateSummary").innerText();assert.match(summary,/CAP CORSE \/ BASTIA/);
 await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 assert.equal(await p.evaluate(()=>activeSecret()),"3333333-3333333-3333333-3333333");assert.notEqual((await active(p)).envelope.id,before.envelope.id);
 const aliases=await p.evaluate(async()=>Promise.all(BUILTIN_ZONES.map(async z=>(await window.aliasSafetyOriginalAlias(activeSecret(),z)).text)));
 assert.equal(new Set(aliases).size,34);assert.equal(await p.locator("#sendZone option").evaluateAll(nodes=>nodes.some(n=>n.textContent.includes("⚠"))),false);
 // Le garde-fou intervient à la préparation ; un rechargement garde le secret accepté.
 await p.reload();await p.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));assert.equal(await p.evaluate(()=>activeSecret()),"3333333-3333333-3333333-3333333");
});

test("alias du catalogue : collisions persistantes, refus borné et sortie précédente préservée",async t=>{
 const {page:p,before,secret,preparingSecret}=await fixture(t);
 await p.evaluate(()=>{
  window.aliasSafetyOriginalGenerate=generateSessionSecret;window.aliasSafetyOriginalAlias=zoneAlias;window.aliasSafetyAttempts=0;
  generateSessionSecret=()=>{window.aliasSafetyAttempts++;return window.aliasSafetyOriginalGenerate();};
  zoneAlias=async()=>({words:["THON","BAR"],nato:"ALFA",text:"THON · BAR | ALFA"});
 });
 await review(p);
 assert.equal(await p.evaluate(()=>window.aliasSafetyAttempts),16);assert.equal(await p.evaluate(()=>pendingOutingCreation),null);
 assert.equal(await p.locator("#confirmOutingCreate").isVisible(),false);assert.equal(await p.locator("#checkOutingCreate").isEnabled(),true);
 assert.match(await p.locator("#outingCreateError").innerText(),/alias de catalogue distincts/);assert.deepEqual(await active(p),before);assert.equal(await p.evaluate(()=>activeSecret()),preparingSecret);
 await p.evaluate(()=>{generateSessionSecret=window.aliasSafetyOriginalGenerate;zoneAlias=window.aliasSafetyOriginalAlias;});await review(p);assert.equal(await p.locator("#confirmOutingCreate").isVisible(),true);
 await p.locator("#closeOutingCreate").click();await p.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));assert.deepEqual(await active(p),before);assert.equal(await p.evaluate(()=>activeSecret()),secret);
});

test("alias du catalogue : sélection modifiée pendant le calcul, préparation obsolète abandonnée",async t=>{
 const {page:p,before,secret,preparingSecret}=await fixture(t);
 await p.evaluate(()=>{
  const originalAlias=zoneAlias,originalGenerate=generateSessionSecret;window.aliasSafetyAttempts=0;
  generateSessionSecret=()=>{window.aliasSafetyAttempts++;return originalGenerate();};
  zoneAlias=async(s,z)=>{
   if(z.id===BUILTIN_ZONES[0].id){await new Promise(resolve=>window.aliasSafetyRelease=resolve);}
   return originalAlias(s,z);
  };
 });
 await p.locator("#checkOutingCreate").click();await p.waitForFunction(()=>typeof window.aliasSafetyRelease==="function");
 await p.locator("#outingBuiltinSelect").selectOption("dunkerque");await p.evaluate(()=>window.aliasSafetyRelease());await p.evaluate(()=>window.aliasSafetyReview);
 assert.equal(await p.evaluate(()=>window.aliasSafetyAttempts),1);assert.equal(await p.evaluate(()=>pendingOutingCreation),null);
 assert.equal(await p.locator("#confirmOutingCreate").isVisible(),false);assert.equal(await p.locator("#checkOutingCreate").isEnabled(),true);assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"dunkerque");
 assert.deepEqual(await active(p),before);assert.equal(await p.evaluate(()=>activeSecret()),preparingSecret);
 await p.locator("#cancelOutingCreate").click();await p.waitForFunction(()=>document.getElementById("testBanner")?.textContent.includes("Sortie retrouvée"));assert.equal(await p.evaluate(()=>activeSecret()),secret);
});

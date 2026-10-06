"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {prepareBuild}=require("../tools/build.cjs"),{createServer}=require("../tools/server.cjs"),{chromium,browserOptions}=require("../tools/test-browser.cjs");
async function fixture(t,options={}){
 const host=await createServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
 for(const [name,bytes]of prepareBuild().output)host.state.virtual.set("/"+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844},...options}),page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(host.url);await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor();
 return {host,context,page,errors};
}
async function preparationReady(page){await page.waitForFunction(()=>document.getElementById("outingCreateDialog")?.open&&document.getElementById("outingCatalogMapStatus")?.hidden&&document.getElementById("outingCatalogMapSvg").getAttribute("viewBox"));}
async function point(page,prefix,id){
 const target=page.locator("#"+prefix+"Svg");await target.scrollIntoViewIfNeeded();
 const coords=await page.locator('#'+prefix+'Svg [data-zone="'+id+'"] .catalog-map-center').evaluate(e=>{const p=new DOMPoint(e.cx.baseVal.value,e.cy.baseVal.value).matrixTransform(e.ownerSVGElement.getScreenCTM());return {x:p.x,y:p.y};});await page.mouse.click(coords.x,coords.y);
}
async function ready(page,button){await page.locator(button).click();await page.waitForFunction(()=>document.getElementById("catalogMapDialog").open&&document.getElementById("catalogMapStatus").hidden);}

test("préparation : une seule modale, choix carte/liste/rose synchronisé avant confirmation",async t=>{
 const {page:p,errors}=await fixture(t);await preparationReady(p);const before=await p.evaluate(()=>({zone:activeZoneId,secret:activeSecret()}));
 assert.equal(await p.locator("dialog[open]").count(),1);assert.equal(await p.locator("#outingBuiltinSelectMapBtn").count(),0);assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"");assert.equal(await p.locator("#checkOutingCreate").isEnabled(),false);
 for(const [width,theme]of [[320,"day"],[390,"night"],[900,"day"]]){
  await p.setViewportSize({width,height:844});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.locator("#outingCatalogMapFrance").click();
  assert.equal(await p.locator("#outingCreateDialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);
  assert.equal(await p.locator("#outingCatalogMapSvg").evaluate(svg=>{const v=svg.viewBox.baseVal;return [...svg.querySelectorAll("rect")].every(r=>{const x=+r.getAttribute("x"),y=+r.getAttribute("y"),w=+r.getAttribute("width"),h=+r.getAttribute("height");return x>=v.x&&y>=v.y&&x+w<=v.x+v.width&&y+h<=v.y+v.height;});}),true);
 }
 await p.setViewportSize({width:390,height:844});await p.locator("#outingCatalogMapFrance").click();await point(p,"outingCatalogMap","dunkerque");
 assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"dunkerque");assert.equal(await p.locator("#checkOutingCreate").isEnabled(),true);
 assert.equal(await p.evaluate(()=>{const expected=document.createElement("div");expected.innerHTML=zoneBoundsCompass(BUILTIN_ZONES.find(z=>z.id==="dunkerque"));return expected.querySelector(".zone-bound-grid").outerHTML===document.querySelector("#outingBoundsPreview .zone-bound-grid").outerHTML;}),true);
 await p.locator("#outingBuiltinSelect").selectOption("ajaccio-calvi");assert.equal(await p.locator("#outingCatalogMap").getAttribute("data-zone"),"ajaccio-calvi");assert.equal(await p.locator('#outingCatalogMapSvg [data-zone="ajaccio-calvi"]').getAttribute("class"),"is-selected");
 await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").waitFor();assert.equal(await p.evaluate(()=>pendingOutingCreation.candidate.id),"ajaccio-calvi");
 await p.locator("#outingCatalogMapFrance").click();await point(p,"outingCatalogMap","nice-menton");assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"nice-menton");assert.equal(await p.evaluate(()=>pendingOutingCreation),null);assert.equal(await p.locator("#confirmOutingCreate").isVisible(),false);assert.deepEqual(await p.evaluate(()=>({zone:activeZoneId,secret:activeSecret()})),before);
 const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.locator("#outingBuiltinFields").scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,"preparation-interactive-mobile.png")});
 const old=await p.locator("#outingCatalogMapSvg").getAttribute("viewBox");await p.locator("#outingCatalogMapZoomIn").click();assert.notEqual(await p.locator("#outingCatalogMapSvg").getAttribute("viewBox"),old);
 const zoomed=await p.locator("#outingCatalogMapSvg").getAttribute("viewBox"),scrollBefore=await p.locator("#outingCreateDialog").evaluate(e=>e.scrollTop),box=await p.locator("#outingCatalogMapSvg").boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.wheel(0,160);
 await p.waitForFunction(top=>document.getElementById("outingCreateDialog").scrollTop>top,scrollBefore);assert.equal(await p.locator("#outingCatalogMapSvg").getAttribute("viewBox"),zoomed,"La molette fait défiler la préparation sans changer le zoom");
 await p.locator("#outingEphemeralChoice").click();assert.equal(await p.locator("#outingCatalogMap").isVisible(),false);await p.locator("#outingBuiltinChoice").click();assert.equal(await p.locator("#outingCatalogMap").isVisible(),true);assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"nice-menton");
 await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();assert.equal(await p.evaluate(()=>activeZoneId),"nice-menton");assert.deepEqual(errors,[]);
});

test("carte : catalogue public, emprises exactes et consultation sans changement de zone",async t=>{
 const {page:p,errors}=await fixture(t);await p.locator("#outingBuiltinSelect").selectOption("iroise-brest");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 const original=await p.evaluate(()=>({id:activeZoneId,confirmed:[...confirmedZoneIds],secret:activeSecret()}));await ready(p,"#sendZoneMapBtn");assert.equal(await p.locator("#catalogMapSvg [data-zone]").count(),34);assert.equal(await p.locator("#catalogMapSelect").inputValue(),"iroise-brest");
 for(const id of ["outingBuiltinSelect","catalogMapSelect"])assert.deepEqual(await p.locator("#"+id+" optgroup").evaluateAll(nodes=>nodes.map(e=>[e.label,e.children.length])),[["Atlantique",10],["Manche",10],["Mer du Nord",2],["Méditerranée",8],["Corse",4]]);
 const geometry=await p.evaluate(async()=>{const list=getCatalogMapZones(),engine=BUILTIN_ZONES.map(z=>{const center={...z,lat:canonicalCoord(z.lat),lon:canonicalCoord(z.lon)};return {id:z.id,bounds:zoneBounds(center)};});const {boundsRect}=await import("./catalog-map-model.js");return {fields:Object.keys(list[0]).sort(),match:list.every((z,i)=>JSON.stringify(z.bounds)===JSON.stringify(engine[i].bounds)),rect:boundsRect(list.find(z=>z.id==="iroise-brest").bounds),display:[...document.querySelector('#catalogMapSvg [data-zone="iroise-brest"] rect').attributes].filter(a=>["x","y","width","height"].includes(a.name)).map(a=>[a.name,Number(a.value)])};});
 assert.deepEqual(geometry.fields,["bounds","id","lat","lon","name","region"]);assert.equal(geometry.match,true);assert.deepEqual(Object.fromEntries(geometry.display),geometry.rect);
 for(const [width,theme]of [[390,"night"],[320,"day"],[900,"day"]]){
  await p.setViewportSize({width,height:844});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.locator("#catalogMapFrance").click();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.locator("#catalogMapDialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);
  assert.equal(await p.locator("#catalogMapSvg").evaluate(svg=>{const v=svg.viewBox.baseVal;return [...svg.querySelectorAll("[data-zone] rect")].every(r=>{const b={x:+r.getAttribute("x"),y:+r.getAttribute("y"),w:+r.getAttribute("width"),h:+r.getAttribute("height")};return b.x>=v.x&&b.y>=v.y&&b.x+b.w<=v.x+v.width&&b.y+b.h<=v.y+v.height;});}),true,"Toutes les emprises visibles en vue France à "+width+" px");
 }
 await p.setViewportSize({width:390,height:844});await p.locator("#catalogMapFrance").click();
 await p.locator('#catalogMapSvg [data-zone="iroise-brest"] .catalog-map-number').click();assert.equal(await p.locator("#catalogMapSelect").inputValue(),"iroise-brest");await p.locator("#catalogMapFrance").click();
 await p.locator('#catalogMapSvg [data-zone="dunkerque"] .catalog-map-center').click();assert.equal(await p.locator("#catalogMapSelect").inputValue(),"dunkerque");await p.locator("#catalogMapFrance").click();
 const mapBox=await p.locator("#catalogMapSvg").boundingBox(),panBefore=await p.locator("#catalogMapSvg").getAttribute("viewBox");await p.mouse.move(mapBox.x+mapBox.width*.8,mapBox.y+mapBox.height*.5);await p.mouse.down();await p.mouse.move(mapBox.x+mapBox.width*.7,mapBox.y+mapBox.height*.6,{steps:5});await p.mouse.up();assert.notEqual(await p.locator("#catalogMapSvg").getAttribute("viewBox"),panBefore);await p.locator("#catalogMapFrance").click();
const overview=await p.locator("#catalogMapSvg").getAttribute("viewBox");await p.locator("#catalogMapSelect").selectOption("la-rochelle-re");assert.notEqual(await p.locator("#catalogMapSvg").getAttribute("viewBox"),overview);assert.equal(await p.locator("#sendZone").inputValue(),"iroise-brest");
 const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.screenshot({path:path.join(shots,"zone-mobile-day.png")});await p.locator("#catalogMapFrance").click();await p.evaluate(()=>document.documentElement.dataset.theme="night");await p.screenshot({path:path.join(shots,"france-mobile-night.png")});
 const before=await p.locator("#catalogMapSvg").getAttribute("viewBox");await p.locator("#catalogMapZoomIn").click();assert.notEqual(await p.locator("#catalogMapSvg").getAttribute("viewBox"),before);
 await p.locator("#catalogMapClose").click();assert.equal(await p.locator("#outingCreateDialog").isVisible(),false);assert.equal(await p.locator("#sendZoneMapBtn").evaluate(e=>e===document.activeElement),true);
 for(const [tab,button]of [["#tabSend","#sendZoneMapBtn"],["#tabReceive","#recvZoneMapBtn"]]){await p.locator(tab).click();await ready(p,button);await p.locator("#catalogMapSelect").selectOption("arcachon");await p.locator("#catalogMapClose").click();assert.deepEqual(await p.evaluate(()=>({id:activeZoneId,confirmed:[...confirmedZoneIds],secret:activeSecret()})),original);}
 assert.deepEqual(errors,[]);
});
test("carte embarquée : reprise et consultation sans réseau ni requête externe",async t=>{
 const {page:p,context,host,errors}=await fixture(t);await p.locator("#outingBuiltinSelect").selectOption("iroise-brest");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 const external=[];p.on("request",r=>{if(!r.url().startsWith(host.url))external.push(r.url());});await context.setOffline(true);await p.reload();await ready(p,"#sendZoneMapBtn");await p.locator("#catalogMapSelect").selectOption("rochebonne");assert.match(await p.locator("#catalogMapSelection").textContent(),/ROCHEBONNE/);await p.locator("#catalogMapClose").click();
 await context.setOffline(false);await p.locator("#backHomeBtn").click();await p.locator("#create").click();await preparationReady(p);await context.setOffline(true);await point(p,"outingCatalogMap","dunkerque");assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"dunkerque");assert.equal(await p.locator("dialog[open]").count(),1);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
});
for(const variant of ["disabled","unavailable"]){
 test(`module cartographique ${variant} : préparation et émission restent disponibles`,async t=>{
  const {createLiveServer}=require("../tools/live-server.cjs"),host=await createLiveServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
  if(variant==="disabled")host.state.overrides.set("/sources/runtime.js",Buffer.from(fs.readFileSync(path.resolve(__dirname,"../sources/runtime.js"),"utf8").replace("const CATALOG_MAP_ENABLED=true;","const CATALOG_MAP_ENABLED=false;")));
  else host.state.overrides.set("/sources/catalog-map.js",Buffer.from('throw new Error("Panne simulée du module cartographique");'));
  const page=await browser.newPage();await page.goto(host.url);await page.locator("#create").click();await page.locator("#outingCreateDialog").waitFor();assert.equal(await page.locator(".catalog-map-trigger").count(),0);assert.equal(await page.locator("#catalogMapDialog").count(),0);
  await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").click();await page.locator("#closeOutingSuccess").click();
  await page.evaluate(()=>{setPositionInputMode("decimal");const z=activeZone();document.getElementById("lat").value=String(z.lat);document.getElementById("lon").value=String(z.lon);refreshEncodeState();});await page.locator("#encodeBtn").click();await page.locator("#encodedBlock").waitFor();
 });
}
test("aperçus automatiques : sous la rose, centrés et synchronisés avec la sélection",async t=>{
 const {page:p,context,errors}=await fixture(t);
 assert.equal(await p.locator("#outingBuiltinSelectMapPreview").count(),0);
 async function preview(id,zone){
  await p.waitForFunction(({id,zone})=>{const e=document.getElementById(id+"MapPreview");return e?.dataset.zone===zone&&!e.hidden&&e.querySelector(".catalog-map-inline-status").hidden&&e.querySelector("svg").getAttribute("viewBox");},{id,zone});
  const layout=await p.locator("#"+id+"MapPreview").evaluate(e=>{const svg=e.querySelector("svg"),view=svg.viewBox.baseVal,rect=svg.querySelector("rect"),r={x:+rect.getAttribute("x"),y:+rect.getAttribute("y"),width:+rect.getAttribute("width"),height:+rect.getAttribute("height")};return {afterRose:e.previousElementSibling.matches(".zone-bound-grid"),contains:view.x<=r.x&&view.y<=r.y&&view.x+view.width>=r.x+r.width&&view.y+view.height>=r.y+r.height,centerX:Math.abs(view.x+view.width/2-r.x-r.width/2),centerY:Math.abs(view.y+view.height/2-r.y-r.height/2),overflow:e.scrollWidth>e.clientWidth};});
  assert.equal(layout.afterRose,true);assert.equal(layout.contains,true);assert(layout.centerX<1e-5&&layout.centerY<1e-5);assert.equal(layout.overflow,false);
 }
 await p.locator("#outingBuiltinSelect").selectOption("la-rochelle-re");
 const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.locator("#outingBoundsPreview").scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,"inline-preparation.png")});
 await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();await preview("sendZone","la-rochelle-re");
 await p.locator("#sendZone").selectOption("arcachon");await p.locator("#cancelZoneSwitch").click();await p.waitForFunction(()=>pendingZoneSwitch===null);await preview("sendZone","la-rochelle-re");
 await p.locator("#sendZone").selectOption("arcachon");await p.locator("#confirmZoneSwitch").click();await preview("sendZone","arcachon");assert.equal(await p.locator("#sendZoneCard").getAttribute("data-validation"),"pending");
 await p.locator("#tabReceive").click();await preview("recvZone","arcachon");
 for(const [width,theme]of [[320,"day"],[390,"night"]]){await p.setViewportSize({width,height:844});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await preview("recvZone","arcachon");assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await p.locator("#recvZoneMapPreview").scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,"inline-application.png")});
 await context.setOffline(true);await p.reload();await preview("sendZone","arcachon");assert.deepEqual(errors,[]);
});

test("zone éphémère : carte après vérification, limites exactes et brouillon modifié retiré",async t=>{
 const {page:p,errors}=await fixture(t);await p.locator("#outingEphemeralChoice").click();await p.locator("#outingDecimalMode").click();await p.locator("#outingLat").fill("46.2");await p.locator("#outingLon").fill("-2.4");
 assert.equal(await p.locator("#outingEphemeralMapPreview").count(),0);assert.equal(await p.evaluate(()=>getPreparedEphemeralMapZone()),null);
 async function checked(){await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").waitFor();await p.waitForFunction(()=>{const e=document.getElementById("outingEphemeralMapPreview");return e&&!e.hidden&&e.querySelector(".catalog-map-inline-status").hidden&&e.querySelector("svg").getAttribute("viewBox");});}
 await checked();
 const geometry=await p.evaluate(async()=>{
  const value=getPreparedEphemeralMapZone(),candidate=pendingOutingCreation.candidate,{boundsRect,project}=await import("./catalog-map-model.js"),svg=document.querySelector("#outingEphemeralMapPreview svg"),rect=svg.querySelector("rect"),r=Object.fromEntries(["x","y","width","height"].map(k=>[k,+rect.getAttribute(k)]));
  return {fields:Object.keys(value).sort(),center:[value.lat,value.lon],candidate:[canonicalCoord(candidate.lat),canonicalCoord(candidate.lon)],bounds:value.bounds,expectedBounds:zoneBounds({...candidate,lat:canonicalCoord(candidate.lat),lon:canonicalCoord(candidate.lon)}),rect:r,expectedRect:boundsRect(value.bounds),contains:svg.viewBox.baseVal.x<=r.x&&svg.viewBox.baseVal.y<=r.y&&svg.viewBox.baseVal.x+svg.viewBox.baseVal.width>=r.x+r.width&&svg.viewBox.baseVal.y+svg.viewBox.baseVal.height>=r.y+r.height,afterRose:document.getElementById("outingEphemeralMapPreview").previousElementSibling.matches(".zone-bound-grid"),leaksSecret:document.getElementById("outingEphemeralMapPreview").outerHTML.includes(pendingOutingCreation.secret)};
 });
 assert.deepEqual(geometry.fields,["bounds","id","lat","lon","name"]);assert.deepEqual(geometry.center,geometry.candidate);assert.deepEqual(geometry.bounds,geometry.expectedBounds);assert.deepEqual(geometry.rect,geometry.expectedRect);assert.equal(geometry.contains,true);assert.equal(geometry.afterRose,true);assert.equal(geometry.leaksSecret,false);
 const before=await p.evaluate(()=>({active:activeZoneId,draft:JSON.stringify(pendingOutingCreation)}));await p.locator("#outingEphemeralMapPreview svg").click();assert.deepEqual(await p.evaluate(()=>({active:activeZoneId,draft:JSON.stringify(pendingOutingCreation)})),before);
 for(const [width,theme]of [[320,"day"],[390,"night"],[900,"day"]]){await p.setViewportSize({width,height:844});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await p.locator("#outingCreateDialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);}
 await p.setViewportSize({width:390,height:844});const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.locator("#outingEphemeralMapPreview").scrollIntoViewIfNeeded();await p.screenshot({path:path.join(shots,"ephemeral-preparation-mobile.png")});
 const old=geometry.rect;await p.locator("#outingLat").fill("48.6");await p.waitForFunction(()=>!document.getElementById("outingEphemeralMapPreview"));assert.equal(await p.evaluate(()=>getPreparedEphemeralMapZone()),null);assert.equal(await p.locator("#confirmOutingCreate").isVisible(),false);
 await checked();const updated=await p.locator("#outingEphemeralMapPreview rect").evaluate(e=>Object.fromEntries(["x","y","width","height"].map(k=>[k,+e.getAttribute(k)])));assert.notDeepEqual(updated,old,"Le même identifiant de brouillon affiche la nouvelle emprise");
 await p.locator("#outingBuiltinChoice").click();await p.waitForFunction(()=>!document.getElementById("outingEphemeralMapPreview"));assert.equal(await p.locator("#outingCatalogMap").isVisible(),true);assert.equal(await p.evaluate(()=>pendingOutingCreation),null);assert.deepEqual(errors,[]);
});

test("zone éphémère hors fond : rose conservée et activation possible sans carte",async t=>{
 const {page:p,errors}=await fixture(t);await p.locator("#outingEphemeralChoice").click();await p.locator("#outingDecimalMode").click();await p.locator("#outingLat").fill("30");await p.locator("#outingLon").fill("-80");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").waitFor();
 const data=await p.evaluate(async()=>{const {isWithinMapCoverage}=await import("./catalog-map-model.js");return {draft:!!pendingOutingCreation,covered:isWithinMapCoverage(getPreparedEphemeralMapZone().bounds)};});assert.deepEqual(data,{draft:true,covered:false});
 assert.equal(await p.locator("#outingEphemeralMapPreview").count(),0);assert.equal(await p.locator("#outingBoundsPreview .zone-bound-grid").isVisible(),true);
 await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();assert.equal(await p.evaluate(()=>activeZone().ephemeral),true);assert.deepEqual(errors,[]);
});


test("carte application : activation explicite, annulation et validation radio conservées",async t=>{
 const {page:p,errors}=await fixture(t);await p.locator("#outingBuiltinSelect").selectOption("iroise-brest");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 await p.evaluate(()=>{setPositionInputMode("decimal");document.getElementById("lat").value="48.4";document.getElementById("lon").value="-5";refreshEncodeState();});await p.locator("#encodeBtn").click();await p.locator("#encodedBlock").waitFor();
 const original=await p.evaluate(()=>({id:activeZoneId,secret:activeSecret(),lat:document.getElementById("lat").value,lon:document.getElementById("lon").value,confirmed:[...confirmedZoneIds]}));
 await ready(p,"#sendZoneMapBtn");assert.match(await p.locator("#sendZoneMapBtn").textContent(),/Voir carte des zones/);assert.equal(await p.locator("#catalogMapUse").isDisabled(),true);assert.match(await p.locator("#catalogMapActive").textContent(),/IROISE/);assert.equal(await p.locator('#catalogMapSvg [data-zone="iroise-brest"]').evaluate(e=>e.classList.contains("is-active")),true);
 await p.locator("#catalogMapFrance").click();await point(p,"catalogMap","dunkerque");assert.equal(await p.locator("#catalogMapSelect").inputValue(),"dunkerque");assert.equal(await p.locator("#catalogMapUse").isEnabled(),true);
 assert.deepEqual(await p.evaluate(()=>({id:activeZoneId,secret:activeSecret(),lat:document.getElementById("lat").value,lon:document.getElementById("lon").value,confirmed:[...confirmedZoneIds]})),original);
 await p.locator("#catalogMapUse").click();await p.locator("#zoneSwitchDialog").waitFor();assert.equal(await p.locator("dialog[open]").count(),1);assert.equal(await p.locator("#catalogMapDialog").isVisible(),false);await p.locator("#cancelZoneSwitch").click();await p.waitForFunction(()=>pendingZoneSwitch===null);
 assert.deepEqual(await p.evaluate(()=>({id:activeZoneId,secret:activeSecret(),lat:document.getElementById("lat").value,lon:document.getElementById("lon").value,confirmed:[...confirmedZoneIds]})),original);assert.equal(await p.locator("#sendZoneMapBtn").evaluate(e=>e===document.activeElement),true);
 await ready(p,"#sendZoneMapBtn");await p.locator("#catalogMapSelect").selectOption("dunkerque");await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZoneId==="dunkerque");assert.equal(await p.locator("#sendZoneCard").getAttribute("data-validation"),"pending");assert.equal(await p.locator("#encodeBtn").isDisabled(),true);assert.equal(await p.locator("#lat").inputValue(),"");assert.equal(await p.locator("#encodedBlock").isVisible(),false);
 await p.locator("#tabReceive").click();await ready(p,"#recvZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),"dunkerque");await p.locator("#catalogMapSelect").selectOption("arcachon");await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZoneId==="arcachon");assert.equal(await p.locator("#recvZone").inputValue(),"arcachon");assert.equal(await p.locator("#sendZone").inputValue(),"arcachon");assert.equal(await p.evaluate(()=>activeSecret()),original.secret);
 // Un ancien contexte ne peut pas activer une zone après un autre changement.
 assert.match(await p.evaluate(async()=>{try{await activateMapZone("dunkerque",{activeId:"iroise-brest",sessionRevision:activeSessionRevision});return "accepted";}catch(e){return e.message;}}),/zone active a changé/);assert.equal(await p.evaluate(()=>activeZoneId),"arcachon");assert.deepEqual(errors,[]);
});

test("carte application : zones éphémères et personnalisées, géométrie réelle et liste actualisée",async t=>{
 const {page:p,context,errors}=await fixture(t);await p.locator("#outingEphemeralChoice").click();await p.locator("#outingDecimalMode").click();await p.locator("#outingLat").fill("46.2");await p.locator("#outingLon").fill("-2.4");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 const ephemeralId=await p.evaluate(()=>activeZoneId);await ready(p,"#sendZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),ephemeralId);assert.equal(await p.locator('#catalogMapSelect optgroup[label="Zones éphémères de la sortie"] option').count(),1);
 const geometry=await p.evaluate(async()=>{const state=getApplicationMapState(),z=activeZone(),item=state.zones.find(v=>v.id===z.id),{boundsRect}=await import("./catalog-map-model.js"),rect=document.querySelector('#catalogMapSvg [data-zone="'+z.id+'"] rect');return {keys:Object.keys(item).sort(),type:item.type,center:[item.lat,item.lon],expected:[canonicalCoord(z.lat),canonicalCoord(z.lon)],rect:Object.fromEntries(["x","y","width","height"].map(k=>[k,+rect.getAttribute(k)])),expectedRect:boundsRect(item.bounds)};});
 assert.deepEqual(geometry.keys,["bounds","compass","id","lat","lon","name","region","type"]);assert.equal(geometry.type,"ephemeral");assert.deepEqual(geometry.center,geometry.expected);assert.deepEqual(geometry.rect,geometry.expectedRect);
 await p.locator("#catalogMapSelect").selectOption("iroise-brest");await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZoneId==="iroise-brest");
 await p.locator('summary').filter({hasText:"Gérer les zones personnalisées"}).click();await p.locator("#zoneName").fill("MA ZONE TEST");await p.locator("#zoneCenterModeDecimal").click();await p.locator("#zoneLat").fill("47.2");await p.locator("#zoneLon").fill("-3.4");await p.locator("#saveZoneBtn").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZone().name==="MA ZONE TEST");
 const customId=await p.evaluate(()=>activeZoneId);await ready(p,"#sendZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),customId);assert.equal(await p.locator('#catalogMapSelect optgroup[label="Zones personnalisées"] option').count(),1);assert.equal(await p.locator("#catalogMapSvg [data-zone]").count(),36);
 for(const [width,theme]of [[320,"day"],[390,"night"],[900,"day"]]){await p.setViewportSize({width,height:844});await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await p.locator("#catalogMapDialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);}
 await p.setViewportSize({width:390,height:844});const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.locator("#catalogMapDialog").screenshot({path:path.join(shots,"application-map-all-zones.png")});
 await p.locator("#catalogMapSelect").selectOption(ephemeralId);await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(id=>activeZoneId===id,ephemeralId);assert.equal(await p.locator("#ephemeralAliasConfirmBtn").isEnabled(),true);assert.equal(await p.locator("#encodeBtn").isDisabled(),true);
 await context.setOffline(true);await p.reload();await ready(p,"#sendZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),ephemeralId);assert.equal(await p.locator('#catalogMapSelect optgroup[label="Zones personnalisées"] option').count(),1);await p.locator("#catalogMapSelect").selectOption(customId);await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(id=>activeZoneId===id,customId);assert.deepEqual(errors,[]);
});

test("carte application hors couverture : accès conservé, rose et activation depuis la liste",async t=>{
 const {page:p,errors}=await fixture(t);await p.locator("#outingEphemeralChoice").click();await p.locator("#outingDecimalMode").click();await p.locator("#outingLat").fill("30");await p.locator("#outingLon").fill("-80");await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();
 const ephemeralId=await p.evaluate(()=>activeZoneId);assert.equal(await p.locator("#sendZoneMapPreview").count(),0);await ready(p,"#sendZoneMapBtn");assert.equal(await p.locator("#catalogMapFallback").isVisible(),true);assert.equal(await p.locator("#catalogMapSvg").isVisible(),false);assert.equal(await p.locator("#catalogMapFallback .zone-bound-grid").isVisible(),true);
 assert.equal(await p.locator("#catalogMapFallback .zone-bound-grid").evaluate(e=>e.outerHTML),await p.locator("#sendZoneSummary .zone-bound-grid").evaluate(e=>e.outerHTML));
 const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.locator("#catalogMapDialog").screenshot({path:path.join(shots,"application-map-outside.png")});
 await p.locator("#catalogMapSelect").selectOption("iroise-brest");assert.equal(await p.locator("#catalogMapSvg").isVisible(),true);assert.equal(await p.locator("#catalogMapFallback").isVisible(),false);await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZoneId==="iroise-brest");
 await ready(p,"#sendZoneMapBtn");await p.locator("#catalogMapSelect").selectOption(ephemeralId);assert.equal(await p.locator("#catalogMapFallback").isVisible(),true);assert.equal(await p.locator("#catalogMapUse").isEnabled(),true);await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(id=>activeZoneId===id,ephemeralId);assert.equal(await p.locator("#sendZoneMapPreview").count(),0);
 await p.locator("#tabReceive").click();await ready(p,"#recvZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),ephemeralId);assert.equal(await p.locator("#catalogMapFallback").isVisible(),true);await p.locator("#catalogMapClose").click();
 await p.locator('summary').filter({hasText:"Gérer les zones personnalisées"}).click();await p.locator("#zoneName").fill("ZONE POLAIRE");await p.locator("#zoneCenterModeDecimal").click();await p.locator("#zoneLat").fill("84.5");await p.locator("#zoneLon").fill("-75");await p.locator("#saveZoneBtn").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZone().name==="ZONE POLAIRE");
 const polarId=await p.evaluate(()=>activeZoneId);await ready(p,"#recvZoneMapBtn");assert.equal(await p.locator("#catalogMapSelect").inputValue(),polarId);assert.equal(await p.locator("#catalogMapFallback").isVisible(),true);assert.equal(await p.locator("#catalogMapSvg").isVisible(),false);assert.equal(await p.locator("#catalogMapFallback .zone-bound-grid").isVisible(),true);
 await p.locator("#catalogMapSelect").selectOption("iroise-brest");await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(()=>activeZoneId==="iroise-brest");await ready(p,"#recvZoneMapBtn");await p.locator("#catalogMapSelect").selectOption(polarId);await p.locator("#catalogMapUse").click();await p.locator("#confirmZoneSwitch").click();await p.waitForFunction(id=>activeZoneId===id,polarId);assert.deepEqual(errors,[]);
});


test("préparation vérifiée : défilement de la modale jusqu'au bouton d'activation",async t=>{
 const {page:p,host,errors}=await fixture(t);
 for(const [width,height,ephemeral]of [[390,844,false],[320,640,true],[900,720,false]]){
  await p.setViewportSize({width,height});
  if(ephemeral){await p.locator("#outingEphemeralChoice").click();await p.locator("#outingDecimalMode").click();await p.locator("#outingLat").fill("46.2");await p.locator("#outingLon").fill("-2.4");}
  else await p.locator("#outingBuiltinSelect").selectOption("la-rochelle-re");
  await p.locator("#checkOutingCreate").click();
  // Aucune action sur le bouton final : le défilement doit le rendre visible seul.
  await p.waitForFunction(()=>{
   const dialog=document.getElementById("outingCreateDialog"),button=document.getElementById("confirmOutingCreate");if(!dialog.open||button.classList.contains("hidden")||button.disabled)return false;
   const d=dialog.getBoundingClientRect(),b=button.getBoundingClientRect();return b.top>=d.top&&b.bottom<=Math.min(d.bottom,innerHeight)&&Math.abs(dialog.scrollHeight-dialog.clientHeight-dialog.scrollTop)<2;
  });
  assert.equal(await p.locator("#outingCreateSummary").isVisible(),true);assert.equal(await p.evaluate(()=>pendingOutingCreation!==null),true);
  const shots=path.join(os.tmpdir(),"vhfgps-map-tests");fs.mkdirSync(shots,{recursive:true});await p.screenshot({path:path.join(shots,"preparation-reviewed-"+width+".png")});
  await p.locator("#cancelOutingCreate").click();await p.waitForURL(host.url);
  if(width!==900){await p.locator("#create").click();await p.locator("#outingCreateDialog").waitFor();}
 }
 assert.deepEqual(errors,[]);
});


test("cartes mobiles : pincement, déplacement et toucher sans sélection involontaire",async t=>{
 const {page:p,context,errors}=await fixture(t,{isMobile:true,hasTouch:true}),cdp=await context.newCDPSession(p);
 const frame=()=>p.evaluate(()=>new Promise(requestAnimationFrame));
 const touches=(type,points)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:3,radiusY:3,force:1}))});
 const view=prefix=>p.locator("#"+prefix+"Svg").evaluate(svg=>{const v=svg.viewBox.baseVal;return {x:v.x,y:v.y,width:v.width,height:v.height};});
 async function pinch(prefix,{from=60,to=120,dx=0,dy=0,onPoint=false,continueWithOne=false}={}){
  const svg=p.locator("#"+prefix+"Svg");await svg.scrollIntoViewIfNeeded();const box=await svg.boundingBox(),before=await view(prefix);
  let cx=box.x+box.width/2,cy=box.y+box.height/2;
  if(onPoint){const point=await svg.evaluate(svg=>{
   const box=svg.getBoundingClientRect();
   for(const circle of svg.querySelectorAll("[data-zone]:not(.is-selected) .catalog-map-center")){const p=new DOMPoint(circle.cx.baseVal.value,circle.cy.baseVal.value).matrixTransform(svg.getScreenCTM());if(p.x>box.left+45&&p.x<box.right-100&&p.y>box.top+30&&p.y<box.bottom-30)return {x:p.x,y:p.y};}
   return null;
  });assert(point,"Un point de zone différent est visible");cx=point.x+from/2;cy=point.y;}
  const anchor=[before.x+(cx-box.x)/box.width*before.width,before.y+(cy-box.y)/box.height*before.height];
  await touches("touchStart",[[1,cx-from/2,cy],[2,cx+from/2,cy]]);
  for(let i=1;i<=4;i++){const progress=i/4,distance=from+(to-from)*progress;await touches("touchMove",[[1,cx+dx*progress-distance/2,cy+dy*progress],[2,cx+dx*progress+distance/2,cy+dy*progress]]);await frame();}
  const after=await view(prefix);assert(Math.abs(after.width/before.width-from/to)<.015,"Le zoom suit l'écartement des doigts");
  if(to>from){const actual=[after.x+(cx+dx-box.x)/box.width*after.width,after.y+(cy+dy-box.y)/box.height*after.height];assert(Math.abs(actual[0]-anchor[0])<1e-4&&Math.abs(actual[1]-anchor[1])<1e-4,"Le point entre les doigts reste ancré pendant le zoom et le déplacement");}
  if(continueWithOne){
   const x=cx+dx-to/2,y=cy+dy;await touches("touchEnd",[]);await frame();assert.deepEqual(await view(prefix),after,"Lever les doigts ne fait pas sauter la carte");
   await touches("touchStart",[[1,x,y]]);await touches("touchMove",[[1,x+16,y+8]]);await frame();const moved=await view(prefix);assert.equal(moved.width,after.width);assert(Math.abs(moved.x-(after.x-16/box.width*after.width))<.001&&Math.abs(moved.y-(after.y-8/box.height*after.height))<.001,"Le déplacement à un doigt fonctionne après un pincement, à une fraction de pixel près");
  }
  await touches("touchEnd",[]);await frame();return {before,after};
 }
 await preparationReady(p);await p.locator("#outingBuiltinSelect").selectOption("iroise-brest");await p.locator("#checkOutingCreate").click();await p.waitForFunction(()=>{const d=document.getElementById("outingCreateDialog");return pendingOutingCreation&&Math.abs(d.scrollHeight-d.clientHeight-d.scrollTop)<2;});
 const draft=await p.evaluate(()=>({draft:JSON.stringify(pendingOutingCreation),active:activeZoneId,scale:visualViewport.scale}));await p.locator("#outingCatalogMapFrance").click();
 await pinch("outingCatalogMap",{onPoint:true,dx:12,dy:8,continueWithOne:true});await pinch("outingCatalogMap",{from:120,to:60});
 assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"iroise-brest");assert.deepEqual(await p.evaluate(()=>({draft:JSON.stringify(pendingOutingCreation),active:activeZoneId,scale:visualViewport.scale})),draft);
 // Une annulation du toucher libère les gestes suivants.
 const svg=p.locator("#outingCatalogMapSvg"),box=await svg.boundingBox();await touches("touchStart",[[1,box.x+80,box.y+80],[2,box.x+140,box.y+80]]);await touches("touchCancel",[]);await frame();await pinch("outingCatalogMap");
 // Un toucher simple reste un choix de zone, après plusieurs pincements.
 await p.locator("#outingCatalogMapFrance").click();await svg.scrollIntoViewIfNeeded();const coords=await p.locator('#outingCatalogMapSvg [data-zone="dunkerque"] .catalog-map-center').evaluate(e=>{const p=new DOMPoint(e.cx.baseVal.value,e.cy.baseVal.value).matrixTransform(e.ownerSVGElement.getScreenCTM());return {x:p.x,y:p.y};});await p.touchscreen.tap(coords.x,coords.y);assert.equal(await p.locator("#outingBuiltinSelect").inputValue(),"dunkerque");assert.equal(await p.evaluate(()=>pendingOutingCreation),null);
 await p.locator("#checkOutingCreate").click();await p.locator("#confirmOutingCreate").click();await p.locator("#closeOutingSuccess").click();await ready(p,"#sendZoneMapBtn");
 const active=await p.evaluate(()=>({id:activeZoneId,confirmed:[...confirmedZoneIds],secret:activeSecret(),scale:visualViewport.scale}));
 for(const width of [320,390]){await p.setViewportSize({width,height:844});await p.locator("#catalogMapFrance").click();await pinch("catalogMap",{onPoint:true,dx:12,dy:8,continueWithOne:true});await pinch("catalogMap",{from:120,to:60});assert.equal(await p.locator("#catalogMapSelect").inputValue(),"dunkerque");assert.equal(await p.locator("#catalogMapDialog").evaluate(e=>e.scrollWidth>e.clientWidth),false);}
 assert.deepEqual(await p.evaluate(()=>({id:activeZoneId,confirmed:[...confirmedZoneIds],secret:activeSecret(),scale:visualViewport.scale})),active);assert.deepEqual(errors,[]);
});

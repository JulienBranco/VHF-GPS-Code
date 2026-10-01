
"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepareBuild}=require('../tools/build.cjs'),{createServer}=require('../tools/server.cjs');
const {chromium,browserOptions}=require('../tools/test-browser.cjs');
const root=path.resolve(__dirname,'..'),key='vhfGpsPositionHistoryV1';
async function fixture(t){
 const prepared=prepareBuild(root),host=await createServer(),browser=await chromium.launch(browserOptions());
 for(const [name,bytes] of prepared.output)host.state.virtual.set('/'+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
  window.__gps={next:0,live:new Map(),emit(point){for(const h of this.live.values())h.ok({coords:{latitude:point.lat,longitude:point.lon,accuracy:5,speed:3,heading:0},timestamp:Date.now()});}};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok,error){const id=++__gps.next;__gps.live.set(id,{ok,error});return id;},clearWatch(id){__gps.live.delete(id);}}});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 async function ready(){await page.waitForFunction(()=>!!document.getElementById('create')&&!document.getElementById('create').disabled);}
 async function create(){
  await ready();await page.locator('#create').click();await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');
  await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').click();await page.locator('#closeOutingSuccess').click();
 }
 await page.goto(host.url);await create();
 return {page,context,host,prepared,errors,create,ready};
}
async function history(page){return page.evaluate(key=>JSON.parse(VHFIntegration.storage.getItem(key)||'{"entries":[]}').entries,key);}
async function generated(page,offset=.01){
 return page.evaluate(async offset=>{
  setPositionInputMode('decimal');const z=activeZone();document.getElementById('lat').value=String(z.lat+offset);document.getElementById('lon').value=String(z.lon);
  refreshEncodeState();const e=await encodeSelectedPosition();await VHFIntegration.commit();return {lat:e.lat,lon:e.lon,phrase:e.phrase,zone:e.z.name};
 },offset);
}
async function received(page){
 await page.locator('#tabReceive').click();
 return page.evaluate(async()=>{
  clearReceivedMessage({focus:false});const z=activeZone(),e=await encodeCore(z.lat,z.lon,activeSecret(),z);
  wordInputs.forEach((input,i)=>input.value=e.phrase.words[i]);receiverConnector=e.phrase.connector;await runDecode();
  return {final:protocolToken(e.finalConfirm),lat:currentDecodedResult.lat,lon:currentDecodedResult.lon};
 });
}
async function confirm(page,word){await page.locator('#finalConfirmChoices button').evaluateAll((buttons,word)=>buttons.find(b=>b.dataset.word===word).click(),word);}
async function count(page,n){await page.waitForFunction(n=>document.getElementById('positionHistoryCount').textContent===String(n),n);}
async function expand(page){await page.locator('#positionHistory').evaluate(el=>el.open=true);await page.waitForFunction(()=>!!document.querySelector('.history-entry'));}

test('journal unique : génération validée, réception finale seulement, erreurs et retries sans doublon',async t=>{
 const f=await fixture(t),{page}=f;
 const sent=await generated(page);await count(page,1);
 const stored=await history(page);assert.equal(stored[0].kind,'generated');assert.equal(stored[0].lat,sent.lat);assert.equal(stored[0].phrase,sent.phrase);
 const failed=await page.evaluate(async()=>{document.getElementById('lat').value='0';document.getElementById('lon').value='0';try{await encodeSelectedPosition();return false;}catch{return true;}});
 assert(failed);assert.equal((await history(page)).length,1);
 const incoming=await received(page);assert.equal((await history(page)).length,1);
 const wrong=await page.locator('#finalConfirmChoices button').evaluateAll((buttons,word)=>buttons.find(b=>b.dataset.word!==word).dataset.word,incoming.final);
 await confirm(page,wrong);assert.equal((await history(page)).length,1);
 await page.evaluate(()=>retryFinalRadioConfirmation());await confirm(page,incoming.final);await count(page,2);
 await page.evaluate(()=>markPositionConfirmed());await page.evaluate(()=>VHFIntegration.commit());assert.equal((await history(page)).length,2);
 await expand(page);assert.match(await page.locator('.history-entry').first().innerText(),/Reçu et confirmé/);
 const first=await history(page);assert.equal(first[1].lat,incoming.lat);assert(!Object.keys(first[1]).some(k=>/secret|key|ack|final/i.test(k)));
 await page.locator('#tabSend').click();await generated(page);await count(page,3);
 assert.equal(await page.locator('.history-entry').count(),3);assert.match(await page.locator('.history-entry').first().innerText(),/Généré/);
 assert.deepEqual(f.errors,[]);
});

test('suivre un ancien point généré ou reçu, indépendant des saisies et de la zone actuelle, mobile jour/nuit',async t=>{
 const f=await fixture(t),{page}=f;const sent=await generated(page),incoming=await received(page);await confirm(page,incoming.final);await count(page,2);
 await page.evaluate(()=>{clearReceivedMessage({focus:false});setActiveZone(zones.find(z=>z.builtin&&z.id!==activeZoneId).id);});
 await expand(page);assert.match(await page.locator('.history-generated .history-zone').innerText(),new RegExp(sent.zone));
 for(const kind of ['generated','received']){
  await page.locator('.history-'+kind+' .history-track').click();
  assert.match(await page.locator('#trackingTitle').innerText(),kind==='generated'?/généré/:/reçu/);
  const target=kind==='generated'?sent:incoming;
  await page.evaluate(point=>__gps.emit({...point,lat:point.lat-.04}),target);
  assert.equal(await page.evaluate(()=>__gps.live.size),1);assert.match(await page.locator('#trackingDistance').innerText(),/milles/);
  await page.evaluate(()=>invalidateDecodedResult());assert.equal(await page.locator('#pointTrackingDialog').isVisible(),true);
  await page.locator('#stopPointTracking').click();assert.equal(await page.evaluate(()=>__gps.live.size),0);
 }
 for(const theme of ['day','night']){
  await page.evaluate(theme=>applyTheme(theme),theme);await page.setViewportSize({width:320,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#positionHistory').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(root,'test-results','history-'+theme+'-320.png')});
 }
 assert.deepEqual(f.errors,[]);
});

test('journal sauvegardé dans la sortie, reprise hors réseau et suivi sans redécoder',async t=>{
 const f=await fixture(t),{page,context}=f;await generated(page);const incoming=await received(page);await confirm(page,incoming.final);await count(page,2);
 await page.evaluate(()=>VHFIntegration.commit());const before=await history(page);
 for(const name of ['position-history.js','position-history-model.js','position-history.css']){
  assert(f.prepared.output.has('releases/'+f.prepared.id+'/'+name));
  assert(await page.evaluate(async name=>{const id=location.pathname.split('/releases/')[1].split('/')[0];return !!await(await caches.open('vhfgps-main-release-'+id)).match(new URL('./'+name,location.href));},name));
 }
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));await count(page,2);
 assert.deepEqual(await history(page),before);assert.equal(await page.evaluate(()=>confirmedTrackingPoint()),null);
 await expand(page);await page.locator('.history-received .history-track').click();await page.evaluate(point=>__gps.emit({...point,lat:point.lat-.03}),incoming);
 assert.match(await page.locator('#trackingDistance').innerText(),/milles/);await page.locator('#closePointTracking').click();assert.equal(await page.evaluate(()=>__gps.live.size),0);
 assert.deepEqual(f.errors,[]);
});

test('une nouvelle sortie commence vide ; rejouer la même invitation retrouve son journal',async t=>{
 const f=await fixture(t),{page}=f;await generated(page);await count(page,1);
 const invitation=await page.evaluate(async()=>formatOutingInvitation(await activeOutingPayload())),before=await history(page);
 await page.locator('#backHomeBtn').click();await f.create();await count(page,0);assert.deepEqual(await history(page),[]);
 await page.locator('#backHomeBtn').click();await f.ready();await page.locator('#receive').click();await page.locator('#invitation').fill(invitation);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').click();await page.locator('#closeOutingSuccess').click();await count(page,1);
 assert.deepEqual(await history(page),before);await expand(page);assert.equal(await page.locator('.history-entry').count(),1);
 assert.deepEqual(f.errors,[]);
});

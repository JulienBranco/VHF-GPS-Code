
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

test('nouvelle sortie : ancienne supprimée ; ancienne invitation recréée avec un journal vide',async t=>{
 const f=await fixture(t),{page}=f;await generated(page);await count(page,1);
 const invitation=await page.evaluate(async()=>formatOutingInvitation(await activeOutingPayload()));
 const oldId=await page.evaluate(async()=>{const s=await import('./storage.js');return (await s.read(await s.openStore(),'active')).id;});
 await page.locator('#backHomeBtn').click();await f.create();await count(page,0);assert.deepEqual(await history(page),[]);
 assert.equal(await page.evaluate(async id=>{const s=await import('./storage.js');return s.read(await s.openStore(),'outing:'+id);},oldId),undefined);
 await page.locator('#backHomeBtn').click();await f.ready();await page.locator('#receive').click();await page.locator('#invitation').fill(invitation);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').click();await page.locator('#closeOutingSuccess').click();await count(page,0);
 assert.deepEqual(await history(page),[]);
 const keys=await page.evaluate(async()=>{const s=await import('./storage.js'),db=await s.openStore();return new Promise(resolve=>{const req=db.transaction('state').objectStore('state').getAllKeys();req.onsuccess=()=>{resolve(req.result.filter(k=>String(k).startsWith('outing:')));db.close();};});});
 assert.equal(keys.length,1);
 assert.deepEqual(f.errors,[]);
});


test('rejouer la sortie encore active conserve son journal et ses réglages',async t=>{
 const f=await fixture(t),{page}=f;await generated(page);await count(page,1);
 const invitation=await page.evaluate(async()=>formatOutingInvitation(await activeOutingPayload())),before=await history(page);
 await page.locator('#backHomeBtn').click();await f.ready();await page.locator('#receive').click();await page.locator('#invitation').fill(invitation);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').click();await page.locator('#closeOutingSuccess').click();await count(page,1);assert.deepEqual(await history(page),before);
 assert.deepEqual(f.errors,[]);
});

test('conservation unique et nettoyage des archives héritées ; échec transactionnel sans perte',async t=>{
 const f=await fixture(t),{page}=f;await generated(page);await count(page,1);await page.evaluate(()=>VHFIntegration.commit());
 const result=await page.evaluate(async()=>{
  const s=await import('./storage.js'),db=await s.openStore(),active=await s.read(db,'active');
  const all=()=>new Promise(resolve=>{const req=db.transaction('state').objectStore('state').getAllKeys();req.onsuccess=()=>resolve(req.result.filter(k=>String(k).startsWith('outing:')));});
  await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({...active,id:'old'},'outing:old');tx.objectStore('state').put({...active,id:'older'},'outing:older');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  await s.retainActiveOuting(db);const migrated=await all(),unchanged=await s.read(db,'active');
  const next={...active,id:'b'.repeat(32),envelope:{...active.envelope,id:'b'.repeat(32)},state:{vhfGpsSessionSecretV312:'nouveau-secret'}};
  // Faire échouer après la suppression des anciens enregistrements : la transaction doit tout restaurer.
  const original=IDBObjectStore.prototype.delete;let once=true;
  IDBObjectStore.prototype.delete=function(key){const request=original.call(this,key);if(once&&key==='outing:'+active.id){once=false;this.transaction.abort();}return request;};
  let rejected=false;
  try{await s.writeActive(db,next,active.revision,{install:true});}catch{rejected=true;}finally{IDBObjectStore.prototype.delete=original;}
  const afterFailure=await s.read(db,'active'),known=await s.read(db,'outing:'+active.id),keysAfterFailure=await all();
  const saved=await s.writeActive(db,next,active.revision,{install:true});const finalKeys=await all(),old=await s.read(db,'outing:'+active.id);
  db.close();return {migrated,unchanged,active,rejected,afterFailure,known,keysAfterFailure,finalKeys,saved,old};
 });
 assert.deepEqual(result.migrated,['outing:'+result.active.id]);assert.deepEqual(result.unchanged,result.active);
 assert(result.rejected);assert.deepEqual(result.afterFailure,result.active);assert.deepEqual(result.known,result.active);assert.deepEqual(result.keysAfterFailure,result.migrated);
 assert.deepEqual(result.finalKeys,['outing:'+result.saved.id]);assert.equal(result.old,undefined);
 assert.deepEqual(f.errors,[]);
});


test('ancienne invitation hors réseau : release complète conservée, données anciennes effacées puis sortie recréée',async t=>{
 const f=await fixture(t),{page,context}=f;await generated(page);await count(page,1);
 const invitation=await page.evaluate(async()=>formatOutingInvitation(await activeOutingPayload()));
 const first=await page.evaluate(async()=>{const s=await import('./storage.js');return s.read(await s.openStore(),'active');});
 await page.locator('#backHomeBtn').click();await f.create();await count(page,0);
 assert.equal(await page.evaluate(async id=>{const s=await import('./storage.js');return s.read(await s.openStore(),'outing:'+id);},first.id),undefined);
 await page.locator('#backHomeBtn').click();await f.ready();await context.setOffline(true);
 await page.locator('#receive').click();await page.locator('#invitation').fill(invitation);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').waitFor({state:'visible',timeout:5000});
 await page.locator('#confirmOutingImport').click();await page.locator('#closeOutingSuccess').click();await count(page,0);
 const restored=await page.evaluate(async()=>{const s=await import('./storage.js');return s.read(await s.openStore(),'active');});
 assert.equal(restored.id,first.id);assert.equal(restored.state.vhfGpsSessionSecretV312,first.state.vhfGpsSessionSecretV312);
 assert.deepEqual(await history(page),[]);assert.deepEqual(f.errors,[]);
});


test('suppression manuelle hors réseau : release conservée et invitation réinstallée sans journal',async t=>{
 const f=await fixture(t),{page,context}=f;await generated(page);await count(page,1);
 const invitation=await page.evaluate(async()=>formatOutingInvitation(await activeOutingPayload()));
 const first=await page.evaluate(async()=>{const s=await import('./storage.js');return s.read(await s.openStore(),'active');});
 await context.setOffline(true);await page.locator('#backHomeBtn').click();await f.ready();
 await page.locator('#deleteOuting').click();await page.locator('#confirmDelete').click();await page.locator('#deleteDialog').waitFor({state:'hidden'});
 const deleted=await page.evaluate(async id=>{const s=await import('/storage.js'),db=await s.openStore();return {active:await s.read(db,'active'),known:await s.read(db,'outing:'+id)};},first.id);
 assert.equal(deleted.active.deleted,true);assert.equal(deleted.known,undefined);
 assert(await page.evaluate(async id=>{const c=await caches.open('vhfgps-main-release-'+id);return !!await c.match(new URL('/releases/'+id+'/manifest.json',location.origin));},first.release));
 await page.locator('#receive').click();await page.locator('#invitation').fill(invitation);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').waitFor({state:'visible',timeout:5000});await page.locator('#confirmOutingImport').click();await page.locator('#closeOutingSuccess').click();await count(page,0);
 const restored=await page.evaluate(async()=>{const s=await import('./storage.js');return s.read(await s.openStore(),'active');});
 assert.equal(restored.id,first.id);assert.equal(restored.release,first.release);assert.equal(restored.state.vhfGpsSessionSecretV312,first.state.vhfGpsSessionSecretV312);
 assert.deepEqual(await history(page),[]);assert.deepEqual(f.errors,[]);
});

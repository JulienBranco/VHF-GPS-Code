"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareBuild}=require('../tools/build.cjs');
const {createServer}=require('../tools/server.cjs');
const {chromium,browserOptions}=require('../tools/test-browser.cjs');
function copied(text){return 'Bonjour !\n'+text.normalize('NFD').replaceAll('\n','\r\n').replace('Zone :','Zone\u202f:').replace('Alias de zone :','Alias\u00a0de zone :')+'\nBonne sortie !';}
async function installed(page){return page.evaluate(async()=>{const storage=await import('/storage.js');return storage.read(await storage.openStore(),'active');});}
async function receive(page,text){
 await page.locator('#receive').click();await page.locator('#invitation').fill(text);await page.locator('#receiveForm button[type=submit]').click();
 await page.locator('#confirmOutingImport').waitFor({state:'visible'});
}
async function confirm(page){
 await page.locator('#confirmOutingImport').click();await page.waitForFunction(()=>document.getElementById('testBanner').textContent.includes('Sortie enregistrée'));await page.locator('#closeOutingSuccess').click();
}
for(const sources of [true,false])test('copier-coller et rejeu réel : '+(sources?'sources actuelles et nouvelle vérification dans la modale':'ancienne publication conservée'),async t=>{
 const browser=await chromium.launch(browserOptions()),host=await createServer();
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 if(sources){const prepared=prepareBuild();for(const [name,bytes] of prepared.output)host.state.virtual.set('/'+name,bytes);}
 const sender=await browser.newContext(),page=await sender.newPage();await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById('create').disabled);
 await page.locator('#create').click();await page.locator('#outingCreateDialog').waitFor({state:'visible'});
 await page.locator('#outingEphemeralChoice').click();await page.locator('#outingDecimalMode').click();await page.locator('#outingLat').fill('46.2');await page.locator('#outingLon').fill('-2.4');
 await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').waitFor({state:'visible'});await page.locator('#confirmOutingCreate').click();
 await page.waitForFunction(()=>document.getElementById('testBanner').textContent.includes('Sortie enregistrée'));await page.locator('#closeOutingSuccess').click();
 const original=await installed(page),identity=await page.evaluate(()=>({session:document.getElementById('fingerprintWords').textContent,zone:document.getElementById('sendZoneAlias').textContent}));
 await page.locator('#shareOutingBtn').click();await page.waitForFunction(()=>document.getElementById('outingShareText').value.includes('VHF-SORTIE2.'));const invitation=await page.locator('#outingShareText').inputValue();
 const receiver=await browser.newContext(),other=await receiver.newPage();await other.goto(host.url);await other.waitForFunction(()=>!document.getElementById('receive').disabled);
 await receive(other,copied(invitation));
 if(sources){
  await other.locator('#outingImportText').fill(copied(invitation));await other.locator('#checkOutingBtn').click();
  await other.waitForFunction(()=>!!pendingOutingImport);assert.equal(await other.locator('#confirmOutingImport').isEnabled(),true);
 }
 await confirm(other);const first=await installed(other);
 assert.equal(first.id,original.id);assert.equal(first.release,original.release);
 assert.deepEqual(await other.evaluate(()=>({session:document.getElementById('fingerprintWords').textContent,zone:document.getElementById('sendZoneAlias').textContent})),identity);
 await other.locator('#backHomeBtn').click();await other.waitForFunction(()=>!document.getElementById('receive').disabled);
 // Les nouvelles sources savent aussi relire un résumé ancien en CRLF.
 if(sources)await other.evaluate(async()=>{
  const storage=await import('/storage.js'),db=await storage.openStore(),record=await storage.read(db,'active');const protocol=await import('/protocol.js'),parts=protocol.splitContent(record.envelope.content);record.envelope.content=protocol.joinContent(parts.summary.replaceAll('\n','\r\n'),parts.code);
  await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');store.put(record,'active');store.put(record,'outing:'+record.id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
 });
 await receiver.setOffline(true);await receive(other,copied(invitation));await confirm(other);const replay=await installed(other);
 assert.equal(replay.id,first.id);assert.equal(replay.release,first.release);assert.equal(replay.state.vhfGpsOutingInstalledAtV1,first.state.vhfGpsOutingInstalledAtV1);
 assert.deepEqual(await other.evaluate(()=>({session:document.getElementById('fingerprintWords').textContent,zone:document.getElementById('sendZoneAlias').textContent})),identity);
});

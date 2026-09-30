"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {prepareBuild}=require('../tools/build.cjs');
const {createServer}=require('../tools/server.cjs');
const {chromium,browserOptions}=require('../tools/test-browser.cjs');
test('invitation indisponible : erreur contextualisée, sortie conservée et rejeu local intact',async t=>{
 const browser=await chromium.launch(browserOptions()),host=await createServer(),prepared=prepareBuild();
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 for(const [name,bytes] of prepared.output)host.state.virtual.set('/'+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const active=()=>page.evaluate(async()=>{const s=await import('/storage.js');return s.read(await s.openStore(),'active');});
 await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById('create').disabled);
 await page.locator('#create').click();await page.locator('#outingCreateDialog').waitFor({state:'visible'});
 await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');await page.locator('#checkOutingCreate').click();
 await page.locator('#confirmOutingCreate').waitFor({state:'visible'});await page.locator('#confirmOutingCreate').click();
 await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie enregistrée'));await page.locator('#closeOutingSuccess').click();
 await page.locator('#shareOutingBtn').click();await page.waitForFunction(()=>document.getElementById('outingShareText').value.includes('VHF-SORTIE2.'));
 const invitation=await page.locator('#outingShareText').inputValue();
 await page.locator('#closeOutingShare').click();await page.evaluate(()=>VHFIntegration.commit());
 await page.locator('#backHomeBtn').click();await page.waitForFunction(()=>!document.getElementById('receive').disabled);
 const original=await active();
 const alter=release=>page.evaluate(async({text,release})=>{const p=await import('/protocol.js'),envelope=await p.unwrap(text);return p.wrap({...envelope,id:p.randomId(),release});},{text:invitation,release});
 const missing=await alter('f'.repeat(64));
 async function submit(text){await page.locator('#invitation').fill(text);await page.locator('#receiveForm button[type=submit]').click();}
 await page.locator('#receive').click();await submit(missing);
 await page.waitForFunction(()=>document.getElementById('importError').textContent.includes('Version de cette sortie indisponible'));
 const message=await page.locator('#importError').innerText();assert.match(message,/Demande au créateur une nouvelle invitation préparée avec la version actuelle/);assert.match(message,/Ta sortie active est conservée/);
 assert.equal(await page.locator('#status').innerText(),'');assert.equal(page.url(),host.url);assert.deepEqual(await active(),original);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-results/release-unavailable-mobile.png')});
 await page.locator('#invitation').fill(invitation);assert.equal(await page.locator('#importError').innerText(),'');assert.equal(await page.locator('#importError').getAttribute('class'),'');
 // Une publication présente, mais dont un fichier manque, ne doit pas être décrite comme purgée.
 const manifest=JSON.parse(prepared.output.get('releases/'+prepared.id+'/manifest.json'));manifest.version='0.0.0';
 const raw=JSON.stringify(manifest),partialId=crypto.createHash('sha256').update(raw).digest('hex');
 host.state.virtual.set('/releases/'+partialId+'/manifest.json',Buffer.from(raw));host.state.virtual.set('/releases/'+partialId+'/app.html',prepared.output.get('releases/'+prepared.id+'/app.html'));
 const partial=await alter(partialId);await submit(partial);
 await page.waitForFunction(()=>document.getElementById('importError').textContent.includes('Téléchargement incomplet'));
 assert.match(await page.locator('#importError').innerText(),/fichier.*introuvable/);assert.doesNotMatch(await page.locator('#importError').innerText(),/Demande au créateur/);assert.deepEqual(await active(),original);
 // Une panne réseau ne prouve pas qu'une publication a été retirée.
 await context.setOffline(true);await submit(missing);
 await page.waitForFunction(()=>document.getElementById('importError').textContent.includes('Connexion indisponible'));
 assert.doesNotMatch(await page.locator('#importError').innerText(),/Version de cette sortie indisponible/);assert.deepEqual(await active(),original);
 await page.locator('#closeReceive').click();assert.equal(await page.locator('#importError').innerText(),'');
 // La copie déjà vérifiée permet toujours de rejouer l'invitation sans réseau.
 await page.locator('#receive').click();await submit(invitation);await page.locator('#confirmOutingImport').waitFor({state:'visible'});
 await page.locator('#confirmOutingImport').click();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie enregistrée'));
 assert.equal((await active()).id,original.id);assert.equal((await active()).release,original.release);
});

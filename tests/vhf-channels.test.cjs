"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareBuild}=require('../tools/build.cjs'),{createServer}=require('../tools/server.cjs'),{chromium,browserOptions}=require('../tools/test-browser.cjs');
test('canaux partagés entre appareils, indépendants de la zone et disponibles hors réseau',async t=>{
 const host=await createServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
 for(const [name,bytes]of prepareBuild().output)host.state.virtual.set('/'+name,bytes);
 const sender=await browser.newContext({viewport:{width:390,height:844}}),receiver=await browser.newContext({viewport:{width:390,height:844}});
 const page=await sender.newPage(),other=await receiver.newPage(),errors=[];for(const p of [page,other])p.on('pageerror',e=>errors.push(e.message));
 await page.goto(host.url);await page.locator('#create').click();await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').click();await page.locator('#closeOutingSuccess').click();
 assert.equal(await page.locator('#vhfChannels').evaluate(e=>e.open),false);
 async function table(p){await p.locator('#vhfChannels').evaluate(e=>e.open=true);await p.waitForFunction(()=>document.querySelectorAll('#vhfChannelsRows tr').length===4);return p.locator('#vhfChannelsRows').innerText();}
 const original=await table(page);
 const bridge=await page.evaluate(async()=>{
  const rows=await getVhfChannelTable(),displayed=[...document.querySelectorAll('#vhfChannelsRows tr')].map(tr=>({channel:Number(tr.querySelector('th strong').textContent),word:tr.querySelector('td').textContent}));
  const saved=JSON.stringify(rows);rows[0].word='MODIFIÉ';
  return {oldSessionBridge:typeof window.vhfChannelSession,oldWordsBridge:typeof window.vhfChannelWords,fields:Object.keys(rows[0]).sort(),table:saved,displayed:JSON.stringify(displayed),unchanged:JSON.stringify(await getVhfChannelTable())===saved};
 });
 assert.equal(bridge.oldSessionBridge,'undefined');assert.equal(bridge.oldWordsBridge,'undefined');assert.deepEqual(bridge.fields,['channel','word']);assert.equal(bridge.table,bridge.displayed);assert.equal(bridge.unchanged,true);
 assert.equal(await page.locator('#vhfChannelsExampleWord').textContent(),await page.locator('#vhfChannelsRows tr').first().locator('td').textContent());
 await page.locator('#shareOutingBtn').click();await page.waitForFunction(()=>document.getElementById('outingShareText').value.includes('VHF-SORTIE2.'));const invitation=await page.locator('#outingShareText').inputValue();await page.locator('#closeOutingShare').click();
 await other.goto(host.url);await other.locator('#receive').click();await other.locator('#invitation').fill(invitation);await other.locator('#receiveForm button[type=submit]').click();await other.locator('#confirmOutingImport').click();await other.locator('#closeOutingSuccess').click();assert.equal(await table(other),original);
 await page.evaluate(()=>setActiveZone(zones.find(z=>z.builtin&&z.id!==activeZoneId).id));assert.equal(await table(page),original);
 for(const theme of ['day','night']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await receiver.setOffline(true);await other.reload();assert.equal(await table(other),original);assert.deepEqual(errors,[]);
});test("une panne du tableau VHF préserve l'envoi et la réception des positions",async t=>{
 const host=await createServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
 for(const [name,bytes]of prepareBuild().output)host.state.virtual.set('/'+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 await page.goto(host.url);await page.locator('#create').click();await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').click();await page.locator('#closeOutingSuccess').click();
 await page.evaluate(()=>window.getVhfChannelTable=async()=>{throw new Error('Tableau indisponible (panne simulée).');});
 await page.locator('#vhfChannels').evaluate(e=>e.open=true);await page.waitForFunction(()=>document.getElementById('vhfChannelsStatus').textContent==='Tableau indisponible (panne simulée).'&&!document.getElementById('vhfChannelsStatus').hidden);
 assert.equal(await page.locator('#vhfChannelsRows tr').count(),0);assert.equal(await page.locator('#vhfChannelsExample').isVisible(),false);
 await page.evaluate(()=>{setPositionInputMode('decimal');const z=activeZone();document.getElementById('lat').value=String(z.lat);document.getElementById('lon').value=String(z.lon);refreshEncodeState();});await page.locator('#encodeBtn').click();await page.locator('#encodedBlock').waitFor();
 await page.locator('#tabReceive').click();const incoming=await page.evaluate(async()=>{const z=activeZone();return (await encodeCore(z.lat,z.lon,activeSecret(),z)).phrase;});
 await page.locator('#wordGrid .linkbox button').filter({hasText:new RegExp('^'+incoming.connector+'$')}).click();for(let i=0;i<4;i++)await page.locator('#wordGrid input').nth(i).fill(incoming.words[i]);await page.waitForFunction(()=>document.getElementById('decodeStatus').textContent.startsWith('Contrôle local réussi'));
});

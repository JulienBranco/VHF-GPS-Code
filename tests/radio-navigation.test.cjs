"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareBuild}=require('../tools/build.cjs'),{createServer}=require('../tools/server.cjs'),{chromium,browserOptions}=require('../tools/test-browser.cjs');
async function fixture(t){
 const host=await createServer(),browser=await chromium.launch(browserOptions());t.after(async()=>{await browser.close();await new Promise(r=>host.server.close(r));});
 for(const [name,bytes]of prepareBuild().output)host.state.virtual.set('/'+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(host.url);await page.locator('#create').click();await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').click();await page.locator('#closeOutingSuccess').click();
 await page.waitForFunction(()=>document.getElementById('sendZoneAlias').textContent.trim()&&!document.getElementById('sendZoneAlias').classList.contains('hidden'));
 return {page,context,errors};
}
async function top(p){await p.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await p.waitForFunction(()=>document.getElementById('radioMemo').hidden);}
async function bottom(p){await p.evaluate(()=>scrollTo({top:document.body.scrollHeight,behavior:'instant'}));await p.waitForFunction(()=>!document.getElementById('radioMemoSession').hidden&&!document.getElementById('radioMemoZone').hidden);}
async function settled(p){await p.evaluate(()=>delete window.__radioTestScroll);await p.waitForFunction(()=>{const now=performance.now(),last=window.__radioTestScroll;if(!last||last.y!==scrollY){window.__radioTestScroll={y:scrollY,at:now};return false;}return now-last.at>150;});}
async function matching(p,side){
 const v=await p.evaluate(side=>({original:document.getElementById(side+'ZoneAlias').textContent,alias:document.getElementById('radioMemoAlias').textContent,name:document.getElementById('radioMemoZoneName').textContent,zone:activeZone().name,fingerprint:document.getElementById('fingerprintWords').textContent,memo:document.getElementById('radioMemoFingerprint').textContent,overflow:document.documentElement.scrollWidth>innerWidth,top:document.getElementById('radioNavigation').getBoundingClientRect().top}),side);
 assert.equal(v.alias,v.original);assert.equal(v.name,' · '+v.zone);assert.equal(v.memo,v.fingerprint);assert.equal(v.overflow,false);assert.equal(Math.round(v.top),0);
}
test('mémo mobile jour/nuit : apparition, valeurs actuelles et clic vers chaque panneau',async t=>{
 const {page:p,errors}=await fixture(t);
 for(const width of [390,320]){await p.setViewportSize({width,height:844});for(const theme of ['day','night']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await top(p);await bottom(p);await matching(p,'send');}}
 for(const side of ['send','recv']){if(side==='recv')await p.locator('#tabReceive').click();await bottom(p);await matching(p,side);await p.locator('#radioMemoZone').click();await settled(p);const rect=await p.locator('#'+side+'ZoneCard').boundingBox();assert(rect.y>=0&&rect.y<300,JSON.stringify(rect));assert.equal(await p.locator('#'+side+'Zone').evaluate(e=>e===document.activeElement),true);await top(p);}
 assert.deepEqual(errors,[]);
});
test('zone : annulation, attente pulsante, protections et validation durable synchronisée',async t=>{
 const {page:p,context,errors}=await fixture(t),target=await p.evaluate(()=>zones.find(z=>z.builtin&&z.id!==activeZoneId).id);
 await p.locator('#sendZone').selectOption(target);await p.locator('#cancelZoneSwitch').click();await p.waitForFunction(target=>document.getElementById('sendZone').value!==target&&pendingZoneSwitch===null,target);assert.equal(await p.locator('#sendZoneCard').getAttribute('data-validation'),'confirmed');
 await p.locator('#sendZone').selectOption(target);await p.locator('#confirmZoneSwitch').click();await p.waitForFunction(()=>document.getElementById('sendZoneCard').dataset.validation==='pending');
 await p.evaluate(async()=>{const z=activeZone();setPositionInputMode('decimal');document.getElementById('lat').value=String(z.lat);document.getElementById('lon').value=String(z.lon);refreshEncodeState();const e=await encodeCore(z.lat,z.lon,activeSecret(),z);wordInputs.forEach((input,i)=>input.value=e.phrase.words[i]);receiverConnector=e.phrase.connector;refreshDecodeState();});
 assert.equal(await p.locator('#encodeBtn').isDisabled(),true);assert.equal(await p.locator('#decodeBtn').isDisabled(),true);assert.equal(await p.evaluate(()=>receiverCanDecode()),false);
 for(const side of ['send','recv']){assert.equal(await p.locator('#'+side+'ZoneCard').getAttribute('data-validation'),'pending');assert.match(await p.locator('#'+side+'ZoneValidationBadge').textContent(),/confirmer à la radio/);assert.equal(await p.locator('#'+side+'ZoneCard').evaluate(e=>getComputedStyle(e).animationName),'zone-validation-pulse');}
 await bottom(p);await matching(p,'send');assert.equal(await p.locator('#radioMemoZone').getAttribute('data-validation'),'pending');assert.equal(await p.locator('#radioMemoZone').evaluate(e=>getComputedStyle(e).animationName),'zone-memo-pulse');
 await p.locator('#radioMemoZone').click();await settled(p);await p.locator('#sendZoneConfirmBtn').click();await p.waitForFunction(()=>document.getElementById('sendZoneCard').dataset.validation==='confirmed');
 assert.equal(await p.locator('#encodeBtn').isDisabled(),false);assert.equal(await p.locator('#decodeBtn').isDisabled(),false);
 await bottom(p);await p.waitForFunction(()=>document.getElementById('radioMemoZone').dataset.validation==='confirmed');for(const id of ['sendZoneCard','recvZoneCard','radioMemoZone'])assert.equal(await p.locator('#'+id).evaluate(e=>getComputedStyle(e).animationName),'none');
 await context.setOffline(true);await p.reload();await p.waitForFunction(()=>document.getElementById('sendZoneCard').dataset.validation==='confirmed');assert.equal(await p.locator('#recvZoneCard').getAttribute('data-validation'),'confirmed');assert.equal(await p.locator('#sendZone').inputValue(),target);assert.deepEqual(errors,[]);
});
test('émission et réception : ancres visibles sous le bandeau après réussite',async t=>{
 const {page:p,errors}=await fixture(t);
 await p.evaluate(()=>{setPositionInputMode('decimal');const z=activeZone();document.getElementById('lat').value=String(z.lat);document.getElementById('lon').value=String(z.lon);refreshEncodeState();});await p.locator('#encodeBtn').click();await p.locator('#encodedBlock').waitFor();await settled(p);
 const send=await p.evaluate(()=>({top:document.querySelector('.active-transmission-header').getBoundingClientRect().top,bottom:document.querySelector('.active-transmission-header').getBoundingClientRect().bottom,nav:document.getElementById('radioNavigation').getBoundingClientRect().bottom,time:document.getElementById('activeTransmissionTime').textContent}));assert(send.top>=send.nav,JSON.stringify(send));assert(send.bottom<844);assert.match(send.time,/Préparée à/);
 await p.locator('#tabReceive').click();await top(p);const incoming=await p.evaluate(async()=>{const z=activeZone();return (await encodeCore(z.lat,z.lon,activeSecret(),z)).phrase;});
 await p.locator('#wordGrid .linkbox button').filter({hasText:new RegExp('^'+incoming.connector+'$')}).click();for(let i=0;i<4;i++)await p.locator('#wordGrid input').nth(i).fill(incoming.words[i]);
 await p.waitForFunction(()=>document.getElementById('decodeStatus').textContent.startsWith('Contrôle local réussi'));await settled(p);
 const recv=await p.evaluate(()=>({top:document.getElementById('decodeStatus').getBoundingClientRect().top,nav:document.getElementById('radioNavigation').getBoundingClientRect().bottom,keyboard:document.activeElement?.matches('#wordGrid input')}));assert(recv.top>=recv.nav&&recv.top<=recv.nav+40,JSON.stringify(recv));assert.equal(recv.keyboard,false);assert.equal(await p.locator('#receiverAckBlock').isVisible(),true);assert.equal(await p.locator('#finalConfirmBlock').isVisible(),true);assert.deepEqual(errors,[]);
});
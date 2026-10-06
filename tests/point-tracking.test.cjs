"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepareBuild}=require('../tools/build.cjs'),{createServer}=require('../tools/server.cjs');
const {chromium,browserOptions}=require('../tools/test-browser.cjs');
const root=path.resolve(__dirname,'..');
async function fixture(t,{disabled=false}={}){
 const prepared=prepareBuild(root),host=await createServer(),browser=await chromium.launch(browserOptions());
 if(disabled){
  // Publication virtuelle avec le commutateur coupé, sans modifier les sources ou générer de dossier.
  const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const old=prepared.id,manifest=JSON.parse(prepared.output.get('releases/'+old+'/manifest.json'));
  const runtime=Buffer.from(prepared.output.get('releases/'+old+'/runtime.js').toString().replace('const POINT_TRACKING_ENABLED=true;','const POINT_TRACKING_ENABLED=false;'));
  manifest.files.find(f=>f.path==='runtime.js').sha256=hash(runtime);
  const raw=Buffer.from(JSON.stringify(manifest)),id=hash(raw);
  for(const file of manifest.files)prepared.output.set('releases/'+id+'/'+file.path,file.path==='runtime.js'?runtime:prepared.output.get('releases/'+old+'/'+file.path));
  prepared.output.set('releases/'+id+'/manifest.json',raw);
  prepared.output.set('latest.json',Buffer.from(JSON.stringify({format:2,release:id})));prepared.id=id;
 }
 for(const [name,bytes] of prepared.output)host.state.virtual.set('/'+name,bytes);
 const context=await browser.newContext({viewport:{width:390,height:844}});
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 await context.addInitScript(()=>{
  window.__gps={next:0,live:new Map(),history:[],cleared:[],emit(value){for(const h of this.live.values())h.ok({coords:{latitude:value.lat,longitude:value.lon,accuracy:value.accuracy??5,speed:value.speed??null,heading:value.heading??null},timestamp:value.time??Date.now()});},fail(code){for(const h of [...this.live.values()])h.error({code});}};
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok,error,options){const id=++__gps.next,h={ok,error,options};__gps.live.set(id,h);__gps.history.push(h);return id;},clearWatch(id){__gps.cleared.push(id);__gps.live.delete(id);}}});
  window.__wake={requested:0,released:0,fail:false,defer:false,pending:[]};
  const lock=()=>{const item=new EventTarget();item.released=false;item.release=async()=>{if(!item.released){item.released=true;__wake.released++;item.dispatchEvent(new Event('release'));}};return item;};
  Object.defineProperty(navigator,'wakeLock',{configurable:true,value:{async request(){__wake.requested++;if(__wake.fail)throw Error('Économie de batterie');if(__wake.defer)return new Promise(resolve=>__wake.pending.push(()=>resolve(lock())));return lock();}}});
  window.__hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>__hidden});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(host.url);await page.waitForFunction(()=>!document.getElementById('create').disabled);
 await page.locator('#create').click();await page.locator('#outingBuiltinSelect').selectOption('iroise-brest');
 await page.locator('#checkOutingCreate').click();await page.locator('#confirmOutingCreate').click();await page.locator('#closeOutingSuccess').click();
 await page.locator('#tabReceive').click();
 const final=await page.evaluate(async()=>{
  const z=activeZone(),encoded=await encodeCore(z.lat,z.lon,activeSecret(),z);
  wordInputs.forEach((input,i)=>{input.value=encoded.phrase.words[i];});receiverConnector=encoded.phrase.connector;await runDecode();return protocolToken(encoded.finalConfirm);
 });
 return {page,context,prepared,host,errors,async confirm(){await page.locator('#finalConfirmChoices button').evaluateAll((buttons,word)=>buttons.find(b=>b.dataset.word===word).click(),final);}};
}
async function emitApproach(page){
 await page.evaluate(()=>{const p=window.confirmedTrackingPoint(),now=Date.now();for(const [dt,offset] of [[-10000,.041],[-5000,.0405],[0,.04]])__gps.emit({lat:p.lat-offset,lon:p.lon,time:now+dt,speed:6*1852/3600,heading:0});});
}
test('suivi réservé au point confirmé, trace et estimations, zoom et déplacement de la vue',async t=>{
 const f=await fixture(t),{page}=f;
 await page.evaluate(()=>document.getElementById('startPointTracking').click());assert.equal(await page.locator('#pointTrackingDialog').isVisible(),false);
 await f.confirm();await page.locator('#startPointTracking').click();await emitApproach(page);
 assert.match(await page.locator('#trackingSpeed').innerText(),/6 nd/);assert.notEqual(await page.locator('#trackingArrival').innerText(),'—');
 assert.match(await page.locator('#trackingTrace').getAttribute('d'),/L/);assert(await page.locator('#trackingDirect').getAttribute('x1'));
 assert.match(await page.locator('#trackingWakeStatus').innerText(),/Écran maintenu allumé/);
 const original=await page.locator('#trackingScaleText').textContent();await page.locator('#trackingZoomIn').click();assert.notEqual(await page.locator('#trackingScaleText').textContent(),original);
 const before=await page.locator('#trackingTarget').getAttribute('transform'),rect=await page.locator('#trackingMap').boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+35,rect.y+rect.height/2+20);await page.mouse.up();
 assert.notEqual(await page.locator('#trackingTarget').getAttribute('transform'),before);
 await page.locator('#trackingFit').click();assert.equal(await page.locator('#trackingScaleText').textContent(),original);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 for(const theme of ['day','night']){
  await page.evaluate(theme=>applyTheme(theme),theme);
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   assert(await page.locator('#pointTrackingDialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
   await page.screenshot({path:path.join(root,'test-results','tracking-'+theme+'-'+width+'.png')});
  }
 }
 assert.deepEqual(f.errors,[]);
});
test('coordonnées en haut : cible fixe, GPS actualisé et qualité du relevé explicite',async t=>{
 const f=await fixture(t),{page}=f;await f.confirm();await page.clock.install();
 await page.locator('#startPointTracking').click();
 const target=await page.locator('#trackingTargetCoords').textContent();
 assert.match(await page.locator('#trackingTargetCoordsLabel').textContent(),/Point reçu · fixe/);
 assert.equal(await page.locator('#trackingOwnCoords').textContent(),'Recherche GPS…');
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'waiting');
 assert(await page.locator('#trackingTargetCoords').evaluate(e=>!!(e.compareDocumentPosition(document.getElementById('trackingDistance'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 await page.evaluate(()=>__gps.emit({lat:46.0336666667,lon:-2.0337833333}));
 assert.equal(await page.locator('#trackingOwnCoords').textContent(),'46° 2.020′ N\n002° 2.027′ W');
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'live');
 assert.match(await page.locator('#trackingOwnCoordsLabel').textContent(),/Position GPS actuelle/);
 await page.clock.fastForward(1000);
 await page.evaluate(()=>__gps.emit({lat:46.0338333333,lon:-2.034}));
 const latest='46° 2.030′ N\n002° 2.040′ W';
 assert.equal(await page.locator('#trackingOwnCoords').textContent(),latest);
 assert.equal(await page.locator('#trackingTargetCoords').textContent(),target);
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 for(const theme of ['day','night']){
  await page.evaluate(theme=>applyTheme(theme),theme);
  for(const width of [320,390,900]){
   await page.setViewportSize({width,height:844});
   await page.locator('#pointTrackingDialog').evaluate(d=>d.scrollTo({top:0,behavior:'instant'}));
   assert(await page.locator('#pointTrackingDialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
   assert(await page.locator('.tracking-positions').evaluate(e=>Array.from(e.querySelectorAll('.tracking-position')).every(p=>p.scrollWidth<=p.clientWidth)));
   await page.screenshot({path:path.join(root,'test-results','tracking-coordinates-'+theme+'-'+width+'.png')});
  }
 }
 await page.clock.fastForward(21000);
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'last');
 assert.match(await page.locator('#trackingOwnCoordsLabel').textContent(),/Dernière position GPS/);
 assert.equal(await page.locator('#trackingOwnCoords').textContent(),latest);
 await page.evaluate(()=>__gps.emit({lat:46.0338333333,lon:-2.034,accuracy:400}));
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'indicative');
 assert.match(await page.locator('#trackingOwnCoordsLabel').textContent(),/Position GPS indicative/);
 await page.evaluate(()=>__gps.emit({lat:46.0338333333,lon:-2.034}));
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'live');
 await page.evaluate(()=>{__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'last');
 await page.evaluate(()=>{__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'last');
 await page.evaluate(()=>__gps.emit({lat:46.0338333333,lon:-2.034}));
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'live');
 await page.evaluate(()=>__gps.fail(1));
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'last');
 assert.equal(await page.locator('#trackingTargetCoords').textContent(),target);
 await page.locator('#closePointTracking').click();await page.locator('#startPointTracking').click();
 assert.equal(await page.locator('#trackingOwnCoords').textContent(),'Recherche GPS…');
 assert.equal(await page.locator('#trackingOwnPosition').getAttribute('data-state'),'waiting');
 assert.deepEqual(f.errors,[]);
});

test('fermetures, réouverture et callbacks tardifs : GPS arrêté, trace éphémère, wake lock libéré',async t=>{
 const f=await fixture(t),{page}=f;await f.confirm();
 for(const close of ['button','escape','native']){
  await page.locator('#startPointTracking').click();await emitApproach(page);
  if(close==='button')await page.locator('#stopPointTracking').click();
  else if(close==='escape')await page.keyboard.press('Escape');
  else await page.evaluate(()=>document.getElementById('pointTrackingDialog').close());
  await page.locator('#pointTrackingDialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>__gps.live.size===0);
  assert.equal(await page.evaluate(()=>__gps.live.size),0);
 }
 assert.equal(await page.evaluate(()=>__wake.requested),await page.evaluate(()=>__wake.released));
 await page.locator('#startPointTracking').click();assert.equal(await page.locator('#trackingTrace').getAttribute('d'),'');
 await page.evaluate(()=>{const target=confirmedTrackingPoint();__gps.history[0].ok({coords:{latitude:target.lat,longitude:target.lon,accuracy:5,speed:10,heading:0},timestamp:Date.now()});});
 assert.equal(await page.locator('#trackingDistance').innerText(),'Recherche GPS…');
 await page.evaluate(()=>invalidateDecodedResult());assert.equal(await page.locator('#pointTrackingDialog').isVisible(),false);assert.equal(await page.evaluate(()=>__gps.live.size),0);
});
test('GPS ancien, peu précis, refusé et retour du premier plan : aucune estimation obsolète',async t=>{
 const f=await fixture(t),{page}=f;await f.confirm();await page.clock.install();
 await page.locator('#startPointTracking').click();await emitApproach(page);
 assert.notEqual(await page.locator('#trackingArrival').innerText(),'—');
 await page.clock.fastForward(21000);assert.equal(await page.locator('#trackingArrival').innerText(),'—');assert.match(await page.locator('#trackingGpsStatus').innerText(),/ancienne/);
 await page.evaluate(()=>{__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>__gps.live.size),0);
 await page.evaluate(()=>{__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>__gps.live.size),1);
 assert.match(await page.locator('#trackingGpsStatus').innerText(),/relevé GPS frais/);
 await page.evaluate(()=>{const p=confirmedTrackingPoint();__gps.emit({...p,lat:p.lat-.04,accuracy:400});});
 assert.match(await page.locator('#trackingGpsStatus').innerText(),/Précision GPS insuffisante/);assert.equal(await page.locator('#trackingArrival').innerText(),'—');
 await page.evaluate(()=>__gps.fail(1));assert.match(await page.locator('#trackingGpsStatus').innerText(),/Autorisation GPS refusée/);assert.equal(await page.evaluate(()=>__gps.live.size),0);
});
test('wake lock refusé ou terminé après fermeture : suivi disponible et aucune ressource oubliée',async t=>{
 const f=await fixture(t),{page}=f;await f.confirm();await page.evaluate(()=>{__wake.fail=true;});
 await page.locator('#startPointTracking').click();await emitApproach(page);assert.match(await page.locator('#trackingWakeStatus').innerText(),/indisponible/);assert.notEqual(await page.locator('#trackingArrival').innerText(),'—');
 await page.locator('#closePointTracking').click();await page.evaluate(()=>{__wake.fail=false;__wake.defer=true;});
 await page.locator('#startPointTracking').click();await page.locator('#closePointTracking').click();
 await page.evaluate(async()=>{__wake.pending.shift()();await Promise.resolve();});
 await page.waitForFunction(()=>__wake.released===1);assert.equal(await page.evaluate(()=>__gps.live.size),0);
});
test('module, styles et calculs embarqués : reprise et suivi sans réseau, sans persistance de trace',async t=>{
 const f=await fixture(t),{page,context}=f;await f.confirm();
 await page.locator('#startPointTracking').click();await emitApproach(page);await page.locator('#closePointTracking').click();
 await page.evaluate(()=>VHFIntegration.commit());
 const state=await page.evaluate(async()=>{const s=await import('./storage.js');return (await s.read(await s.openStore(),'active')).state;});
 assert(!Object.keys(state).some(k=>/tracking|trail/i.test(k)));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));
 // Les coordonnées radio ne sont pas persistées : refaire un échange complet hors réseau.
 await page.locator('#tabReceive').click();
 const final=await page.evaluate(async()=>{const z=activeZone(),e=await encodeCore(z.lat,z.lon,activeSecret(),z);wordInputs.forEach((w,i)=>w.value=e.phrase.words[i]);receiverConnector=e.phrase.connector;await runDecode();return protocolToken(e.finalConfirm);});
 await page.locator('#finalConfirmChoices button').evaluateAll((buttons,w)=>buttons.find(b=>b.dataset.word===w).click(),final);
 await page.locator('#startPointTracking').click();await emitApproach(page);assert.notEqual(await page.locator('#trackingArrival').innerText(),'—');
 for(const name of ['point-tracking.js','point-tracking-math.js','point-tracking.css']){
  assert(f.prepared.output.has('releases/'+f.prepared.id+'/'+name));
  assert(await page.evaluate(async name=>{const id=location.pathname.split('/releases/')[1].split('/')[0],cache=await caches.open('vhfgps-main-release-'+id);return !!await cache.match(new URL('./'+name,location.href));},name));
 }
 assert.deepEqual(f.errors,[]);
});

test('géolocalisation native Chromium : acquisition puis déplacement réel du navigateur simulé',async t=>{
 const f=await fixture(t),{page,context}=f;await f.confirm();
 const target=await page.evaluate(()=>confirmedTrackingPoint());
 await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:target.lat-.04081,longitude:target.lon,accuracy:5});
 await page.evaluate(()=>{delete navigator.geolocation;});
 await page.locator('#startPointTracking').click();
 await page.waitForFunction(()=>document.getElementById('trackingDistance').textContent.includes('milles'));
 const first=await page.locator('#trackingDistance').innerText();
 await page.waitForTimeout(25);
 // Un second relevé natif doit actualiser la distance et la ligne SVG.
 await context.setGeolocation({latitude:target.lat-.04079,longitude:target.lon,accuracy:5});
 await page.waitForFunction(old=>document.getElementById('trackingDistance').textContent!==old,first);
 assert.match(await page.locator('#trackingGpsStatus').innerText(),/GPS reçu|Suivi GPS actif/);
 await page.locator('#closePointTracking').click();assert.equal(await page.locator('#pointTrackingDialog').isVisible(),false);
 assert.deepEqual(f.errors,[]);
});
test('panne à l’initialisation du module facultatif : le moteur radio reste utilisable',async t=>{
 const f=await fixture(t),{page}=f;
 await page.addInitScript(()=>{const original=document.createElement.bind(document);document.createElement=(name,...args)=>{if(name==='dialog')throw Error('Panne du module de suivi simulée');return original(name,...args);};});
 await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));
 assert.equal(await page.locator('#startPointTracking').isDisabled(),true);
 assert.equal(await page.locator('#startPointTracking').innerText(),'Suivi GPS indisponible');
 assert.equal(await page.evaluate(()=>document.body.inert),false);
 assert.equal(await page.evaluate(()=>protocolRuntimeState===PROTOCOL_STATE.OK),true);
 const encoded=await page.evaluate(async()=>{const z=activeZone();return (await encodeCore(z.lat,z.lon,activeSecret(),z)).phrase.words.length;});assert.equal(encoded,4);
 assert.deepEqual(f.errors,[]);
});

test('commutateur désactivé : bouton absent après confirmation, aucun GPS ni modale, calcul radio préservé',async t=>{
 const f=await fixture(t,{disabled:true});await f.confirm();
 assert.equal(await f.page.locator('#startPointTracking').isVisible(),false);
 assert.equal(await f.page.locator('#pointTrackingDialog').count(),0);
 assert.equal(await f.page.evaluate(()=>__gps.live.size),0);
 assert.equal(await f.page.evaluate(()=>__wake.requested),0);
 assert.equal(await f.page.evaluate(()=>protocolRuntimeState===PROTOCOL_STATE.OK),true);
 assert.deepEqual(f.errors,[]);
});

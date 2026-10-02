"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {createServer}=require("../tools/server.cjs"),{prepareBuild,prepareShell}=require("../tools/build.cjs"),{chromium,browserOptions}=require("../tools/test-browser.cjs");
const {waitAsync}=require("./wait-async.cjs");
const root=path.resolve(__dirname,".."),hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const buildId=bytes=>String(bytes).match(/SHELL_BUILD="([a-f0-9]{64})"/)[1];
function publication(){
 const prepared=prepareBuild(root),files=new Map(prepared.output);
 const assets=JSON.parse(prepared.output.get("sw.js").toString().match(/ASSETS=(\[[^\n]+\]);/)[1]);
 for(const file of assets)if(!files.has(file.path))files.set(file.path,fs.readFileSync(path.join(root,file.path)));
 return {prepared,files};
}
function nextShell(files,{reset=null}={}){
 const next=new Map(files);next.set("index.html",Buffer.from(next.get("index.html").toString().replace('<body>','<body data-shell-fixture="new">')));
 next.set("boot.js",Buffer.from(next.get("boot.js").toString()+"\n// Nouvelle copie pour vérifier l’isolation des fichiers.\n"));
 if(reset){const catalog=JSON.parse(next.get("releases.json"));catalog.reset=reset;next.set("releases.json",Buffer.from(JSON.stringify(catalog)));}
 next.set("sw.js",prepareShell(root,next));return next;
}
function serve(host,files,prefix="/"){host.state.virtual=new Map([...files].map(([name,bytes])=>[prefix+name,bytes]));}
async function fixture(t,{prefix="/"}={}){
 const browser=await chromium.launch(browserOptions()),host=await createServer(),context=await browser.newContext();
 t.after(async()=>{await browser.close();await new Promise(resolve=>host.server.close(resolve));});
 const {prepared,files}=publication();serve(host,files,prefix);const page=await context.newPage(),url=host.url+prefix.slice(1);
 return {browser,host,context,page,url,prefix,prepared,files};
}
async function home(page,url){await page.goto(url);await page.waitForFunction(()=>document.getElementById("create")&&!document.getElementById("create").disabled);}
async function update(page){await page.evaluate(()=>{navigator.serviceWorker.getRegistration().then(reg=>reg.update()).catch(()=>{});});}
async function activeBuild(page){return page.evaluate(async()=>{
 const reg=await navigator.serviceWorker.getRegistration();return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data.build);};reg.active.postMessage({type:"VHF_LAUNCHER_INFO",api:1},[channel.port2]);});
});}
async function waitBuild(page,build){await waitAsync(page,async expected=>{
 const reg=await navigator.serviceWorker.getRegistration();
 // Ne pas maintenir l’ancien worker occupé par des requêtes pendant son remplacement.
 if(reg?.installing||reg?.waiting||reg?.active?.state!=="activated")return false;
 return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data.build===expected);};reg.active.postMessage({type:"VHF_LAUNCHER_INFO",api:1},[channel.port2]);});
},build);}
async function create(page){await page.locator("#create").click();await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").click();await page.locator("#closeOutingSuccess").click();return active(page);}
async function active(page){return page.evaluate(async()=>{const base=location.pathname.includes('/releases/')?new URL('../../',location.href):new URL('./',location.href);const s=await import(new URL('storage.js',base));const db=await s.openStore();try{return await s.read(db,'active');}finally{db.close();}});}
async function keys(page){return page.evaluate(()=>caches.keys());}
async function prune(page){return page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data.ok);};reg.active.postMessage({type:'VHF_RELEASE_PRUNE',api:1},[channel.port2]);});});}
function catalogFiles(files,ids,latest=ids[0]){
 const next=new Map(files),catalog=JSON.parse(next.get('releases.json'));
 catalog.latest=latest;catalog.releases=ids.map(release=>catalog.releases.find(row=>row.release===release)||{release,version:'fixture'});
 next.set('releases.json',Buffer.from(JSON.stringify(catalog)));next.set('sw.js',prepareShell(root,next));return next;
}
function alternateRelease(files,original){
 const next=new Map(files),manifest=structuredClone(original.manifest);
 for(const file of manifest.files){let bytes=files.get('releases/'+original.release+'/'+file.path);if(file.path==='app.html')bytes=Buffer.from(bytes.toString().replace('<body>','<body data-publication=new>'));file.sha256=hash(bytes);next.set('candidate/'+file.path,bytes);}
 const raw=JSON.stringify(manifest),id=hash(raw);
 for(const file of manifest.files){next.set('releases/'+id+'/'+file.path,next.get('candidate/'+file.path));next.delete('candidate/'+file.path);}
 next.set('releases/'+id+'/manifest.json',Buffer.from(raw));next.set('latest.json',Buffer.from(JSON.stringify({format:2,release:id})));return {files:next,id};
}
async function sentinel(page,id){await page.evaluate(async id=>{const cache=await caches.open('vhfgps-main-release-'+id);await cache.put('/sentinel',new Response('conservé'));},id);}

test("ancien worker réel 3.28.102 : navigateur débloqué sans désinstallation, ancienne adresse utilisable hors ligne sous GitHub Pages",async t=>{
 const {host,context,page,url,files,prefix}=await fixture(t,{prefix:"/VHF-GPS-Code/"});
 // Interface réduite ; le service worker de l'ancienne version est conservé exactement.
 const html=Buffer.from('<!doctype html><h1>Ancienne application</h1><script>navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});</script>');
 const legacy=new Map(files);legacy.set("sw.js",fs.readFileSync(path.join(__dirname,"fixtures/legacy-3.28.102-sw.js")));legacy.set("index.html",html);legacy.set("vhf_gps_code.html",html);serve(host,legacy,prefix);
 await page.goto(url+'vhf_gps_code.html');await waitAsync(page,async()=>navigator.serviceWorker.controller&&(await navigator.serviceWorker.getRegistration())?.active?.state==='activated');
 await page.reload();assert.equal(await page.locator('h1').innerText(),'Ancienne application');
 await page.evaluate(async()=>{const cache=await caches.open('other-site-sentinel');await cache.put('/sentinel',new Response('conservé'));});
 serve(host,files,prefix);await update(page);await page.waitForFunction(()=>document.getElementById('create')&&!document.getElementById('create').disabled);
 assert.equal(await page.locator('h1').innerText(),'VHF GPS Code');assert((await keys(page)).includes('other-site-sentinel'));assert(!(await keys(page)).some(key=>key.startsWith('vhf-gps-code-app-')));
 await context.setOffline(true);await home(page,url+'vhf_gps_code.html');assert.equal(await page.locator('h1').innerText(),'VHF GPS Code');
});

test("simple onglet : nouvel accueil automatique, invitation collée et fenêtre de réception conservées",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);
 await page.locator('#receive').click();const text='Préambule\nInvitation copiée avec accents É · È\nFin';await page.locator('#invitation').fill(text);
 const next=nextShell(files);serve(host,next);await update(page);
 await page.waitForFunction(()=>document.body.dataset.shellFixture==='new'&&!document.getElementById('create').disabled);
 assert.equal(await page.locator('#receiveDialog').isVisible(),true);assert.equal(await page.locator('#invitation').inputValue(),text);assert.equal(await page.locator('#updateNotice').isVisible(),false);
 assert.equal(await activeBuild(page),buildId(next.get('sw.js')));
 await page.locator('#closeReceive').click();await context.setOffline(true);await home(page,url);assert.equal(await page.locator('body').getAttribute('data-shell-fixture'),'new');
});

test("mise à jour du launcher pendant une sortie : aucun rechargement, saisie et secret préservés, reprise hors réseau",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const original=await create(page),currentURL=page.url();
 await page.locator('#positionModeDecimal').click();await page.locator('#lat').fill('48.123456');await page.evaluate(()=>window.survivalMarker=true);
 const next=nextShell(files);serve(host,next);await update(page);await waitBuild(page,buildId(next.get('sw.js')));
 assert.equal(await page.evaluate(()=>window.survivalMarker),true);assert.equal(page.url(),currentURL);assert.equal(await page.locator('#lat').inputValue(),'48.123456');assert.equal((await active(page)).id,original.id);
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));assert.equal((await active(page)).release,original.release);
 await page.locator('#backHomeBtn').click();await page.waitForFunction(()=>!document.getElementById('create').disabled);assert.equal(await page.locator('body').getAttribute('data-shell-fixture'),'new');
});

test("serveur incohérent pendant publication : installation refusée, ancien accueil intact, nouvelle tentative réussie",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const original=await activeBuild(page),catalog=JSON.parse(files.get('releases.json')),unused=catalog.releases.find(row=>row.release!==catalog.latest).release;
 await sentinel(page,unused);const next=catalogFiles(nextShell(files),[catalog.latest]);
 serve(host,next);host.state.virtual.set('/boot.js',files.get('boot.js'));
 const failed=page.waitForFunction(()=>window.failedWorker===true);await page.evaluate(()=>{navigator.serviceWorker.getRegistration().then(reg=>{reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',function(){if(this.state==='redundant')window.failedWorker=true;}));reg.update();});});await failed;
 assert.equal(await activeBuild(page),original);assert(!(await keys(page)).includes('vhfgps-main-shell-'+buildId(next.get('sw.js'))));
 await context.setOffline(true);await home(page,url);assert.equal(await activeBuild(page),original);assert((await keys(page)).includes('vhfgps-main-release-'+unused),'échec de mise à jour : aucune purge');
 await context.setOffline(false);serve(host,next);await update(page);await page.waitForFunction(()=>document.body.dataset.shellFixture==='new'&&!document.getElementById('create').disabled);await prune(page);assert(!(await keys(page)).includes('vhfgps-main-release-'+unused));
});

test("purge du catalogue : sortie active, page ouverte et téléchargement protégés, moteur retiré nettoyé ensuite",async t=>{
 const {page,context,url,host,files}=await fixture(t);await home(page,url);const old=await create(page);
 const other=await context.newPage();await other.goto(page.url());await other.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));
 const ids=JSON.parse(files.get('releases.json')).releases.map(row=>row.release),unused=ids.find(id=>id!==old.release);assert(unused);
 await sentinel(page,unused);const unknown='a'.repeat(64);await sentinel(page,unknown);
 const downloader=await context.newPage();await home(downloader,url);
 await downloader.evaluate(async id=>{await fetch('/releases/'+id+'/manifest.json',{headers:{'X-VHF-Integration-Download':'1'}});},unused);
 const alternate=alternateRelease(files,old),next=catalogFiles(nextShell(alternate.files),[alternate.id]);serve(host,next);await update(page);await waitBuild(page,buildId(next.get('sw.js')));
 assert((await keys(page)).includes('vhfgps-main-release-'+old.release),'sortie active retirée protégée');
 assert((await keys(page)).includes('vhfgps-main-release-'+unused),'téléchargement retiré protégé');
 await home(page,url);const installed=await create(page);assert.equal(installed.release,alternate.id);assert.equal(await prune(page),true);
 assert((await keys(page)).includes('vhfgps-main-release-'+old.release),'ancienne page encore ouverte protégée');
 assert((await keys(page)).includes('vhfgps-main-release-'+unknown),'absence du catalogue seule insuffisante');
 await downloader.close();await other.close();await prune(page);
 assert(!(await keys(page)).includes('vhfgps-main-release-'+old.release));assert(!(await keys(page)).includes('vhfgps-main-release-'+unused));assert((await keys(page)).includes('vhfgps-main-release-'+alternate.id));
});

test("nouvelle sortie : moteurs catalogués conservés sans préchargement et ancien moteur réutilisable hors réseau",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const old=await create(page);
 const alternate=alternateRelease(files,old),ids=JSON.parse(files.get('releases.json')).releases.map(row=>row.release);
 const next=catalogFiles(nextShell(alternate.files),[alternate.id,...ids]);serve(host,next);await update(page);await waitBuild(page,buildId(next.get('sw.js')));
 await home(page,url);const installed=await create(page);assert.equal(installed.release,alternate.id);await prune(page);
 const cacheNames=await keys(page);assert(cacheNames.includes('vhfgps-main-release-'+old.release));assert(cacheNames.includes('vhfgps-main-release-'+alternate.id));
 for(const id of ids.filter(id=>id!==old.release))assert(!cacheNames.includes('vhfgps-main-release-'+id),'aucun préchargement du catalogue');
 const erased=await page.evaluate(async id=>{const s=await import('/storage.js'),db=await s.openStore();try{return await s.read(db,'outing:'+id);}finally{db.close();}},old.id);assert(!erased,'données privées anciennes effacées');
 await context.setOffline(true);assert.equal(await prune(page),true);
 const replay=await page.evaluate(async id=>{const r=await import('/release.js');return (await r.download(id)).version;},old.release);assert.equal(replay,old.manifest.version);
});

test("ancien catalogue : un moteur plus récent téléchargé puis remplacé reste conservé",async t=>{
 const {page,host,files,url}=await fixture(t);await home(page,url);const old=await create(page),originalBuild=await activeBuild(page);
 const alternate=alternateRelease(files,old);serve(host,alternate.files);await home(page,url);const installed=await create(page);assert.equal(installed.release,alternate.id);
 host.state.virtual.set('/latest.json',files.get('latest.json'));await home(page,url);await create(page);await prune(page);
 assert.equal(await activeBuild(page),originalBuild);assert((await keys(page)).includes('vhfgps-main-release-'+alternate.id),'nouvelle release inconnue conservée');
 // Elle devient ensuite connue, puis seule une suppression d'un catalogue ultérieur autorise son retrait.
 const ids=JSON.parse(files.get('releases.json')).releases.map(row=>row.release),recognized=catalogFiles(nextShell(alternate.files),[alternate.id,...ids]);serve(host,recognized);await update(page);await waitBuild(page,buildId(recognized.get('sw.js')));
 const retired=catalogFiles(nextShell(recognized),ids,old.release);serve(host,retired);await update(page);await waitBuild(page,buildId(retired.get('sw.js')));await prune(page);
 assert(!(await keys(page)).includes('vhfgps-main-release-'+alternate.id));assert((await keys(page)).includes('vhfgps-main-release-'+old.release));
});

test("purge reçue : moteur actif conservé après fermeture et réouverture hors réseau",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const old=await create(page),ids=JSON.parse(files.get('releases.json')).releases.map(row=>row.release).filter(id=>id!==old.release);assert(ids.length);
 const unused=ids[0];await sentinel(page,unused);
 const next=catalogFiles(nextShell(files),ids);serve(host,next);await update(page);await waitBuild(page,buildId(next.get('sw.js')));await prune(page);
 assert((await keys(page)).includes('vhfgps-main-release-'+old.release));
 await context.setOffline(true);const releaseURL=page.url();await page.close();const reopened=await context.newPage();await reopened.goto(releaseURL);await reopened.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));assert.equal((await active(reopened)).id,old.id);
 await home(reopened,url);await reopened.locator('#deleteOuting').click();await reopened.locator('#confirmDelete').click();await waitAsync(reopened,async id=>!(await caches.keys()).includes('vhfgps-main-release-'+id),old.release);assert(!(await keys(reopened)).includes('vhfgps-main-release-'+old.release),'nettoyage automatique après suppression de la sortie protégée');
});

test("rejeu en cache en cours : réservation hors réseau protégée contre une purge reçue entre-temps",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const old=await create(page),alternate=alternateRelease(files,old),ids=JSON.parse(files.get('releases.json')).releases.map(row=>row.release);
 const recognized=catalogFiles(nextShell(alternate.files),[alternate.id,...ids]);serve(host,recognized);await update(page);await waitBuild(page,buildId(recognized.get('sw.js')));await home(page,url);await create(page);
 const held=await context.newPage();await held.goto(url+'held-preparation.html');await context.setOffline(true);
 const replay=await held.evaluate(async id=>(await(await import('/release.js')).download(id)).version,old.release);assert.equal(replay,old.manifest.version);
 await context.setOffline(false);const retired=catalogFiles(nextShell(recognized),[alternate.id]);serve(host,retired);await update(page);await waitBuild(page,buildId(retired.get('sw.js')));await prune(page);
 assert((await keys(page)).includes('vhfgps-main-release-'+old.release),'rejeu sans requête réseau réservé');
 await held.close();await prune(page);assert(!(await keys(page)).includes('vhfgps-main-release-'+old.release));
});

test("catalogue altéré en cache : aucun nettoyage, copie retirée conservée jusqu'à récupération d'un catalogue vérifié",async t=>{
 const {page,files,url}=await fixture(t);await home(page,url);const original=await create(page),unused=JSON.parse(files.get('releases.json')).releases.find(row=>row.release!==original.release).release;await sentinel(page,unused);
 const saved=await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();const name=(await caches.keys()).find(key=>key.startsWith('vhfgps-main-shell-'));const cache=await caches.open(name),url=new URL('/releases.json',location.href);const response=await cache.match(url);const saved=await response.text();await cache.put(url,new Response(JSON.stringify({format:1,latest:'f'.repeat(64),releases:[{release:'f'.repeat(64)}]})));return {name,saved};});
 assert.equal(await prune(page),false);assert((await keys(page)).includes('vhfgps-main-release-'+unused));assert.equal((await active(page)).id,original.id);
 await page.evaluate(async saved=>{await(await caches.open(saved.name)).put('/releases.json',new Response(saved.saved));},saved);assert.equal(await prune(page),true);assert((await keys(page)).includes('vhfgps-main-release-'+unused));
});

test("nouveau catalogue invalide malgré son empreinte correcte : mise à jour refusée et anciens moteurs préservés",async t=>{
 const {page,files,url,host,context}=await fixture(t);await home(page,url);const old=await create(page),initial=await activeBuild(page),unused=JSON.parse(files.get('releases.json')).releases.find(row=>row.release!==old.release).release;await sentinel(page,unused);
 const next=nextShell(files),catalog=JSON.parse(next.get('releases.json'));catalog.releases=[];next.set('releases.json',Buffer.from(JSON.stringify(catalog)));next.set('sw.js',prepareShell(root,next));serve(host,next);
 await page.evaluate(()=>{navigator.serviceWorker.getRegistration().then(reg=>{reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',function(){if(this.state==='redundant')window.invalidCatalogRejected=true;}));reg.update();});});await page.waitForFunction(()=>window.invalidCatalogRejected===true);
 assert.equal(await activeBuild(page),initial);assert((await keys(page)).includes('vhfgps-main-release-'+unused));assert((await keys(page)).includes('vhfgps-main-release-'+old.release));
 await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));assert.equal((await active(page)).id,old.id);
});

test("remise à zéro complète : anciennes données abandonnées, écritures obsolètes refusées, nouvelle sortie conservée ensuite",async t=>{
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const original=await create(page),token='f'.repeat(32),next=nextShell(files,{reset:token});serve(host,next);await update(page);
 await page.waitForFunction(()=>document.getElementById('create')&&!document.getElementById('create').disabled&&document.body.dataset.shellFixture==='new');
 assert.equal(await page.locator('#resume').isVisible(),false);assert.match(await page.locator('#status').innerText(),/remise à zéro/);
 const tombstone=await active(page);assert.equal(tombstone.deleted,true);assert(tombstone.revision>original.revision);
 const check=await page.evaluate(async record=>{const s=await import('/storage.js'),db=await s.openStore();try{const known=await s.read(db,'outing:'+record.id);let rejected=false;try{await s.writeActive(db,record,record.revision);}catch{rejected=true;}return {known:!!known,rejected};}finally{db.close();}},original);
 assert.deepEqual(check,{known:false,rejected:true});assert(!(await keys(page)).includes('vhfgps-main-release-'+original.release));
 const fresh=await create(page);assert.notEqual(fresh.id,original.id);await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));assert.equal((await active(page)).id,fresh.id);
});

test("mise à jour pendant une préparation : fichiers de l’accueil cohérents, actualisation après la fin de l’opération",async t=>{
 const {page,host,files,url}=await fixture(t);
 const before=new Map(files);before.set('boot.js',Buffer.from(files.get('boot.js').toString().replace('const manifest=await download(release,known?.manifest);','window.preparationReached=true;await window.preparationGate;const manifest=await download(release,known?.manifest);')));before.set('sw.js',prepareShell(root,before));serve(host,before);await home(page,url);
 await page.evaluate(()=>{window.preparationGate=new Promise((resolve,reject)=>window.endPreparation=reject);});
 await page.locator('#create').click();await page.waitForFunction(()=>window.preparationReached===true);
 const previousBoot=hash(before.get('boot.js')),next=nextShell(before);serve(host,next);await update(page);await waitBuild(page,buildId(next.get('sw.js')));
 assert.equal(await page.locator('#create').isDisabled(),true);assert.equal(await page.locator('body').getAttribute('data-shell-fixture'),null);
 const loadedHash=await page.evaluate(async()=>{const bytes=await(await fetch('./boot.js')).arrayBuffer();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');});assert.equal(loadedHash,previousBoot);
 await page.evaluate(()=>window.endPreparation(Error('Fin de la préparation simulée')));
 await page.waitForFunction(()=>document.body.dataset.shellFixture==='new'&&!document.getElementById('create').disabled);
});

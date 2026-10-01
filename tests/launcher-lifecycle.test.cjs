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
 const reg=await navigator.serviceWorker.getRegistration();if(reg?.active?.state!=="activated")return false;
 return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data.build===expected);};reg.active.postMessage({type:"VHF_LAUNCHER_INFO",api:1},[channel.port2]);});
},build);}
async function create(page){await page.locator("#create").click();await page.locator("#outingBuiltinSelect").selectOption("iroise-brest");await page.locator("#checkOutingCreate").click();await page.locator("#confirmOutingCreate").click();await page.locator("#closeOutingSuccess").click();return active(page);}
async function active(page){return page.evaluate(async()=>{const base=location.pathname.includes('/releases/')?new URL('../../',location.href):new URL('./',location.href);const s=await import(new URL('storage.js',base));const db=await s.openStore();try{return await s.read(db,'active');}finally{db.close();}});}
async function keys(page){return page.evaluate(()=>caches.keys());}
async function prune(page){await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>resolve();reg.active.postMessage({type:'VHF_RELEASE_PRUNE',api:1},[channel.port2]);});});}

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
 const {page,host,files,url,context}=await fixture(t);await home(page,url);const original=await activeBuild(page),next=nextShell(files);
 serve(host,next);host.state.virtual.set('/boot.js',files.get('boot.js'));
 const failed=page.waitForFunction(()=>window.failedWorker===true);await page.evaluate(()=>{navigator.serviceWorker.getRegistration().then(reg=>{reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',function(){if(this.state==='redundant')window.failedWorker=true;}));reg.update();});});await failed;
 assert.equal(await activeBuild(page),original);assert(!(await keys(page)).includes('vhfgps-main-shell-'+buildId(next.get('sw.js'))));
 await context.setOffline(true);await home(page,url);assert.equal(await activeBuild(page),original);
 await context.setOffline(false);serve(host,next);await update(page);await page.waitForFunction(()=>document.body.dataset.shellFixture==='new'&&!document.getElementById('create').disabled);
});

test("nettoyage après nouvelle sortie : publication active et autre page protégées, copies inutiles retirées",async t=>{
 const {page,context,url,host,files}=await fixture(t);await home(page,url);const old=await create(page);
 const other=await context.newPage();await other.goto(page.url());await other.waitForFunction(()=>document.getElementById('testBanner')?.textContent.includes('Sortie retrouvée'));
 const unused='a'.repeat(64);await page.evaluate(async id=>{const cache=await caches.open('vhfgps-main-release-'+id);await cache.put('/unused',new Response('inutile'));},unused);
 const manifest=JSON.parse(JSON.stringify(old.manifest)),newFiles=new Map();
 for(const file of manifest.files){let bytes=files.get('releases/'+old.release+'/'+file.path);if(file.path==='app.html')bytes=Buffer.from(bytes.toString().replace('<body>','<body data-publication=new>'));file.sha256=hash(bytes);newFiles.set(file.path,bytes);}
 const raw=JSON.stringify(manifest),id=hash(raw);for(const [name,bytes] of newFiles)host.state.virtual.set('/releases/'+id+'/'+name,bytes);host.state.virtual.set('/releases/'+id+'/manifest.json',Buffer.from(raw));host.state.virtual.set('/latest.json',Buffer.from(JSON.stringify({format:2,release:id})));
 await home(page,url);const next=await create(page);assert.equal(next.release,id);await prune(page);
 const cachesBefore=await keys(page);assert(cachesBefore.includes('vhfgps-main-release-'+id));assert(cachesBefore.includes('vhfgps-main-release-'+old.release));assert(!cachesBefore.includes('vhfgps-main-release-'+unused));
 await other.close();await prune(page);assert(!(await keys(page)).includes('vhfgps-main-release-'+old.release));
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

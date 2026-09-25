// Tests du script réel avec DOM simulé ; aucune dépendance ni connexion requise.
// Exécution : node --test tests/zone-session-regressions.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { webcrypto } = require('node:crypto');
const vm = require('node:vm');
const test = require('node:test');

const html = readFileSync(join(__dirname, '..', 'vhf_gps_code.html'), 'utf8');
const script = new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

async function boot() {
  const elements = new Map(), storage = new Map(), timers = new Set(), windowEvents = {};
  const noop = () => {};
  function element() {
    const events = {}, classes = new Set();
    return {
      value: '', textContent: '', dataset: {}, style: {}, options: [], children: [], disabled: false, open: false,
      get className() { return [...classes].join(' '); },
      set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      classList: {
        add: (...names) => names.forEach(c => classes.add(c)),
        remove: (...names) => names.forEach(c => classes.delete(c)),
        contains: name => classes.has(name),
        toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; },
      },
      set innerHTML(value) { this.options = []; this.children = []; this.html = value; },
      get innerHTML() { return this.html || ''; },
      appendChild(child) { this.children.push(child); this.options.push(child); },
      append(...children) { children.forEach(child => this.appendChild(child)); },
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (name, fn) => events[name] = fn,
      dispatchEvent: event => events[event.type]?.(event),
      setAttribute: noop, focus: noop, select: noop, scrollIntoView: noop,
      showModal() { this.open = true; },
      close() { this.open = false; events.close?.(); },
    };
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    assert.ok(!elements.has(match[1]), `ID dupliqué : ${match[1]}`);
    const el = element();
    el.className = match[0].match(/\bclass="([^"]*)"/)?.[1] || '';
    el.disabled = /\bdisabled\b/.test(match[0]);
    elements.set(match[1], el);
  }
  const context = vm.createContext({
    assert, console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array, btoa, atob,
    document: {
      getElementById: id => { assert.ok(elements.has(id), `ID absent : ${id}`); return elements.get(id); },
      createElement: element, documentElement: { dataset: {} },
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      addEventListener: (name, fn) => windowEvents[name] = fn,
      dispatchEvent: event => windowEvents[event.type]?.(event),
    }, navigator: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout,
  });
  const run = source => vm.runInContext(source, context);
  script.runInContext(context);
  run(`async function testCreateBuiltinOuting(zoneId=BUILTIN_ZONES[0].id){
    $('createOutingBtn').onclick();
    $('outingBuiltinChoice').onclick();
    $('outingBuiltinSelect').value=zoneId;
    await $('checkOutingCreate').onclick();
    assert.equal($('outingCreateSummary').classList.contains('hidden'),false);
    await $('confirmOutingCreate').onclick();
    assert.equal($('outingCreateDialog').open,false);
  }`);
  run(`async function testWaitZoneSwitch(){
    for(let i=0;i<100&&!$('zoneSwitchDialog').open;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal($('zoneSwitchDialog').open,true);
  }
  async function testAcceptZoneSwitch(pending){
    await testWaitZoneSwitch();
    $('confirmZoneSwitch').onclick();
    await pending;
  }
  async function testCancelZoneSwitch(pending){
    await testWaitZoneSwitch();
    $('cancelZoneSwitch').onclick();
    await pending;
  }`);
  for (let i = 0; i < 500 && run('protocolRuntimeState') === 'CHECKING'; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(run('protocolRuntimeState'), 'OK', run("$('protocolFatalDetail').textContent"));
  await run('installValidatedSecret(generateSessionSecret())');
  return { run, close: () => timers.forEach(clearTimeout) };
}

async function check(t, source) {
  const app = await boot();
  t.after(app.close);
  await app.run(`(async()=>{${source}})()`);
}

test('version et interopérabilité radio PROTO 6', t => check(t, `
  assert.match(APP_VERSION,/^[0-9]+[.][0-9]+[.][0-9]+$/);
  assert.equal(PROTOCOL_ID,'VHF-GPS-PROTO-6');
  assert.equal(await protocolCompatDigestHex(),'4043F648E26823B18361AAC243BC490C70FDC8401484759322464B8C29B16B81');
  await initProtocolCompat();
  assert.equal($('compatBadge').textContent,'COMPAT 4043F648');
`));

test('état hors réseau visible seulement après cache et service worker actifs', t => check(t, `
  globalThis.URL=class { constructor(path,scope){ this.href=scope+path; } };
  globalThis.location={protocol:'file:',hostname:''};
  await initPwa();
  assert.match($('pwaStatus').textContent,/non vérifiable depuis ce fichier/);
  location.protocol='https:';
  location.hostname='example.test';
  const registration={scope:'https://example.test/',active:{},waiting:null,addEventListener(){},update:async()=>{}};
  navigator.serviceWorker={register:async()=>registration,ready:Promise.resolve(registration),addEventListener(){},controller:{}};
  navigator.onLine=false;
  globalThis.caches={match:async()=>({})};
  window.caches=caches;
  await initPwa();
  assert.equal($('pwaStatus').textContent,'✓ PRÊTE HORS RÉSEAU');
  assert.equal($('pwaStatus').classList.contains('ready'),true);
  registration.waiting={};
  await initPwa();
  assert.match($('pwaStatus').textContent,/^✓ PRÊTE HORS RÉSEAU · ⚠️ Nouvelle version téléchargée/);
  assert.equal($('pwaUpdateDialog').open,true);
  assert.match($('pwaUpdateMessage').textContent,/fin de ta sortie de pêche/);
  assert.match($('pwaUpdateMessage').textContent,/si le protocole a changé/);
  assert.equal($('pwaStatus').classList.contains('update'),true);
  $('pwaUpdateContinue').onclick();
  assert.equal($('pwaUpdateDialog').open,false);
  await initPwa();
  assert.equal($('pwaUpdateDialog').open,false);
  caches.match=async()=>null;
  registration.waiting=null;
  await initPwa();
  assert.equal($('pwaStatus').textContent,'Préparation du mode hors réseau…');
`));

test('émission et décodage PROTO 6 dans chaque zone intégrée', t => check(t, `
  const secret=generateSessionSecret();
  for(const zone of BUILTIN_ZONES){
    for(const [dLat,dLon] of [[0,0],[0.08,-0.08]]){
      const lat=zone.lat+dLat,lon=zone.lon+dLon;
      const encoded=await encodeCore(lat,lon,secret,zone);
      const decoded=await decodeCore(encoded.phrase.words,encoded.phrase.connector,secret,zone);
      assert.ok(haversineM(lat,lon,decoded.lat,decoded.lon)<75,zone.name);
      assert.equal(decoded.ack,encoded.ack);
      assert.equal(decoded.finalConfirm,encoded.finalConfirm);
      assert.deepEqual(decoded.nacks,encoded.nacks);
    }
  }
`));

test('migration PROTO 6 : anciennes zones éphémères écartées, zones fixes conservées', t => check(t, `
  localStorage.setItem('vhfGpsZonesV4Custom',JSON.stringify([
    {id:'ancien-eph',name:'ANCIENNE',lat:46.4,lon:-3.1,anchorLat:46.5,anchorLon:-3,ephemeral:true,createdAt:Date.now(),protocolId:'VHF-GPS-PROTO-5'},
    {id:'sans-proto',name:'SANS PROTO',lat:46.4,lon:-3.1,anchorLat:46.5,anchorLon:-3,ephemeral:true,createdAt:Date.now()},
    {id:'zone-fixe',name:'FIXE',lat:46.4,lon:-3.1,ephemeral:false,builtin:false}
  ]));
  const loaded=loadZones();
  assert.ok(loaded.some(zone=>zone.id==='zone-fixe'));
  assert.ok(!loaded.some(zone=>zone.id==='ancien-eph'||zone.id==='sans-proto'));
`));

test('une ancienne empreinte ne remplace pas celle de la session active', t => check(t, `
  const firstSecret=generateSessionSecret(),secondSecret=generateSessionSecret();
  const original=sessionFingerprint;
  let releaseFirst;
  sessionFingerprint=secret=>secret===firstSecret
    ?new Promise(resolve=>releaseFirst=()=>resolve({words:['ANCIEN','SECRET','RADIO'],nato:'ALFA'}))
    :original(secret);

  const first=installValidatedSecret(firstSecret);
  assert.equal(activeSecret(),firstSecret);
  assert.equal(typeof releaseFirst,'function');
  await installValidatedSecret(secondSecret);
  const currentWords=$('fingerprintWords').textContent;
  assert.ok(currentWords);

  releaseFirst();
  assert.equal(await first,null);
  assert.equal(activeSecret(),secondSecret);
  assert.equal($('fingerprintWords').textContent,currentWords);

  const interrupted=installValidatedSecret(firstSecret);
  deactivateSessionWhileEditing();
  releaseFirst();
  assert.equal(await interrupted,null);
  assert.equal($('fingerprintBlock').classList.contains('hidden'),true);
  assert.equal($('fingerprintWords').textContent,'');
  sessionFingerprint=original;
`));

test('une ancienne activation ne poursuit pas après un rafraîchissement d’alias tardif', t => check(t, `
  const oldSecret=generateSessionSecret(),newSecret=generateSessionSecret();
  const originalRefresh=refreshZoneAliases,originalFingerprint=showSessionFingerprint;
  let releaseOld;
  showSessionFingerprint=async()=>({words:['TEST'],nato:'ALFA'});
  refreshZoneAliases=()=>activeSecret()===oldSecret
    ?new Promise(resolve=>releaseOld=resolve)
    :originalRefresh();

  const oldActivation=installValidatedSecret(oldSecret);
  await Promise.resolve();
  assert.equal(typeof releaseOld,'function');
  await installValidatedSecret(newSecret);
  const decodedRevision=decodeRevision;

  releaseOld();
  assert.equal(await oldActivation,null);
  assert.equal(activeSecret(),newSecret);
  assert.equal(decodeRevision,decodedRevision);
  refreshZoneAliases=originalRefresh;
  showSessionFingerprint=originalFingerprint;
`));

test('un ancien calcul d’alias ne restaure pas une liste de zones périmée', t => check(t, `
  const removed={id:'zone-ancienne',name:'ZONE ANCIENNE',lat:46.2,lon:-2.1,builtin:false};
  const added={id:'zone-nouvelle',name:'ZONE NOUVELLE',lat:46.3,lon:-2.2,builtin:false};
  zones.push(removed);
  await populateZones();

  const original=zoneAlias;
  let releaseOld;
  zoneAlias=(secret,zone)=>{
    if(!releaseOld)return new Promise(resolve=>releaseOld=()=>original(secret,zone).then(resolve));
    return original(secret,zone);
  };
  const stale=refreshZoneAliases();
  assert.equal(typeof releaseOld,'function');

  zones=zones.filter(zone=>zone.id!==removed.id);
  zones.push(added);
  await populateZones();
  releaseOld();
  await stale;

  for(const select of [sendZone,recvZone]){
    assert.equal(select.options.some(option=>option.value===removed.id),false);
    assert.equal(select.options.some(option=>option.value===added.id),true);
  }
  zoneAlias=original;
`));

test('réception : ET/OU se choisit en un clic, se corrige et se remet à zéro', t => check(t, `
  assert.equal(receiverConnector,'');
  const initialRevision=decodeRevision;
  connectorButtons.ET.onclick();
  assert.equal(receiverConnector,'ET');
  assert.equal(connectorButtons.ET.classList.contains('active'),true);
  assert.equal(connectorButtons.OU.classList.contains('active'),false);
  assert.ok(decodeRevision>initialRevision);

  connectorButtons.OU.onclick();
  assert.equal(receiverConnector,'OU');
  assert.equal(connectorButtons.ET.classList.contains('active'),false);
  assert.equal(connectorButtons.OU.classList.contains('active'),true);

  selectReceiverConnector('ET',{focusNext:false});
  assert.equal(receiverConnector,'ET');
  assert.equal(connectorButtons.ET.classList.contains('active'),true);

  clearReceivedMessage();
  assert.equal(receiverConnector,'');
  assert.equal(connectorButtons.ET.classList.contains('active'),false);
  assert.equal(connectorButtons.OU.classList.contains('active'),false);
`));

test('réception : retour vers une zone déjà confirmée exige une nouvelle comparaison', t => check(t, `
  const a=activeZone();
  const b=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'B');
  setActiveZone(b.id);await confirmActiveZoneAlias();
  setActiveZone(a.id);
  $('receivedZoneLat').value='46.75';$('receivedZoneLon').value='-24.50';
  await testAcceptZoneSwitch($('addReceivedZoneBtn').onclick());
  assert.equal(activeZoneId,b.id);
  assert.equal(isZoneConfirmed(b),false);
  assert.equal($('recvZoneConfirmBtn').disabled,false);
  assert.equal($('receivedZoneNotice').classList.contains('hidden'),false);
  assert.match($('receivedZoneNotice').textContent,/Vérifie maintenant/);
  assert.equal($('receivedZoneLat').value,'');
  await confirmActiveZoneAlias();
  assert.equal($('receivedZoneNotice').classList.contains('hidden'),true);
`));

test('affichage seul et sélection identique conservent la confirmation', t => check(t, `
  const a=activeZone(),b=zones.find(z=>z.id!==a.id);
  await confirmActiveZoneAlias();
  populateZones(b.id);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),a.id);
  assert.equal(sendZone.value,a.id);assert.equal(recvZone.value,a.id);
  setActiveZone(a.id);
  assert.equal(isZoneConfirmed(a),true);
  setActiveZone(b.id);await confirmActiveZoneAlias();setActiveZone(a.id);
  assert.equal(isZoneConfirmed(a),false);
  loadZoneConfirmations();assert.equal(isZoneConfirmed(a),false);
`));

test('sélecteurs de zone : annuler garde la position, confirmer la vide et impose le nouvel alias', t => check(t, `
  const a=activeZone(),b=zones.find(z=>z.id!==a.id);
  setActiveZone(b.id);await confirmActiveZoneAlias();
  setActiveZone(a.id);await confirmActiveZoneAlias();
  setPositionInputMode('decimal',{persist:false});
  setDecimalPosition(a.lat,a.lon);
  handlePositionChanged();
  const oldLat=$('lat').value,oldLon=$('lon').value;
  const oldLatDeg=$('latDeg').value,oldLonDeg=$('lonDeg').value;
  $('encodedBlock').classList.remove('hidden');
  const savedZone=localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY);
  sendZone.value=b.id;
  const cancelled=sendZone.onchange();
  assert.equal($('zoneSwitchTo').textContent,b.name);
  assert.equal(sendZone.value,a.id);
  await testCancelZoneSwitch(cancelled);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),savedZone);
  assert.equal(isZoneConfirmed(a),true);
  assert.equal($('encodedBlock').classList.contains('hidden'),false);
  assert.equal($('lat').value,oldLat);assert.equal($('lon').value,oldLon);
  assert.equal($('latDeg').value,oldLatDeg);assert.equal($('lonDeg').value,oldLonDeg);

  recvZone.value=b.id;
  await testAcceptZoneSwitch(recvZone.onchange());
  assert.equal(activeZoneId,b.id);
  assert.equal(sendZone.value,b.id);
  assert.equal(isZoneConfirmed(b),false);
  assert.equal($('encodedBlock').classList.contains('hidden'),true);
  for(const id of ['latDeg','latMin','lonDeg','lonMin','lat','lon'])assert.equal($(id).value,'');
  assert.equal($('latHem').value,b.lat>=0?'N':'S');
  assert.equal($('lonHem').value,b.lon>=0?'E':'W');
  assert.match($('positionCanonicalPreview').innerHTML,/Saisis les degrés/);
  assert.match($('driftStatusText').textContent,/Entre une position/);
  assert.match($('recvZoneConfirmBtn').textContent,/OBLIGATOIRE/);

  setDecimalPosition(b.lat,b.lon);handlePositionChanged();
  sendZone.value=a.id;
  await testAcceptZoneSwitch(sendZone.onchange());
  assert.equal(activeZoneId,a.id);
  assert.equal($('lat').value,'');assert.equal($('latDeg').value,'');
  assert.equal(isZoneConfirmed(a),false);
`));

test('création d’une zone reçue : annuler ne l’enregistre pas', t => check(t, `
  const a=activeZone(),savedZone=localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY);
  $('receivedZoneLat').value='46.75';$('receivedZoneLon').value='-24.50';
  const pending=$('addReceivedZoneBtn').onclick();
  await testCancelZoneSwitch(pending);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),savedZone);
  assert.equal(zones.some(z=>isAnchoredZone(z)),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')||'[]').length,0);
  assert.equal($('receivedZoneLat').value,'46.75');
`));

test('création d’une zone personnalisée : annuler ne l’enregistre pas', t => check(t, `
  const a=activeZone(),savedZone=localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY);
  setZoneCenterInputMode('decimal',{persist:false});
  $('zoneName').value='ESSAI';$('zoneLat').value='46.8';$('zoneLon').value='-24.5';
  const pending=$('saveZoneBtn').onclick();
  await testCancelZoneSwitch(pending);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),savedZone);
  assert.equal(zones.some(z=>z.name==='ESSAI'),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')||'[]').length,0);
`));

test('création éphémère en émission : annuler garde la zone et ne sauvegarde rien', t => check(t, `
  const a=activeZone(),savedZone=localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY);
  setPositionInputMode('decimal',{persist:false});
  $('lat').value='46.75';$('lon').value='-24.50';handlePositionChanged();
  assert.equal($('ephemeralZoneBtn').classList.contains('hidden'),false);
  $('encodedBlock').classList.remove('hidden');
  const pending=$('ephemeralZoneBtn').onclick();
  await testCancelZoneSwitch(pending);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),savedZone);
  assert.equal(zones.some(z=>isAnchoredZone(z)),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')||'[]').length,0);
  assert.equal($('encodedBlock').classList.contains('hidden'),false);
`));

test('suggestion de zone compatible : aucune bascule avant validation', t => check(t, `
  const a=activeZone(),far=BUILTIN_ZONES.findLast(z=>!zoneCheck(z.lat,z.lon,a).inside);
  assert.ok(far);
  setPositionInputMode('decimal',{persist:false});
  setDecimalPosition(far.lat,far.lon);handlePositionChanged();
  const oldLat=$('lat').value,oldLon=$('lon').value;
  refreshEncodeState();
  assert.equal($('useCompatibleZoneBtn').disabled,false);
  const target=compatibleZones(far.lat,far.lon,a.id)[0].z;
  const savedZone=localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY);
  const cancelled=$('useCompatibleZoneBtn').onclick();
  assert.equal($('zoneSwitchTo').textContent,target.name);
  await testCancelZoneSwitch(cancelled);
  assert.equal(activeZoneId,a.id);
  assert.equal(localStorage.getItem(ACTIVE_ZONE_STORAGE_KEY),savedZone);
  await testAcceptZoneSwitch($('useCompatibleZoneBtn').onclick());
  assert.equal(activeZoneId,target.id);
  assert.equal(isZoneConfirmed(target),false);
  assert.equal($('lat').value,oldLat);assert.equal($('lon').value,oldLon);
`));

test('suppression : zone de repli à reconfirmer, zone non active sans effet sur la confirmation', t => check(t, `
  const a=zones.find(z=>z.builtin);setActiveZone(a.id);await confirmActiveZoneAlias();
  const b=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'B');
  setActiveZone(b.id);deleteCustomZone(b.id);
  assert.equal(activeZoneId,a.id);assert.equal(isZoneConfirmed(a),false);
  loadZoneConfirmations();assert.equal(isZoneConfirmed(a),false);
  await confirmActiveZoneAlias();
  const c=await saveOrSelectEphemeralZone(47.25,-25.5,activeSecret(),'C');
  deleteCustomZone(c.id);
  assert.equal(activeZoneId,a.id);assert.equal(isZoneConfirmed(a),true);
  requestZoneDeletion('','manageZoneSelect');
  assert.equal($('zoneStatus').textContent,'Aucune zone personnalisée sélectionnée.');
  assert.equal($('zoneDeleteDialog').open,false);
`));

test('suppression groupée : confirmation, conservation des zones fixes et repli à reconfirmer', t => check(t, `
  const builtin=activeZone();await confirmActiveZoneAlias();
  const fixed={id:'fixed-check',name:'FIXE',lat:46.25,lon:-2.08,builtin:false};
  zones.push(fixed);saveZones();populateZones();
  const first=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'A');
  const second=await saveOrSelectEphemeralZone(47.25,-25.5,activeSecret(),'B');
  populateZones();
  setActiveZone(first.id);await confirmActiveZoneAlias();
  const button=$('deleteEphemeralZonesBtn');
  assert.equal(button.disabled,false);assert.match(button.textContent,/2 ZONES ÉPHÉMÈRES/);
  button.onclick();assert.equal($('zoneDeleteDialog').open,true);
  assert.equal($('zoneDeleteName').textContent,'2 zones éphémères');
  $('cancelZoneDelete').onclick();
  assert.equal(zones.some(z=>z.id===first.id),true);
  assert.equal(zones.some(z=>z.id===second.id),true);
  button.onclick();$('confirmZoneDelete').onclick();
  assert.equal($('zoneDeleteDialog').open,false);
  assert.equal(activeZoneId,builtin.id);
  assert.equal(isZoneConfirmed(builtin),false);
  assert.equal(confirmedZoneIds.has(first.id),false);
  assert.equal(zones.some(z=>z.id===first.id||z.id===second.id),false);
  assert.equal(zones.some(z=>z.id===fixed.id),true);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')).some(z=>z.ephemeral),false);
  assert.equal(button.disabled,true);
  assert.match($('zoneStatus').textContent,/2 zones éphémères supprimées/);
  loadZoneConfirmations();assert.equal(isZoneConfirmed(builtin),false);
`));

test('suppression groupée : une zone fixe active reste sélectionnée et confirmée', t => check(t, `
  const fixed={id:'fixed-check',name:'FIXE',lat:46.25,lon:-2.08,builtin:false};
  zones.push(fixed);saveZones();setActiveZone(fixed.id);await confirmActiveZoneAlias();
  const ephemeral=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'A');
  populateZones();$('deleteEphemeralZonesBtn').onclick();$('confirmZoneDelete').onclick();
  assert.equal(activeZoneId,fixed.id);
  assert.equal(isZoneConfirmed(fixed),true);
  assert.equal(zones.some(z=>z.id===ephemeral.id),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')).some(z=>z.id===fixed.id),true);
`));

test('suppression groupée : un calcul éphémère en cours ne recrée pas de zone', t => check(t, `
  await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'EXISTANTE');
  populateZones();
  const original=deriveSecretCenter;
  const center=await original(activeSecret(),47.25,-25.5);
  let release;
  deriveSecretCenter=()=>new Promise(resolve=>release=resolve);
  const pending=saveOrSelectEphemeralZone(47.25,-25.5,activeSecret(),'EN COURS');
  const rejection=assert.rejects(pending,/zones éphémères ont été supprimées/);
  $('deleteEphemeralZonesBtn').onclick();$('confirmZoneDelete').onclick();
  release(center);await rejection;
  deriveSecretCenter=original;
  assert.equal(zones.some(z=>z.ephemeral),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')).some(z=>z.ephemeral),false);
`));

test('expiration et purge sélectionnent le repli via la même règle de confirmation', t => check(t, `
  const a=zones.find(z=>z.builtin);setActiveZone(a.id);await confirmActiveZoneAlias();
  const b=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'B');
  setActiveZone(b.id);b.createdAt=1;
  setActiveZone(b.id);
  assert.equal(activeZoneId,a.id);assert.equal(isZoneConfirmed(a),false);
  assert.equal([...sendZone.options].some(o=>o.value===b.id),false);
  await confirmActiveZoneAlias();
  const c=await saveOrSelectEphemeralZone(47.25,-25.5,activeSecret(),'C');
  setActiveZone(c.id);purgeEphemeralZones();
  assert.equal(activeZoneId,a.id);assert.equal(isZoneConfirmed(a),false);
`));

test('réception interrompue par une nouvelle session : aucune zone ajoutée ou sélectionnée', t => check(t, `
  const a=activeZone(),oldSecret=activeSecret();
  const center=await deriveSecretCenter(oldSecret,46.75,-24.5);
  const original=deriveSecretCenter;let release;
  deriveSecretCenter=()=>new Promise(resolve=>release=resolve);
  $('receivedZoneLat').value='46.75';$('receivedZoneLon').value='-24.50';
  const pending=$('addReceivedZoneBtn').onclick();
  await installValidatedSecret(generateSessionSecret());
  release(center);await pending;deriveSecretCenter=original;
  assert.equal(activeZoneId,a.id);
  assert.equal(zones.some(z=>isAnchoredZone(z)),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')||'[]').length,0);
  assert.match($('receivedZoneStatus').textContent,/session a changé/);
  assert.equal($('receivedZoneDetails').open,true);
  assert.equal($('receivedZoneLat').value,'46.75');
  assert.equal($('addReceivedZoneBtn').disabled,false);
`));

test('calcul annulé même après retour au secret initial ou réactivation après édition', t => check(t, `
  for(const editOnly of [false,true]){
    const oldSecret=activeSecret(),original=deriveSecretCenter;
    const center=await original(oldSecret,46.75,-24.5);let release;
    deriveSecretCenter=()=>new Promise(resolve=>release=resolve);
    const pending=saveOrSelectEphemeralZone(46.75,-24.5,oldSecret);
    const rejected=assert.rejects(pending,/session a changé/);
    if(editOnly)deactivateSessionWhileEditing();
    else await installValidatedSecret(generateSessionSecret());
    await installValidatedSecret(oldSecret);
    release(center);await rejected;deriveSecretCenter=original;
    assert.equal(zones.some(z=>isAnchoredZone(z)),false);
  }
`));

test('émission interrompue pendant la recherche : aucune ancienne zone réintroduite', t => check(t, `
  const a=activeZone(),oldSecret=activeSecret();
  const center=await deriveSecretCenter(oldSecret,46.75,-24.5);
  const original=createEphemeralZoneCandidate,originalRead=readActivePosition;
  let release;createEphemeralZoneCandidate=()=>new Promise(resolve=>release=resolve);
  readActivePosition=()=>({ok:true,lat:46.75,lon:-24.5});
  const pending=$('ephemeralZoneBtn').onclick();
  await installValidatedSecret(generateSessionSecret());
  release({z:center,publicDistance:150});await pending;
  createEphemeralZoneCandidate=original;readActivePosition=originalRead;
  assert.equal(activeZoneId,a.id);
  assert.equal(zones.some(z=>isAnchoredZone(z)),false);
  assert.match($('encodeStatus').textContent,/session a changé/);
`));

test('réception normale : création persistante, sélection et confirmation humaine', t => check(t, `
  $('receivedZoneLat').value='46.75';$('receivedZoneLon').value='-24.50';
  await testAcceptZoneSwitch($('addReceivedZoneBtn').onclick());
  const z=activeZone();assert.equal(z.anchorLat,46.75);assert.equal(z.anchorLon,-24.5);
  assert.equal(isZoneConfirmed(z),false);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')).some(x=>x.id===z.id),true);
  assert.equal(sendZone.value,z.id);assert.equal(recvZone.value,z.id);
  await confirmActiveZoneAlias();assert.equal(isZoneConfirmed(z),true);
`));

test('émission normale : création éphémère et confirmation toujours fonctionnelles', t => check(t, `
  let scrolls=0;
  $('ephemeralBlock').scrollIntoView=options=>{
    assert.equal(options.behavior,'smooth');assert.equal(options.block,'start');
    assert.equal($('ephemeralBlock').classList.contains('hidden'),false);
    assert.equal($('ephemeralAliasConfirmBtn').disabled,false);
    scrolls++;
  };
  setPositionInputMode('decimal',{persist:false});
  $('lat').value='46.75';$('lon').value='-24.50';handlePositionChanged();
  await testAcceptZoneSwitch($('ephemeralZoneBtn').onclick());
  assert.equal(scrolls,1);
  const z=activeZone();assert.equal(isAnchoredZone(z),true);
  assert.equal(isZoneConfirmed(z),false);
  assert.equal($('ephemeralBlock').classList.contains('hidden'),false);
  assert.equal($('ephemeralAliasConfirmBtn').disabled,false);
  assert.equal($('encodeBtn').disabled,true);
  assert.match($('encodeStatus').textContent,/Zone éphémère créée et sélectionnée/);
  await confirmActiveZoneAlias();
  assert.equal($('encodeBtn').disabled,false);
  assert.equal($('encodeBtn').classList.contains('encode-ready'),true);
`));

test('les détails du contrôle sont optionnels, le contrôle lui-même reste obligatoire', t => check(t, `
  const zone=activeZone();
  await confirmActiveZoneAlias();
  setPositionInputMode('decimal',{persist:false});
  $('lat').value=String(zone.lat);$('lon').value=String(zone.lon);handlePositionChanged();
  assert.equal($('showDebugDetails').checked,false);

  await encodeSelectedPosition();
  assert.equal($('encodedBlock').classList.contains('hidden'),false);
  assert.equal($('debugBlock').classList.contains('hidden'),true);
  assert.ok($('debugSummary').textContent.includes('Aller/retour validé'));

  $('showDebugDetails').checked=true;
  $('showDebugDetails').dispatchEvent({type:'change'});
  assert.equal(localStorage.getItem(DEBUG_DETAILS_STORAGE_KEY),'1');
  assert.equal($('debugBlock').classList.contains('hidden'),false);
  $('showDebugDetails').checked=false;
  $('showDebugDetails').dispatchEvent({type:'change'});
  assert.equal($('debugBlock').classList.contains('hidden'),true);

  const original=decodeCore;
  decodeCore=async (...args)=>({...await original(...args),index:-1});
  await $('encodeBtn').onclick();
  assert.match($('encodeStatus').textContent,/Contrôle automatique du code échoué/);
  assert.equal($('encodedBlock').classList.contains('hidden'),true);
  assert.equal($('senderAckBlock').classList.contains('hidden'),true);
`));

test('position confirmée : distance, relèvement vrai et saisie manuelle', t => check(t, `
  currentDecodedResult={lat:46,lon:-2};
  markPositionConfirmed();
  assert.equal($('relativePositionBlock').classList.contains('hidden'),false);
  setRelativePositionMode('decimal');
  $('relativeLat').value='46';$('relativeLon').value='-3';onRelativeManualChange();
  assert.equal($('relativePositionResult').classList.contains('hidden'),false);
  assert.match($('relativePositionResult').innerHTML,/milles nautiques/);
  assert.match($('relativePositionResult').innerHTML,/090° vrai/);
  $('relativeLon').value='200';onRelativeManualChange();
  assert.equal($('relativePositionResult').classList.contains('hidden'),true);
  assert.match($('relativeInputStatus').textContent,/Coordonnées invalides/);
  assert.ok(Math.abs(haversineM(0,0,1,0)-111195)<50);
  assert.equal(Math.round(initialBearingTrueDeg(0,0,1,0)),0);
`));

test('une acquisition GPS tardive ne réaffiche pas une réception effacée', t => check(t, `
  currentDecodedResult={lat:46,lon:-2};markPositionConfirmed();
  let deliver;
  navigator.geolocation={getCurrentPosition:success=>deliver=success};
  $('relativeGpsBtn').onclick();
  assert.equal(typeof deliver,'function');
  invalidateDecodedResult();
  deliver({coords:{latitude:46,longitude:-3,accuracy:12},timestamp:Date.now()});
  assert.equal($('relativePositionBlock').classList.contains('hidden'),true);
  assert.equal($('relativePositionResult').classList.contains('hidden'),true);
  assert.equal($('relativeLat').value,'');
`));

test('GPS actuel : distance affichée avec heure et précision du relevé', t => check(t, `
  currentDecodedResult={lat:46,lon:-2};markPositionConfirmed();
  navigator.geolocation={getCurrentPosition:success=>success({
    coords:{latitude:46,longitude:-3,accuracy:18},timestamp:Date.now()
  })};
  $('relativeGpsBtn').onclick();
  assert.match($('relativeGpsStatus').textContent,/précision annoncée ±18 m/);
  assert.match($('relativePositionResult').innerHTML,/090° vrai/);
  assert.equal($('relativePositionResult').classList.contains('hidden'),false);
`));

test('une acquisition GPS tardive ne remplace pas les coordonnées saisies', t => check(t, `
  const requests=[];
  navigator.geolocation={getCurrentPosition:(success,error,options)=>requests.push({success,options})};
  setPositionInputMode('decimal',{persist:false});
  $('gpsBtn').onclick();
  assert.equal(requests[0].options.enableHighAccuracy,true);
  assert.equal(requests[0].options.maximumAge,0);
  assert.equal(requests[0].options.timeout,60000);
  $('lat').value='46.1';$('lon').value='-2.2';syncPositionFromDecimal();
  requests[0].success({coords:{latitude:47,longitude:-3,accuracy:10}});
  assert.equal($('lat').value,'46.1');
  assert.equal($('lon').value,'-2.2');

  setZoneCenterInputMode('decimal',{persist:false});
  $('centerGpsBtn').onclick();
  assert.equal(requests[1].options.timeout,60000);
  $('zoneLat').value='46.3';$('zoneLon').value='-2.4';syncZoneCenterFromDecimal();
  requests[1].success({coords:{latitude:47,longitude:-3,accuracy:10}});
  assert.equal($('zoneLat').value,'46.3');
  assert.equal($('zoneLon').value,'-2.4');
`));

test('installation : confirmation directe disponible ou aide iPhone', t => check(t, `
  globalThis.location={protocol:'https:',hostname:'example.test'};
  navigator.serviceWorker={};
  refreshInstallButton();
  assert.equal($('installAppBtn').classList.contains('hidden'),false);

  let prevented=false,prompted=0;
  window.dispatchEvent({type:'beforeinstallprompt',preventDefault(){prevented=true;},
    prompt(){prompted++;return Promise.resolve();},
    userChoice:Promise.resolve({outcome:'accepted'})});
  assert.equal(prevented,true);
  await $('installAppBtn').onclick();
  assert.equal(prompted,1);
  window.dispatchEvent({type:'appinstalled'});
  assert.equal($('installAppBtn').classList.contains('hidden'),true);

  installEventCompleted=false;
  navigator.userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)';
  refreshInstallButton();
  await $('installAppBtn').onclick();
  assert.match($('installHelp').textContent,/Safari.*Partager.*Sur l’écran d’accueil/);
  assert.equal($('installHelp').classList.contains('hidden'),false);
  navigator.standalone=true;
  refreshInstallButton();
  assert.equal($('installAppBtn').classList.contains('hidden'),true);
  assert.equal($('installHelp').classList.contains('hidden'),true);
`));

test('sortie complète : création, texte copiable, contrôle et réimport sans effet', t => check(t, `
  const previous=activeSecret();
  let sessionScrolls=0;
  $('sessionCard').scrollIntoView=options=>{
    assert.equal(options.behavior,'smooth');assert.equal(options.block,'start');sessionScrolls++;
  };
  assert.equal(localStorage.getItem(OUTING_INSTALLED_AT_KEY),null);
  for(const id of ['latDeg','latMin','lonDeg','lonMin','lat','lon'])$(id).value='12';
  wordInputs[0].value='AUTRUCHE';
  receiverConnector='ET';
  await testCreateBuiltinOuting();
  assert.notEqual(activeSecret(),previous);
  assert.ok(isZoneConfirmed(activeZone()));
  assert.equal(outingMatchesOriginalZone(activeZone()),true);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),false);
  for(const id of ['latDeg','latMin','lonDeg','lonMin','lat','lon'])assert.equal($(id).value,'');
  assert.equal(wordInputs[0].value,'');
  assert.equal(receiverConnector,'');
  assert.match($('sendZoneConfirmBtn').textContent,/VALIDÉE AVEC LA SORTIE/);
  assert.equal($('outingSuccessDialog').open,true);
  assert.match($('outingSuccessMessage').textContent,/Sortie créée et active/);
  assert.equal($('outingSettings').open,true);
  assert.equal(sessionScrolls,0);
  $('closeOutingSuccess').onclick();
  assert.equal($('outingSuccessDialog').open,false);
  assert.equal($('outingSettings').open,true);
  assert.match($('sessionCompactStatus').textContent,/Session active/);
  const payload=await activeOutingPayload();
  const invitation=await formatOutingInvitation(payload);
  assert.match(invitation,/Envoyez cette invitation telle quelle/);
  assert.match(invitation,/^🎣 Invitation pour une sortie VHF-GPS/u);
  for(const icon of ['🗓️','📍','🔧','🔐','📣','📲','⚠️'])assert.ok(invitation.includes(icon));
  const code=invitation.split(OUTING_BEGIN)[1].split(OUTING_END)[0].trim();
  assert.match(code,/^[A-Za-z0-9_.-]+$/);
  const prepared=await inspectOutingInvitation('Bonjour les amis\\n'+invitation+'\\nA demain !');
  assert.equal(prepared.data.secret,activeSecret());
  assert.equal(prepared.data.zone.id,activeZone().id);
  const legacyLabels=invitation.replace('🔐 Alias de session','Alias de session').replace('📣 Alias de zone','Alias de zone');
  assert.equal((await inspectOutingInvitation(legacyLabels)).data.id,payload.id);
  await assert.rejects(inspectOutingInvitation(invitation.replace('📍 Zone : '+activeZone().name,'📍 Zone : AUTRE')),/résumé lisible/);
  await assert.rejects(inspectOutingInvitation(invitation.replace('🔧 PROTO 6','🔧 PROTO 5')),/résumé lisible/);
  const changedDisplayDate=invitation.replace('🗓️ Créée le '+outingDate(payload.createdAt),'🗓️ Créée le 01/01 à 00:00');
  assert.equal((await inspectOutingInvitation(changedDisplayDate)).data.createdAt,payload.createdAt);
  const codeOnlyWithIntro='Zone : rendez-vous au port\\n'+OUTING_BEGIN+'\\n'+code+'\\n'+OUTING_END;
  assert.equal((await inspectOutingInvitation(codeOnlyWithIntro)).data.id,payload.id);
  const installedAt=localStorage.getItem(OUTING_INSTALLED_AT_KEY);
  $('lat').value='46.2';wordInputs[0].value='RENARD';
  assert.equal(await installOutingInvitation(prepared),'Cette sortie est déjà installée et active.');
  assert.equal($('lat').value,'46.2');
  assert.equal(wordInputs[0].value,'RENARD');
  assert.equal(localStorage.getItem(OUTING_INSTALLED_AT_KEY),installedAt);
  const badChar=code[12]==='A'?'B':'A';
  const tampered=invitation.replace(code,code.slice(0,12)+badChar+code.slice(13));
  await assert.rejects(inspectOutingInvitation(tampered),/intégrité/);
`));

test('zones compatibles : intégrée puis éphémère puis personnalisée, meilleure marge dans chaque catégorie', t => check(t, `
  const p={lat:46.75,lon:-24.50};
  zones.push(
    {id:'custom-far',name:'CUSTOM',lat:p.lat,lon:p.lon,builtin:false},
    {id:'eph-far',name:'EPH',lat:p.lat+0.1,lon:p.lon,anchorLat:46.8,anchorLon:-24.5,ephemeral:true,createdAt:Date.now()},
    {id:'eph-far-best',name:'EPH BEST',lat:p.lat,lon:p.lon,anchorLat:46.75,anchorLon:-24.5,ephemeral:true,createdAt:Date.now()}
  );
  let ranked=compatibleZones(p.lat,p.lon,'none');
  assert.deepEqual(ranked.map(x=>x.z.id),['eph-far-best','eph-far','custom-far']);
  zones.push({id:'builtin-far',name:'CATALOGUE',lat:p.lat+0.2,lon:p.lon,builtin:true});
  ranked=compatibleZones(p.lat,p.lon,'none');
  assert.equal(ranked[0].z.id,'builtin-far');
  assert.equal(ranked[1].z.id,'eph-far-best');
`));

test('création éphémère : masquée si une zone commune a de la marge, proposée près du bord ou avec seulement une zone locale', t => check(t, `
  const z=activeZone(),allZones=zones;
  zones=[z];
  setPositionInputMode('decimal',{persist:false});
  $('lat').value=String(z.lat);$('lon').value=String(z.lon);handlePositionChanged();
  assert.equal($('ephemeralZoneBtn').classList.contains('hidden'),true);
  $('lat').value=String(z.lat+(HALF_KM-10)/111.32);handlePositionChanged();
  assert.equal($('ephemeralZoneBtn').classList.contains('hidden'),false);
  zones=[...allZones,{id:'custom-only',name:'LOCALE',lat:46.75,lon:-24.5,builtin:false}];
  $('lat').value='46.75';$('lon').value='-24.5';handlePositionChanged();
  assert.equal($('ephemeralZoneBtn').classList.contains('hidden'),false);
  assert.equal(compatibleZones(46.75,-24.5,z.id)[0].z.id,'custom-only');
  zones.push({id:'eph-only',name:'EPHEMERE',lat:46.75,lon:-24.5,
    anchorLat:46.75,anchorLon:-24.5,ephemeral:true,createdAt:Date.now()});
  refreshEncodeState();
  assert.equal($('ephemeralZoneBtn').classList.contains('hidden'),true);
`));

test('session manuelle : aucune date de sortie et modale de succès temporaire', t => check(t, `
  await testCreateBuiltinOuting();
  assert.ok(localStorage.getItem(OUTING_INSTALLED_AT_KEY));
  showOutingSuccessDialog('Succès temporaire',1);
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal($('outingSuccessDialog').open,false);
  await installValidatedSecret(generateSessionSecret());
  refreshOutingActions();
  assert.equal(localStorage.getItem(OUTING_ID_KEY),null);
  assert.equal(localStorage.getItem(OUTING_INSTALLED_AT_KEY),null);
  assert.doesNotMatch($('outingLocalTimes').textContent,/installée sur ce téléphone/);
`));

test('le bouton copie le message complet et garde le code ASCII', t => check(t, `
  await testCreateBuiltinOuting();
  const payload=await activeOutingPayload();
  let copied='';
  navigator.clipboard={writeText:async text=>{copied=text;}};
  await $('copyOutingBtn').onclick();
  assert.equal($('outingShareDialog').open,true);
  assert.equal(copied,'');
  assert.equal($('copyOutingMessageBtn').disabled,false);
  await $('copyOutingMessageBtn').onclick();
  assert.equal(copied,$('outingShareText').value);
  assert.match(copied,/Invitation pour une sortie VHF-GPS/);
  assert.match(copied,/Envoyez cette invitation telle quelle/);
  assert.ok(copied.includes('Alias de session (empreinte radio) : '+payload.fingerprint));
  assert.ok(copied.includes('Alias de zone : '+payload.alias));
  const code=copied.split(OUTING_BEGIN)[1].split(OUTING_END)[0].trim();
  assert.match(code,/^VHF1\\.[A-Za-z0-9_-]+\\.[A-F0-9]{16}$/);
  await assert.rejects(
    inspectOutingInvitation(copied.replace('Alias de zone : '+payload.alias,'Alias de zone : AUTRE')),
    /résumé lisible/
  );
  assert.match($('outingShareStatus').textContent,/Invitation copiée/);
  $('closeOutingShare').onclick();
  assert.equal($('outingShareDialog').open,false);
  assert.equal($('outingShareText').value,'');
`));

test('partage natif : message entier transmis au téléphone sans URL contenant le secret', t => check(t, `
  await testCreateBuiltinOuting();
  const calls=[];
  navigator.canShare=data=>typeof data.text==='string';
  navigator.share=data=>{calls.push(data);return Promise.resolve();};
  await $('copyOutingBtn').onclick();
  assert.equal($('nativeShareOutingBtn').classList.contains('hidden'),false);
  assert.equal($('nativeShareOutingBtn').disabled,false);
  const invitation=$('outingShareText').value;
  const pending=$('nativeShareOutingBtn').onclick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].text,invitation);
  assert.deepEqual(Object.keys(calls[0]),['text']);
  await pending;
  assert.match($('outingShareStatus').textContent,/Vérifie le destinataire/);
  assert.equal($('copyOutingMessageBtn').disabled,false);

  navigator.share=()=>Promise.reject(Object.assign(new Error('annulé'),{name:'AbortError'}));
  await $('nativeShareOutingBtn').onclick();
  assert.match($('outingShareStatus').textContent,/Partage annulé/);
  assert.equal($('outingShareText').value,invitation);
  assert.equal($('copyOutingMessageBtn').disabled,false);
`));

test('sans partage natif, le bouton de partage est masqué et la copie reste disponible', t => check(t, `
  await testCreateBuiltinOuting();
  await $('copyOutingBtn').onclick();
  assert.equal($('nativeShareOutingBtn').classList.contains('hidden'),true);
  assert.equal($('copyOutingMessageBtn').disabled,false);
`));

test('partage : fermer pendant la préparation écarte le résultat tardif', t => check(t, `
  await testCreateBuiltinOuting();
  const original=activeOutingPayload;
  let release;
  activeOutingPayload=async()=>new Promise(resolve=>{release=()=>original().then(resolve);});
  const preparing=$('copyOutingBtn').onclick();
  assert.equal($('outingShareDialog').open,true);
  assert.equal(typeof release,'function');
  $('closeOutingShare').onclick();
  release();
  await preparing;
  assert.equal($('outingShareDialog').open,false);
  assert.equal($('outingShareText').value,'');
  assert.equal(outingShareReady,null);
  assert.equal($('copyOutingBtn').disabled,false);
  activeOutingPayload=original;
`));

test('partage : une autre sortie sur la même zone écarte l’ancienne invitation en cours', t => check(t, `
  await testCreateBuiltinOuting();
  const payload=await activeOutingPayload();
  const originalPayload=activeOutingPayload,originalFormat=formatOutingInvitation;
  activeOutingPayload=async()=>payload;
  let release;
  formatOutingInvitation=()=>new Promise(resolve=>{release=()=>originalFormat(payload).then(resolve);});
  const pending=$('copyOutingBtn').onclick();
  await Promise.resolve();
  assert.equal(typeof release,'function');
  const newId=randomOutingId();
  localStorage.setItem(OUTING_ID_KEY,newId);
  saveOutingOrigin(newId,activeZone());
  release();await pending;
  assert.equal($('outingShareText').value,'');
  assert.equal(outingShareReady,null);
  assert.match($('outingShareStatus').textContent,/session ou la zone a changé/);
  activeOutingPayload=originalPayload;formatOutingInvitation=originalFormat;
`));

test('partage : une copie refusée garde le message visible pour copie manuelle', t => check(t, `
  await testCreateBuiltinOuting();
  navigator.clipboard={writeText:async()=>{throw new Error('refus');}};
  await $('copyOutingBtn').onclick();
  await $('copyOutingMessageBtn').onclick();
  assert.equal($('outingShareDialog').open,true);
  assert.match($('outingShareStatus').textContent,/copie-la manuellement/);
  assert.match($('outingShareText').value,/Invitation pour une sortie/);
  assert.equal($('copyOutingMessageBtn').disabled,false);
`));

test('import par la modale : aucune activation avant le clic final', t => check(t, `
  await testCreateBuiltinOuting();
  const invitation=await formatOutingInvitation(await activeOutingPayload());
  await installValidatedSecret(generateSessionSecret());
  const before=activeSecret();
  let sessionScrolls=0;
  $('sessionCard').scrollIntoView=options=>{
    assert.equal(options.behavior,'smooth');assert.equal(options.block,'start');sessionScrolls++;
  };
  for(const id of ['latDeg','latMin','lonDeg','lonMin','lat','lon'])$(id).value='23';
  wordInputs[0].value='BALEINE';receiverConnector='OU';
  $('receiveOutingBtn').onclick();
  assert.equal($('outingImportDialog').open,true);
  assert.equal($('outingImportSummary').classList.contains('hidden'),true);
  $('outingImportText').value='Bonjour\\n'+invitation+'\\nA demain';
  await $('checkOutingBtn').onclick();
  assert.equal($('outingImportDialog').open,true);
  assert.equal(activeSecret(),before);
  assert.equal($('outingImportSummary').classList.contains('hidden'),false);
  assert.equal(sessionScrolls,0);
  assert.equal($('outingImportVerified').classList.contains('hidden'),false);
  assert.match($('outingImportSummary').children[0].children[1].textContent,/\\d/);
  await $('confirmOutingImport').onclick();
  assert.equal($('outingImportDialog').open,false);
  assert.notEqual(activeSecret(),before);
  assert.ok(isZoneConfirmed(activeZone()));
  for(const id of ['latDeg','latMin','lonDeg','lonMin','lat','lon'])assert.equal($(id).value,'');
  assert.equal(wordInputs[0].value,'');
  assert.equal(receiverConnector,'');
  assert.equal($('outingSuccessDialog').open,true);
  assert.match($('outingSuccessMessage').textContent,/Sortie installée/);
  assert.equal($('outingSettings').open,false);
  assert.equal(sessionScrolls,0);
  assert.match($('sendZoneConfirmBtn').textContent,/VALIDÉE AVEC LA SORTIE/);
  assert.equal($('outingImportText').value,'');
`));

test('réception : annuler ou modifier le texte n’installe rien', t => check(t, `
  await testCreateBuiltinOuting();
  const invitation=await formatOutingInvitation(await activeOutingPayload());
  await installValidatedSecret(generateSessionSecret());
  const before=activeSecret(),zoneId=activeZoneId;
  $('receiveOutingBtn').onclick();
  $('outingImportText').value=invitation;
  await $('checkOutingBtn').onclick();
  assert.ok(pendingOutingImport);
  $('outingImportText').value+=' texte corrigé';
  $('outingImportText').dispatchEvent({type:'input'});
  assert.equal(pendingOutingImport,null);
  assert.equal($('outingImportSummary').classList.contains('hidden'),true);
  assert.equal($('outingImportVerified').classList.contains('hidden'),true);
  await $('confirmOutingImport').onclick();
  assert.equal(activeSecret(),before);
  assert.equal(activeZoneId,zoneId);
  $('cancelOutingImport').onclick();
  assert.equal($('outingImportDialog').open,false);
  assert.equal($('outingImportText').value,'');
  assert.equal(activeSecret(),before);
`));

test('réception : erreur et résultat asynchrone périmé restent dans la fenêtre', t => check(t, `
  const before=activeSecret();
  $('receiveOutingBtn').onclick();
  $('outingImportText').value='message sans code';
  await $('checkOutingBtn').onclick();
  assert.match($('outingImportDialogError').textContent,/introuvable/);
  assert.equal($('outingImportSummary').classList.contains('hidden'),true);
  const original=inspectOutingInvitation;
  let release;
  inspectOutingInvitation=async()=>new Promise(resolve=>{release=()=>resolve({data:{},zone:{},fingerprint:'',alias:''});});
  const pending=$('checkOutingBtn').onclick();
  assert.equal(typeof release,'function');
  $('cancelOutingImport').onclick();
  release();
  await pending;
  assert.equal($('outingImportDialog').open,false);
  assert.equal(pendingOutingImport,null);
  assert.equal(activeSecret(),before);
  inspectOutingInvitation=original;
`));

test('sortie complète : refus avant confirmation et restauration avec date d’origine', t => check(t, `
  await testCreateBuiltinOuting();
  const payload=await activeOutingPayload();
  const invitation=await formatOutingInvitation(payload);
  const other=generateSessionSecret();
  await installValidatedSecret(other);
  assert.notEqual(activeSecret(),payload.secret);
  const prepared=await inspectOutingInvitation(invitation);
  assert.equal(activeSecret(),other);
  const result=await installOutingInvitation(prepared);
  assert.match(result,/Sortie installée/);
  assert.equal(activeSecret(),payload.secret);
  assert.equal(sessionCreatedAt(),payload.createdAt);
  assert.equal(localStorage.getItem(OUTING_ID_KEY),payload.id);
  assert.ok(isZoneConfirmed(activeZone()));
  const wrongCompat={...payload,compat:'0'.repeat(64)};
  await assert.rejects(inspectOutingInvitation(await formatOutingInvitation(wrongCompat)),/COMPAT différent/);
`));

test('session manuelle : une zone éphémère confirmée ne devient pas une sortie complète à partager', t => check(t, `
  await $('generateSecret').onclick();
  const secret=activeSecret(),anchorLat=46.75,anchorLon=-3.25;
  const original=await saveOrSelectEphemeralZone(anchorLat,anchorLon,secret);
  setActiveZone(original.id,{refresh:false});
  await confirmActiveZoneAlias();
  assert.equal(localStorage.getItem(OUTING_ID_KEY),null);
  assert.equal(outingMatchesOriginalZone(original),false);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),true);
  await assert.rejects(activeOutingPayload(),/sortie créée ou importée/);
`));

test('zone éphémère de sortie : même libellé des deux côtés, suppression protégée et préparation anticipée', t => check(t, `
  $('createOutingBtn').onclick();
  $('outingEphemeralChoice').onclick();$('outingDecimalMode').onclick();
  $('outingLat').value='46.60';$('outingLon').value='-3.30';
  await $('checkOutingCreate').onclick();await $('confirmOutingCreate').onclick();
  const creator=activeZone(),creatorName=creator.name;
  assert.equal(creatorName,OUTING_EPHEMERAL_NAME);
  assert.equal(zoneDisplayName(creator),'** '+OUTING_EPHEMERAL_NAME+' **');
  assert.equal(isOutingEphemeral(creator),true);
  assert.equal(outingMatchesOriginalZone(creator),true);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),false);
  const legacy={...creator,name:'ÉPHÉMÈRE 12:30'};
  delete legacy.outingId;
  localStorage.setItem('vhfGpsZonesV4Custom',JSON.stringify([legacy]));
  const migrated=loadZones().find(z=>z.id===creator.id);
  assert.equal(migrated.name,OUTING_EPHEMERAL_NAME);
  assert.equal(migrated.outingId,localStorage.getItem(OUTING_ID_KEY));
  saveZones();
  assert.equal($('sendDeleteZoneBtn').classList.contains('hidden'),true);
  assert.equal($('recvDeleteZoneBtn').classList.contains('hidden'),true);
  const payload=await activeOutingPayload(),invitation=await formatOutingInvitation(payload);
  creator.createdAt=Date.now()-3*EPHEMERAL_TTL_MS;
  saveZones();
  assert.equal(isRecentEphemeral(creator),true);
  assert.ok(loadZones().some(z=>z.id===creator.id));
  setActiveZone(creator.id);
  assert.equal(activeZone().id,creator.id);
  requestZoneDeletion(creator.id,'manageZoneSelect');
  assert.equal($('zoneDeleteDialog').open,false);
  assert.match($('zoneStatus').textContent,/conservée/);
  assert.throws(()=>deleteCustomZone(creator.id),/conservée/);
  $('manageZoneSelect').value=creator.id;$('manageZoneSelect').onchange();
  assert.equal($('deleteZoneBtn').disabled,true);
  const ordinary=await saveOrSelectEphemeralZone(46.75,-24.5,activeSecret(),'ORDINAIRE');
  await populateZones();
  assert.match($('deleteEphemeralZonesBtn').textContent,/LA ZONE ÉPHÉMÈRE/);
  $('deleteEphemeralZonesBtn').onclick();
  assert.match($('zoneDeleteDescription').textContent,/zone éphémère de sortie sera conservée/);
  $('confirmZoneDelete').onclick();
  assert.ok(zones.some(z=>z.id===creator.id));
  assert.ok(!zones.some(z=>z.id===ordinary.id));
  assert.equal(activeZone().id,creator.id);
  assert.equal($('deleteEphemeralZonesBtn').disabled,true);
  await installValidatedSecret(generateSessionSecret());
  assert.ok(!zones.some(z=>z.id===creator.id));
  const prepared=await inspectOutingInvitation(invitation);
  await installOutingInvitation(prepared);
  assert.equal(activeZone().name,creatorName);
  assert.equal(isOutingEphemeral(activeZone()),true);
  assert.equal(outingMatchesOriginalZone(activeZone()),true);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),false);
  assert.equal(zoneFingerprint(activeZone()),zoneFingerprint(creator));
  activeZone().createdAt=Date.now()-3*EPHEMERAL_TTL_MS;
  saveZones();
  assert.ok(loadZones().some(z=>z.id===activeZoneId));
`));

test('préparation intégrée : catalogue unique, choix indépendant et annulation sans effet', t => check(t, `
  const oldSecret=activeSecret(),oldZone=activeZone();
  $('createOutingBtn').onclick();
  assert.equal($('outingCreateDialog').open,true);
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),false);
  assert.match($('outingBoundsPreview').innerHTML,/Limites encodables/);
  assert.equal($('outingBuiltinSelect').options.length,BUILTIN_ZONES.length);
  for(const z of BUILTIN_ZONES){
    assert.ok(z.region,'Chaque zone intégrée doit indiquer sa façade maritime.');
    assert.ok($('outingBuiltinSelect').options.some(option=>option.value===z.id));
    assert.ok($('outingBuiltinSelect').options.some(option=>option.value===z.id&&option.textContent.startsWith(z.region+' · ')));
  }
  const selected=BUILTIN_ZONES.find(z=>z.id!==oldZone.id);
  $('outingBuiltinSelect').value=selected.id;
  $('outingBuiltinSelect').onchange();
  assert.ok($('outingBoundsPreview').innerHTML.includes(formatDegMin(selected.lat,true)));
  assert.equal(activeZone().id,oldZone.id);
  await $('checkOutingCreate').onclick();
  assert.equal(activeSecret(),oldSecret);
  assert.equal(activeZone().id,oldZone.id);
  $('cancelOutingCreate').onclick();
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),true);
  assert.equal(activeSecret(),oldSecret);
  assert.equal(activeZone().id,oldZone.id);
  $('createOutingBtn').onclick();
  $('outingBuiltinSelect').value=selected.id;
  await $('checkOutingCreate').onclick();
  await $('confirmOutingCreate').onclick();
  assert.notEqual(activeSecret(),oldSecret);
  assert.equal(activeZone().id,selected.id);
  assert.ok(isZoneConfirmed(activeZone()));
`));

test('préparation éphémère : référence indépendante d’ÉMETTRE et centre recalculé', t => check(t, `
  const oldSecret=activeSecret();
  setPositionInputMode('decimal',{persist:false});
  $('lat').value='1';$('lon').value='2';syncPositionFromDecimal();
  $('createOutingBtn').onclick();
  $('outingEphemeralChoice').onclick();
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),true);
  $('outingDecimalMode').onclick();
  $('outingLat').value='46.60';$('outingLon').value='-3.30';
  await $('checkOutingCreate').onclick();
  assert.equal(activeSecret(),oldSecret);
  assert.equal($('outingCreateSummary').classList.contains('hidden'),false);
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),false);
  assert.ok($('outingBoundsPreview').innerHTML.includes(formatDegMin(pendingOutingCreation.candidate.lat,true)));
  assert.match($('outingBoundsPreview').innerHTML,/ne pas transmettre à la VHF/);
  assert.match($('outingCreateSummary').children[1].children[1].textContent,/46°/);
  await $('confirmOutingCreate').onclick();
  assert.notEqual(activeSecret(),oldSecret);
  assert.ok(isAnchoredZone(activeZone()));
  const expected=await deriveSecretCenter(activeSecret(),activeZone().anchorLat,activeZone().anchorLon);
  assert.equal(activeZone().lat,expected.lat);
  assert.equal(activeZone().lon,expected.lon);
  assert.ok(zoneCheck(46.60,-3.30,activeZone()).nearest>=EPHEMERAL_EDGE_MARGIN_KM);
  assert.equal($('lat').value,'');
  assert.equal($('lon').value,'');
`));

test('préparation éphémère : modifier la référence invalide la vérification', t => check(t, `
  const secret=activeSecret(),zoneId=activeZoneId;
  $('createOutingBtn').onclick();
  $('outingEphemeralChoice').onclick();
  $('outingDecimalMode').onclick();
  $('outingLat').value='46.60';$('outingLon').value='-3.30';
  await $('checkOutingCreate').onclick();
  assert.ok(pendingOutingCreation);
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),false);
  $('outingLat').value='46.61';
  $('outingLat').dispatchEvent({type:'input'});
  assert.equal(pendingOutingCreation,null);
  assert.equal($('outingBoundsPreview').classList.contains('hidden'),true);
  assert.equal($('confirmOutingCreate').classList.contains('hidden'),true);
  await $('confirmOutingCreate').onclick();
  assert.equal(activeSecret(),secret);
  assert.equal(activeZoneId,zoneId);
  await $('checkOutingCreate').onclick();
  await $('confirmOutingCreate').onclick();
  assert.equal(zoneCheck(46.61,-3.30,activeZone()).inside,true);
`));

test('réimport éphémère : un centre local incohérent est recalculé', t => check(t, `
  $('createOutingBtn').onclick();
  $('outingEphemeralChoice').onclick();
  $('outingDecimalMode').onclick();
  $('outingLat').value='46.60';$('outingLon').value='-3.30';
  await $('checkOutingCreate').onclick();
  await $('confirmOutingCreate').onclick();
  const invitation=await formatOutingInvitation(await activeOutingPayload());
  const z=activeZone(),expectedLat=z.lat,expectedLon=z.lon;
  z.lat=canonicalCoord(z.lat+0.01);
  saveZones();
  const prepared=await inspectOutingInvitation(invitation);
  assert.match(await installOutingInvitation(prepared),/Sortie installée/);
  assert.equal(activeZone().lat,expectedLat);
  assert.equal(activeZone().lon,expectedLon);
  assert.equal(JSON.parse(localStorage.getItem('vhfGpsZonesV4Custom')).find(x=>x.id===z.id).lat,expectedLat);
`));

test('préparation éphémère : un ancien calcul ne produit pas de brouillon', t => check(t, `
  const secret=activeSecret(),zoneId=activeZoneId;
  $('createOutingBtn').onclick();
  $('outingEphemeralChoice').onclick();
  $('outingDecimalMode').onclick();
  $('outingLat').value='46.60';$('outingLon').value='-3.30';
  const original=createEphemeralZoneCandidate;
  let release;
  createEphemeralZoneCandidate=async (...args)=>{
    await new Promise(resolve=>release=resolve);
    return original(...args);
  };
  const review=$('checkOutingCreate').onclick();
  assert.equal(typeof release,'function');
  $('outingLat').value='46.61';
  $('outingLat').dispatchEvent({type:'input'});
  release();
  await review;
  assert.equal(pendingOutingCreation,null);
  assert.equal($('outingCreateSummary').classList.contains('hidden'),true);
  assert.equal(activeSecret(),secret);
  assert.equal(activeZoneId,zoneId);
  createEphemeralZoneCandidate=original;
  await $('checkOutingCreate').onclick();
  assert.ok(pendingOutingCreation);
  assert.equal(activeSecret(),secret);
`));
test('un changement manuel de zone conserve la sortie mais exige une nouvelle confirmation', t => check(t, `
  await testCreateBuiltinOuting();
  const oldZone=activeZone(),oldId=localStorage.getItem(OUTING_ID_KEY);
  assert.match($('sendZoneConfirmBtn').textContent,/VALIDÉE AVEC LA SORTIE/);
  loadZoneConfirmations();
  refreshZoneConfirmationUi();
  assert.match($('sendZoneConfirmBtn').textContent,/VALIDÉE AVEC LA SORTIE/);
  const target=BUILTIN_ZONES.find(z=>z.id!==oldZone.id);
  setActiveZone(target.id,{refresh:false});
  assert.equal(localStorage.getItem(OUTING_ID_KEY),oldId);
  assert.equal(isZoneConfirmed(target),false);
  assert.equal($('copyOutingBtn').disabled,true);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),true);
  await confirmActiveZoneAlias();
  assert.equal($('copyOutingBtn').classList.contains('hidden'),true);
  assert.match($('sendZoneConfirmBtn').textContent,/COMPARÉ À LA RADIO/);
  await assert.rejects(activeOutingPayload(),/zone active ne correspond pas/);
  setActiveZone(oldZone.id,{refresh:false});
  assert.equal(isZoneConfirmed(oldZone),false);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),true);
  await confirmActiveZoneAlias();
  assert.equal($('copyOutingBtn').classList.contains('hidden'),false);
  assert.match($('sendZoneConfirmBtn').textContent,/COMPARÉ À LA RADIO/);
  loadZoneConfirmations();
  refreshZoneConfirmationUi();
  assert.match($('sendZoneConfirmBtn').textContent,/COMPARÉ À LA RADIO/);
  assert.equal((await activeOutingPayload()).zone.id,oldZone.id);
  assert.ok(oldId);
`));

test('ancienne sortie sans zone d’origine enregistrée : partage masqué jusqu’au réimport', t => check(t, `
  await testCreateBuiltinOuting();
  const invitation=await formatOutingInvitation(await activeOutingPayload());
  localStorage.removeItem(OUTING_ORIGIN_KEY);
  refreshOutingActions();
  assert.equal($('copyOutingBtn').classList.contains('hidden'),true);
  await assert.rejects(activeOutingPayload(),/réinstalle l'invitation/);
  const prepared=await inspectOutingInvitation(invitation);
  assert.match(await installOutingInvitation(prepared),/Sortie installée/);
  assert.equal(outingMatchesOriginalZone(activeZone()),true);
  assert.equal($('copyOutingBtn').classList.contains('hidden'),false);
`));

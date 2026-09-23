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
  const elements = new Map(), storage = new Map(), timers = new Set();
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
      setAttribute: noop, focus: noop, scrollIntoView: noop,
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
    assert, console, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    document: {
      getElementById: id => { assert.ok(elements.has(id), `ID absent : ${id}`); return elements.get(id); },
      createElement: element, documentElement: { dataset: {} },
    },
    window: { matchMedia: () => ({ matches: false, addEventListener: noop }) }, navigator: {},
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
  for (let i = 0; i < 500 && run('protocolRuntimeState') === 'CHECKING'; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(run('protocolRuntimeState'), 'OK');
  await run('installValidatedSecret(generateSessionSecret())');
  return { run, close: () => timers.forEach(clearTimeout) };
}

async function check(t, source) {
  const app = await boot();
  t.after(app.close);
  await app.run(`(async()=>{${source}})()`);
}

test('version et interopérabilité radio inchangée', t => check(t, `
  assert.match(APP_VERSION,/^[0-9]+[.][0-9]+[.][0-9]+$/);
  assert.equal(PROTOCOL_ID,'VHF-GPS-PROTO-5');
  assert.equal(await protocolCompatDigestHex(),'9AAAB172829EE5C14801F4A9165B1E373B7284BFAA01B26C1795FC551CD42305');
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
  await $('addReceivedZoneBtn').onclick();
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
  await $('addReceivedZoneBtn').onclick();
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
  const start=activeZone();
  setPositionInputMode('decimal',{persist:false});
  $('lat').value=String(start.lat);$('lon').value=String(start.lon);handlePositionChanged();
  await $('ephemeralZoneBtn').onclick();
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

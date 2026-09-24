const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const test = require('node:test');

const html = readFileSync(join(__dirname, '..', 'vhf_gps_code.html'), 'utf8');
const catalog = name => {
  const match = html.match(new RegExp(`^const ${name}=([^\\r\\n]*);`, 'm'));
  assert.ok(match, `${name} absent`);
  return JSON.parse(match[1]);
};
const canonical = word => word.toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
const subjects = catalog('SUBJECTS');
const qualifiers = catalog('QUALS');
const ack = catalog('ACK_WORDS');
const fingerprint = catalog('FINGERPRINT_WORDS');

test('tailles et unicité des catalogues radio PROTO 6', () => {
  for (const [name, words, count] of [
    ['sujets', subjects.map(item => item.w), 200],
    ['qualificatifs masculins', qualifiers.map(item => item.m), 200],
    ['qualificatifs féminins', qualifiers.map(item => item.f), 200],
    ['retours radio', ack, 256],
    ['alias et empreintes', fingerprint, 1024],
  ]) {
    assert.equal(words.length, count, name);
    assert.equal(new Set(words.map(canonical)).size, count, `Doublons ${name}`);
  }
});

test('quatre choix au plus après deux lettres dans les phrases', () => {
  for (const words of [subjects.map(item => item.w), ...['m', 'f'].map(g => qualifiers.map(item => item[g]))]) {
    const prefixes = new Map();
    for (const word of words) {
      const prefix = canonical(word).slice(0, 2);
      prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    }
    for (const [prefix, count] of prefixes) assert.ok(count <= 4, `${prefix} : ${count} choix`);
  }
});

test('aucun signal de détresse ou mot opérationnel sensible dans les alias', () => {
  const forbidden = [
    'MAYDAY','PANPAN','SÉCURITÉ','DÉTRESSE','URGENCE','ALERTE','SECOURS',
    'INCENDIE','VOIE D’EAU','COLLISION','ABORDAGE','HOMME À LA MER','MOB',
    'ÉVACUATION','ÉCHOUEMENT','SAUVETAGE','RESCUE','SURVIE','EXTINCTEUR',
    'EPIRB','PLB','LIFERAFT','GPS','VHF','AIS','DSC','ASN','SMDSM',
    'NORD','SUD','EST','OUEST',
  ];
  const words = new Set(fingerprint.map(canonical));
  for (const word of forbidden) assert.ok(!words.has(canonical(word)), word);
  for (const group of [['BAR','SAR','BAC','BAU'], ['SOLE','SOIE','MOLE']]) {
    assert.ok(group.filter(word => words.has(word)).length <= 1, group.join('/'));
  }
});

test('les phrases ne décrivent plus les accidents relevés en review', () => {
  const forbidden = [
    'ASSOMME','BLESSE','BRULE','COINCE','CREVE','DEFONCE','ECRASE',
    'EPUISE','ESSOUFFLE','FRACASSE','MALMENE','MASSACRE','PERDU',
    'CARBONISE','CALCINE','NOYE','ELECTRISE','EMPOISONNE','EXPLOSE',
    'EJECTE','PANIQUE','AFFOLE','LIGOTE','ECORCHE','BROYE','ACHEVE',
    'PULVERISE','ARRACHE','CHOQUE','CRAME','BLOQUE','FATIGUE','SONNE',
    'INONDE','APEURE','STRESSE','EGARE',
  ];
  const words = new Set(qualifiers.map(item => canonical(item.m)));
  for (const word of forbidden) assert.ok(!words.has(canonical(word)), word);
  for (const group of [
    ['AMAIGRI','MAIGRI','AIGRI'], ['FACHE','TACHE'], ['PETE','JETE'],
    ['GAVE','LAVE'], ['USE','RUSE'], ['MORDU','TORDU'],
    ['MOUILLE','ROUILLE'], ['DEMONTE','REMONTE'], ['BOURRE','BEURRE'],
  ]) {
    assert.ok(group.filter(word => words.has(word)).length <= 1, group.join('/'));
  }
  assert.ok(!subjects.some(item => item.w === 'ACTEUR'));
});

test('les mots de retour radio sont distincts des sujets et des paires signalées', () => {
  const subjectWords = new Set(subjects.map(item => canonical(item.w)));
  for (const word of ack) {
    assert.ok(!subjectWords.has(canonical(word)), word);
    assert.match(word, /^\p{L}+$/u, `Le retour doit se dire en un seul mot : ${word}`);
  }
  const words = new Set(ack.map(canonical));
  for (const group of [
    ['BISON','BIDON','BEDON'], ['POULE','POULPE'], ['CHAMEAU','CHAPEAU'],
    ['MARLIN','MALIN'], ['DODU','DODO'], ['FADA','DADA'],
  ]) {
    assert.ok(group.filter(word => words.has(word)).length <= 1, group.join('/'));
  }
});

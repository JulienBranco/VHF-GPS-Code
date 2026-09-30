"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const protocol=import('data:text/javascript;base64,'+fs.readFileSync(require('node:path').join(__dirname,'../protocol.js')).toString('base64'));
const summary='🎣 Invitation pour une sortie VHF-GPS\n📍 Zone : ÉPHÉMÈRE DE SORTIE\n🔧 PROTO 6 · COMPAT 4043F648\n🔐 Alias de session (empreinte radio) : ÉLAN · FORÊT | ÉCHO\n📣 Alias de zone : ÉTOILE · MARÉE | ÉCHO';
const code='VHF1.'+Buffer.from(JSON.stringify({alias:'ÉTOILE · MARÉE | ÉCHO'})).toString('base64url')+'.0123456789ABCDEF';
async function setup(){const p=await protocol,payload={format:2,api:2,id:'a'.repeat(32),release:'b'.repeat(64),content:p.joinContent(summary,code)};return {p,payload,text:await p.wrap(payload)};}
async function legacy(p,payload,visible){
 const token='VHF-SORTIE2.'+Buffer.from(JSON.stringify({format:2,api:2,id:payload.id,release:payload.release,code})).toString('base64url');
 return p.SUMMARY+'\n'+visible+'\n\n'+p.BEGIN+'\n'+token+'.'+await p.hash(token+'\n'+visible)+'\n'+p.END;
}
test('copie : accents Unicode équivalents, retours CR/LF et espaces insécables acceptés sans changer le code',async()=>{
 const {p,payload,text}=await setup();
 const variants=[text.normalize('NFD'),text.replaceAll('\n','\r\n'),text.replaceAll('\n','\r'),text.replace('Zone :','Zone\u00a0:'),text.replace('Alias de zone :','Alias\u202fde zone :'),text.normalize('NFD').replaceAll('\n','\r\n').replace('Zone :','Zone\u202f:')];
 for(const incoming of variants){const read=await p.unwrap(incoming);assert.equal(read.content,payload.content);assert.equal(p.splitContent(read.content).code,code);}
});
test('copie : préambule, conclusion et espaces dans le bloc codé restent acceptés',async()=>{
 const {p,payload,text}=await setup();
 for(const incoming of ['Bonjour !\n'+text+'\nBonne sortie !',text.replace('VHF-SORTIE2.','VHF-SORTIE2.\n \t')])assert.deepEqual(await p.unwrap(incoming),payload);
});
test('intégrité : changement réel d’accent, casse, zone, COMPAT ou code toujours refusé',async()=>{
 const {p,text}=await setup();
 const variants=[text.replace('ÉLAN','ELAN'),text.replace('ÉLAN','Élan'),text.replace('MARÉE','FORÊT'),text.replace('ÉPHÉMÈRE DE SORTIE','AUTRE ZONE'),text.replace('4043F648','4043F649'),text.replace('VHF-SORTIE2.','VHF-SORTIE2.A')];
 for(const incoming of variants)await assert.rejects(p.unwrap(incoming),/incomplète ou modifiée/);
});
test('compatibilité : anciens contrôles exacts NFC, NFD, CRLF et espaces insécables encore acceptés',async()=>{
 const {p,payload,text}=await setup();
 assert.equal(await legacy(p,payload,summary),text);
 for(const oldSummary of [summary,summary.normalize('NFD'),summary.replaceAll('\n','\r\n'),summary.replace('Zone :','Zone\u00a0:')]){
  const read=await p.unwrap(await legacy(p,payload,oldSummary));assert.equal(read.content,payload.content);
 }
});
test('partage : résumé canonique identique pour les variantes, octets du code inchangés',async()=>{
 const {p,payload,text}=await setup();
 for(const visible of [summary.normalize('NFD'),summary.replaceAll('\n','\r\n'),summary.replace('Zone :','Zone\u202f:')]){
  const shared=await p.wrap({...payload,content:p.joinContent(visible,code)});assert.equal(shared,text);
  assert.equal(p.splitContent((await p.unwrap(shared)).content).code,code);
 }
});
test('rejeu : seule la présentation du résumé peut différer, jamais le code ni le sens des alias',async()=>{
 const {p,payload}=await setup();
 const equivalent=p.joinContent(summary.normalize('NFD').replaceAll('\n','\r\n').replace('Zone :','Zone\u00a0:'),code);
 assert(p.sameInvitationContent(equivalent,payload.content));
 assert(!p.sameInvitationContent(p.joinContent(summary.replace('ÉLAN','ELAN'),code),payload.content));
 assert(!p.sameInvitationContent(p.joinContent(summary,code+'A'),payload.content));
 assert(!p.sameInvitationContent('contenu incomplet',payload.content));
});

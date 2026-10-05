"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const words=JSON.parse(fs.readFileSync(require.resolve('../sources/engine.js'),'utf8').match(/const FINGERPRINT_WORDS=(\[[^;]+\]);/)[1]);
let model;
test.before(async()=>{model=await import('data:text/javascript;base64,'+fs.readFileSync(require.resolve('../sources/vhf-channels-model.js')).toString('base64'));});
test('canaux V1 : vecteur figé et implémentation indépendante',async()=>{
 const secret='23456789ABCDEFGHJKMNPQRSTUVW';
 const expected=[{channel:6,word:'ANIMER'},{channel:8,word:'SURF'},{channel:72,word:'BALANÇOIRE'},{channel:77,word:'ORMEAU'}];
 assert.deepEqual(await model.channelTable(secret,words),expected);
 const available=words.filter(word=>! /\s/u.test(word));
 const reference=[6,8,72,77].map(channel=>{const digest=crypto.createHmac('sha256',secret).update(`VHF-CHANNELS-V1|${model.CATALOG_SHA256}|CHANNEL|${channel}`).digest();return {channel,word:available.splice(digest.readUInt32BE(0)%available.length,1)[0]};});
 assert.deepEqual(reference,expected);
});
test('500 sorties : déterminisme, aucun doublon, variété des mots',async()=>{
 const tables=new Set(),used=new Set();
 for(let i=0;i<500;i++){
  const secret=crypto.createHash('sha256').update('sortie-'+i).digest('hex');const rows=await model.channelTable(secret,words);
  assert.deepEqual(rows.map(r=>r.channel),[6,8,72,77]);assert.equal(new Set(rows.map(r=>r.word)).size,4);assert(rows.every(r=>! /\s/u.test(r.word)));
  assert.deepEqual(await model.channelTable(secret,words),rows);rows.forEach(r=>used.add(r.word));tables.add(JSON.stringify(rows));
 }
 assert.equal(tables.size,500);assert(used.size>800);assert.equal(words.length,1024);
});
test('catalogue modifié, réordonné ou dupliqué : refus explicite',async()=>{
 const modified=words.slice();modified[0]='MODIFIÉ';await assert.rejects(model.channelTable('secret',modified),/incompatible/);
 await assert.rejects(model.channelTable('secret',words.slice().reverse()),/incompatible/);
 const duplicate=words.slice();duplicate[0]=duplicate[1];await assert.rejects(model.channelTable('secret',duplicate),/incompatible/);
 await assert.rejects(model.channelTable('',words),/Session/);
});
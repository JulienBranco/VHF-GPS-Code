"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {prepareBuild,applyBuild}=require("../tools/build.cjs");
const {planPurge,executePurge,executePublication,recoverPurge,parisDay}=require("../tools/release-maintenance.cjs");
const source=path.resolve(__dirname,"..");
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-maintenance-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ["sources","tools","icons"])fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true}))if(entry.isFile()&&!['latest.json','sw.js','releases.json','RELEASES.html'].includes(entry.name))fs.copyFileSync(path.join(source,entry.name),path.join(root,entry.name));
 return root;
}
function version(root,value){
 const target=path.join(root,"sources/engine.js");fs.writeFileSync(target,fs.readFileSync(target,"utf8").replace(/const APP_VERSION="[^"]+"/,'const APP_VERSION="'+value+'"'));
}
function build(root,value,now){
 version(root,value);const prepared=applyBuild(prepareBuild(root,{now}));applyBuild(prepareBuild(root),{check:true});return prepared.id;
}
function history(root){
 return [build(root,"98.0.1","2026-08-01T12:00:00Z"),build(root,"98.0.2","2026-09-01T12:00:00Z"),build(root,"98.0.3","2026-09-20T12:00:00Z"),build(root,"98.0.4","2026-09-30T12:00:00Z")];
}
function snapshot(root){
 const entries=[];
 function walk(dir,prefix=""){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+entry.name,target=path.join(dir,entry.name);
   if(entry.isDirectory())walk(target,name+"/");else entries.push([name,fs.readFileSync(target).toString("base64")]);
  }
 }
 walk(root);return entries;
}
function check(root,expected){
 const prepared=applyBuild(prepareBuild(root),{check:true});
 assert.deepEqual(new Set(fs.readdirSync(path.join(root,"releases"))),new Set(expected));
 assert.deepEqual(new Set(prepared.rows.map(row=>row.release)),new Set(expected));
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,"latest.json"))).release,prepared.id);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,"releases.json"))).latest,prepared.id);
 assert(!fs.existsSync(path.join(root,".release-maintenance")));
}

test("publication du catalogue manquante : génération refusée avant toute écriture",t=>{
 const root=fixture(t),ids=history(root);fs.rmSync(path.join(root,"releases",ids[0]),{recursive:true});
 const before=snapshot(root);assert.throws(()=>applyBuild(prepareBuild(root)),/catalogue absente/);assert.deepEqual(snapshot(root),before);
});
test("simulation puis conservation des deux dernières : métadonnées et worker synchronisés",t=>{
 const root=fixture(t),ids=history(root),before=snapshot(root),plan=planPurge(root,{mode:"keep",keep:2});
 assert.deepEqual(snapshot(root),before);assert.deepEqual(new Set(plan.removed.map(row=>row.release)),new Set(ids.slice(0,2)));
 executePurge(plan);check(root,ids.slice(2));
});
test("purge par date : la dernière publication reste protégée même si elle est antérieure",t=>{
 const root=fixture(t),ids=history(root);executePurge(planPurge(root,{mode:"before",before:"2027-01-01"}));check(root,[ids[3]]);
});
test("nombre et date : conserver l’union des deux critères",t=>{
 const root=fixture(t),ids=history(root);
 executePurge(planPurge(root,{mode:"combined",keep:1,before:"2026-09-01"}));check(root,ids.slice(1));
});
test("date de création inconnue : conservée par la purge par date",t=>{
 const root=fixture(t),ids=history(root),file=path.join(root,"releases.json"),catalog=JSON.parse(fs.readFileSync(file));
 catalog.releases.find(row=>row.release===ids[0]).createdAt=null;fs.writeFileSync(file,JSON.stringify(catalog));applyBuild(prepareBuild(root));
 executePurge(planPurge(root,{mode:"before",before:"2027-01-01"}));check(root,[ids[0],ids[3]]);
});
test("jour de purge défini à Paris et date impossible refusée",t=>{
 const root=fixture(t);history(root);
 assert.equal(parisDay("2026-09-19T23:00:00Z"),"2026-09-20");
 assert.throws(()=>planPurge(root,{mode:"before",before:"2026-02-30"}),/Date invalide/);
 assert.throws(()=>planPurge(root,{mode:"keep",keep:0}),/entier/);
});
test("sources modifiées : purge ordinaire refusée, remise à zéro prépare d’abord la version actuelle",t=>{
 const root=fixture(t);history(root);version(root,"98.0.5");
 const before=snapshot(root);assert.throws(()=>planPurge(root,{mode:"keep",keep:1}),/Prépare et vérifie/);assert.deepEqual(snapshot(root),before);
 const plan=planPurge(root,{mode:"reset"});assert.deepEqual(snapshot(root),before);executePurge(plan);check(root,[plan.prepared.id]);
 assert.equal(plan.prepared.version,"98.0.5");
});
test("échec après déplacement : dossiers et métadonnées restaurés",t=>{
 const root=fixture(t);history(root);const before=snapshot(root),plan=planPurge(root,{mode:"keep",keep:1});
 assert.throws(()=>executePurge(plan,{afterMove(){throw Error("échec simulé");}}),/fichiers restaurés/);
 assert.deepEqual(snapshot(root),before);applyBuild(prepareBuild(root),{check:true});
});
test("modification entre simulation et confirmation : purge refusée sans supprimer",t=>{
 const root=fixture(t);history(root);const plan=planPurge(root,{mode:"keep",keep:1});version(root,"98.0.5");
 const before=snapshot(root);assert.throws(()=>executePurge(plan),/changé depuis la simulation/);assert.deepEqual(snapshot(root),before);
});
test("publication conservée altérée : préparation refusée avant toute écriture",t=>{
 const root=fixture(t),ids=history(root);fs.appendFileSync(path.join(root,"releases",ids[0],"engine.js"),"\n// altération");
 const before=snapshot(root);assert.throws(()=>prepareBuild(root),/absent ou altéré/);assert.deepEqual(snapshot(root),before);
});
test("dossier releases redirigé hors du projet : purge refusée",t=>{
 const root=fixture(t);history(root);const outside=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-outside-"));
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.renameSync(path.join(root,"releases"),path.join(outside,"releases"));
 fs.symlinkSync(path.join(outside,"releases"),path.join(root,"releases"),process.platform==="win32"?"junction":"dir");
 assert.throws(()=>planPurge(root,{mode:"reset"}),/redirigé/);
 assert.equal(fs.readdirSync(path.join(outside,"releases")).length,4);
});
test("restauration au redémarrage après une purge interrompue",t=>{
 const root=fixture(t),ids=history(root),before=snapshot(root),backup=path.join(root,".release-maintenance");
 fs.mkdirSync(backup);
 const meta=Object.fromEntries(["latest.json","releases.json","RELEASES.html","sw.js"].map(name=>[name,fs.readFileSync(path.join(root,name)).toString("base64")]));
 fs.writeFileSync(path.join(backup,"journal.json"),JSON.stringify({format:1,committed:false,removed:[ids[0]],newRelease:null,meta}));
 fs.renameSync(path.join(root,"releases",ids[0]),path.join(backup,ids[0]));fs.writeFileSync(path.join(root,"latest.json"),"incomplet");
 assert.equal(recoverPurge(root),"restored");assert.deepEqual(snapshot(root),before);applyBuild(prepareBuild(root),{check:true});
});

test("préparation via le menu : nouvelle publication ajoutée sans effacer les précédentes",t=>{
 const root=fixture(t),ids=history(root);version(root,"98.0.5");
 const prepared=prepareBuild(root);executePublication(prepared);check(root,[...ids,prepared.id]);
});
test("redémarrage après validation : nettoyage de la sauvegarde sans restaurer les publications supprimées",t=>{
 const root=fixture(t),ids=history(root),backup=path.join(root,".release-maintenance");
 const plan=planPurge(root,{mode:"keep",keep:1});executePurge(plan);
 fs.mkdirSync(backup);fs.mkdirSync(path.join(backup,ids[0]));fs.writeFileSync(path.join(backup,ids[0],"fichier"),"sauvegarde");
 const meta=Object.fromEntries(["latest.json","releases.json","RELEASES.html","sw.js"].map(name=>[name,fs.readFileSync(path.join(root,name)).toString("base64")]));
 fs.writeFileSync(path.join(backup,"journal.json"),JSON.stringify({format:1,committed:true,removed:[ids[0]],newRelease:null,meta}));
 assert.equal(recoverPurge(root),"completed");check(root,[ids[3]]);
});


test("remise à zéro explicite : nouveau marqueur, publication identique et marqueur conservé par les opérations ordinaires",t=>{
 const root=fixture(t),id=build(root,"98.1.0","2026-10-01T12:00:00Z");
 const plan=planPurge(root,{mode:"reset"});assert.match(plan.resetId,/^[a-f0-9]{32}$/);
 assert.equal(plan.prepared.id,id);executePurge(plan);
 const marker=JSON.parse(fs.readFileSync(path.join(root,"releases.json"))).reset;assert.equal(marker,plan.resetId);
 executePublication(prepareBuild(root));assert.equal(JSON.parse(fs.readFileSync(path.join(root,"releases.json"))).reset,marker);
 const ordinary=planPurge(root,{mode:"keep",keep:1});executePurge(ordinary);assert.equal(JSON.parse(fs.readFileSync(path.join(root,"releases.json"))).reset,marker);
 const again=planPurge(root,{mode:"reset"});assert.notEqual(again.resetId,marker);executePurge(again);check(root,[id]);
});

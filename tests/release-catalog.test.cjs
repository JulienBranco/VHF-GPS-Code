"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),{spawnSync}=require("node:child_process");
const source=path.resolve(__dirname,"..");
function fixture(t){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),"vhfgps-catalog-")),root=path.join(workspace,"integration-distribution");
 fs.mkdirSync(root);t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
 for(const name of ["sources","tools","icons","images"])fs.cpSync(path.join(source,name),path.join(root,name),{recursive:true});
 for(const entry of fs.readdirSync(source,{withFileTypes:true}))if(entry.isFile()&&!['latest.json','sw.js','releases.json','RELEASES.html'].includes(entry.name))fs.copyFileSync(path.join(source,entry.name),path.join(root,entry.name));
 return root;
}
function run(root,check=false){return spawnSync(process.execPath,[path.join(root,"tools/build.cjs"),...(check?["--check"]:[])],{encoding:"utf8"});}
function build(root,check=false){const result=run(root,check);assert.equal(result.status,0,result.stderr);}
const read=(root,name)=>fs.readFileSync(path.join(root,name),"utf8");
test("nouvelle publication : date stable, nouvelle version répertoriée, ancienne publication inchangée",t=>{
 const root=fixture(t);build(root);
 const first=JSON.parse(read(root,"releases.json"));assert.equal(first.releases.length,1);assert.ok(first.releases[0].createdAt);assert.ok(Number.isFinite(Date.parse(first.releases[0].createdAt)));
 const catalogue=read(root,"releases.json"),page=read(root,"RELEASES.html"),oldManifest=read(root,"releases/"+first.latest+"/manifest.json");
 build(root);build(root,true);assert.equal(read(root,"releases.json"),catalogue);assert.equal(read(root,"RELEASES.html"),page);
 const enginePath=path.join(root,"sources/engine.js");fs.writeFileSync(enginePath,fs.readFileSync(enginePath,"utf8").replace(/const APP_VERSION="[^"]+"/,'const APP_VERSION="99.0.0"'));
 build(root);build(root,true);
 const next=JSON.parse(read(root,"releases.json"));assert.notEqual(next.latest,first.latest);assert.equal(next.releases.length,2);assert.equal(next.releases[0].version,"99.0.0");assert.equal(next.releases[0].release,next.latest);
 assert.equal(next.releases.find(row=>row.release===first.latest).createdAt,first.releases[0].createdAt);assert.equal(read(root,"releases/"+first.latest+"/manifest.json"),oldManifest);
 assert.match(read(root,"RELEASES.html"),/Dernière publication/);assert.match(read(root,"RELEASES.html"),/99.0.0/);
});
test("publication antérieure au catalogue : date de création inconnue, référencement distinct et stable",t=>{
 const root=fixture(t);build(root);fs.unlinkSync(path.join(root,"releases.json"));fs.unlinkSync(path.join(root,"RELEASES.html"));build(root);
 const catalogue=read(root,"releases.json"),row=JSON.parse(catalogue).releases[0];assert.equal(row.createdAt,null);assert.ok(Number.isFinite(Date.parse(row.indexedAt)));assert.match(read(root,"RELEASES.html"),/Date de création inconnue/);assert.match(read(root,"RELEASES.html"),/Répertoriée le/);
 build(root,true);build(root);assert.equal(read(root,"releases.json"),catalogue);
});
test("catalogue obsolète ou manifeste altéré : vérification refusée sans réécrire une publication",t=>{
 const root=fixture(t);build(root);fs.writeFileSync(path.join(root,"RELEASES.html"),"page obsolète");assert.notEqual(run(root,true).status,0);build(root);
 const catalogue=read(root,"releases.json"),latest=JSON.parse(catalogue).latest,manifestPath=path.join(root,"releases",latest,"manifest.json");
 fs.appendFileSync(manifestPath," ");assert.notEqual(run(root).status,0);assert.equal(read(root,"releases.json"),catalogue);assert.ok(fs.readFileSync(manifestPath,"utf8").endsWith(" "));
});

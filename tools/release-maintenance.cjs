"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {prepareBuild,applyBuild}=require("./build.cjs");
const HEX=/^[a-f0-9]{64}$/;
const META=["latest.json","releases.json","RELEASES.html","sw.js"];
const BACKUP=".release-maintenance";
const hash=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");

function directory(root,name){
 const base=fs.realpathSync(root),target=path.resolve(base,name);
 if(!target.startsWith(base+path.sep))throw Error("Chemin de purge hors du projet.");
 if(fs.existsSync(target)){
  if(fs.lstatSync(target).isSymbolicLink()||fs.realpathSync(target)!==target)throw Error("La purge refuse un dossier redirigé : "+name);
  if(!fs.statSync(target).isDirectory())throw Error("Dossier attendu : "+name);
 }
 return target;
}
function releasePath(root,id){
 if(!HEX.test(id))throw Error("Identifiant de publication invalide.");
 directory(root,"releases");return directory(root,path.join("releases",id));
}
function atomicWrite(target,bytes){
 const temp=target+".maintenance-tmp";
 try{fs.writeFileSync(temp,bytes);fs.renameSync(temp,target);}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function parisDay(value){
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));
 const part=type=>parts.find(item=>item.type===type).value;
 return part("year")+"-"+part("month")+"-"+part("day");
}
function validateDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw Error("Date invalide. Utilise AAAA-MM-JJ, par exemple 2026-09-01.");
}
function signature(prepared){
 const digest=crypto.createHash("sha256");
 for(const [name,value] of prepared.output)digest.update(name).update(hash(value));
 digest.update(fs.existsSync(path.join(prepared.root,"releases.json"))?fs.readFileSync(path.join(prepared.root,"releases.json")):"sans catalogue");
 digest.update(JSON.stringify(fs.existsSync(path.join(prepared.root,"releases"))?fs.readdirSync(path.join(prepared.root,"releases")).sort():[]));
 return digest.digest("hex");
}
function planPurge(root,{mode,keep,before}={}){
 if(!["keep","before","combined","reset"].includes(mode))throw Error("Mode de purge inconnu.");
 if(["keep","combined"].includes(mode)&&(!Number.isInteger(keep)||keep<1))throw Error("Le nombre de publications à garder doit être un entier supérieur ou égal à 1.");
 if(["before","combined"].includes(mode))validateDate(before);
 root=fs.realpathSync(root);
 if(fs.existsSync(path.join(root,BACKUP)))throw Error("Une purge interrompue doit être restaurée avant de continuer.");
 const now=new Date().toISOString(),current=prepareBuild(root,{now});
 if(mode!=="reset"){
  // Une purge ordinaire ne doit pas publier des changements de sources par surprise.
  try{applyBuild(current,{check:true});}
  catch{throw Error("Prépare et vérifie d’abord la publication actuelle avant de choisir une purge par nombre ou par date.");}
 }
 for(const row of current.rows)releasePath(root,row.release);
 const newest=[...current.rows].sort((a,b)=>Number(b.release===current.id)-Number(a.release===current.id)||(b.createdAt||b.indexedAt).localeCompare(a.createdAt||a.indexedAt));
 const countKept=new Set(newest.slice(0,keep||0).map(row=>row.release));
 const removed=[],retained=[];
 for(const row of current.rows){
  let retain=row.release===current.id;
  if(mode==="keep"||mode==="combined")retain ||= countKept.has(row.release);
  if(mode==="before"||mode==="combined")retain ||= !row.createdAt||parisDay(row.createdAt)>=before;
  (retain?retained:removed).push(row);
 }
 const prepared=prepareBuild(root,{now,excludedReleases:removed.map(row=>row.release)});
 return {root,mode,now,current,prepared,removed,retained,signature:signature(current)};
}
function recoverPurge(root){
 root=fs.realpathSync(root);
 const backup=directory(root,BACKUP);
 if(!fs.existsSync(backup))return null;
 const journalPath=path.join(backup,"journal.json");
 if(!fs.existsSync(journalPath))throw Error("Sauvegarde de purge sans journal. Conserve le dossier .release-maintenance et demande une vérification.");
 const journal=JSON.parse(fs.readFileSync(journalPath,"utf8"));
 if(journal.format!==1||!Array.isArray(journal.removed)||journal.removed.some(id=>!HEX.test(id))||!journal.meta||META.some(name=>!Object.hasOwn(journal.meta,name))||(journal.newRelease!==null&&!HEX.test(journal.newRelease)))throw Error("Journal de purge invalide. Aucun fichier supprimé.");
 if(!journal.committed){
  for(const id of journal.removed){
   const saved=directory(root,path.join(BACKUP,id)),target=releasePath(root,id);
   if(fs.existsSync(saved)){
    if(fs.existsSync(target))throw Error("Restauration ambiguë : "+id+". Conserve la sauvegarde.");
    fs.renameSync(saved,target);
   }
  }
  for(const name of META){
   const target=path.join(root,name),value=journal.meta[name];
   if(value===null){if(fs.existsSync(target))fs.unlinkSync(target);}
   else if(typeof value==="string")atomicWrite(target,Buffer.from(value,"base64"));
   else throw Error("Sauvegarde de métadonnées invalide.");
  }
  if(journal.newRelease){const target=releasePath(root,journal.newRelease);if(fs.existsSync(target))fs.rmSync(target,{recursive:true});}
 }
 // Chemin fixe, résolu et vérifié dans le projet ; jamais une cible fournie par l’utilisateur.
 fs.rmSync(backup,{recursive:true});
 return journal.committed?"completed":"restored";
}
function executePurge(plan,{afterMove}={}){
 const {root,removed,now}=plan;
 if(fs.existsSync(path.join(root,BACKUP)))throw Error("Une autre purge est en cours ou attend sa restauration.");
 const fresh=prepareBuild(root,{now});
 if(signature(fresh)!==plan.signature)throw Error("Les sources ou le catalogue ont changé depuis la simulation. Recommence la purge.");
 const prepared=prepareBuild(root,{now,excludedReleases:removed.map(row=>row.release)});
 return commitPrepared(root,prepared,removed,{afterMove});
}
function executePublication(prepared){
 const {root,now}=prepared;
 if(fs.existsSync(path.join(root,BACKUP)))throw Error("Une opération interrompue doit être restaurée avant de continuer.");
 const fresh=prepareBuild(root,{now});
 for(const [name,value] of prepared.output)if(!fresh.output.get(name)?.equals(value))throw Error("Les sources ont changé pendant la préparation. Recommence.");
 return commitPrepared(root,prepared,[]);
}
function commitPrepared(root,prepared,removed,{afterMove}={}){
 for(const row of removed)releasePath(root,row.release);
 const newRelease=fs.existsSync(releasePath(root,prepared.id))?null:prepared.id;
 const journal={format:1,committed:false,removed:removed.map(row=>row.release),newRelease,meta:Object.fromEntries(META.map(name=>[name,fs.existsSync(path.join(root,name))?fs.readFileSync(path.join(root,name)).toString("base64"):null]))};
 const backup=directory(root,BACKUP);fs.mkdirSync(backup);
 const journalPath=path.join(backup,"journal.json");
 try{atomicWrite(journalPath,JSON.stringify(journal));}
 catch(error){fs.rmSync(backup,{recursive:true});throw error;}
 try{
  for(const row of removed)fs.renameSync(releasePath(root,row.release),path.join(backup,row.release));
  afterMove?.();
  applyBuild(prepared);applyBuild(prepareBuild(root,{now:prepared.now}),{check:true});
  journal.committed=true;atomicWrite(journalPath,JSON.stringify(journal));
 }catch(error){
  try{recoverPurge(root);}catch(recovery){throw Error(error.message+"\nRestauration incomplète : "+recovery.message);}
  throw Error("Purge annulée, fichiers restaurés : "+error.message);
 }
 recoverPurge(root);
 return prepared;
}
module.exports={planPurge,executePurge,executePublication,recoverPurge,parisDay};

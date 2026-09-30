"use strict";
const fs=require("node:fs"),path=require("node:path"),readline=require("node:readline/promises");
const {prepareBuild,applyBuild}=require("./build.cjs");
const {planPurge,executePurge,executePublication,recoverPurge}=require("./release-maintenance.cjs");
const root=path.resolve(__dirname,"..");
function describe(row){
 const date=row.createdAt?new Date(row.createdAt).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):"date de création inconnue";
 return "v"+row.version+" · "+date+" · "+row.release.slice(0,12);
}
async function main(){
 const recovered=recoverPurge(root);
 if(recovered)console.log(recovered==="restored"?"La purge interrompue a été annulée : les fichiers ont été restaurés.":"La purge précédente était terminée : sa sauvegarde temporaire a été nettoyée.");
 const cli=readline.createInterface({input:process.stdin,output:process.stdout});
 const ask=async text=>(await cli.question(text)).trim();
 try{
  console.log("\nVHF GPS — gestion locale des publications\nAucun commit, push ou nettoyage des téléphones.\n");
  while(true){
   console.log("1 · Préparer une publication\n2 · Vérifier la publication et les métadonnées\n3 · Afficher les publications\n4 · Simuler puis confirmer une purge\n0 · Quitter");
   const action=await ask("Choix : ");
   if(action==="0")break;
   try{
    if(action==="1"){
     const enginePath=path.join(root,"sources/engine.js"),engine=fs.readFileSync(enginePath,"utf8");
     const version=engine.match(/const APP_VERSION="([^"]+)"/)[1];
     console.log("Version dans les sources : "+version);
     const next=await ask("Version à publier (Entrée pour conserver "+version+") : ");
     if(next&&!/^\d+\.\d+\.\d+$/.test(next))throw Error("Version invalide. Exemple : 3.28.109.");
     const catalog=fs.existsSync(path.join(root,"releases.json"))?JSON.parse(fs.readFileSync(path.join(root,"releases.json"),"utf8")):null;
     if(!next||next===version){
      const prepared=prepareBuild(root);
      if(catalog?.releases.some(row=>row.version===version&&row.release!==prepared.id)){
       console.log("Les sources ont changé mais cette version existe déjà. Choisis un nouveau numéro pour distinguer les publications.");continue;
      }
     }
     if(await ask("Préparer les fichiers avec la version "+(next||version)+" ? Tape OUI : ")!=="OUI"){console.log("Annulé.");continue;}
     let changed=false;
     try{
      if(next&&next!==version){fs.writeFileSync(enginePath,engine.replace(/const APP_VERSION="[^"]+"/,'const APP_VERSION="'+next+'"'));changed=true;}
      const prepared=prepareBuild(root);
      if(catalog?.releases.some(row=>row.version===prepared.version&&row.release!==prepared.id))throw Error("Ce numéro de version désigne déjà une autre publication. Choisis un nouveau numéro.");
      executePublication(prepared);
      console.log("Publication préparée et vérifiée : v"+prepared.version+" · "+prepared.id.slice(0,12)+".\nTeste-la sur http://127.0.0.1:8082/ avec tools/server.cjs. Les tests fonctionnels restent à lancer.\nTu peux ensuite examiner les changements, commit et push toi-même.");
     }catch(error){if(changed)fs.writeFileSync(enginePath,engine);throw error;}
    }else if(action==="2"){
     const prepared=applyBuild(prepareBuild(root),{check:true});
     console.log("Sources et fichiers générés cohérents : v"+prepared.version+" · "+prepared.id.slice(0,12)+". Cela ne remplace pas les tests fonctionnels.");
    }else if(action==="3"){
     if(!fs.existsSync(path.join(root,"releases.json"))){console.log("Aucune publication préparée.");continue;}
     const catalog=JSON.parse(fs.readFileSync(path.join(root,"releases.json"),"utf8"));
     for(const row of catalog.releases)console.log((row.release===catalog.latest?"ACTUELLE · ":"           ")+describe(row));
    }else if(action==="4"){
     console.log("1 · Garder les X dernières\n2 · Supprimer avant une date\n3 · Garder les X dernières ET toutes celles depuis une date\n4 · Générer les sources actuelles et ne garder que cette publication\n0 · Annuler");
     const choice=await ask("Règle : "),mode={"1":"keep","2":"before","3":"combined","4":"reset"}[choice];
     if(!mode){console.log("Annulé.");continue;}
     const keep=["keep","combined"].includes(mode)?Number(await ask("Nombre minimum à garder : ")):undefined;
     const before=["before","combined"].includes(mode)?await ask("Supprimer avant quelle date (AAAA-MM-JJ, heure de Paris) : "):undefined;
     const plan=planPurge(root,{mode,keep,before});
     console.log("\nCONSERVÉES :");for(const row of plan.retained)console.log("  "+describe(row));
     console.log("SUPPRIMÉES :");for(const row of plan.removed)console.log("  "+describe(row));
     if(!plan.removed.length&&mode!=="reset"){console.log("Aucune publication à supprimer.");continue;}
     console.log("\nLes invitations des publications supprimées ne pourront plus être téléchargées après ton push.\nLes données des téléphones et leurs sorties actives ne sont pas effacées.");
     if(await ask("Appliquer cette purge locale ? Tape SUPPRIMER : ")!=="SUPPRIMER"){console.log("Simulation uniquement : aucun fichier modifié.");continue;}
     const prepared=executePurge(plan);
     console.log("Purge terminée : "+plan.removed.length+" publication(s) supprimée(s). Catalogue, latest.json et sw.js synchronisés.\nPublication actuelle : v"+prepared.version+" · "+prepared.id.slice(0,12)+".\nExamine les changements avant ton commit et ton push.");
    }else console.log("Choix inconnu.");
   }catch(error){console.error("\nAction interrompue : "+error.message);}
   console.log();
  }
 }finally{cli.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});

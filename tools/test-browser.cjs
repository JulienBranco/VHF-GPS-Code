"use strict";
const fs=require("node:fs");
let chromium;
try{({chromium}=require("playwright"));}
catch(error){
 if(error.code!=="MODULE_NOT_FOUND")throw error;
 throw Error("Les dépendances de test sont absentes. Lance npm ci, puis npm run test:install.");
}
function browserOptions(){
 const executablePath=process.env.VHF_CHROME;
 if(executablePath&&!fs.existsSync(executablePath))throw Error("VHF_CHROME ne désigne pas un navigateur existant : "+executablePath);
 if(!executablePath&&!fs.existsSync(chromium.executablePath()))throw Error("Le Chromium de test est absent. Lance npm run test:install (connexion nécessaire pour le télécharger).");
 return {headless:true,...(executablePath?{executablePath}:{})};
}
module.exports={chromium,browserOptions};

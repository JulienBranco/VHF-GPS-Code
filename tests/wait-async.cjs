"use strict";
// Playwright attend un résultat synchrone dans waitForFunction : une Promise
// est immédiatement vraie. Les contrôles asynchrones doivent être réessayés.
async function waitAsync(page,predicate,arg,{timeout=15000}={}){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  try{if(await page.evaluate(predicate,arg))return;}
  catch(error){if(!/Execution context was destroyed|Cannot find context/.test(error.message))throw error;}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error("Condition asynchrone non satisfaite après "+timeout+" ms.");
}
module.exports={waitAsync};

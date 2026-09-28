const API=1;
const LABEL="A", PROTOCOL="DEMO-A", EXPECTED="7a4f362e6ad8ce6b49410558a4c84f7588d7e670caeb3649929aab859b328ff3";
const words=LABEL==="A"?["ANCRE","BARQUE","CORDAGE","DAUPHIN","ECUME","FILET","GALET","HOULE"]:["IRIS","JONC","KAYAK","LAMPE","MOULIN","NUAGE","OURS","PLUME"];
async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,"0")).join("");}
async function code(payload){
 const result=await hash(PROTOCOL+"|"+payload.session+"|"+payload.lat.toFixed(5)+"|"+payload.lon.toFixed(5));
 return "TEST "+LABEL+" · "+[0,2,4,6].map(i=>words[parseInt(result.slice(i,i+2),16)%words.length]).join(" ");
}
window.addEventListener("message",async event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data?.type!=="initialize"||!event.ports[0])return;
 const port=event.ports[0],{payload,nonce,api}=event.data;
 if(api!==API){port.postMessage({type:"error",api:API,nonce,code:"API_UNSUPPORTED"});port.close();return;}
 try{
  if(await hash(PROTOCOL+"|selftest")!==EXPECTED||payload.protocol!==PROTOCOL)throw new Error("Version incompatible");
  const result=await code(payload);
  document.getElementById("version").textContent="VERSION "+LABEL+" · "+PROTOCOL;
  document.getElementById("code").textContent=result;
  document.getElementById("position").textContent=payload.lat.toFixed(5)+" / "+payload.lon.toFixed(5);
  port.postMessage({type:"ready",api:API,nonce,label:LABEL,protocol:PROTOCOL,code:result});port.close();
 }catch{port.postMessage({type:"error",api:API,nonce});port.close();}
});

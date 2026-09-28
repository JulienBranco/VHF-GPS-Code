"use strict";
// Générateur autonome : Node.js uniquement, aucun Git, serveur ou service distant.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),check=process.argv.includes("--check");
const digest=value=>crypto.createHash("sha256").update(value).digest("hex");
const read=name=>fs.readFileSync(path.join(root,name));
const outputs=new Map();
function output(name,value){outputs.set(name,Buffer.isBuffer(value)?value:Buffer.from(value));}
const channels={};
for(const label of ["A","B"]){
 const protocol="DEMO-"+label;
 const app=read("tools/app.template.html").toString().replaceAll("__LABEL__",label);
 const engine=read("tools/engine.template.js").toString().replace("__LABEL__",JSON.stringify(label)).replace("__PROTOCOL__",JSON.stringify(protocol)).replace("__EXPECTED__",JSON.stringify(digest(protocol+"|selftest")));
 const manifest={format:1,api:1,label,protocol,files:[{path:"app.html",sha256:digest(app)},{path:"engine.js",sha256:digest(engine)}]};
 const raw=JSON.stringify(manifest),id=digest(raw),prefix="releases/"+id+"/";
 output(prefix+"app.html",app);output(prefix+"engine.js",engine);output(prefix+"manifest.json",raw);
 channels[label]={format:1,release:id,protocol};
 output("channels/"+label+".json",JSON.stringify(channels[label]));
}
const latestIndex=process.argv.indexOf("--latest"),latest=latestIndex<0?"A":process.argv[latestIndex+1];
if(!channels[latest])throw new Error("--latest accepte A ou B.");
output("latest.json",JSON.stringify(channels[latest]));
for(const name of ["icon-192.png","icon-512.png","apple-touch-icon.png"])output("icons/"+name,fs.readFileSync(path.join(root,"..","icons",name)));
const shell=["index.html","style.css","boot.js","protocol.js","storage.js","manifest.webmanifest","GUIDE.html","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
const assets=shell.map(name=>({path:name,sha256:digest(outputs.get(name)||read(name))}));
const build=digest(JSON.stringify(assets));
const sw=read("tools/sw.template.js").toString().replace("__BUILD__",JSON.stringify(build)).replace("__ASSETS__",JSON.stringify(assets));
output("sw.js",sw);
for(const [name,bytes] of outputs){
 const target=path.join(root,name),exists=fs.existsSync(target),same=exists&&fs.readFileSync(target).equals(bytes);
 if(check){if(!same)throw new Error("Fichier généré absent ou obsolète : "+name);}
 else if(!same){
  if(exists&&name.startsWith("releases/"))throw new Error("Une publication immuable a été altérée : "+name);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 }
}
console.log(check?"Prototype et empreintes vérifiés.":"Prototype prêt à publier. Publication annoncée : "+latest+".");

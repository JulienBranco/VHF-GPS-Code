"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"../..");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png"};
function createServer(port=0){
 const state={latest:null,fail:null,corrupt:null,requests:[],delay:0,shellUpdate:false};
 const server=http.createServer(async(req,res)=>{
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{res.writeHead(400).end();return;}
  state.requests.push(pathname);
  if(state.delay)await new Promise(resolve=>setTimeout(resolve,state.delay));
  if(state.fail&&pathname.includes(state.fail)){res.writeHead(503).end("Indisponible pour le test");return;}
  if(pathname.endsWith("/"))pathname+="index.html";
  const target=path.resolve(root,"."+pathname);
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{
   let bytes=fs.readFileSync(target);
   if(state.latest&&pathname==="/prototype-distribution/latest.json")bytes=fs.readFileSync(path.join(root,"prototype-distribution/channels",state.latest+".json"));
   if(state.shellUpdate){
    // Deuxième lanceur servi uniquement par le serveur de test, sans toucher aux sources.
    const hash=value=>require("node:crypto").createHash("sha256").update(value).digest("hex");
    const read=name=>fs.readFileSync(path.join(root,"prototype-distribution",name),"utf8");
    const updatedIndex=read("index.html").replace("<body>","<body data-test-shell=updated>");
    const needle='function status(message,kind="info"){';
    const originalBoot=read("boot.js");
    if(!originalBoot.includes(needle))throw new Error("Fonction de statut introuvable dans le lanceur testé");
    const updatedBoot=originalBoot.replace(needle,needle+'message="[Lanceur test 2] "+message;');
    if(pathname==="/prototype-distribution/index.html")bytes=Buffer.from(updatedIndex);
    if(pathname==="/prototype-distribution/boot.js")bytes=Buffer.from(updatedBoot);
    if(pathname==="/prototype-distribution/sw.js"){
     const original=bytes.toString(),match=original.match(/ASSETS=(\[[^\n]+\]);/);
     if(!match)throw new Error("Manifeste du lanceur introuvable");
     const assets=JSON.parse(match[1]);
     for(const file of assets){
      if(file.path==="index.html")file.sha256=hash(updatedIndex);
      if(file.path==="boot.js")file.sha256=hash(updatedBoot);
     }
     const manifest=JSON.stringify(assets);
     bytes=Buffer.from(original.replace(match[1],manifest).replace(/(SHELL_BUILD=")[a-f0-9]{64}/,"$1"+hash(manifest)));
    }
   }
   if(state.corrupt&&pathname.includes(state.corrupt))bytes=Buffer.from("FICHIER ALTERE POUR TEST");
   res.writeHead(200,{"Content-Type":types[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});
   res.end(bytes);
  }catch{res.writeHead(404).end("Introuvable");}
 });
 return new Promise(resolve=>server.listen(port,"127.0.0.1",()=>resolve({server,state,url:"http://127.0.0.1:"+server.address().port+"/prototype-distribution/"})));
}
module.exports={createServer};
if(require.main===module)createServer(Number(process.argv[2]||8081)).then(({url})=>console.log("Prototype local : "+url));

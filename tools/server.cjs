"use strict";
const http=require("node:http"),fs=require("node:fs"),path=require("node:path");
const root=path.resolve(__dirname,"..");
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png"};
function createServer(port=0){
 const state={fail:null,corrupt:null,delay:0,virtual:new Map(),requests:[]};
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
   let bytes=state.virtual.get(pathname)||fs.readFileSync(target);
   if(state.corrupt&&pathname.includes(state.corrupt))bytes=Buffer.from("FICHIER ALTERE POUR TEST");
   res.writeHead(200,{"Content-Type":types[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"});res.end(bytes);
  }catch{res.writeHead(404).end("Introuvable");}
 });
 return new Promise(resolve=>server.listen(port,"127.0.0.1",()=>resolve({server,state,url:"http://127.0.0.1:"+server.address().port+"/"})));
}
module.exports={createServer};
if(require.main===module)createServer(Number(process.argv[2]||8082)).then(({url})=>console.log("VHF GPS local : "+url));

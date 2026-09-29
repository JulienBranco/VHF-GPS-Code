"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),check=process.argv.includes("--check");
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const read=name=>fs.readFileSync(path.join(root,name),"utf8").replace(/\r\n/g,"\n");
const engine=read("sources/engine.js");
const version=engine.match(/const APP_VERSION="([^"]+)"/)[1],protocol=engine.match(/const PROTOCOL_ID="([^"]+)"/)[1];
const output=new Map(),add=(name,value)=>output.set(name,Buffer.isBuffer(value)?value:Buffer.from(value));
const files=new Map();
for(const name of ["app.html","engine.js","app-adapter.js","runtime.js"])files.set(name,Buffer.from(read("sources/"+name)));
for(const name of ["protocol.js","storage.js","release.js","transition.js","transition.css","install.js"])files.set(name,Buffer.from(read(name)));
const manifest={format:2,api:2,version,protocol,files:[...files].map(([name,value])=>({path:name,sha256:hash(value)}))};
const raw=JSON.stringify(manifest),id=hash(raw);
const releaseAlreadyExists=fs.existsSync(path.join(root,"releases",id,"manifest.json"));
for(const [name,value] of files)add("releases/"+id+"/"+name,value);
add("releases/"+id+"/manifest.json",raw);add("latest.json",JSON.stringify({format:2,release:id}));
for(const name of ["icon-192.png","icon-512.png","apple-touch-icon.png"])add("icons/"+name,fs.readFileSync(path.join(root,"icons",name)));
const names=["index.html","boot.js","protocol.js","storage.js","release.js","transition.js","transition.css","install.js","style.css","manifest.webmanifest","GUIDE.html","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
const assets=names.map(name=>({path:name,sha256:hash(output.get(name)||Buffer.from(read(name)))}));
add("sw.js",read("tools/sw.template.js").replace("__BUILD__",JSON.stringify(hash(JSON.stringify(assets)))).replace("__ASSETS__",JSON.stringify(assets)));
// Le catalogue est informatif : il ne participe ni à l’invitation ni au moteur.
// Conserver les dates enregistrées ; ne pas inventer une date de création pour les anciennes publications.
const cataloguePath=path.join(root,"releases.json");
const previous=fs.existsSync(cataloguePath)?JSON.parse(read("releases.json")):{format:1,releases:[]};
if(previous.format!==1||!Array.isArray(previous.releases))throw Error("Catalogue de publications invalide.");
const prior=new Map(previous.releases.map(row=>[row.release,row]));
const now=new Date().toISOString(),rows=[];
const releaseRoot=path.join(root,"releases");
const ids=new Set(fs.existsSync(releaseRoot)?fs.readdirSync(releaseRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-f0-9]{64}$/.test(entry.name)).map(entry=>entry.name):[]);
ids.add(id);
for(const release of [...ids].sort()){
 const value=release===id?Buffer.from(raw):fs.readFileSync(path.join(releaseRoot,release,"manifest.json"));
 if(hash(value)!==release)throw Error("Manifeste de publication incohérent : "+release);
 const info=JSON.parse(value),old=prior.get(release);
 const createdAt=old?.createdAt??(release===id&&!releaseAlreadyExists?now:null);
 const indexedAt=old?.indexedAt??now;
 for(const date of [createdAt,indexedAt])if(date!==null&&(!date||!Number.isFinite(Date.parse(date))))throw Error("Date de publication invalide : "+release);
 rows.push({release,version:info.version,protocol:info.protocol,createdAt,indexedAt});
}
rows.sort((a,b)=>Number(b.release===id)-Number(a.release===id)||(b.createdAt||b.indexedAt).localeCompare(a.createdAt||a.indexedAt)||a.release.localeCompare(b.release));
add("releases.json",JSON.stringify({format:1,latest:id,releases:rows},null,2)+"\n");
const escape=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const date=value=>new Intl.DateTimeFormat("fr-FR",{timeZone:"Europe/Paris",dateStyle:"short",timeStyle:"short"}).format(new Date(value));
const table=rows.map(row=>'<tr><td>'+(row.release===id?'<strong>Dernière publication</strong>':'Ancienne publication')+'</td><td>'+escape(row.version)+'</td><td>'+escape(row.protocol)+'</td><td>'+(row.createdAt?escape(date(row.createdAt)):'Date de création inconnue<br><small>Répertoriée le '+escape(date(row.indexedAt))+'</small>')+'</td><td><code title="'+row.release+'">'+row.release.slice(0,12)+'</code><br><a href="releases/'+row.release+'/manifest.json">Manifeste</a></td></tr>').join('\n');
add("RELEASES.html",'<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publications VHF GPS</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:1000px;margin:auto;padding:24px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #8885}th{background:#8882}small{opacity:.8}.table-scroll{overflow:auto}code{white-space:nowrap}</style></head><body><h1>Publications VHF GPS</h1><p>Catalogue pour gérer les fichiers du projet. Les dates sont affichées à l’heure de Paris. Les dossiers restent identifiés par leur empreinte.</p><div class="table-scroll"><table><thead><tr><th>État</th><th>Version</th><th>Protocole</th><th>Créée le</th><th>Publication</th></tr></thead><tbody>'+table+'</tbody></table></div><p>La date ne permet pas de savoir si une sortie utilise encore une publication. Après diffusion de son invitation, conserver ses fichiers pour permettre son import et sa réparation. Ce catalogue ne supprime rien automatiquement.</p><p>Les dates de création des publications antérieures au catalogue sont inconnues. Leur date de référencement est indiquée séparément.</p><p><a href="releases.json">Métadonnées complètes</a> · <a href="./">Application</a></p></body></html>\n');
for(const [name,value] of output){
 const target=path.join(root,name),exists=fs.existsSync(target),same=exists&&fs.readFileSync(target).equals(value);
 if(check){if(!same)throw Error("Fichier obsolète : "+name);}
 else if(!same){if(exists&&name.startsWith("releases/"))throw Error("Publication immuable altérée : "+name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);}
}
console.log((check?"Vérifié":"Préparé")+" : version "+version+", publication "+id.slice(0,12)+".");

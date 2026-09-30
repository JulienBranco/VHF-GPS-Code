"use strict";
// Export technique du dessin validé : dimensions, découpe ronde et fond opaque.
// Aucun changement du dessin, du moteur ou des publications.
const fs=require("node:fs"),path=require("node:path");
const {chromium}=require("playwright");
const root=path.resolve(__dirname,".."),source=path.join(root,"icons/radio-carte-source.png");
const exportsList=[
 {name:"icon-192.png",size:192,round:true},
 {name:"icon-512.png",size:512,round:true},
 {name:"icon-maskable-192.png",size:192,round:false,scale:.85},
 {name:"icon-maskable-512.png",size:512,round:false,scale:.85},
 {name:"apple-touch-icon.png",size:180,round:false}
];
async function main(){
 const data="data:image/png;base64,"+fs.readFileSync(source).toString("base64");
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const images=await page.evaluate(async({data,exportsList})=>{
   const picture=new Image();picture.src=data;await picture.decode();
   return exportsList.map(item=>{
    const canvas=document.createElement("canvas");canvas.width=canvas.height=item.size;
    const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    if(item.round){ctx.beginPath();ctx.arc(item.size/2,item.size/2,item.size/2,0,Math.PI*2);ctx.clip();}
    ctx.fillStyle="#09202a";ctx.fillRect(0,0,item.size,item.size);
    const size=item.size*(item.scale||1),offset=(item.size-size)/2;
    // La variante adaptative ajoute une marge sans modifier le dessin validé.
    if(item.scale){ctx.save();ctx.beginPath();ctx.arc(item.size/2,item.size/2,size/2,0,Math.PI*2);ctx.clip();}
    ctx.drawImage(picture,offset,offset,size,size);
    if(item.scale)ctx.restore();
    const cornerAlpha=ctx.getImageData(0,0,1,1).data[3];
    if(cornerAlpha!==(item.round?0:255))throw Error("Fond incorrect : "+item.name);
    return {...item,png:canvas.toDataURL("image/png").split(",")[1]};
   });
  },{data,exportsList});
  for(const item of images){
   fs.writeFileSync(path.join(root,"icons",item.name),Buffer.from(item.png,"base64"));
   console.log(item.name+" · "+item.size+" × "+item.size+" · "+(item.round?"ronde, coins transparents":"fond opaque"));
  }
 }finally{await browser.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});

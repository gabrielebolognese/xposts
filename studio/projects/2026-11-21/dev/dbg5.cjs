const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180, HB=20*1440/1760;
const al=-20+40*(879.5)/1760, be=-HB+2*HB*(1400.5)/1440;
const path=[]; const r=K.trace(a,inc,al,be,{h:0.06,maxSteps:2000,r0:1000,disk:true,rIn:K.risco(a),rOut:24,path});
let im=0,thmin=9; for(let i=1;i<path.length;i+=3) if(Math.abs(path[i])<thmin){thmin=Math.abs(path[i]);im=i;}
for(let i=Math.max(1,im-15);i<Math.min(path.length,im+12);i+=3) console.log(((i-1)/3)|0, 'r',path[i-1].toFixed(4),'th',path[i].toExponential(4),'ph',path[i+1].toFixed(4));

const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180;
const HB=20*1440/1760;
for (const px of [877,878,879,880]) for (const py of [1400,200]) {
  const al=-20+40*(px+0.5)/1760, be=-HB+2*HB*(py+0.5)/1440;
  const path=[]; const r=K.trace(a,inc,al,be,{h:0.06,maxSteps:2000,r0:1000,disk:true,rIn:K.risco(a),rOut:24,path});
  let thmin=9; for(let i=1;i<path.length;i+=3) thmin=Math.min(thmin,Math.abs(path[i]));
  console.log(px,py,al.toFixed(4),be.toFixed(3),'fate',r.fate,'steps',r.steps,'r',r.r.toFixed(3),'n',r.n,'th',(r.th||0).toFixed(3),'min|th|',thmin.toExponential(2));
}

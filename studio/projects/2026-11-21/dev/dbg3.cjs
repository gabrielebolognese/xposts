const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180;
for (const al of [-0.0114, 0.0114, -0.034, 0.5]) for (const be of [-12, -5, 0, 5, 12]) {
  const r=K.trace(a,inc,al,be,{h:0.06,maxSteps:2000,r0:1000,kc:1,disk:true,rIn:K.risco(a),rOut:24});
  console.log(al,be,r.fate,r.steps,r.r.toFixed(3),r.n, (r.th||0).toFixed(3), r.phi.toFixed(3));
}

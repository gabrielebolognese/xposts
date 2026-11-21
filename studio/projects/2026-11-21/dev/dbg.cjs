const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180;
for (const [al,be] of [[2,0],[2,1],[0,0.5],[10,0],[0,10]]) {
  const path=[]; const r=K.trace(a,inc,al,be,{h:0.06,maxSteps:2000,r0:1000,kc:1,path});
  console.log(al,be,r.fate,r.steps,r.rmin.toFixed(3), 'last', path.slice(-3).map(x=>x.toFixed(3)).join(','));
  console.log('  first', path.slice(0,12).map(x=>x.toFixed(3)).join(','));
}

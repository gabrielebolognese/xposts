const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180, rIn=K.risco(a), rOut=24;
function run(o,N){const out=[];let st=0;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const al=-20+40*(i+0.5)/N+0.0113, be=-16.36+32.72*(j+0.5)/N;
  const r=K.trace(a,inc,al,be,Object.assign({maxSteps:20000,r0:1000,disk:true,rIn,rOut},o)); st+=r.steps; out.push(r);} return {out,mean:st/(N*N)};}
const N=40;
const ref=run({h:0.004,kc:1,kp:1,fmax:1},N);
for (const o of [{h:0.06,kc:1,kp:0.5,fmax:1},{h:0.06,kc:1,kp:0.5,fmax:3,rfar:60},{h:0.06,kc:1,kp:0.5,fmax:5,rfar:60},{h:0.06,kc:1,kp:0.5,fmax:5,rfar:100}]) {
 const r=run(o,N); const d=[]; let mm=0;
 r.out.forEach((x,k)=>{const q=ref.out[k]; if(x.fate!==q.fate||x.n!==q.n){mm++;return;} if(x.fate===1) d.push(x.t-q.t);});
 const m=d.reduce((s,x)=>s+x,0)/d.length; const rel=Math.sqrt(d.reduce((s,x)=>s+(x-m)**2,0)/d.length);
 console.log(JSON.stringify(o),'steps',r.mean.toFixed(1),'mm',mm,'mean dt offset',m.toFixed(3),'rms rel dt',rel.toExponential(2), 'max', Math.max(...d.map(x=>Math.abs(x-m))).toFixed(3));
}

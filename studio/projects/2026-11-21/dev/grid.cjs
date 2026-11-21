const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180, rIn=K.risco(a), rOut=24;
function run(h,kc,N){const out=[];let st=0;const t0=Date.now();
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const al=-20+40*(i+0.5)/N, be=-16.36+32.72*(j+0.5)/N;
  const r=K.trace(a,inc,al,be,{h,maxSteps:8000,r0:1000,kc,disk:true,rIn,rOut}); st+=r.steps; out.push(r);} 
 return {out,mean:st/(N*N),ms:Date.now()-t0};}
const N=Number(process.argv[2]||60);
const ref=run(0.004,1,N); console.log('ref mean steps',ref.mean.toFixed(1),'ms',ref.ms);
for (const [h,kc] of [[0.06,0],[0.06,0.5],[0.06,1],[0.06,2],[0.1,1]]) {
 const r=run(h,kc,N); let mm=0,dr=0,nd=0,maxd=0,fates=[0,0,0,0];
 r.out.forEach((o,k)=>{const q=ref.out[k]; fates[o.fate]++; if(o.fate!==q.fate||o.n!==q.n){mm++;return;} if(o.fate===1){const d=Math.abs(o.r-q.r);dr+=d*d;nd++;maxd=Math.max(maxd,d);}});
 console.log(`h ${h} kc ${kc}: mean steps ${r.mean.toFixed(1)} mismatch ${mm}/${N*N} rms dr ${Math.sqrt(dr/nd).toExponential(2)} max ${maxd.toExponential(2)} fates`,fates.join(','));
}

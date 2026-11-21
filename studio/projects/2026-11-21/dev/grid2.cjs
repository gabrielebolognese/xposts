const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a=0.94, inc=72*Math.PI/180, rIn=K.risco(a), rOut=24;
function run(o,N){const out=[];let st=0;
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){const al=-20+40*(i+0.5)/N+0.0113, be=-16.36+32.72*(j+0.5)/N;
  const r=K.trace(a,inc,al,be,Object.assign({maxSteps:20000,r0:1000,disk:true,rIn,rOut},o)); st+=r.steps; out.push(r);} return {out,mean:st/(N*N)};}
const N=Number(process.argv[2]||50);
const ref=run({h:0.004,kc:1,kp:1,fmax:1},N); console.log('ref steps',ref.mean.toFixed(0));
const wrap=x=>{x=((x%(2*Math.PI))+2*Math.PI)%(2*Math.PI);return x;};
for (const o of [{h:0.06,kc:1,kp:0,fmax:1},{h:0.06,kc:1,kp:0.5,fmax:1},{h:0.06,kc:1,kp:0.5,fmax:5},{h:0.06,kc:1,kp:0.5,fmax:8},{h:0.06,kc:1,kp:1,fmax:5},{h:0.08,kc:1,kp:0.5,fmax:5}]) {
 const r=run(o,N); let mm=0,dr=0,dp=0,nd=0,mdp=0,dtt=0;
 r.out.forEach((x,k)=>{const q=ref.out[k]; if(x.fate!==q.fate||x.n!==q.n){mm++;return;} if(x.fate===1){dr+=(x.r-q.r)**2; let d=Math.abs(wrap(x.phi)-wrap(q.phi)); d=Math.min(d,2*Math.PI-d); dp+=d*d; mdp=Math.max(mdp,d); dtt+=(x.t-q.t)**2; nd++;}});
 console.log(JSON.stringify(o),'steps',r.mean.toFixed(1),'mismatch',mm,'rms dr',Math.sqrt(dr/nd).toExponential(1),'rms dphi',Math.sqrt(dp/nd).toExponential(1),'max dphi',mdp.toExponential(1),'rms dt',Math.sqrt(dtt/nd).toExponential(1));
}

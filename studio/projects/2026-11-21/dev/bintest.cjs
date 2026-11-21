const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../eht.js','utf8'));
const E=globalThis.EHT; const N=96, EH=80, UAS=Math.PI/180/3600e6, d=2*EH/N;
const img=JSON.parse(fs.readFileSync(__dirname+'/'+(process.argv[2]||'xi_1_3.json')));
const ax={l0:(EH-d/2)*UAS,dl:-d*UAS,m0:(-EH+d/2)*UAS,dm:d*UAS};
let v0=0; for(const v of img) v0+=v;
const DATE0=Date.UTC(2026,7,24,3,10,0), lam=1.3035e-3, el=10*Math.PI/180;
const uv=[]; for(let s=-37800;s<=9600;s+=300){const sn=E.snapshot(DATE0+s*1000,lam,el); for(const p of sn.up) uv.push(p.u,p.v);}
const V=E.vis(img,ax,Float64Array.from(uv)); const K=uv.length/2;
const bins={}; for(let k=0;k<K;k++){const rho=Math.hypot(uv[2*k],uv[2*k+1])/1e9; const b=Math.floor(rho/0.4); (bins[b]=bins[b]||[]).push([V.re[k]/v0,Math.hypot(V.re[k],V.im[k])/v0]);}
// coherent model on full circle at bin centres
for(const b of Object.keys(bins).map(Number).sort((x,y)=>x-y)){const rho=(b+0.5)*0.4e9; const u=[];for(let i=0;i<72;i++){const ps=Math.PI*i/72;u.push(rho*Math.cos(ps),rho*Math.sin(ps));}
 const M=E.vis(img,ax,Float64Array.from(u)); let c=0,s=0; for(let i=0;i<72;i++){c+=M.re[i];s+=Math.hypot(M.re[i],M.im[i]);}
 const arr=bins[b]; const mre=arr.reduce((a,x)=>a+x[0],0)/arr.length, mamp=arr.reduce((a,x)=>a+x[1],0)/arr.length;
 console.log(`rho ${(rho/1e9).toFixed(1)} n ${arr.length}  data<ReV> ${mre.toFixed(3)} model coh ${(c/72/v0).toFixed(3)} | data<|V|> ${mamp.toFixed(3)} model inc ${(s/72/v0).toFixed(3)}`);}
// fit binned <Re V> with J0(pi d rho) exp(-(pi w rho)^2 / 4ln2), weights n
function J0(x){const ax=Math.abs(x); if(ax<8){const y=x*x;return (57568490574.0+y*(-13362590354.0+y*(651619640.7+y*(-11214424.18+y*(77392.33017+y*(-184.9052456))))))/(57568490411.0+y*(1029532985.0+y*(9494680.718+y*(59272.64853+y*(267.8532712+y)))));}
 const z=8/ax,y=z*z,xx=ax-0.785398164; const p=1+y*(-0.1098628627e-2+y*(0.2734510407e-4+y*(-0.2073370639e-5+y*0.2093887211e-6))); const q=-0.1562499995e-1+y*(0.1430488765e-3+y*(-0.6911147651e-5+y*(0.7621095161e-6-y*0.934935152e-7))); return Math.sqrt(0.636619772/ax)*(Math.cos(xx)*p-z*Math.sin(xx)*q);}
const UAS2=Math.PI/180/3600e6; const B=Object.keys(bins).map(Number).map(b=>{const a=bins[b];return [(b+0.5)*0.4e9,a.reduce((s,x)=>s+x[0],0)/a.length,a.length];});
let best={c:1e99}; for(let dd=25;dd<=75;dd+=0.25) for(let w=0;w<=40;w+=0.5){let c=0; for(const [r,v,n] of B){const m=J0(Math.PI*dd*UAS2*r)*Math.exp(-((Math.PI*w*UAS2*r)**2)/(4*Math.LN2)); c+=n*(v-m)**2;} if(c<best.c) best={c,dd,w};}
console.log('fit', JSON.stringify(best), 'null', (0.7655/(best.dd*UAS2)/1e9).toFixed(3),'Gλ');

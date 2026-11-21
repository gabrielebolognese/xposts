const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../eht.js','utf8'));
const E=globalThis.EHT; const N=96, EH=80, UAS=Math.PI/180/3600e6, d=2*EH/N;
const img=JSON.parse(fs.readFileSync(__dirname+'/'+(process.argv[2]||'xi_1_3.json')));
const ax={l0:(EH-d/2)*UAS,dl:-d*UAS,m0:(-EH+d/2)*UAS,dm:d*UAS};
let v0=0; for(const v of img) v0+=v;
const DATE0=Date.UTC(2026,7,24,3,10,0), lam=1.3035e-3, el=10*Math.PI/180;
const uv=[]; for(let s=-37800;s<=9600;s+=300){const sn=E.snapshot(DATE0+s*1000,lam,el); for(const p of sn.up) uv.push(p.u,p.v);}
const V=E.vis(img,ax,Float64Array.from(uv)); const K=uv.length/2;
// J0, J1 (Abramowitz & Stegun 9.4)
function J0(x){const ax=Math.abs(x); if(ax<8){const y=x*x;return (57568490574.0+y*(-13362590354.0+y*(651619640.7+y*(-11214424.18+y*(77392.33017+y*(-184.9052456))))))/(57568490411.0+y*(1029532985.0+y*(9494680.718+y*(59272.64853+y*(267.8532712+y)))));}
 const z=8/ax,y=z*z,xx=ax-0.785398164; const p=1+y*(-0.1098628627e-2+y*(0.2734510407e-4+y*(-0.2073370639e-5+y*0.2093887211e-6))); const q=-0.1562499995e-1+y*(0.1430488765e-3+y*(-0.6911147651e-5+y*(0.7621095161e-6-y*0.934935152e-7))); return Math.sqrt(0.636619772/ax)*(Math.cos(xx)*p-z*Math.sin(xx)*q);}
function J1(x){const ax=Math.abs(x); let r; if(ax<8){const y=x*x; r=x*(72362614232.0+y*(-7895059235.0+y*(242396853.1+y*(-2972611.439+y*(15704.48260+y*(-30.16036606))))))/(144725228442.0+y*(2300535178.0+y*(18583304.74+y*(99447.43394+y*(376.9991397+y)))));} else {const z=8/ax,y=z*z,xx=ax-2.356194491; const p=1+y*(0.183105e-2+y*(-0.3516396496e-4+y*(0.2457520174e-5+y*(-0.240337019e-6)))); const q=0.04687499995+y*(-0.2002690873e-3+y*(0.8449199096e-5+y*(-0.88228987e-6+y*0.105787412e-6))); r=Math.sqrt(0.636619772/ax)*(Math.cos(xx)*p-z*Math.sin(xx)*q); if(x<0) r=-r;} return r;}
const re=new Float64Array(K), im=new Float64Array(K), rho=new Float64Array(K), th=new Float64Array(K);
for(let k=0;k<K;k++){re[k]=V.re[k]/v0; im[k]=V.im[k]/v0; rho[k]=Math.hypot(uv[2*k],uv[2*k+1]); th[k]=Math.atan2(uv[2*k+1],uv[2*k]);}
const t0=Date.now(); let best={chi:1e99};
for(let dd=30;dd<=70;dd+=1){const x=Math.PI*dd*UAS; const j0=new Float64Array(K), j1=new Float64Array(K); for(let k=0;k<K;k++){j0[k]=J0(x*rho[k]); j1[k]=J1(x*rho[k]);}
 for(let w=0;w<=24;w+=4){ const tw=Math.PI*w*UAS; for(let x0=-15;x0<=15;x0+=3) for(let y0=-15;y0<=15;y0+=3){
  // basis: f = T P [J0, 2i J1 sin(th - pi/2)? ] ; theta = phi_uv - pi/2 ; u.x0 with l=-alpha convention: x0 in alpha (east-left?) use (l,m) = (-x0, y0)
  let A=[[0,0,0],[0,0,0],[0,0,0]], b=[0,0,0];
  for(let k=0;k<K;k++){const T=Math.exp(-((tw*rho[k])**2)/(4*Math.LN2)); const ph=-2*Math.PI*(uv[2*k]*(-x0*UAS)+uv[2*k+1]*(y0*UAS)); const pc=Math.cos(ph), ps=Math.sin(ph);
   const tt=th[k]-Math.PI/2; const s1=Math.sin(tt), c1=Math.cos(tt);
   // basis complex values before phase: f0 = J0 ; f1 = 2i J1 s1 ; f2 = 2i J1 c1
   const f=[[T*j0[k],0],[0,2*T*j1[k]*s1],[0,2*T*j1[k]*c1]].map(([a,bb])=>[a*pc-bb*ps,a*ps+bb*pc]);
   for(let i=0;i<3;i++){ b[i]+=f[i][0]*re[k]+f[i][1]*im[k]; for(let j=0;j<3;j++) A[i][j]+=f[i][0]*f[j][0]+f[i][1]*f[j][1]; } }
  // solve 3x3
  const M=A.map((r,i)=>[...r,b[i]]); for(let i=0;i<3;i++){let p=i;for(let r=i+1;r<3;r++) if(Math.abs(M[r][i])>Math.abs(M[p][i])) p=r; [M[i],M[p]]=[M[p],M[i]]; for(let r=0;r<3;r++) if(r!==i){const f2=M[r][i]/M[i][i]; for(let c=i;c<4;c++) M[r][c]-=f2*M[i][c];}}
  const c=[M[0][3]/M[0][0],M[1][3]/M[1][1],M[2][3]/M[2][2]];
  // chi2 = sum |V - model|^2 = sum|V|^2 - c.b  (least squares)
  let chi=0; for(let k=0;k<K;k++) chi+=re[k]*re[k]+im[k]*im[k]; chi-= c[0]*b[0]+c[1]*b[1]+c[2]*b[2];
  if(chi<best.chi) best={chi,dd,w,x0,y0,c};}}}
console.log('fit ms',Date.now()-t0,'K',K, JSON.stringify(best), 'null Gλ', (0.7655/(best.dd*UAS)/1e9).toFixed(3));

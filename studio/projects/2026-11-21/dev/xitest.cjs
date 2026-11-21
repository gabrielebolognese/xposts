const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); (0,eval)(fs.readFileSync(__dirname+'/../eht.js','utf8'));
const K=globalThis.Kerr, E=globalThis.EHT;
const a=0.94, inc=72*Math.PI/180, N=96, EH=80, uasM=5.12449, UAS=Math.PI/180/3600e6, d=2*EH/N, SS=3;
const rin=K.risco(a), rout=Number(process.argv[2]||18);
// trace once (3x3 supersampled per pixel), keep r, lambda
const hits=[];
for(let y=0;y<N;y++)for(let x=0;x<N;x++){const px=[];for(let j=0;j<SS;j++)for(let i=0;i<SS;i++){const al=(-EH+(x+(i+0.5)/SS)*d)/uasM, be=(-EH+(y+(j+0.5)/SS)*d)/uasM;
 const r=K.trace(a,inc,al,be,{h:0.06,maxSteps:3000,disk:true,rIn:rin,rOut:rout}); px.push(r.fate===1?[r.r,r.lam]:null);} hits.push(px);}
function gxi(r,lam,xi){const D=r*r-2*r+a*a, A=(r*r+a*a)**2-a*a*D, w=2*a*r/A, Wk=1/(r**1.5+a), W=w+xi*(Wk-w);
 const gtt=-(1-2/r), gtp=-2*a/r, gpp=r*r+a*a+2*a*a/r; const n=-(gtt+2*gtp*W+gpp*W*W); return Math.sqrt(n)/(1-W*lam);}
const ax={l0:(EH-d/2)*UAS,dl:-d*UAS,m0:(-EH+d/2)*UAS,dm:d*UAS};
const PR=64,PA=36,uv=new Float64Array(PR*PA*2);
for(let j=0;j<PR;j++)for(let i=0;i<PA;i++){const rho=(j+1)/PR*10e9,ps=Math.PI*i/PA,k=j*PA+i;uv[2*k]=rho*Math.cos(ps);uv[2*k+1]=rho*Math.sin(ps);}
for (const [xi,q,gp] of [[1,3,3],[0.5,3,3],[0.3,3,3],[0,3,3],[0.3,2,3],[0,2,3]]) {
 const img=new Float64Array(N*N);
 hits.forEach((px,k)=>{let s=0;for(const h of px) if(h){const g=gxi(h[0],h[1],xi); s+=g**gp*h[0]**-q;} img[k]=s/px.length;});
 let v0=0; for(const v of img) v0+=v; const V=E.vis(img,ax,uv); const inc_=[],coh=[];
 for(let j=0;j<PR;j++){let s=0,c=0;for(let i=0;i<PA;i++){const k=j*PA+i;s+=Math.hypot(V.re[k],V.im[k]);c+=V.re[k];}inc_.push(s/PA/v0);coh.push(c/PA/v0);}
 let mn=null; for(let j=2;j<PR-1;j++) if(inc_[j]<inc_[j-1]&&inc_[j]<=inc_[j+1]){mn=[(j+1)/PR*10,inc_[j]];break;}
 console.log(`xi ${xi} q ${q}: incoherent min`, mn?mn.map(v=>v.toFixed(3)).join('@'):'none', '| inc:', inc_.filter((_,j)=>j%3==0).map(v=>v.toFixed(3)).join(' '));
 fs.writeFileSync(__dirname+`/xi_${xi}_${q}.json`,JSON.stringify(Array.from(img)));
}

// prototype: 230 GHz optically thin flow image on the EHT crop, visibilities on the polar grid
const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); (0,eval)(fs.readFileSync(__dirname+'/../eht.js','utf8'));
const K=globalThis.Kerr, E=globalThis.EHT;
const a=0.94, inc=72*Math.PI/180, N=96, EH=80, uasM=5.12449, UAS=Math.PI/180/3600e6, d=2*EH/N;
const q=Number(process.argv[2]||3), opaque=process.argv[3]!=='thin';
const img=new Float64Array(N*N);
for(let y=0;y<N;y++)for(let x=0;x<N;x++){const al=(-EH+(x+0.5)*d)/uasM, be=(-EH+(y+0.5)*d)/uasM;
 let s=0; for(let j=0;j<2;j++)for(let i=0;i<2;i++){const r=K.trace(a,inc,al+(i-0.5)*d/uasM/2,be+(j-0.5)*d/uasM/2,{h:0.04,maxSteps:6000,disk:opaque,rIn:K.risco(a),rOut:18,qmm:q}); s+=r.mm;} img[y*N+x]=s/4;}
const ax={l0:(EH-d/2)*UAS,dl:-d*UAS,m0:(-EH+d/2)*UAS,dm:d*UAS};
let v0=0; for(const v of img) v0+=v;
const PR=64,PA=36,uv=new Float64Array(PR*PA*2);
for(let j=0;j<PR;j++)for(let i=0;i<PA;i++){const rho=(j+1)/PR*10e9,ps=Math.PI*i/PA,k=j*PA+i;uv[2*k]=rho*Math.cos(ps);uv[2*k+1]=rho*Math.sin(ps);}
const V=E.vis(img,ax,uv); const inc_=[],coh=[];
for(let j=0;j<PR;j++){let s=0,c=0;for(let i=0;i<PA;i++){const k=j*PA+i;s+=Math.hypot(V.re[k],V.im[k]);c+=V.re[k];}inc_.push(+(s/PA/v0).toFixed(3));coh.push(+(c/PA/v0).toFixed(3));}
console.log('q',q,'opaque',opaque); console.log('inc',inc_.join(' ')); console.log('coh',coh.join(' '));
// ascii image
let mx=0; for(const v of img) mx=Math.max(mx,v);
const ch=' .:-=+*#%@'; for(let y=N-1;y>=0;y-=3){let l='';for(let x=0;x<N;x+=2){l+=ch[Math.min(9,Math.floor(9.99*img[y*N+x]/mx))];}console.log(l);}
fs.writeFileSync(__dirname+'/mm_q'+q+(opaque?'':'_thin')+'.json',JSON.stringify(Array.from(img)));

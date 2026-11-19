const fs=require('fs');
for (const f of ['core.js','mc.js']) (new Function(fs.readFileSync(__dirname+'/../'+f,'utf8')))();
const M = CORE.createModel(); M.bench=true; M.setXS(); M.solve();
const mat = M.mcMaterial();
const mc = MCK.createMC(); mc.setMaterial(mat);
const Nn = +process.argv[2]||20000;
const rnd = MCK.rngFrom(7);
// initial source: uniform over fuel cells
let sites = new Float32Array(2*Nn);
const fuelCells=[]; for (let c=0;c<136*136;c++) if (mat.NSF[c]>0) fuelCells.push(c);
for (let i=0;i<Nn;i++){ const c=fuelCells[(rnd()*fuelCells.length)|0]; sites[2*i]=(c%136+rnd())*2.5; sites[2*i+1]=(((c/136)|0)+rnd())*2.5; }
let k=1, ks=[], t0=Date.now(), hist=0, fl=0;
for (let g=0; g<200; g++){
  const r = mc.run(sites, Nn, 1000+g, k, 2);
  const kg = r.score/Nn; hist+=Nn; fl+=r.flights;
  // entropy
  const bins=new Float64Array(289); const nb=r.bank.length/2;
  for (let i=0;i<nb;i++){ const bx=Math.min(16,(r.bank[2*i]/20)|0), by=Math.min(16,(r.bank[2*i+1]/20)|0); bins[by*17+bx]++; }
  let H=0; for (const b of bins) if (b>0){ const p=b/nb; H-=p*Math.log2(p); }
  // resample
  const ns=new Float32Array(2*Nn); for (let i=0;i<Nn;i++){ const j=(rnd()*nb)|0; ns[2*i]=r.bank[2*j]; ns[2*i+1]=r.bank[2*j+1]; }
  sites=ns; k=kg; if (g>=50) ks.push(kg);
  if (g%25===0) console.log('gen',g,'k',kg.toFixed(5),'H',H.toFixed(3),'bank',nb,'coll/hist',(r.coll/Nn).toFixed(1),'flights/hist',(r.flights/Nn).toFixed(1),'leak',r.leak);
}
const ms=Date.now()-t0;
const mean=ks.reduce((a,b)=>a+b,0)/ks.length; const sd=Math.sqrt(ks.reduce((a,b)=>a+(b-mean)**2,0)/(ks.length-1));
console.log('MC k', mean.toFixed(5), '+-', (sd/Math.sqrt(ks.length)*1e5).toFixed(1),'pcm', 'gen sd', (sd*1e5).toFixed(0), 'diff k', M.k.toFixed(5), 'delta pcm', ((mean-M.k)*1e5).toFixed(0));
console.log('hist/s', (hist/ms*1000).toFixed(0), 'ns/flight', (ms*1e6/fl).toFixed(1), 'ms per 3334', (ms/hist*3334).toFixed(2));

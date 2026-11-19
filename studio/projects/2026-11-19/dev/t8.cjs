const fs=require('fs');
for (const f of ['core.js', process.argv[2]||'mc.js']) (new Function(fs.readFileSync(__dirname+'/../'+f,'utf8')))();
const M = CORE.createModel(); M.bench=true; M.setXS(); M.solve({maxOuter:50});
const mat = M.mcMaterial();
const mc = MCK.createMC(); mc.setMaterial(mat);
const Nn=3334, rnd=MCK.rngFrom(3);
const fuelCells=[]; for (let c=0;c<136*136;c++) if (mat.NSF[c]>0) fuelCells.push(c);
const sites=new Float32Array(2*Nn); for (let i=0;i<Nn;i++){ const c=fuelCells[(rnd()*fuelCells.length)|0]; sites[2*i]=(c%136+rnd())*2.5; sites[2*i+1]=(((c/136)|0)+rnd())*2.5; }
for (let rep=0; rep<6; rep++){ const t0=process.hrtime.bigint(); let fl=0; for (let k=0;k<10;k++){ const r=mc.run(sites,Nn,rep*100+k,1.03,2); fl+=r.flights;} const ms=Number(process.hrtime.bigint()-t0)/1e6; console.log('10 shares', ms.toFixed(1),'ms  per share', (ms/10).toFixed(2), 'ns/flight', (ms*1e6/fl).toFixed(1)); }

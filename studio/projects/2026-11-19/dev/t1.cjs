const fs=require('fs'); (new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
const C = globalThis.CORE;
console.log('fuel asm', C.nFuelAsm, 'active cells', C.ACT.length, 'fuel cells', C.FUEL.length, 'rods', C.rods.map(r=>r.name+'('+r.ac+','+r.ar+')').join(' '));
const M = C.createModel();
M.bench = true; M.setXS();
let t0 = Date.now();
let r = M.solve({track:true});
console.log('bench k', r.k.toFixed(6), 'outers', r.outers, 'ms', Date.now()-t0, 'dr', r.dr.toFixed(4), 'dpcm', ((r.k-1.02959)/1.02959*1e5).toFixed(1));
// tighter
M.tolK=1e-9; M.tolS=1e-8; t0=Date.now(); r = M.solve({track:true});
console.log('bench tight k', r.k.toFixed(7), 'outers', r.outers, 'ms', Date.now()-t0, 'dr', r.dr.toFixed(4));
M.tolK=1e-6; M.tolS=1e-5;
// rods out
M.bench=false; M.feedback=false; M.xenon=false; M.steps=228; M.ppm=0; M.setXS();
t0=Date.now(); r=M.solve(); console.log('rods out k', r.k.toFixed(6), 'outers', r.outers, 'ms', Date.now()-t0);
M.steps=0; M.setXS(); r=M.solve(); console.log('rods in (op) k', r.k.toFixed(6), r.outers);
M.steps=210; M.setXS(); r=M.solve(); console.log('210 k', r.k.toFixed(6), r.outers);
const k210 = r.k;
// xenon equilibrium at 100%
M.P=1; M.normalize(C.PRATED);
let maxphi=0, sum=0; for (const c of C.FUEL){ sum+=M.phi2[c]; if(M.phi2[c]>maxphi)maxphi=M.phi2[c]; }
console.log('mean phi2 fuel', (sum/C.FUEL.length).toExponential(3), 'max', maxphi.toExponential(3));
M.xenon=true;
for (let it=0; it<8; it++){ M.xenonEq(); M.setXS(); r=M.solve(); M.normalize(C.PRATED); }
console.log('eq Xe k', r.k.toFixed(6), 'rhoXe', ((1/k210-1/r.k)*1e5).toFixed(0));
let xs=0; for (const c of C.FUEL) xs+=M.X[c]; console.log('mean X', (xs/C.FUEL.length).toExponential(3));

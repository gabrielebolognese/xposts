const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
const C = globalThis.CORE;
function run(label, setup, cheb, sigma){
  const M = C.createModel(); M.cheb=cheb; if(sigma) M.sigma=sigma;
  M.bench=true; M.setXS(); 
  if (setup) setup(M);
  const t0=process.hrtime.bigint(); const r=M.solve({track:true}); const ms=Number(process.hrtime.bigint()-t0)/1e6;
  console.log(label, cheb?'cheb':'plain', 'k', r.k.toFixed(7), 'outers', r.outers, 'ms', ms.toFixed(0), 'dr', r.dr.toFixed(3), 'drPlain', (r.drPlain||0).toFixed(3));
  return M;
}
run('bench', null, false);
run('bench', null, true);
run('bench s.98', null, true, 0.98);
run('bench s.95', null, true, 0.95);
// tilt test: converge, then drop SW rod (operating xs no fb), resolve
for (const cheb of [false,true]) {
  const M = C.createModel(); M.cheb=cheb; M.bench=false; M.feedback=false; M.xenon=false; M.steps=210; M.setXS(); M.solve();
  M.dropped[6]=1; M.setXS();
  const t0=process.hrtime.bigint(); const r=M.solve({track:true}); const ms=Number(process.hrtime.bigint()-t0)/1e6;
  console.log('drop', cheb?'cheb':'plain', 'k', r.k.toFixed(7), 'outers', r.outers, 'ms', ms.toFixed(0));
  // tight reference
  M.tolK=1e-10; M.tolS=1e-9; const r2=M.solve(); console.log('   tight k', r2.k.toFixed(7), 'extra outers', r2.outers);
}

const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
const C = globalThis.CORE;
const M = C.createModel();
M.bench = true; M.setXS();
for (let r=0;r<5;r++){ M.tolK=0; M.tolS=0; const t0=process.hrtime.bigint(); M.solve({maxOuter:200}); const ms=Number(process.hrtime.bigint()-t0)/1e6; console.log('200 outers', ms.toFixed(1),'ms', (ms/200).toFixed(3),'ms/outer'); }
M.sweeps=1; for (let r=0;r<3;r++){ const t0=process.hrtime.bigint(); M.solve({maxOuter:200}); const ms=Number(process.hrtime.bigint()-t0)/1e6; console.log('1 sweep: ', (ms/200).toFixed(3),'ms/outer'); }

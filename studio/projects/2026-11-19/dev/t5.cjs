const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
(new Function(fs.readFileSync(__dirname+'/../plant.js','utf8')))();
const S = PLANT.createPlant({fuelScale: 1.04});
// instrument
const M=S.M; const orig=M.solve; let rec=[];
M.solve=function(o){ const r=orig.call(M,o); rec.push(r.outers); return r; };
S.boot(); S.fast=true;
while (S.t < 2*1440+22*60) S.step(15);
S.fast=false;
while (S.t < 3*1440+2*60) { rec=[]; S.step(5); const r=S.record(); console.log(PLANT.clock(r.t), 'qptr', r.qptr.toFixed(4), 'solves', rec.join(' '), S.logs.slice(-3).filter(l=>l.t===S.t && (l.kind==='xe'||l.kind==='meas')).map(l=>l.text).join('|')); }

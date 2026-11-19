const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
(new Function(fs.readFileSync(__dirname+'/../plant.js','utf8')))();
const fsc = +process.argv[2]||1.0;
const S = PLANT.createPlant({fuelScale: fsc});
let t0=Date.now();
S.boot();
console.log('boot ms', Date.now()-t0, 'solves', S.solves, 'outers', S.outersTotal);
for (const l of S.logs) console.log(PLANT.clock(l.t), l.kind, l.text);
S.logs.length=0;
t0=Date.now();
S.fast=true;
const end = 2*1440 + 11*60+45;
let n=0, o0=S.outersTotal, maxStep=0;
while (S.t < end - 1e-9) { const ts=Date.now(); S.step(15); n++; maxStep=Math.max(maxStep, Date.now()-ts);
  const r=S.record();
  if (n%4===0 && process.argv[3]) console.log(PLANT.clock(r.t), 'P',r.power.toFixed(0),'D',r.steps,'ppm',r.ppm.toFixed(1),'Xe',r.xe.toFixed(0),'rho',r.rho.toFixed(1),'qptr',r.qptr.toFixed(4),'fxy',r.fxy.toFixed(3),'out',r.outers, 'dw', S.dw.toFixed(2));
}
console.log('ff ms', Date.now()-t0, 'steps', n, 'outers', S.outersTotal-o0, 'max step ms', maxStep);
S.fast=false;
t0=Date.now(); let s0=S.solves; o0=S.outersTotal; maxStep=0; let worst='';
while (S.t < 3*1440+9*60) { const ts=Date.now(); S.step(5); const el=Date.now()-ts; const r=S.record(); if (el>maxStep){maxStep=el; worst=PLANT.clock(r.t)+' out '+r.outers+' solves '+r.solves;}
  if (Math.round(r.t)%30===0) console.log(PLANT.clock(r.t), 'P',r.power.toFixed(0),'D',r.steps,'ppm',r.ppm.toFixed(1),'Xe',r.xe.toFixed(0),'rho',r.rho.toFixed(1),'qptr',r.qptr.toFixed(4),'fxy',r.fxy.toFixed(3),'fc',r.fcell.toFixed(3),'out',r.outers,'ms',S.stepMs, 'tf', r.tf.toFixed(0), r.tfMax.toFixed(0), 'dc', r.dc.toFixed(2),'pd', r.pd.toFixed(0), 'dw', r.dw.toFixed(1));
}
console.log('rt ms', Date.now()-t0, 'solves', S.solves-s0, 'outers', S.outersTotal-o0, 'worst step', maxStep, worst);
console.log(S.logs.slice(-30).map(l=>PLANT.clock(l.t)+' '+l.kind+' '+l.text).join('\n'));

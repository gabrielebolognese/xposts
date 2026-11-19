const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
(new Function(fs.readFileSync(__dirname+'/../plant.js','utf8')))();
const S = PLANT.createPlant({fuelScale: 1.04});
const M=S.M; const orig=M.solve; let rec=[];
M.solve=function(o){ const r=orig.call(M,o); rec.push(r.outers); return r; };
S.boot(); S.fast=true; let tot={main:0, rod:0, xe:0};
while (S.t < 2*1440+11*60+45) { rec=[]; S.step(15); const tm=Math.round(S.t); 
  tot.main+=rec[0]; if (tm%30===0){ tot.xe+=rec[rec.length-1]; tot.rod+=rec.slice(1,-1).reduce((a,b)=>a+b,0);} else tot.rod+=rec.slice(1).reduce((a,b)=>a+b,0);
  if (S.t>1440+19*60 && S.t<1440+28*60) console.log(PLANT.clock(S.t), rec.join(' ')); }
console.log(tot);

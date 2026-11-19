const fs=require('fs');
(new Function(fs.readFileSync(__dirname+'/../core.js','utf8')))();
(new Function(fs.readFileSync(__dirname+'/../plant.js','utf8')))();
const S = PLANT.createPlant({fuelScale: 1.04});
S.boot(); S.logs.length=0; S.fast=true;
while (S.t < 2*1440+22*60+45) S.step(15);
S.fast=false;
while (S.t < 3*1440+3*60) { S.step(5); }
for (const l of S.logs.filter(l=>['alarm','meas','ctrl'].includes(l.kind))) console.log(PLANT.clock(l.t), l.kind, l.text);
console.log('kin', S.kin && S.kin.cEnd && S.kin.cEnd.map(x=>x.toFixed(3)).join(' '), S.kin && S.kin.pEnd);

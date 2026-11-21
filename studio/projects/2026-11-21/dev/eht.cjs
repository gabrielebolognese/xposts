const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../eht.js','utf8')); const E=globalThis.EHT;
const lam=1.3035e-3, el=10*Math.PI/180;
for (const s of E.stations) console.log(s.id,(s.lat*180/Math.PI).toFixed(2),(s.lon*180/Math.PI).toFixed(2));
function night(dateStr){ // count samples every 5 min over 36 h window centred on date
  const t0=Date.parse(dateStr+'T00:00:00Z')-12*3600e3; const samples=[];
  for(let m=0;m<48*60;m+=5){const ms=t0+m*60e3; const s=E.snapshot(ms,lam,el); const n=s.up.filter(x=>E.baselines[x.k].len>10000).length; samples.push({ms,n,tot:s.up.length});}
  // find the contiguous night containing max
  let best=samples.reduce((a,b)=>b.n>a.n?b:a); let i=samples.indexOf(best); let lo=i,hi=i; while(lo>0&&samples[lo-1].n>0)lo--; while(hi<samples.length-1&&samples[hi+1].n>0)hi++;
  const tot=samples.slice(lo,hi+1).reduce((a,b)=>a+b.tot,0);
  const target=Date.parse(dateStr+'T03:10:00Z'); let acc=0; for(let k=lo;k<=hi;k++){ if(samples[k].ms<=target) acc+=samples[k].tot;}
  return {start:new Date(samples[lo].ms).toISOString(), end:new Date(samples[hi].ms).toISOString(), tot, frac:acc/tot};
}
for (const d of ['2017-04-07','2026-04-07','2026-07-20','2026-08-01','2026-08-08','2026-08-12','2026-08-16','2026-08-20','2026-11-21']) console.log(d, JSON.stringify(night(d)));
for (const d of ['2026-08-22','2026-08-24','2026-08-26']) console.log(d, JSON.stringify(night(d)));
const d='2026-08-24';
for (const hm of ['03:10','04:00','05:00','05:50']) { const ms=Date.parse(d+'T'+hm+':00Z'); const s=E.snapshot(ms,lam,el);
 console.log(hm,'GMST h',(E.gmst(ms)*12/Math.PI).toFixed(2),'el',s.el.map((x,i)=>E.stations[i].id+':'+(x*180/Math.PI).toFixed(0)).join(' '));
 console.log('   up', s.up.map(x=>E.baselines[x.k].name+'('+Math.hypot(x.u,x.v).toExponential(2)+')').join(' ')); }

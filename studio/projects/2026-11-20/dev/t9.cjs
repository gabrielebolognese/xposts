require('./load.cjs')('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js');
const prog = PROG.build({ maxit: 32 });
const S = SIM.setup(); const D = S.D;
const M = new SIM.FaultMachine(D, S.chunks, prog);
let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
const universe = []; for (let i = D.dffStart; i < D.n; i++) { universe.push([i, 0]); universe.push([i, 1]); }
console.log('universe', universe.length);
// sanity: no faults
M.setFaults([]); let bad = 0;
for (let c = 0; c < 3000; c++) { M.evalCycle(); if (M.cmp() !== 0) bad++; M.commit(); M.cyc++; }
console.log('no-fault diffs', bad);
let det = 0, tot = 0, lat = [], t0 = Date.now(), cycles = 0;
const perMod = {};
for (let b = 0; b < 30; b++) {
  const f = []; for (let k = 0; k < 31; k++) f.push(universe[(rnd() * universe.length) | 0]);
  M.setFaults(f.map((x, i) => ({ net: x[0], sa: x[1], lane: i + 1 })));
  let dm = 0; const dc = new Int32Array(32).fill(-1);
  for (let c = 0; c < 4096; c++) { M.evalCycle(); const d = M.cmp() & -2 & ~dm; if (d) { for (let l = 1; l < 32; l++) if ((d >>> l) & 1) dc[l] = c; dm |= d; } M.commit(); M.cyc++; cycles++; if (dm === -2) break; }
  for (let l = 1; l < 32; l++) { tot++; const p = D.mods[D.mod[f[l - 1][0]]].path.split('/').slice(1, 3).join('/'); perMod[p] = perMod[p] || [0, 0]; perMod[p][1]++; if (dc[l] >= 0) { det++; lat.push(dc[l]); perMod[p][0]++; } }
}
const dt = (Date.now() - t0) / 1000;
console.log('coverage', (det / tot * 100).toFixed(1) + '%', det, '/', tot, 'mean latency', (lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(0), 'cycles/s', Math.round(cycles / dt));
for (const k of Object.keys(perMod).sort()) console.log(k.padEnd(20), perMod[k].join('/'));

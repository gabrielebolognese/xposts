require('./load.cjs')('hdl.js');
const N = HDL.buildCore(); const D = HDL.finalize(N);
const s = new Int32Array(D.n); s[1] = -1;
for (const sz of [100, 250, 500, 1000, 1600, 4000]) {
  const ch = HDL.emitChunks(D, sz);
  const fns = HDL.compileChunks(ch);
  const run = (n) => { for (let c = 0; c < n; c++) for (let k = 0; k < fns.length; k++) fns[k](s); };
  run(3000);
  const t0 = process.hrtime.bigint();
  run(20000);
  const dt = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log('chunk', sz, 'fns', fns.length, 'Hz', Math.round(20000 / dt), 'Mgates/s', (20000 * (D.n - D.gateStart) / dt / 1e6).toFixed(0));
}

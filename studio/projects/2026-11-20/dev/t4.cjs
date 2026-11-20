require('./load.cjs')('hdl.js');
const N = HDL.buildCore(); const D = HDL.finalize(N);
const G = D.n - D.gateStart;
function bench(label, fns, call, warm = 4000, n = 20000) {
  const run = (k) => { for (let c = 0; c < k; c++) call(); };
  run(warm);
  const t0 = process.hrtime.bigint(); run(n);
  const dt = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(label.padEnd(30), 'Hz', Math.round(n / dt), 'Mgates/s', (n * G / dt / 1e6).toFixed(0));
}
for (const sz of [200, 400, 600, 800, 1200]) {
  const ch = HDL.emitChunks(D, sz);
  // closure over a fixed typed array
  const s = new Int32Array(D.n); s[1] = -1;
  const fns = ch.map((c) => new Function('s', '"use strict";return function(){' + c.src + '}')(s));
  const all = () => { for (let k = 0; k < fns.length; k++) fns[k](); };
  bench('closure ' + sz + ' (' + fns.length + ')', fns, all);
  const fns2 = HDL.compileChunks(ch);
  const all2 = () => { for (let k = 0; k < fns2.length; k++) fns2[k](s); };
  bench('param   ' + sz + ' (' + fns2.length + ')', fns2, all2);
}

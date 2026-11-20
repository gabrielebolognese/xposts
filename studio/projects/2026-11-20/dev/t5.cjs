require('./load.cjs')('hdl.js');
const N = HDL.buildCore(); const D = HDL.finalize(N);
const G = D.n - D.gateStart;
function bench(label, call, warm, n = 20000) {
  for (let c = 0; c < warm; c++) call();
  const t0 = process.hrtime.bigint(); for (let c = 0; c < n; c++) call();
  const dt = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(label.padEnd(34), 'Hz', Math.round(n / dt), 'Mgates/s', (n * G / dt / 1e6).toFixed(0));
}
const mode = process.argv[2], sz = +process.argv[3], warm = +process.argv[4];
const ch = HDL.emitChunks(D, sz);
const s = new Int32Array(D.n); s[1] = -1;
let fns;
if (mode === 'closure') fns = ch.map((c) => new Function('s', '"use strict";return function(){' + c.src + '}')(s));
if (mode === 'local') fns = ch.map((c) => new Function('S', '"use strict";return function(){const s=S;' + c.src + '}')(s));
if (mode === 'param') fns = ch.map((c) => new Function('s', '"use strict";' + c.src));
const all = mode === 'param' ? () => { for (let k = 0; k < fns.length; k++) fns[k](s); } : () => { for (let k = 0; k < fns.length; k++) fns[k](); };
bench(mode + ' ' + sz + ' (' + fns.length + ') warm ' + warm, all, warm);
bench(mode + ' ' + sz + ' again', all, 0);

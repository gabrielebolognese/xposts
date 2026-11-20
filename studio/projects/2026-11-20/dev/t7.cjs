require('./load.cjs')('hdl.js');
const N = HDL.buildCore(); const D = HDL.finalize(N);
const G = D.n - D.gateStart, T = HDL.T;
function expr(g) {
  const a = D.inA[g], b = D.inB[g], c = D.inS[g];
  switch (D.type[g]) {
    case T.NOT: return `~s[${a}]`; case T.AND: return `s[${a}]&s[${b}]`; case T.OR: return `s[${a}]|s[${b}]`;
    case T.NAND: return `~(s[${a}]&s[${b}])`; case T.NOR: return `~(s[${a}]|s[${b}])`; case T.XOR: return `s[${a}]^s[${b}]`;
    case T.XNOR: return `~(s[${a}]^s[${b}])`; case T.MUX: return `s[${a}]^((s[${a}]^s[${b}])&s[${c}])`;
  }
}
function emit(sz, variant) {
  const out = [];
  for (let L = 1; L <= D.maxLevel; L++) {
    const s0 = D.levelStart[L], s1 = D.levelStart[L + 1];
    for (let i = s0; i < s1; i += sz) {
      const e = Math.min(s1, i + sz), lines = [];
      for (let g = i; g < e; g++) {
        if (variant === 'A') lines.push(`v=${expr(g)};d=v^s[${g}];s[${g}]=v;h[${g}]-=d;c-=d;`);
        else if (variant === 'B') lines.push(`v=${expr(g)};d=v^s[${g}];s[${g}]=v;h[${g}]-=d;`);
      }
      out.push(`"use strict";return function(){let v,d,c=0;${lines.join('')}return c;}`);
    }
  }
  return out;
}
const s = new Int32Array(D.n), h = new Int32Array(D.n); s[1] = -1;
// make values change: random inputs on DFF range every cycle
let seed = 1; const rnd = () => (seed = (seed * 1103515245 + 12345) | 0);
for (const v of ['A', 'B']) for (const sz of [120, 160, 200, 250]) {
  const fns = emit(sz, v).map((src) => new Function('s', 'h', src)(s, h));
  const run = (n) => { let t = 0; for (let c = 0; c < n; c++) { for (let i = D.dffStart; i < D.gateStart; i += 7) s[i] = -(rnd() & 1); for (let k = 0; k < fns.length; k++) t += fns[k](); } return t; };
  run(25000);
  const t0 = process.hrtime.bigint(); const tt = run(20000); const dt = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(v, sz, 'fns', fns.length, 'us/cycle', (dt / 20000 * 1e6).toFixed(2), 'tog/cyc', (tt / 20000).toFixed(0));
}

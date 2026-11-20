require('./load.cjs')('hdl.js');
const N = HDL.buildCore(); const D = HDL.finalize(N);
const st = {};
for (let i = D.dffStart; i < D.n; i++) {
  const p = D.mods[D.mod[i]].path.replace('core/', '');
  const e = st[p] = st[p] || { n: 0, ctl: 0, bits: new Map(), maxBit: -1, lv: [1e9, 0] };
  e.n++;
  const b = D.bit[i];
  if (b < 0) e.ctl++; else { e.bits.set(b, (e.bits.get(b) || 0) + 1); e.maxBit = Math.max(e.maxBit, b); }
  e.lv[0] = Math.min(e.lv[0], D.level[i]); e.lv[1] = Math.max(e.lv[1], D.level[i]);
}
for (const k of Object.keys(st)) { const e = st[k]; console.log(k.padEnd(18), 'n', String(e.n).padStart(5), 'ctl', String(e.ctl).padStart(4), 'maxBit', String(e.maxBit).padStart(3), 'maxPerBit', String(Math.max(0, ...e.bits.values())).padStart(4), 'lv', e.lv.join('-')); }

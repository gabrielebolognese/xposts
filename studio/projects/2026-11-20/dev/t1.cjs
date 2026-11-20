require('./load.cjs')('hdl.js');
const t0 = Date.now();
const N = HDL.buildCore();
const t1 = Date.now();
const D = HDL.finalize(N);
const t2 = Date.now();
console.log('raw nets', N.t.length, 'build ms', t1 - t0, 'finalize ms', t2 - t1);
console.log('nets', D.n, 'inputs', D.nIn, 'dff', D.nDff, 'gates', D.n - D.gateStart, 'maxLevel', D.maxLevel);
const cnt = {};
for (let i = D.gateStart; i < D.n; i++) cnt[D.names[D.type[i]]] = (cnt[D.names[D.type[i]]] || 0) + 1;
console.log(cnt);
// per module
const pm = {};
for (let i = D.dffStart; i < D.n; i++) { const p = D.mods[D.mod[i]].path; pm[p] = pm[p] || [0, 0]; pm[p][D.type[i] === 3 ? 1 : 0]++; }
for (const k of Object.keys(pm).sort()) console.log(k.padEnd(28), pm[k][0], pm[k][1]);
console.log('crit levels', D.critical.levels, 'dadda stages', D.daddaStages, 'fa', D.fas, 'ha', D.has);
console.log(D.critical.path.map((x) => D.mods[D.mod[x]].path.replace('core/', '') + ':' + D.names[D.type[x]]).join(' > '));
const ch = HDL.emitChunks(D);
console.log('chunks', ch.length, 'src bytes', ch.reduce((s, c) => s + c.src.length, 0));

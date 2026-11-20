require('./load.cjs')('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js');
const prog = PROG.build({ maxit: 32 });
const S = SIM.setup();
const M = new SIM.Machine(S.D, S.chunks, prog);
const D = S.D;
function time(label, n, fn) { const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) fn(); const dt = Number(process.hrtime.bigint() - t0) / 1e3 / n; console.log(label.padEnd(20), dt.toFixed(2), 'us/cycle'); }
for (let i = 0; i < 30000; i++) { M.evalCycle(); M.commit(); M.cyc++; }
time('evalCycle+commit', 50000, () => { M.evalCycle(); M.commit(); M.cyc++; });
time('edgeAndInputs', 50000, () => { M.edgeAndInputs(); M.cyc++; });
time('chunks only', 50000, () => { const f = M.fns; for (let k = 0; k < f.length; k++) f[k](); });
const g = new Golden(prog.rom, prog.ram);
time('golden step', 200000, () => g.step());
const prev = new Int32Array(D.n), heat = new Uint16Array(D.n), heat32 = new Int32Array(D.n);
function togA(s) { let t = 0; for (let i = D.dffStart, n = D.n; i < n; i++) { const v = s[i], d = (v ^ prev[i]) & 1; prev[i] = v; heat[i] += d; t += d; } return t; }
function togB(s) { let t = 0; for (let i = D.dffStart, n = D.n; i < n; i++) { const d = s[i] ^ prev[i]; heat32[i] -= d; t -= d; } prev.set(s); return t; }
const st = D.dffStart, nn = D.n;
const togC = new Function('s', 'p', 'h', `"use strict";return function(){let t=0;for(let i=${st};i<${nn};i++){const v=s[i],d=v^p[i];p[i]=v;h[i]-=d;t-=d;}return t;}`)(M.s, prev, heat32);
for (let i = 0; i < 20000; i++) { M.evalCycle(); M.cyc++; togA(M.s); togB(M.s); togC(); }
time('togA', 30000, () => { M.evalCycle(); M.cyc++; togA(M.s); });
time('togB', 30000, () => { M.evalCycle(); M.cyc++; togB(M.s); });
time('togC', 30000, () => { M.evalCycle(); M.cyc++; togC(); });

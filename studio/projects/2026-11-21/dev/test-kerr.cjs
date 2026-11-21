const fs=require('fs'); (0,eval)(fs.readFileSync(__dirname+'/../kerr.js','utf8')); const K=globalThis.Kerr;
const a = 0.94, inc = 72 * Math.PI / 180;
const sc = K.scale(4.297e6, 8.277);
console.log('rg', sc.rg, 'uas/M', sc.uasPerM, 'tg', sc.tg, 'LEdd', sc.LEdd);
console.log('r+', K.rplus(a), 'isco', K.risco(a), 'rph+', K.rphPro(a), 'rph-', K.rphRet(a), 'eff', K.efficiency(a));
console.log('isco a=0', K.risco(0), 'a=0.998', K.risco(0.998), 'eff0', K.efficiency(0));
const T = 2 * Math.PI * (Math.pow(7, 1.5) + a) * sc.tg / 60; console.log('spot period min', T);
const F = K.pageThorne(a); let fm = 0, rm = 0; for (let r = K.risco(a); r < 30; r += 0.01) { const f = F(r); if (f > fm) { fm = f; rm = r; } }
console.log('Fmax', fm, 'at', rm, 'F(7)', F(7));
const mdotc2 = 0.01 * sc.LEdd / K.efficiency(a); const Fp = fm * mdotc2 / sc.rg ** 2; console.log('Tmax K', Math.pow(Fp / 5.670374e-8, 0.25));
// analytic curve
const P = K.critCurve(a, inc, 720); const ar = K.polyArea(P);
console.log('analytic area-eq diam M', 2 * Math.sqrt(ar.A / Math.PI), 'uas', 2 * Math.sqrt(ar.A / Math.PI) * sc.uasPerM, 'centroid', ar.cx, ar.cy);
let amin = 1e9, amax = -1e9; for (const p of P) { amin = Math.min(amin, p[0]); amax = Math.max(amax, p[0]); }
const cx = 0.5 * (amin + amax); console.log('alpha range', amin, amax, 'cx', cx);
// bisection in a few directions
const opt = { h: 0.06, maxSteps: 20000, r0: 1000, kc: 1 };
let t0 = Date.now(), totSteps = 0, errs = [];
for (let k = 0; k < 12; k++) {
  const psi = 2 * Math.PI * k / 12; const ra = K.polyRadius(P, cx, 0, psi);
  let lo = ra * 0.85, hi = ra * 1.15;
  const fate = (rho) => { const rr = K.trace(a, inc, cx + rho * Math.cos(psi), rho * Math.sin(psi), opt); totSteps += rr.steps; return rr.fate; };
  if (fate(lo) !== 3) console.log('lo not captured', k); if (fate(hi) !== 2) console.log('hi not escaped', k, fate(hi));
  while (hi - lo > 1e-6) { const m = 0.5 * (lo + hi); if (fate(m) === 3) lo = m; else hi = m; }
  errs.push((0.5 * (lo + hi) - ra) / ra);
}
console.log('bisection ms', Date.now() - t0, 'steps', totSteps, 'ns/step', (Date.now() - t0) * 1e6 / totSteps);
console.log('rel errs', errs.map(e => e.toExponential(2)).join(' '));

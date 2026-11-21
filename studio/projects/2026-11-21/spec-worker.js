// Spectrum worker: relativistic multi-colour disk spectrum L_nu = 4 pi r_g^2 sum_pix dA g^3 B_nu(nu / g, T(r)) from the
// wide-field geodesic samples, the Newtonian (g = 1, flat) disk with the same T(r), the relativistic Fe K-alpha line
// (E = 6.40 g keV, weight g^4 r^-q) with bilinear sub-pixel sampling, and the hot spot's spectral contribution.
importScripts('kerr.js');
const K = self.Kerr;
const NF = 120, NU0 = 12.5, NU1 = 18.8; // log10 frequency grid (Hz)
const nus = Float64Array.from({ length: NF }, (_, i) => 10 ** (NU0 + ((NU1 - NU0) * i) / (NF - 1)));

let J = null;

function Tof(F, r, fluxUnit) {
  const f = F(r);
  return f > 0 ? Math.pow((f * fluxUnit) / K.const.SIGMA, 0.25) : 0;
}

function start(m) {
  const F = K.pageThorne(m.a);
  const n = m.n, d0 = m.d0, d1 = m.d1;
  const pix = [];
  for (let i = 0; i < n * n; i++) {
    const r = d0[i * 4];
    if (r > 0) pix.push(i);
  }
  J = { m, F, pix, at: 0, rel: new Float64Array(NF), newt: new Float64Array(NF), done: false };
  // Newtonian ring sum (cheap): area cos(i) 2 pi r dr seen face-on projected
  const rin = K.risco(m.a), NR = 400;
  for (let k = 0; k < NR; k++) {
    const ra = rin + ((m.rout - rin) * k) / NR, rb = rin + ((m.rout - rin) * (k + 1)) / NR, rc = 0.5 * (ra + rb);
    const T = Tof(F, rc, m.fluxUnit);
    if (T <= 0) continue;
    const dA = Math.cos(m.inc) * Math.PI * (rb * rb - ra * ra);
    for (let j = 0; j < NF; j++) J.newt[j] += dA * K.planck(nus[j], T);
  }
}

function step(budget) {
  const m = J.m, n = m.n, d0 = m.d0;
  const dA = (2 * m.half / n) ** 2; // M^2 per pixel
  let used = 0;
  while (J.at < J.pix.length && used < budget) {
    const i = J.pix[J.at++];
    const r = d0[i * 4], g = d0[i * 4 + 1];
    const T = Tof(J.F, r, m.fluxUnit);
    if (T > 0) {
      const g3 = g * g * g;
      for (let j = 0; j < NF; j++) J.rel[j] += dA * g3 * K.planck(nus[j] / g, T);
    }
    used += NF;
  }
  if (J.at >= J.pix.length && !J.done) {
    J.done = true;
    return finish();
  }
  return null;
}

function finish() {
  const m = J.m, rg2 = m.rg * m.rg, fac = 4 * Math.PI * rg2;
  const rel = J.rel.map((x) => x * fac), newt = J.newt.map((x) => x * fac);
  // integrated luminosity, peak
  let Lr = 0, Ln = 0;
  for (let j = 1; j < NF; j++) {
    Lr += 0.5 * (rel[j] + rel[j - 1]) * (nus[j] - nus[j - 1]);
    Ln += 0.5 * (newt[j] + newt[j - 1]) * (nus[j] - nus[j - 1]);
  }
  let jp = 0, jn = 0;
  for (let j = 0; j < NF; j++) {
    if (nus[j] * rel[j] > nus[jp] * rel[jp]) jp = j;
    if (nus[j] * newt[j] > nus[jn] * newt[jn]) jn = j;
  }
  // Fe K-alpha line: bilinear sub-pixel sampling inside quads of four disk hits of the same order
  const n = m.n, d0 = m.d0, bins = new Float64Array(100), S = 6;
  const wide = new Float64Array(180), W0 = 0.5, W1 = 9.5; // the whole line, for the red-wing extent
  const E0 = 3, E1 = 9;
  let gmax = 0, gmin = 9;
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const i00 = (y * n + x) * 4, i10 = i00 + 4, i01 = i00 + n * 4, i11 = i01 + 4;
    const r00 = d0[i00], r10 = d0[i10], r01 = d0[i01], r11 = d0[i11];
    if (r00 <= 0 || r10 <= 0 || r01 <= 0 || r11 <= 0) {
      if (r00 > 0) { addLine(bins, d0[i00 + 1], r00, m.q, S * S, E0, E1); addLine(wide, d0[i00 + 1], r00, m.q, S * S, W0, W1); }
      continue;
    }
    const n00 = d0[i00 + 2];
    if (d0[i10 + 2] !== n00 || d0[i01 + 2] !== n00 || d0[i11 + 2] !== n00 || Math.max(r00, r10, r01, r11) - Math.min(r00, r10, r01, r11) > 2) {
      addLine(bins, d0[i00 + 1], r00, m.q, S * S, E0, E1); addLine(wide, d0[i00 + 1], r00, m.q, S * S, W0, W1);
      continue;
    }
    const g00 = d0[i00 + 1], g10 = d0[i10 + 1], g01 = d0[i01 + 1], g11 = d0[i11 + 1];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = (sx + 0.5) / S, fy = (sy + 0.5) / S;
      const g = (g00 * (1 - fx) + g10 * fx) * (1 - fy) + (g01 * (1 - fx) + g11 * fx) * fy;
      const r = (r00 * (1 - fx) + r10 * fx) * (1 - fy) + (r01 * (1 - fx) + r11 * fx) * fy;
      addLine(bins, g, r, m.q, 1, E0, E1); addLine(wide, g, r, m.q, 1, W0, W1);
    }
  }
  for (const i of J.pix) { const g = d0[i * 4 + 1]; gmax = Math.max(gmax, g); gmin = Math.min(gmin, g); }
  // detector-like resolution: Gaussian, FWHM 140 eV
  const sm = new Float64Array(100), sg = 0.06 / ((E1 - E0) / 100);
  for (let b = 0; b < 100; b++) {
    let s = 0, ws = 0;
    for (let k = -8; k <= 8; k++) { const j = b + k; if (j < 0 || j >= 100) continue; const w = Math.exp(-(k * k) / (2 * sg * sg)); s += w * bins[j]; ws += w; }
    sm[b] = s / ws;
  }
  // red wing: lowest energy where the smoothed full profile reaches 5% of its peak
  const ws = new Float64Array(180);
  for (let b = 0; b < 180; b++) { let a = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = b + k; if (j >= 0 && j < 180) { a += wide[j]; c++; } } ws[b] = a / c; }
  let wmax = 0; for (const v of ws) wmax = Math.max(wmax, v);
  let redWing = W0;
  for (let b = 0; b < 180; b++) if (ws[b] >= 0.05 * wmax) { redWing = W0 + (b + 0.5) * ((W1 - W0) / 180); break; }
  let bmax = 0;
  for (let b = 0; b < 100; b++) bmax = Math.max(bmax, sm[b]);
  const line = Array.from(sm, (x) => x / bmax);
  return { nus: Array.from(nus), rel: Array.from(rel), newt: Array.from(newt), Lrel: Lr, Lnewt: Ln, nuPeak: nus[jp], nuPeakN: nus[jn],
    line, lineE0: E0, lineE1: E1, redWing, gmaxWide: gmax, gminWide: gmin, nPix: J.pix.length, id: m.id };
}

function addLine(bins, g, r, q, w, E0, E1) {
  const E = 6.4 * g, nb = bins.length;
  if (E < E0 || E >= E1) return;
  const b = Math.floor(((E - E0) / (E1 - E0)) * nb);
  bins[b] += w * g ** 4 * Math.pow(r, -q);
}

// hot-spot spectrum from the dynamic 128^2 readback: texels carrying spot light, B_nu shape at the spot temperature
function spot(m) {
  const out = new Float64Array(NF);
  const fac = 4 * Math.PI * m.rg * m.rg * m.dA;
  const sigT4 = K.const.SIGMA * m.Ts ** 4;
  for (let k = 0; k < m.Is.length; k++) {
    const I = m.Is[k], g = m.gs[k];
    if (I <= 0 || g <= 0) continue;
    // observed bolometric I = g^4 x (emitted sigma T^4 / pi) x filling
    const fill = (I * m.fluxUnit) / (g ** 4 * sigT4 / Math.PI) / Math.PI;
    const g3 = g * g * g;
    for (let j = 0; j < NF; j++) out[j] += fac * fill * g3 * K.planck(nus[j] / g, m.Ts);
  }
  return Array.from(out);
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'start') {
    start(m);
    self.postMessage({ cmd: 'start', id: m.id, nPix: J.pix.length });
  } else if (m.cmd === 'run') {
    const r = J ? step(m.budget) : null;
    self.postMessage({ cmd: 'run', result: r, at: J ? J.at : 0, total: J ? J.pix.length : 0 });
  } else if (m.cmd === 'spot') {
    self.postMessage({ cmd: 'spot', spec: spot(m), t: m.t });
  }
};

// Reentry: restitution lab worker. A 1D cable of 400 cells with the same Aliev-Panfilov equations and parameters as
// the tissue (D = 1, dx = 0.3, dt = 0.02, endocardial recovery factor h = 1) runs a continuous S1-S2 protocol: 10 S1
// beats at the basic cycle length (BCL), then one S2, swept from the BCL down to conduction block. APD (u = 0.5
// upstroke to u < 0.1) and DI are measured at cell 24. The S1 train is simulated once per BCL and checkpointed right
// after the 10th stimulus; every S2 trial restarts from that checkpoint. Work arrives as a fixed step budget per frame.
const P = { k: 8, a: 0.15, e0: 0.002, m1: 0.2, m2: 0.3, dt: 0.02, dx: 0.3, D: 1, h: 1, TMS: 12.9 };
const NC = 400, SITE = 24, STIM = 6;
const dtms = P.dt * P.TMS;
let u = new Float64Array(NC), v = new Float64Array(NC), un = new Float64Array(NC);
const BCLS = [600, 500, 400, 350];
let bi = 0, sweep = 0, offset = 0;
let phase = 'train';
let t = 0, ck = null, s2 = 600, s2t = 0, totalSteps = 0;
let lastU = 0, s1Up = null, s1Rep = null, s2Up = null, s2Rep = null;
const pts600 = [];

function stepCable(I) {
  const inv = P.D / (P.dx * P.dx);
  for (let i = 0; i < NC; i++) {
    const ui = u[i], vi = v[i];
    const l = (i > 0 ? u[i - 1] - ui : 0) + (i < NC - 1 ? u[i + 1] - ui : 0);
    const du = l * inv - P.k * ui * (ui - P.a) * (ui - 1) - ui * vi + (i < STIM ? I : 0);
    const ep = P.h * (P.e0 + (P.m1 * vi) / (ui + P.m2));
    v[i] = vi + P.dt * ep * (-vi - P.k * ui * (ui - P.a - 1));
    un[i] = ui + P.dt * du;
  }
  const tmp = u;
  u = un;
  un = tmp;
  t += dtms;
  totalSteps++;
}
function startTrial() {
  u.set(ck.u);
  v.set(ck.v);
  t = ck.t;
  lastU = u[SITE];
  s2t = 9 * BCLS[bi] + s2;
  s1Up = s1Rep = s2Up = s2Rep = null;
}
function fitExp(pts) {
  // APD = A - B exp(-DI / tau): grid search on tau, linear least squares for A and B
  if (pts.length < 5) return null;
  let best = null;
  for (let tau = 10; tau <= 400; tau += 2) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = pts.length;
    for (const p of pts) {
      const x = Math.exp(-p.di / tau);
      sx += x; sy += p.apd; sxx += x * x; sxy += x * p.apd;
    }
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) continue;
    const b = (n * sxy - sx * sy) / den;
    const A = (sy - b * sx) / n;
    let err = 0;
    for (const p of pts) {
      const r = p.apd - (A + b * Math.exp(-p.di / tau));
      err += r * r;
    }
    if (!best || err < best.err) best = { A, B: -b, tau, err, n };
  }
  if (best) best.rms = Math.sqrt(best.err / best.n);
  return best;
}

onmessage = (e) => {
  const budget = e.data.steps;
  const out = [];
  for (let s = 0; s < budget; s++) {
    const bcl = BCLS[bi];
    if (phase === 'train') {
      const beat = Math.min(9, Math.floor(t / bcl));
      const tb = beat * bcl;
      stepCable(t >= tb && t < tb + P.TMS ? 2.5 : 0);
      if (t >= 9 * bcl + P.TMS + dtms) {
        ck = { u: u.slice(), v: v.slice(), t };
        phase = 's2';
        s2 = bcl - offset;
        startTrial();
      }
      continue;
    }
    stepCable(t >= s2t && t < s2t + P.TMS ? 3.0 : 0);
    const us = u[SITE];
    if (lastU < 0.5 && us >= 0.5) {
      if (s1Up === null) s1Up = t;
      else if (s1Rep !== null && s2Up === null) s2Up = t;
    }
    if (lastU >= 0.1 && us < 0.1) {
      if (s1Up !== null && s1Rep === null) s1Rep = t;
      else if (s2Up !== null && s2Rep === null) s2Rep = t;
    }
    lastU = us;
    if (s2Rep !== null) {
      const pt = { bcl, s2, di: s2Up - s1Rep, apd: s2Rep - s2Up, sweep };
      out.push(pt);
      if (bcl === 600) pts600.push(pt);
      s2 -= s2 > bcl - 150 ? 25 : s2 > 330 ? 10 : 4;
      startTrial();
    } else if (t > s2t + 700) {
      out.push({ bcl, s2, block: true, sweep });
      bi++;
      if (bi >= BCLS.length) {
        bi = 0;
        sweep++;
        offset = (sweep * 7) % 20;
      }
      u.fill(0);
      v.fill(0);
      t = 0;
      phase = 'train';
    }
  }
  const fit = out.some((p) => p.bcl === 600 && !p.block) ? fitExp(pts600) : null;
  postMessage({ points: out, bcl: BCLS[bi], s2, sweep, steps: totalSteps, fit, phase });
};

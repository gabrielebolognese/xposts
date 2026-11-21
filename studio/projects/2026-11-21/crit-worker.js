// Critical-curve worker (fp64): bisects the boundary between captured and escaped rays along polar directions of
// the image plane, with the same Mino-time RK4 integrator as the GPU (no disk). Work is metered in RK4 steps per
// request, so the page decides how much runs per frame.
importScripts('kerr.js');
const K = self.Kerr;

// capture / escape classification, inlined integrator (same step rule as the shader)
function classify(a, inc, alpha, beta, h, maxS, out) {
  const st0 = Math.sin(inc), ct0 = Math.cos(inc);
  const lam = -alpha * st0, eta = (alpha * alpha - a * a) * ct0 * ct0 + beta * beta;
  const a2 = a * a, Q = eta + (lam - a) * (lam - a), L2 = lam * lam, al = Math.abs(lam);
  const rh = (1 + Math.sqrt(Math.max(0, 1 - a2))) * (1 + 1e-3), r0 = 1000, rEsc = 1.05 * r0;
  let r = r0, th = inc;
  let P = r * r + a2 - a * lam;
  let vr = -Math.sqrt(Math.max(0, P * P - (r * r - 2 * r + a2) * Q));
  let vth = -beta;
  let steps = 0;
  while (steps < maxS) {
    const s0 = Math.sin(th), c0 = Math.cos(th);
    const s0a = Math.max(Math.abs(s0), 1e-6);
    const curv = Math.sqrt(Math.abs(L2 * c0 / (s0a * s0a * s0a))) + 0.5 * al * c0 * c0 / (s0a * s0a) + 0.3 * Math.abs(vth) * Math.max(0, 1 / s0a - 5);
    const ds = h * Math.min(3, Math.max(1, r / 60)) / (Math.abs(vr) / r + Math.abs(vth) + curv + 1e-6);
    // stage 1
    let s = s0, c = c0, ss = Math.abs(s) < 1e-6 ? (s < 0 ? -1e-6 : 1e-6) : s;
    P = r * r + a2 - a * lam;
    const k1r = vr, k1t = vth, k1vr = 2 * r * P - (r - 1) * Q, k1vt = -a2 * ss * c + L2 * c / (ss * ss * ss);
    // stage 2
    let rr = r + 0.5 * ds * k1r, tt = th + 0.5 * ds * k1t, vv = vr + 0.5 * ds * k1vr, ww = vth + 0.5 * ds * k1vt;
    s = Math.sin(tt); c = Math.cos(tt); ss = Math.abs(s) < 1e-6 ? (s < 0 ? -1e-6 : 1e-6) : s;
    P = rr * rr + a2 - a * lam;
    const k2r = vv, k2t = ww, k2vr = 2 * rr * P - (rr - 1) * Q, k2vt = -a2 * ss * c + L2 * c / (ss * ss * ss);
    // stage 3
    rr = r + 0.5 * ds * k2r; tt = th + 0.5 * ds * k2t; vv = vr + 0.5 * ds * k2vr; ww = vth + 0.5 * ds * k2vt;
    s = Math.sin(tt); c = Math.cos(tt); ss = Math.abs(s) < 1e-6 ? (s < 0 ? -1e-6 : 1e-6) : s;
    P = rr * rr + a2 - a * lam;
    const k3r = vv, k3t = ww, k3vr = 2 * rr * P - (rr - 1) * Q, k3vt = -a2 * ss * c + L2 * c / (ss * ss * ss);
    // stage 4
    rr = r + ds * k3r; tt = th + ds * k3t; vv = vr + ds * k3vr; ww = vth + ds * k3vt;
    s = Math.sin(tt); c = Math.cos(tt); ss = Math.abs(s) < 1e-6 ? (s < 0 ? -1e-6 : 1e-6) : s;
    P = rr * rr + a2 - a * lam;
    const k4r = vv, k4t = ww, k4vr = 2 * rr * P - (rr - 1) * Q, k4vt = -a2 * ss * c + L2 * c / (ss * ss * ss);
    const w = ds / 6;
    r += w * (k1r + 2 * k2r + 2 * k3r + k4r);
    th += w * (k1t + 2 * k2t + 2 * k3t + k4t);
    vr += w * (k1vr + 2 * k2vr + 2 * k3vr + k4vr);
    vth += w * (k1vt + 2 * k2vt + 2 * k3vt + k4vt);
    steps++;
    P = r * r + a2 - a * lam;
    const Rn = P * P - (r * r - 2 * r + a2) * Q;
    if (Rn > 0.1 * P * P) vr = (vr < 0 ? -1 : 1) * Math.sqrt(Rn);
    if (r < rh) { out.steps = steps; return 3; }
    if (r > rEsc && vr > 0) { out.steps = steps; return 2; }
  }
  out.steps = steps;
  return 0;
}

let job = null;
const tmp = { steps: 0 };

function setJob(j) {
  const crit = K.critCurve(j.a, j.inc, 1440);
  job = { ...j, queue: j.dirs.slice(), cur: null, results: [] };
  job.anaR = {};
  for (const k of j.dirs) job.anaR[k] = K.polyRadius(crit, j.cx, j.cy, (2 * Math.PI * k) / j.N);
}

function nextDir() {
  const k = job.queue.shift();
  if (k === undefined) return null;
  const ra = job.anaR[k];
  return { k, psi: (2 * Math.PI * k) / job.N, lo: 0.9 * ra, hi: 1.1 * ra, phase: 0, iters: 0, rays: 0 };
}

function run(budget) {
  let used = 0, rays = 0;
  const done = [];
  while (job && used < budget) {
    if (!job.cur) {
      job.cur = nextDir();
      if (!job.cur) break;
    }
    const d = job.cur;
    const rho = d.phase === 0 ? d.lo : d.phase === 1 ? d.hi : 0.5 * (d.lo + d.hi);
    const f = classify(job.a, job.inc, job.cx + rho * Math.cos(d.psi), job.cy + rho * Math.sin(d.psi), job.h, job.maxSteps, tmp);
    used += tmp.steps; rays++; d.rays++;
    const captured = f === 3 || f === 0;
    if (d.phase === 0) {
      if (captured) d.phase = 1; else d.lo *= 0.9;
    } else if (d.phase === 1) {
      if (!captured) d.phase = 2; else d.hi *= 1.1;
    } else {
      if (captured) d.lo = rho; else d.hi = rho;
      d.iters++;
      if (d.hi - d.lo < 1e-6) {
        const r = 0.5 * (d.lo + d.hi);
        done.push({ k: d.k, rho: r, ana: job.anaR[d.k], iters: d.iters, rays: d.rays });
        job.cur = null;
      }
    }
  }
  const finished = !!job && !job.cur && job.queue.length === 0;
  return { id: job ? job.id : null, done, steps: used, rays, finished };
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'job') {
    setJob(m.job);
    self.postMessage({ cmd: 'job', id: m.job.id });
  } else if (m.cmd === 'run') {
    const r = run(m.budget);
    if (r.finished) job = null;
    self.postMessage({ cmd: 'run', ...r });
  } else if (m.cmd === 'probe') {
    const out = m.pts.map(([al, be]) => {
      const r = K.trace(m.a, m.inc, al, be, { h: m.h, maxSteps: m.maxSteps, r0: 1000, disk: true, rIn: m.rin, rOut: m.rout });
      return { fate: r.fate, r: r.r, phi: r.phi, t: r.t, n: r.n, steps: r.steps, res: r.res };
    });
    self.postMessage({ cmd: 'probe', out });
  }
};

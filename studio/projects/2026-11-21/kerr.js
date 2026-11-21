// Kerr physics shared by the page and the workers (fp64). Units G = c = M = 1.
(function (G) {
  const K = {};
  const MSUN = 1.98847e30, GN = 6.6743e-11, C = 299792458, PC = 3.0856775814913673e16, SIGMA = 5.670374419e-8;
  const KB = 1.380649e-23, HP = 6.62607015e-34;
  K.const = { MSUN, GN, C, PC, SIGMA, KB, HP, UAS: Math.PI / 180 / 3600e6 };

  // physical scale of one M
  K.scale = (Msun, Dkpc) => {
    const M = Msun * MSUN, rg = GN * M / (C * C), D = Dkpc * 1e3 * PC;
    return { rg, tg: rg / C, uasPerM: rg / D / K.const.UAS, D, M, LEdd: 1.26e31 * Msun };
  };

  K.rplus = (a) => 1 + Math.sqrt(Math.max(0, 1 - a * a));
  K.risco = (a) => {
    const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  };
  K.rphPro = (a) => 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
  K.rphRet = (a) => 2 * (1 + Math.cos((2 / 3) * Math.acos(a)));
  K.omega = (r, a) => 1 / (Math.pow(r, 1.5) + a);
  K.Eisco = (a) => {
    const r = K.risco(a), s = Math.sqrt(r);
    return (r * s - 2 * s + a) / (Math.pow(r, 0.75) * Math.sqrt(r * s - 3 * s + 2 * a));
  };
  K.efficiency = (a) => 1 - K.Eisco(a);
  K.rergo = (a, th) => 1 + Math.sqrt(Math.max(0, 1 - a * a * Math.cos(th) ** 2));

  // Page-Thorne flux F^(r) in units of Mdot c^2 / r_g^2
  K.pageThorne = (a) => {
    const x0 = Math.sqrt(K.risco(a));
    const ac = Math.acos(a);
    const xs = [2 * Math.cos((ac - Math.PI) / 3), 2 * Math.cos((ac + Math.PI) / 3), -2 * Math.cos(ac / 3)];
    const co = xs.map((xk, k) => {
      let p = 1;
      for (let j = 0; j < 3; j++) if (j !== k) p *= xk - xs[j];
      return (3 * (xk - a) ** 2) / (xk * p);
    });
    return (r) => {
      const x = Math.sqrt(r);
      if (x <= x0) return 0;
      let s = x - x0 - 1.5 * a * Math.log(x / x0);
      for (let k = 0; k < 3; k++) s -= co[k] * Math.log((x - xs[k]) / (x0 - xs[k]));
      return (3 / (8 * Math.PI)) * s / (x ** 4 * (x ** 3 - 3 * x + 2 * a));
    };
  };

  // redshift factors for a prograde circular emitter: full, gravitational only (ZAMO), Doppler only (flat)
  K.gFull = (r, lam, a) => {
    const s = Math.sqrt(r);
    return Math.pow(r, 0.75) * Math.sqrt(r * s - 3 * s + 2 * a) / (r * s + a - lam);
  };
  K.gGrav = (r, lam, a) => {
    const D = r * r - 2 * r + a * a, A = (r * r + a * a) ** 2 - a * a * D;
    return Math.sqrt(r * r * D / A) / (1 - (2 * a * r / A) * lam);
  };
  K.gDopp = (r, lam, a) => {
    const W = K.omega(r, a), v = r * W;
    return Math.sqrt(1 - v * v) / (1 - W * lam);
  };

  // Bardeen's analytic critical curve from spherical photon orbits: closed polygon [[alpha, beta], ...]
  K.critCurve = (a, inc, n = 720) => {
    const st = Math.sin(inc), ct = Math.cos(inc), cot = ct / st;
    const pts = [];
    if (a < 1e-5) {
      const b = Math.sqrt(27);
      for (let k = 0; k < n; k++) {
        const p = (2 * Math.PI * k) / n;
        pts.push([b * Math.cos(p), b * Math.sin(p)]);
      }
      return pts;
    }
    const lc = (r) => -(r ** 3 - 3 * r * r + a * a * r + a * a) / (a * (r - 1));
    const ec = (r) => (r ** 3 * (4 * a * a - r * (r - 3) ** 2)) / (a * a * (r - 1) ** 2);
    const b2 = (r) => { const l = lc(r); return ec(r) + a * a * ct * ct - l * l * cot * cot; };
    const r1 = K.rphPro(a), r2 = K.rphRet(a);
    // the visible arc is where beta^2 >= 0; find its ends by bisection
    const N = 4000;
    let lo = null, hi = null;
    for (let k = 0; k <= N; k++) {
      const r = r1 + ((r2 - r1) * k) / N;
      if (b2(r) >= 0) { if (lo === null) lo = k; hi = k; }
    }
    const root = (ra, rb) => { // b2(ra) < 0 <= b2(rb) or reverse
      let fa = b2(ra);
      for (let i = 0; i < 80; i++) {
        const m = 0.5 * (ra + rb), fm = b2(m);
        if ((fm >= 0) === (fa >= 0)) { ra = m; fa = fm; } else rb = m;
      }
      return b2(ra) >= 0 ? ra : rb;
    };
    const rA = lo > 0 ? root(r1 + ((r2 - r1) * (lo - 1)) / N, r1 + ((r2 - r1) * lo) / N) : r1;
    const rB = hi < N ? root(r1 + ((r2 - r1) * (hi + 1)) / N, r1 + ((r2 - r1) * hi) / N) : r2;
    const m = n >> 1, up = [], dn = [];
    for (let k = 0; k <= m; k++) {
      const u = 0.5 - 0.5 * Math.cos((Math.PI * k) / m); // dense near the ends
      const r = rA + (rB - rA) * u, l = lc(r);
      const al = -l / st, be = Math.sqrt(Math.max(0, b2(r)));
      up.push([al, be]);
      dn.push([al, -be]);
    }
    for (const p of up) pts.push(p);
    for (let k = dn.length - 2; k > 0; k--) pts.push(dn[k]);
    return pts;
  };

  // polygon helpers
  K.polyArea = (P) => {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      const c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    A *= 0.5;
    return { A: Math.abs(A), cx: cx / (6 * A), cy: cy / (6 * A) };
  };
  // radius of a closed polygon along the ray from (cx, cy) at angle psi
  K.polyRadius = (P, cx, cy, psi) => {
    const dx = Math.cos(psi), dy = Math.sin(psi);
    let best = Infinity;
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      const ex = x1 - x0, ey = y1 - y0, wx = x0 - cx, wy = y0 - cy;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue;
      const t = (wx * ey - wy * ex) / den, s = (wx * dy - wy * dx) / den;
      if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
    }
    return best;
  };

  // Null geodesic, backward from the observer, Mino time, RK4 on (r, th, vr, vth, phi, t).
  // opt: {h, maxSteps, r0, disk (bool), rIn, rOut, path (array to fill with r, th, phi), kc}
  // returns {fate: 1 disk, 2 escaped, 3 captured, 0 step limit, r, phi, t, n, steps, rmin, res, th}
  K.trace = (a, inc, alpha, beta, opt) => {
    const h = opt.h, maxS = opt.maxSteps, r0 = opt.r0 || 1000, disk = !!opt.disk;
    const rIn = opt.rIn || 0, rOut = opt.rOut || 0, path = opt.path || null, kc = opt.kc ?? 1;
    const kp = opt.kp ?? 0.5, rfar = opt.rfar ?? 60, fmax = opt.fmax ?? 3;
    const st0 = Math.sin(inc), ct0 = Math.cos(inc);
    const lam = -alpha * st0;
    const eta = (alpha * alpha - a * a) * ct0 * ct0 + beta * beta;
    const a2 = a * a, Q = eta + (lam - a) * (lam - a), L2 = lam * lam;
    const rh = K.rplus(a) * (1 + 1e-3), rEsc = 1.05 * r0;
    const Rf = (r) => { const P = r * r + a2 - a * lam; return P * P - (r * r - 2 * r + a2) * Q; };
    let r = r0, th = inc, ph = 0, t = 0;
    let vr = -Math.sqrt(Math.max(0, Rf(r0)));
    let vth = -Math.sign(beta) * Math.abs(beta); // sqrt(Theta(th0)) = |beta|; backward ray: beta > 0 heads north
    let n = 0, steps = 0, rmin = r, res = 0;
    const proj = opt.proj ?? 0.1, qmm = opt.qmm || 0;
    let mm = 0;
    // derivative scratch
    let dr, dth, dvr, dvth, dph, dt;
    const der = (r, th, vr, vth) => {
      const s = Math.sin(th), c = Math.cos(th), s2 = s * s;
      const P = r * r + a2 - a * lam, D = r * r - 2 * r + a2;
      dr = vr; dth = vth;
      dvr = 2 * r * P - (r - 1) * Q;
      dvth = -a2 * s * c + L2 * c / (s2 * s);
      dph = (a / D) * P - a + lam / s2;
      dt = ((r * r + a2) / D) * P + a * (lam - a * s2);
    };
    if (path) path.push(r, th, ph);
    while (steps < maxS) {
      // step size: geometric far away, fine near the hole, and short where the polar term curves the path
      const s0 = Math.sin(th), c0 = Math.cos(th);
      const s0a = Math.max(Math.abs(s0), 1e-6);
      const curv = kc * Math.sqrt(Math.abs(L2 * c0 / (s0a * s0a * s0a))) + kp * Math.abs(lam) * c0 * c0 / (s0a * s0a)
        + 0.3 * Math.abs(vth) * Math.max(0, 1 / s0a - 5);
      const ds = h * Math.min(fmax, Math.max(1, r / rfar)) / (Math.abs(vr) / r + Math.abs(vth) + curv + 1e-6);
      if (qmm) { // optically thin hot flow: dI = j(r) g^2 dlambda, j = r^-q, g of a ZAMO emitter, dlambda = Sigma dsigma
        const s2 = s0 * s0, c2 = c0 * c0, Sg = r * r + a2 * c2, Dl = r * r - 2 * r + a2;
        const Ab = (r * r + a2) * (r * r + a2) - a2 * Dl * s2;
        if (Dl > 0) { const gz = Math.sqrt(Sg * Dl / Ab) / (1 - (2 * a * r / Ab) * lam); mm += Math.pow(r, -qmm) * gz * gz * Sg * ds; }
      }
      der(r, th, vr, vth);
      const k1r = dr, k1t = dth, k1vr = dvr, k1vt = dvth, k1p = dph, k1T = dt;
      der(r + 0.5 * ds * k1r, th + 0.5 * ds * k1t, vr + 0.5 * ds * k1vr, vth + 0.5 * ds * k1vt);
      const k2r = dr, k2t = dth, k2vr = dvr, k2vt = dvth, k2p = dph, k2T = dt;
      der(r + 0.5 * ds * k2r, th + 0.5 * ds * k2t, vr + 0.5 * ds * k2vr, vth + 0.5 * ds * k2vt);
      const k3r = dr, k3t = dth, k3vr = dvr, k3vt = dvth, k3p = dph, k3T = dt;
      der(r + ds * k3r, th + ds * k3t, vr + ds * k3vr, vth + ds * k3vt);
      const w = ds / 6;
      const nr = r + w * (k1r + 2 * k2r + 2 * k3r + dr);
      const nth = th + w * (k1t + 2 * k2t + 2 * k3t + dth);
      const nvr = vr + w * (k1vr + 2 * k2vr + 2 * k3vr + dvr);
      const nvth = vth + w * (k1vt + 2 * k2vt + 2 * k3vt + dvth);
      const nph = ph + w * (k1p + 2 * k2p + 2 * k3p + dph);
      const nt = t + w * (k1T + 2 * k2T + 2 * k3T + dt);
      steps++;
      const c1 = Math.cos(nth);
      if (disk && (c0 > 0) !== (c1 > 0)) {
        const f = c0 / (c0 - c1);
        const rx = r + f * (nr - r);
        if (rx >= rIn && rx <= rOut) {
          let px = ph + f * (nph - ph);
          const sx = Math.sin(th + f * (nth - th));
          if (sx < 0) px += Math.PI;
          if (path) path.push(rx, Math.PI / 2 * (sx < 0 ? -1 : 1), px);
          return { fate: 1, r: rx, phi: px, t: t + f * (nt - t), n, steps, rmin: Math.min(rmin, rx), res, lam, eta, mm };
        }
        n++;
      }
      r = nr; th = nth; vr = nvr; vth = nvth; ph = nph; t = nt;
      // null constraint: measure the drift, then re-project v_r onto sqrt(R) away from radial turning points
      const Rn = Rf(r), Pn = r * r + a2 - a * lam;
      const dres = Math.abs(vr * vr - Rn) / (Rn + 1);
      if (dres > res) res = dres;
      if (Rn > proj * Pn * Pn) vr = (vr < 0 ? -1 : 1) * Math.sqrt(Rn);
      if (r < rmin) rmin = r;
      if (path) path.push(r, th, ph);
      if (r < rh) return { fate: 3, r, phi: ph, t, n, steps, rmin, res, lam, eta, th, mm };
      if (r > rEsc && vr > 0) {
        return { fate: 2, r, phi: ph, t, n, steps, rmin, res, th, lam, eta, mm };
      }
    }
    return { fate: 0, r, phi: ph, t, n, steps, rmin, res, th, lam, eta, mm };
  };

  // Planck B_nu in SI
  K.planck = (nu, T) => {
    const x = (HP * nu) / (KB * T);
    if (x > 700) return 0;
    return (2 * HP * nu ** 3) / (C * C) / (x < 1e-6 ? x : Math.expm1(x));
  };

  G.Kerr = K;
  if (typeof module !== 'undefined') module.exports = K;
})(typeof self !== 'undefined' ? self : globalThis);

// Xenon Night: the two-group diffusion core (IAEA 2D PWR benchmark mirrored to a full core). Shared by the diffusion
// worker and the node test harness. Mesh-centred finite differences, power iteration with red-black SOR inners,
// per-cell Doppler and moderator feedback, exact-exponential I-135/Xe-135.
(function (root) {
  'use strict';
  const NA = 17, CPA = 8, N = NA * CPA, NP = N + 2, H = 2.5; // 136 x 136 cells of 2.5 cm, padded with a ghost ring
  const NC = NP * NP;
  // Published quarter-core region map (ANL-7416 Supp. 2, Problem 11): row/col 0 are the half assemblies on the axes.
  // 1 fuel 1, 2 fuel 2, 3 fuel 2 + rod, 4 reflector, 0 outside.
  const QMAP = [
    [3, 2, 2, 2, 3, 2, 2, 1, 4],
    [2, 2, 2, 2, 2, 2, 2, 1, 4],
    [2, 2, 2, 2, 2, 2, 1, 1, 4],
    [2, 2, 2, 2, 2, 2, 1, 4, 4],
    [3, 2, 2, 2, 3, 1, 1, 4, 0],
    [2, 2, 2, 2, 1, 1, 4, 4, 0],
    [2, 2, 1, 1, 1, 4, 4, 0, 0],
    [1, 1, 1, 4, 4, 4, 0, 0, 0],
    [4, 4, 4, 4, 0, 0, 0, 0, 0],
  ];
  // [D1, D2, S12, Sa1, Sa2, nuSf2]
  const MAT = {
    1: [1.5, 0.4, 0.02, 0.01, 0.080, 0.135],
    2: [1.5, 0.4, 0.02, 0.01, 0.085, 0.135],
    3: [1.5, 0.4, 0.02, 0.01, 0.130, 0.135],
    4: [2.0, 0.3, 0.04, 0.0, 0.010, 0.0],
  };
  const ALPHA = 0.4692; // -D dphi/dn = 0.4692 phi on the outer boundary
  const NU = 2.43, KAPPA = 3.204e-11, HZ = 366, PRATED = 3411e6;
  const SIGX = 2.65e-18, GI = 0.0639, GX = 0.00237, LI = 2.87e-5, LX = 2.09e-5;
  const ROD_A2 = 0.130 - 0.085;
  const BORON = 6.8e-6;

  // assembly material, rods: the 9 'fuel 2 + rod' assemblies form Bank D
  const amat = new Int8Array(NA * NA);
  const rods = []; // {ac, ar, name}
  for (let ar = 0; ar < NA; ar++) {
    for (let ac = 0; ac < NA; ac++) {
      const m = QMAP[Math.abs(ar - 8)][Math.abs(ac - 8)];
      amat[ar * NA + ac] = m;
      if (m === 3) rods.push({ ac, ar });
    }
  }
  const dirName = (ac, ar) => {
    const dy = ar < 8 ? 'N' : ar > 8 ? 'S' : '';
    const dx = ac < 8 ? 'W' : ac > 8 ? 'E' : '';
    return dy + dx || 'C';
  };
  rods.forEach((r, i) => {
    r.id = i;
    r.name = dirName(r.ac, r.ar);
  });
  const rodOfAsm = new Int8Array(NA * NA).fill(-1);
  rods.forEach((r) => (rodOfAsm[r.ar * NA + r.ac] = r.id));

  // cell arrays (padded index c = (j + 1) * NP + (i + 1))
  const cmat = new Int8Array(NC), casm = new Int16Array(NC).fill(-1), crod = new Int8Array(NC).fill(-1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const c = (j + 1) * NP + i + 1;
      const a = ((j / CPA) | 0) * NA + ((i / CPA) | 0);
      cmat[c] = amat[a];
      if (amat[a]) casm[c] = a;
      crod[c] = rodOfAsm[a];
    }
  }
  const active = [], fuel = [];
  for (let c = 0; c < NC; c++) {
    if (cmat[c]) active.push(c);
    if (cmat[c] && cmat[c] !== 4) fuel.push(c);
  }
  const red = [], black = [];
  for (const c of active) {
    const j = ((c / NP) | 0) - 1, i = (c % NP) - 1;
    ((i + j) & 1 ? black : red).push(c);
  }
  // contiguous active range per row (the staircase core is convex row by row)
  const ROWLO = new Int32Array(N), ROWHI = new Int32Array(N);
  for (let j = 0; j < N; j++) {
    let lo = -1, hi = -2;
    for (let i = 0; i < N; i++) {
      if (cmat[(j + 1) * NP + i + 1]) {
        if (lo < 0) lo = i;
        hi = i;
      }
    }
    ROWLO[j] = lo < 0 ? 0 : lo;
    ROWHI[j] = hi;
  }
  const RED = Int32Array.from(red), BLACK = Int32Array.from(black), ACT = Int32Array.from(active), FUEL = Int32Array.from(fuel);
  const nFuelAsm = (() => {
    let n = 0;
    for (let a = 0; a < NA * NA; a++) if (amat[a] && amat[a] !== 4) n++;
    return n;
  })();

  function createModel() {
    const D1 = new Float64Array(NC), D2 = new Float64Array(NC), S12 = new Float64Array(NC), NSF = new Float64Array(NC);
    const A1base = new Float64Array(NC), A2base = new Float64Array(NC);
    const cx1 = new Float64Array(NC), cy1 = new Float64Array(NC), cx2 = new Float64Array(NC), cy2 = new Float64Array(NC);
    const bd1 = new Float64Array(NC), bd2 = new Float64Array(NC); // sum of couplings + boundary leakage
    const A1 = new Float64Array(NC), A2 = new Float64Array(NC); // live absorption
    const inv1 = new Float64Array(NC), inv2 = new Float64Array(NC);
    const phi1 = new Float64Array(NC), phi2 = new Float64Array(NC);
    const S = new Float64Array(NC), Sp = new Float64Array(NC), b = new Float64Array(NC);
    const X = new Float64Array(NC), I = new Float64Array(NC);
    const Tf = new Float64Array(NC);
    for (const c of ACT) {
      const m = MAT[cmat[c]];
      D1[c] = m[0];
      D2[c] = m[1];
      S12[c] = m[2];
      A1base[c] = m[3];
      A2base[c] = m[4];
      NSF[c] = m[5];
    }
    const h2 = H * H;
    const face = (Da, Db) => (2 * Da * Db) / (Da + Db) / h2;
    const edge = (D) => 1 / (H * (H / (2 * D) + 1 / ALPHA));
    for (const c of ACT) {
      for (const [n, isX] of [[c + 1, 1], [c + NP, 0]]) {
        if (cmat[n]) {
          const f1 = face(D1[c], D1[n]), f2 = face(D2[c], D2[n]);
          if (isX) {
            cx1[c] = f1;
            cx2[c] = f2;
          } else {
            cy1[c] = f1;
            cy2[c] = f2;
          }
        }
      }
    }
    for (const c of ACT) {
      let s1 = 0, s2 = 0;
      for (const n of [c + 1, c - 1, c + NP, c - NP]) {
        if (cmat[n]) {
          s1 += face(D1[c], D1[n]);
          s2 += face(D2[c], D2[n]);
        } else {
          s1 += edge(D1[c]);
          s2 += edge(D2[c]);
        }
      }
      bd1[c] = s1;
      bd2[c] = s2;
    }
    for (const c of ACT) phi1[c] = phi2[c] = 1;

    const M = {
      phi1, phi2, S, X, I, Tf, A1, A2, D1, D2, S12, NSF,
      k: 1,
      // operating state
      bench: true, // clean benchmark cross sections
      steps: 228, dropped: new Uint8Array(rods.length), ppm: 0, P: 1, B2: 0.8e-4,
      xenon: true, feedback: true, modfb: true, aD: 0, aM: 0, TmRef: 583, TfRef: 1183,
      omega: 1.6, sweeps: 3, tolK: 1e-6, tolS: 1e-5, maxOuter: 2000,
      frozenTf: false,
      Tm: 583,
      fuelScale: 1, // operating-core multiplier on nuSf2 of the fuel (the benchmark always uses the published 0.135)
    };

    // absorption without Doppler (Sa2 for every cell); Doppler is applied in feedback()
    M.rodFrac = (r) => (M.dropped[r] ? 1 : (228 - M.steps) / 228);
    M.setXS = function () {
      const fr = rods.map((r, i) => M.rodFrac(i));
      M.Tm = 565 + 18 * M.P;
      const dTm = M.Tm - M.TmRef;
      const fs = M.bench ? 1 : M.fuelScale;
      for (const c of ACT) {
        const m = cmat[c];
        if (m !== 4) NSF[c] = MAT[m][5] * fs;
        let a2 = A2base[c];
        if (!M.bench && m !== 4) {
          if (m === 3) a2 = 0.085 + fr[crod[c]] * ROD_A2;
          a2 += BORON * M.ppm;
          if (M.xenon) a2 += SIGX * X[c];
          if (M.feedback && M.modfb) a2 += M.aM * dTm;
        }
        A2[c] = a2;
        inv2[c] = 1 / (a2 + D2[c] * M.B2 + bd2[c]);
        if (M.bench || !M.feedback || m === 4) setA1(c, A1base[c]);
      }
      if (!M.bench && M.feedback) M.applyDoppler();
    };
    function setA1(c, a1) {
      A1[c] = a1;
      inv1[c] = 1 / (a1 + S12[c] + D1[c] * M.B2 + bd1[c]);
    }
    // Tf from the current source shape: q = P * S / mean(S over fuel)
    M.updateTf = function () {
      let s = 0;
      for (let n = 0; n < FUEL.length; n++) s += S[FUEL[n]];
      const mean = s / FUEL.length || 1;
      const k = 600 * M.P / mean;
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        Tf[c] = M.Tm + k * S[c];
      }
    };
    M.applyDoppler = function () {
      const srf = Math.sqrt(M.TfRef);
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        setA1(c, 0.01 * (1 + M.aD * (Math.sqrt(Tf[c]) - srf)));
      }
    };
    M.computeS = function (out) {
      let s = 0;
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        const v = NSF[c] * phi2[c];
        out[c] = v;
        s += v;
      }
      return s;
    };
    // red-black SOR sweep of one colour, row by row with stride 2. Group 1 source = ik * S (fission / k), group 2
    // source = S12 * phi1 (downscatter): both read in place, no source array.
    function sweep1(phi, cx, cy, inv, col, w, ik) {
      for (let j = 0; j < N; j++) {
        const lo = ROWLO[j], hi = ROWHI[j];
        if (hi < lo) continue;
        const base = (j + 1) * NP + 1;
        for (let i = lo + ((lo + j + col) & 1); i <= hi; i += 2) {
          const c = base + i;
          const s = ik * S[c] + cx[c] * phi[c + 1] + cx[c - 1] * phi[c - 1] + cy[c] * phi[c + NP] + cy[c - NP] * phi[c - NP];
          phi[c] += w * (s * inv[c] - phi[c]);
        }
      }
    }
    function sweep2(phi, cx, cy, inv, col, w) {
      for (let j = 0; j < N; j++) {
        const lo = ROWLO[j], hi = ROWHI[j];
        if (hi < lo) continue;
        const base = (j + 1) * NP + 1;
        for (let i = lo + ((lo + j + col) & 1); i <= hi; i += 2) {
          const c = base + i;
          const s = S12[c] * phi1[c] + cx[c] * phi[c + 1] + cx[c - 1] * phi[c - 1] + cy[c] * phi[c + NP] + cy[c - NP] * phi[c - NP];
          phi[c] += w * (s * inv[c] - phi[c]);
        }
      }
    }
    // Power iteration: fission source S = nuSf2 phi2, k <- k * sum S_new / sum S_old, red-black SOR inners
    // (M.sweeps per group per outer). Converged when |dk| < tolK and max|dS|/S < tolS. Doppler updated every outer
    // unless frozenTf. opts: {track: keep per-outer residual, k and dominance-ratio history}.
    M.solve = function (opts = {}) {
      const w = M.omega, ns = M.sweeps, maxO = opts.maxOuter || M.maxOuter;
      let sOld = M.computeS(S);
      let k = M.k;
      const hist = opts.track ? { res: [], k: [], dr: [] } : null;
      let dPrev = 0, dPrev2 = 0, dr = 0, outer = 0, res = 1, dk = 1;
      const fb = !M.bench && M.feedback && !M.frozenTf;
      for (outer = 1; outer <= maxO; outer++) {
        // group 1: fission source / k (chi1 = 1); group 2: downscatter
        const ik = 1 / k;
        for (let s = 0; s < ns; s++) {
          sweep1(phi1, cx1, cy1, inv1, 0, w, ik);
          sweep1(phi1, cx1, cy1, inv1, 1, w, ik);
        }
        for (let s = 0; s < ns; s++) {
          sweep2(phi2, cx2, cy2, inv2, 0, w);
          sweep2(phi2, cx2, cy2, inv2, 1, w);
        }
        Sp.set(S);
        const sNew = M.computeS(S);
        const kNew = k * sNew / sOld;
        // source change of this outer (normalised sources)
        let mx = 0, d2 = 0;
        const in1 = 1 / sNew, io = 1 / sOld;
        for (let n = 0; n < FUEL.length; n++) {
          const c = FUEL[n];
          const a = S[c] * in1, q = Sp[c] * io;
          const d = a - q;
          d2 += d * d;
          const r = Math.abs(d) / a;
          if (r > mx) mx = r;
        }
        const dn = Math.sqrt(d2);
        if (outer > 1 && dPrev > 0) dr = dn / dPrev; // ||S_n - S_n-1|| / ||S_n-1 - S_n-2||
        dPrev2 = dPrev;
        dPrev = dn;
        dk = Math.abs(kNew - k);
        k = kNew;
        res = mx;
        // renormalise so the source sum is unchanged
        const f = sOld / sNew;
        for (let n = 0; n < ACT.length; n++) {
          const c = ACT[n];
          phi1[c] *= f;
          phi2[c] *= f;
        }
        for (let n = 0; n < FUEL.length; n++) S[FUEL[n]] *= f;
        if (hist) {
          hist.res.push(res);
          hist.k.push(k);
          hist.dr.push(dr);
        }
        if (fb) {
          M.updateTf();
          M.applyDoppler();
        }
        if (dk < M.tolK && res < M.tolS && outer > 2) break;
      }
      M.k = k;
      return { k, outers: Math.min(outer, maxO), res, dk, dr, hist, sweeps: ns };
    };
    // flux shape snapshots for warm starts (normalised to unit source sum)
    M.shape = function () {
      const s = M.computeS(S) || 1;
      const a = new Float64Array(NC), b2 = new Float64Array(NC);
      for (let n = 0; n < ACT.length; n++) {
        const c = ACT[n];
        a[c] = phi1[c] / s;
        b2[c] = phi2[c] / s;
      }
      return { a, b: b2, k: M.k };
    };
    // set the flux to sh (scaled to the current source sum), or to sh + r (sh - prev) (time extrapolation)
    M.warm = function (sh, prev, r) {
      const s = M.computeS(S) || 1;
      for (let n = 0; n < ACT.length; n++) {
        const c = ACT[n];
        let v1 = sh.a[c], v2 = sh.b[c];
        if (prev) {
          v1 += r * (v1 - prev.a[c]);
          v2 += r * (v2 - prev.b[c]);
        }
        phi1[c] = (v1 > 0 ? v1 : 0) * s;
        phi2[c] = (v2 > 0 ? v2 : 0) * s;
      }
      M.computeS(S);
      if (!prev) M.k = sh.k;
    };
    // absolute power: P = HZ * sum kappa * Sf2 * phi2 * h^2
    M.powerRaw = function () {
      let s = 0;
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        s += NSF[c] / NU * phi2[c];
      }
      return s * KAPPA * h2 * HZ;
    };
    M.normalize = function (Pw) {
      const raw = M.powerRaw();
      if (raw <= 0) return;
      const f = Pw / raw;
      for (const c of ACT) {
        phi1[c] *= f;
        phi2[c] *= f;
      }
      M.computeS(S);
    };
    // exact I/Xe over dt seconds with phi2 held constant
    M.xenonStep = function (dt) {
      const eI = Math.exp(-LI * dt);
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        const F = NSF[c] / NU * phi2[c];
        const L = LX + SIGX * phi2[c];
        const eX = Math.exp(-L * dt);
        const Iinf = GI * F / LI;
        const I0 = I[c], X0 = X[c];
        const In = Iinf + (I0 - Iinf) * eI;
        let Xn = X0 * eX + (GX * F + LI * Iinf) / L * (1 - eX);
        const dl = L - LI;
        if (Math.abs(dl) > 1e-12) Xn += LI * (I0 - Iinf) * (eI - eX) / dl;
        else Xn += LI * (I0 - Iinf) * dt * eI;
        I[c] = In;
        X[c] = Xn;
      }
    };
    M.xenonEq = function () {
      for (let n = 0; n < FUEL.length; n++) {
        const c = FUEL[n];
        const F = NSF[c] / NU * phi2[c];
        I[c] = GI * F / LI;
        X[c] = (GI + GX) * F / (LX + SIGX * phi2[c]);
      }
    };
    // delta warm start for a paired solve: previous perturbed solution + (current shape - shape it was paired with)
    M.warmDelta = function (meas, base, cur) {
      const s = M.computeS(S) || 1;
      for (let n = 0; n < ACT.length; n++) {
        const c = ACT[n];
        const v1 = meas.a[c] + cur.a[c] - base.a[c], v2 = meas.b[c] + cur.b[c] - base.b[c];
        phi1[c] = (v1 > 0 ? v1 : 0) * s;
        phi2[c] = (v2 > 0 ? v2 : 0) * s;
      }
      M.computeS(S);
      M.k = meas.k + (cur.k - base.k);
    };
    // material snapshot for the Monte Carlo (unpadded N x N, zeros outside the core)
    M.mcMaterial = function () {
      const o = {};
      for (const k of ['D1', 'D2', 'S12', 'A1', 'A2', 'NSF']) o[k] = new Float64Array(N * N);
      const src = { D1, D2, S12, A1, A2, NSF };
      for (const c of ACT) {
        const j = ((c / NP) | 0) - 1, i = (c % NP) - 1, u = j * N + i;
        for (const k in src) o[k][u] = src[k][c];
      }
      o.B2 = M.B2;
      o.k = M.k;
      return o;
    };
    M.save = () => ({ phi1: phi1.slice(), phi2: phi2.slice(), k: M.k, Tf: Tf.slice() });
    M.restore = (s) => {
      phi1.set(s.phi1);
      phi2.set(s.phi2);
      Tf.set(s.Tf);
      M.k = s.k;
      M.computeS(S);
    };
    return M;
  }

  root.CORE = {
    NA, CPA, N, NP, H, NC, QMAP, MAT, amat, rods, rodOfAsm, cmat, casm, crod, ACT, FUEL, RED, BLACK, nFuelAsm,
    NU, KAPPA, HZ, PRATED, SIGX, GI, GX, LI, LX, BORON, ROD_A2, createModel,
  };
})(typeof self !== 'undefined' ? self : globalThis);

// Xenon Night: the plant around the core. Load-follow schedule, quasi-static rod and boron controller, I/Xe macro
// steps, paired-solve measurements (xenon worth, boron worth, Doppler, MTC, power defect), rod-step point kinetics
// (inhour root, prompt jump, backward-Euler response), core indices. Runs in the diffusion worker (and in node tests).
(function (root) {
  'use strict';
  const C = root.CORE;
  const { NA, N, NP, FUEL, rods, casm } = C;
  const BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
  const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
  const BT = BETA.reduce((a, b) => a + b, 0);
  const GEN = 2.0e-5;
  const DAY = 1440;
  const COLS = 'ABCDEFGHJKLMNPQRS';

  const pcm = (k) => (k - 1) / k * 1e5;
  const clock = (t) => {
    const d = Math.floor(t / DAY) + 1, m = Math.round(t - (d - 1) * DAY);
    const hh = Math.floor(m / 60) % 24, mm = m % 60;
    return `D${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  // inhour: rho = w L + sum b_i w / (w + l_i); dominant root by bisection
  function inhourRho(w) {
    let s = w * GEN;
    for (let i = 0; i < 6; i++) s += BETA[i] * w / (w + LAM[i]);
    return s;
  }
  function inhourRoot(rho) {
    if (Math.abs(rho) < 1e-10) return 0;
    let lo, hi;
    if (rho > 0) {
      lo = 0;
      hi = 1;
      while (inhourRho(hi) < rho) hi *= 2;
    } else {
      lo = -LAM[0] * (1 - 1e-12);
      hi = 0;
    }
    for (let i = 0; i < 200; i++) {
      const m = 0.5 * (lo + hi);
      if (inhourRho(m) > rho) hi = m;
      else lo = m;
    }
    return 0.5 * (lo + hi);
  }
  // backward Euler point kinetics after a reactivity step from equilibrium, 0..T s at dt, nOut samples
  function kineticsTrace(rho, T = 120, dt = 1e-3, nOut = 241) {
    let P = 1;
    const Cq = LAM.map((l, i) => BETA[i] / (l * GEN));
    const out = new Float32Array(nOut);
    out[0] = 1;
    const steps = Math.round(T / dt), every = steps / (nOut - 1);
    const a = LAM.map((l) => 1 / (1 + l * dt));
    // C_i' = a_i (C_i + dt b_i / L P'),  P' (1 - dt (rho - b) / L - dt sum l_i a_i dt b_i / L) = P + dt sum l_i a_i C_i
    let lhs = 1 - dt * (rho - BT) / GEN;
    for (let i = 0; i < 6; i++) lhs -= dt * LAM[i] * a[i] * dt * BETA[i] / GEN;
    for (let n = 1; n <= steps; n++) {
      let rhs = P;
      for (let i = 0; i < 6; i++) rhs += dt * LAM[i] * a[i] * Cq[i];
      P = rhs / lhs;
      for (let i = 0; i < 6; i++) Cq[i] = a[i] * (Cq[i] + dt * BETA[i] / GEN * P);
      if (n % every === 0) out[n / every] = P;
    }
    const c0 = LAM.map((l, i) => BETA[i] / (l * GEN));
    return { trace: out, cEnd: Cq.map((c, i) => c / c0[i]), pEnd: P };
  }

  function createPlant(cfg = {}) {
    const M = C.createModel();
    M.fuelScale = cfg.fuelScale || 1;
    const S = {
      M, t: 0, demand: 100, power: 100, ramp: 1.0, auto: true, ppmLimit: 2.0, target: 210,
      dropRod: rods.findIndex((r) => r.ac === 4 && r.ar === 12), dropAt: 2 * DAY + 23 * 60, dropped: false,
      dw: 8, bw: -7.7, xeWorth: 0, dc: -2.5, mtc: -15, pdef: 0, dcTarget: -2.5, mtcTarget: -15,
      bench: null, logs: [], prec: LAM.map(() => 1), kin: null, solves: 0, outersTotal: 0, lastSolve: null,
      asmPow: new Float64Array(NA * NA), quad: [0, 0, 0, 0], qptr: 1, fxy: 1, fcell: 1, tfMean: 0, tfMax: 0,
      solveMs: 0, measureIdx: 0, fast: false, k: 1, rho: 0, stepOuters: 0, stepSolves: 0, stepMs: 0,
      kNoXe: 1, dropWorth: 0, qptrBand: 0,
    };
    const shapes = {}; // warm-start caches for the paired solves
    let prevShape = null, lastShape = null, lastDt = 0;
    const log = (kind, text) => S.logs.push({ t: S.t, kind, text });

    function runSolve(track, label) {
      const t0 = Date.now();
      const r = M.solve({ track });
      const ms = Date.now() - t0;
      S.solves++;
      S.outersTotal += r.outers;
      S.stepOuters += r.outers;
      S.stepSolves++;
      S.solveMs = ms;
      r.ms = ms;
      r.label = label;
      r.t = S.t;
      if (track) S.lastSolve = r;
      return r;
    }

    // grid dispatch: 50% at 20:00, 100% at 02:00 (the first ramp-down is Day 1 20:00)
    function demandAt(t) {
      const m = ((t % DAY) + DAY) % DAY;
      if (t < 20 * 60) return 100;
      return m >= 20 * 60 || m < 2 * 60 ? 50 : 100;
    }

    // ---------- boot ----------
    S.boot = function () {
      // (1) the clean IAEA 2D benchmark: all 9 rods in, no xenon, no boron, no feedback, published constants
      M.bench = true;
      M.setXS();
      const r = runSolve(true, 'IAEA-2D');
      const d = (r.k - 1.02959) / 1.02959 * 1e5;
      S.bench = { k: r.k, outers: r.outers, ms: r.ms, dpcm: d, res: r.hist.res.slice(), kh: r.hist.k.slice(), dr: r.dr };
      log('bench', `IAEA-2D k = ${r.k.toFixed(5)}, ref 1.02959, Δ = ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pcm`);
      log('solver', `benchmark solve: ${r.outers} outers, DR ${r.dr.toFixed(3)}, ${r.ms} ms`);
      // (2) operating state. Bank D worth for the record (no feedback, no xenon)
      M.bench = false;
      M.feedback = false;
      M.xenon = false;
      M.steps = 228;
      M.setXS();
      const kOut = runSolve(false).k;
      M.steps = 0;
      M.setXS();
      const kIn = runSolve(false).k;
      S.bankWorth = (1 / kIn - 1 / kOut) * 1e5;
      log('ctrl', `Bank D worth ${S.bankWorth.toFixed(0)} pcm (0→228 st, 9 rods)`);
      // 100%, Bank D 210, equilibrium xenon, critical boron search, feedback calibration
      M.steps = S.target;
      M.feedback = true;
      M.xenon = true;
      M.P = 1;
      M.aD = 0.004;
      M.aM = 1.3e-5;
      M.ppm = 0;
      for (let it = 0; it < 12; it++) {
        M.setXS();
        const s = runSolve(false);
        M.normalize(C.PRATED * M.P);
        M.xenonEq();
        M.ppm = Math.max(0, M.ppm + pcm(s.k) / -S.bw);
        if (it === 4 || it === 8) calibrate();
        if (it === 6) measureBoron();
      }
      calibrate();
      for (let it = 0; it < 4; it++) {
        M.setXS();
        const s = runSolve(false);
        M.normalize(C.PRATED * M.P);
        M.xenonEq();
        M.ppm = Math.max(0, M.ppm + pcm(s.k) / -S.bw);
      }
      M.setXS();
      const s = runSolve(true, 'eq');
      S.k = s.k;
      S.rho = pcm(s.k);
      M.normalize(C.PRATED * M.P);
      measureBoron();
      measureXe();
      measurePD();
      measureDW();
      S.ppmEq = M.ppm;
      S.xeEq = S.xeWorth;
      log('ctrl', `critical boron ${M.ppm.toFixed(1)} ppm @100%, eq Xe ${S.xeWorth.toFixed(0)} pcm`);
      log('fb', `Doppler ${S.dc.toFixed(2)} pcm/K, aD ${M.aD.toExponential(2)}`);
      log('fb', `MTC ${S.mtc.toFixed(1)} pcm/K, aM ${M.aM.toExponential(2)}`);
      log('fb', `power defect 0→100% ${S.pdef.toFixed(0)} pcm`);
      log('meas', `boron worth ${S.bw.toFixed(2)} pcm/ppm`);
      S.prec = LAM.map(() => 1);
      indices();
      lastShape = M.shape();
      prevShape = null;
    };

    // aD so the Doppler defect / mean fuel temperature rise = dcTarget; aM so the MTC = mtcTarget
    function calibrate() {
      for (let it = 0; it < 2; it++) {
        const dc = measureDC();
        if (Math.abs(dc) > 1e-6) M.aD *= S.dcTarget / dc;
        const mtc = measureMTC();
        if (Math.abs(mtc) > 1e-6) M.aM *= S.mtcTarget / mtc;
      }
      S.dc = measureDC();
      S.mtc = measureMTC();
    }
    // paired solve: save, perturb, warm-start from this measurement's previous solution, solve (Tf frozen), restore
    function paired(name, perturb, undo, frozen = true, cache = true) {
      const snap = M.save();
      const k0 = M.k;
      const cur = cache ? M.shape() : null;
      M.frozenTf = frozen;
      perturb();
      M.setXS();
      if (cache === 'plain' && shapes[name]) M.warm(shapes[name].meas);
      else if (cache && shapes[name]) M.warmDelta(shapes[name].meas, shapes[name].base, cur);
      const r = runSolve(false);
      if (cache) shapes[name] = { meas: M.shape(), base: cur };
      undo();
      M.frozenTf = false;
      M.restore(snap);
      M.setXS();
      return { k0, k1: r.k, outers: r.outers };
    }
    function measureXe() {
      const save = M.X.slice();
      const r = paired('xe', () => M.X.fill(0), () => M.X.set(save), true, 'plain');
      S.xeWorth = (1 / r.k1 - 1 / r.k0) * 1e5;
      S.kNoXe = r.k1;
      return r;
    }
    function measureBoron() {
      const p0 = M.ppm;
      const r = paired('b', () => (M.ppm = p0 + 10), () => (M.ppm = p0), true, false);
      S.bw = (1 / r.k0 - 1 / r.k1) * 1e5 / 10;
      return r;
    }
    function measureDC() {
      const save = M.Tf.slice();
      let dT = 0;
      for (const c of FUEL) dT += M.Tf[c] - M.Tm;
      dT /= FUEL.length;
      if (dT < 1) return S.dc;
      const r = paired('dc', () => {
        for (const c of FUEL) M.Tf[c] = M.Tm;
      }, () => M.Tf.set(save));
      return ((1 / r.k1 - 1 / r.k0) * 1e5) / dT;
    }
    function measureDropWorth() {
      const r = paired('drop', () => (M.dropped[S.dropRod] = 0), () => (M.dropped[S.dropRod] = 1), true, 'plain');
      S.dropWorth = (1 / r.k1 - 1 / r.k0) * 1e5;
      return r;
    }
    function measureMTC() {
      const ref = M.TmRef;
      const r = paired('mtc', () => (M.TmRef = ref - 2), () => (M.TmRef = ref), true, false);
      return ((1 / r.k0 - 1 / r.k1) * 1e5) / 2;
    }
    function measureDW() {
      // differential Bank D worth by a +/-4 step pair around the current position
      const s0 = M.steps;
      const up = Math.min(228, s0 + 4), dn = Math.max(0, s0 - 4);
      const r1 = paired('dwu', () => (M.steps = up), () => (M.steps = s0), false, false);
      const r2 = paired('dwd', () => (M.steps = dn), () => (M.steps = s0), false, false);
      if (up > dn) S.dw = (1 / r2.k1 - 1 / r1.k1) * 1e5 / (up - dn);
    }
    function measurePD() {
      // power defect: rho(100%) - rho(0%), xenon, boron and rods fixed, full feedback in both solves
      const snap = M.save();
      const P0 = M.P;
      const cur = M.shape();
      let k100 = M.k;
      if (Math.abs(P0 - 1) > 1e-9) {
        M.P = 1;
        M.setXS();
        if (shapes.p100) M.warmDelta(shapes.p100.meas, shapes.p100.base, cur);
        k100 = runSolve(false).k;
        shapes.p100 = { meas: M.shape(), base: cur };
        M.restore(snap);
      }
      M.P = 0;
      for (const c of FUEL) M.Tf[c] = 565;
      M.setXS();
      if (shapes.p0) M.warmDelta(shapes.p0.meas, shapes.p0.base, cur);
      const k0 = runSolve(false).k;
      shapes.p0 = { meas: M.shape(), base: cur };
      M.P = P0;
      M.restore(snap);
      M.setXS();
      S.pdef = (1 / k0 - 1 / k100) * 1e5;
    }

    // ---------- one macro step ----------
    S.step = function (dtMin) {
      const dt = dtMin * 60;
      S.stepOuters = 0;
      S.stepSolves = 0;
      const t0 = Date.now();
      const events = { rod: null, drop: false };
      // I/Xe and delayed-neutron precursors over the step with the current flux and power
      if (M.xenon) M.xenonStep(dt);
      S.t += dtMin;
      // load follow: dispatch demand, actual power rate-limited by the ramp
      S.demand = demandAt(S.t);
      const dP = S.ramp * dtMin;
      const p0 = S.power / 100;
      S.power += Math.max(-dP, Math.min(dP, S.demand - S.power));
      M.P = S.power / 100;
      // precursors (normalised to equilibrium at 100%): exact for a linear power ramp over the step,
      // C' = l (P(t) - C)  ->  C = P(t) - a/l + (C0 - P0 + a/l) e^(-l t)
      const a = (M.P - p0) / dt;
      for (let i = 0; i < 6; i++) {
        const l = LAM[i], e = Math.exp(-l * dt);
        S.prec[i] = M.P - a / l + (S.prec[i] - p0 + a / l) * e;
      }
      // boron toward the Bank D target: half the rod deviation's reactivity per step, at most the dilution limit
      if (S.auto) {
        const dev = S.target - M.steps;
        const sat = (M.steps >= 228 && S.rho < -10) || (M.steps <= 0 && S.rho > 10);
        const want = (Math.min(1, 0.5 * dtMin / 5) * dev * S.dw + (sat ? S.rho : 0)) / Math.abs(S.bw);
        const lim = S.ppmLimit * dtMin;
        const ppm0 = M.ppm;
        M.ppm = Math.max(0, Math.min(2000, M.ppm + Math.max(-lim, Math.min(lim, want))));
        const dpp = M.ppm - ppm0;
        if (Math.abs(dpp) > 0.05) log('boron', `${dpp > 0 ? 'borate' : 'dilute'} ${Math.abs(dpp).toFixed(1)} ppm → ${M.ppm.toFixed(1)} ppm`);
      }
      if (!S.dropped && S.dropRod >= 0 && S.t >= S.dropAt) {
        S.dropped = true;
        events.drop = true;
        M.dropped[S.dropRod] = 1;
        const r = rods[S.dropRod];
        log('alarm', `ROD DROP: Bank D ${r.name} ${COLS[r.ac]}${r.ar + 1} fully inserted`);
      }
      M.setXS();
      // warm start: flux extrapolated in time from the last two macro steps
      if (lastShape && prevShape && !events.drop) M.warm(lastShape, prevShape, Math.min(1, dtMin / lastDt));
      let s = runSolve(true, 'step');
      let rho = pcm(s.k);
      if (events.drop) {
        measureDropWorth();
        S.dropWorth0 = S.dropWorth;
        const r = rods[S.dropRod];
        log('meas', `${r.name} ${COLS[r.ac]}${r.ar + 1} drop worth ${S.dropWorth.toFixed(0)} pcm (paired solve)`);
      }
      for (let mv = 0; mv < 2 && S.auto && Math.abs(rho) > 10; mv++) {
        let n = Math.round(-rho / S.dw);
        const from = M.steps;
        const to = Math.max(0, Math.min(228, from + n));
        n = to - from;
        if (n === 0) break;
        const r0 = rho;
        M.steps = to;
        M.setXS();
        s = runSolve(true, 'rod');
        rho = pcm(s.k);
        const dr = rho - r0;
        if (Math.abs(n) >= 2 && dr / n > 0.5 && dr / n < 40) S.dw = dr / n;
        log('rod', `D ${from}→${to} ${n > 0 ? '+' : '−'}${Math.abs(n)} st ${dr >= 0 ? '+' : '−'}${Math.abs(dr).toFixed(0)} pcm`);
        events.rod = { from, to, n, rhoStep: dr, rhoBefore: r0, rhoAfter: rho };
      }
      S.k = s.k;
      S.rho = rho;
      M.normalize(C.PRATED * M.P);
      prevShape = lastShape;
      lastShape = M.shape();
      lastDt = dtMin;
      if (events.rod) kinetics(events.rod);
      const tm = Math.round(S.t);
      if (tm % 30 === 0) {
        const r = measureXe();
        log('xe', `ρXe ${S.xeWorth.toFixed(0)} pcm · k ${r.k0.toFixed(5)} / no-Xe ${r.k1.toFixed(5)}`);
      } else if (!S.fast && tm % 30 === 15) {
        const which = S.measureIdx++ % (S.dropped ? 5 : 4);
        if (which === 0) {
          measureBoron();
          log('meas', `boron worth ${S.bw.toFixed(2)} pcm/ppm`);
        } else if (which === 1) {
          S.dc = measureDC();
          log('meas', `Doppler ${S.dc.toFixed(2)} pcm/K (defect / mean ΔTf)`);
        } else if (which === 2) {
          S.mtc = measureMTC();
          log('meas', `MTC ${S.mtc.toFixed(1)} pcm/K`);
        } else if (which === 3) {
          measurePD();
          log('meas', `power defect 0→100% ${S.pdef.toFixed(0)} pcm`);
        } else {
          measureDropWorth();
          log('meas', `dropped rod worth ${S.dropWorth.toFixed(0)} pcm`);
        }
      }
      if (tm % 60 === 0 && S.lastSolve) {
        const L = S.lastSolve;
        log('solver', `outer ${L.outers} k=${L.k.toFixed(6)} res ${L.res.toExponential(1)} DR ${L.dr.toFixed(3)}`);
      }
      indices();
      if (S.dropped && S.qptr > 1.02) {
        const band = Math.floor((S.qptr - 1) * 10); // a new alarm line for every +0.1 of tilt
        if (!S.qptrAlarm) {
          S.qptrAlarm = true;
          S.qptrBand = band;
          log('alarm', `TS QPTR ${S.qptr.toFixed(4)} > 1.02 \u00b7 ACTION: REDUCE POWER`);
          log('ctrl', 'operator action not modelled (demo run)');
        } else if (band > S.qptrBand) {
          if (band >= 2 && S.qptrBand < 2 && S.lastSolve) {
            log('xe', `XE AZIMUTHAL REDISTRIBUTION \u00b7 DR ${S.lastSolve.dr.toFixed(3)}`);
            log('ctrl', 'tilt growth uncontrolled: no Xe tilt control');
          }
          S.qptrBand = band;
          log('alarm', `TS QPTR ${S.qptr.toFixed(2)} \u00b7 REDUCE POWER (not modelled)`);
        }
      }
      S.stepMs = Date.now() - t0;
      return events;
    };

    function kinetics(ev) {
      const rho = ev.rhoStep * 1e-5;
      const w = inhourRoot(rho);
      S.kin = {
        t: S.t, from: ev.from, to: ev.to, n: ev.n, rho: ev.rhoStep, omega: w, period: w !== 0 ? 1 / w : Infinity,
        jump: BT / (BT - rho), trace: null, cEnd: null, pEnd: null,
      };
      if (!S.fast) {
        const kt = kineticsTrace(rho);
        S.kin.trace = kt.trace;
        S.kin.cEnd = kt.cEnd;
        S.kin.pEnd = kt.pEnd;
      }
    }

    // ---------- indices ----------
    function indices() {
      const ap = S.asmPow;
      ap.fill(0);
      const q = [0, 0, 0, 0];
      let mx = 0, sum = 0, tfS = 0, tfM = 0;
      const phi2 = M.phi2, NSF = M.NSF;
      for (const c of FUEL) {
        const p = NSF[c] * phi2[c];
        ap[casm[c]] += p;
        const j = ((c / NP) | 0) - 1, i = (c % NP) - 1;
        q[(j >= N / 2 ? 2 : 0) + (i >= N / 2 ? 1 : 0)] += p; // NW, NE, SW, SE (axes fall on cell boundaries)
        sum += p;
        if (p > mx) mx = p;
        tfS += M.Tf[c];
        if (M.Tf[c] > tfM) tfM = M.Tf[c];
      }
      S.fcell = mx / (sum / FUEL.length);
      let amx = 0;
      const meanA = sum / C.nFuelAsm;
      for (let a = 0; a < NA * NA; a++) {
        ap[a] /= meanA;
        if (ap[a] > amx) amx = ap[a];
      }
      S.fxy = amx;
      const qm = (q[0] + q[1] + q[2] + q[3]) / 4;
      S.quad = q.map((v) => v / qm);
      S.qptr = Math.max(...S.quad);
      S.tfMean = tfS / FUEL.length;
      S.tfMax = tfM;
    }

    S.record = function () {
      let xs = 0, is = 0;
      for (const c of FUEL) {
        xs += M.X[c];
        is += M.I[c];
      }
      return {
        t: S.t, demand: S.demand, power: S.power, k: S.k, rho: S.rho, steps: M.steps, ppm: M.ppm, xe: S.xeWorth,
        X: xs / FUEL.length, I: is / FUEL.length, qptr: S.qptr, q: S.quad.slice(), fxy: S.fxy, fcell: S.fcell,
        tm: M.Tm, tf: S.tfMean, tfMax: S.tfMax, dc: S.dc, pd: S.pdef, mtc: S.mtc, bw: S.bw, dw: S.dw,
        dropWorth: S.dropped ? S.dropWorth : 0, dropWorth0: S.dropped ? S.dropWorth0 : 0,
        outers: S.stepOuters, solves: S.stepSolves,
      };
    };
    S.clock = clock;
    S.demandAt = demandAt;
    return S;
  }

  root.PLANT = { createPlant, BETA, LAM, BT, GEN, inhourRho, inhourRoot, kineticsTrace, clock, DAY, COLS };
})(typeof self !== 'undefined' ? self : globalThis);

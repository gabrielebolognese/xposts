// Photon Ring: orchestration. GPU tracer + shading every frame, float readbacks, 7 workers metered by frames
// (2 critical-curve bisection, 4 EHT transforms, 1 spectrum), the virtual EHT night, panels.
(function () {
  'use strict';
  const STUDIO = window.STUDIO, K = window.Kerr, E = window.EHT, GLX = window.GLX;
  const RealDate = Object.getPrototypeOf(Date).now ? Object.getPrototypeOf(Date) : Date;
  const realNow = () => (STUDIO.mode === 'render' ? RealDate.now() : performance.now());
  const UAS = K.const.UAS;

  // ------------------------------------------------------------------ parameters (the controls)
  const P = {
    a: 0.94, incDeg: 72, Msun: 4.297e6, Dkpc: 8.277, mdot: 0.01, rout: 18, rs: 7.0, sig: 0.6, q: 3.0,
    h: 0.06, maxSteps: 2000, raysPerFrame: 8192, dopp: true, grav: true, delay: true, showCrit: true,
    freqGHz: 230, speed: 120, elLimDeg: 10,
  };
  const DATE0 = Date.UTC(2026, 7, 24, 3, 10, 0); // sim clock zero: UT 03:10:00 on 2026-08-24
  const APP = (window.APP = { P, DATE0, frame: 0, simSec: 0, log: [], logSeq: 0, ready: false, jsHist: [], frameHist: [] });

  function derive() {
    const a = P.a, D = {};
    D.inc = (P.incDeg * Math.PI) / 180;
    D.rplus = K.rplus(a); D.risco = K.risco(a); D.rphP = K.rphPro(a); D.rphR = K.rphRet(a);
    D.Eisco = K.Eisco(a); D.eff = 1 - D.Eisco;
    D.sc = K.scale(P.Msun, P.Dkpc);
    D.uasPerM = D.sc.uasPerM; D.tg = D.sc.tg; D.LEdd = D.sc.LEdd; D.rg = D.sc.rg;
    D.Fhat = K.pageThorne(a);
    D.rLut = 40;
    D.spotPeriodM = 2 * Math.PI * (Math.pow(P.rs, 1.5) + a);
    D.spotPeriodMin = (D.spotPeriodM * D.tg) / 60;
    D.Mdot = (P.mdot * D.LEdd) / (D.eff * K.const.C ** 2); // kg/s
    D.fluxUnit = (P.mdot * D.LEdd) / D.eff / D.rg ** 2; // W m^-2 per unit of F^
    let fm = 0, rm = 0;
    for (let r = D.risco; r < P.rout; r += 0.002) { const f = D.Fhat(r); if (f > fm) { fm = f; rm = r; } }
    D.FhatMax = fm; D.rFmax = rm;
    D.Tmax = Math.pow((fm * D.fluxUnit) / K.const.SIGMA, 0.25);
    D.lamObs = K.const.C / (P.freqGHz * 1e9);
    D.crit = K.critCurve(a, D.inc, 720);
    const ar = K.polyArea(D.crit);
    D.critDiamM = 2 * Math.sqrt(ar.A / Math.PI); D.critCx = ar.cx;
    let amin = 1e9, amax = -1e9;
    for (const p of D.crit) { amin = Math.min(amin, p[0]); amax = Math.max(amax, p[0]); }
    D.critMid = 0.5 * (amin + amax);
    D.Ts = Math.pow(((D.Fhat(P.rs) + 12 * fm) * D.fluxUnit) / K.const.SIGMA, 0.25); // spot peak temperature
    return D;
  }
  let D = derive();
  APP.D = D;

  // hot spot: born 3.4 orbits before the sim clock zero
  const Q_MM = P.q; // 230 GHz optically thin equatorial emission I_nu = g^3 r^-q (the same q as the Fe line)
  APP.Q_MM = Q_MM;
  const SPOT_K = 12; // spot peak emission over the disk maximum (bolometric) and over r_s^-q (230 GHz)
  const spot = { A: SPOT_K * D.FhatMax, A1: SPOT_K * Math.pow(P.rs, -Q_MM), phi0: 2.2, birthM: -3.4 * D.spotPeriodM };
  APP.spot = spot;
  APP.tobsM = () => APP.simSec / D.tg;
  APP.nightStart = null;

  // ------------------------------------------------------------------ log
  function log(kind, text, simSec = APP.simSec) {
    APP.log.push({ kind, text, sim: simSec, seq: APP.logSeq++ });
    if (APP.log.length > 300) APP.log.splice(0, APP.log.length - 300);
  }
  APP.logf = log;

  // ------------------------------------------------------------------ GL setup
  const glc = UI.canvas(352, 48, 880, 1024, '', 'gl', true);
  const S = GLX.init(glc.c);
  APP.S = S;
  const DPR = glc.d;
  const field = [-GLX.HALF_A, -GLX.HALF_B, 2 * GLX.HALF_A, 2 * GLX.HALF_B];
  APP.field = field;

  function shadeParams(tobs = APP.simSec / D.tg) {
    return {
      a: P.a, rin: D.risco, rLut: D.rLut, rout: P.rout, tobs, tmin: APP.pass.tmin,
      delay: P.delay, dopp: P.dopp, grav: P.grav, rs: P.rs, sig: P.sig, spotA: spot.A, spotPhi0: spot.phi0,
      spotBirth: spot.birthM, noise: 0.35, logRef: APP.logRef, logRange: 2.9, starGain: 1.0,
      q: Q_MM, spotA1: spot.A1,
    };
  }
  function traceParams() {
    return { a: P.a, inc: D.inc, h: P.h, rin: D.risco, rout: P.rout, maxSteps: P.maxSteps, rLut: D.rLut };
  }

  // tile order: rows from the top of the image down
  const tileOrder = [];
  for (let ty = GLX.TY - 1; ty >= 0; ty--) for (let tx = 0; tx < GLX.TX; tx++) tileOrder.push([tx, ty]);
  APP.tileOrder = tileOrder;

  // pass statistics, aggregated from the GPU reduction of every traced ray
  const newPass = (id) => ({ id, tiles: 0, rays: 0, steps: 0, maxSteps: 0, capt: 0, esc: 0, hit: 0, hit1: 0, hit2: 0,
    limit: 0, res: 0, tmin: 1e9, tmax: -1e9, gmin: 1e9, gmax: -1e9, iref: 0, sumR: 0, sumG: 0, sumT: 0, sumRes2: 0, hist: new Float64Array(GLX.HIST_BINS) });
  APP.pass = newPass(0);
  APP.passCur = newPass(1);
  APP.passCurId = () => passId;
  APP.passDone = 0;
  APP.rayTimes = []; // [frame time, rays, steps] from the GPU reduction (arrives a few frames late)
  APP.traceTimes = []; // [frame time, rays dispatched]
  APP.secStats = []; // per-frame reduction results, last second
  APP.statsSec = () => {
    const L = APP.secStats;
    if (!L.length) return null;
    const tEnd = L[L.length - 1].t;
    while (L.length && L[0].t < tEnd - 1000) L.shift();
    const o = { rays: 0, steps: 0, capt: 0, esc: 0, hit: 0, maxSteps: 0, res: 0, res2: 0, hist: new Float64Array(GLX.HIST_BINS), row: L[L.length - 1].row };
    for (const e of L) {
      o.rays += e.rays; o.steps += e.steps; o.capt += e.capt; o.esc += e.esc; o.hit += e.hit; o.res2 += e.res2;
      o.maxSteps = Math.max(o.maxSteps, e.maxSteps); o.res = Math.max(o.res, e.res);
      for (let q = 0; q < o.hist.length; q++) o.hist[q] += e.hist[q];
    }
    return o;
  };
  APP.raysTotal = 0;
  function accumulate(acc, d, nTiles) {
    for (let b = 0; b < GLX.HIST_BINS; b++) acc.hist[b] += d[b * 4];
    const o40 = 160, o41 = 164, o42 = 168, o43 = 172;
    acc.steps += d[o40]; acc.capt += d[o40 + 1]; acc.esc += d[o40 + 2]; acc.hit += d[o40 + 3];
    acc.hit1 += d[o41]; acc.hit2 += d[o41 + 1]; acc.limit += d[o41 + 2]; acc.sumR += d[o41 + 3];
    acc.maxSteps = Math.max(acc.maxSteps, d[o42]); acc.res = Math.max(acc.res, d[o42 + 1]);
    if (d[o40 + 3] > 0) {
      acc.tmax = Math.max(acc.tmax, d[o42 + 2]); acc.gmax = Math.max(acc.gmax, d[o42 + 3]);
      acc.tmin = Math.min(acc.tmin, 2000 - d[o43]); acc.gmin = Math.min(acc.gmin, 10 - d[o43 + 1]);
    }
    acc.iref = Math.max(acc.iref, d[o43 + 2]);
    acc.sumG += d[176]; acc.sumT += d[177]; acc.sumRes2 += d[178];
    acc.tiles += nTiles; acc.rays += nTiles * 1024;
  }

  // ------------------------------------------------------------------ readback processing
  // dynamic image readback (2 targets): sums over texels -> fluxes, centroid, order fractions, spot moments
  function processDyn(d0, d1, W, H, row0, t) {
    const dA = (field[2] / W) * (field[3] / H);
    let It = 0, Is = 0, Isg = 0, gmax = 0, sx = 0, sy = 0, n0 = 0, n1 = 0, n2 = 0, px = 0, py = 0, ismax = 0;
    for (let y = 0; y < H; y++) {
      const be = field[1] + ((y + 0.5) / H) * field[3];
      for (let x = 0; x < W; x++) {
        const i = ((row0 + y) * W + x) * 4;
        const a = d0[i], b = d0[i + 1];
        if (a === 0) continue;
        const al = field[0] + ((x + 0.5) / W) * field[2];
        It += a; Is += b; Isg += d0[i + 2]; if (d0[i + 3] > gmax) gmax = d0[i + 3];
        sx += a * al; sy += a * be; px += b * al; py += b * be;
        if (d1) { n0 += d1[i]; n1 += d1[i + 1]; n2 += d1[i + 2]; }
        if (b > ismax) ismax = b;
      }
    }
    const nt = n0 + n1 + n2 || 1;
    if (!d1) n0 = n1 = n2 = NaN;
    // annotation anchors (live readback only): brightest disk texel, brightest n>=1 texel, inner edge of the
    // lensed far side straight above the shadow
    let anno = null;
    if (d1) {
      let bi = 0, bv = 0;
      for (let k = 0; k < W * H; k++) { const v = d0[k * 4] - d0[k * 4 + 1]; if (v > bv) { bv = v; bi = k; } }
      const toA = (x) => field[0] + ((x + 0.5) / W) * field[2], toB = (y) => field[1] + ((y + 0.5) / H) * field[3];
      const cx = Math.round(((D.critMid - field[0]) / field[2]) * W - 0.5);
      let btop = -1e9;
      for (const p of D.crit) btop = Math.max(btop, p[1]);
      const y0 = Math.ceil(((btop - field[1]) / field[3]) * H);
      let arch = null;
      for (let y = y0; y < H; y++) if (d1[(y * W + cx) * 4 + 3] > 0.5) { arch = y; break; }
      // lowest disk texel in the shadow column whose light is mostly n >= 1: the secondary image below the disk
      let qi = -1;
      for (let y = 0; y < H; y++) {
        const i = (y * W + cx) * 4, tot = d1[i] + d1[i + 1] + d1[i + 2];
        if (d1[i + 3] > 0.3 && tot > 0 && (d1[i + 1] + d1[i + 2]) / tot > 0.5) { qi = y * W + cx; break; }
      }
      anno = { bright: [toA(bi % W), toB(Math.floor(bi / W))], n1: qi >= 0 ? [toA(qi % W), toB(Math.floor(qi / W))] : null,
        arch: arch != null ? [D.critMid, toB(arch)] : null };
    }
    return {
      t, It: It * dA, Is: Is * dA, gs: Is > 0 ? Isg / Is : 1, gmax,
      cx: (sx / It) * D.uasPerM, cy: (sy / It) * D.uasPerM,
      f0: n0 / nt, f1: n1 / nt, f2: n2 / nt,
      spx: Is > 0 ? px / Is : 0, spy: Is > 0 ? py / Is : 0, ismax, anno,
    };
  }

  APP.lc = []; // light curve and centroid series
  const LC_KEEP_SEC = 175 * 60;
  function pushLC(p) {
    APP.lc.push(p);
    while (APP.lc.length && APP.lc[0].t < p.t - LC_KEEP_SEC) APP.lc.shift();
  }

  // ------------------------------------------------------------------ prewarm
  function prewarm() {
    const t0 = realNow();
    GLX.setFhat(S, D.Fhat, D.risco, D.rLut);
    const TP = traceParams();
    GLX.trace(S, S.map, tileOrder, TP, field);
    const wideHalf = P.rout + 6;
    APP.wideHalf = wideHalf;
    GLX.trace(S, S.wide, Array.from({ length: 64 }, (_, k) => [k % 8, k >> 3]), TP, [-wideHalf, -wideHalf, 2 * wideHalf, 2 * wideHalf]);
    const red = GLX.reduceSync(S, tileOrder, TP);
    const pass = newPass(0);
    accumulate(pass, red, tileOrder.length);
    APP.pass = pass;
    APP.raysTotal = pass.rays + 64 * 1024;
    APP.tileCost = GLX.tileCosts(S, tileOrder);
    APP.tileCostMean = APP.tileCost.reduce((a, b) => a + b, 0) / tileOrder.length;
    APP.logRef = Math.log10(pass.iref);
    APP.traceMs = realNow() - t0;
    log('trace', `prewarm: ${UI.int(pass.rays)} geodesics in ${UI.int(APP.traceMs)} ms (${UI.fx(pass.steps / pass.rays, 1)} RK4 steps/ray)`, -3600);

    // static wide-field samples -> spectrum worker
    const st = GLX.staticRead(S);
    APP.staticWide = st;
    startSpectrum(st);

    // probes: 64 texels on an 8 x 8 grid, GPU fp32 values now, CPU fp64 in a crit worker
    const probes = [];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++)
      probes.push([Math.floor(((i + 0.37) / 8) * GLX.MAP_W), Math.floor(((j + 0.61) / 8) * GLX.MAP_H)]);
    const pr = GLX.probeRead(S, probes);
    APP.probes = { texels: probes, gpu: pr, cpu: null };

    const t1b = realNow();
    // light-curve and centroid history: the time-delayed image at past times, 64^2 texels x 8^2 taps
    const LCB = 64, step = 24, tb0 = -150 * 60; // 64^2 texels x 4^2 taps = the live 128^2 x 2^2 sample lattice
    const times = [];
    for (let t = tb0; t < 0; t += step) times.push(t);
    for (let i = 0; i < times.length; i += 64) {
      const n = Math.min(64, times.length - i);
      GLX.renderRead(S, S.dynFb, LCB, LCB, n, field, 4, times[i] / D.tg, step / D.tg, shadeParams());
      const out = GLX.readSync(S, S.dynFb, LCB, LCB * n, 1);
      for (let b = 0; b < n; b++) pushLC(processDyn(out[0], null, LCB, LCB, b * LCB, times[i + b]));
    }
    APP.lcBackfill = times.length;
    const t2 = realNow();
    ehtPrewarm();
    const t3 = realNow();
    geodesics();
    APP.prewarmMs = realNow() - t0;
    APP.stageMs = { trace: APP.traceMs, lc: t2 - t1b, eht: t3 - t2, geo: realNow() - t3 };
  }

  // ------------------------------------------------------------------ geodesics (CPU, 64 rays from the midlines)
  function geodesics() {
    const rays = [];
    const opt = (path) => ({ h: 0.03, maxSteps: 8000, r0: 1000, disk: true, rIn: D.risco, rOut: P.rout, path });
    // beta from -12 to 12, denser near the shadow edge (|beta| ~ 4-6 M)
    for (let k = 0; k < 44; k++) {
      const u = -1 + (2 * (k + 0.5)) / 44;
      const be = Math.sign(u) * (3.2 + 8.8 * Math.pow(Math.abs(u), 1.6)) * (Math.abs(u) < 0.02 ? 0 : 1) + (Math.abs(u) < 0.25 ? u * 6 : 0) * 0;
      const path = [];
      const r = K.trace(P.a, D.inc, 0.0, be, opt(path));
      rays.push({ al: 0, be, fate: r.fate, n: r.n, r: r.r, path: compress(path) });
    }
    for (let k = 0; k < 20; k++) {
      const u = -1 + (2 * (k + 0.5)) / 20;
      const al = D.critMid + Math.sign(u) * (3 + 9 * Math.pow(Math.abs(u), 1.4));
      const path = [];
      const r = K.trace(P.a, D.inc, al, 0.0, opt(path));
      rays.push({ al, be: 0, fate: r.fate, n: r.n, r: r.r, path: compress(path) });
    }
    APP.geo = rays;
  }
  // the part of a path inside r < 40 as Cartesian (x, z, y) with x toward the observer's azimuth
  function compress(path) {
    const out = [];
    for (let i = 0; i < path.length; i += 3) {
      const r = path[i], th = path[i + 1], ph = path[i + 2];
      if (r > 26) continue;
      out.push(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph));
    }
    return Float32Array.from(out);
  }

  // ------------------------------------------------------------------ workers: metered by frames
  function mkWorker(url, onmsg) {
    const w = new Worker(url);
    w.busy = false; w.resolve = null; w.jobs = 0;
    w.onmessage = (e) => {
      w.busy = false;
      try { onmsg(w, e.data); } catch (err) { console.error(err && err.stack ? err.stack : String(err)); }
      const r = w.resolve; w.resolve = null;
      if (r) r();
    };
    w.onerror = (e) => console.error('worker ' + url + ': ' + e.message);
    w.send = (msg, transfer) => {
      w.busy = true; w.jobs++;
      const p = new Promise((res) => (w.resolve = res));
      w.postMessage(msg, transfer || []);
      STUDIO.wait(p);
    };
    w.post = (msg, transfer) => w.postMessage(msg, transfer || []); // no reply expected
    return w;
  }

  // --- critical curve: 2 workers bisect 180 directions (even / odd), jobs = current (a, i), probes, spin sweeps
  const CRIT_N = 180, CRIT_BUDGET = 6000;
  APP.crit = null; APP.critJob = null; APP.sweep = []; APP.critStepsTotal = 0; APP.critRaysTotal = 0;
  APP.critTimes = [];
  const critQueue = [];
  APP.critQueue = critQueue;
  const critW = [0, 1].map((i) => mkWorker('crit-worker.js', (w, m) => {
    if (m.cmd === 'run') {
      APP.critStepsTotal += m.steps; APP.critRaysTotal += m.rays;
      APP.critTimes.push([APP.now || 0, m.steps, m.rays]);
      const J = APP.critJob;
      if (J && m.id === J.id) {
        for (const d of m.done) J.res[d.k] = d;
        J.doneCount += m.done.length;
        if (m.finished) J.fin[i] = true;
        if (J.fin[0] && J.fin[1]) finishCrit(J);
      }
    } else if (m.cmd === 'probe') {
      onProbe(m.out);
    }
  }));
  APP.critW = critW;
  let critJobId = 0;
  function queueSweep(inc, tag) {
    for (let k = 0; k < 24; k++) critQueue.push({ kind: 'sweep', a: (0.998 * k) / 23, inc, k, tag });
  }
  function startCritJob(spec) {
    const crit = K.critCurve(spec.a, spec.inc, 720);
    let amin = 1e9, amax = -1e9;
    for (const p of crit) { amin = Math.min(amin, p[0]); amax = Math.max(amax, p[0]); }
    const J = { ...spec, id: ++critJobId, cx: 0.5 * (amin + amax), cy: 0, res: new Array(CRIT_N), doneCount: 0, fin: [false, false],
      t0: APP.now || 0, crit };
    APP.critJob = J;
    critW.forEach((w, i) => {
      const dirs = [];
      for (let k = i; k < CRIT_N; k += 2) dirs.push(k);
      w.send({ cmd: 'job', job: { id: J.id, a: J.a, inc: J.inc, dirs, N: CRIT_N, cx: J.cx, cy: J.cy, maxSteps: 20000, h: P.h } });
    });
  }
  function finishCrit(J) {
    const pts = [];
    let err = 0;
    for (let k = 0; k < CRIT_N; k++) {
      const d = J.res[k], psi = (2 * Math.PI * k) / CRIT_N;
      pts.push([J.cx + d.rho * Math.cos(psi), J.cy + d.rho * Math.sin(psi)]);
      err += Math.abs(d.rho - d.ana) / d.ana;
    }
    const ar = K.polyArea(pts), arA = K.polyArea(J.crit);
    const sc = K.scale(P.Msun, P.Dkpc);
    const out = { a: J.a, inc: J.inc, pts, res: J.res, diamM: 2 * Math.sqrt(ar.A / Math.PI), diamAnaM: 2 * Math.sqrt(arA.A / Math.PI),
      offM: ar.cx, offAnaM: arA.cx, errPct: (100 * err) / CRIT_N, kind: J.kind, k: J.k, tag: J.tag,
      secs: ((APP.now || 0) - J.t0) / 1000, rays: J.res.reduce((s, d) => s + d.rays, 0) };
    out.diamUas = out.diamM * sc.uasPerM; out.offUas = out.offM * sc.uasPerM;
    APP.critJob = null;
    if (J.kind === 'cur') {
      APP.crit = out;
      log('crit', `critical curve a=${J.a.toFixed(3)} i=${((J.inc * 180) / Math.PI).toFixed(0)}°: d=${out.diamUas.toFixed(3)} µas, mean |Δr|/r ${out.errPct.toExponential(2)} %`);
    } else {
      APP.sweep.push(out);
      log('sweep', `sweep i=${((J.inc * 180) / Math.PI).toFixed(0)}° a=${J.a.toFixed(3)}: d ${out.diamUas.toFixed(2)} µas (ana ${(out.diamAnaM * sc.uasPerM).toFixed(2)})`);
      if (!critQueue.length && J.tag === 72) { queueSweep((17 * Math.PI) / 180, 17); log('sweep', 'spin sweep at i=72° complete, starting i=17° (EHT-favoured)'); }
    }
  }
  function onProbe(out) {
    const g = APP.probes.gpu;
    let n = 0, s2 = 0, agree = 0, maxd = 0;
    out.forEach((c, k) => {
      const gr = g[0][k * 4];
      const gf = gr > 0 ? 1 : gr === -1 ? 2 : gr === -2 ? 3 : 0;
      if (gf === c.fate) agree++;
      if (gf === 1 && c.fate === 1) { const d = gr - c.r; s2 += d * d; n++; maxd = Math.max(maxd, Math.abs(d)); }
    });
    APP.probes.cpu = out;
    APP.probes.rms = Math.sqrt(s2 / Math.max(1, n));
    APP.probes.max = maxd; APP.probes.n = n; APP.probes.agree = agree;
    APP.probes.res64 = Math.max(...out.filter((c) => c.fate === 1).map((c) => c.res || 0));
    log('probe', `fp32 GPU vs fp64 CPU: ${agree}/64 same fate, rms Δr_hit ${APP.probes.rms.toExponential(2)} M over ${n} disk hits`);
  }
  let probeSent = false;
  function tickCrit() {
    if (critW.some((w) => w.busy)) return;
    if (!APP.critJob) {
      if (!probeSent && APP.crit) {
        probeSent = true;
        const pts = APP.probes.texels.map(([x, y]) => [field[0] + ((x + 0.5) / GLX.MAP_W) * field[2], field[1] + ((y + 0.5) / GLX.MAP_H) * field[3]]);
        critW[0].send({ cmd: 'probe', a: P.a, inc: D.inc, rin: D.risco, rout: P.rout, h: P.h, maxSteps: P.maxSteps, pts });
        return;
      }
      const spec = critQueue.shift();
      if (spec) startCritJob(spec);
      return;
    }
    critW.forEach((w) => w.send({ cmd: 'run', budget: CRIT_BUDGET }));
  }

  // --- spectrum worker
  APP.spec = null; APP.spotSpec = null;
  const specW = mkWorker('spec-worker.js', (w, m) => {
    if (m.cmd === 'run') {
      APP.specProg = m.total ? m.at / m.total : 0;
      if (m.result) {
        APP.spec = m.result;
        APP.specRunning = false;
        log('spec', `spectrum: ${m.result.nPix} disk pixels, νLν peak ${UI.sci(m.result.nuPeak, 2)} Hz, L ${UI.sci(m.result.Lrel, 2)} W`);
      }
    } else if (m.cmd === 'spot') {
      APP.spotSpec = m.spec;
    }
  });
  APP.specW = specW;
  function startSpectrum(st) {
    specW.post({ cmd: 'start', id: 1, n: 256, d0: st[0], d1: st[1], half: APP.wideHalf, a: P.a, inc: D.inc, rout: P.rout, q: P.q,
      fluxUnit: D.fluxUnit, rg: D.rg });
    APP.specRunning = true;
  }
  let spotPending = null;
  function tickSpec() {
    if (specW.busy) return;
    if (APP.specRunning) { specW.send({ cmd: 'run', budget: 120000 }); return; }
    if (spotPending) { specW.send(spotPending); spotPending = null; }
  }

  // --- EHT: 4 workers, task queue
  const EN = 96, EH = 80; // pixels, half-width in µas
  APP.EN = EN; APP.EH = EH;
  const ehtAx = () => {
    const d = (2 * EH) / EN;
    return { l0: (EH - d / 2) * UAS, dl: -d * UAS, m0: (-EH + d / 2) * UAS, dm: d * UAS };
  };
  const ehtRegion = () => {
    const h = EH / D.uasPerM;
    return [-h, -h, 2 * h, 2 * h];
  };
  const POL_R = 64, POL_A = 36, POL_RMAX = 10e9;
  APP.eht = { samples: [], cur: [], polar: null, nullG: null, dirty: null, beam: null, beamFit: null, img: null, imgBlur: null,
    cycles: 0, visCount: 0, upNow: [], el: [], cov: 0, totalNight: 0, lastEpoch: null, dirtyAt: 0, dftPts: 0, dftTimes: [] };
  const ehtQ = [];
  APP.ehtQ = ehtQ;
  let ehtCycle = null, dirtyCycle = null;
  const pendingSamples = [];
  const ehtW = [0, 1, 2, 3].map(() => mkWorker('eht-worker.js', (w, m) => onEht(m)));
  APP.ehtW = ehtW;
  function polarUV() {
    const uv = new Float64Array(POL_R * POL_A * 2);
    for (let j = 0; j < POL_R; j++) for (let i = 0; i < POL_A; i++) {
      const rho = ((j + 1) / POL_R) * POL_RMAX, psi = (Math.PI * i) / POL_A, k = j * POL_A + i;
      uv[2 * k] = rho * Math.cos(psi); uv[2 * k + 1] = rho * Math.sin(psi);
    }
    return uv;
  }
  const POLUV = polarUV();
  function onEht(m) {
    const X = APP.eht;
    if (m.cmd === 'vis') {
      X.dftPts += m.n;
      X.dftTimes.push([APP.now || 0, m.n * EN * EN]);
      const C = ehtCycle;
      if (m.tag.kind === 'pol' && C && m.tag.cyc === C.id) {
        for (let k = 0; k < m.n; k++) { C.amp[m.tag.k0 + k] = Math.hypot(m.re[k], m.im[k]); C.re[m.tag.k0 + k] = m.re[k]; }
        C.left--;
        if (C.left === 0) finishPolar(C);
      } else if (m.tag.kind === 'cur') {
        const v0 = m.tag.v0;
        X.cur = m.tag.list.map((p, k) => ({ ...p, re: m.re[k] / v0, im: m.im[k] / v0, amp: Math.hypot(m.re[k], m.im[k]) / v0 }));
        const ns = m.tag.samples.length;
        if (ns) {
          const off = m.tag.list.length;
          m.tag.samples.forEach((s, k) => {
            X.samples.push({ ...s, re: m.re[off + k] / v0, im: m.im[off + k] / v0, amp: Math.hypot(m.re[off + k], m.im[off + k]) / v0 });
          });
          X.visCount = X.samples.length * 2;
          X.lastAdded = ns * 2;
          log('eht', `+${ns * 2} vis (${ns} baselines × 2), total ${UI.int(X.visCount)}`);
          queueDirty();
          queueFit();
        }
      }
    } else if (m.cmd === 'blur') {
      X.imgBlur = m.out; X.blurId = m.tag;
    } else if (m.cmd === 'fit') {
      const prev = X.fit;
      X.fit = { ...m.fit, bins: m.bins, at: APP.simSec, K: m.tag };
      if (!prev || Math.abs(prev.d - X.fit.d) >= 0.25 || X.fitLogged !== Math.floor(APP.simSec / 1800))
        log('eht', `ring fit to ${UI.int(m.tag * 2)} vis: d ${X.fit.d.toFixed(2)} µas, null ${(X.fit.nullG / 1e9).toFixed(3)} Gλ`);
      X.fitLogged = Math.floor(APP.simSec / 1800);
    } else if (m.cmd === 'dirty') {
      const C = dirtyCycle;
      if (!C || m.tag !== C.id) return;
      X.dftTimes.push([APP.now || 0, (m.y1 - m.y0) * EN * C.K]);
      (m.beam ? C.beam : C.dirty).set(m.out, m.y0 * EN);
      C.left--;
      if (C.left === 0) finishDirty(C);
    }
  }
  function finishPolar(C) {
    const X = APP.eht;
    const inc = new Float64Array(POL_R), coh = new Float64Array(POL_R);
    for (let j = 0; j < POL_R; j++) {
      let s = 0, c = 0;
      for (let i = 0; i < POL_A; i++) { s += C.amp[j * POL_A + i]; c += C.re[j * POL_A + i]; }
      inc[j] = s / POL_A / C.v0; coh[j] = c / POL_A / C.v0;
    }
    const rho = Array.from({ length: POL_R }, (_, j) => ((j + 1) / POL_R) * POL_RMAX);
    X.polar = { rho, inc: Array.from(inc), coh: Array.from(coh), raw: C.amp, v0: C.v0 };
    // first zero of the azimuthally averaged visibility (the visibility of the circularly averaged image)
    let nul = null;
    for (let j = 1; j < POL_R; j++) {
      if (coh[j - 1] > 0 && coh[j] <= 0) {
        const f = coh[j - 1] / (coh[j - 1] - coh[j]);
        nul = rho[j - 1] + f * (rho[j] - rho[j - 1]);
        break;
      }
    }
    X.nullG = nul;
    X.ringUas = nul ? (0.7655 / nul) / UAS : null;
    X.cycles++;
    if (X.cycles % 24 === 1 && nul) log('eht', `model V̄ (full uv) null ${(nul / 1e9).toFixed(3)} Gλ, DFT cycle ${X.cycles}`);
    ehtCycle = null;
  }
  // circularly averaged visibility from the samples (phase-centred on the black hole): bins of 0.4 G lambda
  function binSamples() {
    const NB = 25, W = 0.4e9, re = new Float64Array(NB), amp = new Float64Array(NB), n = new Float64Array(NB);
    for (const s of APP.eht.samples) {
      const b = Math.floor(Math.hypot(s.u, s.v) / W);
      if (b >= NB) continue;
      re[b] += s.re; amp[b] += s.amp; n[b]++;
    }
    const bins = [], ampBins = [];
    for (let b = 0; b < NB; b++) if (n[b] >= 3) { bins.push([(b + 0.5) * W, re[b] / n[b], n[b]]); ampBins.push([(b + 0.5) * W, amp[b] / n[b], n[b]]); }
    APP.eht.ampBins = ampBins;
    return bins;
  }
  function queueFit() {
    for (let i = ehtQ.length - 1; i >= 0; i--) if (ehtQ[i].cmd === 'fit') ehtQ.splice(i, 1);
    ehtQ.unshift({ cmd: 'fit', tag: APP.eht.samples.length, bins: binSamples() });
  }
  APP.queueFit = queueFit;
  function queueDirty() {
    const X = APP.eht;
    // uniform weighting: 1 / samples per 0.25 G lambda cell (both halves)
    const cell = 0.25e9, cnt = new Map();
    const key = (u, v) => Math.floor(u / cell) + ',' + Math.floor(v / cell);
    for (const s of X.samples) for (const sg of [1, -1]) { const k = key(sg * s.u, sg * s.v); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const K2 = X.samples.length;
    const pts = new Float64Array(K2 * 5);
    let wsum = 0;
    X.samples.forEach((s, k) => {
      const w = 1 / cnt.get(key(s.u, s.v));
      pts.set([s.u, s.v, w, s.re, s.im], k * 5);
      wsum += 2 * w;
    });
    for (let i = 0; i < K2; i++) pts[i * 5 + 2] /= wsum;
    const id = (dirtyCycle ? dirtyCycle.id : X.dirtyId || 0) + 1;
    X.dirtyId = id;
    dirtyCycle = { id, K: K2, dirty: new Float64Array(EN * EN), beam: new Float64Array(EN * EN), left: 0 };
    ehtW.forEach((w) => w.post({ cmd: 'pts', pts }));
    for (let i = ehtQ.length - 1; i >= 0; i--) if (ehtQ[i].cmd === 'dirty') ehtQ.splice(i, 1);
    const R = 6;
    for (const beam of [false, true]) for (let y = 0; y < EN; y += R) {
      ehtQ.push({ cmd: 'dirty', tag: id, y0: y, y1: Math.min(EN, y + R), beam, ax: ehtAx() });
      dirtyCycle.left++;
    }
  }
  function finishDirty(C) {
    const X = APP.eht;
    let bmax = 0;
    for (let i = 0; i < C.beam.length; i++) bmax = Math.max(bmax, C.beam[i]);
    X.dirty = C.dirty; X.beam = C.beam; X.beamMax = bmax; X.dirtyK = C.K;
    X.beamFit = fitBeam(C.beam, bmax);
    X.dirtyAt = APP.simSec;
    X.dirtyCount = (X.dirtyCount || 0) + 1;
    dirtyCycle = null;
  }
  // half-maximum contour of the dirty beam along 72 directions -> ellipse axes and position angle
  function fitBeam(B, bmax) {
    const pix = (2 * EH) / EN, c = EN / 2 - 0.5;
    let rmax = 0, rmin = 1e9, pmax = 0;
    for (let k = 0; k < 72; k++) {
      const ps = (Math.PI * k) / 72;
      let r = 0;
      for (; r < 40; r += 0.25) {
        const x = c + r * Math.cos(ps), y = c + r * Math.sin(ps);
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const v = (B[iy * EN + ix] * (1 - fx) + B[iy * EN + ix + 1] * fx) * (1 - fy) + (B[(iy + 1) * EN + ix] * (1 - fx) + B[(iy + 1) * EN + ix + 1] * fx) * fy;
        if (v < 0.5 * bmax) break;
      }
      if (r > rmax) { rmax = r; pmax = ps; }
      rmin = Math.min(rmin, r);
    }
    return { maj: 2 * rmax * pix, min: 2 * rmin * pix, pa: (((90 - (pmax * 180) / Math.PI) % 180) + 180) % 180 };
  }
  function blurImage(img, fwhmUas) {
    const pix = (2 * EH) / EN, sg = fwhmUas / 2.3548 / pix, R = Math.ceil(3 * sg);
    const k = []; let ks = 0;
    for (let i = -R; i <= R; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); ks += v; }
    const tmp = new Float64Array(EN * EN), out = new Float64Array(EN * EN);
    for (let y = 0; y < EN; y++) for (let x = 0; x < EN; x++) {
      let s = 0;
      for (let i = -R; i <= R; i++) { const xx = x + i; if (xx >= 0 && xx < EN) s += img[y * EN + xx] * k[i + R]; }
      tmp[y * EN + x] = s / ks;
    }
    for (let y = 0; y < EN; y++) for (let x = 0; x < EN; x++) {
      let s = 0;
      for (let i = -R; i <= R; i++) { const yy = y + i; if (yy >= 0 && yy < EN) s += tmp[yy * EN + x] * k[i + R]; }
      out[y * EN + x] = s / ks;
    }
    return out;
  }
  // a new image: broadcast it, queue the current baselines (+ samples due) and the polar grid
  function startEhtCycle(img) {
    const X = APP.eht;
    let v0 = 0;
    for (let i = 0; i < img.length; i++) v0 += img[i];
    X.img = img; X.v0 = v0;
    const ax = ehtAx();
    ehtW.forEach((w) => w.post({ cmd: 'img', img, ax }));
    const id = (X.polCycleId || 0) + 1;
    X.polCycleId = id;
    ehtCycle = { id, amp: new Float64Array(POL_R * POL_A), re: new Float64Array(POL_R * POL_A), left: 0, v0 };
    const list = X.upNow.map((p) => ({ k: p.k, u: p.u, v: p.v }));
    const samples = pendingSamples.splice(0);
    const uv = new Float64Array((list.length + samples.length) * 2);
    list.forEach((p, k) => { uv[2 * k] = p.u; uv[2 * k + 1] = p.v; });
    samples.forEach((p, k) => { uv[2 * (list.length + k)] = p.u; uv[2 * (list.length + k) + 1] = p.v; });
    ehtQ.unshift({ cmd: 'vis', tag: { kind: 'cur', list, samples, v0 }, uv });
    const CH = 288;
    for (let k0 = 0; k0 < POL_R * POL_A; k0 += CH) {
      ehtQ.push({ cmd: 'vis', tag: { kind: 'pol', cyc: id, k0 }, uv: POLUV.slice(2 * k0, 2 * (k0 + CH)) });
      ehtCycle.left++;
    }
    // the model blurred to the beam is computed by an EHT worker (queued behind this image)
    ehtQ.push({ cmd: 'blur', tag: id, fwhmPix: (X.beamFit ? Math.sqrt(X.beamFit.maj * X.beamFit.min) : 20) / ((2 * EH) / EN) });
  }
  function tickEht() {
    for (const w of ehtW) {
      if (w.busy) continue;
      const t = ehtQ.shift();
      if (!t) break;
      w.send(t);
    }
  }
  function ehtSnapshot(simSec) {
    return E.snapshot(DATE0 + simSec * 1000, D.lamObs, (P.elLimDeg * Math.PI) / 180);
  }
  APP.ehtSnapshot = ehtSnapshot;
  const longBase = (k) => E.baselines[k].len > 10000;
  APP.longBase = longBase;
  const utOf = (s) => 3 * 3600 + 10 * 60 + s;
  APP.utOf = utOf;
  function ehtPrewarm() {
    const X = APP.eht;
    // night: contiguous span around now with at least one long baseline up, in 5-min epochs
    let t = 0;
    for (let s = 0; s > -20 * 3600; s -= 300) if (!ehtSnapshot(s).up.some((p) => longBase(p.k))) { t = s + 300; break; }
    let tEnd = 0;
    for (let s = 0; s < 20 * 3600; s += 300) if (!ehtSnapshot(s).up.some((p) => longBase(p.k))) { tEnd = s - 300; break; }
    APP.nightStart = t; APP.nightEnd = tEnd;
    let tot = 0;
    for (let s = t; s <= tEnd; s += 300) tot += ehtSnapshot(s).up.length;
    X.totalNight = tot;
    // epochs up to now: images at each epoch (GPU), DFT here
    const epochs = [];
    for (let s = t; s <= 0; s += 300) epochs.push(s);
    const reg = ehtRegion(), ax = ehtAx();
    for (let i = 0; i < epochs.length; i += 16) {
      const n = Math.min(16, epochs.length - i);
      GLX.renderRead(S, S.ehtFb, EN, EN, n, reg, 2, epochs[i] / D.tg, 300 / D.tg, shadeParams(), 1);
      const out = GLX.readSync(S, S.ehtFb, EN, EN * n, 1)[0];
      for (let b = 0; b < n; b++) {
        const img = new Float64Array(EN * EN);
        for (let p = 0; p < EN * EN; p++) img[p] = out[(b * EN * EN + p) * 4];
        let v0 = 0;
        for (let p = 0; p < img.length; p++) v0 += img[p];
        const sn = ehtSnapshot(epochs[i + b]);
        if (i + b === epochs.length - 1) { X.img = img; X.v0 = v0; }
        if (!sn.up.length) continue;
        const uv = new Float64Array(sn.up.length * 2);
        sn.up.forEach((p, k) => { uv[2 * k] = p.u; uv[2 * k + 1] = p.v; });
        const V = E.vis(img, ax, uv);
        sn.up.forEach((p, k) => X.samples.push({ k: p.k, u: p.u, v: p.v, t: epochs[i + b], ut: utOf(epochs[i + b]),
          re: V.re[k] / v0, im: V.im[k] / v0, amp: Math.hypot(V.re[k], V.im[k]) / v0 }));
      }
    }
    X.visCount = X.samples.length * 2;
    X.lastEpoch = 0;
    let prevUp = new Set();
    for (const s of epochs) {
      const sn = ehtSnapshot(s);
      const up = new Set(sn.up.map((p) => p.k));
      for (const k of up) if (!prevUp.has(k) && longBase(k) && s > t) log('rise', `${E.baselines[k].name} rises (both > ${P.elLimDeg}°)`, s);
      for (const k of prevUp) if (!up.has(k) && longBase(k)) log('set', `${E.baselines[k].name} sets`, s);
      prevUp = up;
    }
    APP.prevUp = prevUp;
    X.imgBlur = blurImage(X.img, 20);
    log('eht', `night 2026-08-24 from UT ${UI.hhmm(utOf(t)).slice(0, 5)}: ${epochs.length} epochs, ${UI.int(X.visCount)} visibilities`, -1);
    queueDirty();
    queueFit();
  }
  function tickEhtTime() {
    const X = APP.eht;
    const sn = ehtSnapshot(APP.simSec);
    X.upNow = sn.up; X.el = sn.el; X.H = sn.H;
    const ep = Math.floor(APP.simSec / 300);
    if (ep !== X.lastEpoch) {
      X.lastEpoch = ep;
      const s = ep * 300;
      const es = ehtSnapshot(s);
      for (const p of es.up) pendingSamples.push({ k: p.k, u: p.u, v: p.v, t: s, ut: utOf(s) });
      const up = new Set(es.up.map((p) => p.k));
      for (const k of up) if (!APP.prevUp.has(k) && longBase(k)) log('rise', `${E.baselines[k].name} rises (both > ${P.elLimDeg}°)`, s);
      for (const k of APP.prevUp) if (!up.has(k) && longBase(k)) log('set', `${E.baselines[k].name} sets`, s);
      APP.prevUp = up;
    }
    X.cov = X.samples.length / Math.max(1, X.totalNight);
  }

  // ------------------------------------------------------------------ frame loop
  let last = null, passTile = 0, passId = 1, lastReport = -1e9, lastSpotPeak = null, redTags = [], hubCycle = 0, workCarry = 0;
  const passAcc = new Map();
  // reduction results arrive a few frames late; each is tagged with its pass
  function passAdd(pid, red, n) {
    let acc = passAcc.get(pid);
    if (!acc) { acc = newPass(pid); passAcc.set(pid, acc); }
    if (red) accumulate(acc, red, n); else { acc.tiles += n; acc.rays += n * 1024; acc.unmeasured = (acc.unmeasured || 0) + n; }
    if (pid === passId) APP.passCur = acc;
    if (acc.tiles >= tileOrder.length) {
      passAcc.delete(pid);
      APP.pass = acc;
      APP.passDone++;
      onPassDone();
    }
    for (const k of passAcc.keys()) if (k < pid - 2) passAcc.delete(k);
  }
  APP.sec = {};
  let secT = 0;
  let frameSec = {};
  APP.worst = [];
  const sec = (name) => { const t = realNow(); const c = APP.sec[name] || (APP.sec[name] = 0); APP.sec[name] = c + (t - secT); frameSec[name] = (frameSec[name] || 0) + (t - secT); secT = t; };
  function frame(now) {
    requestAnimationFrame(frame);
    const tJs = realNow();
    secT = tJs;
    const dt = last == null ? 1000 / 60 : Math.min(100, Math.max(0, now - last));
    last = now;
    APP.now = now;
    APP.dt = dt;
    APP.frame++;
    APP.simSec += (dt / 1000) * P.speed;
    const F = APP.frame;
    const gl = S.gl;

    // --- readbacks first: their sync waits only for earlier frames' GPU work
    // one packed readback per 4-frame cycle (requested on band 3, read 3 frames later)
    const hb = F % 4 === 2 ? S.hub.poll(F, 3) : null;
    if (hb) {
      const tg = hb.tag;
      for (let b = 0; b < 4; b++) {
        const t = tg.red[b];
        if (!t) continue;
        const red = GLX.collapseBand(hb.view.red, b);
        passAdd(t.pid, red, t.n);
        APP.rayTimes.push([t.now, t.n * 1024, red[160]]);
        // rolling statistics of the rays traced in the last second (the tiles under the cursor)
        const hist = new Float64Array(GLX.HIST_BINS);
        for (let q = 0; q < GLX.HIST_BINS; q++) hist[q] = red[q * 4];
        APP.secStats.push({ t: t.now, rays: t.n * 1024, steps: red[160], capt: red[161], esc: red[162], hit: red[163], maxSteps: red[168],
          res: red[169], res2: red[178], hist, row: t.row });
      }
      if (hb.view.dyn1) APP.lastD1 = Float32Array.from(hb.view.dyn1); // order fractions and anchors, 1/4 rate
      if (hb.view.dyn0) {
        const p = processDyn(hb.view.dyn0, APP.lastD1 || null, 128, 128, 0, tg.dynT);
        if (!APP.lastD1 && APP.dyn) { p.f0 = APP.dyn.f0; p.f1 = APP.dyn.f1; p.f2 = APP.dyn.f2; }
        pushLC(p);
        APP.dyn = p;
        if (p.anno) APP.anno = p.anno;
        onLightPoint();
        if (tg.cycle % 4 === 0) {
          const Is = [], gs = [];
          const d0 = hb.view.dyn0;
          for (let i = 0; i < 128 * 128; i++) { const v = d0[i * 4 + 1]; if (v > 1e-3 * p.ismax) { Is.push(v); gs.push(d0[i * 4 + 2] / v); } }
          spotPending = { cmd: 'spot', Is: Float64Array.from(Is), gs: Float64Array.from(gs), dA: (field[2] / 128) * (field[3] / 128),
            fluxUnit: D.fluxUnit, Ts: D.Ts, rg: D.rg, t: p.t };
        }
      }
      if (hb.view.eht) { const e = hb.view.eht, im = new Float64Array(EN * EN); for (let q = 0; q < EN * EN; q++) im[q] = e[q * 4]; APP.ehtImgPending = im; }
    }
    sec('polls');
    // --- tracer: next tiles of the progressive pass
    GLX.timePoll(S);
    sec('timePoll');
    GLX.timeBegin(S);
    // work-balanced budget: tiles until their measured RK4 steps reach (rays per frame) x (mean steps per ray)
    const budget = (P.raysPerFrame / 1024) * APP.tileCostMean;
    const tiles = [];
    const tilePid = passId;
    // error diffusion: unused or overspent work carries to the next frame, so the long-run mean is exactly the budget
    const allow = budget + workCarry;
    let cost = 0;
    while (tiles.length < 128) {
      const c = APP.tileCost[passTile];
      if (tiles.length > 0 && cost + c > allow) break;
      tiles.push(tileOrder[passTile]);
      cost += c;
      passTile++;
      if (passTile >= tileOrder.length) { passTile = 0; passId++; break; }
    }
    workCarry = Math.max(-budget, Math.min(budget, allow - cost));
    const nT = tiles.length;
    APP.stepBudget = budget;
    APP.passTile = passTile;
    APP.curTiles = tiles;
    GLX.trace(S, S.map, tiles, traceParams(), field);
    GLX.timeEnd(S);
    sec('trace');
    APP.raysTotal += nT * 1024;
    APP.traceTimes.push([now, tiles.length * 1024]);
    while (APP.traceTimes[0][0] < now - 1000) APP.traceTimes.shift();
    GLX.timeBegin(S, 'reduce');
    const band = F % 4;
    if (band === 0) redTags = [];
    GLX.reduce(S, tiles, traceParams(), band);
    redTags[band] = { n: tiles.length, pid: tilePid, now, row: tiles[0][1] };
    GLX.timeEnd(S);
    if (band === 3) {
      // the reduction every cycle; the live 128^2 image on even cycles, its order-fraction target or the EHT crop on
      // odd ones, so no single readback carries more than ~300 KB (each getBufferSubData is a synchronous copy)
      GLX.timeBegin(S, 'dyn');
      hubCycle++;
      const items = [{ fb: S.redFb, att: 0, w: GLX.RED_W, h: 64, key: 'red' }];
      const even = hubCycle % 2 === 0;
      if (even || hubCycle % 4 === 3) GLX.renderRead(S, S.dynFb, 128, 128, 1, field, 2, APP.simSec / D.tg, 0, shadeParams());
      if (even) items.push({ fb: S.dynFb, att: 0, w: 128, h: 128, key: 'dyn0' });
      else if (hubCycle % 4 === 3) items.push({ fb: S.dynFb, att: 1, w: 128, h: 128, key: 'dyn1' });
      else {
        GLX.renderRead(S, S.ehtFb, EN, EN, 1, ehtRegion(), 2, APP.simSec / D.tg, 0, shadeParams(), 1);
        items.push({ fb: S.ehtFb, att: 0, w: EN, h: EN, key: 'eht' });
      }
      if (!S.hub.request(items, F, { red: redTags, dynT: APP.simSec, cycle: hubCycle })) for (const t of redTags) if (t) passAdd(t.pid, null, t.n);
      GLX.timeEnd(S);
    }
    sec('reduce');
    APP.rayTimes.sort((p, q) => p[0] - q[0]);
    while (APP.rayTimes.length && APP.rayTimes[0][0] < now - 1000) APP.rayTimes.shift();

    sec('dyn');
    tickEhtTime();
    if (APP.ehtImgPending && !ehtCycle && !ehtQ.some((t) => t.cmd === 'vis')) {
      startEhtCycle(APP.ehtImgPending);
      APP.ehtImgPending = null;
    }

    sec('eht');
    // --- hero (maps only when the map changed)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const SP = shadeParams();
    if (!APP.mapsDrawn || APP.mapsDirty) {
      GLX.buildCache(S, SP, 880 * DPR, 720 * DPR);
      drawMaps(SP); APP.mapsDrawn = true; APP.mapsDirty = false;
    }
    GLX.timeBegin(S, 'hero');
    GLX.drawHero(S, SP, [0, (1024 - 720) * DPR, 880 * DPR, 720 * DPR]);
    GLX.timeEnd(S);

    sec('hero');
    // --- workers
    tickCrit();
    tickEht();
    tickSpec();
    sec('workers');
    while (APP.critTimes.length && APP.critTimes[0][0] < now - 1000) APP.critTimes.shift();
    while (APP.eht.dftTimes.length && APP.eht.dftTimes[0][0] < now - 1000) APP.eht.dftTimes.shift();

    // --- panels
    if (window.PANELS) window.PANELS.draw(F, now);
    sec('panels');

    if (now - lastReport >= 1000) { lastReport = now; report(); }
    // render mode: let the GPU drain between frames (the recorder waits for registered work), so a later readback
    // never queues behind a backlog and every frame's measured time is its own JavaScript
    if (!GLX.live) {
      const fz = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
      STUDIO.wait(GLX.fenceDone(gl, fz).then(() => { gl.deleteSync(fz); if ((F + 1) % 4 === 2) S.hub.prefetch(F + 1, 3); }));
    } else if ((F + 1) % 4 === 2) {
      // live: do the synchronous buffer copy in the idle gap after this frame (only once its fence has signalled)
      setTimeout(() => S.hub.prefetch(F + 1, 3), 0);
    }
    const js = realNow() - tJs;
    if (js > 18) { APP.worst.push({ F, js: +js.toFixed(1), ...Object.fromEntries(Object.entries(frameSec).map(([k, v]) => [k, +v.toFixed(1)])) }); if (APP.worst.length > 12) APP.worst.shift(); }
    frameSec = {};
    APP.jsMs = js;
    APP.jsHist.push(js);
    if (APP.jsHist.length > 600) APP.jsHist.shift();
  }

  function drawMaps(SP) {
    const p = APP.pass;
    const vy = (296 - 20 - 175) * DPR; // image rows 20..195 of the 296-high strip (GL y from the bottom)
    const modes = [[0, p.gmin, p.gmax], [1, 0, p.tmax - p.tmin], [2, 0, 3], [3, D.risco, P.rout]];
    modes.forEach(([mode, lo, hi], k) => {
      GLX.drawMap(S, SP, [k * 222 * DPR, vy, 214 * DPR, 175 * DPR], DPR >= 2 ? 2 : 3, mode, lo, hi);
    });
  }
  APP.redrawMaps = () => { APP.mapsDirty = true; };

  function onPassDone() {
    const p = APP.pass;
    const lr = Math.log10(p.iref);
    if (isFinite(lr)) APP.logRef = lr;
    APP.mapsDirty = true;
    if (APP.passDone % 3 === 1) log('trace', `pass ${p.id}: ${UI.int(p.rays)} rays, ${UI.fx(p.steps / p.rays, 1)} steps/ray`);
  }

  // spot passages: local maxima of the spot flux
  function onLightPoint() {
    const L = APP.lc, n = L.length;
    if (n < 9) return;
    const m = L[n - 5];
    for (let k = n - 9; k < n; k++) if (L[k].Is > m.Is) return;
    if (lastSpotPeak && m.t - lastSpotPeak.t < 600) return;
    const prev = lastSpotPeak;
    lastSpotPeak = m;
    const meanIt = L.reduce((a2, p2) => a2 + p2.It, 0) / L.length;
    if (prev) log('spot', `spot peak ${((100 * m.Is) / meanIt).toFixed(1)}% ⟨F⟩, ΔT ${((m.t - prev.t) / 60).toFixed(1)} min`);
  }

  // ------------------------------------------------------------------ headline numbers
  // rays dispatched in the last second of frame time; RK4 steps per second over the frames the reductions cover
  APP.raysPerSec = () => APP.traceTimes.reduce((s, x) => s + x[1], 0);
  APP.stepsPerSec = () => {
    const R = APP.rayTimes;
    if (R.length < 2) return 0;
    const span = R[R.length - 1][0] - R[0][0] + (APP.dt || 16.7);
    return (R.reduce((s, x) => s + x[2], 0) * 1000) / span;
  };
  function report() {
    const c = APP.crit, d = APP.dyn;
    APP.headline = {
      shadow_diam_uas: c ? +c.diamUas.toFixed(3) : null,
      shadow_err_pct: c ? +c.errPct.toPrecision(3) : null,
      isco_r_M: +D.risco.toFixed(4),
      spot_period_min: +D.spotPeriodMin.toFixed(2),
      flux_n1_pct: d ? +(100 * (d.f1 + d.f2)).toFixed(2) : null,
      vis_null_glambda: APP.eht.fit ? +(APP.eht.fit.nullG / 1e9).toFixed(3) : null,
      ring_fit_uas: APP.eht.fit ? +APP.eht.fit.d.toFixed(2) : null,
      g_max: isFinite(APP.pass.gmax) ? +APP.pass.gmax.toFixed(4) : null,
      rays_per_sec: APP.raysPerSec(),
    };
    STUDIO.report(APP.headline);
  }

  // dev: azimuthal |V| for the 230 GHz image with a given q
  APP.testNull = (q, spotK) => {
    const SP = shadeParams(); SP.q = q; SP.spotA1 = spotK * Math.pow(P.rs, -q);
    GLX.renderRead(S, S.ehtFb, EN, EN, 1, ehtRegion(), 4, APP.simSec / D.tg, 0, SP, 1);
    const out = GLX.readSync(S, S.ehtFb, EN, EN, 1)[0];
    const img = Float64Array.from({ length: EN * EN }, (_, p) => out[p * 4]);
    let v0 = 0; for (const v of img) v0 += v;
    const V = E.vis(img, ehtAx(), POLUV);
    const avg = [];
    for (let j = 0; j < POL_R; j++) { let s = 0; for (let i = 0; i < POL_A; i++) { const k = j * POL_A + i; s += V.re[k]; } avg.push(+(s / POL_A / v0).toFixed(3)); }
    return avg.join(' ');
  };
  // GPU micro-benchmark (dev): ms per pass, synchronised by 1-pixel reads
  APP.bench = () => {
    const gl = S.gl, out = {};
    const px = new Float32Array(4);
    const sync = (fb) => { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); };
    const T = (name, fn, fb, n = 6) => { sync(fb); const t0 = RealDate.now(); for (let i = 0; i < n; i++) { fn(); sync(fb); } out[name] = (RealDate.now() - t0) / n; };
    const tiles = tileOrder.slice(800, 812);
    T('sync', () => {}, S.map.fb);
    T('trace12mid', () => GLX.trace(S, S.map, tiles, traceParams(), field), S.map.fb);
    T('trace12top', () => GLX.trace(S, S.map, tileOrder.slice(0, 12), traceParams(), field), S.map.fb);
    T('reduce12', () => { GLX.reduce(S, tiles, traceParams(), 0); }, S.redFb);
    T('dyn128', () => GLX.renderRead(S, S.dynFb, 128, 128, 1, field, 2, 0, 0, shadeParams()), S.dynFb);
    T('eht96', () => GLX.renderRead(S, S.ehtFb, EN, EN, 1, ehtRegion(), 2, 0, 0, shadeParams(), 1), S.ehtFb);
    return JSON.stringify(out);
  };

  // ------------------------------------------------------------------ boot
  STUDIO.ready.then(() => {
    try {
      prewarm();
      critQueue.push({ kind: 'cur', a: P.a, inc: D.inc });
      queueSweep(D.inc, 72);
    } catch (e) {
      console.error(e && e.stack ? e.stack : String(e));
    }
    APP.ready = true;
    if (window.PANELS) window.PANELS.init();
    requestAnimationFrame(frame);
  });
})();

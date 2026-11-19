// Xenon Night: orchestration. One diffusion worker (core + plant) and 6 Monte Carlo workers, all metered by frames:
// a worker gets its next job from requestAnimationFrame only after its reply, and every reply is registered with
// STUDIO.wait so the recorder shows exactly what a live run shows.
(function () {
  'use strict';
  const STUDIO = window.STUDIO;
  const NA = 17, N = 136, H = 2.5;
  const DAY = 1440;
  const HANDOFF = 3585; // D3 11:45: fast-forward end (one 15-min step per frame), then 15 sim-min per second
  const MC_WORKERS = 6;
  const T0_REAL = performance.now();

  const APP = (window.APP = {
    phase: 'boot', frame: 0, t: 0, clock: 0, accel: 15, macro: 5, ff: 15, mcEvery: 2,
    hist: [], logs: [], logSeq: 0,
    f: null, fPrev: null, fT: 0, fPrevT: 0, fSeq: 0,
    asm: new Float32Array(NA * NA), asmDelta: new Float32Array(NA * NA), asmHist: [], asmSeq: 0,
    solve: null, bench: null, steps: [], kin: null, prec: [1, 1, 1, 1, 1, 1], solves: 0, outersTotal: 0,
    rods: [], dropRod: 6, dropAt: 2 * DAY + 23 * 60, dropped: false, rodSteps: 210,
    diffBusy: false, diffMs: 0, ppmEq: 0, xeEq: 0, bankWorth: 0, fuelScale: 1, kNoXe: 1,
    xePeaks: [], qptrMax: 1, fxyMax: 1, handoffPage: null, dataSeq: 0, kinSeq: 0,
    solveTimes: [], // frame-clock times of finished solves (for solves/s)
    mc: null, perfSeries: [],
    ctl: {
      demand: 100, ramp: 1.0, accel: 15, steps: 210, auto: true, ppm: 0, ppmLimit: 2.0, drop: 'SW', xenon: true,
      doppler: -2.5, modOn: true, mtc: -15, b2: 0.8e-4, omega: 1.6, tolK: 1e-6, tolS: 1e-5, mcN: 20000, mcInactive: 50,
      layer: 'POWER',
    },
  });

  // ---------- logging ----------
  function addLog(t, kind, text) {
    APP.logs.push({ t, kind, text, seq: ++APP.logSeq });
    if (APP.logs.length > 500) APP.logs.splice(0, APP.logs.length - 500);
  }
  APP.addLog = addLog;

  // ---------- diffusion worker ----------
  const diff = new Worker('diff-worker.js');
  let diffResolve = null;
  diff.onmessage = (e) => {
    const d = e.data;
    APP.diffBusy = false;
    ingest(d);
    if (diffResolve) {
      const r = diffResolve;
      diffResolve = null;
      r();
    }
  };
  function diffPost(msg) {
    APP.diffBusy = true;
    STUDIO.wait(new Promise((res) => (diffResolve = res)));
    diff.postMessage(msg);
  }

  function ingest(d) {
    const now = performance.now();
    if (d.type === 'boot') {
      APP.bench = d.bench;
      APP.bankWorth = d.bankWorth;
      APP.ppmEq = d.ppmEq;
      APP.xeEq = d.xeEq;
      APP.rods = d.rods;
      APP.dropRod = d.dropRod;
      APP.dropAt = d.dropAt;
      APP.fuelScale = d.fuelScale;
      APP.aD = d.aD;
      APP.aM = d.aM;
      APP.phase = 'ff';
      mcSetMaterial(d.mat, 'boot');
    }
    for (const l of d.logs) addLog(l.t, l.kind, l.text);
    APP.t = d.t;
    const r = d.rec;
    APP.hist.push(r);
    APP.rodSteps = d.rodSteps;
    APP.dropped = d.dropped;
    APP.kNoXe = d.kNoXe;
    APP.solves = d.solves;
    APP.outersTotal = d.outersTotal;
    APP.diffMs = d.stepMs;
    APP.prec = d.prec;
    if (d.solve) {
      APP.solve = d.solve;
      APP.solveSeq = (APP.solveSeq || 0) + 1;
    }
    APP.steps.push({ t: d.t, outers: r.outers, solves: r.solves });
    if (APP.steps.length > 400) APP.steps.shift();
    for (let i = 0; i < r.solves; i++) APP.solveTimes.push(now);
    if (d.kin) {
      APP.kin = d.kin;
      APP.kinSeq++;
    }
    // assembly powers and their change versus 1 sim-hour ago
    APP.asm = d.asm;
    APP.asmHist.push({ t: d.t, a: d.asm });
    while (APP.asmHist.length > 2 && APP.asmHist[1].t <= d.t - 60) APP.asmHist.shift();
    const ref = APP.asmHist[0];
    for (let a = 0; a < NA * NA; a++) APP.asmDelta[a] = d.asm[a] - ref.a[a];
    APP.asmRefT = ref.t;
    APP.asmSeq++;
    if (d.f) {
      APP.fPrev = APP.f || d.f;
      APP.fPrevT = APP.f ? APP.fT : d.t;
      APP.f = d.f;
      APP.fT = d.t;
      APP.fSeq++;
    }
    if (d.mat) mcSetMaterial(d.mat, 'step');
    // peaks and extremes
    if (r.qptr > APP.qptrMax && APP.dropped) APP.qptrMax = r.qptr;
    if (r.qptr > APP.qptrMax2 || !APP.qptrMax2) APP.qptrMax2 = r.qptr;
    if (r.fxy > APP.fxyMax) APP.fxyMax = r.fxy;
    xenonPeaks(r);
    APP.dataSeq++;
  }

  // xenon pit after each 100 -> 50% ramp: most negative worth from 20:00 until the next 20:00
  function xenonPeaks(r) {
    if (r.t < 20 * 60) return;
    const night = Math.floor((r.t - 20 * 60) / DAY); // night index: 0 = D1 20:00
    let p = APP.xePeaks[night];
    if (!p) p = APP.xePeaks[night] = { night, xe: 0, t: r.t };
    if (r.xe < p.xe) {
      p.xe = r.xe;
      p.t = r.t;
    }
  }

  // ---------- Monte Carlo ----------
  const mcw = [];
  const MC = (APP.mc = {
    ready: false, busy: 0, gen: 0, genRun: 0, run: 0, n: 20000, inactive: 50, sites: null, kPrev: 1,
    kg: [], H: [], mean: [], sig: [], act: { n: 0, s: 0, s2: 0 }, kMean: 0, kSig: 0, kDiff: 1, matT: 0,
    total: 0, histT: [], tracks: [], trackSeq: 0, workerMs: new Float32Array(MC_WORKERS), workerN: new Float32Array(MC_WORKERS),
    pending: [], collisions: 0, flights: 0, leak: 0, last: null, runStartT: 0, seq: 0, workerHist: [],
    gk: [], runs: [], period: 1000 / 60, lastDispatch: 0,
  });
  const mcRng = STUDIO.rng(20261119);
  for (let i = 0; i < MC_WORKERS; i++) {
    const w = new Worker('mc-worker.js');
    w.onmessage = (e) => mcReply(i, e.data);
    mcw.push(w);
  }
  let mcResolve = null;
  function mcSetMaterial(m, why) {
    if (MC.act && MC.act.n >= 30) MC.prev = { kMean: MC.kMean, kSig: MC.kSig, kStd: MC.kStd, kDiff: MC.kDiff, n: MC.act.n, matT: MC.matT, run: MC.run };
    for (const w of mcw) w.postMessage({ type: 'mat', m });
    MC.kDiff = m.k;
    MC.matT = m.t;
    MC.genRun = 0;
    MC.run++;
    MC.kg = [];
    MC.H = [];
    MC.mean = [];
    MC.sig = [];
    MC.act = { n: 0, s: 0, s2: 0 };
    MC.kMean = 0;
    MC.kSig = 0;
    MC.runStartT = m.t;
    MC.runs.push({ run: MC.run, start: MC.gen, matT: m.t, kDiff: m.k });
    if (MC.runs.length > 8) MC.runs.shift();
    if (!MC.sites) {
      // initial source: uniform over fuel cells
      const fuel = [];
      for (let c = 0; c < N * N; c++) if (m.NSF[c] > 0) fuel.push(c);
      MC.sites = new Float32Array(2 * MC.n);
      for (let i = 0; i < MC.n; i++) {
        const c = fuel[(mcRng() * fuel.length) | 0];
        MC.sites[2 * i] = ((c % N) + mcRng()) * H;
        MC.sites[2 * i + 1] = (((c / N) | 0) + mcRng()) * H;
      }
    }
    MC.ready = true;
    if (why !== 'boot') addLog(m.t, 'mc', `new snapshot, k_diff ${m.k.toFixed(5)}, ${MC.inactive} inactive`);
    else addLog(m.t, 'mc', `6 workers × ${MC.n / MC_WORKERS | 0} n/gen, delta tracking`);
  }
  // the result to quote: the current run once it has 30 active generations, otherwise the previous run
  APP.mcShown = () => {
    if (MC.act.n >= 30 || !MC.prev) return { kMean: MC.kMean, kSig: MC.kSig, kStd: MC.kStd || 0, kDiff: MC.kDiff, n: MC.act.n, prev: false, run: MC.run };
    return { ...MC.prev, prev: true };
  };
  function mcDispatch() {
    if (!MC.ready || MC.busy) return;
    // every frame in real time; every second frame while the diffusion worker fast-forwards (not recorded)
    if (APP.frame % (APP.phase === 'rt' ? APP.mcEvery : 2) !== 0) return;
    MC.busy = MC_WORKERS;
    MC.pending = [];
    if (MC.lastDispatch) MC.period = APP.now - MC.lastDispatch; // frame-clock time per generation
    MC.lastDispatch = APP.now;
    const per = Math.floor(MC.n / MC_WORKERS);
    STUDIO.wait(new Promise((res) => (mcResolve = res)));
    for (let i = 0; i < MC_WORKERS; i++) {
      const n = i === MC_WORKERS - 1 ? MC.n - per * (MC_WORKERS - 1) : per;
      const sites = MC.sites.slice(2 * per * i, 2 * (per * i + n));
      const seed = (Math.imul(MC.gen + 1, 2654435761) ^ Math.imul(i + 1, 40503) ^ 0x5bd1e995) >>> 0;
      mcw[i].postMessage({ type: 'gen', sites, n, seed, k: MC.kPrev, tracks: 1, id: i, gen: MC.gen }, [sites.buffer]);
    }
  }
  const RealDate = Object.getPrototypeOf(Date).now ? Object.getPrototypeOf(Date) : Date;
  const realNow = () => (STUDIO.mode === 'render' ? RealDate.now() : performance.now());
  APP.jsExtra = 0;
  APP.jsSeries = [];
  function mcReply(i, r) {
    const tP = RealDate.now();
    const tR = realNow();
    try {
      mcReply2(i, r);
    } finally {
      APP.jsExtra += realNow() - tR;
      if (window.__PROF && MC.busy === 0) {
        const e = window.__PROF.mcCombine || (window.__PROF.mcCombine = { n: 0, sum: 0, max: 0 });
        const d = RealDate.now() - tP;
        e.n++;
        e.sum += d;
        if (d > e.max) e.max = d;
      }
    }
  }
  function mcReply2(i, r) {
    MC.pending[i] = r;
    MC.workerMs[i] = r.ms;
    MC.busy--;
    if (MC.busy > 0) return;
    // combine the generation
    const now = performance.now();
    let score = 0, n = 0, nb = 0, coll = 0, flights = 0, leak = 0;
    for (const p of MC.pending) {
      score += p.score;
      n += p.n;
      nb += p.bank.length / 2;
      coll += p.coll;
      flights += p.flights;
      leak += p.leak;
    }
    const kg = score / n;
    if (!MC.bankBuf || MC.bankBuf.length < nb * 2) MC.bankBuf = new Float32Array(Math.ceil(nb * 2 * 1.3));
    const bank = MC.bankBuf;
    let o = 0;
    for (const p of MC.pending) {
      bank.set(p.bank, o);
      o += p.bank.length;
    }
    // Shannon entropy of the fission source on the 17 x 17 assembly grid
    const bins = new Float64Array(NA * NA);
    for (let j = 0; j < nb; j++) {
      const bx = Math.min(NA - 1, (bank[2 * j] / 20) | 0), by = Math.min(NA - 1, (bank[2 * j + 1] / 20) | 0);
      bins[by * NA + bx]++;
    }
    let Hs = 0;
    for (let j = 0; j < NA * NA; j++) if (bins[j] > 0) {
      const p = bins[j] / nb;
      Hs -= p * Math.log2(p);
    }
    MC.bins = bins;
    // resample the bank to N sites (systematic resampling)
    if (!MC.sitesB || MC.sitesB.length !== 2 * MC.n) MC.sitesB = new Float32Array(2 * MC.n);
    const ns = MC.sitesB;
    if (nb > 0) {
      const step = nb / MC.n;
      let u = mcRng() * step;
      for (let j = 0; j < MC.n; j++) {
        const s = Math.min(nb - 1, Math.floor(u));
        ns[2 * j] = bank[2 * s];
        ns[2 * j + 1] = bank[2 * s + 1];
        u += step;
      }
      MC.sitesB = MC.sites;
      MC.sites = ns;
    }
    MC.kPrev = kg;
    MC.gen++;
    MC.genRun++;
    MC.total += n;
    MC.collisions += coll;
    MC.flights += flights;
    MC.leak += leak;
    MC.histT.push([now, n]);
    while (MC.histT.length > 2 && MC.histT[0][0] < now - 1000) MC.histT.shift();
    MC.workerHist.push(MC.pending.map((p) => p.n));
    if (MC.workerHist.length > 60) MC.workerHist.shift();
    const active = MC.genRun > MC.inactive;
    if (active) {
      const A = MC.act;
      A.n++;
      A.s += kg;
      A.s2 += kg * kg;
      MC.kMean = A.s / A.n;
      const v = A.n > 1 ? (A.s2 - A.s * A.s / A.n) / (A.n - 1) : 0;
      MC.kSig = A.n > 1 ? Math.sqrt(Math.max(0, v) / A.n) : 0; // sigma of the mean
      MC.kStd = A.n > 1 ? Math.sqrt(Math.max(0, v)) : 0; // per-generation spread
    }
    MC.kg.push(kg);
    MC.H.push(Hs);
    MC.mean.push(active ? MC.kMean : NaN);
    MC.sig.push(active ? MC.kSig : NaN);
    MC.last = { kg, H: Hs, nb, coll, flights, leak, n, shares: MC.pending.map((q) => q.n) };
    for (const p of MC.pending) for (const tr of p.tracks) {
      MC.tracks.push({ p: tr, born: APP.frame, seq: ++MC.trackSeq });
    }
    if (MC.tracks.length > 300) MC.tracks.splice(0, MC.tracks.length - 300);
    if (MC.genRun % 50 === 0) {
      const tag = active ? `mean ${MC.kMean.toFixed(5)}±${(MC.kSig * 1e5).toFixed(0)}` : 'inactive';
      addLog(APP.t, 'mc', `gen ${MC.genRun} k ${kg.toFixed(5)} H ${Hs.toFixed(3)} ${tag}`);
    }
    MC.gk.push({ g: MC.gen, k: kg, H: Hs, run: MC.run, act: active, mean: active ? MC.kMean : NaN, sig: active ? MC.kSig : NaN });
    if (MC.gk.length > 900) MC.gk.splice(0, MC.gk.length - 900);
    MC.seq++;
    if (mcResolve) {
      const r2 = mcResolve;
      mcResolve = null;
      r2();
    }
  }

  // ---------- frame loop ----------
  let lastNow = null, lastReport = -1e9;
  function frame(now) {
    requestAnimationFrame(frame);
    const tJs = realNow();
    APP.frame++;
    APP.now = now;
    const dt = lastNow === null ? 1000 / 60 : Math.min(100, now - lastNow);
    lastNow = now;
    // diffusion: boot, fast-forward, then real time
    if (!APP.diffBusy) {
      if (APP.phase === 'boot' && !APP.booting) {
        APP.booting = true;
        diffPost({ type: 'boot' });
      } else if (APP.phase === 'ff') {
        if (APP.t + APP.ff <= HANDOFF) {
          const last = APP.t + APP.ff >= HANDOFF;
          diffPost({ type: 'step', dt: APP.ff, fast: true, full: last, mat: last });
        } else {
          APP.phase = 'rt';
          APP.handoffPage = now;
          APP.handoffT = APP.t;
        }
      }
      if (APP.phase === 'rt') {
        const target = APP.handoffT + (now - APP.handoffPage) / 1000 * APP.accel;
        if (target >= APP.t + APP.macro) {
          const tNext = APP.t + APP.macro;
          const mat = Math.round(tNext) % 120 === 0 && tNext - MC.matT >= 120;
          diffPost({ type: 'step', dt: APP.macro, full: true, mat });
        }
      }
    }
    if (APP.phase === 'rt') {
      const target = APP.handoffT + (now - APP.handoffPage) / 1000 * APP.accel;
      APP.clock = Math.min(target, APP.t + APP.macro);
    } else APP.clock = APP.t;
    mcDispatch();
    // perf samples for the frame-time trace (kit numbers: recorded live values in render mode)
    if (APP.frame % 15 === 0) {
      const p = STUDIO.perf();
      APP.perfSeries.push({ t: now, fps: p.fps, ms: p.frameMs });
      if (APP.perfSeries.length > 120) APP.perfSeries.shift();
    }
    while (APP.solveTimes.length && APP.solveTimes[0] < now - 2000) APP.solveTimes.shift();
    if (window.UI && APP.f) window.UI.frame(APP, now, dt);
    if (now - lastReport > 1000 && APP.bench) {
      lastReport = now;
      report();
    }
    APP.jsSeries.push(realNow() - tJs + APP.jsExtra);
    APP.jsExtra = 0;
    if (APP.jsSeries.length > 240) APP.jsSeries.shift();
  }
  function report() {
    const r = APP.hist.at(-1) || {};
    const peaks = APP.xePeaks.filter(Boolean);
    const pk = peaks.at(-1);
    const MCs = APP.mc;
    const fmtClock = window.UI ? window.UI.clock : (t) => t;
    STUDIO.report({
      keff_benchmark: `${APP.bench.k.toFixed(5)} (ref 1.02959, Δ ${APP.bench.dpcm.toFixed(1)} pcm)`,
      xenon_worth_pcm: Math.round(r.xe),
      xenon_peak_pcm: pk ? `${Math.round(pk.xe)} pcm at ${fmtClock(pk.t)}` : null,
      qptr_max: +APP.qptrMax.toFixed(4),
      fxy_max: +APP.fxyMax.toFixed(3),
      keff_mc: (() => {
        const q = APP.mcShown();
        return q.n > 1 ? `${q.kMean.toFixed(5)} ± ${(q.kSig * 1e5).toFixed(0)} pcm (Δ MC−diffusion ${((q.kMean - q.kDiff) * 1e5).toFixed(0)} pcm, ${q.n} active gens)` : null;
      })(),
      neutrons_tracked: MCs.total,
      boron_ppm: +APP.ppmEq.toFixed(1),
      sim_clock: fmtClock(APP.clock),
      mc_generations: MCs.gen,
    });
  }
  requestAnimationFrame(frame);
})();

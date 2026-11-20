// Every Gate: orchestration. One simulation worker (the gate-level core + golden model) and up to 12 fault workers,
// all metered by animation frames: each worker gets its next chunk from requestAnimationFrame only after its reply,
// and every reply is registered with STUDIO.wait, so the recorder shows exactly what a live run shows.
(function () {
  'use strict';
  const STUDIO = window.STUDIO;
  const NW = 15, RING = 1024;
  const PREWARM_CYCLES = 330000, PREWARM_CHUNK = 3000;
  const FAULT_BUDGET = 64; // cycles per frame per fault worker

  const D = HDL.finalize(HDL.buildCore());
  const prog = PROG.build({ maxit: 32, zoom: 2 });
  const NCELL = D.n - D.dffStart;
  const APP = (window.APP = {
    D, prog, NCELL, frame: 0, painted: false,
    cfg: { clockHz: 24000, fwd: 1, btfn: 1, maxit: 32, zoom: 2.0, lockstep: 1, sa0: 1, sa1: 1, workers: 6, testLen: 4096, V: 0.9, C: 1.2, f: 500, decay: 0.92 },
    sim: null, simReady: false, simBusy: false, prewarm: true,
    wave: new Int32Array(RING * NW), waveCyc: new Float64Array(RING), tog: new Int32Array(RING), ret: new Uint8Array(RING), head: 0, filled: 0,
    heat: new Float32Array(NCELL), flash: new Float32Array(NCELL), heatFrame: new Uint16Array(NCELL),
    hz: 0, hzHist: [], ipcHist: [], togHist: [], frameMsHist: [],
    uartLines: [], uartCur: '', thumbs: [], lastFrameNo: 0, cs: {},
    modTog: null, modTogNow: null, totTog: 0, totTogNow: 0,
    fault: null, NW, RING,
  });

  // ---------- static per-module stats (cells, DFFs, NAND2-eq, local logic depth) ----------
  (function moduleStats() {
    const M = D.mods.length;
    const anc = D.mods.map((m, i) => { const a = []; for (let k = i; k >= 0; k = D.mods[k].parent) a.push(k); return a; });
    const cells = new Float64Array(M), dff = new Float64Array(M), nand = new Float64Array(M), depth = new Float64Array(M), leafCells = new Float64Array(M);
    for (let i = D.dffStart; i < D.n; i++) {
      const m = D.mod[i], t = D.type[i];
      leafCells[m]++;
      for (const a of anc[m]) { if (t === HDL.T.DFF) dff[a]++; else cells[a]++; nand[a] += D.nandEq[t]; }
    }
    // local depth of each hierarchy node: longest path through cells inside its subtree
    const inSub = (m, node) => anc[m].includes(node);
    const ld = new Int32Array(D.n);
    for (let node = 0; node < M; node++) {
      let best = 0;
      for (let g = D.gateStart; g < D.n; g++) {
        if (!inSub(D.mod[g], node)) { ld[g] = 0; continue; }
        const t = D.type[g];
        let v = ld[D.inA[g]];
        if (t !== HDL.T.NOT) v = Math.max(v, ld[D.inB[g]]);
        if (t === HDL.T.MUX) v = Math.max(v, ld[D.inS[g]]);
        ld[g] = v + 1;
        if (ld[g] > best) best = ld[g];
      }
      depth[node] = best;
      ld.fill(0);
    }
    APP.modStats = { anc, cells, dff, nand, depth, leafCells };
    APP.modTog = new Float64Array(M); APP.modTogNow = new Float64Array(M);
    APP.win = { slots: [], n: 0, tot: 0, mod: new Float64Array(M) };
    APP.snap = { tog: 0, mod: new Float64Array(M) };
    // critical path segments by module
    const segs = [];
    for (const i of D.critical.path) {
      const p = D.mods[D.mod[i]].path.replace(/^core\//, '');
      const name = p.split('/').slice(-1)[0];
      const t = D.type[i];
      if (segs.length && segs[segs.length - 1].p === p) segs[segs.length - 1].n += t >= HDL.T.NOT ? 1 : 0;
      else segs.push({ p, name, n: t >= HDL.T.NOT ? 1 : 0 });
    }
    APP.critSegs = segs;
  })();

  // ---------- simulation worker ----------
  const sim = new Worker('sim-worker.js');
  let simResolve = null;
  sim.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') { APP.simReady = true; APP.selftest = m.selftest; }
    else if (m.type === 'run') ingest(m);
    APP.simBusy = false;
    if (simResolve) { const r = simResolve; simResolve = null; r(); }
  };
  function simPost(msg) {
    APP.simBusy = true;
    STUDIO.wait(new Promise((res) => (simResolve = res)));
    sim.postMessage(msg);
  }
  simPost({ type: 'init', cfg: { fwd: 1, btfn: 1, maxit: 32, zoom: 2 } });

  function ingest(m) {
    const now = performance.now();
    APP.sim = m;
    APP.workMs = APP.workMs ? APP.workMs * 0.9 + m.workMs * 0.1 : m.workMs;
    if (m.workMs > 0 && !APP.prewarm) { const c = (m.n / m.workMs) * 1000; APP.cap = APP.cap ? APP.cap * 0.9 + c * 0.1 : c; }
    for (let c = 0; c < m.n; c++) {
      const h = APP.head;
      APP.wave.set(m.wave.subarray(c * NW, c * NW + NW), h * NW);
      APP.waveCyc[h] = m.cyc - m.n + c;
      APP.tog[h] = m.togCyc[c]; APP.ret[h] = m.retCyc[c];
      APP.head = (h + 1) % RING;
    }
    APP.filled = Math.min(RING, APP.filled + m.n);
    // heat: any toggle lights a cell, frequent toggling saturates it
    const hf = APP.heatFrame, ht = m.heat, st = D.dffStart, n = m.n;
    for (let k = 0; k < NCELL; k++) {
      const t = ht[st + k];
      hf[k] = t;
      if (t) { const x = Math.min(1, 0.2 + (t / n) * 2.2); if (x > APP.heat[k]) APP.heat[k] = x; }
      if (m.recent[st + k]) APP.flash[k] = 1;
    }
    // per-module toggles this chunk -> toggles per cycle (EMA for the table, instant for the floorplan)
    const MT = APP.modTogNow; MT.fill(0);
    const anc = APP.modStats.anc;
    let tot = 0;
    for (let i = st; i < D.n; i++) { const t = ht[i]; if (t) { tot += t; for (const a of anc[D.mod[i]]) MT[a] += t; } }
    const W = APP.win;
    const raw = MT.slice();
    W.slots.push({ n, tot, raw }); W.n += n; W.tot += tot;
    for (let k = 0; k < raw.length; k++) W.mod[k] += raw[k];
    if (W.slots.length > 60) { const o = W.slots.shift(); W.n -= o.n; W.tot -= o.tot; for (let k = 0; k < o.raw.length; k++) W.mod[k] -= o.raw[k]; }
    for (let k = 0; k < MT.length; k++) { MT[k] /= n; APP.modTog[k] = APP.modTog[k] ? APP.modTog[k] * 0.92 + MT[k] * 0.08 : MT[k]; }
    APP.totTogNow = tot / n;
    APP.totTog = APP.totTog ? APP.totTog * 0.92 + APP.totTogNow * 0.08 : APP.totTogNow;
    // throughput against the frame clock
    APP.hzHist.push([now, m.cyc]);
    while (APP.hzHist.length > 2 && now - APP.hzHist[0][0] > 1000) APP.hzHist.shift();
    if (APP.hzHist.length > 1) { const a = APP.hzHist[0], b = APP.hzHist[APP.hzHist.length - 1]; APP.hz = b[0] > a[0] ? ((b[1] - a[1]) * 1000) / (b[0] - a[0]) : 0; }
    let r = 0; for (let c = 0; c < n; c++) r += m.retCyc[c];
    APP.ipcHist.push(r / n); if (APP.ipcHist.length > 600) APP.ipcHist.shift();
    APP.togHist.push(tot / n); if (APP.togHist.length > 600) APP.togHist.shift();
    // UART lines
    for (const b of m.uart) {
      if (b === 10) {
        APP.uartLines.push({ s: APP.uartCur, cyc: m.cyc });
        const mm = APP.uartCur.match(/^f=(\d+) it=(\d+) cs=([0-9a-f]+)/);
        if (mm) APP.cs[+mm[1]] = { it: +mm[2], cs: mm[3] };
        APP.uartCur = '';
        if (APP.uartLines.length > 300) APP.uartLines.shift();
      } else APP.uartCur += String.fromCharCode(b);
    }
    for (const fd of m.frames) APP.thumbs.push(fd);
    if (APP.thumbs.length > 8) APP.thumbs.splice(0, APP.thumbs.length - 8);
    if (!APP.painted && m.cyc >= 24000) APP.painted = true;
  }

  // ---------- fault workers ----------
  const FW = [];
  const NU = 2 * NCELL;
  const FA = (APP.fault = {
    perm: null, ptr: 0, universe: NU, workers: FW, batchSeq: 0,
    sim: 0, det: 0, latSum: 0, hist: new Int32Array(13), curve: [], undet: [], perMod: new Float64Array(D.mods.length * 2), undetNets: [],
    cyclesTotal: 0, batches: 0, rateHist: [],
  });
  (function perm() {
    const rnd = STUDIO.rng(4242);
    const p = new Int32Array(NU);
    for (let i = 0; i < NU; i++) p[i] = i;
    for (let i = NU - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    FA.perm = p;
  })();
  function spawnFault(k) {
    const w = { id: k, w: new Worker('fault-worker.js'), ready: false, busy: false, batch: null, resolve: null, done: 0, cyc: 0 };
    w.w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') w.ready = true;
      else if (m.type === 'work') { faultReply(w, m); w.ms = w.ms ? w.ms * 0.9 + m.workMs * 0.1 : m.workMs; }
      w.busy = false;
      if (w.resolve) { const r = w.resolve; w.resolve = null; r(); }
    };
    w.busy = true;
    STUDIO.wait(new Promise((res) => (w.resolve = res)));
    w.w.postMessage({ type: 'init', id: k, maxit: 32, zoom: 2 });
    FW.push(w);
  }
  for (let k = 0; k < APP.cfg.workers; k++) spawnFault(k);

  function nextFaults() {
    const out = [];
    while (out.length < 31 && FA.ptr < NU) {
      const idx = FA.perm[FA.ptr++];
      const sa = idx & 1;
      if ((sa && !APP.cfg.sa1) || (!sa && !APP.cfg.sa0)) continue;
      out.push([D.dffStart + (idx >> 1), sa]);
    }
    return out;
  }
  function faultReply(w, m) {
    const b = w.batch;
    if (!b || b.id !== m.batchId) return;
    FA.cyclesTotal += m.cyc - b.cyc;
    b.cyc = m.cyc; b.det = m.det; b.detCyc = m.detCyc;
    if (m.done) {
      b.done = true;
      FA.batches++;
      w.done++;
      for (let l = 1; l <= b.faults.length; l++) {
        const [net, sa] = b.faults[l - 1];
        const det = (m.det >>> l) & 1;
        FA.sim++;
        const anc = APP.modStats.anc[D.mod[net]];
        for (const a of anc) { FA.perMod[a * 2 + 1]++; if (det) FA.perMod[a * 2]++; }
        if (det) {
          FA.det++;
          const c = m.detCyc[l];
          FA.latSum += c;
          FA.hist[Math.min(12, c < 1 ? 0 : Math.floor(Math.log2(c)) + 1)]++;
        } else {
          FA.undet.push({ net, sa, batch: b.id });
          FA.undetNets.push(net);
          if (FA.undet.length > 200) FA.undet.shift();
        }
      }
      FA.curve.push([FA.sim, FA.det]);
      FA.rateHist.push([performance.now(), FA.sim]);
      while (FA.rateHist.length > 2 && FA.rateHist[0][0] < performance.now() - 3000) FA.rateHist.shift();
      if (FA.rateHist.length > 1) { const a = FA.rateHist[0], b = FA.rateHist[FA.rateHist.length - 1]; APP.faultRate = b[0] > a[0] ? ((b[1] - a[1]) * 1000) / (b[0] - a[0]) : 0; }
    }
  }
  const faultRng = STUDIO.rng(9001);
  function dispatchFaults() {
    for (const w of FW) {
      if (w.id >= APP.cfg.workers || !w.ready || w.busy) continue;
      if (APP.frame < w.id * 11) continue; // staggered starts so the six batches are spread across the 64-frame test
      const msg = { type: 'work', id: w.id, budget: FAULT_BUDGET - 24 + Math.floor(faultRng() * 49) };
      if (!w.batch || w.batch.done) {
        const f = nextFaults();
        if (!f.length) continue;
        if (w.batch) w.prev = w.batch;
        w.batch = { id: ++FA.batchSeq, faults: f, cyc: 0, det: 0, detCyc: null, done: false, len: APP.cfg.testLen, t0: performance.now() };
        msg.batch = { id: w.batch.id, faults: f, len: APP.cfg.testLen, fwd: APP.cfg.fwd, btfn: APP.cfg.btfn };
      }
      w.busy = true;
      STUDIO.wait(new Promise((res) => (w.resolve = res)));
      w.w.postMessage(msg);
    }
  }
  APP.setWorkers = (n) => { APP.cfg.workers = n; while (FW.length < n) spawnFault(FW.length); };

  // ---------- frame loop ----------
  let lastReport = 0, lastT = performance.now();
  function frame(now) {
    APP.frame++;
    const dt = now - lastT; lastT = now;
    // frame-time trace: measured here in a live run; in the recorder, the kit's numbers recorded during the live run
    APP.frameMsHist.push(STUDIO.mode === 'render' ? STUDIO.perf().frameMs : dt); if (APP.frameMsHist.length > 240) APP.frameMsHist.shift();
    // frame-indexed schedule: the prewarm free-runs 3000 cycles per frame, then the clock target per frame.
    // The worker always runs the gap to the schedule, so the state at a given frame does not depend on start-up time.
    APP.sched = (APP.sched || 0) < PREWARM_CYCLES ? Math.min(PREWARM_CYCLES, (APP.sched || 0) + PREWARM_CHUNK) : APP.sched + APP.cfg.clockHz / 60;
    const simCyc = APP.sim ? APP.sim.cyc : 0;
    APP.prewarm = simCyc < PREWARM_CYCLES;
    if (APP.simReady && !APP.simBusy && Math.round(APP.sched - simCyc) > 0) {
      const cycles = Math.min(6000, Math.round(APP.sched - simCyc));
      simPost({ type: 'run', cycles, cfg: { fwd: APP.cfg.fwd, btfn: APP.cfg.btfn, lockstep: APP.cfg.lockstep, maxit: APP.cfg.maxit, zoom: APP.cfg.zoom } });
    }
    dispatchFaults();
    // shared 1 s statistics, refreshed 4x per second; every panel that shows them redraws on that same frame
    if (APP.win.n && (APP.frame % 15 === 0 || !APP.snap.tog)) APP.snap = { tog: APP.win.tot / APP.win.n, mod: APP.win.mod.map((v) => v / APP.win.n), frame: APP.frame };
    const k = APP.cfg.decay;
    const ht = APP.heat;
    const fl = APP.flash;
    for (let i = 0; i < NCELL; i++) { ht[i] *= k; fl[i] *= 0.62; }
    if (APP.painted) PANELS.draw(now);
    if (now - lastReport > 1000 && APP.sim) { lastReport = now; report(); }
    requestAnimationFrame(frame);
  }

  function wilson(d, n) {
    if (!n) return [0, 0, 1];
    const z = 1.96, p = d / n, z2 = z * z;
    const c = (p + z2 / (2 * n)) / (1 + z2 / n), h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    return [p, c - h, c + h];
  }
  APP.wilson = wilson;

  function report() {
    const s = APP.sim, C = s.C;
    const [p, lo, hi] = wilson(FA.det, FA.sim);
    STUDIO.report({
      gate_count: `${(D.n - D.gateStart).toLocaleString('en-US')} logic cells + ${D.nDff.toLocaleString('en-US')} DFFs (${Math.round(APP.modStats.nand[0]).toLocaleString('en-US')} NAND2-eq)`,
      sim_hz: Math.round(APP.hz),
      gate_evals_per_s: Math.round(APP.hz * (D.n - D.gateStart)),
      instret: s.instret,
      lockstep_divergences: s.div,
      lockstep_checked: s.checked,
      ipc: +(s.instret / s.cyc).toFixed(3),
      branch_accuracy: C.br ? `${((1 - C.misp / C.br) * 100).toFixed(1)}% (${C.br - C.misp}/${C.br})` : '-',
      fault_coverage: FA.sim ? `${(p * 100).toFixed(1)}% (95% Wilson ${(lo * 100).toFixed(1)}-${(hi * 100).toFixed(1)}%, ${FA.sim} of ${NU} faults)` : '-',
      crit_path_levels: D.critical.levels,
      isa_selftest: APP.selftest ? `${APP.selftest.passed}/${APP.selftest.programs} random programs, ${APP.selftest.retired} instructions, ${APP.selftest.div} divergences` : '-',
      cycles: s.cyc,
      mandelbrot_frames_done: s.params[5],
    });
  }

  STUDIO.ready.then(() => {
    PANELS.init(APP);
    requestAnimationFrame(frame);
  });
})();

// Reentry: pseudo-ECG from the tissue's own currents and an ECG measurement pipeline.
// Phi_e = -sum_faces mask * grad_h(u) . grad_h(1/r_e) on the 256 x 256 grid (2 x 2 averages of u). Summation by parts
// gives Phi_e = sum_cells u * W_e with W_e = div_h(mask * grad_h(1/r_e)): the exact discrete adjoint of the gradient,
// so the GPU only needs one multiply-add per cell and electrode. Sign as in Gima and Rudy: a wavefront moving toward
// an electrode gives a positive deflection.
(function () {
  const RE = window.RE;
  const N = RE.N, M = 256;
  RE.LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  RE.ELECTRODES = ['RA', 'LA', 'LL', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

  RE.makeElectrodes = function (A) {
    // ventricular centroid and extent
    let sx = 0, sy = 0, n = 0, minx = N, maxx = 0, miny = N, maxy = 0;
    for (let i = 0; i < N * N; i++) {
      const t = A.type[i];
      if (t === RE.T.MYO || t === RE.T.BZ) {
        const x = i % N, y = (i / N) | 0;
        sx += x; sy += y; n++;
        minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
    }
    const cx = sx / n, cy = sy / n;
    const o = RE.electrodeOpt || {};
    const rx = (maxx - minx) / 2 + (o.pad ?? 24), ry = (maxy - miny) / 2 + (o.pad ?? 24) - 10;
    const deg = Math.PI / 180;
    // precordial electrodes on an arc around the ventricles (anterior, z offset), V1 over the RV ... V6 lateral LV
    const angs = o.angs || [198, 162, 128, 92, 60, 28];
    let prec;
    if (o.frame !== false && A.F) {
      // a smooth elliptical arc in the heart's own frame (u across, w along the tilted long axis), fitted to the
      // ventricles' extent in that frame plus a margin, so the arc follows the slice; electrodes sit at height z
      // above the slice (anterior chest)
      let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9, su = 0, sw = 0, nn = 0;
      for (let i = 0; i < N * N; i++) {
        const t = A.type[i];
        if (t !== RE.T.MYO && t !== RE.T.BZ) continue;
        const h = A.F.toHeart(i % N, (i / N) | 0);
        u0 = Math.min(u0, h.u); u1 = Math.max(u1, h.u); w0 = Math.min(w0, h.w); w1 = Math.max(w1, h.w);
        su += h.u; sw += h.w; nn++;
      }
      const cu = su / nn, cw = sw / nn, pad = o.pad ?? 24;
      const ru = (u1 - u0) / 2 + pad, rw = (w1 - w0) / 2 + pad;
      const cwOff = (w0 + w1) / 2 - cw;
      prec = angs.map((a, i) => {
        const p = A.F.toImg(cu + ru * Math.cos(a * deg), cw + cwOff + rw * Math.sin(a * deg));
        return { name: 'V' + (i + 1), x: p.x, y: p.y, z: o.z ?? 90 };
      });
    } else prec = angs.map((a, i) => ({ name: 'V' + (i + 1), x: cx + rx * Math.cos(a * deg), y: cy + ry * Math.sin(a * deg) + 10, z: o.z ?? 90 }));
    // limb electrodes on an Einthoven triangle around the slice
    const L = o.limb ?? 520;
    const limb = [
      { name: 'RA', x: cx - 0.77 * L, y: cy - 0.64 * L, z: 0 },
      { name: 'LA', x: cx + 0.77 * L, y: cy - 0.64 * L, z: 0 },
      { name: 'LL', x: cx + 0.15 * L, y: cy + 1.05 * L, z: 0 },
    ];
    return { list: [...limb, ...prec], center: { x: cx, y: cy } };
  };

  // weights W_e on the coarse grid, packed for the GPU as 3 stacked 256 x 256 RGBA groups
  RE.ecgWeights = function (A, E) {
    const mask = new Uint8Array(M * M);
    for (let r = 0; r < M; r++)
      for (let c = 0; c < M; c++) {
        let k = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (A.D[(2 * r + dy) * N + 2 * c + dx] > 0) k++;
        mask[r * M + c] = k >= 2 ? 1 : 0;
      }
    const out = new Float32Array(M * 768 * 4);
    const phi = new Float64Array(M * M);
    E.list.forEach((e, ei) => {
      for (let r = 0; r < M; r++)
        for (let c = 0; c < M; c++) {
          const x = 2 * c + 1, y = 2 * r + 1;
          phi[r * M + c] = 1000 / Math.sqrt((x - e.x) ** 2 + (y - e.y) ** 2 + e.z * e.z);
        }
      const g = (ei / 4) | 0, ch = ei % 4;
      for (let r = 1; r < M - 1; r++)
        for (let c = 1; c < M - 1; c++) {
          const i = r * M + c;
          if (!mask[i]) continue;
          let w = 0;
          for (const j of [i + 1, i - 1, i + M, i - M]) if (mask[j]) w += phi[j] - phi[i];
          out[((r + 256 * g) * M + c) * 4 + ch] = w;
        }
    });
    return { w: out, mask };
  };

  // second-order sections (RBJ cookbook)
  function biquad(type, f0, fs, Q) {
    const w = (2 * Math.PI * f0) / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  const runBq = (f, x) => {
    const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  };

  // ECG store, filters and measurements
  class ECG {
    constructor(dtSample, cap) {
      this.dt = dtSample; // ms between samples
      this.fs = 1000 / dtSample;
      this.cap = cap || 16384;
      this.n = 0; // samples written
      this.t = new Float64Array(this.cap);
      this.raw = RE.LEADS.map(() => new Float32Array(this.cap));
      this.flt = RE.LEADS.map(() => new Float32Array(this.cap));
      this.el = RE.ELECTRODES.map(() => new Float32Array(this.cap)); // electrode potentials vs WCT (mV)
      this.sv = new Float32Array(this.cap);
      this.filters = RE.LEADS.map(() => [biquad('hp', 0.5, this.fs, 0.707), biquad('lp', 40, this.fs, 0.707)]);
      this.gain = null;
      this.useFilter = true;
      // Pan-Tompkins state
      this.pt = { d: new Float32Array(this.cap), mwi: new Float32Array(this.cap), spki: 0, npki: 0, init: false, lastR: -1e9, rr: [], cands: [] };
      this.beats = [];
      this.pending = [];
      this.onBeat = null;
    }
    // freezes the gain: rescales everything stored so far (the filters and detectors are linear or quadratic in it)
    setGain(G) {
      const f = G / (this.gain ?? 1);
      for (const a of [...this.raw, ...this.flt, ...this.el]) for (let i = 0; i < a.length; i++) a[i] *= f;
      for (let i = 0; i < this.sv.length; i++) this.sv[i] *= f;
      for (let i = 0; i < this.cap; i++) { this.pt.d[i] *= f * f; this.pt.mwi[i] *= f * f; }
      this.pt.spki *= f * f;
      if (this.pt.lastSlope) this.pt.lastSlope *= f * f;
      this.pt.npki *= f * f;
      for (const fl of this.filters) for (const q of fl) { q.x1 *= f; q.x2 *= f; q.y1 *= f; q.y2 *= f; }
      for (const b of this.beats) { b.rAmp *= f; b.pAmp *= f; }
      this.gain = G;
      if (this.svPeaks && this.svPeaks.length) {
        const m = this.svPeaks.slice(-3).reduce((s, x) => s + x, 0) / Math.min(3, this.svPeaks.length);
        this.svThr = 0.09 * m * f;
      }
    }
    blank(t0, t1) {
      this.blankFrom = t0;
      this.blankTo = t1;
    }
    // detection levels of the last sinus rhythm, restored after a shock (the monitor re-acquires the sinus rhythm)
    // a stimulus marker from the stimulator (S2): intervals restart at the stimulus, levels re-learn from the
    // post-stimulus window 450 ms later, and the sinus slope reference is forgotten
    stimulus(t) {
      const P = this.pt;
      P.lastR = t;
      P.cands = [];
      P.lastSlope = null;
      P.learnFrom = t;
      P.learnAt = t + 450;
      P.rr = [];
      this.prevFid = t;
      this.prevFidK = this.n - 1 - Math.round((this.t[this.idx(this.n - 1)] - t) / this.dt);
      this.lastRR = null;
      this.tpl = null;
    }
    saveLevels() {
      const P = this.pt;
      this.saved = { spki: P.spki, npki: P.npki, lastSlope: P.lastSlope, rr: P.rr.slice() };
    }
    restoreLevels() {
      if (!this.saved) return;
      const P = this.pt;
      P.spki = this.saved.spki;
      P.npki = this.saved.npki;
      P.lastSlope = this.saved.lastSlope;
      P.rr = this.saved.rr.slice();
      P.lastLearn = this.t[this.idx(this.n - 1)];
      P.lastR = P.lastLearn; // intervals restart at the shock
      P.cands = [];
    }
    idx(k) {
      return ((k % this.cap) + this.cap) % this.cap;
    }
    // phi: 9 electrode values (arbitrary units), t: sample time (ms)
    push(t, phi) {
      const G = this.gain ?? 1;
      const [ra, la, ll, ...v] = phi.map((p) => p * G);
      const wct = (ra + la + ll) / 3;
      const leads = [la - ra, ll - ra, ll - la, ra - (la + ll) / 2, la - (ra + ll) / 2, ll - (ra + la) / 2, ...v.map((x) => x - wct)];
      const k = this.n, i = this.idx(k);
      this.t[i] = t;
      for (let j = 0; j < 12; j++) {
        this.raw[j][i] = leads[j];
        const f = this.filters[j];
        this.flt[j][i] = runBq(f[1], runBq(f[0], leads[j]));
      }
      const els = [ra, la, ll, ...v];
      for (let j = 0; j < 9; j++) this.el[j][i] = els[j] - wct;
      // spatial velocity over the 8 independent leads (I, II, V1..V6), mV per ms
      if (k > 0) {
        const p = this.idx(k - 1);
        let s = 0;
        for (const j of [0, 1, 6, 7, 8, 9, 10, 11]) {
          const d = (this.raw[j][i] - this.raw[j][p]) / this.dt;
          s += d * d;
        }
        this.sv[i] = Math.sqrt(s);
      }
      this.n++;
      this.panTompkins();
      this.flushPending(); // beats are measured as soon as their window is complete
    }
    sig(j) {
      return this.useFilter ? this.flt[j] : this.raw[j];
    }
    // measurements use the unfiltered signal (diagnostic practice: the 0.5 Hz high-pass of the display distorts ST-T
    // after large QRS complexes; this pseudo-ECG has no baseline wander, so no filtering is needed to measure)
    atM(j, k) {
      return this.raw[j][this.idx(k)];
    }
    at(j, k) {
      return this.sig(j)[this.idx(k)];
    }
    // Pan-Tompkins: derivative, square (summed over the 8 independent leads), 150 ms moving-window integration,
    // adaptive signal and noise levels with T-wave discrimination and re-learning after a pause
    panTompkins() {
      const k = this.n - 1, P = this.pt;
      if (k < 5) return;
      // multi-lead Pan-Tompkins: the five-point derivative is squared and summed over the 8 independent leads
      let d2 = 0;
      for (const j of [0, 1, 6, 7, 8, 9, 10, 11]) {
        const d = (2 * this.at(j, k) + this.at(j, k - 1) - this.at(j, k - 3) - 2 * this.at(j, k - 4)) / (8 * this.dt);
        d2 += d * d;
      }
      // defibrillation blanking: the detector input is zeroed during the shock artefact
      const tk0 = this.t[this.idx(k)];
      if (this.blankFrom !== undefined && tk0 >= this.blankFrom && tk0 < this.blankTo) d2 = 0;
      P.d[this.idx(k)] = d2;
      const W = Math.round(150 / this.dt);
      let s = 0;
      for (let q = Math.max(0, k - W + 1); q <= k; q++) s += P.d[this.idx(q)];
      P.mwi[this.idx(k)] = s / W;
      const m = (q) => P.mwi[this.idx(q)];
      // learning: the first 2 s set the initial levels
      const learn = Math.round(2000 / this.dt);
      if (!P.init) {
        if (k >= learn) {
          let mx = 0, mean = 0;
          for (let q = k - learn; q <= k; q++) { mx = Math.max(mx, m(q)); mean += m(q); }
          P.spki = mx * 0.5;
          P.npki = (mean / learn) * 0.5;
          P.init = true;
          P.from = k - learn + 1;
        }
        return;
      }
      // no QRS for max(1.0 s, 1.4 average RR): re-learn both levels (as after a pause) and forget the T-wave reference
      const tk = this.t[this.idx(k)];
      const rrRef = P.rr.length ? P.rr.slice(-8).reduce((a, x) => a + x, 0) / Math.min(8, P.rr.length) : 800;
      // a stimulus marker (S2) arms an early re-learning 450 ms later from the post-stimulus window
      const due = P.learnAt !== undefined && tk >= P.learnAt;
      if (due || tk - Math.max(P.lastR, P.lastLearn || -1e9) > Math.max(1000, 1.4 * rrRef)) {
        // the window excludes the last detected complex, so the new levels come from the new rhythm
        const from = Math.max(tk - 1200, P.lastR + 300, due ? P.learnFrom : -1e9);
        const win = Math.max(1, Math.round((tk - from) / this.dt));
        let mx = 0, mean = 0;
        for (let q = k - win; q <= k; q++) { mx = Math.max(mx, m(q)); mean += m(q); }
        P.spki = mx * 0.4;
        P.npki = (mean / (win + 1)) * 0.4;
        P.lastLearn = tk;
        P.lastSlope = null;
        P.relearned = (P.relearned || 0) + 1;
        P.learnAt = undefined;
      }
      // a local maximum of the integrated signal (checked 40 ms later)
      const L = Math.round(40 / this.dt);
      const c = k - L;
      if (c < 1) return;
      const v = m(c);
      if (!(v >= m(c - 1) && v > m(c + 1))) return;
      for (let q = c - L; q <= k; q++) if (m(q) > v) return;
      const thr1 = P.npki + 0.25 * (P.spki - P.npki);
      const tc = this.t[this.idx(c)];
      // defibrillation blanking: no detection decision and no level update during the shock artefact
      if (this.blankFrom !== undefined && tc >= this.blankFrom && tc < this.blankFrom + 220) return;
      // steepest squared slope of this candidate (P and T waves are much slower than a QRS)
      let slc = 0;
      for (let q = c - Math.round(150 / this.dt); q <= c; q++) slc = Math.max(slc, P.d[this.idx(q)]);
      // search back: an interval longer than 1.4 average RR means a missed beat; take the largest peak since the last
      // beat that clears 0.3 of the threshold
      const rrs = P.rr;
      const rrAvg = rrs.length >= 3 ? rrs.slice(-8).reduce((a, x) => a + x, 0) / Math.min(8, rrs.length) : null;
      if (rrAvg && P.lastR > 0 && tc - P.lastR > 1.4 * rrAvg) {
        let bc = null;
        for (const cd of P.cands) if (cd.t > P.lastR + 330 && cd.t < tc - 120 && (!P.lastSlope || cd.sl >= 0.2 * P.lastSlope) && (!bc || cd.v > bc.v)) bc = cd;
        if (bc && bc.v > 0.3 * thr1) {
          P.spki = 0.25 * bc.v + 0.75 * P.spki;
          this.detect(bc.c, true);
        }
      }
      // T- and P-wave discrimination: within 360 ms of the last QRS a peak whose steepest slope is under half the QRS
      // slope is a T wave (squared slopes: a quarter); at any time a peak under ~0.45 of the QRS slope (0.2 squared) is
      // a P or T wave. Re-learning forgets the reference, so a new, slower rhythm is still acquired.
      let tWave = false;
      if (v > thr1 && P.lastSlope) {
        if (tc - P.lastR < 360 ? slc < 0.25 * P.lastSlope : slc < 0.2 * P.lastSlope) tWave = true;
      }
      if (v > thr1 && tc - P.lastR > 330 && !tWave) {
        P.spki = 0.125 * v + 0.875 * P.spki;
        this.detect(c, false);
      } else if (tc - P.lastR > 300) {
        // peaks inside the 300 ms after a beat belong to the same complex and do not count as noise
        P.npki = 0.125 * v + 0.875 * P.npki;
        P.cands.push({ c, v, t: tc, sl: slc });
        if (P.cands.length > 40) P.cands.shift();
      }
      this.flushPending();
    }
    detect(c, sb) {
      const P = this.pt;
      let sl = 0;
      for (let q = c - Math.round(150 / this.dt); q <= c; q++) sl = Math.max(sl, P.d[this.idx(q)]);
      P.lastSlope = sl;
      // rough fiducial: the steepest point in the 220 ms before the integration peak (refined by template alignment
      // when the beat is measured)
      let best = c, bv = -1;
      for (let q = c - Math.round(220 / this.dt); q <= c; q++) {
        const a = P.d[this.idx(q)];
        if (a > bv) { bv = a; best = q; }
      }
      const tr = this.t[this.idx(best)];
      if (P.lastR > 0) P.rr.push(tr - P.lastR);
      if (P.rr.length > 16) P.rr.shift();
      P.lastR = tr;
      P.cands = [];
      this.pending.push({ k: best, t: tr, sb, measureAt: tr + 560 });
      this.pending.sort((a, b) => a.k - b.k);
    }
    align(f0, minF, templateOnly, span) {
      const LEADS8 = [0, 1, 6, 7, 8, 9, 10, 11];
      const H = Math.round(140 / this.dt), S = span || Math.round(250 / this.dt);
      const last = this.n - 1;
      const grab = (f) => {
        const out = new Float32Array(LEADS8.length * (2 * H + 1));
        let m = 0;
        for (let li = 0; li < LEADS8.length; li++) {
          let mean = 0;
          for (let i = -H; i <= H; i++) mean += this.at(LEADS8[li], f + i);
          mean /= 2 * H + 1;
          for (let i = -H; i <= H; i++) out[m++] = this.at(LEADS8[li], f + i) - mean;
        }
        return out;
      };
      let f = f0;
      const T = this.tpl;
      if (T && !templateOnly && f0 + S + H <= last) {
        let bestS = 0, bestC = -1;
        let tn = 0;
        for (let i = 0; i < T.length; i++) tn += T[i] * T[i];
        for (let s = -S; s <= S; s++) {
          if (minF !== undefined && f0 + s < minF) continue;
          let num = 0, xn = 0, m = 0;
          for (let li = 0; li < LEADS8.length; li++) {
            for (let i = -H; i <= H; i++) {
              const x = this.at(LEADS8[li], f0 + s + i);
              num += x * T[m];
              xn += x * x;
              m++;
            }
          }
          const c = num / Math.sqrt(Math.max(1e-12, xn * tn));
          if (c > bestC) { bestC = c; bestS = s; }
        }
        if (bestC > 0.7) f = f0 + bestS;
        this.lastCorr = bestC;
      }
      if (f + H <= last) this.tpl = grab(f);
      return f;
    }
    baselineNear(k) {
      // median-ish: mean of lead II over 20 ms
      let s = 0, n = 0;
      for (let q = k - 4; q <= k + 4; q++) { s += this.at(1, q); n++; }
      return s / n;
    }
    flushPending() {
      const now = this.t[this.idx(this.n - 1)];
      while (this.pending.length && this.pending[0].measureAt <= now) {
        const pb = this.pending.shift();
        // refine the fiducial against the previous measured beat, then take RR between refined fiducials
        if (this.prevFidK !== undefined && pb.k + Math.round(200 / this.dt) < this.prevFidK + Math.round(330 / this.dt)) continue; // a second detection inside the same complex
        const minK = this.prevFidK !== undefined ? this.prevFidK + Math.round(330 / this.dt) : undefined;
        // align only within one rhythm (rough RR within 60 % of the last RR); a rhythm change starts a new template
        const roughRR = this.prevFid !== undefined ? pb.t - this.prevFid : null;
        const sameRhythm = roughRR !== null && this.lastRR && Math.abs(roughRR - this.lastRR) < 0.6 * this.lastRR;
        // template search-back: a beat arriving more than half an RR after the expected one means a missed beat; it is
        // recovered at the expected position if the 8-lead correlation with the template is high there
        for (let guard = 0; guard < 3; guard++) {
          if (this.prevFidK === undefined || !this.lastRR) break;
          const ek = this.prevFidK + Math.round(this.lastRR / this.dt);
          if (pb.k - ek < Math.round((0.5 * this.lastRR) / this.dt)) break;
          if (this.blankFrom !== undefined && this.t[this.idx(ek)] > this.blankFrom - 60) break; // never across a shock
          const tplKeep = this.tpl;
          const fk = this.align(ek, this.prevFidK + Math.round(330 / this.dt), false, Math.round(120 / this.dt));
          this.recCorr = this.lastCorr;
          if (!(this.lastCorr > 0.5)) {
            this.tpl = tplKeep;
            break;
          }
          const tb = this.t[this.idx(fk)];
          const rb = { k: fk, t: tb, rr: tb - this.prevFid, recovered: true };
          this.prevFid = tb;
          this.prevFidK = fk;
          this.lastRR = rb.rr;
          const mb = this.measure(rb);
          if (mb) {
            mb.recovered = true;
            this.beats.push(mb);
            if (this.onBeat) this.onBeat(mb);
          }
        }
        // beat tracking: a detection near the expected position (previous fiducial + last RR) is aligned there
        const expK = this.prevFidK !== undefined && this.lastRR ? this.prevFidK + Math.round(this.lastRR / this.dt) : null;
        if (expK !== null && Math.abs(pb.k - expK) < Math.round(250 / this.dt)) pb.k = this.align(expK, minK, false, Math.round(90 / this.dt));
        else if (sameRhythm) pb.k = this.align(pb.k, minK);
        else this.align(pb.k, undefined, true);
        pb.t = this.t[this.idx(pb.k)];
        pb.rr = this.prevFid !== undefined ? pb.t - this.prevFid : null;
        if (pb.rr !== null && pb.rr < 330) continue;
        this.prevFid = pb.t;
        this.prevFidK = pb.k;
        this.lastRR = pb.rr;
        const b = this.measure(pb);
        if (b) {
          this.beats.push(b);
          if (this.onBeat) this.onBeat(b);
        }
      }
    }
    // full measurement of one beat around R (sample index b.k)
    measure(b) {
      const dt = this.dt, k = b.k;
      const ms = (x) => Math.round(x / dt);
      // QRS onset / offset from the spatial velocity (10 % of the complex's peak), searched up to half an RR on each side;
      // a side without an isoelectric crossing (continuous sine-wave VT) makes the width a lower bound
      const last = this.n - 2;
      let svMax = 0;
      for (let q = k - ms(120); q <= Math.min(last, k + ms(120)); q++) svMax = Math.max(svMax, this.sv[this.idx(q)]);
      const thr = svMax * 0.1;
      const half = b.rr ? Math.min(0.5 * b.rr, 300) : 260;
      const below = (q, len) => {
        for (let j = 0; j < len; j++) if (this.sv[this.idx(q + j)] >= thr) return false;
        return true;
      };
      let on = k - ms(Math.min(220, half)), onB = true;
      for (let q = k; q > k - ms(Math.min(220, half)); q--) if (below(q - ms(8), ms(8))) { on = q; onB = false; break; }
      let off = Math.min(last - ms(12), k + ms(Math.min(300, half))), offB = true;
      for (let q = k; q < Math.min(last - ms(12), k + ms(Math.min(300, half))); q++) if (below(q, ms(12))) { off = q; offB = false; break; }
      if (!this.svThr) this.svPeaks = (this.svPeaks || []).concat([svMax]).slice(-8);
      const tOn = this.t[this.idx(on)], tOff = this.t[this.idx(off)];
      // isoelectric level: lead values just before QRS onset
      const iso = (j) => {
        let s = 0;
        for (let q = on - ms(24); q <= on - ms(8); q++) s += this.atM(j, q);
        return s / (ms(24) - ms(8) + 1);
      };
      const isoII = iso(1);
      // R amplitude in II
      let rAmp = -1e9;
      for (let q = on; q <= off; q++) rAmp = Math.max(rAmp, this.atM(1, q) - isoII);
      // P wave in II
      let pOn = null, pAmp = 0, pPk = null;
      const pFrom = on - ms(300), pTo = on - ms(30);
      let tpBase = 0;
      for (let q = pFrom - ms(30); q < pFrom; q++) tpBase += this.atM(1, q);
      tpBase /= ms(30);
      for (let q = pFrom; q <= pTo; q++) {
        const a = this.atM(1, q) - tpBase;
        if (a > pAmp) { pAmp = a; pPk = q; }
      }
      if (pPk !== null && pAmp > 0.03) {
        for (let q = pPk; q > pFrom; q--) if (this.atM(1, q) - tpBase < 0.1 * pAmp) { pOn = q; break; }
      }
      // T end (global): threshold method on the RMS of the 8 independent leads (baseline-corrected): the first time
      // after the T peak of the RMS curve where it falls back within 10 % of the T amplitude
      let tEnd = null, tPk = null, tLead = -1;
      const tFrom = off + ms(50), tTo = k + ms(Math.min(560, b.rr ? b.rr * 0.72 : 560));
      // isoelectric reference from the TP segment (the PR segment carries atrial repolarisation)
      const tp0 = pOn !== null ? pOn - ms(45) : on - ms(300), tp1 = tp0 + ms(25);
      const isoTP = (j) => {
        let s = 0;
        for (let q = tp0; q <= tp1; q++) s += this.atM(j, q);
        return s / (tp1 - tp0 + 1);
      };
      const isoL = [0, 1, 6, 7, 8, 9, 10, 11].map((j) => [j, isoTP(j)]);
      const rms = (q) => {
        let s = 0;
        for (const [j, z] of isoL) {
          const d = this.atM(j, q) - z;
          s += d * d;
        }
        return Math.sqrt(s / 8);
      };
      let pk = null, amp = 0;
      const tTo2 = Math.min(tTo, last - 2);
      for (let q = tFrom; q <= tTo2; q++) {
        const a = rms(q);
        if (a > amp) { amp = a; pk = q; }
      }
      let base = 0;
      for (let q = tp0; q <= tp1; q++) base += rms(q);
      base /= tp1 - tp0 + 1;
      if (pk !== null && amp - base > 0.05 && (!b.rr || b.rr > 600) && !onB && !offB) {
        const lim = base + 0.1 * (amp - base);
        for (let q = pk + 1; q <= Math.min(pk + ms(300), last - 1); q++) {
          if (rms(q) <= lim) {
            const r0 = rms(q - 1), r1 = rms(q);
            tEnd = this.t[this.idx(q - 1)] + ((r0 - lim) / Math.max(1e-9, r0 - r1)) * dt;
            tPk = pk;
            break;
          }
        }
      }
      // axis from net QRS areas in I and aVF over the QRS; for a complex without an isoelectric baseline the area is
      // taken over 80 ms centred on the template-aligned fiducial (cycle-mean baseline), the same window every beat
      let aI = 0, aF = 0;
      if (!onB && !offB) {
        const isoI = iso(0), isoF = iso(5);
        for (let q = on; q <= off; q++) { aI += this.atM(0, q) - isoI; aF += this.atM(5, q) - isoF; }
      } else {
        const hw = ms(Math.min(220, half));
        const L8 = [0, 1, 6, 7, 8, 9, 10, 11];
        const mean = {};
        for (const j of [...L8, 5]) {
          let s = 0;
          for (let q = k - hw; q <= k + hw; q++) s += this.atM(j, q);
          mean[j] = s / (2 * hw + 1);
        }
        // the template-aligned fiducial sits at the same point of the complex every beat
        const pk = k;
        for (let q = pk - ms(40); q <= Math.min(last, pk + ms(40)); q++) { aI += this.atM(0, q) - mean[0]; aF += this.atM(5, q) - mean[5]; }
      }
      const axis = (Math.atan2((2 / Math.sqrt(3)) * aF, aI) * 180) / Math.PI;
      const qrs = tOff - tOn;
      const qt = tEnd !== null ? tEnd - tOn : null;
      const rr = b.rr;
      const qtc = qt !== null && rr ? qt / Math.sqrt(rr / 1000) : null;
      const pr = pOn !== null ? tOn - this.t[this.idx(pOn)] : null;
      return {
        qrsLB: onB || offB,
        t: b.t, k, rr, hr: rr ? 60000 / Math.round(rr) : null, qrs, qt, qtc, pr, axis, rAmp, pAmp, tOn, tOff, tEnd,
        pOn: pOn !== null ? this.t[this.idx(pOn)] : null, tPk: tPk !== null ? this.t[this.idx(tPk)] : null, tLead,
      };
    }
  }
  RE.ECG = ECG;
})();

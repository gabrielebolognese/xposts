// Reentry: orchestration. Builds the heart, prewarms it, steps it frame by frame (one fixed chunk of substeps per
// requestAnimationFrame), runs the programmed-stimulation protocol, measures everything and drives the panels.
(function () {
  const RE = window.RE, STUDIO = window.STUDIO;
  const DPR = window.devicePixelRatio || 1;
  const NSUB = 30; // substeps per frame (15 GPU draws of two forward-Euler steps)
  const PREWARM_MS = 6000;
  const WARM = STUDIO.warmup || 30;
  const T_S2_PAGE = WARM + 11.34, T_SHOCK_PAGE = WARM + 38; // seconds of page time (video 11.3 s and 38 s): the S2
  // moment also fixes the sinus phase, chosen so that the first recorded frame catches a ventricular activation
  const CI = 320; // S2 coupling interval (ms), inside the measured vulnerable window
  const SHOCK = 3.0, SHOCK_DUR = RE.TMS; // dimensionless current for 1 model unit (12.9 ms)
  const RealClock = typeof Object.getPrototypeOf(Date).now === 'function' ? Object.getPrototypeOf(Date) : Date;
  const jsNow = () => (STUDIO.mode === 'render' ? RealClock.now() : performance.now());

  // ---------- layout ----------
  const L = {
    header: { x: 8, y: 8, w: 1904, h: 36 },
    controls: { x: 8, y: 52, w: 300, h: 548 },
    log: { x: 8, y: 608, w: 300, h: 196 },
    work: { x: 8, y: 812, w: 300, h: 260 },
    hero: { x: 316, y: 52, w: 680, h: 700 },
    ecg: { x: 1004, y: 52, w: 908, h: 700 },
    maps: { x: 316, y: 760, w: 540, h: 312 },
    probes: { x: 864, y: 760, w: 400, h: 312 },
    resti: { x: 1272, y: 760, w: 300, h: 312 },
    table: { x: 1580, y: 760, w: 332, h: 312 },
  };
  const GLR = { x: 316, y: 52, w: 680, h: 1020 }; // the WebGL canvas covers the hero and the maps panel
  const FIELD = { x: 324, y: 80, w: 664, h: 664 }; // hero field (stage px)
  const MAPSQ = [0, 1, 2].map((i) => ({ x: 320 + i * 180, y: 804, w: 172, h: 172 })); // a 14 px title strip above each map

  function canvas(id, r) {
    const c = document.getElementById(id);
    c.style.left = r.x + 'px';
    c.style.top = r.y + 'px';
    c.style.width = r.w + 'px';
    c.style.height = r.h + 'px';
    c.width = Math.round(r.w * DPR);
    c.height = Math.round(r.h * DPR);
    return c;
  }

  // ---------- heart ----------
  const glc = canvas('gl', GLR);
  const gl = glc.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, premultipliedAlpha: false });
  const H = new RE.Heart(gl, { saStart: 20 });
  const A = H.A, S = H.solver;
  const EL = RE.makeElectrodes(A);
  S.setWeights(RE.ecgWeights(A, EL).w);
  const E = new RE.ECG(10 * S.dtms, 16384);
  const view = new RE.View(gl, H, GLR);

  const APP = (window.APP = {
    L, GLR, FIELD, MAPSQ, DPR, NSUB, CI, SHOCK, SHOCK_DUR, T_S2_PAGE, T_SHOCK_PAGE, WARM, PREWARM_MS,
    H, A, S, E, EL, view,
    frame: 0, pageT: 0,
    log: [], beats: [], table: [],
    rhythm: 'SINUS', rhythmSince: 0,
    proto: { s2: null, s2Planned: null, fallback: null, shocks: [], shockChecked: false, sinusBack: null, vtAt: null, blockAt: null, saAligned: false },
    ps: { list: [], nextId: 1, count: 0, free: 0, anchored: 0, anchoredQ: 0, history: [], peak: 0, trails: [] },
    rotor: { q: 0, front: -1, frontPrev: -1, period: null, lastPass: null, dir: 0, since: null },
    probes: H.probes.map((p) => ({ ...p, t: new Float64Array(512), u: new Float32Array(512), v: new Float32Array(512), n: 0, apd: null, di: null, lastLat: -1e9, ups: [] })),
    selProbe: 6,
    maps: { lat: new Float32Array(128 * 128), apd: new Float32Array(128 * 128), cl: new Float32Array(128 * 128), flag: new Float32Array(128 * 128), apdHist: new Float32Array(32), cvHist: new Float32Array(32), cvMean: 0, apdMean: 0 },
    tref: 0, isoSpan: 160, tatLast: null,
    stats: { cellUpd: 0, cellWin: [], jsMs: [], frameMsHist: new Float32Array(24), draws: 0 },
    resti: { points: [], fit: null, sweep: 0, bcl: 600, s2: 600, busy: false, done: 0, erp: {}, slope: null, live: [] },
    report: {},
    flash: 0,
  });

  function log(t, text, cls) {
    APP.log.push({ t, text, cls: cls || 'info' });
    if (APP.log.length > 300) APP.log.splice(0, APP.log.length - 300);
  }
  APP.logf = log;

  // ---------- readback processing (every frame) ----------
  const phi = new Array(9);
  let lastHisLat = -1e9, hisBeat = null;
  H.on((r) => {
    const rb = r.rb, RB = RE.RB;
    // ECG samples: three per frame, two frames per readback
    let si = 0;
    for (const fr of r.frames)
      for (const t of fr.ecgT) {
        // the stimulator's S2 marker reaches the ECG pipeline at the stimulus time
        const pr = APP.proto;
        if (pr.s2 && !pr.s2.marked && t >= pr.s2.t) {
          pr.s2.marked = true;
          E.stimulus(pr.s2.t);
          beatNo++;
          APP.table.push({ n: beatNo, t: pr.s2.t, rhythm: 'S2', rr: null, hr: null, pr: null, qrs: null, qt: null, qtc: null, axis: null, tat: null, stim: true, ci: pr.s2.ci });
          log(pr.s2.t, `#${beatNo} S2 capture, CI ${Math.round(pr.s2.ci)} ms (stimulus marker)`, 'active');
        }
        E.push(t, S.ecgSample(rb, si++, phi));
      }
    // probes and the anchored-rotor loop, for both frames
    for (let fi = 0; fi < r.frames.length; fi++) {
      const ga = r.g[fi], tf = r.frames[fi].t;
      for (const p of APP.probes) {
        const g = H.gatherFrom(ga, 'p' + p.key);
        const i = p.n % 512;
        p.t[i] = tf;
        p.u[i] = g.u;
        p.v[i] = g.v;
        p.n++;
        if (g.lat > p.lastLat + 1 && g.lat > 0) {
          if (p.lastRep !== undefined && p.lastRep < g.lat) p.di = g.lat - p.lastRep;
          p.lastLat = g.lat;
          p.ups.push(g.lat);
          if (p.ups.length > 16) p.ups.shift();
        }
        if (g.rep > g.lat && g.rep !== p.lastRep) {
          p.lastRep = g.rep;
          p.apd = g.rep - g.lat;
          if (p.di !== null && p.apd > 20) {
            APP.resti.live.push({ key: p.key, di: p.di, apd: p.apd, t: tf });
            if (APP.resti.live.length > 160) APP.resti.live.shift();
          }
        }
      }
      rotorFrame(ga, tf);
    }
    // map slice (16 rows of the 128 x 128 maps)
    const M = APP.maps;
    for (let row = 0; row < 16; row++) {
      const cy = r.slice * 16 + row;
      for (let cx = 0; cx < 128; cx++) {
        const o = ((RB.MAP0 + row) * RB.W + cx) * 4, k = cy * 128 + cx;
        M.lat[k] = rb[o];
        M.apd[k] = rb[o + 1];
        M.cl[k] = rb[o + 2];
        M.flag[k] = rb[o + 3];
      }
    }
    // phase singularities: decode blocks
    const found = [];
    for (let b = 0; b < 1024; b++) {
      const o = (RB.PS0 * RB.W + b) * 4;
      const n = rb[o] + rb[o + 1];
      if (!n) continue;
      const bx = b % 32, by = (b / 32) | 0;
      for (const code of [rb[o + 2], rb[o + 3]]) {
        if (code < 0) continue;
        const q = code >= 256 ? 1 : -1, c = code % 256;
        found.push({ x: bx * 16 + (c % 16) + 1, y: by * 16 + Math.floor(c / 16) + 1, q });
      }
    }
    trackPS(found, r.t);
    APP.ps.free = APP.ps.list.filter((p) => p.seen >= 2).length;
    APP.ps.anchored = Math.abs(APP.rotor.q);
    APP.ps.count = APP.ps.free + APP.ps.anchored;
    APP.ps.history.push({ t: r.t, n: APP.ps.count, f: APP.ps.free, a: APP.ps.anchored });
    const pg = (r.t - PREWARM_MS) / (60 * NSUB * S.dtms);
    const PT = (APP.psTimeline = APP.psTimeline || []);
    if (!PT.length || pg - PT[PT.length - 1][0] >= 0.25) PT.push([pg, APP.ps.count]);
    else PT[PT.length - 1][1] = Math.max(PT[PT.length - 1][1], APP.ps.count);
    if (APP.ps.history.length > 1400) APP.ps.history.shift();
    if (APP.proto.s2 && !APP.proto.shocks.length) APP.ps.peak = Math.max(APP.ps.peak, APP.ps.count);
    // His entry and Purkinje capture, logged per conducted impulse
    const cs = H.cs;
    if (cs.hisLat && cs.hisLat > lastHisLat + 1) {
      lastHisLat = cs.hisLat;
      hisBeat = { t: cs.hisLat, inj0: cs.injected, blk0: cs.blocked, at: r.t };
    }
    if (hisBeat && r.t > hisBeat.t + 90) {
      const his = H.sys.his;
      const conducted = Math.abs(his.last - hisBeat.t) < 2 && !his.retro;
      const inj = cs.injected - hisBeat.inj0;
      if (conducted && inj > 0) log(hisBeat.t, `His → Purkinje: ${inj} PMJ captured`, 'pk');
      else log(hisBeat.t, 'His impulse blocked: tree refractory', 'warn');
      hisBeat = null;
    }
  });

  // anchored rotor: winding number of the phase around the loop through the border zone
  function rotorFrame(ga, t) {
    const nL = A.loop.length;
    let w = 0, prev = null, first = null;
    const ths = new Float32Array(nL);
    for (let i = 0; i < nL; i++) {
      const g = H.gatherFrom(ga, 'l' + i);
      const th = Math.atan2(g.v - 1, g.u - 0.5);
      ths[i] = th;
      if (prev !== null) {
        let d = th - prev;
        d -= 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI));
        w += d;
      } else first = th;
      prev = th;
    }
    let d = first - prev;
    d -= 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI));
    w += d;
    rotorUpdate(Math.round(w / (2 * Math.PI)), ths, t);
  }
  function trackPS(found, t) {
    const P = APP.ps;
    for (const p of P.list) p.matched = false;
    for (const f of found) {
      let best = null, bd = 14 * 14;
      for (const p of P.list) {
        if (p.matched || p.q !== f.q) continue;
        const d = (p.x - f.x) ** 2 + (p.y - f.y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        best.x = f.x;
        best.y = f.y;
        best.matched = true;
        best.seen++;
        best.miss = 0;
        best.trail.push([f.x, f.y]);
        if (best.trail.length > 90) best.trail.shift();
        if (best.seen === 2) log(t, `PS ${f.q > 0 ? '+1' : '−1'} born at (${f.x}, ${f.y})`, 'down');
      } else P.list.push({ id: P.nextId++, x: f.x, y: f.y, q: f.q, seen: 1, miss: 0, matched: true, born: t, trail: [[f.x, f.y]] });
    }
    for (const p of P.list) if (!p.matched) p.miss++;
    P.list = P.list.filter((p) => {
      if (p.miss > 2) {
        if (p.seen >= 2) log(t, `PS ${p.q > 0 ? '+1' : '−1'} gone (${p.x}, ${p.y}), ${Math.round(t - p.born)} ms`, 'info');
        P.trails.push({ trail: p.trail, q: p.q, t });
        if (P.trails.length > 24) P.trails.shift();
        return false;
      }
      return true;
    });
  }

  function rotorUpdate(q, ths, t) {
    const R = APP.rotor;
    // wavefront position on the loop: where the phase crosses the upstroke value (u = 0.5 at v ~ 0)
    const nL = ths.length;
    const thUp = Math.atan2(-1, 0);
    let front = -1;
    for (let i = 0; i < nL; i++) {
      const a = ths[i], b = ths[(i + 1) % nL];
      let da = a - thUp, db = b - thUp;
      da -= 2 * Math.PI * Math.floor((da + Math.PI) / (2 * Math.PI));
      db -= 2 * Math.PI * Math.floor((db + Math.PI) / (2 * Math.PI));
      if (Math.sign(da) !== Math.sign(db) && Math.abs(da - db) < Math.PI) {
        front = i + Math.abs(da) / Math.max(1e-6, Math.abs(da - db));
        break;
      }
    }
    if (q !== R.q) {
      if (q !== 0 && R.q === 0) {
        R.since = t;
        if (APP.proto.s2 && !APP.proto.blockAt) {
          APP.proto.blockAt = t;
          log(t, `unidirectional block: one-way circuit`, 'warn');
        }
        log(t, `rotor anchored at scar, charge ${q > 0 ? '+1' : '−1'}`, 'down');
      } else if (q === 0 && R.q !== 0) log(t, `rotor terminated after ${Math.round(t - (R.since || t))} ms`, 'up');
      R.q = q;
    }
    if (front >= 0 && R.front >= 0) {
      let d = front - R.front;
      if (d > nL / 2) d -= nL;
      if (d < -nL / 2) d += nL;
      if (Math.abs(d) < nL / 4) {
        R.dir = R.dir * 0.9 + Math.sign(d) * 0.1;
        if (R.tFront !== undefined && t > R.tFront) R.rate = R.rate === undefined ? d / (t - R.tFront) : R.rate * 0.8 + 0.2 * (d / (t - R.tFront));
      }
      // a full pass through loop index 0
      if (R.q !== 0 && ((R.front > nL - 8 && front < 8 && d > 0) || (R.front < 8 && front > nL - 8 && d < 0))) {
        if (R.lastPass) R.period = t - R.lastPass;
        R.lastPass = t;
      }
    }
    R.front = front;
    R.tFront = t;
  }

  // ---------- ECG beats: classification, table, log ----------
  let beatNo = 0, prevPr = null, calibrated = false, vtRun = 0;
  const vtRRs = [], recentRR = [];
  const prHist = [];
  E.onBeat = (b) => {
    beatNo++;
    const p = APP.proto;
    const shockT = p.shocks.length ? p.shocks[0].t0 : null;
    const hasP = b.pr !== null && b.pr >= 80 && b.pr <= 260;
    // AV association: a P wave with a consistent PR (within 30 ms) on this and the two previous beats
    prHist.push(hasP ? b.pr : null);
    if (prHist.length > 3) prHist.shift();
    const assoc = prHist.length === 3 && prHist.every((x) => x !== null) && Math.max(...prHist) - Math.min(...prHist) <= 30;
    const dissoc = !assoc;
    let rhythm;
    const vtLike = b.hr && b.hr > 120 && b.qrs > 120 && dissoc;
    vtRun = vtLike ? vtRun + 1 : 0;
    if (vtLike) vtRRs.push(b.rr);
    else vtRRs.length = 0;
    // VT needs 3 consecutive wide fast dissociated beats; until then the beats are labelled WIDE
    if (vtLike && (vtRun >= 3 || APP.rhythm === 'VT')) rhythm = 'VT';
    else if (vtLike) rhythm = 'WIDE';
    else if (hasP && b.hr && b.hr >= 50 && b.hr <= 100 && (assoc || prHist.length < 3)) rhythm = 'SINUS';
    else if (shockT !== null && b.t > shockT) rhythm = 'POST-SHOCK';
    else if (b.rr && APP.lastSinusRR && b.rr < 0.8 * APP.lastSinusRR && !hasP) rhythm = 'PVC';
    else rhythm = b.qrs > 120 ? 'WIDE' : 'OTHER';
    if (rhythm === 'SINUS' && b.rr) APP.lastSinusRR = b.rr;
    prevPr = hasP ? b.pr : null;
    // total activation time of this beat from the LAT map
    const M = APP.maps;
    let lo = 1e9, hi = -1e9, tat = null;
    if (b.qrsLB && b.rr) {
      // continuous (reentrant) activation: spread of activation phases within one cycle aligned to the fiducial,
      // 2nd to 98th percentile of (LAT - fiducial + RR/2) mod RR over recently activated ventricular cells
      const ph = [];
      const t0 = b.t - b.rr / 2;
      for (let k = 0; k < 128 * 128; k++) {
        if (M.flag[k] < 1.5) continue;
        const l = M.lat[k];
        if (H.t - l > 2 * b.rr) continue;
        ph.push((((l - t0) % b.rr) + b.rr) % b.rr);
      }
      if (ph.length > 20) {
        ph.sort((x, y) => x - y);
        tat = ph[Math.floor(0.98 * (ph.length - 1))] - ph[Math.floor(0.02 * (ph.length - 1))];
      }
    } else {
      let win = Math.min(380, (b.rr || 800) * 0.9);
      if (p.s2 && p.s2.t > b.tOn) win = Math.min(win, p.s2.t - b.tOn - 5); // the premature beat is not part of this beat
      for (let k = 0; k < 128 * 128; k++) {
        if (M.flag[k] < 1.5) continue;
        const l = M.lat[k];
        if (l >= b.tOn - 80 && l <= b.tOn + win) { if (l < lo) lo = l; if (l > hi) hi = l; }
      }
      tat = hi > lo ? hi - lo : null;
    }
    const row = { n: beatNo, t: b.t, rhythm, rr: b.rr, hr: b.hr, pr: hasP ? b.pr : null, qrs: b.qrs, qrsLB: b.qrsLB, qt: b.qt, qtc: b.qtc, axis: b.axis, tat, tOn: b.tOn, tOff: b.tOff, tEnd: b.tEnd, pOn: hasP ? b.pOn : null };
    // monitor HR: median of the last 3 measured RR intervals
    recentRR.push(b.rr);
    if (recentRR.length > 3) recentRR.shift();
    const rrs = recentRR.filter(Boolean);
    row.hrMed = rrs.length ? 60000 / Math.round(median(rrs)) : null;
    APP.table.push(row);
    if (APP.table.length > 200) APP.table.shift();
    APP.lastBeat = row;
    if (rhythm === 'VT' && b.rr && !p.shocks.length) {
      // reentry: LAT is shown modulo the tachycardia cycle length (where early meets late is the circuit)
      APP.latMod = b.rr;
      APP.tref = p.s2 ? p.s2.t : b.t;
      APP.tatLast = tat;
    } else if (tat && lo < 1e9) {
      APP.latMod = 0;
      APP.tref = lo;
      APP.isoSpan = tat + 10;
      APP.tatLast = tat;
      view.snapshot();
    }
    // rhythm state
    // between S2 and the VT declaration the monitor shows the wide-complex onset
    if (rhythm === 'WIDE' && p.s2 && !p.vtAt && !p.shocks.length) APP.rhythm = 'WIDE';
    if (rhythm === 'VT' && !p.vtAt && !p.shocks.length) {
      APP.rhythm = 'VT';
      p.vtAt = b.t;
      const mrr = median(vtRRs.slice(-3));
      p.vtHR = 60000 / Math.round(mrr);
      log(b.t, `VT: 3 wide beats, median HR ${Math.round(p.vtHR)} (RR ${Math.round(mrr)}), QRS ${b.qrsLB ? '>200' : Math.round(b.qrs)}, AV dissoc.`, 'down');
    }
    if (shockT !== null && b.tOn > shockT + 200 && hasP && b.pr >= 100 && b.pr <= 250 && b.qrs <= 130 && !b.qrsLB && p.sinusBack === null) {
      p.sinusBack = b.tOn - shockT;
      APP.rhythm = 'SINUS';
      log(b.t, `sinus QRS back +${Math.round(p.sinusBack)} ms, PR ${Math.round(b.pr)}`, 'up');
    }
    const hrTxt = b.hr ? Math.round(b.hr) : '--';
    log(b.t, `R #${beatNo} ${rhythm === 'POST-SHOCK' ? 'POST' : rhythm} RR ${b.rr ? Math.round(b.rr) : '--'} HR ${hrTxt} QRS ${b.qrsLB ? '>200' : Math.round(b.qrs)}`, rhythm === 'VT' ? 'down' : rhythm === 'SINUS' ? 'beat' : 'warn');
  };

  // ---------- protocol ----------
  const simAt = (pageSec) => PREWARM_MS + Math.round(pageSec * 60) * NSUB * S.dtms;
  APP.simAt = simAt;
  const T2 = simAt(T_S2_PAGE), TSH = simAt(T_SHOCK_PAGE);
  APP.T2 = T2;
  APP.TSH = TSH;
  const CL = 60000 / H.o.hr;

  function protocol() {
    const p = APP.proto, t = H.t;
    // align the sinus phase once (after the first beat) so that the last sinus activation at the S2 site falls CI
    // before the S2 moment
    if (!p.saAligned) {
      const g = H.gather('s2');
      if (g && g.lat > H.saTimes[0] + 5) {
        const d = g.lat - H.saTimes[0];
        const want = T2 - CI - d;
        let next = want - Math.floor((want - (t + 450)) / CL) * CL;
        while (next < t + 450) next += CL;
        H.nextSA = next;
        p.saAligned = true;
        APP.siteDelay = d;
      }
    }
    // S2 at coupling interval CI after the last sinus activation at the site
    if (!p.s2 && t > T2 - CI + 40) {
      const g = H.gather('s2');
      const s2t = Math.max(g.lat + CI, t + 0.1);
      const site = H.s2site;
      H.extra.push({ id: 'S2', x: site.x, y: site.y, r: 3, amp: 3.0, t0: s2t, t1: s2t + RE.TMS, kind: 'S2' });
      p.s2 = { t: s2t, ci: s2t - g.lat, site };
      E.saveLevels();
      log(s2t, `S2 at border zone, CI ${Math.round(s2t - g.lat)} ms`, 'active');
    }
    // fallback: cross-field S2 if no phase singularity within 400 ms
    if (p.s2 && !p.fallback && !p.blockAt && t > p.s2.t + 400 && APP.ps.count === 0 && !p.ps400) {
      p.ps400 = true;
      const c = A.loop.center;
      H.plane = { t0: t, t1: t + RE.TMS, v: [1, 0, c.x, 3.0] };
      p.fallback = t;
      log(t, 'no PS at +400 ms: cross-field S2', 'warn');
    }
    // defibrillation
    if (!p.shocks.length && t >= TSH - NSUB * S.dtms) {
      const t0 = Math.max(TSH, t);
      H.shocks.push({ t0, t1: t0 + SHOCK_DUR, amp: SHOCK });
      p.shocks.push({ t0, amp: SHOCK });
      E.blank(t0, t0 + 80); // the monitor blanks QRS detection during the shock artefact
      E.restoreLevels();
      H.nextSA = t0 + SHOCK_DUR + CL; // the shock resets the SA pacemaker
      APP.rhythm = 'SHOCK';
      log(t0, `SHOCK ${SHOCK.toFixed(1)} × ${SHOCK_DUR.toFixed(1)} ms, all cells`, 'active');
    }
    if (p.shocks.length && !p.shockChecked && t > p.shocks[p.shocks.length - 1].t0 + 150) {
      p.shockChecked = true;
      const last = p.shocks[p.shocks.length - 1];
      if (APP.ps.count > 0 && p.shocks.length < 2) {
        log(t, `shock failed: ${APP.ps.count} PS, shock ${(last.amp * 1.5).toFixed(1)}`, 'down');
        const t0 = t + 1;
        H.shocks.push({ t0, t1: t0 + SHOCK_DUR, amp: last.amp * 1.5 });
        p.shocks.push({ t0, amp: last.amp * 1.5 });
        p.shockChecked = false;
      } else {
        log(t, `+150 ms: ${APP.ps.count} PS, arrhythmia terminated`, 'up');
        APP.rhythm = 'POST-SHOCK';
      }
    }
    if (APP.rhythm === 'SHOCK' && p.shocks.length && t > p.shocks[0].t0 + 400) APP.rhythm = 'POST-SHOCK';
    APP.flash = p.shocks.length ? Math.max(0, 1 - (t - p.shocks[p.shocks.length - 1].t0) / 160) : 0;
    if (APP.flash < 0 || t < (p.shocks[0] ? p.shocks[0].t0 : 1e12)) APP.flash = 0;
  }

  // ---------- ECG gain calibration during prewarm ----------
  function calibrate() {
    if (calibrated) return;
    const bs = E.beats.filter((b) => b.t > 1500);
    if (bs.length >= 3) {
      const m = bs.slice(-3).reduce((s, b) => s + b.rAmp, 0) / 3;
      E.setGain(1.2 / m);
      calibrated = true;
      APP.gain = E.gain;
      log(H.t, `ECG gain frozen: R(II) = 1.20 mV`, 'info');
    }
  }

  // ---------- restitution worker (1D cable, S1-S2) ----------
  const worker = new Worker('cable.js');
  const R = APP.resti;
  worker.onmessage = (e) => {
    const d = e.data;
    for (const pt of d.points) {
      R.points.push(pt);
      if (pt.block) {
        R.erp[pt.bcl] = pt.s2;
        if ((pt.bcl === 600 || pt.bcl === 400) && pt.sweep % 3 === 0) log(H.t, `cable S1–S2 @${pt.bcl}: ERP ${pt.s2} ms`, 'info');
      }
    }
    if (R.points.length > 1600) R.points.splice(0, R.points.length - 1600);
    R.bcl = d.bcl;
    R.s2 = d.s2;
    R.sweep = d.sweep;
    R.stepsDone = d.steps;
    if (d.fit) R.fit = d.fit;
    R.busy = false;
    if (R.resolve) R.resolve();
  };
  function workerTick() {
    if (R.busy) return;
    R.busy = true;
    STUDIO.wait(new Promise((res) => (R.resolve = res)));
    worker.postMessage({ steps: 700 });
  }

  // ---------- stepping ----------
  function step() {
    H.step(NSUB);
    protocol();
    calibrate();
    APP.stats.cellUpd += A.tissue * NSUB;
  }

  // prewarm before the first paint: fast-forward sinus rhythm in frame-sized chunks
  {
    const t0 = jsNow();
    log(0, `512² grid, ${A.tissue} excitable cells`, 'info');
    while (H.t < PREWARM_MS) step();
    APP.prewarmMs = jsNow() - t0;
    log(H.t, `prewarm ${(PREWARM_MS / 1000).toFixed(1)} s sinus in ${(APP.prewarmMs / 1000).toFixed(1)} s`, 'info');
  }

  // ---------- frame loop ----------
  const UI = RE.UI(APP);
  // pay one-off costs at load, not inside an animation frame: the first draw of every panel, lazy shader compilation
  // and the first GPU synchronisation (two warm-up frames, then a full pipeline flush)
  for (let w = 0; w < 3; w++) {
    step();
    UI.draw(performance.now());
  }
  S.collect(true);
  S.collect(true);
  gl.finish();
  let lastNow = null;
  function frame(now) {
    const j0 = jsNow();
    APP.pageT = now / 1000;
    // advance the simulation to where the page clock says it should be (exactly one chunk per frame when recorded)
    const target = simAt(APP.pageT);
    let n = 0;
    while (H.t < target - 0.5 * NSUB * S.dtms && n < 2) {
      step();
      n++;
    }
    APP.frame++;
    APP.stepsThisFrame = n * NSUB;
    if (APP.videoPhase === undefined && APP.pageT >= WARM) APP.videoPhase = H.t - H.saTimes[H.saTimes.length - 1];
    workerTick();
    // cell updates per second on the frame clock
    const st = APP.stats;
    st.cellWin.push([now, n * A.tissue * NSUB]);
    while (st.cellWin.length > 2 && st.cellWin[0][0] < now - 1000) st.cellWin.shift();
    if (st.cellWin.length > 1) {
      const span = (now - st.cellWin[0][0]) / 1000;
      let sum = 0;
      for (let i = 1; i < st.cellWin.length; i++) sum += st.cellWin[i][1];
      st.cups = span > 0 ? sum / span : 0;
    }
    // measured throughput: cell updates per second of GPU time, from the timer query on the solver pass
    if (S.gpuMs && S.gpuSteps) {
      st.cupsGpu = (A.tissue * S.gpuSteps) / (S.gpuMs / 1000);
    }
    UI.draw(now);
    const js = jsNow() - j0;
    st.jsMs.push(js);
    if (st.jsMs.length > 240) st.jsMs.shift();
    if (APP.frame > 30) st.frameMsHist[Math.min(23, Math.floor(js))]++;
    if (APP.frame % 30 === 0) report();
    lastNow = now;
    requestAnimationFrame(frame);
  }

  function median(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }
  function mean(a) {
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  }
  function report() {
    const tb = APP.table;
    const s2 = APP.proto.s2 ? APP.proto.s2.t : 1e12;
    const sinus = tb.filter((r) => r.rhythm === 'SINUS' && r.t < s2);
    const vt = tb.filter((r) => r.rhythm === 'VT');
    const r1 = (x) => (x === null || x === undefined ? null : Math.round(x));
    const lastSinus = sinus[sinus.length - 1];
    const rep = {
      sinus_hr_bpm: r1(mean(sinus.slice(-6).map((r) => r.hr).filter(Boolean))),
      vt_hr_bpm: vt.length ? r1(60000 / median(vt.map((r) => r.rr).filter(Boolean))) : null,
      qrs_sinus_ms: r1(mean(sinus.slice(-6).map((r) => r.qrs))),
      qrs_vt_ms: vt.length && vt.every((r) => r.qrsLB) ? '>200 (no isoelectric baseline in VT)' : r1(mean(vt.map((r) => r.qrs))),
      qtc_ms: lastSinus ? r1(lastSinus.qtc) : null,
      phase_singularities_peak: APP.ps.peak,
      shock_to_sinus_ms: r1(APP.proto.sinusBack),
      cell_updates_per_s: APP.stats.cupsGpu ? r1(APP.stats.cupsGpu) : r1(APP.stats.cups),
      cell_updates_per_s_note: APP.stats.cupsGpu ? 'per second of GPU time (EXT_disjoint_timer_query on the solver pass, incl. ECG reduction)' : 'delivered on the frame clock',
      cell_updates_delivered_per_s: r1(APP.stats.cups),
      gpu_solver_ms_per_frame: S.gpuMs ? +S.gpuMs.toFixed(2) : null,
      pr_ms: r1(mean(sinus.slice(-6).map((r) => r.pr).filter(Boolean))),
      vt_cycle_ms: vt.length ? r1(median(vt.map((r) => r.rr).filter(Boolean))) : null,
      s2_ci_ms: APP.proto.s2 ? r1(APP.proto.s2.ci) : null,
      excitable_cells: A.tissue,
      grid_cells: 512 * 512,
      substeps_per_frame: NSUB,
    };
    rep.qrs_ms = `${rep.qrs_sinus_ms ?? '--'} sinus / ${typeof rep.qrs_vt_ms === 'string' ? '>200' : rep.qrs_vt_ms ?? '--'} VT`;
    APP.report = rep;
    STUDIO.report(rep);
  }

  report();
  requestAnimationFrame(frame);
})();

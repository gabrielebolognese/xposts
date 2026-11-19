import io


def load(p):
    return io.open(p, encoding='utf8').read()


def save(p, s):
    io.open(p, 'w', encoding='utf8').write(s)


def rep(s, old, new):
    assert old in s, old[:100]
    return s.replace(old, new)


# ================= main.js =================
p = 'main.js'
s = load(p)
s = rep(s, "    pending: [], collisions: 0, flights: 0, leak: 0, last: null, runStartT: 0, seq: 0, workerHist: [],",
        "    pending: [], collisions: 0, flights: 0, leak: 0, last: null, runStartT: 0, seq: 0, workerHist: [],\n    gk: [], runs: [], period: 1000 / 60, lastDispatch: 0,")
s = rep(s, "    MC.runStartT = m.t;", "    MC.runStartT = m.t;\n    MC.runs.push({ run: MC.run, start: MC.gen, matT: m.t, kDiff: m.k });\n    if (MC.runs.length > 8) MC.runs.shift();")
s = rep(s, "    MC.busy = MC_WORKERS;\n    MC.pending = [];", "    MC.busy = MC_WORKERS;\n    MC.pending = [];\n    if (MC.lastDispatch) MC.period = APP.now - MC.lastDispatch; // frame-clock time per generation\n    MC.lastDispatch = APP.now;")
s = rep(s, "    MC.seq++;\n", "    MC.gk.push({ g: MC.gen, k: kg, H: Hs, run: MC.run, act: active, mean: active ? MC.kMean : NaN, sig: active ? MC.kSig : NaN });\n    if (MC.gk.length > 900) MC.gk.splice(0, MC.gk.length - 900);\n    MC.seq++;\n")
# real JS cost per frame (page clock is virtual in the render, so use the real clock there)
s = rep(s, """  function mcReply(i, r) {
    const tP = RealDate.now();""", """  const realNow = () => (STUDIO.mode === 'render' ? RealDate.now() : performance.now());
  APP.jsExtra = 0;
  APP.jsSeries = [];
  function mcReply(i, r) {
    const tP = RealDate.now();
    const tR = realNow();""")
s = rep(s, """    } finally {
      if (window.__PROF && MC.busy === 0) {""", """    } finally {
      APP.jsExtra += realNow() - tR;
      if (window.__PROF && MC.busy === 0) {""")
s = rep(s, """  function frame(now) {
    requestAnimationFrame(frame);
    APP.frame++;""", """  function frame(now) {
    requestAnimationFrame(frame);
    const tJs = realNow();
    APP.frame++;""")
s = rep(s, """    if (now - lastReport > 1000 && APP.bench) {
      lastReport = now;
      report();
    }""", """    if (now - lastReport > 1000 && APP.bench) {
      lastReport = now;
      report();
    }
    APP.jsSeries.push(realNow() - tJs + APP.jsExtra);
    APP.jsExtra = 0;
    if (APP.jsSeries.length > 240) APP.jsSeries.shift();""")
save(p, s)

# ================= ui.js =================
p = 'ui.js'
s = load(p)

# ---- MC charts: a scrolling 600-generation window across snapshot runs
a = s.index("    // k per generation\n    const a = { x: 34, y: 36, w: 220, h: 70 };")
b = s.index("    // readouts\n    const rx0 = 264")
s = s[:a] + """    // k per generation: a scrolling window of 600 generations across snapshot runs (earlier runs ghosted)
    const a = { x: 34, y: 36, w: 220, h: 70 };
    drawFrame(g, a);
    T(g, `k PER GENERATION \\u00b7 LAST 600 GENS \\u00b7 RUN ${M.run}`, a.x, a.y - 5, FT(8.5, 600), PAL.muted);
    const W = 600, g1 = M.gen, g0 = g1 - W;
    const span = 0.03;
    const yk = (k) => a.y + a.h - ((k - (kd - span)) / (2 * span)) * a.h;
    for (const d of [-0.02, -0.01, 0.01, 0.02]) hline(g, a.x, a.x + a.w, yk(kd + d), 'rgba(26,42,61,0.6)');
    T(g, (kd + span).toFixed(2), a.x - 3, a.y + 7, FM(7), PAL.muted, 'right');
    T(g, (kd - span).toFixed(2), a.x - 3, a.y + a.h, FM(7), PAL.muted, 'right');
    const xg = (q) => a.x + ((q - g0) / W) * a.w;
    const gk = M.gk;
    g.save();
    g.beginPath();
    g.rect(a.x, a.y, a.w, a.h);
    g.clip();
    // per run: inactive shading, k_diff line, +-3 sigma band of the running mean, mean line
    for (let ri = 0; ri < M.runs.length; ri++) {
      const R0 = M.runs[ri], cur = R0.run === M.run;
      const s0 = R0.start, s1 = ri + 1 < M.runs.length ? M.runs[ri + 1].start : g1;
      if (s1 < g0) continue;
      g.fillStyle = 'rgba(95,119,144,0.10)';
      g.fillRect(xg(s0), a.y, xg(Math.min(s1, s0 + M.inactive)) - xg(s0), a.h);
      g.strokeStyle = hexA('#FFB547', cur ? 0.9 : 0.4);
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(xg(s0), yk(R0.kDiff));
      g.lineTo(xg(s1), yk(R0.kDiff));
      g.stroke();
      g.setLineDash([]);
      const pts = gk.filter((e) => e.run === R0.run && e.act && e.g >= g0);
      if (pts.length > 1) {
        g.fillStyle = hexA('#3FB8FF', cur ? 0.24 : 0.12);
        g.beginPath();
        pts.forEach((e, j) => (j ? g.lineTo(xg(e.g), yk(e.mean + 3 * e.sig)) : g.moveTo(xg(e.g), yk(e.mean + 3 * e.sig))));
        for (let j = pts.length - 1; j >= 0; j--) g.lineTo(xg(pts[j].g), yk(pts[j].mean - 3 * pts[j].sig));
        g.fill();
        g.strokeStyle = cur ? PAL.white : 'rgba(242,247,255,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        pts.forEach((e, j) => (j ? g.lineTo(xg(e.g), yk(e.mean)) : g.moveTo(xg(e.g), yk(e.mean))));
        g.stroke();
      }
    }
    // k_gen dots: inactive grey, active blue, earlier runs at 30 %
    for (const e of gk) {
      if (e.g < g0) continue;
      const cur = e.run === M.run;
      g.fillStyle = e.act ? hexA('#3FB8FF', cur ? 0.95 : 0.3) : `rgba(95,119,144,${cur ? 0.95 : 0.3})`;
      g.fillRect(xg(e.g) - 0.75, yk(e.k) - 0.75, 1.5, 1.5);
    }
    g.restore();
    // snapshot dividers
    for (const R0 of M.runs) {
      if (R0.start <= g0) continue;
      const x = xg(R0.start);
      vline(g, x, a.y, a.y + a.h, hexA('#FFB547', 0.7), [2, 2]);
      const lbl = `SNAPSHOT ${clock(R0.matT)}`;
      g.font = FT(7.5, 700);
      const w = g.measureText(lbl).width;
      const lx = x + 3 + w > a.x + a.w - 2 ? x - 3 - w : x + 3;
      g.fillStyle = 'rgba(5,9,15,0.8)';
      g.fillRect(lx - 2, a.y + a.h - 11, w + 4, 10);
      T(g, lbl, lx, a.y + a.h - 3, FT(7.5, 700), PAL.warn);
    }
    T(g, 'band \\u00b13\\u03c3', a.x + 3, a.y + 9, FM(7.5), PAL.blue);
    T(g, 'k diff', a.x + a.w - 2, yk(kd) - 3, FM(7.5), PAL.warn, 'right');
    for (let q = Math.ceil(g0 / 100) * 100; q <= g1; q += 100) {
      if (q <= g0) continue;
      g.fillStyle = PAL.line2;
      g.fillRect(Math.round(xg(q)), a.y + a.h, 1, 3);
      T(g, String(q), xg(q), a.y + a.h + 9, FM(7), PAL.muted, 'center');
    }
    // entropy: continuous across runs (the fission source carries over)
    const b = { x: 34, y: 133, w: 220, h: 28 };
    drawFrame(g, b);
    T(g, 'SHANNON ENTROPY OF THE SOURCE, 17\\u00d717 BINS (bits)', b.x, b.y - 5, FT(8.5, 600), PAL.muted);
    let hmn = Infinity, hmx = -Infinity;
    for (const e of gk) if (e.g >= g0) {
      hmn = Math.min(hmn, e.H);
      hmx = Math.max(hmx, e.H);
    }
    if (!isFinite(hmn)) {
      hmn = 7;
      hmx = 7.5;
    }
    const hp = Math.max(0.05, (hmx - hmn) * 0.25);
    hmn -= hp;
    hmx += hp;
    g.strokeStyle = PAL.violet;
    g.lineWidth = 1.1;
    g.beginPath();
    let st = false;
    for (const e of gk) {
      if (e.g < g0) continue;
      const x = xg(e.g), y = b.y + b.h - ((e.H - hmn) / (hmx - hmn)) * b.h;
      if (!st) g.moveTo(x, y);
      else g.lineTo(x, y);
      st = true;
    }
    g.stroke();
    for (const R0 of M.runs) if (R0.start > g0) vline(g, xg(R0.start), b.y, b.y + b.h, hexA('#FFB547', 0.5), [2, 2]);
    T(g, hmx.toFixed(2), b.x - 3, b.y + 7, FM(7), PAL.muted, 'right');
    T(g, hmn.toFixed(2), b.x - 3, b.y + b.h, FM(7), PAL.muted, 'right');
""" + s[b:]

# ---- MC worker cells: real busy time vs frame-clock period, real per-worker rate
a = s.index("    // workers\n    const wx0 = 122, wy = 176;")
b = s.index("  // ---------- right column: shared time axis ----------")
s = s[:a] + """    // workers: compute time (worker clock) vs the frame-clock period of one generation
    const wx0 = 122, wy = 176;
    const sh = M.last ? M.last.shares : [0];
    const per = M.period || 16.7;
    T(g, `WORKERS \\u00b7 ${Math.min(...sh).toLocaleString('en-US')} n EACH \\u00b7 BUSY | WAIT OF ${per.toFixed(1)} ms/GEN`, wx0, wy + 2, FT(8, 600), PAL.muted);
    for (let i = 0; i < 6; i++) {
      const x = wx0 + (i % 3) * 82, yy = wy + 12 + Math.floor(i / 3) * 26;
      const ms = M.workerMs[i];
      const busy = Math.min(1, ms / per);
      T(g, `MC${i + 1}`, x, yy + 7, FT(8.5, 700), PAL.violet);
      g.fillStyle = 'rgba(26,42,61,0.7)';
      g.fillRect(x + 25, yy + 1, 52, 6);
      g.fillStyle = hexA('#9B8CFF', 0.9);
      g.fillRect(x + 25, yy + 1, 52 * busy, 6);
      const rate = ms > 0 ? (sh[i] || 0) / ms : 0; // histories per ms of compute
      T(g, `${ms.toFixed(1)}|${Math.max(0, per - ms).toFixed(1)} ${(rate).toFixed(0)}k/s`, x + 77, yy + 17, FM(7.5), PAL.text, 'right');
    }
  }

""" + s[b:]
s = rep(s, "    row('histories/s', (hs / 1e6).toFixed(2), PAL.cyan, 'M');", "    row('hist/s, 60 gen/s', (hs / 1e6).toFixed(2), PAL.cyan, 'M');")

# ---- compute plant: frame trace with real JS per frame; real per-worker rates
s = rep(s, """    // frame time trace
    const f = { x: rx0 + 40, y: y - 4, w: rx1 - rx0 - 40, h: 34 };
    drawFrame(g, f);
    T(g, 'FRAME', rx0, y + 6, FT(8.5, 600), PAL.muted);
    T(g, 'ms', rx0, y + 17, FC(7.5), PAL.muted);""", """    // frame time trace: page frame interval (kit) and this page's real JavaScript per frame
    const f = { x: rx0 + 40, y: y - 4, w: rx1 - rx0 - 40, h: 34 };
    drawFrame(g, f);
    T(g, 'FRAME', rx0, y + 6, FT(8.5, 600), PAL.muted);
    T(g, 'ms', rx0, y + 17, FC(7.5), PAL.muted);
    const js = APP.jsSeries || [];
    let jmax = 0, jsum = 0;
    for (const v of js) {
      jmax = Math.max(jmax, v);
      jsum += v;
    }
    g.fillStyle = hexA('#6FE3FF', 0.55);
    for (let k = 0; k < js.length; k++) {
      const hh = Math.max(1, (Math.min(40, js[k]) / 40) * f.h);
      g.fillRect(f.x + (k / 240) * f.w, f.y + f.h - hh, Math.max(1, f.w / 240 - 0.2), hh);
    }
    T(g, `JS ${js.length ? (jsum / js.length).toFixed(1) : '-'} avg \\u00b7 ${jmax.toFixed(0)} max`, f.x + 3, f.y + 9, FM(7), PAL.cyan);""")
s = rep(s, """    for (let i = 0; i < 6; i++) {
      const x = rx0 + (i % 3) * 94, yy = y + Math.floor(i / 3) * 12;
      T(g, `MC${i + 1}`, x, yy + 4, FT(8.5, 700), PAL.violet);
      T(g, `${(hsTot / 6 / 1000).toFixed(0)}k/s ${M.workerMs[i].toFixed(1)}ms`, x + 24, yy + 4, FM(8), PAL.muted);
    }""", """    const shares = M.last ? M.last.shares : [];
    for (let i = 0; i < 6; i++) {
      const x = rx0 + (i % 3) * 94, yy = y + Math.floor(i / 3) * 12;
      const ms = M.workerMs[i];
      T(g, `MC${i + 1}`, x, yy + 4, FT(8.5, 700), PAL.violet);
      T(g, `${ms > 0 ? ((shares[i] || 0) / ms).toFixed(0) : 0}k/s ${ms.toFixed(1)}ms`, x + 24, yy + 4, FM(8), PAL.muted);
    }
    T(g, `\\u03a3 ${(hsTot / 1e6).toFixed(2)} M/s delivered, frame-capped 60 gen/s`, rx1, y - 13 + 0, FM(7), PAL.muted, 'right');""")

# ---- status chip: tech-spec action when QPTR > 1.02 after the drop
s = rep(s, """    for (const [name, on, col] of chips) {
      const flash = name === 'ROD DROPPED' && on ? 0.55 + 0.45 * Math.sin(APP.now / 1000 * Math.PI * 2 * 1.6) : 1;
      g.fillStyle = on ? hexA(col, 0.18 * flash) : 'rgba(26,42,61,0.35)';
      g.fillRect(cx, 8, cw, 24);
      rect(g, cx, 8, cw, 24, on ? hexA(col, 0.9 * flash) : PAL.line);
      g.fillStyle = on ? col : PAL.dim;
      g.beginPath();
      g.arc(cx + 12, 20, 3, 0, Math.PI * 2);
      g.fill();
      g.letterSpacing = '0.5px';
      T(g, name, cx + 22, 24, FT(10.5, 700), on ? col : PAL.dim);
      g.letterSpacing = '0px';
      cx += cw + 8;
    }""", """    for (const [name, on, col] of chips) {
      const flash = name === 'ROD DROPPED' && on ? 0.55 + 0.45 * Math.sin(APP.now / 1000 * Math.PI * 2 * 1.6) : 1;
      g.fillStyle = on ? hexA(col, 0.18 * flash) : 'rgba(26,42,61,0.35)';
      g.fillRect(cx, 6, cw, 28);
      rect(g, cx, 6, cw, 28, on ? hexA(col, 0.9 * flash) : PAL.line);
      g.fillStyle = on ? col : PAL.dim;
      g.beginPath();
      g.arc(cx + 12, 20, 3, 0, Math.PI * 2);
      g.fill();
      g.letterSpacing = '0.5px';
      if (name === 'ROD DROPPED' && on && r.qptr > 1.02) {
        T(g, 'ROD DROPPED', cx + 22, 18, FT(10, 700), col);
        g.letterSpacing = '0px';
        T(g, 'TS QPTR>1.02: REDUCE PWR', cx + 22, 29, FT(7.5, 600), PAL.text);
      } else T(g, name, cx + 22, 24, FT(10.5, 700), on ? col : PAL.dim);
      g.letterSpacing = '0px';
      cx += cw + 8;
    }""")

# ---- axis labels: at least three ticks
s = rep(s, """    const tx = (TX0 + TX1) / 2;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = y1 - ((v - lo) / span) * (y1 - y0);
      if (y < y0 + 7 || y > y1 - 5) continue;""", """    const nice = [1, 2, 2.5, 5, 10];
    const fits = (st) => {
      let c = 0;
      for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
        const y = y1 - ((v - lo) / span) * (y1 - y0);
        if (y >= y0 + 6 && y <= y1 - 4) c++;
      }
      return c;
    };
    for (let guard = 0; guard < 6 && fits(step) < 3; guard++) {
      const m = step / Math.pow(10, Math.floor(Math.log10(step)));
      const k = nice.findIndex((q) => Math.abs(q - m) < 1e-6);
      step = k > 0 ? nice[k - 1] * Math.pow(10, Math.floor(Math.log10(step))) : 0.5 * step;
    }
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5 ? 1 : 0));
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = y1 - ((v - lo) / span) * (y1 - y0);
      if (y < y0 + 6 || y > y1 - 4) continue;""")

# ---- tilt chart: autoscale with headroom, drop worth readout
s = rep(s, """    let [qlo, qhi] = rangeOf(h, A, (r) => Math.max(r.qptr, ...r.q), 0.1);
    let qlo2 = rangeOf(h, A, (r) => Math.min(...r.q), 0.1)[0];
    qlo = Math.min(0.96, qlo2);
    qhi = Math.max(1.04, qhi);""", """    let qmin = Infinity, qmax = -Infinity;
    for (const r of h) {
      if (r.t < A.t0) continue;
      qmin = Math.min(qmin, ...r.q);
      qmax = Math.max(qmax, r.qptr);
    }
    const qlo = Math.min(0.95, qmin - 0.06), qhi = Math.max(1.05, qmax + 0.08);""")
s = rep(s, "    row('F_xy max', APP.fxyMax.toFixed(3), PAL.muted);", "    row('F_xy max', APP.fxyMax.toFixed(3), PAL.muted);\n    row('drop worth', APP.dropped && r.dropWorth ? neg(r.dropWorth, 0) : '\\u2013', PAL.down, 'pcm');")

# ---- kinetics: precursors over the 0-120 s response, end label off the trace
a = s.index("    const gy = 180, gh = 30;")
b = s.index("  function inhour(w) {")
s = s[:a] + """    const gy = 180, gh = 30;
    T(g, 'PRECURSORS AT t = 120 s \\u00b7 BAR C\\u1d62/C\\u1d62(0) \\u00b7 TICK P/P0 \\u00b7 LABEL C\\u1d62/C\\u1d62,eq', 10, gy - 11, FT(8.5, 600), PAL.muted);
    const BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
    const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
    const cEnd = k.cEnd || APP.prec.map(() => 1);
    const pEnd = k.pEnd || 1;
    const dev = Math.max(0.02, Math.abs(pEnd - 1), ...cEnd.map((c) => Math.abs(c - 1)));
    const colw = (p.w - 20) / 6;
    for (let i = 0; i < 6; i++) {
      const x = 10 + i * colw, cw2 = colw - 8;
      const by0 = gy + 4, bh = gh - 4, mid = by0 + bh / 2;
      const sc = (bh / 2 - 1) / dev;
      g.fillStyle = 'rgba(26,42,61,0.55)';
      g.fillRect(x, by0, cw2, bh);
      const col = i < 2 ? PAL.violet : i < 4 ? PAL.blue : PAL.cyan;
      const d = (cEnd[i] - 1) * sc;
      g.fillStyle = hexA(col, 0.85);
      g.fillRect(x + 4, d >= 0 ? mid - d : mid, cw2 - 8, Math.max(1, Math.abs(d)));
      g.fillStyle = PAL.white;
      g.fillRect(x, Math.round(mid), cw2, 1);
      g.fillStyle = PAL.cyan;
      g.fillRect(x, Math.round(mid - (pEnd - 1) * sc), 4, 1.5);
      g.fillRect(x + cw2 - 4, Math.round(mid - (pEnd - 1) * sc), 4, 1.5);
      const lag = cEnd[i] / pEnd;
      T(g, `G${i + 1}`, x, gy, FC(8.5, 600), PAL.muted);
      T(g, lag.toFixed(3), x + cw2, gy, FM(8.5, 600), Math.abs(lag - 1) < 0.0005 ? PAL.text : lag > 1 ? PAL.amber : PAL.cyan, 'right');
      T(g, `\\u03b2 ${BETA[i].toExponential(2).replace('e-', 'e\\u2212')}`, x, gy + gh + 10, FM(7.5), PAL.muted);
      T(g, `\\u03bb ${LAM[i]}/s`, x, gy + gh + 20, FM(7.5), PAL.muted);
    }
  }
""" + s[b:]
s = rep(s, "      const pad = (mx - mn) * 0.18 || 0.001;\n      mn -= pad;\n      mx += pad;", "      const pad = (mx - mn) * 0.32 || 0.001;\n      mn -= pad;\n      mx += pad;")
s = rep(s, """      T(g, `${tr[tr.length - 1].toFixed(4)}`, ax.x + ax.w - 2, yy(tr[tr.length - 1]) + (k.rho >= 0 ? 10 : -4), FM(8), PAL.cyan, 'right');""", """      // end value beside the trace end (above a rising trace, below a falling one), with a leader
      const ye = yy(tr[tr.length - 1]), xe = ax.x + ax.w;
      const ly = Math.max(ax.y + 9, Math.min(ax.y + ax.h - 3, k.rho >= 0 ? ye - 9 : ye + 15));
      T(g, tr[tr.length - 1].toFixed(4), xe - 12, ly, FM(8), PAL.cyan, 'right');
      g.strokeStyle = hexA('#6FE3FF', 0.6);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xe - 11, ly + (k.rho >= 0 ? 2 : -8));
      g.lineTo(xe - 1, ye);
      g.stroke();""")
save(p, s)
print('ok')

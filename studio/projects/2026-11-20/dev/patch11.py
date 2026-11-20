import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:110]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

# ---------------- panels.js ----------------
P='panels.js'
patch(P, [
# overview lanes: rects + transition ticks; hexagons only in the zoom pane
("""        // bus lane: segments of constant value, coloured by value, hex label where it fits (one outline stroke per lane)
        const HC = zoom ? HUE_Z : HUE_O;""",
"""        if (!zoom) {
          // overview: one rect per constant segment, a tick at each transition, two rails
          const ticks = new Path2D();
          const labels = [];
          let c = c0;
          while (c < c1) {
            const v = cap.W[c][k];
            let e = c + 1;
            while (e < c1 && cap.W[e][k] === v) e++;
            const xa = x0 + (c - c0) * cw, xb = x0 + (e - c0) * cw;
            if (bits !== 2 || v === 1 || v === 2) { ctx.fillStyle = bits === 2 ? (v === 1 ? FWD1 : FWD2) : HUE_O[hueOf(v)]; ctx.fillRect(xa, yt + 1, xb - xa, yb - yt - 1); }
            if (c > c0) { ticks.moveTo(Math.round(xa) + 0.5, yt); ticks.lineTo(Math.round(xa) + 0.5, yb); }
            if (xb - xa > 18) { const lbl = bits === 2 ? (v === 1 ? 'XM' : v === 2 ? 'MW' : '') : bits === 5 ? ABI[v] : fmt.hex(v & 0xffff, 4); if (lbl) labels.push([lbl, xa, xb]); }
            c = e;
          }
          ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, Math.round(yt) + 0.5); ctx.lineTo(x0 + (c1 - c0) * cw, Math.round(yt) + 0.5); ctx.moveTo(x0, Math.round(yb) + 0.5); ctx.lineTo(x0 + (c1 - c0) * cw, Math.round(yb) + 0.5); ctx.stroke();
          ctx.stroke(ticks);
          ctx.font = F.mono(8.5);
          for (const [lbl, xa, xb] of labels) if (ctx.measureText(lbl).width + 6 < xb - xa) text(ctx, lbl, (xa + xb) / 2, ym + 0.5, F.mono(8.5), P.text, 'center');
          return;
        }
        // zoom pane: hexagon segments with full hex labels (one outline stroke per lane)
        const HC = zoom ? HUE_Z : HUE_O;"""),
# staggered first paint (one more panel per frame), no forced first draws
("""  function draw(now) {
    const f = APP.frame;""", """  function draw(now) {
    const f = APP.frame;
    const pf = (cv.pf = (cv.pf || 0) + 1); // frames since the first paint: panels join one per frame
    if (pf < 2) { drawTop(now); if (GL) GL.draw(APP.heat, APP.flash); drawFloorOverlay(now); return; }
    if (pf < 10) {
      [() => drawTop(now), () => GL && GL.draw(APP.heat, APP.flash), () => drawFloorOverlay(now)].forEach((fn) => fn());
      [() => drawWave(now), drawRegs, drawPipe, () => drawOut(now), drawFault, drawRes, drawHier, drawControls].slice(0, pf - 1).forEach((fn, i) => { if (i === pf - 2) fn(); else if (i < 3) fn(); });
      return;
    }"""),
("""    if (f % 6 === 2 || !cv.resDone) { drawRes(); cv.resDone = 1; }
    if (f % 15 === 0 || !cv.hierDone) { drawHier(); cv.hierDone = 1; }
    if (f % 15 === 0 || !cv.ctlDone) { drawControls(); cv.ctlDone = 1; }""",
 """    if (f % 6 === 2) drawRes();
    if (f % 15 === 0) { drawHier(); drawControls(); }"""),
# font and GL warm-up at init (not inside an animation frame)
("""    buildPalette();
    drawFloorStatic();
    initControls();""", """    buildPalette();
    drawFloorStatic();
    initControls();
    { // warm the text shaper for every font in use, and the GL program, before the first frame
      const t = document.createElement('canvas'); t.width = 64; t.height = 16; const c = t.getContext('2d');
      for (const px of [7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13]) for (const wgt of [400, 600]) { c.font = F.mono(px, wgt); c.fillText('0x1f Ab', 0, 10); c.font = F.ui(px, wgt); c.fillText('Ab fF', 0, 10); c.font = F.title(px, wgt); c.fillText('AB', 0, 10); }
      c.font = F.ui(15, 600); c.fillText('Every Gate', 0, 10);
      if (GL) GL.draw(APP.heat, APP.flash);
    }"""),
# fault panel header: measured faults per second
("""    frame(ctx, w, h, 'Stuck-at campaign', `${act.length} workers · 31 faults per word`, `${fmt.int(FA.batches)} batches`);""",
 """    frame(ctx, w, h, 'Stuck-at campaign', `${act.length} workers · 31 faults/word`, `${fmt.int(FA.batches)} batches · ${Math.round(APP.faultRate || 0)} faults/s`);"""),
# top bar: measured worker capacity next to the paced clock
("""      ['SIM CLOCK', (APP.hz / 1000).toFixed(2) + ' kHz', P.active, 80, 'target ' + (APP.cfg.clockHz / 1000).toFixed(0)],
      ['GATE EVALS/S', fmt.si(APP.hz * GATES(), 1) + '/s', P.text, 80],""",
 """      ['SIM CLOCK', (APP.hz / 1000).toFixed(2) + ' kHz', P.active, 80, 'cap ' + ((APP.cap || 0) / 1000).toFixed(1) + 'k'],
      ['GATE EVALS/S', fmt.si(APP.hz * GATES(), 1) + '/s', P.text, 80, 'cap ' + fmt.si((APP.cap || 0) * GATES(), 0).trim()],"""),
("""        r1: () => (c.clockHz / 1000).toFixed(1) + ' kHz', r2: () => 'measured ' + (APP.hz / 1000).toFixed(2) },""",
 """        r1: () => (c.clockHz / 1000).toFixed(1) + ' kHz', r2: () => `meas ${(APP.hz / 1000).toFixed(2)} · cap ${((APP.cap || 0) / 1000).toFixed(1)}` },"""),
# controls: units in the UI face so fF reads as femtofarads
("""          text(ctx, u, fx + 39, cy, F.mono(8), P.muted);""", """          text(ctx, u, fx + 39, cy, F.ui(9), P.muted);"""),
# register file heading
("""    label(ctx, 'PERF COUNTERS · FROM PIPELINE NETS', X, y, P.blue, 'left', 8.5); y += rh;""", """    label(ctx, 'PERF COUNTERS · NETS', X, y, P.blue, 'left', 8.5); y += rh;"""),
# framebuffer: no placeholder text; previous frame at 10% under a dim dot grid
("""    const img = fbToImage(s.fb, maxit, px);""", """    const img = fbToImage(s.fb, maxit, px, APP.thumbs.length ? APP.thumbs[APP.thumbs.length - 1].fb : null);"""),
("""    if (px < 1536 - 48 * 3) text(ctx, 'not painted yet', FX + 24 * SC, FY + (Math.ceil(px / 48) + (32 - Math.ceil(px / 48)) / 2) * SC, F.mono(8.5), P.dim, 'center');\n""", ""),
("""  function fbToImage(fb, maxit, upto) {
    const img = new ImageData(48, 32);
    for (let i = 0; i < 1536; i++) {
      const v = fb[i];
      const o = i * 4;
      if (upto !== undefined && i >= upto) { img.data[o] = 8; img.data[o + 1] = 10; img.data[o + 2] = 14; img.data[o + 3] = 255; continue; }""",
 """  function fbToImage(fb, maxit, upto, under) {
    const img = new ImageData(48, 32);
    for (let i = 0; i < 1536; i++) {
      const v = fb[i];
      const o = i * 4;
      if (upto !== undefined && i >= upto) {
        if (under && under[i] < maxit) { const k = Math.min(64, Math.round((under[i] / maxit) * 64)) * 4; img.data[o] = 8 + PAL[k] * 0.1; img.data[o + 1] = 10 + PAL[k + 1] * 0.1; img.data[o + 2] = 14 + PAL[k + 2] * 0.1; }
        else { img.data[o] = 8; img.data[o + 1] = 10; img.data[o + 2] = 14; }
        img.data[o + 3] = 255; continue;
      }"""),
("""    label(ctx, 'FINISHED FRAMES', TX, 31, P.muted, 'left', 8.5);""", """    label(ctx, 'FRAMES', TX, 31, P.muted, 'left', 8.5);"""),
("""        cv.fbImg.getContext('2d').putImageData(fbToImage(s.fb, maxit, px), 0, 0);
        ctx.drawImage(cv.fbImg, x, y, TW, TH);
        text(ctx, `f${fr}`, x, y + TH + 7, F.mono(8.5, 600), P.active);""",
 """        cv.fbImg.getContext('2d').putImageData(fbToImage(s.fb, maxit, px), 0, 0);
        ctx.drawImage(cv.fbImg, x, y, TW, TH);
        ctx.fillStyle = 'rgba(6,7,10,0.85)'; ctx.fillRect(x + 1, y + TH - 11, 44, 10);
        label(ctx, 'painting', x + 4, y + TH - 6, P.active, 'left', 7.5);
        text(ctx, `f${fr}`, x, y + TH + 7, F.mono(8.5, 600), P.active);"""),
# hierarchy: a glue row for cells directly in the top module, tighter rows
("""  const HROWS = [['core', 0], ['ifu', 1],""", """  const HROWS = [['core', 0], ['glue', 1], ['ifu', 1],"""),
("""    if (!hIdx) hIdx = HROWS.map(([p]) => D.mods.findIndex((m) => m.path === (p === 'core' ? 'core' : 'core/' + p)));""",
 """    if (!hIdx) hIdx = HROWS.map(([p]) => (p === 'glue' ? -1 : D.mods.findIndex((m) => m.path === (p === 'core' ? 'core' : 'core/' + p))));"""),
("""    const rh = 10.55;
    const tot = S.cells[0] + S.dff[0];""", """    const rh = 10.2;
    const tot = S.cells[0] + S.dff[0];
    // own value of the top module = subtree minus its children (cells placed directly in core, e.g. the reset inverter)
    const kids = D.mods.map((m, i) => i).filter((i) => D.mods[i].parent === 0);
    const own = (arr, stride = 1, off = 0) => arr[0 * stride + off] - kids.reduce((a, k) => a + arr[k * stride + off], 0);"""),
("""      const m = hIdx[r];
      const y = y0 + 13 + r * rh;
      const cells = S.cells[m], dff = S.dff[m], n = cells + dff;""",
 """      const m = hIdx[r], glue = m < 0;
      const y = y0 + 13 + r * rh;
      const cells = glue ? own(S.cells) : S.cells[m], dff = glue ? own(S.dff) : S.dff[m], n = cells + dff;"""),
("""      const tg = APP.snap.mod[m], alpha = n ? tg / n : 0;
      const sim = FA.perMod[m * 2 + 1], det = FA.perMod[m * 2];""",
 """      const tg = glue ? own(APP.snap.mod) : APP.snap.mod[m], alpha = n ? tg / n : 0;
      const sim = glue ? own(FA.perMod, 2, 1) : FA.perMod[m * 2 + 1], det = glue ? own(FA.perMod, 2, 0) : FA.perMod[m * 2];"""),
("""      const vals = [String(cells), dff ? String(dff) : '·', String(Math.round(S.nand[m])), String(S.depth[m]),""",
 """      const vals = [String(cells), dff ? String(dff) : '·', glue ? own(S.nand).toFixed(2) : String(Math.round(S.nand[m])), glue ? '1' : String(S.depth[m]),"""),
])

# pipeline: 16 cycles, 12 readable rows
patch(P, [
("""    const NR = 18, rh = 7.3;""", """    const NR = 12, rh = 10;"""),
("""    const cx0 = 150, cw = (w - 8 - cx0) / NC, y0 = 28;""", """    const cx0 = 166, cw = (w - 8 - cx0) / NC, y0 = 28;"""),
("""      text(ctx, fmt.hex(r.pc, 4), 8, y + rh / 2, F.mono(7.5), P.muted);
      text(ctx, ins.length > 21 ? ins.slice(0, 21) : ins, 33, y + rh / 2, F.mono(7.5), P.text);""",
 """      text(ctx, fmt.hex(r.pc, 4), 8, y + rh / 2, F.mono(9), P.muted);
      text(ctx, ins.length > 21 ? ins.slice(0, 21) : ins, 38, y + rh / 2, F.mono(9), P.text);"""),
("""        text(ctx, STL[k], x + (cw - 1.5) / 2, y + rh / 2 - 0.2, F.mono(6.5, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');""",
 """        text(ctx, ['IF', 'ID', 'EX', 'MEM', 'WB'][k], x + (cw - 1.5) / 2, y + rh / 2, F.mono(7.5, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');"""),
("""    text(ctx, 'F D X M W = IF ID EX MEM WB', 8, y0 + 3, F.mono(7.5), P.dim);\n""", ""),
])

# resources: load-rank tags on the thread tiles
patch(P, [
("""    const nt = Math.max(16, (m.cpu || []).length);""", """    const nt = Math.max(16, (m.cpu || []).length);
    // tags by load rank over the last 3 s (the browser cannot see which OS thread runs which worker)
    const recent = STUDIO.history(3);
    const avg = Array.from({ length: 16 }, (_, t) => recent.reduce((a, s) => a + (s.cpu && s.cpu[t] !== undefined ? s.cpu[t] : 0), 0) / Math.max(1, recent.length));
    const order = avg.map((v, t) => [v, t]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
    const nW = APP.cfg.workers;
    const tags = new Array(16).fill(null);
    order.forEach((t, r) => { tags[t] = r === 0 ? ['sim', P.magenta] : r === 1 ? ['main', P.blue] : r - 2 < nW ? ['W' + (r - 1), P.cyan] : ['os', P.dim]; });"""),
("""      text(ctx, 'T' + String(t).padStart(2, '0'), x + 3, y + 6, F.mono(8), P.muted);""",
 """      text(ctx, 'T' + String(t).padStart(2, '0'), x + 3, y + 6, F.mono(8), P.muted);
      text(ctx, tags[t][0], x + 21, y + 6, F.mono(8, 600), tags[t][1]);"""),
("""    frame(ctx, w, h, 'This PC', 'live · 60 s', `${sys.threads || 16} threads · ${sys.ramGB || ''} GB`);""",
 """    frame(ctx, w, h, 'This PC', 'tags by load rank', `${sys.threads || 16} threads · ${sys.ramGB || ''} GB`);"""),
])

# ---------------- workers / main ----------------
patch('sim-worker.js', [("const PIPE_N = 24;", "const PIPE_N = 16;")])
patch('main.js', [
# fault budgets: frame-metered but with seeded jitter (40-88 cycles, mean 64), so batches drift apart naturally
("""      const msg = { type: 'work', id: w.id, budget: FAULT_BUDGET };""",
 """      const msg = { type: 'work', id: w.id, budget: FAULT_BUDGET - 24 + Math.floor(faultRng() * 49) };"""),
("""  function dispatchFaults() {""", """  const faultRng = STUDIO.rng(9001);
  function dispatchFaults() {"""),
# measured faults per second (page clock) and worker capacity (compute time inside the sim worker)
("""    APP.workMs = APP.workMs ? APP.workMs * 0.9 + m.workMs * 0.1 : m.workMs;""",
 """    APP.workMs = APP.workMs ? APP.workMs * 0.9 + m.workMs * 0.1 : m.workMs;
    if (m.workMs > 0 && !APP.prewarm) { const c = (m.n / m.workMs) * 1000; APP.cap = APP.cap ? APP.cap * 0.9 + c * 0.1 : c; }"""),
("""      FA.curve.push([FA.sim, FA.det]);""", """      FA.curve.push([FA.sim, FA.det]);
      FA.rateHist.push([performance.now(), FA.sim]);
      while (FA.rateHist.length > 2 && FA.rateHist[0][0] < performance.now() - 3000) FA.rateHist.shift();
      if (FA.rateHist.length > 1) { const a = FA.rateHist[0], b = FA.rateHist[FA.rateHist.length - 1]; APP.faultRate = b[0] > a[0] ? ((b[1] - a[1]) * 1000) / (b[0] - a[0]) : 0; }"""),
("""    cyclesTotal: 0, batches: 0,""", """    cyclesTotal: 0, batches: 0, rateHist: [],"""),
])
print('ok')

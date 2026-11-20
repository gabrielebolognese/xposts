import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:100]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

p='panels.js'
s=open(p,encoding='utf-8').read()
a=s.index("  function drawPipe() {")
b=s.index("  // ------------------------------------------------------------------------------------------------\n  // Framebuffer & UART")
s=s[:a]+open('dev/pipe_new.js',encoding='utf-8').read()+'\n'+s[b:]
open(p,'w',encoding='utf-8').write(s)

patch('sim-worker.js', [("const PIPE_N = 16;", "const PIPE_N = 24;")])

patch('panels.js', [
# shared 1 s window everywhere
("    const pw = () => 0.5 * APP.totTog * c.C * 1e-15 * c.V * c.V * c.f * 1e6 * 1e3;",
 "    const pw = () => 0.5 * APP.snap.tog * c.C * 1e-15 * c.V * c.V * c.f * 1e6 * 1e3;"),
("      { name: 'Process (power est.)', kind: 'fields', r1: () => pw().toFixed(3) + ' mW', r2: () => '½·tog·C·V²·f' },",
 "      { name: 'Process (power est.)', kind: 'fields', r1: () => pw().toFixed(3) + ' mW', r2: () => '1 s avg' },"),
("      const tg = APP.modTog[m], alpha = n ? tg / n : 0;", "      const tg = APP.snap.mod[m], alpha = n ? tg / n : 0;"),
("    frame(ctx, w, h, 'Netlist hierarchy', `${HROWS.length} of ${D.mods.length} modules`,", "    frame(ctx, w, h, 'Netlist hierarchy', `${HROWS.length} of ${D.mods.length} · TOG 1 s avg`,"),
# analyzer axis: full cycle at the left edge, offsets after; zoom pane relative to the trigger
("""    for (let c = 0; c < n; c += 20) { vline(ctx, OX0 + c * ow, ya - 3, ya, P.dim); text(ctx, String(cap.cyc[c] % 100000), OX0 + c * ow + 2, ya + 3, F.mono(7.5), P.dim); }
    for (let c = 0; c < zc; c++) text(ctx, String(cap.cyc[zs + c] % 100000), ZX0 + c * zw + zw / 2, ya + 3, F.mono(8), c + zs === cap.trig ? P.down : P.muted, 'center');""",
 """    for (let c = 0; c < n; c += 20) { vline(ctx, OX0 + c * ow, ya - 3, ya, P.dim); if (c === 0) text(ctx, fmt.int(cap.cyc[0]), OX0 + 2, ya + 3, F.mono(7.5), P.muted); else if (c >= 40) text(ctx, '+' + c, OX0 + c * ow + 2, ya + 3, F.mono(7.5), P.dim); }
    const tl = cap.net ? 'T' : 'C';
    for (let c = 0; c < zc; c++) { const d = zs + c - cap.trig; text(ctx, d === 0 ? `${tl} ${fmt.int(cap.cyc[cap.trig])}` : `${tl}${d > 0 ? '+' : '−'}${Math.abs(d)}`, ZX0 + c * zw + zw / 2, ya + 3, F.mono(8), d === 0 ? P.down : P.muted, 'center'); }"""),
("""    text(ctx, fmt.int(cap.tog[cap.trig]), VX, hy + hh / 2, F.mono(9.5), P.cyan);""",
 """    text(ctx, `${fmt.int(cap.tog[cap.trig])} @${cap.net ? 'T' : 'C'}`, VX, hy + hh / 2, F.mono(9.5), P.cyan);"""),
# framebuffer: unpainted rows as a dark dotted grid, not the previous frame
("""    const prev = APP.thumbs.length ? APP.thumbs[APP.thumbs.length - 1].fb : null;
    const img = fbToImage(s.fb, maxit);
    if (prev) {
      for (let i = px; i < 1536; i++) { const o = i * 4; img.data[o] *= 0.28; img.data[o + 1] *= 0.28; img.data[o + 2] *= 0.32; }
    }
    cv.fbImg.getContext('2d').putImageData(img, 0, 0);
    const FX = 8, FY = 30, SC = 5;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv.fbImg, FX, FY, 48 * SC, 32 * SC);""",
 """    const img = fbToImage(s.fb, maxit, px);
    cv.fbImg.getContext('2d').putImageData(img, 0, 0);
    const FX = 8, FY = 30, SC = 5;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv.fbImg, FX, FY, 48 * SC, 32 * SC);
    // pixels not painted yet this frame: one dim dot per pixel
    ctx.fillStyle = '#20252F';
    for (let i = px; i < 1536; i++) ctx.fillRect(FX + (i % 48) * SC + 2, FY + Math.floor(i / 48) * SC + 2, 1, 1);
    if (px < 1536 - 48 * 3) text(ctx, 'not painted yet', FX + 24 * SC, FY + (Math.ceil(px / 48) + (32 - Math.ceil(px / 48)) / 2) * SC, F.mono(8.5), P.dim, 'center');"""),
# resources: smaller thread cells, measured worker busy chips
("""    const cw = (w - 16 - 3 * 6) / 4, ch = 28;""", """    const cw = (w - 16 - 3 * 6) / 4, ch = 24;"""),
("""    let y = 30 + 4 * (ch + 6) + 2;
    const row = (lab, val, vals, max, col, sub) => {""",
 """    let y = 30 + 4 * (ch + 6) + 1;
    // workers: measured compute per frame inside each worker (the browser cannot say which OS thread runs which)
    const chips = [['sim', APP.workMs || 0, P.magenta]].concat(APP.fault.workers.filter((x) => x.id < APP.cfg.workers).map((x) => ['W' + (x.id + 1), x.ms || 0, P.cyan]));
    text(ctx, 'ms/frame', 8, y + 5, F.mono(7.5), P.dim);
    let cx2 = 50;
    for (const [nm, ms, col] of chips) {
      text(ctx, nm, cx2, y + 5, F.mono(8, 600), col);
      ctx.font = F.mono(8, 600); const nw = ctx.measureText(nm).width;
      text(ctx, ms.toFixed(1), cx2 + nw + 3, y + 5, F.mono(8), P.text);
      cx2 += nw + 3 + 22 + 6;
    }
    y += 12;
    const row = (lab, val, vals, max, col, sub) => {"""),
("""    row('CPU total', `${(m.cpuTotal || 0).toFixed(0)}%`, hist.map((s) => s.cpuTotal || 0), 100, P.blue, `sim worker ${(APP.workMs || 0).toFixed(1)} ms/frame`);""",
 """    row('CPU total', `${(m.cpuTotal || 0).toFixed(0)}%`, hist.map((s) => s.cpuTotal || 0), 100, P.blue, `threads T00-T15`);"""),
# fault panel: progress as cyc/len, previous batch dimmed until the new batch has detections
("""    for (const wk of act) {
      const b = wk.batch;
      text(ctx, 'W' + (wk.id + 1), 8, y + 4, F.mono(9.5, 600), P.text);
      text(ctx, b ? '#' + b.id : '-', 26, y + 4, F.mono(8.5), P.muted);
      const pbx = 62, pbw = 70;
      ctx.fillStyle = '#151922'; ctx.fillRect(pbx, y, pbw, 8);
      if (b) { ctx.fillStyle = b.done ? rgba(P.blue, 0.5) : P.blue; ctx.fillRect(pbx, y, (pbw * b.cyc) / b.len, 8); }
      text(ctx, b ? `${b.cyc}` : '', pbx + pbw + 4, y + 4, F.mono(8), P.muted);
      const lx = 166;
      let nd = 0;
      for (let l = 1; l <= 31; l++) {
        const det = b && (b.det >>> l) & 1;
        if (det) nd++;
        ctx.fillStyle = !b || l > b.faults.length ? '#12151B' : det ? P.green : b.done ? P.red : '#252B36';
        ctx.fillRect(lx + (l - 1) * 5.5, y, 4.5, 8);
      }
      text(ctx, b ? `${nd}/${b.faults.length}` : '', w - 8, y + 4, F.mono(8.5), P.text, 'right');
      y += 12;
    }""",
 """    for (const wk of act) {
      const b = wk.batch;
      text(ctx, 'W' + (wk.id + 1), 8, y + 4, F.mono(9.5, 600), P.text);
      text(ctx, b ? '#' + b.id : '-', 26, y + 4, F.mono(8.5), P.muted);
      const pbx = 58, pbw = 56;
      ctx.fillStyle = '#151922'; ctx.fillRect(pbx, y, pbw, 8);
      if (b) { ctx.fillStyle = b.done ? rgba(P.blue, 0.5) : P.blue; ctx.fillRect(pbx, y, (pbw * b.cyc) / b.len, 8); }
      text(ctx, b ? `${b.cyc}/${b.len}` : 'waiting', pbx + pbw + 4, y + 4, F.mono(8), P.muted);
      // the bitmap shows the running batch; until it has a detection, the previous batch's result stays, dimmed
      const showPrev = b && !b.det && wk.prev;
      const bb = showPrev ? wk.prev : b;
      const lx = 166;
      let nd = 0;
      ctx.globalAlpha = showPrev ? 0.4 : 1;
      for (let l = 1; l <= 31; l++) {
        const det = bb && (bb.det >>> l) & 1;
        if (det) nd++;
        ctx.fillStyle = !bb || l > bb.faults.length ? '#12151B' : det ? P.green : bb.done ? P.red : '#252B36';
        ctx.fillRect(lx + (l - 1) * 5.5, y, 4.5, 8);
      }
      ctx.globalAlpha = 1;
      text(ctx, bb ? `${nd}/${bb.faults.length}` : '', w - 8, y + 4, F.mono(8.5), showPrev ? P.muted : P.text, 'right');
      y += 12;
    }"""),
# redraw schedule: counters and trace every frame, shared-stat panels on the snapshot frame
("""    if (f % 2 === 0) drawRegs(); else drawPipe();
    if (f % 3 === 0) drawOut(now);
    if (f % 3 === 1) drawFault();
    if (f % 6 === 2 || !cv.resDone) { drawRes(); cv.resDone = 1; }
    if (f % 10 === 5 || !cv.hierDone) { drawHier(); cv.hierDone = 1; }
    if (f % 15 === 7 || !cv.ctlDone) { drawControls(); cv.ctlDone = 1; }""",
 """    drawRegs();
    drawPipe();
    if (f % 3 === 1) drawOut(now);
    if (f % 3 === 0) drawFault();
    if (f % 6 === 2 || !cv.resDone) { drawRes(); cv.resDone = 1; }
    if (f % 15 === 0 || !cv.hierDone) { drawHier(); cv.hierDone = 1; }
    if (f % 15 === 0 || !cv.ctlDone) { drawControls(); cv.ctlDone = 1; }"""),
])
print('ok')

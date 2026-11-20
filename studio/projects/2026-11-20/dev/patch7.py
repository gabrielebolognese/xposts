import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

patch('panels.js', [
# hierarchy headers: keep Greek/micro lowercase
("""    for (const [nm, x] of cols) label(ctx, nm, x, y0, P.muted, 'right', 8.5);""",
 """    for (const [nm, x] of cols) { if (/[αµ]/.test(nm)) text(ctx, nm, x, y0, F.mono(8.5), P.muted, 'right'); else label(ctx, nm, x, y0, P.muted, 'right', 8.5); }"""),
("""    const cols = [['CELLS', 118], ['DFF', 145], ['NAND2', 179], ['DEP', 199],""", """    const cols = [['CELLS', 118], ['DFF', 145], ['NAND2', 177], ['DEP', 199],"""),
# thumbnails: finished frames, then the frame being painted, then the next one queued
("""    const th = APP.thumbs.slice(-3);
    for (let k = 0; k < 3; k++) {
      const x = TX + k * (TW + 8), y = 38;
      box(ctx, x - 1, y - 1, TW + 2, TH + 2, P.line);
      const t = th[k];
      if (!t) { ctx.fillStyle = '#0A0C10'; ctx.fillRect(x, y, TW, TH); text(ctx, `frame ${fr + k - th.length}`, x + TW / 2, y + TH / 2, F.mono(8.5), P.dim, 'center'); continue; }
      const timg = fbToImage(t.fb, maxit);
      cv.fbImg.getContext('2d').putImageData(timg, 0, 0);
      ctx.drawImage(cv.fbImg, x, y, TW, TH);
      const cs = APP.cs[t.f];
      text(ctx, `f${t.f}`, x, y + TH + 7, F.mono(8.5, 600), P.text);
      text(ctx, cs ? cs.cs : '', x + TW, y + TH + 7, F.mono(8.5), P.muted, 'right');
    }""",
"""    const th = APP.thumbs.slice(-2);
    for (let k = 0; k < 3; k++) {
      const x = TX + k * (TW + 8), y = 38;
      const t = th[k];
      if (t) {
        box(ctx, x - 1, y - 1, TW + 2, TH + 2, P.line);
        cv.fbImg.getContext('2d').putImageData(fbToImage(t.fb, maxit), 0, 0);
        ctx.drawImage(cv.fbImg, x, y, TW, TH);
        const cs = APP.cs[t.f];
        text(ctx, `f${t.f}`, x, y + TH + 7, F.mono(8.5, 600), P.text);
        text(ctx, cs ? cs.cs : '', x + TW, y + TH + 7, F.mono(8.5), P.muted, 'right');
      } else if (k === th.length) {
        box(ctx, x - 1, y - 1, TW + 2, TH + 2, rgba(P.active, 0.6));
        cv.fbImg.getContext('2d').putImageData(fbToImage(s.fb, maxit, px), 0, 0);
        ctx.drawImage(cv.fbImg, x, y, TW, TH);
        text(ctx, `f${fr}`, x, y + TH + 7, F.mono(8.5, 600), P.active);
        text(ctx, `${(px / 15.36).toFixed(0)}% painting`, x + TW, y + TH + 7, F.mono(8.5), P.muted, 'right');
      } else {
        box(ctx, x - 1, y - 1, TW + 2, TH + 2, P.line);
        ctx.fillStyle = '#0A0C10'; ctx.fillRect(x, y, TW, TH);
        text(ctx, `f${fr + 1}`, x + TW / 2, y + TH / 2 - 5, F.mono(8.5, 600), P.dim, 'center');
        text(ctx, `next · w ${((pa[2] / PROG.Q) * 48 * (pa[3] / PROG.Q)).toFixed(4)}`, x + TW / 2, y + TH / 2 + 7, F.mono(7.5), P.dim, 'center');
      }
    }"""),
# resources rows: label + value on one line, sublabel below
("""    const row = (lab, val, vals, max, col, sub) => {
      text(ctx, lab, 8, y + 9, F.mono(9), P.muted);
      text(ctx, val, 120, y + 9, F.mono(10, 600), col, 'right');
      ctx.fillStyle = '#0A0C10'; ctx.fillRect(128, y, w - 136, 18); box(ctx, 128, y, w - 136, 18, P.line);
      if (vals) spark(ctx, 129, y + 2, w - 138, 15, vals, max, col, rgba(col, 0.14));
      if (sub) text(ctx, sub, w - 12, y + 6, F.mono(7.5), P.muted, 'right');
      y += 22;
    };
    row('CPU total', `${(m.cpuTotal || 0).toFixed(0)}%`, hist.map((s) => s.cpuTotal || 0), 100, P.blue, `${APP.cfg.workers + 1} workers + page`);
    row('RAM', `${(m.ramUsed || 0).toFixed(1)} GB`, hist.map((s) => s.ramUsed || 0), m.ramTotal || 16, P.magenta, `of ${(m.ramTotal || 0).toFixed(1)} GB`);
    row('GPU', m.gpu === null || m.gpu === undefined ? '-' : `${m.gpu.toFixed(0)}%`, m.gpu === null || m.gpu === undefined ? null : hist.map((s) => s.gpu || 0), 100, P.green, (sys.gpu || '').replace('AMD ', '').replace('(TM)', ''));
    const dr = m.diskR, dwv = m.diskW;
    row('Disk R | W', dr === null || dr === undefined ? '-' : `${dr.toFixed(1)} | ${(dwv || 0).toFixed(1)}`, dr === null || dr === undefined ? null : hist.map((s) => (s.diskR || 0) + (s.diskW || 0)), Math.max(5, ...hist.map((s) => (s.diskR || 0) + (s.diskW || 0))), P.gold, 'MB/s');""",
"""    const row = (lab, val, vals, max, col, sub) => {
      text(ctx, lab, 8, y + 6, F.mono(9), P.muted);
      text(ctx, val, 122, y + 6, F.mono(10, 600), col, 'right');
      if (sub) text(ctx, sub, 8, y + 16, F.mono(7.5), P.dim);
      ctx.fillStyle = '#0A0C10'; ctx.fillRect(128, y, w - 136, 20); box(ctx, 128, y, w - 136, 20, P.line);
      if (vals) spark(ctx, 129, y + 2, w - 138, 17, vals, max, col, rgba(col, 0.14));
      y += 23;
    };
    row('CPU total', `${(m.cpuTotal || 0).toFixed(0)}%`, hist.map((s) => s.cpuTotal || 0), 100, P.blue, `sim worker ${(APP.workMs || 0).toFixed(1)} ms/frame`);
    row('RAM', `${(m.ramUsed || 0).toFixed(1)} GB`, hist.map((s) => s.ramUsed || 0), m.ramTotal || 16, P.magenta, `of ${(m.ramTotal || 0).toFixed(1)} GB`);
    row('GPU', m.gpu === null || m.gpu === undefined ? '-' : `${m.gpu.toFixed(0)}%`, m.gpu === null || m.gpu === undefined ? null : hist.map((s) => s.gpu || 0), 100, P.green, 'integrated · WebGL2');
    const dr = m.diskR, dwv = m.diskW;
    row('Disk R|W', dr === null || dr === undefined ? '-' : `${dr.toFixed(1)}|${(dwv || 0).toFixed(1)}`, dr === null || dr === undefined ? null : hist.map((s) => (s.diskR || 0) + (s.diskW || 0)), Math.max(5, ...hist.map((s) => (s.diskR || 0) + (s.diskW || 0))), P.gold, 'MB/s');"""),
("""    text(ctx, 'Page', 8, y + 9, F.mono(9), P.muted);
    text(ctx, `${pf.fps} fps`, 120, y + 9, F.mono(10, 600), pf.fps >= 55 ? P.up : P.warn, 'right');""",
 """    text(ctx, 'Page', 8, y + 6, F.mono(9), P.muted);
    text(ctx, `${pf.fps} fps`, 122, y + 6, F.mono(10, 600), pf.fps >= 55 ? P.up : P.warn, 'right');"""),
("""    text(ctx, `frame ${pf.frameMs.toFixed(1)} ms`, 8, y + 21, F.mono(8.5), P.muted);""", """    text(ctx, `frame ${pf.frameMs.toFixed(1)} ms`, 8, y + 16, F.mono(7.5), P.dim);"""),
])
print('ok')

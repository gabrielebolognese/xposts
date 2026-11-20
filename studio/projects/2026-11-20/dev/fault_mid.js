    // coverage curve with Wilson band
    const gy = y + 4, gh = 100, gx = 8, gw = 190;
    label(ctx, 'COVERAGE VS FAULTS · 95% WILSON', gx, gy, P.muted, 'left', 8.5);
    const py0 = gy + 8, ph = gh - 12;
    ctx.fillStyle = '#0A0C10'; ctx.fillRect(gx, py0, gw, ph); box(ctx, gx, py0, gw, ph, P.line);
    const cur = FA.curve;
    const [p, lo, hi] = APP.wilson(FA.det, FA.sim);
    const yLo = Math.max(0, Math.floor((p - 0.08) * 20) / 20), yHi = Math.min(1, yLo + 0.15);
    const xmax = Math.max(1000, FA.sim * 1.08);
    const X = (n) => gx + 22 + ((gw - 26) * n) / xmax, Y = (v) => py0 + ph - 4 - ((ph - 14) * (v - yLo)) / (yHi - yLo);
    for (let g = yLo; g <= yHi + 1e-9; g += 0.05) { hline(ctx, gx + 20, gx + gw - 2, Y(g), '#161A22'); text(ctx, (g * 100).toFixed(0) + '%', gx + 18, Y(g), F.mono(7.5), P.dim, 'right'); }
    if (cur.length > 1) {
      const step = Math.max(1, Math.floor(cur.length / 120));
      ctx.fillStyle = rgba(P.blue, 0.22); ctx.beginPath();
      const up = [], dn = [];
      const clampY = (v) => Y(Math.max(yLo, Math.min(yHi, v)));
      for (let i = 0; i < cur.length; i += step) { const [n, d] = cur[i]; const [, l, u] = APP.wilson(d, n); up.push([X(n), clampY(u)]); dn.push([X(n), clampY(l)]); }
      const last = cur[cur.length - 1]; { const [, l, u] = APP.wilson(last[1], last[0]); up.push([X(last[0]), clampY(u)]); dn.push([X(last[0]), clampY(l)]); }
      up.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      for (let i = dn.length - 1; i >= 0; i--) ctx.lineTo(dn[i][0], dn[i][1]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.blue; ctx.lineWidth = 1.25; ctx.beginPath();
      for (let i = 0; i < cur.length; i += step) { const [n, d] = cur[i]; i ? ctx.lineTo(X(n), clampY(d / n)) : ctx.moveTo(X(n), clampY(d / n)); }
      ctx.lineTo(X(last[0]), clampY(last[1] / last[0]));
      ctx.stroke();
      ctx.fillStyle = P.active; ctx.beginPath(); ctx.arc(X(last[0]), clampY(last[1] / last[0]), 2, 0, 7); ctx.fill();
    }
    text(ctx, `${fmt.int(FA.sim)} of ${fmt.int(FA.universe)} sampled`, gx + gw - 4, py0 + ph - 8, F.mono(8), P.muted, 'right');
    // per-module coverage bars
    const mx = 210, mw = w - mx - 8;
    label(ctx, 'PER MODULE', mx, gy, P.muted, 'left', 8.5);
    const mods = [['ifu', 'ifu'], ['ifid', 'IF/ID'], ['idu/rf', 'regfile'], ['idu', 'idu'], ['idex', 'ID/EX'], ['exu/alu', 'alu'], ['exu/mul', 'mul'], ['exu', 'exu'], ['exmem', 'EX/MEM'], ['lsu', 'lsu']];
    const bh = (gh - 8) / mods.length;
    mods.forEach(([pth, nm], k) => {
      const m = D.mods.findIndex((x) => x.path === 'core/' + pth);
      const sim = FA.perMod[m * 2 + 1], det = FA.perMod[m * 2], cov = sim ? det / sim : 0;
      const yy = gy + 8 + k * bh;
      text(ctx, nm, mx, yy + bh / 2, F.mono(8.5), P.muted);
      const bx = mx + 46, bw = mw - 46 - 32;
      ctx.fillStyle = '#151922'; ctx.fillRect(bx, yy + 2, bw, bh - 4);
      ctx.fillStyle = cov >= 0.9 ? P.up : cov >= 0.7 ? P.warn : P.down;
      ctx.fillRect(bx, yy + 2, bw * cov, bh - 4);
      text(ctx, sim ? (cov * 100).toFixed(1) : '·', w - 8, yy + bh / 2, F.mono(8.5), P.text, 'right');
    });
    // latency histogram
    const hy = gy + gh + 6, hh = h - 22 - hy - 4;
    label(ctx, 'DETECTION LATENCY · CYCLES', gx, hy, P.muted, 'left', 8.5);
    const hm = Math.max(1, ...FA.hist);
    const hbw = (gw - 4) / 13;
    for (let k = 0; k < 13; k++) {
      const v = FA.hist[k] / hm, bx = gx + 2 + k * hbw;
      ctx.fillStyle = rgba(P.cyan, 0.75); ctx.fillRect(bx, hy + 8 + (hh - 18) * (1 - v), hbw - 1.5, (hh - 18) * v);
      if (k % 3 === 0) text(ctx, k === 0 ? '0' : String(1 << (k - 1)), bx, hy + hh - 3, F.mono(7.5), P.dim);
    }
    // undetected list
    label(ctx, 'LAST UNDETECTED', mx, hy, P.muted, 'left', 8.5);
    FA.undet.slice(-3).reverse().forEach((u, k) => {
      const p2 = D.mods[D.mod[u.net]].path.replace('core/', '');
      text(ctx, `n${u.net} SA${u.sa}`, mx, hy + 12 + k * 11, F.mono(8.5), P.red);
      text(ctx, p2.length > 16 ? p2.slice(-16) : p2, w - 8, hy + 12 + k * 11, F.mono(8.5), P.muted, 'right');
    });

  function drawPipe() {
    const { ctx, w, h } = cv.pipe;
    const s = APP.sim;
    frame(ctx, w, h, 'Pipeline', `occupancy · last ${s.pipe.length} cycles`, `IPC ${(s.instret / s.cyc).toFixed(3)} · CPI ${(s.cyc / s.instret).toFixed(3)}`);
    const pipe = s.pipe;
    const NC = pipe.length;
    const cx0 = 150, cw = (w - 8 - cx0) / NC, y0 = 28;
    // instance rows: ids seen in any stage, oldest at the top
    const seen = new Map();
    pipe.forEach((row, c) => {
      for (let k = 0; k < 5; k++) {
        const id = row[1 + k];
        if (!id) continue;
        if (!seen.has(id)) seen.set(id, { id, pc: row[6 + k], cells: [] });
        seen.get(id).cells.push([c, k]);
      }
    });
    const ids = [...seen.values()].sort((a, b) => a.id - b.id);
    const early = ids.filter((r) => Math.min(...r.cells.map((x) => x[0])) <= NC - 5);
    const NR = 18, rh = 7.3;
    const rows = early.slice(-NR);
    // header: the full cycle number of the first column, then offsets
    text(ctx, fmt.int(pipe[0][0]), cx0, y0 + 3, F.mono(7.5), P.muted);
    for (let c = 4; c < NC; c += 4) text(ctx, '+' + c, cx0 + c * cw + 1, y0 + 3, F.mono(7.5), P.dim);
    const ry0 = y0 + 9;
    rows.forEach((r, j) => {
      const y = ry0 + j * rh;
      const ins = disStr(romAt(r.pc), r.pc);
      if (j % 2 === 0) { ctx.fillStyle = '#0B0D12'; ctx.fillRect(6, y - 0.3, w - 12, rh); }
      text(ctx, fmt.hex(r.pc, 4), 8, y + rh / 2, F.mono(7.5), P.muted);
      text(ctx, ins.length > 21 ? ins.slice(0, 21) : ins, 33, y + rh / 2, F.mono(7.5), P.text);
      // a fetched instance that never reached EX was squashed by a redirect
      const ks = r.cells.map((x) => x[1]);
      const maxK = Math.max(...ks), lastC = Math.max(...r.cells.map((x) => x[0]));
      const squashed = lastC < NC - 1 && maxK <= 1;
      let prevK = -1;
      for (const [c, k] of r.cells) {
        const x = cx0 + c * cw;
        const stall = k === prevK;
        ctx.fillStyle = squashed ? rgba(P.red, 0.2) : stall ? rgba(P.warn, 0.28) : rgba(STC[k], 0.32);
        ctx.fillRect(x, y, cw - 1.5, rh - 1.2);
        text(ctx, STL[k], x + (cw - 1.5) / 2, y + rh / 2 - 0.2, F.mono(6.5, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');
        prevK = k;
      }
      if (squashed && lastC + 1 < NC) text(ctx, '×', cx0 + (lastC + 1) * cw + cw / 2, y + rh / 2, F.mono(8, 600), P.red, 'center');
    });
    // flag rail: stall / flush / ID redirect per cycle
    const yr = ry0 + NR * rh + 2;
    pipe.forEach((row, c) => {
      const f = row[11], x = cx0 + c * cw;
      if (f & 1) { ctx.fillStyle = P.warn; ctx.fillRect(x, yr, cw - 1.5, 2); }
      if (f & 2) { ctx.fillStyle = P.down; ctx.fillRect(x, yr + 3, cw - 1.5, 2); }
      if (f & 4) { ctx.fillStyle = P.cyan; ctx.fillRect(x, yr + 6, cw - 1.5, 2); }
    });
    text(ctx, 'stall', 8, yr + 4, F.mono(7.5), P.warn); text(ctx, 'flush', 36, yr + 4, F.mono(7.5), P.down); text(ctx, 'ID redirect', 66, yr + 4, F.mono(7.5), P.cyan);
    text(ctx, 'F D X M W = IF ID EX MEM WB', cx0 - 6, yr + 4, F.mono(7.5), P.dim, 'right');
    // retired trace (same chunk as the counters in the top bar)
    const yt = yr + 14;
    hline(ctx, 6, w - 6, yt - 3, P.line);
    label(ctx, 'RETIRED · CHECKED AGAINST THE GOLDEN MODEL', 8, yt + 4, P.blue, 'left', 8.5);
    text(ctx, `${fmt.int(s.checked)} checked · ${s.div} div`, w - 8, yt + 4, F.mono(9), s.div ? P.down : P.up, 'right');
    const tr = s.trace;
    const nrows = Math.floor((h - yt - 13) / 10);
    const list = tr.slice(-nrows);
    list.forEach((t, j) => {
      const y = yt + 15 + j * 10;
      const [cyc, pc, ir, rd, wd, ok, sa, sd, hasSt] = t;
      text(ctx, String(cyc), 8, y, F.mono(9), P.dim);
      text(ctx, fmt.hex8(pc), 54, y, F.mono(9), P.muted);
      text(ctx, fmt.hex8(ir), 104, y, F.mono(9), P.dim);
      text(ctx, disStr(ir, pc), 158, y, F.mono(9), P.text);
      const res = rd ? `${ABI[rd]}←${fmt.hex8(wd)}` : hasSt ? `[${fmt.hex(sa, 5)}]←${fmt.hex8(sd)}` : '';
      text(ctx, res, 446, y, F.mono(9), rd ? P.cyan : P.gold, 'right');
      text(ctx, ok ? '✓' : '✗', 466, y, F.mono(9, 600), ok ? P.up : P.down, 'center');
    });
  }

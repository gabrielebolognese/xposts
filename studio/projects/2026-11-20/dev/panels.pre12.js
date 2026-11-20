// Every Gate: every panel on the stage. Each panel owns a DPR-sized canvas and redraws at its own rhythm.
(function (G) {
  'use strict';
  const { P, F, DPR, canvas, frame, text, label, hline, vline, box, rgba, mix, fmt } = G.UI;
  const R = {
    top: [8, 8, 1904, 40], controls: [8, 56, 344, 300], hier: [8, 364, 344, 404], floor: [360, 56, 1064, 712],
    regs: [1432, 56, 480, 208], pipe: [1432, 272, 480, 248], out: [1432, 528, 480, 240],
    wave: [8, 776, 1120, 296], fault: [1136, 776, 384, 296], res: [1528, 776, 384, 296],
  };
  let APP, D, L, GL, prog, cv = {};
  const ABI = G.ASM.ABI;
  const dis = (w, pc) => G.ASM.disasm(w, pc);
  const disStr = (w, pc) => { const [m, a] = dis(w, pc); return (m.trim() + ' ' + a).trim(); };
  const romAt = (pc) => prog.rom[(pc >>> 2) & 0xfff];
  const GATES = () => D.n - D.gateStart;

  function init(app) {
    APP = app; D = app.D; prog = app.prog;
    for (const k of ['top', 'controls', 'hier', 'regs', 'pipe', 'out', 'wave', 'fault', 'res']) cv[k] = canvas(...R[k]);
    const [fx, fy, fw, fh] = R.floor;
    cv.fbg = canvas(fx, fy, fw, fh, 1);
    const glc = document.createElement('canvas');
    glc.width = Math.round(fw * DPR); glc.height = Math.round(fh * DPR);
    Object.assign(glc.style, { left: fx + 'px', top: fy + 'px', width: fw + 'px', height: fh + 'px', zIndex: 2 });
    G.UI.stage().appendChild(glc);
    cv.fov = canvas(fx, fy, fw, fh, 3);
    L = G.FP.layout(D, fw, fh);
    APP.layout = L;
    GL = G.FP.createGL(glc, D, L);
    cv.ticks = document.createElement('canvas');
    cv.ticks.width = Math.round(fw * DPR); cv.ticks.height = Math.round(fh * DPR);
    cv.fbImg = document.createElement('canvas'); cv.fbImg.width = 48; cv.fbImg.height = 32;
    buildPalette();
    drawFloorStatic();
    initControls();
    { // warm the text shaper for every font in use, and the GL program, before the first frame
      const t = document.createElement('canvas'); t.width = 64; t.height = 16; const c = t.getContext('2d');
      for (const px of [7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13]) for (const wgt of [400, 600]) { c.font = F.mono(px, wgt); c.fillText('0x1f Ab', 0, 10); c.font = F.ui(px, wgt); c.fillText('Ab fF', 0, 10); c.font = F.title(px, wgt); c.fillText('AB', 0, 10); }
      c.font = F.ui(15, 600); c.fillText('Every Gate', 0, 10);
      if (GL) GL.draw(APP.heat, APP.flash);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Top bar
  // ------------------------------------------------------------------------------------------------
  function drawTop(now) {
    const { ctx, w, h } = cv.top;
    const s = APP.sim;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    box(ctx, 0, 0, w, h, P.line);
    text(ctx, 'Every Gate', 14, 20, F.ui(15, 600), P.text);
    ctx.font = F.ui(15, 600); let x = 14 + ctx.measureText('Every Gate').width + 10;
    text(ctx, 'A RISC-V core paints a Mandelbrot, one gate at a time', x, 21, F.ui(11), P.muted);
    ctx.font = F.ui(11); x += ctx.measureText('A RISC-V core paints a Mandelbrot, one gate at a time').width + 14;
    const tag = 'RV32I+MUL/MULH · 5-STAGE';
    ctx.font = F.mono(10); const tw = ctx.measureText(tag).width + 14;
    ctx.fillStyle = rgba(P.blue, 0.12); ctx.fillRect(x, 11, tw, 18); box(ctx, x, 11, tw, 18, rgba(P.blue, 0.6));
    text(ctx, tag, x + 7, 20.5, F.mono(10), P.blue);
    x += tw + 18;
    const C = s.C;
    const fr = s.params[5] + 1, px = Math.max(0, Math.min(1536, s.regs[21] - PROG.FB)), row = Math.min(31, s.regs[22]);
    const items = [
      ['CYCLE', fmt.int(s.cyc), P.text, 72],
      ['INSTRET', fmt.int(s.instret), P.text, 72],
      ['SIM CLOCK', (APP.hz / 1000).toFixed(2) + ' kHz', P.active, 80, 'cap ' + ((APP.cap || 0) / 1000).toFixed(1) + 'k'],
      ['GATE EVALS/S', fmt.si(APP.hz * GATES(), 1) + '/s', P.text, 80, 'cap ' + fmt.si((APP.cap || 0) * GATES(), 0).trim()],
      ['CELLS', fmt.int(GATES()) + ' + ' + fmt.int(D.nDff) + ' DFF', P.text, 80],
      ['IPC', (s.instret / s.cyc).toFixed(3), P.cyan, 40],
      ['BRANCH ACC', C.br ? fmt.pct(1 - C.misp / C.br, 1) : '-', P.green, 60],
      ['MANDELBROT', `frame ${fr} · row ${String(row).padStart(2, '0')} · px ${String(px).padStart(4, ' ')}/1536`, P.text, 120],
    ];
    for (const [k, v, c, wd, sub] of items) {
      vline(ctx, x - 11, 8, 32, P.line);
      label(ctx, k, x, 12, P.muted, 'left', 9);
      text(ctx, v, x, 28, F.mono(13), c);
      ctx.font = F.mono(13);
      let vw = ctx.measureText(v).width;
      if (sub) { text(ctx, sub, x + vw + 6, 28.5, F.mono(9), P.muted); ctx.font = F.mono(9); vw += 6 + ctx.measureText(sub).width; }
      x += Math.max(vw, wd) + 22;
    }
    // lockstep badge
    const ok = s.div === 0;
    vline(ctx, x - 11, 8, 32, P.line);
    const stt = APP.selftest;
    label(ctx, stt ? `GOLDEN LOCKSTEP · ISA SELF-TEST ${stt.passed}/${stt.programs}` : 'GOLDEN LOCKSTEP', x, 12, P.muted, 'left', 9);
    const bc = ok ? P.up : P.down;
    ctx.fillStyle = rgba(bc, 0.14); ctx.fillRect(x, 19, 196, 16); box(ctx, x, 19, 196, 16, rgba(bc, 0.7));
    ctx.fillStyle = bc; ctx.beginPath(); ctx.arc(x + 9, 27, 3, 0, 7); ctx.fill();
    text(ctx, `${s.div} divergences`, x + 17, 27.5, F.mono(10.5, 600), bc);
    text(ctx, fmt.int(s.checked) + ' checked', x + 191, 27.5, F.mono(9), rgba(bc, 0.85), 'right');
    x += 168;
    // UTC
    const d = new Date();
    vline(ctx, w - 108, 8, 32, P.line);
    label(ctx, 'UTC', w - 98, 12, P.muted, 'left', 9);
    text(ctx, d.toISOString().slice(11, 19), w - 98, 28, F.mono(13), P.text);
  }

  // ------------------------------------------------------------------------------------------------
  // Floorplan: static layer (chrome, rulers, die, outlines, names) and dynamic overlay
  // ------------------------------------------------------------------------------------------------
  function drawFloorStatic() {
    const { ctx, w, h } = cv.fbg;
    const sub = `${fmt.int(D.n - D.gateStart)} gates + ${fmt.int(D.nDff)} DFFs`;
    frame(ctx, w, h, 'Die floorplan', sub);
    ctx.font = F.title(11, 600); ctx.letterSpacing = '1.2px';
    const t1 = ctx.measureText('DIE FLOORPLAN').width; ctx.letterSpacing = '0px';
    ctx.font = F.ui(11); cv.fpReadX = 15 + t1 + 10 + ctx.measureText(sub).width + 16;
    vline(ctx, cv.fpReadX - 9, 5, 18, P.line);
    // legend in the title bar
    let lx = w - 8;
    ctx.font = F.mono(9);
    for (let k = 5; k >= 0; k--) {
      const nm = G.FP.SLOT_NAME[k], tw = ctx.measureText(nm).width;
      lx -= tw; text(ctx, nm, lx, 12, F.mono(9), P.muted);
      lx -= 9; ctx.fillStyle = G.FP.SLOT_COL[k]; ctx.fillRect(lx, 8, 6, 6);
      lx -= 9;
    }
    vline(ctx, lx - 1, 5, 18, P.line); lx -= 8;
    for (const [nm, kind] of [['undetected', 0], ['under test', 1]]) {
      const tw = ctx.measureText(nm).width;
      lx -= tw; text(ctx, nm, lx, 12, F.mono(9), P.muted);
      lx -= 10;
      if (kind) { ctx.strokeStyle = P.cyan; ctx.strokeRect(lx + 0.5, 8.5, 6, 6); }
      else { ctx.fillStyle = P.red; ctx.fillRect(lx, 8, 6, 1); ctx.fillRect(lx, 8, 1, 4); }
      lx -= 8;
    }
    // rulers (placement sites, 1 site = 4 px)
    const RU = 16;
    ctx.fillStyle = '#0A0C10'; ctx.fillRect(1, 23, w - 2, RU); ctx.fillRect(1, 23, RU, h - 24);
    hline(ctx, 1, w - 1, 23 + RU, P.line); vline(ctx, RU + 1, 23, h - 1, P.line);
    const ox = L.dieX, oy = L.dieY;
    ctx.strokeStyle = P.dim; ctx.lineWidth = 1;
    for (let sx = 0; ox + sx * 4 < w - 4; sx += 5) {
      const X = ox + sx * 4 + 0.5, big = sx % 50 === 0, mid = sx % 10 === 0;
      ctx.beginPath(); ctx.moveTo(X, 23 + RU); ctx.lineTo(X, 23 + RU - (big ? 9 : mid ? 5 : 2)); ctx.stroke();
      if (big) text(ctx, String(sx), X + 2, 29, F.mono(8.5), P.muted);
    }
    for (let sy = 0; oy + sy * 4 < h - 4; sy += 5) {
      const Y = oy + sy * 4 + 0.5, big = sy % 50 === 0, mid = sy % 10 === 0;
      ctx.beginPath(); ctx.moveTo(RU + 1, Y); ctx.lineTo(RU + 1 - (big ? 9 : mid ? 5 : 2), Y); ctx.stroke();
      if (big && sy > 0) { ctx.save(); ctx.translate(8, Y + 2); ctx.rotate(-Math.PI / 2); text(ctx, String(sy), 0, 0, F.mono(8.5), P.muted, 'right'); ctx.restore(); }
    }
    text(ctx, 'sites', 4, 30, F.mono(7.5), P.dim);
    // die: seal ring + background
    const dx = L.dieX, dy = L.dieY, dw = L.dieW, dh = L.dieH;
    ctx.fillStyle = '#07080B'; ctx.fillRect(dx, dy, dw, dh);
    box(ctx, dx - 3, dy - 3, dw + 6, dh + 6, '#151922');
    box(ctx, dx, dy, dw, dh, '#2A3140');
    // corner marks
    ctx.strokeStyle = '#4A5468';
    for (const [cx, cy, sx, sy] of [[dx, dy, 1, 1], [dx + dw, dy, -1, 1], [dx, dy + dh, 1, -1], [dx + dw, dy + dh, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * 0.5, cy + sy * 12); ctx.lineTo(cx + sx * 0.5, cy + sy * 0.5); ctx.lineTo(cx + sx * 12, cy + sy * 0.5); ctx.stroke();
    }
    // bit-slice rows across the datapath
    const x0 = L.x0 - 4, x1 = L.x0 + L.usedW + 4;
    for (let b = 0; b < 32; b++) {
      const y = L.dpY + (31 - b) * 16;
      ctx.fillStyle = b % 2 ? '#0A0C11' : '#0C0E14';
      ctx.fillRect(x0, y, x1 - x0, 16);
      text(ctx, String(b), L.x0 - 8, y + 8.5, F.mono(8), b % 4 === 0 ? P.muted : P.dim, 'right');
    }
    label(ctx, 'bit', L.x0 - 8, L.dpY - 6, P.dim, 'right', 8);
    ctx.fillStyle = '#0A0C11'; ctx.fillRect(x0, L.ctlY - 2, x1 - x0, L.ctlH + 4);
    label(ctx, 'ctl', L.x0 - 8, L.ctlY + L.ctlH / 2, P.dim, 'right', 8);
    // empty placement sites (one dim dot per free site in the core area)
    const occ = new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4));
    const cw4 = Math.ceil(w / 4);
    for (let i = D.dffStart; i < D.n; i++) { const sx = Math.round(L.pos[i * 2] / 4), sy = Math.round(L.pos[i * 2 + 1] / 4); if (sx >= 0) occ[sy * cw4 + sx] = 1; }
    ctx.fillStyle = '#161A22';
    for (let y = L.dpY; y < L.ctlY + L.ctlH; y += 4) {
      if (y >= L.dpY + L.dpH && y < L.ctlY) continue;
      for (let x = L.x0; x < L.x0 + L.usedW; x += 4) if (!occ[Math.round(y / 4) * cw4 + Math.round(x / 4)]) ctx.fillRect(x + 1, y + 1, 1, 1);
    }
    // stage boxes and module outlines
    for (const st of L.stages) {
      const c = st.preg ? rgba(P.gold, 0.35) : '#2A3242';
      box(ctx, st.x - 3, L.dpY - 3, st.w + 6, L.ctlY + L.ctlH - L.dpY + 6, c);
    }
    ctx.font = F.mono(8.5);
    for (const m of L.mods) {
      if (!m.n) continue;
      const c = m.preg ? rgba(P.gold, 0.18) : '#1C2230';
      if (m.dpCols) box(ctx, m.x - 1, L.dpY - 1, m.w + 2, L.dpH + 2, c);
      if (m.ctlCols) box(ctx, m.x - 1, L.ctlY - 1, m.w + 2, L.ctlH + 2, c);
    }
    // module names in the band between the datapath and the control strip
    const ny = L.dpY + L.dpH + 20.5;
    const cps = critPts();
    const crosses = (x0, x1) => {
      for (let k = 1; k < cps.length; k++) {
        const [ax, ay] = cps[k - 1], [bx, by] = cps[k];
        for (let t = 0; t <= 1; t += 0.02) { const px = ax + (bx - ax) * t, py = ay + (by - ay) * t; if (px > x0 && px < x1 && py > ny - 6 && py < ny + 6) return true; }
      }
      return false;
    };
    let lastEnd = -1e9;
    for (const m of L.mods) {
      const nm = L.SHORT[m.path];
      if (!nm || m.preg) continue;
      const tw = ctx.measureText(nm).width;
      if (tw > m.w + 10) continue;
      const c0 = m.x + m.w / 2;
      const cx = [c0, c0 + tw / 2 + 10, c0 - tw / 2 - 10].find((c) => c - tw / 2 >= lastEnd + 4 && !crosses(c - tw / 2 - 3, c + tw / 2 + 3));
      if (cx === undefined) continue;
      text(ctx, nm, cx, ny, F.mono(8.5), P.muted, 'center');
      lastEnd = cx + tw / 2;
    }
    // pipeline register names, vertical inside the stripe header
    for (const st of L.stages) if (st.preg) {
      ctx.save(); ctx.translate(st.x + st.w / 2 + 3, L.ctlY + L.ctlH - 2); ctx.rotate(-Math.PI / 2);
      text(ctx, st.name, 0, 0, F.mono(8), rgba(P.gold, 0.75), 'left'); ctx.restore();
    }
  }

  const BUSES = [
    { after: 'IF', name: 'pc', key: 'pcIF', col: P.blue },
    { after: 'IF/ID', name: 'ir', key: 'irID', col: P.cyan },
    { after: 'ID', name: 'rs1', key: 'rs1vID', col: P.magenta },
    { after: 'ID/EX', name: 'A', key: 'mulA', col: P.magenta },
    { after: 'EX', name: 'res', key: 'exRes', col: P.green },
    { after: 'EX/MEM', name: 'addr', key: 'addr', col: P.gold },
    { after: 'MEM', name: 'ld', key: 'ldv', col: P.cyan },
    { after: 'MEM/WB', name: 'wb', key: 'rwd', col: P.green },
  ];
  let probe = null, prevC = null, actFrac = { fwdXM: 0, fwdMW: 0, wb: 0, flush: 0 };
  function drawFloorOverlay(now) {
    const { ctx, w, h } = cv.fov;
    const s = APP.sim, pr = s.pipeRegs, SN = APP.snap;
    ctx.clearRect(0, 0, w, h);
    const occ = []; // rectangles of fixed labels drawn this frame (the probe callout avoids them)
    const hit = (r) => occ.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
    // activity in this chunk (from counter deltas)
    if (prevC !== s.C) {
      if (prevC && s.n) {
        const n = s.n;
        actFrac.fwdXM = (s.C.fwdXM - prevC.fwdXM) / n; actFrac.fwdMW = (s.C.fwdMW - prevC.fwdMW) / n;
        actFrac.flush = (s.C.flush - prevC.flush) / n;
      }
      prevC = s.C;
    }
    const gates = D.n - D.dffStart;
    // undetected faults (cached layer)
    if (APP.frame % 30 === 1 || !cv.ticksN) drawTicks();
    ctx.drawImage(cv.ticks, 0, 0, w, h);
    // faults under test right now: 31 per worker, cyan while pending, green once detected
    for (const wk of APP.fault.workers) {
      const b = wk.batch;
      if (!b || wk.id >= APP.cfg.workers) continue;
      b.faults.forEach(([net], k) => {
        const det = (b.det >>> (k + 1)) & 1;
        const x = L.pos[net * 2], y = L.pos[net * 2 + 1];
        ctx.strokeStyle = det ? rgba(P.green, 0.95) : rgba(P.cyan, b.done ? 0.35 : 0.9);
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 6, 6);
      });
    }
    // bus wires in the gutters: every bit row lit by its value
    const stx = {};
    for (const st of L.stages) stx[st.name] = st;
    ctx.font = F.mono(8.5);
    for (const b of BUSES) {
      const st = stx[b.after], i = L.stages.indexOf(st), nx = L.stages[i + 1];
      if (!nx) continue;
      const xa = st.x + st.w + 4, xb = nx.x - 4;
      const v = pr[b.key] | 0;
      for (const onp of [0, 1]) {
        ctx.beginPath();
        for (let bit = 0; bit < 32; bit++) { if (((v >>> bit) & 1) !== onp) continue; const y = L.rowY(bit) + 0.5; ctx.moveTo(xa, y); ctx.lineTo(xb, y); }
        ctx.strokeStyle = onp ? rgba(b.col, 0.95) : rgba(P.muted, 0.22); ctx.lineWidth = onp ? 1.5 : 1; ctx.stroke();
      }
      // vertical tag with the hex value
      const tx = (xa + xb) / 2;
      ctx.font = F.mono(8.5);
      const tg = `${b.name} ${fmt.hex8(v)}`;
      const tw = ctx.measureText(tg).width;
      ctx.save(); ctx.translate(tx, L.dpY + L.dpH - 4); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(6,7,10,0.88)'; ctx.fillRect(-2, -6, tw + 4, 12);
      text(ctx, b.name, 0, 0.5, F.mono(8.5, 600), b.col);
      text(ctx, fmt.hex8(v), ctx.measureText(b.name + ' ').width, 0.5, F.mono(8.5), P.text);
      ctx.restore();
      occ.push({ x: tx - 7, y: L.dpY + L.dpH - 6 - tw, w: 14, h: tw + 4 });
    }
    // feedback buses: forwarding (top), write-back to the register file and PC redirect (gap)
    const modx = (p) => L.mods.find((m) => m.path === p);
    const fwdM = modx('exu/fwd'), rfM = modx('idu/rf/cells'), wbM = modx('wbu'), xmS = stx['EX/MEM'], mwS = stx['MEM/WB'], npcM = modx('ifu/npc'), bcM = modx('exu/bcmp');
    const ppM = modx('exu/mul/pp'), dadM = modx('exu/mul/dadda');
    const route = (pts, col, a, wdt) => { ctx.strokeStyle = rgba(col, a); ctx.lineWidth = wdt; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
    const yF1 = L.dpY - 7, yF2 = L.dpY - 13;
    const fx = fwdM.x + fwdM.w / 2;
    route([[xmS.x + xmS.w / 2, L.dpY - 3], [xmS.x + xmS.w / 2, yF1], [fx, yF1], [fx, L.dpY - 3]], P.cyan, 0.25 + 0.75 * Math.min(1, actFrac.fwdXM * 2.5), 1.5);
    route([[mwS.x + mwS.w / 2, L.dpY - 3], [mwS.x + mwS.w / 2, yF2], [fx - 3, yF2], [fx - 3, L.dpY - 3]], P.magenta, 0.25 + 0.75 * Math.min(1, actFrac.fwdMW * 2.5), 1.5);
    const tagOn = (s1, x, y, col) => {
      ctx.font = F.mono(8.5); const tw = ctx.measureText(s1).width + 8;
      ctx.fillStyle = 'rgba(6,7,10,0.95)'; ctx.fillRect(x, y - 5, tw, 10); box(ctx, x, y - 5, tw, 10, rgba(col, 0.6)); text(ctx, s1, x + 4, y + 0.5, F.mono(8.5), col);
      occ.push({ x, y: y - 5, w: tw, h: 10 });
    };
    // multi-line tag in the control strip with a leader up to its bus
    const tagBlock = (lines, x, y, col, lx, ly) => {
      ctx.font = F.mono(8.5);
      const tw = Math.max(...lines.map((l) => ctx.measureText(l[0]).width)) + 10, th = lines.length * 11 + 4;
      if (lx !== undefined) { ctx.strokeStyle = rgba(col, 0.55); ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(lx + 0.5, ly); ctx.lineTo(lx + 0.5, y); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = 'rgba(8,9,13,0.96)'; ctx.fillRect(x, y, tw, th); box(ctx, x, y, tw, th, rgba(col, 0.55));
      lines.forEach(([t, c], k) => text(ctx, t, x + 5, y + 8 + k * 11, F.mono(8.5, k === 0 ? 600 : 400), c));
      occ.push({ x, y, w: tw, h: th });
    };
    tagOn(`fwd EX/MEM -> EX ${(actFrac.fwdXM * 100).toFixed(0)}% of cycles`, fx + (xmS.x - fx) * 0.18, yF1, P.cyan);
    tagOn(`fwd MEM/WB -> EX ${(actFrac.fwdMW * 100).toFixed(0)}% of cycles`, fx + (xmS.x - fx) * 0.55, yF2, P.magenta);
    const yW = L.dpY + L.dpH + 9;
    const wbOn = pr.rwe;
    route([[wbM.x + wbM.w / 2, L.dpY + L.dpH + 1], [wbM.x + wbM.w / 2, yW], [rfM.x + rfM.w / 2, yW], [rfM.x + rfM.w / 2, L.dpY + L.dpH + 1]], P.green, wbOn ? 0.9 : 0.3, 1.5);
    const yR = L.dpY + L.dpH + 4;
    route([[bcM.x + bcM.w / 2 + 2, L.dpY + L.dpH + 1], [bcM.x + bcM.w / 2 + 2, yR], [npcM.x + npcM.w / 2, yR], [npcM.x + npcM.w / 2, L.dpY + L.dpH + 1]], P.red, 0.25 + 0.75 * Math.min(1, actFrac.flush * 12), 1.5);
    // the control strip carries the bus readouts where it has no cells (under the register file and the multiplier)
    // each tag sits inside its bus's span, with a leader that crosses the name row where no name is drawn
    const mp = s.C.br ? (s.C.misp / s.C.br) * 100 : 0;
    const rdx = rfM.x + 1;
    tagBlock([[`pc redirect -> ${fmt.hex8(pr.exTarget)}`, actFrac.flush > 0 ? P.red : P.muted], [`${fmt.int(s.C.flush)} flushes (EX)`, P.text], [`${mp.toFixed(1)}% mispredicted`, P.muted]], rdx, L.ctlY + 3, P.red, rdx + 6, yR);
    const wbx = dadM.x + 4;
    tagBlock([['write-back -> regfile', wbOn ? P.green : P.muted], [`x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`, P.text], [`${fmt.int(s.instret)} retired`, P.muted]], wbx, L.ctlY + 3, P.green, wbx + 8, yW);
    tagBlock([['BW array · this cycle', P.cyan], [`A ${fmt.hex8(pr.mulA)}`, P.text], [`B ${fmt.hex8(pr.mulB)}`, P.text], [`P[63:32] ${fmt.hex8(pr.mulHi)}`, P.muted]], dadM.x + dadM.w * 0.6, L.ctlY + 3, P.cyan);
    // instruction in each pipeline stage
    const stg = [
      ['IF', pr.pcIF, 1, stx.IF, 0], ['ID', pr.pcID, pr.vID, stx.ID, 1], ['EX', pr.pcEX, pr.vEX, stx.EX, 0], ['MEM', pr.pcMEM, pr.vMEM, stx.MEM, 1], ['WB', pr.pcWB, pr.vWB, stx.WB, 0],
    ];
    for (const [nm, pc, v, st, rowk] of stg) {
      const y = L.dieY + 11 + rowk * 15;
      const body = v ? `${fmt.hex(pc, 4)} ${disStr(romAt(pc), pc)}` : 'bubble';
      ctx.font = F.mono(9.5, 600); const w1 = ctx.measureText(nm).width;
      ctx.font = F.mono(9.5); const w2 = ctx.measureText(body).width;
      const tw = w1 + 6 + w2 + 10;
      let x = nm === 'WB' ? st.x + st.w - tw + 4 : nm === 'MEM' ? st.x + st.w - tw + 30 : nm === 'EX' ? st.x + 40 : st.x - 2;
      x = Math.max(L.dieX + 4, Math.min(L.dieX + L.dieW - tw - 4, x));
      ctx.fillStyle = 'rgba(13,15,20,0.95)'; ctx.fillRect(x, y - 6, tw, 13);
      box(ctx, x, y - 6, tw, 13, v ? rgba(P.blue, 0.55) : P.line);
      text(ctx, nm, x + 4, y + 0.5, F.mono(9.5, 600), v ? P.blue : P.muted);
      text(ctx, body, x + 4 + w1 + 6, y + 0.5, F.mono(9.5), v ? P.text : P.muted);
      const lx = Math.max(x + 6, Math.min(x + tw - 6, st.x + st.w / 2));
      vline(ctx, lx, y + 7, L.dpY - 3, rgba(P.blue, v ? 0.45 : 0.2));
      occ.push({ x, y: y - 6, w: tw, h: 13 });
    }
    // critical path in gold, with a pulse travelling along it
    const pts = critPts();
    if (!cv.crit) {
      cv.crit = document.createElement('canvas'); cv.crit.width = Math.round(w * DPR); cv.crit.height = Math.round(h * DPR);
      const c2 = cv.crit.getContext('2d'); c2.setTransform(DPR, 0, 0, DPR, 0, 0);
      c2.strokeStyle = rgba(P.gold, 0.85); c2.lineWidth = 1.25; c2.beginPath();
      pts.forEach(([x, y], k) => (k ? c2.lineTo(x, y) : c2.moveTo(x, y)));
      c2.shadowColor = P.gold; c2.shadowBlur = 6; c2.stroke(); c2.shadowBlur = 0;
      c2.fillStyle = P.gold; for (const [x, y] of pts) c2.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.drawImage(cv.crit, 0, 0, w, h);
    const tt = ((now / 2600) % 1) * (pts.length - 1), k0 = Math.floor(tt), fr = tt - k0;
    if (pts[k0 + 1]) {
      const px = pts[k0][0] + (pts[k0 + 1][0] - pts[k0][0]) * fr, py = pts[k0][1] + (pts[k0 + 1][1] - pts[k0][1]) * fr;
      ctx.fillStyle = P.active; ctx.beginPath(); ctx.arc(px, py, 2.5, 0, 7); ctx.fill();
    }
    const cl = `critical path ${D.critical.levels} levels · fwdA > Baugh-Wooley > Dadda > KS64 > rsel`;
    const cl2 = `deepest level that toggled in the last cycle: ${s.deepest}`;
    ctx.font = F.mono(9);
    const clw = ctx.measureText(cl).width;
    const clx = dadM.x + dadM.w - clw - 6, cly = L.dpY + 14;
    ctx.fillStyle = 'rgba(6,7,10,0.9)'; ctx.fillRect(clx - 4, cly - 6, clw + 8, 24);
    box(ctx, clx - 4, cly - 6, clw + 8, 24, rgba(P.gold, 0.6));
    text(ctx, cl, clx, cly + 0.5, F.mono(9), P.gold);
    text(ctx, cl2, clx + clw, cly + 12, F.mono(8.5), P.muted, 'right');
    occ.push({ x: clx - 4, y: cly - 6, w: clw + 8, h: 24 });
    // probe: the busiest gate of the last chunk, re-chosen every 1.5 s
    if (!probe || APP.frame % 90 === 0) {
      let best = -1, bv = -1;
      const hf = APP.heatFrame;
      for (let k = D.gateStart - D.dffStart; k < hf.length; k++) {
        const i = k + D.dffStart;
        if (hf[k] <= bv || hf[k] >= s.n || D.bit[i] < 0) continue;
        const pth = D.mods[D.mod[i]].path;
        if (pth.includes('exu/mul') || pth.includes('exu/alu')) { bv = hf[k]; best = k; }
      }
      probe = best >= 0 ? best + D.dffStart : null;
    }
    if (probe !== null) {
      const x = L.pos[probe * 2] + 1.5, y = L.pos[probe * 2 + 1] + 1.5;
      ctx.strokeStyle = rgba(P.active, 0.35); ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(18, Math.round(y) + 0.5); ctx.lineTo(x - 6, Math.round(y) + 0.5); ctx.moveTo(Math.round(x) + 0.5, 40); ctx.lineTo(Math.round(x) + 0.5, y - 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = P.active; ctx.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
      const sx = Math.round((x - L.dieX) / 4), sy = Math.round((y - L.dieY) / 4);
      ctx.fillStyle = P.active; ctx.fillRect(Math.round(x) - 1, 24, 3, 14); ctx.fillRect(1, Math.round(y) - 1, 15, 3);
      const p = D.mods[D.mod[probe]].path.replace('core/', '');
      const t = APP.heatFrame[probe - D.dffStart];
      const lines = [`probe n${probe}  ${D.names[D.type[probe]]}  L${D.level[probe]}`, `${p}`, `site (${sx}, ${sy}) · ${t}/${s.n} cyc toggled`];
      ctx.font = F.mono(9);
      const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12, bh = 40;
      // first free spot around the probe: below/above, right/left, then further out
      const cands = [];
      for (const d of [12, 40, 80, 130]) for (const [ox, oy] of [[d, 10], [d, -bh - 10], [-d - bw, 10], [-d - bw, -bh - 10]]) cands.push({ x: x + ox, y: y + oy, w: bw, h: bh });
      const inside = (r) => r.x > L.dieX + 2 && r.x + r.w < L.dieX + L.dieW - 2 && r.y > L.dpY && r.y + r.h < L.dpY + L.dpH - 2;
      const box1 = cands.find((r) => inside(r) && !hit(r)) || cands.find(inside) || cands[0];
      const bx = box1.x, by = box1.y;
      // leader from the cell to the callout
      ctx.strokeStyle = rgba(P.active, 0.6); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(Math.max(bx, Math.min(bx + bw, x)), Math.max(by, Math.min(by + bh, y))); ctx.stroke();
      ctx.fillStyle = 'rgba(10,12,16,0.94)'; ctx.fillRect(bx, by, bw, bh); box(ctx, bx, by, bw, bh, rgba(P.active, 0.7));
      lines.forEach((l, k) => text(ctx, l, bx + 6, by + 8 + k * 12, F.mono(9), k === 0 ? P.active : k === 1 ? P.text : P.muted));
    }
    // title bar readout (drawn last, over the static title): one shared 1 s window, refreshed 4x per second
    const alpha = SN.tog / gates;
    const mw = 0.5 * SN.tog * APP.cfg.C * 1e-15 * APP.cfg.V * APP.cfg.V * APP.cfg.f * 1e6 * 1e3;
    const ro = `1 s avg · toggles/cyc ${fmt.int(SN.tog)} · α ${(alpha * 100).toFixed(1)}% · est. ${mw.toFixed(3)} mW`;
    text(ctx, ro, cv.fpReadX, 12, F.mono(9), P.text);
  }
  function critPts() {
    if (!cv.critPts) { cv.critPts = []; for (const i of D.critical.path) if (i >= D.dffStart) cv.critPts.push([L.pos[i * 2] + 1.5, L.pos[i * 2 + 1] + 1.5]); }
    return cv.critPts;
  }
  function drawTicks() {
    const c = cv.ticks, ctx = c.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const nets = APP.fault.undetNets;
    cv.ticksN = nets.length;
    ctx.fillStyle = rgba(P.red, 0.9);
    for (const i of nets) {
      const x = L.pos[i * 2], y = L.pos[i * 2 + 1];
      ctx.fillRect(x - 1, y - 1, 5, 1); ctx.fillRect(x - 1, y - 1, 1, 3);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------------------------------------
  let CTRL = [];
  function initControls() {
    const c = APP.cfg;
    const S = () => APP.sim, FA = () => APP.fault;
    const pw = () => 0.5 * APP.snap.tog * c.C * 1e-15 * c.V * c.V * c.f * 1e6 * 1e3;
    CTRL = [
      { name: 'Clock target', kind: 'slider', get: () => c.clockHz / 1000, set: (v) => (c.clockHz = Math.round(v * 1000)), min: 1, max: 60, step: 0.5, range: ['1', '60 kHz'],
        r1: () => (c.clockHz / 1000).toFixed(1) + ' kHz', r2: () => `meas ${(APP.hz / 1000).toFixed(2)} · cap ${((APP.cap || 0) / 1000).toFixed(1)}` },
      { name: 'Forwarding unit', kind: 'toggle', get: () => c.fwd, set: (v) => (c.fwd = v), on: 'ON', off: 'OFF',
        r1: () => ((S().C.fwdXM + S().C.fwdMW) / Math.max(1, S().instret)).toFixed(3) + '/instr', r2: () => 'off: stall on RAW' },
      { name: 'Branch predictor', kind: 'seg', opts: ['NOT-TAKEN', 'BTFN'], get: () => c.btfn, set: (v) => (c.btfn = v),
        r1: () => (S().C.br ? fmt.pct(1 - S().C.misp / S().C.br, 2) : '-'), r2: () => 'accuracy' },
      { name: 'MAXIT', kind: 'num', get: () => c.maxit, set: (v) => (c.maxit = v), min: 8, max: 64, step: 4, val: (v) => String(v), range: '8-64',
        r1: () => String(S().params[4]), r2: () => 'RAM 0x0001_0010' },
      { name: 'Zoom per frame', kind: 'knob', get: () => c.zoom, set: (v) => (c.zoom = v), min: 1.25, max: 4, step: 0.25, range: '×1.25-×4.0',
        r1: () => '×' + c.zoom.toFixed(2), r2: () => 'next w ' + (((S().params[2] / PROG.Q) * 48 * S().params[3]) / PROG.Q).toFixed(4) },
      { name: 'Golden lockstep', kind: 'toggle', get: () => c.lockstep, set: (v) => (c.lockstep = v), on: 'ON', off: 'OFF',
        r1: () => fmt.si(S().checked, 2).trim(), r2: () => `checked · ${S().div} div` },
      { name: 'Fault model', kind: 'pair', opts: ['SA0', 'SA1'], get: () => [c.sa0, c.sa1], set: (k) => { if (k === 0) c.sa0 ^= 1; else c.sa1 ^= 1; if (!c.sa0 && !c.sa1) c.sa0 = c.sa1 = 1; },
        r1: () => (c.sa0 && c.sa1 ? 'both' : c.sa0 ? 'SA0' : 'SA1'), r2: () => fmt.int(FA().universe) + ' faults' },
      { name: 'Fault workers', kind: 'slider', get: () => c.workers, set: (v) => APP.setWorkers(Math.round(v)), min: 1, max: 12, step: 1, range: ['1', '12'],
        r1: () => String(c.workers), r2: () => '64 cyc/frame each' },
      { name: 'Test length', kind: 'num', get: () => c.testLen, set: (v) => (c.testLen = v), min: 512, max: 16384, step: 512, val: (v) => v + ' cyc', range: '512-16384',
        r1: () => '#' + FA().batchSeq, r2: () => 'batches issued' },
      { name: 'Process (power est.)', kind: 'fields', r1: () => pw().toFixed(3) + ' mW', r2: () => '1 s avg' },
      { name: 'Heat decay', kind: 'slider', get: () => c.decay, set: (v) => (c.decay = v), min: 0.8, max: 0.99, step: 0.01, range: ['0.80', '0.99'],
        r1: () => c.decay.toFixed(2), r2: () => 'half-life ' + (Math.log(0.5) / Math.log(c.decay) / 60).toFixed(2) + ' s' },
    ];
    const el = cv.controls.c;
    let drag = null;
    const pt = (e) => { const r = el.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * R.controls[2], ((e.clientY - r.top) / r.height) * R.controls[3]]; };
    const rowAt = (y) => Math.floor((y - 30) / 24);
    const sliderSet = (ct, x) => { const t = Math.max(0, Math.min(1, (x - 124) / 110)); let v = ct.min + t * (ct.max - ct.min); v = Math.round(v / ct.step) * ct.step; ct.set(+v.toFixed(3)); };
    el.addEventListener('pointerdown', (e) => {
      const [x, y] = pt(e); const k = rowAt(y), ct = CTRL[k];
      if (!ct) return;
      if (ct.kind === 'slider' || ct.kind === 'knob') { drag = ct; sliderSet(ct, x); }
      else if (ct.kind === 'toggle') ct.set(ct.get() ? 0 : 1);
      else if (ct.kind === 'seg') ct.set(x < 190 ? 0 : 1);
      else if (ct.kind === 'pair') ct.set(x < 190 ? 0 : 1);
      else if (ct.kind === 'num') { const v = ct.get() + (x > 190 ? ct.step : -ct.step); ct.set(Math.max(ct.min, Math.min(ct.max, v))); }
      drawControls();
    });
    el.addEventListener('pointermove', (e) => { if (drag) { sliderSet(drag, pt(e)[0]); drawControls(); } });
    addEventListener('pointerup', () => (drag = null));
  }
  function drawControls() {
    const { ctx, w, h } = cv.controls;
    frame(ctx, w, h, 'Design & sim controls', '', 'all live', P.green);
    CTRL.forEach((ct, k) => {
      const y = 30 + k * 24, cy = y + 9;
      if (k) hline(ctx, 8, w - 8, y - 1, '#151920');
      text(ctx, ct.name, 10, cy, F.ui(11), P.text);
      const X0 = 124, X1 = 234;
      if (ct.kind === 'slider') {
        const v = ct.get(), t = (v - ct.min) / (ct.max - ct.min);
        ctx.fillStyle = P.line; ctx.fillRect(X0, cy - 1, X1 - X0, 2);
        ctx.fillStyle = P.blue; ctx.fillRect(X0, cy - 1, (X1 - X0) * t, 2);
        for (let i = 0; i <= 10; i++) { const tx = X0 + ((X1 - X0) * i) / 10; ctx.fillStyle = P.dim; ctx.fillRect(Math.round(tx), cy + 3, 1, i % 5 ? 2 : 4); }
        const tx = X0 + (X1 - X0) * t;
        ctx.fillStyle = P.text; ctx.fillRect(Math.round(tx) - 2, cy - 6, 5, 12);
        text(ctx, ct.range[0], X0, cy + 11, F.mono(8), P.dim);
        text(ctx, ct.range[1], X1, cy + 11, F.mono(8), P.dim, 'right');
      } else if (ct.kind === 'toggle') {
        const on = !!ct.get();
        ctx.fillStyle = on ? rgba(P.green, 0.18) : '#11141A'; ctx.fillRect(X0, cy - 7, 34, 14);
        box(ctx, X0, cy - 7, 34, 14, on ? rgba(P.green, 0.7) : P.line2);
        ctx.fillStyle = on ? P.green : P.muted; ctx.fillRect(on ? X0 + 20 : X0 + 3, cy - 4, 11, 8);
        text(ctx, on ? ct.on : ct.off, X0 + 42, cy, F.mono(10, 600), on ? P.green : P.muted);
      } else if (ct.kind === 'seg' || ct.kind === 'pair') {
        const sel = ct.get();
        ct.opts.forEach((o, j) => {
          const bx = X0 + j * 68, on = ct.kind === 'seg' ? sel === j : !!sel[j];
          ctx.fillStyle = on ? rgba(P.blue, 0.2) : '#11141A'; ctx.fillRect(bx, cy - 7, 66, 14);
          box(ctx, bx, cy - 7, 66, 14, on ? rgba(P.blue, 0.8) : P.line2);
          text(ctx, o, bx + 33, cy + 0.5, F.mono(9, 600), on ? P.text : P.muted, 'center');
        });
      } else if (ct.kind === 'num') {
        const v = ct.get();
        ctx.fillStyle = '#0A0C10'; ctx.fillRect(X0, cy - 7, 64, 14); box(ctx, X0, cy - 7, 64, 14, P.line2);
        text(ctx, ct.val(v), X0 + 6, cy + 0.5, F.mono(10), P.text);
        ctx.fillStyle = P.muted;
        ctx.beginPath(); ctx.moveTo(X0 + 72, cy - 1); ctx.lineTo(X0 + 76, cy - 6); ctx.lineTo(X0 + 80, cy - 1); ctx.fill();
        ctx.beginPath(); ctx.moveTo(X0 + 72, cy + 1); ctx.lineTo(X0 + 76, cy + 6); ctx.lineTo(X0 + 80, cy + 1); ctx.fill();
        text(ctx, ct.range, X0 + 88, cy, F.mono(8.5), P.dim);
      } else if (ct.kind === 'knob') {
        const v = ct.get(), t = (v - ct.min) / (ct.max - ct.min);
        const kx = X0 + 9, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, a = a0 + (a1 - a0) * t;
        ctx.strokeStyle = P.line2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(kx, cy, 8, a0, a1); ctx.stroke();
        ctx.strokeStyle = P.blue; ctx.beginPath(); ctx.arc(kx, cy, 8, a0, a); ctx.stroke();
        ctx.fillStyle = '#151922'; ctx.beginPath(); ctx.arc(kx, cy, 5.5, 0, 7); ctx.fill();
        ctx.strokeStyle = P.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(kx, cy); ctx.lineTo(kx + Math.cos(a) * 5.5, cy + Math.sin(a) * 5.5); ctx.stroke();
        ctx.lineWidth = 1;
        text(ctx, ct.range, X0 + 26, cy, F.mono(8.5), P.dim);
      } else if (ct.kind === 'fields') {
        const c = APP.cfg;
        const fl = [['V', c.V.toFixed(2), 'V'], ['C', c.C.toFixed(1), 'fF'], ['f', String(c.f), 'MHz']];
        let fx = X0 - 4;
        for (const [a, b, u] of fl) {
          text(ctx, a, fx, cy, F.mono(9), P.muted);
          ctx.fillStyle = '#0A0C10'; ctx.fillRect(fx + 8, cy - 7, 29, 14); box(ctx, fx + 8, cy - 7, 29, 14, P.line2);
          text(ctx, b, fx + 22.5, cy + 0.5, F.mono(9), P.text, 'center');
          text(ctx, u, fx + 39, cy, F.ui(9), P.muted);
          fx += a === 'V' ? 49 : 56;
        }
      }
      if (ct.r1 && APP.sim) {
        text(ctx, ct.r1(), w - 10, cy - 4, F.mono(10, 600), P.active, 'right');
        text(ctx, ct.r2(), w - 10, cy + 8, F.mono(8), P.muted, 'right');
      }
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Netlist hierarchy
  // ------------------------------------------------------------------------------------------------
  const HROWS = [['core', 0], ['glue', 1], ['ifu', 1], ['ifu/pc', 2], ['ifu/inc', 2], ['ifu/npc', 2], ['ifid', 1], ['idu', 1], ['idu/dec', 2], ['idu/imm', 2], ['idu/rf', 2], ['idu/rf/cells', 3],
    ['idu/rf/rd1', 3], ['idu/rf/rd2', 3], ['idu/haz', 2], ['idu/bta', 2], ['idex', 1], ['exu', 1], ['exu/fwd', 2], ['exu/alu', 2], ['exu/alu/ks', 3], ['exu/alu/shf', 3],
    ['exu/mul', 2], ['exu/mul/pp', 3], ['exu/mul/dadda', 3], ['exu/mul/ks64', 3], ['exu/bcmp', 2], ['exu/rsel', 2], ['exmem', 1], ['lsu', 1], ['memwb', 1], ['wbu', 1]];
  let hIdx = null;
  function drawHier() {
    const { ctx, w, h } = cv.hier;
    const S = APP.modStats, FA = APP.fault;
    if (!hIdx) hIdx = HROWS.map(([p]) => (p === 'glue' ? -1 : D.mods.findIndex((m) => m.path === (p === 'core' ? 'core' : 'core/' + p))));
    frame(ctx, w, h, 'Netlist hierarchy', '1 s avg', `${fmt.int(S.cells[0])} + ${fmt.int(S.dff[0])} DFF`);
    const cols = [['CELLS', 118], ['DFF', 145], ['NAND2', 177], ['DEP', 199], ['TOG/C', 231], ['α%', 258], ['µW', 295], ['COV%', 336]];
    const y0 = 31;
    for (const [nm, x] of cols) { if (/[αµ]/.test(nm)) text(ctx, nm, x, y0, F.mono(8.5), P.muted, 'right'); else label(ctx, nm, x, y0, P.muted, 'right', 8.5); }
    label(ctx, 'MODULE', 8, y0, P.muted, 'left', 8.5);
    hline(ctx, 6, w - 6, y0 + 6, P.line);
    const rh = 10.2;
    const tot = S.cells[0] + S.dff[0];
    // own value of the top module = subtree minus its children (cells placed directly in core, e.g. the reset inverter)
    const kids = D.mods.map((m, i) => i).filter((i) => D.mods[i].parent === 0);
    const own = (arr, stride = 1, off = 0) => arr[0 * stride + off] - kids.reduce((a, k) => a + arr[k * stride + off], 0);
    const pw = 0.5 * APP.cfg.C * 1e-15 * APP.cfg.V * APP.cfg.V * APP.cfg.f * 1e6 * 1e6; // µW per toggle/cycle
    HROWS.forEach(([p, depth], r) => {
      const m = hIdx[r], glue = m < 0;
      const y = y0 + 13 + r * rh;
      const cells = glue ? own(S.cells) : S.cells[m], dff = glue ? own(S.dff) : S.dff[m], n = cells + dff;
      if (r % 2 === 0) { ctx.fillStyle = '#0B0D12'; ctx.fillRect(6, y - rh / 2, w - 12, rh); }
      // share bar
      const bw = Math.sqrt(n / tot) * 70;
      ctx.fillStyle = rgba(depth <= 1 ? P.blue : P.magenta, 0.16); ctx.fillRect(8 + depth * 7, y + 3, bw, 2);
      const nm = p.split('/').slice(-1)[0];
      text(ctx, nm, 8 + depth * 7, y, F.mono(9, depth <= 1 ? 600 : 400), depth === 0 ? P.text : depth === 1 ? '#C3CAD8' : P.muted);
      const tg = glue ? own(APP.snap.mod) : APP.snap.mod[m], alpha = n ? tg / n : 0;
      const sim = glue ? own(FA.perMod, 2, 1) : FA.perMod[m * 2 + 1], det = glue ? own(FA.perMod, 2, 0) : FA.perMod[m * 2];
      const cov = sim ? det / sim : NaN;
      const vals = [String(cells), dff ? String(dff) : '·', glue ? own(S.nand).toFixed(2) : String(Math.round(S.nand[m])), glue ? '1' : String(S.depth[m]), tg >= 100 ? String(Math.round(tg)) : tg.toFixed(1), (alpha * 100).toFixed(1), (tg * pw).toFixed(1), sim ? (cov * 100).toFixed(1) : '·'];
      // inline bars: activity under the α column, coverage under the COV column
      ctx.fillStyle = rgba(P.cyan, 0.13); ctx.fillRect(cols[5][1] - 25, y - rh / 2 + 1, Math.min(25, 25 * (alpha / 0.4)), rh - 2);
      if (sim) { ctx.fillStyle = rgba(cov >= 0.9 ? P.up : cov >= 0.7 ? P.warn : P.down, 0.16); ctx.fillRect(cols[7][1] - 28, y - rh / 2 + 1, 28 * cov, rh - 2); }
      vals.forEach((v, k) => {
        let c = P.text;
        if (k === 1 && !dff) c = P.dim;
        if (k === 4) c = P.cyan;
        if (k === 5) c = alpha > 0.25 ? P.warn : P.text;
        if (k === 7) c = !sim ? P.dim : cov >= 0.9 ? P.up : cov >= 0.7 ? P.warn : P.down;
        text(ctx, v, cols[k][1], y, F.mono(9), c, 'right');
      });
    });
    // critical path summary
    const yc = y0 + 13 + HROWS.length * rh + 2;
    hline(ctx, 6, w - 6, yc - 3, P.line);
    label(ctx, 'CRITICAL PATH', 8, yc + 5, P.gold, 'left', 8.5);
    text(ctx, `${D.critical.levels} levels flop to flop`, w - 8, yc + 5, F.mono(9.5, 600), P.gold, 'right');
    const segs = APP.critSegs.filter((s) => s.n > 0);
    let x = 8;
    const yy = yc + 17;
    ctx.font = F.mono(9);
    const parts = ['idex'].concat(segs.map((s) => `${s.name}:${s.n}`)).concat(['exmem']);
    parts.forEach((t, k) => {
      const c = k === 0 || k === parts.length - 1 ? P.gold : P.text;
      text(ctx, t, x, yy, F.mono(9), c);
      x += ctx.measureText(t).width;
      if (k < parts.length - 1) { text(ctx, '›', x + 2, yy, F.mono(9), P.muted); x += 10; }
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Register file & counters
  // ------------------------------------------------------------------------------------------------
  function drawRegs() {
    const { ctx, w, h } = cv.regs;
    const s = APP.sim, C = s.C, pr = s.pipeRegs;
    frame(ctx, w, h, 'Register file & counters', 'x0 hardwired · 31×32 DFF', 'cycle ' + fmt.int(s.cyc));
    const rh = 10.8;
    for (let r = 0; r < 32; r++) {
      const col = r >> 4, row = r & 15;
      const x = 8 + col * 152, y = 33 + row * rh;
      const v = s.regs[r];
      const age = r ? s.cyc - s.regLast[r] : 1e9;
      const hot = Math.max(0, 1 - age / 6000);
      text(ctx, ABI[r], x + 22, y, F.mono(9.5), r ? P.muted : P.dim, 'right');
      text(ctx, fmt.hex8(v), x + 27, y, F.mono(9.5), r ? (hot > 0.05 ? mix(P.text, P.active, hot) : P.text) : P.dim);
      for (let b = 0; b < 32; b++) {
        const on = (v >>> (31 - b)) & 1;
        ctx.fillStyle = r === 0 ? '#12151C' : on ? (hot > 0.05 ? mix(P.blue, P.active, hot) : P.blue) : '#1A1F29';
        ctx.fillRect(x + 82 + b * 2.05, y - 3, 1.5, 6);
      }
    }
    vline(ctx, 314, 28, h - 6, P.line);
    const X = 322, XR = w - 8;
    let y = 33;
    label(ctx, 'PIPELINE REGISTERS', X, y, P.blue, 'left', 8.5); y += rh;
    const pl = [
      ['PC', fmt.hex8(pr.pcIF), disStr(romAt(pr.pcIF), pr.pcIF).split(' ')[0]],
      ['IF/ID', fmt.hex8(pr.irID), pr.vID ? fmt.hex(pr.pcID, 4) : 'bubble'],
      ['ID/EX', fmt.hex8(pr.dxRs1v), pr.vEX ? 'rs1' : 'bubble'],
      ['EX/MEM', fmt.hex8(pr.addr), pr.vMEM ? 'res' : 'bubble'],
      ['MEM/WB', fmt.hex8(pr.rwd), pr.vWB ? 'wb' : 'bubble'],
    ];
    for (const [a, b, c] of pl) {
      text(ctx, a, X, y, F.mono(9.5), P.muted); text(ctx, b, X + 46, y, F.mono(9.5), P.text); text(ctx, c, XR, y, F.mono(9), c === 'bubble' ? P.dim : P.muted, 'right');
      y += rh;
    }
    label(ctx, 'PERF COUNTERS · NETS', X, y, P.blue, 'left', 8.5); y += rh;
    const ipc = s.instret / s.cyc;
    const cl = [
      ['cycles', fmt.int(s.cyc), P.text], ['instret', fmt.int(s.instret), P.text], ['IPC / CPI', `${ipc.toFixed(3)} / ${(1 / ipc).toFixed(3)}`, P.cyan],
      ['load-use stall', fmt.int(C.loadUse), P.warn], ['flush (2 bub)', fmt.int(C.flush), P.down], ['ID redirect', fmt.int(C.idRedir), P.text],
      ['fwd EX/MEM', fmt.int(C.fwdXM), P.text], ['fwd MEM/WB', fmt.int(C.fwdMW), P.text],
      ['branch acc', C.br ? `${fmt.pct(1 - C.misp / C.br, 2)} of ${fmt.si(C.br, 0).trim()}` : '-', P.green],
    ];
    for (const [a, b, c] of cl) { text(ctx, a, X, y, F.mono(9), P.muted); text(ctx, b, XR, y, F.mono(9.5), c, 'right'); y += rh; }
  }

  // ------------------------------------------------------------------------------------------------
  // Pipeline diagram & retire trace
  // ------------------------------------------------------------------------------------------------
  const STC = [P.blue, P.magenta, P.gold, P.cyan, P.green];
  const STL = ['F', 'D', 'X', 'M', 'W'];
  function drawPipe() {
    const { ctx, w, h } = cv.pipe;
    const s = APP.sim;
    frame(ctx, w, h, 'Pipeline', `occupancy · last ${s.pipe.length} cycles`, `IPC ${(s.instret / s.cyc).toFixed(3)} · CPI ${(s.cyc / s.instret).toFixed(3)}`);
    const pipe = s.pipe;
    const NC = pipe.length;
    const cx0 = 166, cw = (w - 8 - cx0) / NC, y0 = 28;
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
    const NR = 12, rh = 10;
    const rows = early.slice(-NR);
    // header: the full cycle number of the first column, then offsets
    text(ctx, fmt.int(pipe[0][0]), cx0, y0 + 3, F.mono(7.5), P.muted);
    for (let c = 4; c < NC; c += 4) text(ctx, '+' + c, cx0 + c * cw + 1, y0 + 3, F.mono(7.5), P.dim);
    const ry0 = y0 + 9;
    rows.forEach((r, j) => {
      const y = ry0 + j * rh;
      const ins = disStr(romAt(r.pc), r.pc);
      if (j % 2 === 0) { ctx.fillStyle = '#0B0D12'; ctx.fillRect(6, y - 0.3, w - 12, rh); }
      text(ctx, fmt.hex(r.pc, 4), 8, y + rh / 2, F.mono(9), P.muted);
      text(ctx, ins.length > 21 ? ins.slice(0, 21) : ins, 38, y + rh / 2, F.mono(9), P.text);
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
        text(ctx, ['IF', 'ID', 'EX', 'MEM', 'WB'][k], x + (cw - 1.5) / 2, y + rh / 2, F.mono(7.5, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');
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

  // ------------------------------------------------------------------------------------------------
  // Framebuffer & UART
  // ------------------------------------------------------------------------------------------------
  let PAL = null;
  function buildPalette() {
    // iteration count -> colour: deep blue through magenta and gold to white; maxit = black
    PAL = new Uint8ClampedArray(65 * 4);
    const stops = [[0, [6, 10, 30]], [0.18, [30, 60, 170]], [0.38, [61, 139, 255]], [0.55, [210, 92, 255]], [0.72, [255, 77, 94]], [0.86, [255, 194, 74]], [1, [255, 245, 214]]];
    for (let i = 0; i <= 64; i++) {
      const t = Math.pow(i / 64, 0.7);
      let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const [ta, ca] = stops[k], [tb, cb] = stops[k + 1], u = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
      for (let c = 0; c < 3; c++) PAL[i * 4 + c] = ca[c] + (cb[c] - ca[c]) * u;
      PAL[i * 4 + 3] = 255;
    }
  }
  function fbToImage(fb, maxit, upto, under) {
    const img = new ImageData(48, 32);
    for (let i = 0; i < 1536; i++) {
      const v = fb[i];
      const o = i * 4;
      if (upto !== undefined && i >= upto) {
        if (under && under[i] < maxit) { const k = Math.min(64, Math.round((under[i] / maxit) * 64)) * 4; img.data[o] = 8 + PAL[k] * 0.1; img.data[o + 1] = 10 + PAL[k + 1] * 0.1; img.data[o + 2] = 14 + PAL[k + 2] * 0.1; }
        else { img.data[o] = 8; img.data[o + 1] = 10; img.data[o + 2] = 14; }
        img.data[o + 3] = 255; continue;
      }
      if (v >= maxit) { img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0; img.data[o + 3] = 255; continue; }
      const k = Math.min(64, Math.round((v / maxit) * 64)) * 4;
      img.data[o] = PAL[k]; img.data[o + 1] = PAL[k + 1]; img.data[o + 2] = PAL[k + 2]; img.data[o + 3] = 255;
    }
    return img;
  }
  function drawOut(now) {
    const { ctx, w, h } = cv.out;
    const s = APP.sim, pa = s.params;
    const fr = pa[5] + 1, maxit = pa[4];
    const px = Math.max(0, Math.min(1536, s.regs[21] - PROG.FB));
    const row = Math.min(31, s.regs[22]);
    frame(ctx, w, h, 'Framebuffer & UART', 'RAM 0x0001_8000 · 48×32 · Q4.28', `frame ${fr} · ${(px / 15.36).toFixed(0)}%`);
    // current frame: pixels already written this frame, older ones from the previous frame dimmed
    const img = fbToImage(s.fb, maxit, px, APP.thumbs.length ? APP.thumbs[APP.thumbs.length - 1].fb : null);
    cv.fbImg.getContext('2d').putImageData(img, 0, 0);
    const FX = 8, FY = 30, SC = 5;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv.fbImg, FX, FY, 48 * SC, 32 * SC);
    // pixels not painted yet this frame: one dim dot per pixel
    ctx.fillStyle = '#20252F';
    for (let i = px; i < 1536; i++) ctx.fillRect(FX + (i % 48) * SC + 2, FY + Math.floor(i / 48) * SC + 2, 1, 1);
    box(ctx, FX - 1, FY - 1, 48 * SC + 2, 32 * SC + 2, P.line2);
    // write cursor
    if (px < 1536) {
      const cx = px % 48, cy = Math.floor(px / 48);
      ctx.strokeStyle = P.active; ctx.lineWidth = 1;
      ctx.strokeRect(FX + cx * SC - 0.5, FY + cy * SC - 0.5, SC + 1, SC + 1);
      ctx.fillStyle = rgba(P.active, 0.5);
      ctx.fillRect(FX - 5, FY + cy * SC + 1, 3, SC - 2);
      ctx.fillRect(FX + 48 * SC + 2, FY + cy * SC + 1, 3, SC - 2);
    }
    // view parameters
    const Q = PROG.Q;
    const cxv = pa[0] / Q, cyv = pa[1] / Q, dx = pa[2] / Q;
    text(ctx, `c ${cxv.toFixed(9)} ${cyv >= 0 ? '+' : '−'}${Math.abs(cyv).toFixed(9)}i`, FX, FY + 32 * SC + 11, F.mono(9.5), P.text);
    text(ctx, `w ${(dx * 48).toFixed(4)}`, FX + 48 * SC, FY + 32 * SC + 11, F.mono(9.5), P.muted, 'right');
    text(ctx, `dx ${fmt.hex8(pa[2])} · MAXIT ${maxit} · ×${(Q / pa[3]).toFixed(1)}`, FX, FY + 32 * SC + 23, F.mono(9), P.muted);
    text(ctx, `r${String(row).padStart(2, '0')} px ${String(px).padStart(4, ' ')}`, FX + 48 * SC, FY + 32 * SC + 23, F.mono(9), P.active, 'right');
    // thumbnails of finished frames
    const TX = 262, TW = 66, TH = 44;
    vline(ctx, TX - 8, 28, h - 6, P.line);
    label(ctx, 'FRAMES', TX, 31, P.muted, 'left', 8.5);
    const th = APP.thumbs.slice(-2);
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
        ctx.fillStyle = 'rgba(6,7,10,0.85)'; ctx.fillRect(x + 1, y + TH - 11, 44, 10);
        label(ctx, 'painting', x + 4, y + TH - 6, P.active, 'left', 7.5);
        text(ctx, `f${fr}`, x, y + TH + 7, F.mono(8.5, 600), P.active);
        text(ctx, `${(px / 15.36).toFixed(0)}%`, x + TW, y + TH + 7, F.mono(8.5), P.active, 'right');
      } else {
        box(ctx, x - 1, y - 1, TW + 2, TH + 2, P.line);
        ctx.fillStyle = '#0A0C10'; ctx.fillRect(x, y, TW, TH);
        text(ctx, `f${fr + 1} next`, x + TW / 2, y + TH / 2 - 5, F.mono(8.5, 600), P.dim, 'center');
        text(ctx, `w ${((pa[2] / PROG.Q) * 48 * (pa[3] / PROG.Q)).toFixed(4)}`, x + TW / 2, y + TH / 2 + 7, F.mono(7.5), P.dim, 'center');
      }
    }
    // UART console
    const UY = 100;
    label(ctx, 'UART TX · 0x2000_0000', TX, UY, P.muted, 'left', 8.5);
    text(ctx, `${APP.uartLines.length} lines`, w - 8, UY, F.mono(8.5), P.dim, 'right');
    ctx.fillStyle = '#08090C'; ctx.fillRect(TX - 2, UY + 6, w - TX - 6, h - UY - 12);
    box(ctx, TX - 2, UY + 6, w - TX - 6, h - UY - 12, P.line);
    const nl = Math.floor((h - UY - 18) / 10.5);
    const lines = APP.uartLines.slice(-(nl - 1)).map((l) => l.s);
    lines.push(APP.uartCur + (Math.floor(now / 500) % 2 ? '▌' : ' '));
    lines.forEach((l, j) => {
      const y = UY + 15 + j * 10.5;
      const isF = l.startsWith('f=');
      text(ctx, l.slice(0, 30), TX + 3, y, F.mono(9.5), isF ? P.gold : j === lines.length - 1 ? P.active : P.text);
    });
  }

  // ------------------------------------------------------------------------------------------------
  // Logic analyzer: triggered captures of the last cycles (trigger = flush rising edge)
  // ------------------------------------------------------------------------------------------------
  const SIGS = [
    ['clk', -1, 1], ['pc', 0, 32], ['if_instr', 1, 32], ['stall', 2, 1], ['flush', 3, 1], ['bp_taken', 4, 1], ['fwdA', 5, 2], ['fwdB', 6, 2],
    ['alu_out', 7, 32], ['mul_hi', 8, 32], ['mem_addr', 9, 32], ['mem_we', 10, 1], ['wb_rd', 11, 5], ['wb_data', 12, 32], ['retire', 13, 1],
  ];
  const SIGC = { pc: P.blue, if_instr: P.cyan, stall: P.warn, flush: P.down, bp_taken: P.cyan, fwdA: P.magenta, fwdB: P.magenta, alu_out: P.green, mul_hi: P.gold, mem_addr: P.gold, mem_we: P.gold, wb_rd: P.cyan, wb_data: P.green, retire: P.up, clk: P.muted };
  let cap = null, capN = 0;
  const TRIG = [['flush', 3, 'flush rising edge'], [null, -1, 'none · free run'], ['mem_we', 10, 'mem_we rising edge'], ['bp_taken', 4, 'bp_taken rising edge'], [null, -1, 'none · free run']];
  function capture() {
    const RING = APP.RING, NW = APP.NW;
    const n = APP.filled;
    if (n < 64) return;
    const idx = (k) => (APP.head - n + k + RING * 4) % RING; // k: 0 oldest .. n-1 newest
    // trigger: the latest rising edge of the chosen net with at least 40 cycles after it (or free run)
    const mode = TRIG[capN % TRIG.length];
    let trig = n - 41, found = !mode[0];
    if (mode[0]) for (let k = n - 41; k > 0; k--) {
      const a = APP.wave[idx(k) * NW + mode[1]], b = APP.wave[idx(k - 1) * NW + mode[1]];
      if (a && !b) { trig = k; found = true; break; }
    }
    const span = Math.min(n, 256);
    const start = Math.max(0, Math.min(n - span, trig - (span - 40))), end = start + span;
    const W = [], cyc = [], tog = [];
    for (let k = start; k < end; k++) { const i = idx(k); W.push(APP.wave.slice(i * NW, i * NW + NW)); cyc.push(APP.waveCyc[i]); tog.push(APP.tog[i]); }
    cap = { W, cyc, tog, trig: trig - start, n: W.length, mode: found ? mode[2] : 'none · free run', net: found ? mode[0] : null };
    capN++;
  }
  const hueOf = (v) => (((Math.imul(v | 0, 0x9E3779B1) >>> 0) % 360));
  const HUE_O = Array.from({ length: 360 }, (_, h) => `hsla(${h},55%,26%,0.75)`), HUE_Z = Array.from({ length: 360 }, (_, h) => `hsla(${h},55%,22%,0.55)`);
  const FWD1 = 'rgba(63,224,220,0.3)', FWD2 = 'rgba(210,92,255,0.3)';
  function drawWave(now) {
    const { ctx, w, h } = cv.wave;
    const fresh = !cap || APP.frame % 15 === 11;
    if (fresh) capture();
    if (!cap) return;
    if (!fresh) { if (APP.frame % 3 === 0) drawIPC(ctx, w, h); return; }
    const s = APP.sim;
    frame(ctx, w, h, 'Logic analyzer', `capture #${capN} · trigger: ${cap.mode} · ${cap.n} cycles · lane 0`, `${cap.net ? 'trigger' : 'cursor'} @ cycle ${fmt.int(cap.cyc[cap.trig])}`);
    const NX = 8, VX = 96, OX0 = 176, OX1 = 722, ZX0 = 736, ZX1 = w - 8;
    const RY = 30, RH = 13.6;
    const n = cap.n;
    const ow = (OX1 - OX0) / n;
    const zc = 7, zs = Math.max(0, Math.min(n - zc, cap.trig - 3)), zw = (ZX1 - ZX0) / zc;
    // zoom bracket in the overview
    ctx.fillStyle = rgba(P.active, 0.05); ctx.fillRect(OX0 + zs * ow, RY - 4, zc * ow, SIGS.length * RH + 4);
    box(ctx, OX0 + zs * ow, RY - 4, zc * ow + 1, SIGS.length * RH + 4, rgba(P.active, 0.4));
    box(ctx, ZX0 - 2, RY - 4, ZX1 - ZX0 + 4, SIGS.length * RH + 4, rgba(P.active, 0.3));
    // trigger line
    const tx = OX0 + cap.trig * ow;
    vline(ctx, tx, RY - 4, RY + SIGS.length * RH, rgba(P.down, 0.6));
    label(ctx, cap.net ? 'T' : 'C', tx + 3, RY - 1, P.down, 'left', 8);
    SIGS.forEach(([nm, k, bits], r) => {
      const y = RY + r * RH, yt = y + 2, yb = y + RH - 3, ym = (yt + yb) / 2;
      if (r % 2 === 0) { ctx.fillStyle = '#0B0D12'; ctx.fillRect(NX - 2, y, w - 12, RH); }
      const col = SIGC[nm];
      text(ctx, nm, NX, ym, F.mono(9.5), P.text);
      const vT = k >= 0 ? cap.W[cap.trig][k] : 1;
      const vs = k < 0 ? '' : bits === 1 ? String(vT & 1) : bits === 2 ? ['-', 'EX/MEM', 'MEM/WB', '?'][vT & 3] : bits === 5 ? `x${vT} ${ABI[vT]}` : fmt.hex8(vT);
      text(ctx, vs, VX, ym, F.mono(9.5), col);
      const pane = (x0, c0, c1, cw, zoom) => {
        if (k < 0) {
          ctx.strokeStyle = rgba(P.muted, zoom ? 0.9 : 0.55); ctx.lineWidth = 1; ctx.beginPath();
          for (let c = c0; c < c1; c++) {
            const xa = x0 + (c - c0) * cw;
            ctx.moveTo(xa, yb); ctx.lineTo(xa, yt); ctx.lineTo(xa + cw / 2, yt); ctx.lineTo(xa + cw / 2, yb); ctx.lineTo(xa + cw, yb);
          }
          ctx.stroke();
          return;
        }
        if (bits === 1) {
          ctx.fillStyle = rgba(col, 0.2);
          ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
          let pv = -1;
          for (let c = c0; c < c1; c++) {
            const v = cap.W[c][k] & 1, xa = x0 + (c - c0) * cw;
            if (v) ctx.fillRect(xa, yt, cw, yb - yt);
            const yy = v ? yt : yb;
            if (c === c0) ctx.moveTo(xa, yy); else if (v !== pv) ctx.lineTo(xa, yy);
            ctx.lineTo(xa + cw, yy);
            pv = v;
          }
          ctx.stroke();
          return;
        }
        if (!zoom) {
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
        const HC = zoom ? HUE_Z : HUE_O;
        const outline = new Path2D();
        const labels = [];
        let c = c0;
        while (c < c1) {
          const v = cap.W[c][k];
          let e = c + 1;
          while (e < c1 && cap.W[e][k] === v) e++;
          const xa = x0 + (c - c0) * cw, xb = x0 + (e - c0) * cw;
          const d = Math.min(3, (xb - xa) / 2);
          const seg = new Path2D();
          seg.moveTo(xa, ym); seg.lineTo(xa + d, yt); seg.lineTo(xb - d, yt); seg.lineTo(xb, ym); seg.lineTo(xb - d, yb); seg.lineTo(xa + d, yb); seg.closePath();
          if (bits !== 2 || v === 1 || v === 2) { ctx.fillStyle = bits === 2 ? (v === 1 ? FWD1 : FWD2) : HC[hueOf(v)]; ctx.fill(seg); }
          outline.addPath(seg);
          if (xb - xa > 18) {
            const lbl = bits === 2 ? (v === 1 ? 'XM' : v === 2 ? 'MW' : '') : bits === 5 ? ABI[v] : zoom ? fmt.hex8(v) : fmt.hex(v & 0xffff, 4);
            if (lbl) labels.push([lbl, xa, xb]);
          }
          c = e;
        }
        ctx.strokeStyle = rgba(col, zoom ? 0.95 : 0.7); ctx.lineWidth = 1; ctx.stroke(outline);
        ctx.font = F.mono(zoom ? 9.5 : 8.5);
        for (const [lbl, xa, xb] of labels) if (ctx.measureText(lbl).width + 6 < xb - xa) text(ctx, lbl, (xa + xb) / 2, ym + 0.5, F.mono(zoom ? 9.5 : 8.5), P.text, 'center');
      };
      pane(OX0, 0, n, ow, false);
      pane(ZX0, zs, zs + zc, zw, true);
    });
    // time axis
    const ya = RY + SIGS.length * RH + 6;
    hline(ctx, OX0, OX1, ya - 3, P.line);
    for (let c = 0; c < n; c += 20) { vline(ctx, OX0 + c * ow, ya - 3, ya, P.dim); if (c === 0) text(ctx, fmt.int(cap.cyc[0]), OX0 + 2, ya + 3, F.mono(7.5), P.muted); else if (c >= 40) text(ctx, '+' + c, OX0 + c * ow + 2, ya + 3, F.mono(7.5), P.dim); }
    const tl = cap.net ? 'T' : 'C';
    for (let c = 0; c < zc; c++) { const d = zs + c - cap.trig; text(ctx, d === 0 ? tl : `${tl}${d > 0 ? '+' : '−'}${Math.abs(d)}`, ZX0 + c * zw + zw / 2, ya + 3, F.mono(8), d === 0 ? P.down : P.muted, 'center'); }
    // toggles/cycle histogram (overview) and IPC sparkline (zoom side)
    const hy = ya + 10, hh = h - hy - 6;
    text(ctx, 'toggles/cyc', NX, hy + hh / 2, F.mono(9.5), P.text);
    const tmax = Math.max(1, ...cap.tog);
    text(ctx, `${fmt.int(cap.tog[cap.trig])} @${cap.net ? 'T' : 'C'}`, VX, hy + hh / 2, F.mono(9.5), P.cyan);
    ctx.fillStyle = rgba(P.cyan, 0.7);
    for (let c = 0; c < n; c++) { const v = cap.tog[c] / tmax; ctx.fillRect(OX0 + c * ow, hy + hh * (1 - v), Math.max(1, ow - 0.6), hh * v); }
    text(ctx, `max ${fmt.int(tmax)}`, OX1 - 2, hy + 4, F.mono(7.5), P.muted, 'right');
    drawIPC(ctx, w, h);
  }
  function drawIPC(ctx, w, h) {
    const s = APP.sim;
    const RY = 30, RH = 13.6, ZX0 = 736, ZX1 = w - 8;
    const ya = RY + SIGS.length * RH + 6, hy = ya + 10, hh = h - hy - 6;
    const ip = APP.ipcHist.slice(-600);
    const ix0 = ZX0, ix1 = ZX1;
    ctx.fillStyle = P.surface; ctx.fillRect(ix0, hy, ix1 - ix0, hh);
    ctx.strokeStyle = P.line; ctx.strokeRect(ix0 + 0.5, hy + 0.5, ix1 - ix0 - 1, hh - 1);
    ctx.strokeStyle = P.up; ctx.lineWidth = 1; ctx.beginPath();
    ip.forEach((v, i) => { const x = ix0 + 2 + (i / Math.max(1, ip.length - 1)) * (ix1 - ix0 - 70), y = hy + hh - 2 - (hh - 4) * Math.max(0, Math.min(1, (v - 0.6) / 0.4)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    const ipcNow = s.instret / s.cyc;
    text(ctx, 'IPC per frame · axis 0.6-1.0 · last 10 s', ix0 + 4, hy + hh - 6, F.mono(8), P.muted);
    text(ctx, ipcNow.toFixed(3), ix1 - 4, hy + hh / 2 + 2, F.mono(11, 600), P.up, 'right');
  }

  // ------------------------------------------------------------------------------------------------
  // Fault campaign
  // ------------------------------------------------------------------------------------------------
  function drawFault() {
    const { ctx, w, h } = cv.fault;
    const FA = APP.fault, cfg = APP.cfg;
    const act = FA.workers.filter((x) => x.id < cfg.workers);
    frame(ctx, w, h, 'Stuck-at campaign', `${act.length} workers · 31 faults/word`, `${fmt.int(FA.batches)} batches · ${Math.round(APP.faultRate || 0)} faults/s`);
    let y = 32;
    for (const wk of act) {
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
    }
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
    // summary
    const sy = h - 12;
    hline(ctx, 6, w - 6, sy - 9, P.line);
    const mean = FA.det ? FA.latSum / FA.det : 0;
    text(ctx, `${(p * 100).toFixed(1)}%`, 8, sy, F.mono(12, 600), P.up);
    ctx.font = F.mono(12, 600);
    const ww = ctx.measureText(`${(p * 100).toFixed(1)}%`).width;
    text(ctx, `±${(((hi - lo) / 2) * 100).toFixed(1)} · ${fmt.int(FA.det)} det · mean ${mean.toFixed(0)} cyc · ${fmt.si(FA.cyclesTotal * 31, 1)}fault-cyc`, 12 + ww, sy, F.mono(9), P.muted);
  }

  // ------------------------------------------------------------------------------------------------
  // Machine resources (kit)
  // ------------------------------------------------------------------------------------------------
  function spark(ctx, x, y, w, h, vals, max, col, fill) {
    if (!vals.length) return;
    ctx.beginPath();
    vals.forEach((v, i) => { const xx = x + (i / Math.max(1, vals.length - 1)) * w, yy = y + h - (h * Math.min(1, Math.max(0, v / max))); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    if (fill) { ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.beginPath(); vals.forEach((v, i) => { const xx = x + (i / Math.max(1, vals.length - 1)) * w, yy = y + h - (h * Math.min(1, Math.max(0, v / max))); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }); }
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
  }
  function drawRes() {
    const { ctx, w, h } = cv.res;
    const sys = STUDIO.system || {};
    const m = STUDIO.metrics(), hist = STUDIO.history(60);
    frame(ctx, w, h, 'This PC', 'tags by load rank', `${sys.threads || 16} threads · ${sys.ramGB || ''} GB`);
    const nt = Math.max(16, (m.cpu || []).length);
    // tags by load rank over the last 3 s (the browser cannot see which OS thread runs which worker)
    const recent = STUDIO.history(3);
    const avg = Array.from({ length: 16 }, (_, t) => recent.reduce((a, s) => a + (s.cpu && s.cpu[t] !== undefined ? s.cpu[t] : 0), 0) / Math.max(1, recent.length));
    const order = avg.map((v, t) => [v, t]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
    const nW = APP.cfg.workers;
    const tags = new Array(16).fill(null);
    order.forEach((t, r) => { tags[t] = r === 0 ? ['sim', P.magenta] : r === 1 ? ['main', P.blue] : r - 2 < nW ? ['W' + (r - 1), P.cyan] : ['os', P.dim]; });
    const cw = (w - 16 - 3 * 6) / 4, ch = 24;
    for (let t = 0; t < 16; t++) {
      const col = t % 4, row = t >> 2;
      const x = 8 + col * (cw + 6), y = 30 + row * (ch + 6);
      ctx.fillStyle = '#0A0C10'; ctx.fillRect(x, y, cw, ch); box(ctx, x, y, cw, ch, P.line);
      const vals = hist.map((s) => (s.cpu && s.cpu[t] !== undefined ? s.cpu[t] : 0));
      const v = m.cpu && m.cpu[t] !== undefined ? m.cpu[t] : 0;
      spark(ctx, x + 1, y + 10, cw - 2, ch - 11, vals, 100, v > 70 ? P.warn : P.blue, rgba(v > 70 ? P.warn : P.blue, 0.16));
      text(ctx, 'T' + String(t).padStart(2, '0'), x + 3, y + 6, F.mono(8), P.muted);
      text(ctx, tags[t][0], x + 21, y + 6, F.mono(8, 600), tags[t][1]);
      text(ctx, v.toFixed(0) + '%', x + cw - 3, y + 6, F.mono(8.5), v > 70 ? P.warn : P.text, 'right');
    }
    let y = 30 + 4 * (ch + 6) + 1;
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
    const row = (lab, val, vals, max, col, sub) => {
      text(ctx, lab, 8, y + 6, F.mono(9), P.muted);
      text(ctx, val, 122, y + 6, F.mono(10, 600), col, 'right');
      if (sub) text(ctx, sub, 8, y + 16, F.mono(7.5), P.dim);
      ctx.fillStyle = '#0A0C10'; ctx.fillRect(128, y, w - 136, 20); box(ctx, 128, y, w - 136, 20, P.line);
      if (vals) spark(ctx, 129, y + 2, w - 138, 17, vals, max, col, rgba(col, 0.14));
      y += 23;
    };
    row('CPU total', `${(m.cpuTotal || 0).toFixed(0)}%`, hist.map((s) => s.cpuTotal || 0), 100, P.blue, `threads T00-T15`);
    row('RAM', `${(m.ramUsed || 0).toFixed(1)} GB`, hist.map((s) => s.ramUsed || 0), m.ramTotal || 16, P.magenta, `of ${(m.ramTotal || 0).toFixed(1)} GB`);
    row('GPU', m.gpu === null || m.gpu === undefined ? '-' : `${m.gpu.toFixed(0)}%`, m.gpu === null || m.gpu === undefined ? null : hist.map((s) => s.gpu || 0), 100, P.green, 'integrated · WebGL2');
    const dr = m.diskR, dwv = m.diskW;
    row('Disk R|W', dr === null || dr === undefined ? '-' : `${dr.toFixed(1)}|${(dwv || 0).toFixed(1)}`, dr === null || dr === undefined ? null : hist.map((s) => (s.diskR || 0) + (s.diskW || 0)), Math.max(5, ...hist.map((s) => (s.diskR || 0) + (s.diskW || 0))), P.gold, 'MB/s');
    const pf = STUDIO.perf();
    const ft = APP.frameMsHist;
    text(ctx, 'Page', 8, y + 6, F.mono(9), P.muted);
    text(ctx, `${pf.fps} fps`, 122, y + 6, F.mono(10, 600), pf.fps >= 55 ? P.up : P.warn, 'right');
    ctx.fillStyle = '#0A0C10'; ctx.fillRect(128, y, w - 136, h - y - 6); box(ctx, 128, y, w - 136, h - y - 6, P.line);
    const fh = h - y - 8, fmax = 33.4;
    const by = y + 1 + fh - (fh * 16.7) / fmax;
    ctx.setLineDash([3, 3]); hline(ctx, 129, w - 9, by, rgba(P.warn, 0.6)); ctx.setLineDash([]);
    text(ctx, '16.7 ms', w - 12, by - 5, F.mono(7.5), P.warn, 'right');
    spark(ctx, 129, y + 1, w - 138, fh, ft, fmax, P.cyan);
    text(ctx, `frame ${pf.frameMs.toFixed(1)} ms`, 8, y + 16, F.mono(7.5), P.dim);
  }

  // ------------------------------------------------------------------------------------------------
  function draw(now) {
    const f = APP.frame;
    const pf = (cv.pf = (cv.pf || 0) + 1); // frames since the first paint: panels join one per frame
    if (pf < 2) { drawTop(now); if (GL) GL.draw(APP.heat, APP.flash); drawFloorOverlay(now); return; }
    if (pf < 10) {
      [() => drawTop(now), () => GL && GL.draw(APP.heat, APP.flash), () => drawFloorOverlay(now)].forEach((fn) => fn());
      [() => drawWave(now), drawRegs, drawPipe, () => drawOut(now), drawFault, drawRes, drawHier, drawControls].slice(0, pf - 1).forEach((fn, i) => { if (i === pf - 2) fn(); else if (i < 3) fn(); });
      return;
    }
    drawTop(now);
    if (GL) GL.draw(APP.heat, APP.flash);
    drawFloorOverlay(now);
    drawWave(now);
    drawRegs();
    drawPipe();
    if (f % 3 === 1) drawOut(now);
    if (f % 3 === 0) drawFault();
    if (f % 6 === 2) drawRes();
    if (f % 15 === 0) { drawHier(); drawControls(); }
  }

  G.PANELS = { init, draw, R };
})(window);

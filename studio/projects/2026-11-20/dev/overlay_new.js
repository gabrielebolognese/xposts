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
    const wbx = rfM.x + 2;
    tagBlock([['write-back', wbOn ? P.green : P.muted], [`x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`, P.text], [`${fmt.int(s.instret)} retired`, P.muted]], wbx, L.ctlY + 3, P.green, wbx + 8, yW);
    const rdx = ppM.x + 4;
    const mp = s.C.br ? (s.C.misp / s.C.br) * 100 : 0;
    tagBlock([['pc redirect (EX)', actFrac.flush > 0 ? P.red : P.muted], [`-> ${fmt.hex8(pr.exTarget)}`, P.text], [`${fmt.int(s.C.flush)} flushes · ${mp.toFixed(1)}% mispredict`, P.muted]], rdx, L.ctlY + 3, P.red, rdx + 8, yR);
    const mx = dadM.x + dadM.w * 0.42;
    tagBlock([['Baugh-Wooley array · this cycle', P.cyan], [`A ${fmt.hex8(pr.mulA)} × B ${fmt.hex8(pr.mulB)}`, P.text], [`P[63:32] ${fmt.hex8(pr.mulHi)}  P[31:0] in rsel`, P.muted]], mx, L.ctlY + 3, P.cyan);
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
    ctx.font = F.mono(9);
    const clw = ctx.measureText(cl).width;
    const clx = dadM.x + dadM.w - clw - 6, cly = L.dpY + 14;
    ctx.fillStyle = 'rgba(6,7,10,0.9)'; ctx.fillRect(clx - 4, cly - 6, clw + 8, 12);
    box(ctx, clx - 4, cly - 6, clw + 8, 12, rgba(P.gold, 0.6));
    text(ctx, cl, clx, cly + 0.5, F.mono(9), P.gold);
    occ.push({ x: clx - 4, y: cly - 6, w: clw + 8, h: 12 });
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
    const ro = `1 s avg · toggles/cyc ${fmt.int(SN.tog)} · α ${(alpha * 100).toFixed(1)}% · est. ${mw.toFixed(3)} mW · dyn depth ${s.deepest}/${D.critical.levels} last cyc`;
    text(ctx, ro, cv.fpReadX, 12, F.mono(9), P.text);
  }
  function critPts() {
    if (!cv.critPts) { cv.critPts = []; for (const i of D.critical.path) if (i >= D.dffStart) cv.critPts.push([L.pos[i * 2] + 1.5, L.pos[i * 2 + 1] + 1.5]); }
    return cv.critPts;
  }

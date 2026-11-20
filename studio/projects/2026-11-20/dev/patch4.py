import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

patch('sim-worker.js', [("    if (c === Math.max(0, n - 4)) heatSnap.set(heat);", "    if (c === Math.max(0, n - 2)) heatSnap.set(heat);")])

P = 'panels.js'
patch(P, [
# --- capture modes
("""  let cap = null, capN = 0;
  function capture() {""", """  let cap = null, capN = 0;
  const TRIG = [['flush', 3, 'flush rising edge'], [null, -1, 'none · free run'], ['mem_we', 10, 'mem_we rising edge'], ['bp_taken', 4, 'bp_taken rising edge'], [null, -1, 'none · free run']];
  function capture() {"""),
("""    // find the latest flush rising edge with at least 10 cycles after it
    let trig = n - 1;
    for (let k = n - 11; k > 0; k--) {
      const a = APP.wave[idx(k) * NW + 3], b = APP.wave[idx(k - 1) * NW + 3];
      if (a && !b) { trig = k; break; }
    }""", """    // trigger: the latest rising edge of the chosen net with at least 40 cycles after it (or free run)
    const mode = TRIG[capN % TRIG.length];
    let trig = n - 41, found = !mode[0];
    if (mode[0]) for (let k = n - 41; k > 0; k--) {
      const a = APP.wave[idx(k) * NW + mode[1]], b = APP.wave[idx(k - 1) * NW + mode[1]];
      if (a && !b) { trig = k; found = true; break; }
    }"""),
("""    cap = { W, cyc, tog, trig: trig - start, n: W.length };""", """    cap = { W, cyc, tog, trig: trig - start, n: W.length, mode: found ? mode[2] : 'none · free run', net: found ? mode[0] : null };"""),
# draw waveform only on new capture; IPC strip separately
("""  function drawWave(now) {
    const { ctx, w, h } = cv.wave;
    if (!cap || APP.frame % 15 === 0) capture();
    if (!cap) return;
    const s = APP.sim;
    frame(ctx, w, h, 'Logic analyzer', `triggered capture #${capN} · trigger: flush rising edge · ${cap.n} cycles · lane 0`, `trigger @ cycle ${fmt.int(cap.cyc[cap.trig])}`);""",
"""  function drawWave(now) {
    const { ctx, w, h } = cv.wave;
    const fresh = !cap || APP.frame % 15 === 0;
    if (fresh) capture();
    if (!cap) return;
    if (!fresh) { if (APP.frame % 3 === 0) drawIPC(ctx, w, h); return; }
    const s = APP.sim;
    frame(ctx, w, h, 'Logic analyzer', `capture #${capN} · trigger: ${cap.mode} · ${cap.n} cycles · lane 0`, `${cap.net ? 'trigger' : 'cursor'} @ cycle ${fmt.int(cap.cyc[cap.trig])}`);"""),
("""    label(ctx, 'T', tx + 3, RY - 1, P.down, 'left', 8);""", """    label(ctx, cap.net ? 'T' : 'C', tx + 3, RY - 1, P.down, 'left', 8);"""),
("""    // IPC history (one point per frame, last 10 s)
    const ip = APP.ipcHist.slice(-600);
    const ix0 = ZX0, ix1 = ZX1;
    ctx.strokeStyle = P.line; ctx.strokeRect(ix0 + 0.5, hy + 0.5, ix1 - ix0 - 1, hh - 1);""", """    drawIPC(ctx, w, h);
  }
  function drawIPC(ctx, w, h) {
    const s = APP.sim;
    const RY = 30, RH = 13.6, ZX0 = 736, ZX1 = w - 8;
    const ya = RY + SIGS.length * RH + 6, hy = ya + 10, hh = h - hy - 6;
    const ip = APP.ipcHist.slice(-600);
    const ix0 = ZX0, ix1 = ZX1;
    ctx.fillStyle = P.surface; ctx.fillRect(ix0, hy, ix1 - ix0, hh);
    ctx.strokeStyle = P.line; ctx.strokeRect(ix0 + 0.5, hy + 0.5, ix1 - ix0 - 1, hh - 1);"""),
# --- bus wires batched
("""      const v = pr[b.key] | 0;
      for (let bit = 0; bit < 32; bit++) {
        const y = L.rowY(bit) + 0.5, on = (v >>> bit) & 1;
        ctx.strokeStyle = on ? rgba(b.col, 0.95) : rgba(P.muted, 0.22);
        ctx.lineWidth = on ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
      }""", """      const v = pr[b.key] | 0;
      for (const onp of [0, 1]) {
        ctx.beginPath();
        for (let bit = 0; bit < 32; bit++) { if (((v >>> bit) & 1) !== onp) continue; const y = L.rowY(bit) + 0.5; ctx.moveTo(xa, y); ctx.lineTo(xb, y); }
        ctx.strokeStyle = onp ? rgba(b.col, 0.95) : rgba(P.muted, 0.22); ctx.lineWidth = onp ? 1.5 : 1; ctx.stroke();
      }"""),
# --- bottom tags placement
("""    tagOn(`write-back x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`, rfM.x + rfM.w + 30, yW, wbOn ? P.green : P.muted);
    tagOn(`pc redirect -> ${fmt.hex8(pr.exTarget)} · ${s.C.flush.toLocaleString('en-US')} flushes`, (npcM.x + bcM.x) / 2 + 120, yR, actFrac.flush > 0 ? P.red : P.muted);""",
"""    tagOn(`write-back x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`, stx.ID.x + 70, yW, wbOn ? P.green : P.muted);
    tagOn(`pc redirect -> ${fmt.hex8(pr.exTarget)} · ${s.C.flush.toLocaleString('en-US')} flushes`, stx.EX.x + 90, yR, actFrac.flush > 0 ? P.red : P.muted);"""),
# --- critical path: cached stroke, live pulse
("""    const cp = D.critical.path;
    ctx.strokeStyle = rgba(P.gold, 0.85); ctx.lineWidth = 1.25;
    ctx.beginPath();
    let first = true;
    const pts = [];
    for (const i of cp) {
      if (i < D.dffStart) continue;
      const x = L.pos[i * 2] + 1.5, y = L.pos[i * 2 + 1] + 1.5;
      pts.push([x, y]);
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.shadowColor = P.gold; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;""",
"""    const cp = D.critical.path;
    const pts = [];
    for (const i of cp) if (i >= D.dffStart) pts.push([L.pos[i * 2] + 1.5, L.pos[i * 2 + 1] + 1.5]);
    if (!cv.crit) {
      cv.crit = document.createElement('canvas'); cv.crit.width = Math.round(w * DPR); cv.crit.height = Math.round(h * DPR);
      const c2 = cv.crit.getContext('2d'); c2.setTransform(DPR, 0, 0, DPR, 0, 0);
      c2.strokeStyle = rgba(P.gold, 0.85); c2.lineWidth = 1.25; c2.beginPath();
      pts.forEach(([x, y], k) => (k ? c2.lineTo(x, y) : c2.moveTo(x, y)));
      c2.shadowColor = P.gold; c2.shadowBlur = 6; c2.stroke(); c2.shadowBlur = 0;
      c2.fillStyle = P.gold; for (const [x, y] of pts) c2.fillRect(x - 1, y - 1, 2, 2);
    }
    ctx.drawImage(cv.crit, 0, 0, w, h);"""),
])
print('ok')

import sys, re
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:100]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

# ---------------- panels.js: overlay replacement ----------------
p='panels.js'
s=open(p,encoding='utf-8').read()
a=s.index("  function drawFloorOverlay(now) {")
b=s.index("  function drawTicks() {")
s=s[:a]+open('dev/overlay_new.js',encoding='utf-8').read()+s[b:]
open(p,'w',encoding='utf-8').write(s)

patch('panels.js', [
# module names avoid the critical path line
("""    const ny = L.dpY + L.dpH + 20.5;
    let lastEnd = -1e9;
    for (const m of L.mods) {
      const nm = L.SHORT[m.path];
      if (!nm || m.preg) continue;
      const tw = ctx.measureText(nm).width;
      let cx = m.x + m.w / 2;
      if (tw > m.w + 10) continue;
      if (cx - tw / 2 < lastEnd + 4) continue;
      text(ctx, nm, cx, ny, F.mono(8.5), P.muted, 'center');
      lastEnd = cx + tw / 2;
    }""",
"""    const ny = L.dpY + L.dpH + 20.5;
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
    }"""),
])

# ---------------- main.js ----------------
patch('main.js', [
# 1 s window of toggles (per module), snapshot read by every panel
("""    for (let k = 0; k < MT.length; k++) { MT[k] /= n; APP.modTog[k] = APP.modTog[k] ? APP.modTog[k] * 0.92 + MT[k] * 0.08 : MT[k]; }""",
 """    const W = APP.win;
    const raw = MT.slice();
    W.slots.push({ n, tot, raw }); W.n += n; W.tot += tot;
    for (let k = 0; k < raw.length; k++) W.mod[k] += raw[k];
    if (W.slots.length > 60) { const o = W.slots.shift(); W.n -= o.n; W.tot -= o.tot; for (let k = 0; k < o.raw.length; k++) W.mod[k] -= o.raw[k]; }
    for (let k = 0; k < MT.length; k++) { MT[k] /= n; APP.modTog[k] = APP.modTog[k] ? APP.modTog[k] * 0.92 + MT[k] * 0.08 : MT[k]; }"""),
("""    APP.modTog = new Float64Array(M); APP.modTogNow = new Float64Array(M);""",
 """    APP.modTog = new Float64Array(M); APP.modTogNow = new Float64Array(M);
    APP.win = { slots: [], n: 0, tot: 0, mod: new Float64Array(M) };
    APP.snap = { tog: 0, mod: new Float64Array(M) };"""),
("""    const k = APP.cfg.decay;
    const ht = APP.heat;""",
 """    // shared 1 s statistics, refreshed 4x per second; every panel that shows them redraws on that same frame
    if (APP.win.n && (APP.frame % 15 === 0 || !APP.snap.tog)) APP.snap = { tog: APP.win.tot / APP.win.n, mod: APP.win.mod.map((v) => v / APP.win.n), frame: APP.frame };
    const k = APP.cfg.decay;
    const ht = APP.heat;"""),
# staggered fault workers, keep the previous batch for display
("""      if (w.id >= APP.cfg.workers || !w.ready || w.busy) continue;""",
 """      if (w.id >= APP.cfg.workers || !w.ready || w.busy) continue;
      if (APP.frame < w.id * 11) continue; // staggered starts so the six batches are spread across the 64-frame test"""),
("""      if (!w.batch || w.batch.done) {
        const f = nextFaults();
        if (!f.length) continue;""",
 """      if (!w.batch || w.batch.done) {
        const f = nextFaults();
        if (!f.length) continue;
        if (w.batch) w.prev = w.batch;"""),
("""      else if (m.type === 'work') faultReply(w, m);""",
 """      else if (m.type === 'work') { faultReply(w, m); w.ms = w.ms ? w.ms * 0.9 + m.workMs * 0.1 : m.workMs; }"""),
])

patch('fault-worker.js', [
("""  if (msg.batch) start(msg.batch);
  const b = batch;""", """  const t0 = performance.now();
  if (msg.batch) start(msg.batch);
  const b = batch;"""),
("""  postMessage({ type: 'work', id: msg.id, batchId: b.id, cyc: b.cyc, len: b.len, det: b.det, detCyc: Array.from(b.detCyc), done, n: b.faults.length });""",
 """  postMessage({ type: 'work', id: msg.id, batchId: b.id, cyc: b.cyc, len: b.len, det: b.det, detCyc: Array.from(b.detCyc), done, n: b.faults.length, workMs: performance.now() - t0 });"""),
])
print('ok')

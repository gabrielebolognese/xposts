import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

# golden: reuse one result object
patch('golden.js', [
("      this.n = 0;\n    }", "      this.n = 0;\n      this.res = { pc: 0, ir: 0, rd: 0, wdata: 0, st: null };\n      this.stRec = { addr: 0, be: 0, data: 0 };\n    }"),
("""          const sh = 8 * (ad & 3);
          const be = (((1 << nb) - 1) << (ad & 3)) & 15;
          st = { addr: ad, be, data: nb === 4 ? b : (b << sh) | 0 };""",
"""          const sh = 8 * (ad & 3);
          st = this.stRec;
          st.addr = ad; st.be = (((1 << nb) - 1) << (ad & 3)) & 15; st.data = nb === 4 ? b : (b << sh) | 0;"""),
("""      return { pc, ir: w, rd: wr ? rd : 0, wdata: v, st };""",
"""      const r = this.res;
      r.pc = pc; r.ir = w; r.rd = wr ? rd : 0; r.wdata = v; r.st = st;
      return r;"""),
])

# sim worker: retire ring instead of per-retire arrays, compute time
patch('sim-worker.js', [
("let trace = [], uartNew = [], regLast = new Float64Array(32);",
 "const TR = 40, trRing = new Float64Array(TR * 9);\nlet trHead = 0, trCount = 0, uartNew = [], regLast = new Float64Array(32);"),
("""      trace.push([cyc, pc, ir, rdn, wd, ok, lastStore ? lastStore.addr : 0, lastStore ? lastStore.data : 0, lastStore ? 1 : 0]);
      if (trace.length > 40) trace.shift();""",
"""      const o9 = trHead * 9;
      trRing[o9] = cyc; trRing[o9 + 1] = pc; trRing[o9 + 2] = ir; trRing[o9 + 3] = rdn; trRing[o9 + 4] = wd; trRing[o9 + 5] = ok;
      trRing[o9 + 6] = lastStore ? lastStore.addr : 0; trRing[o9 + 7] = lastStore ? lastStore.data : 0; trRing[o9 + 8] = lastStore ? 1 : 0;
      trHead = (trHead + 1) % TR; if (trCount < TR) trCount++;"""),
("""  const n = msg.cycles;
  const NW = 15;""", """  const n = msg.cycles;
  const t0 = performance.now();
  const NW = 15;"""),
("""  const h = heat.slice();""", """  const trace = [];
  for (let k = Math.max(0, trCount - 26); k < trCount; k++) {
    const o9 = ((trHead - trCount + k + TR) % TR) * 9;
    trace.push([trRing[o9], trRing[o9 + 1] | 0, trRing[o9 + 2] | 0, trRing[o9 + 3], trRing[o9 + 4] | 0, trRing[o9 + 5], trRing[o9 + 6] | 0, trRing[o9 + 7] | 0, trRing[o9 + 8]]);
  }
  const h = heat.slice();"""),
("""trace: trace.slice(-26), uart: uartNew,""", """trace, uart: uartNew, workMs: performance.now() - t0,"""),
])

# main: carry skipped frames into the next request (live mode only ever skips), worker time history
patch('main.js', [
("""    if (APP.simReady && !APP.simBusy) {
      const cycles = APP.prewarm ? PREWARM_CHUNK : Math.max(1, Math.round(APP.cfg.clockHz / 60));""",
"""    APP.owed = Math.min(3, (APP.owed || 0) + 1);
    if (APP.simReady && !APP.simBusy) {
      const cycles = APP.prewarm ? PREWARM_CHUNK : Math.max(1, Math.round((APP.cfg.clockHz / 60) * APP.owed));
      APP.owed = 0;"""),
("""    APP.sim = m;""", """    APP.sim = m;
    APP.workMs = APP.workMs ? APP.workMs * 0.9 + m.workMs * 0.1 : m.workMs;"""),
])
print('ok')

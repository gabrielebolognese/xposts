// Every Gate: a stuck-at fault worker. Lane 0 of every 32-bit net is the good machine, lanes 1..31 each carry one
// fault from the batch. Primary outputs are compared against lane 0 every cycle; a lane that differs is detected
// (its cycle recorded) and dropped. Memory read data comes from lane 0 and is broadcast to all lanes.
importScripts('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js');

let M = null, D = null, batch = null, cfg = { fwd: 1, btfn: 1 };

function init(msg) {
  Object.assign(cfg, msg.cfg || {});
  const prog = PROG.build({ maxit: msg.maxit || 32, zoom: msg.zoom || 2 });
  const S = SIM.setup();
  D = S.D;
  M = new SIM.FaultMachine(D, S.chunks, prog);
  postMessage({ type: 'ready', id: msg.id });
}

function start(b) {
  batch = { id: b.id, faults: b.faults, len: b.len, cyc: 0, det: 0, detCyc: new Int32Array(32).fill(-1) };
  M.cfgFwd = b.fwd; M.cfgBtfn = b.btfn;
  M.setFaults(b.faults.map((f, i) => ({ net: f[0], sa: f[1], lane: i + 1 })));
}

function work(msg) {
  const t0 = performance.now();
  if (msg.batch) start(msg.batch);
  const b = batch;
  const all = b.faults.length >= 31 ? -2 : ((1 << (b.faults.length + 1)) - 2);
  let left = msg.budget, done = false;
  while (left-- > 0) {
    M.evalCycle();
    const d = M.cmp() & all & ~b.det;
    if (d) {
      for (let l = 1; l < 32; l++) if ((d >>> l) & 1) b.detCyc[l] = b.cyc;
      b.det |= d;
    }
    M.commit();
    M.cyc++;
    b.cyc++;
    if (b.cyc >= b.len || (b.det & all) === all) { done = true; break; }
  }
  postMessage({ type: 'work', id: msg.id, batchId: b.id, cyc: b.cyc, len: b.len, det: b.det, detCyc: Array.from(b.detCyc), done, n: b.faults.length, workMs: performance.now() - t0 });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m);
  else if (m.type === 'work') work(m);
};

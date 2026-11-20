// Every Gate: the main simulation worker. Builds and compiles the netlist, runs the gate-level core for the number of
// cycles the page asks for (one request per animation frame), checks every retired instruction against the golden
// model, counts per-gate toggles (exact, every cycle) and samples the nets the page shows.
importScripts('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js', 'wasmtog.js', 'selftest.js');

let S, D, M, gold, prog, R, cfg = { fwd: 1, btfn: 1, lockstep: 1, maxit: 32, zoom: 2 };
let tog, wcur, wprev, heat, heatSnap, sCells, n4;
let instret = 0, div = 0, firstDiv = null, lastStore = null, checked = 0;
const C = { stall: 0, loadUse: 0, rawStall: 0, flush: 0, idRedir: 0, br: 0, misp: 0, fwdXM: 0, fwdMW: 0, jal: 0, jalr: 0, loads: 0, stores: 0, muls: 0 };
const TR = 40, trRing = new Float64Array(TR * 9);
let trHead = 0, trCount = 0, uartNew = [], regLast = new Float64Array(32);
// shadow instance ids for the pipeline diagram (they follow the hardware's own stall/flush nets)
let nextId = 1, idIF = 0, idID = 0, idEX = 0, idMEM = 0, idWB = 0, sqID = 0;
const PIPE_N = 16;
let pipeRing = [];
// per-cycle sample slots
const F = { pc: 0, ir: 1, stall: 2, exR: 3, idR: 4, isBrID: 5, fA1: 6, fA2: 7, fB1: 8, fB2: 9, alu: 10, mulHi: 11, addr: 12, we: 13, rwe: 14, rrd: 15, rwd: 16, ret: 17,
  memR: 18, vEX: 19, isBrEX: 20, misp: 21, isJalrEX: 22, isJalID: 23, loadUse: 24, rpc: 25, vID: 26, vMEM: 27, vWB: 28, pcID: 29, pcEX: 30, pcMEM: 31, pcWB: 32 };
const fl = new Int32Array(34);

const busExpr = (nets) => Array.from(nets, (x, i) => (i === 0 ? `(s[${x}]&1)` : `((s[${x}]&1)<<${i})`)).join('|') || '0';
function reader(nets, s) { return new Function('s', `"use strict";return function(){return ${busExpr(nets)};}`)(s); }

function init(msg) {
  const tInit = performance.now();
  Object.assign(cfg, msg.cfg || {});
  prog = PROG.build({ maxit: cfg.maxit, zoom: cfg.zoom });
  S = SIM.setup();
  D = S.D;
  M = new SIM.Machine(D, S.chunks, prog);
  // randomized ISA self-test on the same compiled netlist, before the Mandelbrot starts
  const tST = performance.now();
  const st = { programs: 0, passed: 0, retired: 0, div: 0, cycles: 0, classes: new Array(12).fill(0) };
  for (let k = 0; k < 16; k++) {
    const r = SELFTEST.run(M, D, 1000 + k * 7919, 700, k % 3 === 2 ? 0 : 1, k % 2, 8000);
    st.programs++; if (!r.div) st.passed++;
    st.retired += r.ret; st.div += r.div; st.cycles += r.cyc;
    r.classes.forEach((v, i) => (st.classes[i] += v));
  }
  st.ms = performance.now() - tST;
  M.prog = prog; M.reset();
  M.cfgFwd = cfg.fwd; M.cfgBtfn = cfg.btfn;
  gold = new Golden(prog.rom, prog.ram);
  const s = M.s, P = D.probes, O = D.outs, Tr = D.trace;
  // toggle pass: WebAssembly SIMD over a copy of the cell nets (JS fallback)
  n4 = (D.n + 3) & ~3;
  heatSnap = new Int32Array(D.n);
  sCells = s.subarray(D.dffStart);
  try {
    const pages = Math.ceil((n4 * 12) / 65536) + 1;
    const mem = new WebAssembly.Memory({ initial: pages });
    const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmTogModule(pages)), { env: { mem } });
    wcur = new Int32Array(mem.buffer, D.dffStart * 4, D.n - D.dffStart);
    wprev = new Int32Array(mem.buffer, n4 * 4, D.n);
    heat = new Int32Array(mem.buffer, n4 * 8, D.n);
    const t = inst.exports.tog, a = n4 * 4, b = n4 * 8;
    tog = () => { wcur.set(sCells); return t(0, a, a, b); };
  } catch (e) {
    wprev = new Int32Array(D.n); heat = new Int32Array(D.n);
    tog = new Function('s', 'p', 'h', `"use strict";return function(){let t=0;for(let i=${D.dffStart};i<${D.n};i++){const v=s[i],d=v^p[i];p[i]=v;h[i]-=d;t-=d;}return t;}`)(s, wprev, heat);
  }
  // one compiled sampler for everything read every cycle
  const nets = {
    pc: O.imem_addr, ir: D.ins.imem_rdata, stall: P.stall, exR: P.exRedir, idR: P.idRedir, isBrID: P.isBrID, fA1: P.fA1, fA2: P.fA2, fB1: P.fB1, fB2: P.fB2,
    alu: P.aluOut, mulHi: P.mulHi, addr: O.dmem_addr, we: O.dmem_we, rwe: Tr.retire_we, rrd: Tr.retire_rd, rwd: Tr.retire_wdata, ret: O.retire_valid, memR: P.memR,
    vEX: P.vEX, isBrEX: P.isBrEX, misp: P.mispred, isJalrEX: P.isJalrEX, isJalID: P.isJalID, loadUse: P.loadUse, rpc: Tr.retire_pc, vID: P.vID, vMEM: P.vMEM, vWB: P.vWB,
    pcID: P.pcID, pcEX: P.pcEX, pcMEM: P.pcMEM, pcWB: P.pcWB,
  };
  const src = Object.keys(F).map((k) => `f[${F[k]}]=${busExpr(nets[k])};`).join('');
  R = { sample: new Function('s', 'f', `"use strict";return function(){${src}}`)(s, fl) };
  for (const k of ['exRes', 'irID', 'mulA', 'mulB', 'rs1vID', 'immID', 'ldv', 'exTarget', 'idTarget', 'dxRs1v', 'dxImm']) R[k] = reader(P[k], s);
  R.wdata = reader(O.dmem_wdata, s); R.be = reader(O.dmem_be, s);
  R.rf = P.rf.map((x) => reader(x, s));
  st.initMs = performance.now() - tInit;
  postMessage({ type: 'ready', nWords: prog.nWords, selftest: st });
}

function applyCfg(c) {
  if (!c) return;
  if (c.fwd !== undefined) { cfg.fwd = c.fwd; M.cfgFwd = c.fwd; }
  if (c.btfn !== undefined) { cfg.btfn = c.btfn; M.cfgBtfn = c.btfn; }
  if (c.lockstep !== undefined) cfg.lockstep = c.lockstep;
  // program parameters live in data RAM: write both the gate-level core's RAM and the golden model's RAM
  const poke = (off, v) => { const a = PROG.PARAM.base + off - 0x10000; for (let k = 0; k < 4; k++) { M.ram[a + k] = v >>> (8 * k); gold.ram[a + k] = v >>> (8 * k); } };
  if (c.maxit !== undefined && c.maxit !== cfg.maxit) { cfg.maxit = c.maxit; poke(PROG.PARAM.MAXIT, c.maxit); }
  if (c.zoom !== undefined && c.zoom !== cfg.zoom) { cfg.zoom = c.zoom; poke(PROG.PARAM.IZ, Math.round(PROG.Q / c.zoom)); }
}

function run(msg) {
  applyCfg(msg.cfg);
  const n = msg.cycles;
  const t0 = performance.now();
  const NW = 15;
  const wave = new Int32Array(n * NW), togCyc = new Int32Array(n), retCyc = new Uint8Array(n);
  heat.fill(0);
  const s = M.s;
  const frames = [];
  let deepest = 0;
  const sample = R.sample;
  for (let c = 0; c < n; c++) {
    M.evalCycle();
    if (c === n - 1) { for (let i = D.n - 1; i >= D.gateStart; i--) if ((s[i] ^ wprev[i]) & 1) { deepest = D.level[i]; break; } }
    if (c === Math.max(0, n - 2)) heatSnap.set(heat);
    togCyc[c] = tog();
    sample();
    const stall = fl[2], exR = fl[3], idR = fl[4], ret = fl[17];
    retCyc[c] = ret;
    // waveform sample (lane 0)
    const o = c * NW;
    wave[o] = fl[0]; wave[o + 1] = fl[1]; wave[o + 2] = stall; wave[o + 3] = exR; wave[o + 4] = idR & fl[5];
    wave[o + 5] = fl[6] | (fl[7] << 1); wave[o + 6] = fl[8] | (fl[9] << 1); wave[o + 7] = fl[10]; wave[o + 8] = fl[11];
    wave[o + 9] = fl[12]; wave[o + 10] = fl[13]; wave[o + 11] = fl[14] ? fl[15] : 0; wave[o + 12] = fl[16]; wave[o + 13] = ret; wave[o + 14] = fl[18];
    // performance counters, from pipeline nets
    if (stall && !exR) { C.stall++; if (fl[24]) C.loadUse++; else C.rawStall++; }
    if (exR) C.flush++;
    if (idR && !exR) { C.idRedir++; if (fl[23]) C.jal++; }
    if (fl[19]) {
      if (fl[20]) { C.br++; if (fl[21]) C.misp++; }
      if (fl[22]) C.jalr++;
      C.fwdXM += fl[6] + fl[8];
      C.fwdMW += fl[7] + fl[9];
    }
    const cyc = M.cyc;
    if (n - c <= PIPE_N) {
      pipeRing.push([cyc, idIF, fl[26] ? idID : 0, fl[19] ? idEX : 0, fl[27] ? idMEM : 0, fl[28] ? idWB : 0, fl[0], fl[29], fl[30], fl[31], fl[32],
        stall | (exR << 1) | (idR << 2), sqID]);
      if (pipeRing.length > PIPE_N) pipeRing.shift();
    }
    // golden lockstep at retirement
    if (ret) {
      instret++;
      const pc = fl[25], we = fl[14], rdn = we ? fl[15] : 0, wd = we ? fl[16] : 0;
      let ok = 1;
      const g = gold.step(); // the golden model always steps, so turning the check back on stays in sync
      if (cfg.lockstep) {
        checked++;
        let bad = g.pc !== pc || g.rd !== rdn || (g.rd !== 0 && g.wdata !== wd);
        if (g.st) {
          if (!lastStore || lastStore.addr !== g.st.addr || lastStore.be !== g.st.be) bad = true;
          else { let m = 0; for (let k = 0; k < 4; k++) if ((g.st.be >> k) & 1) m |= 0xff << (8 * k); if (((lastStore.data ^ g.st.data) & m) !== 0) bad = true; }
        } else if (lastStore) bad = true;
        if (bad) {
          div++; ok = 0;
          if (!firstDiv) firstDiv = { cyc, core: { pc, rd: rdn, wdata: wd, st: lastStore }, gold: { pc: g.pc, rd: g.rd, wdata: g.wdata, st: g.st && Object.assign({}, g.st) } };
        }
      }
      const ir = prog.rom[(pc >>> 2) & 0xfff];
      const opc = ir & 0x7f;
      if (opc === 0x03) C.loads++; else if (opc === 0x23) C.stores++; else if (opc === 0x33 && (ir >>> 25) & 1) C.muls++;
      if (rdn) regLast[rdn] = cyc;
      const o9 = trHead * 9;
      trRing[o9] = cyc; trRing[o9 + 1] = pc; trRing[o9 + 2] = ir; trRing[o9 + 3] = rdn; trRing[o9 + 4] = wd; trRing[o9 + 5] = ok;
      trRing[o9 + 6] = lastStore ? lastStore.addr : 0; trRing[o9 + 7] = lastStore ? lastStore.data : 0; trRing[o9 + 8] = lastStore ? 1 : 0;
      trHead = (trHead + 1) % TR; if (trCount < TR) trCount++;
    }
    const st = M.commit();
    if (st && st.addr >>> 2 === 0x20000000 >>> 2) uartNew.push(st.data & 0xff);
    if (st && st.addr === PROG.PARAM.base + PROG.PARAM.FRAME) frames.push({ f: st.data, cyc, fb: M.ram.slice(PROG.FB - 0x10000, PROG.FB - 0x10000 + PROG.VIEW.W * PROG.VIEW.H) });
    lastStore = st;
    // shadow ids advance at the edge, with the hardware's own stall/redirect values
    idWB = idMEM; idMEM = idEX;
    idEX = stall || exR ? 0 : idID;
    sqID = exR ? idID : 0;
    if (exR || idR) idID = 0; else if (!stall) idID = idIF;
    if (!stall || exR) idIF = nextId++;
    M.cyc++;
  }
  const workMs = performance.now() - t0;
  const regs = new Int32Array(32);
  for (let r = 1; r < 32; r++) regs[r] = R.rf[r - 1]();
  const pipeRegs = { pcID: fl[29], irID: R.irID(), vID: fl[26], pcEX: fl[30], vEX: fl[19], pcMEM: fl[31], vMEM: fl[27], pcWB: fl[32], vWB: fl[28],
    exRes: R.exRes(), addr: fl[12], wdata: R.wdata(), be: R.be(), we: fl[13], rwd: fl[16], rwe: fl[14], rrd: fl[15], mulA: R.mulA(), mulB: R.mulB(), mulHi: fl[11], aluOut: fl[10],
    rs1vID: R.rs1vID(), immID: R.immID(), ldv: R.ldv(), exTarget: R.exTarget(), idTarget: R.idTarget(), dxRs1v: R.dxRs1v(), dxImm: R.dxImm(), pcIF: fl[0], irIF: fl[1],
    stall: fl[2], exRedir: fl[3], idRedir: fl[4], fA: fl[6] | (fl[7] << 1), fB: fl[8] | (fl[9] << 1) };
  const fb = M.ram.slice(PROG.FB - 0x10000, PROG.FB - 0x10000 + PROG.VIEW.W * PROG.VIEW.H);
  const params = new Int32Array(M.ram.buffer, PROG.PARAM.base - 0x10000, 8).slice();
  const trace = [];
  for (let k = Math.max(0, trCount - 26); k < trCount; k++) {
    const o9 = ((trHead - trCount + k + TR) % TR) * 9;
    trace.push([trRing[o9], trRing[o9 + 1] | 0, trRing[o9 + 2] | 0, trRing[o9 + 3], trRing[o9 + 4] | 0, trRing[o9 + 5], trRing[o9 + 6] | 0, trRing[o9 + 7] | 0, trRing[o9 + 8]]);
  }
  const h = new Uint16Array(heat);
  const recent = new Uint8Array(D.n);
  for (let i = D.dffStart; i < D.n; i++) recent[i] = heat[i] - heatSnap[i];
  const out = {
    type: 'run', cyc: M.cyc, n, instret, div, firstDiv, checked, C: Object.assign({}, C), wave, togCyc, retCyc, heat: h, regs,
    regLast: regLast.slice(), pipe: pipeRing.map((r) => r.slice()), pipeRegs, trace, uart: uartNew, workMs, fb, params, deepest, frames, recent,
  };
  uartNew = [];
  postMessage(out, [wave.buffer, togCyc.buffer, retCyc.buffer, h.buffer, recent.buffer]);
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') init(m);
  else if (m.type === 'run') run(m);
};

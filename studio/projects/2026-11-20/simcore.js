// Every Gate: the testbench around the compiled netlist. One clock cycle:
//  (a) rising edge: every DFF Q <- D (gathered from the previous evaluation), memory writes already committed
//  (b) drive the memory read ports from flop outputs: imem[PC.Q], dmem[EXMEM.addr.Q]
//  (c) evaluate every gate in level order (straight-line compiled functions, 32 machines per Int32 word)
//  (d) read the buses: commit the memory write, check the retired instruction against the golden model
// The compiled functions close over one fixed Int32Array, so V8 knows its length and drops the bounds checks.
(function (G) {
  'use strict';

  function rd(s, nets) { let v = 0; for (let i = 0; i < nets.length; i++) v |= (s[nets[i]] & 1) << i; return v; }

  function compileBound(chunks, s) {
    return chunks.map((c) => new Function('s', '"use strict";return function(){' + c.src + '}')(s));
  }

  class Machine {
    constructor(D, chunks, prog) {
      this.D = D; this.prog = prog;
      this.s = new Int32Array(D.n);
      this.nx = new Int32Array(D.nDff);
      this.fns = compileBound(chunks, this.s);
      this.chunkLevels = chunks.map((c) => c.level);
      this.ram = new Uint8Array(65536); this.ram32 = new Int32Array(this.ram.buffer);
      this.in = D.ins; this.out = D.outs; this.tr = D.trace; this.pr = D.probes;
      this.cfgFwd = 1; this.cfgBtfn = 1;
      this.reset();
    }
    reset() {
      this.s.fill(0); this.s[1] = -1;
      this.ram.set(this.prog.ram);
      this.cyc = 0;
      this.uart = [];
    }
    ramRead(a) { return a >>> 16 === 1 ? this.ram32[(a >>> 2) & 0x3fff] : 0; }
    drive(nets, v) { const s = this.s; for (let i = 0; i < nets.length; i++) s[nets[i]] = -((v >>> i) & 1); }
    edgeAndInputs() {
      const D = this.D, s = this.s, nx = this.nx, dI = D.dIdx;
      if (this.cyc > 0) { for (let k = 0; k < nx.length; k++) nx[k] = s[dI[k]]; s.set(nx, D.dffStart); }
      this.afterEdge(s);
      s[this.in.rst[0]] = this.cyc === 0 ? -1 : 0;
      s[this.in.cfg_fwd[0]] = -this.cfgFwd;
      s[this.in.cfg_btfn[0]] = -this.cfgBtfn;
      const pc = rd(s, this.out.imem_addr);
      this.drive(this.in.imem_rdata, this.prog.rom[(pc >>> 2) & 0xfff]);
      this.drive(this.in.dmem_rdata, this.ramRead(rd(s, this.out.dmem_addr)));
    }
    afterEdge() {}
    evalCycle() {
      this.edgeAndInputs();
      const f = this.fns;
      for (let k = 0; k < f.length; k++) f[k]();
      return this.s;
    }
    // memory write port (lane 0): returns the store seen on the bus, or null
    commit() {
      const s = this.s;
      if (!(s[this.out.dmem_we[0]] & 1)) return null;
      const a = rd(s, this.out.dmem_addr), be = rd(s, this.out.dmem_be), d = rd(s, this.out.dmem_wdata);
      if (a >>> 16 === 1) { const base = a & 0xfffc; for (let k = 0; k < 4; k++) if ((be >> k) & 1) this.ram[base + k] = d >>> (8 * k); }
      else if (a >>> 2 === 0x20000000 >>> 2) { for (let k = 0; k < 4; k++) if ((be >> k) & 1) { this.uart.push((d >>> (8 * k)) & 0xff); break; } }
      return { addr: a, be, data: d };
    }
  }

  // Parallel-fault machine: lane 0 is the good machine, lanes 1..31 each carry one stuck-at fault.
  // Faulted nets are forced right after their level is evaluated: s[g] = (s[g] & andMask) | orMask.
  class FaultMachine extends Machine {
    constructor(D, chunks, prog) {
      super(D, chunks, prog);
      this.force = Array.from({ length: D.maxLevel + 1 }, () => []);
      const po = [].concat(...['imem_addr', 'dmem_addr', 'dmem_wdata', 'dmem_be', 'dmem_we', 'retire_valid'].map((k) => Array.from(D.outs[k])));
      this.poNets = Int32Array.from(po);
      const src = ['"use strict";return function(){let d=0,x;'];
      for (const n of po) src.push(`x=s[${n}];d|=x^((x<<31)>>31);`);
      src.push('return d;}');
      this.cmp = new Function('s', src.join(''))(this.s);
      // after the last chunk of each level, apply that level's forcing list
      this.levelEnd = this.chunkLevels.map((L, k) => (k + 1 === this.chunkLevels.length || this.chunkLevels[k + 1] !== L ? L : -1));
    }
    setFaults(list) { // [{net, sa, lane}]
      for (const f of this.force) f.length = 0;
      const by = new Map();
      for (const f of list) {
        let e = by.get(f.net);
        if (!e) { e = { net: f.net, and: -1, or: 0 }; by.set(f.net, e); }
        const bit = 1 << f.lane;
        if (f.sa) e.or |= bit; else e.and &= ~bit;
      }
      for (const e of by.values()) this.force[this.D.level[e.net]].push(e);
      this.reset();
    }
    applyForce(L) { const fl = this.force[L], s = this.s; for (let i = 0; i < fl.length; i++) { const e = fl[i]; s[e.net] = (s[e.net] & e.and) | e.or; } }
    afterEdge() { this.applyForce(0); }
    evalCycle() {
      this.edgeAndInputs();
      const f = this.fns, le = this.levelEnd;
      for (let k = 0; k < f.length; k++) { f[k](); if (le[k] >= 0 && this.force[le[k]].length) this.applyForce(le[k]); }
      return this.s;
    }
  }

  function setup() {
    const N = G.HDL.buildCore();
    const D = G.HDL.finalize(N);
    const chunks = G.HDL.emitChunks(D, 560);
    return { D, chunks };
  }

  G.SIM = { Machine, FaultMachine, setup, rd };
})(typeof self !== 'undefined' ? self : globalThis);

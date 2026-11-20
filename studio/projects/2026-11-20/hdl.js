// Every Gate: the hardware. A tiny HDL in JS: gate() constructors with constant folding and structural hashing,
// bus helpers (adderKS, mux trees, decoders, registers) and the whole RV32I+MUL/MULH 5-stage pipeline built from
// NOT/AND2/OR2/NAND2/NOR2/XOR2/XNOR2/MUX2 cells and positive-edge DFFs. finalize() sweeps dead logic, levelizes,
// renumbers nets in level order and emits the straight-line evaluation code (one function per level slice).
(function (G) {
  'use strict';
  const T = { C0: 0, C1: 1, IN: 2, DFF: 3, NOT: 4, AND: 5, OR: 6, NAND: 7, NOR: 8, XOR: 9, XNOR: 10, MUX: 11 };
  const TNAME = ['C0', 'C1', 'IN', 'DFF', 'INV', 'AND2', 'OR2', 'NAND2', 'NOR2', 'XOR2', 'XNOR2', 'MUX2'];
  // NAND2-equivalent area per cell (DFF: 5.0, a typical scan-less D flip-flop)
  const NAND_EQ = [0, 0, 0, 5.0, 0.67, 1.33, 1.33, 1, 1, 2, 2, 2.33];

  class NL {
    constructor() {
      this.t = [T.C0, T.C1]; this.a = [0, 0]; this.b = [0, 0]; this.c = [0, 0]; this.m = [0, 0]; this.bit = [-1, -1];
      this.h = new Map();
      this.mods = [{ name: 'core', path: 'core', parent: -1, depth: 0 }];
      this.modIdx = new Map([['core', 0]]);
      this.cur = 0; this.stack = []; this.curBit = -1;
      this.ins = {}; this.outs = {}; this.trace = {}; this.probes = {};
    }
    push(name) {
      const path = this.mods[this.cur].path + '/' + name;
      let id = this.modIdx.get(path);
      if (id === undefined) {
        id = this.mods.length;
        this.mods.push({ name, path, parent: this.cur, depth: this.mods[this.cur].depth + 1 });
        this.modIdx.set(path, id);
      }
      this.stack.push(this.cur);
      this.cur = id;
      this.curBit = -1;
    }
    pop() { this.cur = this.stack.pop(); this.curBit = -1; }
    raw(t, a, b, c) {
      const id = this.t.length;
      this.t.push(t); this.a.push(a); this.b.push(b); this.c.push(c); this.m.push(this.cur); this.bit.push(this.curBit);
      return id;
    }
    hashed(t, a, b, c) {
      const k = t + ',' + a + ',' + b + ',' + c;
      let id = this.h.get(k);
      if (id === undefined) { id = this.raw(t, a, b, c); this.h.set(k, id); }
      return id;
    }
    input(name, n) {
      const v = [];
      for (let i = 0; i < n; i++) { this.curBit = i; v.push(this.raw(T.IN, 0, 0, 0)); }
      this.curBit = -1;
      this.ins[name] = v;
      return v;
    }
    isNot(x, y) { return this.t[x] === T.NOT && this.a[x] === y; }
    compl(x, y) { return this.isNot(x, y) || this.isNot(y, x); }
    // ---- primitive cells with constant folding ----
    NOT(x) {
      if (x === 0) return 1; if (x === 1) return 0;
      if (this.t[x] === T.NOT) return this.a[x];
      return this.hashed(T.NOT, x, 0, 0);
    }
    AND(x, y) {
      if (x === 0 || y === 0) return 0; if (x === 1) return y; if (y === 1) return x; if (x === y) return x;
      if (this.compl(x, y)) return 0;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.AND, x, y, 0);
    }
    OR(x, y) {
      if (x === 1 || y === 1) return 1; if (x === 0) return y; if (y === 0) return x; if (x === y) return x;
      if (this.compl(x, y)) return 1;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.OR, x, y, 0);
    }
    NAND(x, y) {
      if (x === 0 || y === 0) return 1; if (x === 1) return this.NOT(y); if (y === 1) return this.NOT(x);
      if (x === y) return this.NOT(x);
      if (this.compl(x, y)) return 1;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.NAND, x, y, 0);
    }
    NOR(x, y) {
      if (x === 1 || y === 1) return 0; if (x === 0) return this.NOT(y); if (y === 0) return this.NOT(x);
      if (x === y) return this.NOT(x);
      if (this.compl(x, y)) return 0;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.NOR, x, y, 0);
    }
    XOR(x, y) {
      if (x === 0) return y; if (y === 0) return x; if (x === 1) return this.NOT(y); if (y === 1) return this.NOT(x);
      if (x === y) return 0;
      if (this.compl(x, y)) return 1;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.XOR, x, y, 0);
    }
    XNOR(x, y) {
      if (x === 0) return this.NOT(y); if (y === 0) return this.NOT(x); if (x === 1) return y; if (y === 1) return x;
      if (x === y) return 1;
      if (this.compl(x, y)) return 0;
      if (x > y) { const t = x; x = y; y = t; }
      return this.hashed(T.XNOR, x, y, 0);
    }
    // s ? b : a
    MUX(a, b, s) {
      if (s === 0) return a; if (s === 1) return b; if (a === b) return a;
      if (a === 0 && b === 1) return s; if (a === 1 && b === 0) return this.NOT(s);
      if (a === 0) return this.AND(b, s);
      if (b === 0) return this.AND(a, this.NOT(s));
      if (a === 1) return this.OR(b, this.NOT(s));
      if (b === 1) return this.OR(a, s);
      if (this.t[s] === T.NOT) return this.MUX(b, a, this.a[s]);
      return this.hashed(T.MUX, a, b, s);
    }
    dff() { return this.raw(T.DFF, -1, 0, 0); }
    // ---- bus helpers ----
    reg(n) { const v = []; for (let i = 0; i < n; i++) { this.curBit = i; v.push(this.dff()); } this.curBit = -1; return v; }
    reg1() { return this.dff(); }
    // D input for register q: rst ? rstv : (en ? d : q)
    connect(q, d, en, nrst, rstv) {
      for (let i = 0; i < q.length; i++) {
        this.curBit = i;
        let v = en === 1 ? d[i] : this.MUX(q[i], d[i], en);
        if (nrst !== undefined && nrst !== null) v = rstv ? this.OR(v, this.NOT(nrst)) : this.AND(v, nrst);
        if (this.a[q[i]] !== -1) throw new Error('DFF connected twice');
        this.a[q[i]] = v;
      }
      this.curBit = -1;
    }
    constBus(n, k) { const v = []; for (let i = 0; i < n; i++) v.push((k >>> i) & 1 ? 1 : 0); return v; }
    muxv(A, B, s) { return A.map((x, i) => { this.curBit = i; return this.MUX(x, B[i], s); }); }
    andv(A, B) { return A.map((x, i) => { this.curBit = i; return this.AND(x, B[i]); }); }
    orv(A, B) { return A.map((x, i) => { this.curBit = i; return this.OR(x, B[i]); }); }
    xorv(A, B) { return A.map((x, i) => { this.curBit = i; return this.XOR(x, B[i]); }); }
    andTree(list) {
      if (!list.length) return 1;
      let v = list.slice();
      while (v.length > 1) { const n = []; for (let i = 0; i < v.length; i += 2) n.push(i + 1 < v.length ? this.AND(v[i], v[i + 1]) : v[i]); v = n; }
      return v[0];
    }
    orTree(list) {
      if (!list.length) return 0;
      let v = list.slice();
      while (v.length > 1) { const n = []; for (let i = 0; i < v.length; i += 2) n.push(i + 1 < v.length ? this.OR(v[i], v[i + 1]) : v[i]); v = n; }
      return v[0];
    }
    eqv(A, B) { return this.andTree(A.map((x, i) => this.XNOR(x, B[i]))); }
    eqConst(A, k) { return this.andTree(A.map((x, i) => ((k >>> i) & 1 ? x : this.NOT(x)))); }
    decoder(sel) {
      if (sel.length === 1) return [this.NOT(sel[0]), sel[0]];
      const h = sel.length >> 1;
      const lo = this.decoder(sel.slice(0, h)), hi = this.decoder(sel.slice(h));
      const out = [];
      for (let i = 0; i < 1 << sel.length; i++) { this.curBit = i; out.push(this.AND(lo[i & ((1 << h) - 1)], hi[i >> h])); }
      this.curBit = -1;
      return out;
    }
    // rows: 2^k buses, sel: k bits (LSB first) -> binary tree of MUX2
    muxTree(rows, sel) {
      let v = rows;
      for (let k = 0; k < sel.length; k++) {
        const n = [];
        for (let j = 0; j < v.length; j += 2) n.push(this.muxv(v[j], v[j + 1], sel[k]));
        v = n;
      }
      return v[0];
    }
    // Kogge-Stone adder: generate/propagate, log2(n) prefix levels, sum XORs
    adderKS(A, B, cin) {
      const n = A.length, g = [], p = [];
      for (let i = 0; i < n; i++) { this.curBit = i; g.push(this.AND(A[i], B[i])); p.push(this.XOR(A[i], B[i])); }
      let Gv = g.slice(), Pv = p.slice();
      if (cin !== 0) { this.curBit = 0; Gv[0] = this.OR(g[0], this.AND(p[0], cin)); }
      for (let d = 1; d < n; d <<= 1) {
        const G2 = Gv.slice(), P2 = Pv.slice();
        for (let i = d; i < n; i++) {
          this.curBit = i;
          G2[i] = this.OR(Gv[i], this.AND(Pv[i], Gv[i - d]));
          if (i - d >= d) P2[i] = this.AND(Pv[i], Pv[i - d]);
        }
        Gv = G2; Pv = P2;
      }
      const s = [];
      for (let i = 0; i < n; i++) { this.curBit = i; s.push(this.XOR(p[i], i === 0 ? cin : Gv[i - 1])); }
      this.curBit = -1;
      return { s, co: Gv[n - 1] };
    }
    // logarithmic right shifter (5 levels), left shifts by bit reversal, arithmetic via sign fill
    shifter(A, sh, left, arith) {
      const n = A.length;
      let v = A.map((x, i) => { this.curBit = i; return this.MUX(x, A[n - 1 - i], left); });
      const fill = this.AND(this.AND(arith, this.NOT(left)), A[n - 1]);
      for (let k = 0; k < sh.length; k++) {
        const d = 1 << k, nv = [];
        for (let i = 0; i < n; i++) { this.curBit = i; nv.push(this.MUX(v[i], i + d < n ? v[i + d] : fill, sh[k])); }
        v = nv;
      }
      const out = v.map((x, i) => { this.curBit = i; return this.MUX(x, v[n - 1 - i], left); });
      this.curBit = -1;
      return out;
    }
    // Baugh-Wooley signed 32x32 partial products, Dadda reduction (FA = 2 XOR + 2 AND + 1 OR), KS64 final adder
    mulBW(A, B) {
      const n = A.length, W = 2 * n;
      let cols = Array.from({ length: W }, () => []);
      this.push('pp');
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        this.curBit = i + j;
        const neg = (i === n - 1) !== (j === n - 1);
        cols[i + j].push(neg ? this.NAND(A[i], B[j]) : this.AND(A[i], B[j]));
      }
      cols[n].push(1); cols[W - 1].push(1);
      this.pop();
      this.push('dadda');
      const ds = [2];
      while (ds[ds.length - 1] < n + 1) ds.push(Math.floor(ds[ds.length - 1] * 1.5));
      let maxH = Math.max(...cols.map((c) => c.length));
      const seq = ds.filter((d) => d < maxH).reverse();
      let fas = 0, has = 0;
      for (const d of seq) {
        const nc = Array.from({ length: W }, () => []);
        for (let c = 0; c < W; c++) {
          const bits = cols[c].slice();
          this.curBit = c;
          while (bits.length + nc[c].length > d) {
            const h = bits.length + nc[c].length;
            if (h - d >= 2 && bits.length >= 3) {
              const x = bits.shift(), y = bits.shift(), z = bits.shift();
              const t = this.XOR(x, y);
              nc[c].push(this.XOR(t, z));
              if (c + 1 < W) nc[c + 1].push(this.OR(this.AND(x, y), this.AND(t, z)));
              fas++;
            } else if (bits.length >= 2) {
              const x = bits.shift(), y = bits.shift();
              nc[c].push(this.XOR(x, y));
              if (c + 1 < W) nc[c + 1].push(this.AND(x, y));
              has++;
            } else break;
          }
          for (const b of bits) nc[c].push(b);
        }
        cols = nc;
      }
      this.pop();
      for (const c of cols) if (c.length > 2) throw new Error('dadda: column height ' + c.length);
      this.push('ks64');
      const r0 = cols.map((c) => (c.length > 0 ? c[0] : 0)), r1 = cols.map((c) => (c.length > 1 ? c[1] : 0));
      const P = this.adderKS(r0, r1, 0).s;
      this.pop();
      this.daddaStages = seq.length; this.fas = fas; this.has = has;
      return P;
    }
  }

  // ===================================================================================================
  // The core: IF | ID | EX | MEM | WB with forwarding, load-use stall, BTFN prediction, flush logic
  // ===================================================================================================
  function buildCore() {
    const N = new NL();
    const rst = N.input('rst', 1)[0];
    const cfgFwd = N.input('cfg_fwd', 1)[0];
    const cfgBtfn = N.input('cfg_btfn', 1)[0];
    const imem = N.input('imem_rdata', 32);
    const dmem = N.input('dmem_rdata', 32);
    const nrst = N.NOT(rst);

    // ---- architectural and pipeline state ----
    N.push('ifu'); N.push('pc'); const PC = N.reg(32); N.pop(); N.pop();
    N.push('ifid');
    const FD = { v: N.reg1(), pc: N.reg(32), pc4: N.reg(32), ir: N.reg(32) };
    N.pop();
    N.push('idex');
    const DX = {
      v: N.reg1(), pc: N.reg(32), pc4: N.reg(32), rs1v: N.reg(32), rs2v: N.reg(32), imm: N.reg(32), bt: N.reg(32),
      rd: N.reg(5), rs1: N.reg(5), rs2: N.reg(5), f3: N.reg(3), aluF3: N.reg(3),
      sub: N.reg1(), sra: N.reg1(), aPC: N.reg1(), aZero: N.reg1(), bImm: N.reg1(), rsel: N.reg(2),
      regW: N.reg1(), memR: N.reg1(), memW: N.reg1(), isBr: N.reg1(), isJalr: N.reg1(), predT: N.reg1(),
    };
    N.pop();
    N.push('exmem');
    const XM = { v: N.reg1(), pc: N.reg(32), res: N.reg(32), sd: N.reg(32), rd: N.reg(5), f3: N.reg(3), regW: N.reg1(), memR: N.reg1(), memW: N.reg1() };
    N.pop();
    N.push('memwb');
    const MW = { v: N.reg1(), pc: N.reg(32), res: N.reg(32), ld: N.reg(32), rd: N.reg(5), regW: N.reg1(), memR: N.reg1() };
    N.pop();
    N.push('idu'); N.push('rf'); N.push('cells');
    const RF = [N.constBus(32, 0)];
    for (let r = 1; r < 32; r++) RF.push(N.reg(32));
    N.pop(); N.pop(); N.pop();

    // ---- WB ----
    N.push('wbu');
    const wbData = N.muxv(MW.res, MW.ld, MW.memR);
    N.pop();

    // ---- MEM ----
    N.push('lsu');
    const addr = XM.res;
    const sz0 = XM.f3[0], sz1 = XM.f3[1], uns = XM.f3[2];
    N.push('be');
    const isB = N.AND(N.NOT(sz1), N.NOT(sz0)), isH = N.AND(N.NOT(sz1), sz0), isW = sz1;
    const a0 = addr[0], a1 = addr[1], na0 = N.NOT(a0), na1 = N.NOT(a1);
    const lane = [N.AND(na1, na0), N.AND(na1, a0), N.AND(a1, na0), N.AND(a1, a0)];
    const be = [0, 1, 2, 3].map((k) => { N.curBit = k * 8; return N.OR(isW, N.OR(N.AND(isB, lane[k]), N.AND(isH, k < 2 ? na1 : a1))); });
    N.pop();
    N.push('st');
    const sd = XM.sd, wdata = [];
    for (let i = 0; i < 32; i++) {
      N.curBit = i;
      if (i < 8) wdata.push(sd[i]);
      else if (i < 16) wdata.push(N.MUX(sd[i], sd[i - 8], isB));
      else if (i < 24) wdata.push(N.MUX(sd[i - 16], sd[i], isW));
      else wdata.push(N.MUX(N.MUX(sd[i - 16], sd[i - 24], isB), sd[i], isW));
    }
    N.pop();
    N.push('ld');
    const ldv = [];
    const b0 = [], b1 = [];
    for (let k = 0; k < 8; k++) {
      N.curBit = k;
      b0.push(N.MUX(N.MUX(dmem[k], dmem[8 + k], a0), N.MUX(dmem[16 + k], dmem[24 + k], a0), a1));
      N.curBit = 8 + k;
      b1.push(N.MUX(dmem[8 + k], dmem[24 + k], a1));
    }
    const nuns = N.NOT(uns);
    const ext8 = N.AND(nuns, b0[7]), ext16 = N.AND(nuns, b1[7]);
    for (let i = 0; i < 32; i++) {
      N.curBit = i;
      if (i < 8) ldv.push(b0[i]);
      else if (i < 16) ldv.push(N.MUX(b1[i - 8], ext8, isB));
      else ldv.push(N.MUX(N.MUX(ext8, ext16, isH), dmem[i], isW));
    }
    N.pop();
    N.pop();

    // ---- EX ----
    N.push('exu');
    N.push('fwd');
    const xmHit1 = N.AND(XM.regW, N.eqv(XM.rd, DX.rs1)), xmHit2 = N.AND(XM.regW, N.eqv(XM.rd, DX.rs2));
    const mwHit1 = N.AND(MW.regW, N.eqv(MW.rd, DX.rs1)), mwHit2 = N.AND(MW.regW, N.eqv(MW.rd, DX.rs2));
    const fA1 = N.AND(cfgFwd, xmHit1), fA2 = N.AND(cfgFwd, N.AND(mwHit1, N.NOT(xmHit1)));
    const fB1 = N.AND(cfgFwd, xmHit2), fB2 = N.AND(cfgFwd, N.AND(mwHit2, N.NOT(xmHit2)));
    const rs1f = N.muxv(N.muxv(DX.rs1v, wbData, fA2), XM.res, fA1);
    const rs2f = N.muxv(N.muxv(DX.rs2v, wbData, fB2), XM.res, fB1);
    N.pop();
    N.push('alu');
    N.push('opsel');
    const A = N.muxv(N.andv(rs1f, rs1f.map(() => N.NOT(DX.aZero))), DX.pc, DX.aPC);
    const B = N.muxv(rs2f, DX.imm, DX.bImm);
    N.pop();
    N.push('ks');
    const Bx = B.map((x, i) => { N.curBit = i; return N.XOR(x, DX.sub); });
    const add = N.adderKS(A, Bx, DX.sub);
    N.pop();
    N.push('slt');
    const lt = N.MUX(add.s[31], A[31], N.XOR(A[31], B[31]));
    const ltu = N.NOT(add.co);
    N.pop();
    N.push('log');
    const xr = N.xorv(A, B), orr = N.orv(A, B), anr = N.andv(A, B);
    N.pop();
    N.push('shf');
    const shr = N.shifter(A, B.slice(0, 5), N.NOT(DX.aluF3[2]), DX.sra);
    N.pop();
    N.push('res');
    const sltv = N.constBus(32, 0); sltv[0] = lt;
    const sltuv = N.constBus(32, 0); sltuv[0] = ltu;
    const aluOut = N.muxTree([add.s, shr, sltv, sltuv, xr, shr, orr, anr], DX.aluF3);
    N.pop();
    N.pop();
    N.push('mul');
    const P = N.mulBW(rs1f, rs2f);
    N.pop();
    N.push('bcmp');
    const eq = N.NOT(N.orTree(xr));
    const base = N.MUX(eq, N.MUX(lt, ltu, DX.f3[1]), DX.f3[2]);
    const cond = N.XOR(base, DX.f3[0]);
    const mispred = N.AND(DX.isBr, N.XOR(cond, DX.predT));
    const exRedir = N.OR(mispred, DX.isJalr);
    const tBr = N.muxv(DX.pc4, DX.bt, cond);
    const jt = add.s.slice(); jt[0] = 0;
    const exTarget = N.muxv(tBr, jt, DX.isJalr);
    N.pop();
    N.push('rsel');
    const exRes = N.muxv(N.muxv(aluOut, P.slice(0, 32), DX.rsel[0]), N.muxv(P.slice(32), DX.pc4, DX.rsel[0]), DX.rsel[1]);
    N.pop();
    N.pop();

    // ---- ID ----
    N.push('idu');
    const ir = FD.ir;
    const op = ir.slice(0, 7), f3 = ir.slice(12, 15), f7 = ir.slice(25, 32);
    const rd = ir.slice(7, 12), rs1 = ir.slice(15, 20), rs2 = ir.slice(20, 25);
    N.push('dec');
    const isLUI = N.eqConst(op, 0b0110111), isAUIPC = N.eqConst(op, 0b0010111), isJAL = N.eqConst(op, 0b1101111);
    const isJALR = N.eqConst(op, 0b1100111), isBR = N.eqConst(op, 0b1100011), isLD = N.eqConst(op, 0b0000011);
    const isST = N.eqConst(op, 0b0100011), isOPI = N.eqConst(op, 0b0010011), isOP = N.eqConst(op, 0b0110011);
    const isMx = N.AND(isOP, f7[0]);
    const mulOK = N.AND(isMx, N.AND(N.NOT(f3[2]), N.NOT(f3[1])));
    const isMul = N.AND(mulOK, N.NOT(f3[0])), isMulh = N.AND(mulOK, f3[0]);
    const isALU = N.AND(isOP, N.NOT(f7[0]));
    const wr = N.orTree([isLUI, isAUIPC, isJAL, isJALR, isLD, isOPI, isALU, mulOK]);
    const rdNZ = N.orTree(rd);
    const regW = N.AND(wr, rdNZ);
    const aluEn = N.OR(isOPI, isALU);
    const aluF3 = f3.map((x) => N.AND(x, aluEn));
    const isSlt = N.AND(aluEn, N.AND(N.NOT(f3[2]), f3[1])); // SLT, SLTU, SLTI, SLTIU compare through the subtractor
    const sub = N.orTree([isBR, N.AND(N.AND(isALU, f7[5]), N.eqConst(f3, 0)), isSlt]);
    const bImm = N.NOT(N.OR(isOP, isBR));
    const jmp = N.OR(isJAL, isJALR);
    const rsel = [N.OR(isMul, jmp), N.OR(isMulh, jmp)];
    const useRs1 = N.orTree([isJALR, isBR, isLD, isST, isOPI, isOP]);
    const useRs2 = N.orTree([isBR, isST, isOP]);
    const predT = N.AND(cfgBtfn, N.AND(isBR, ir[31]));
    N.pop();
    N.push('imm');
    const tI = N.orTree([isOPI, isLD, isJALR]), tS = isST, tB = isBR, tU = N.OR(isLUI, isAUIPC), tJ = isJAL;
    const imm = [];
    const pick = (terms) => N.orTree(terms.filter((x) => x[1] !== 0).map(([s, v]) => N.AND(s, v)));
    for (let i = 0; i < 32; i++) {
      N.curBit = i;
      if (i === 0) imm.push(pick([[tI, ir[20]], [tS, ir[7]]]));
      else if (i <= 4) imm.push(pick([[tI, ir[20 + i]], [tS, ir[7 + i]], [tB, ir[7 + i]], [tJ, ir[20 + i]]]));
      else if (i <= 10) imm.push(pick([[N.NOT(tU), ir[20 + i]]]));
      else if (i === 11) imm.push(pick([[N.OR(tI, tS), ir[31]], [tB, ir[7]], [tJ, ir[20]]]));
      else if (i <= 19) imm.push(pick([[N.orTree([tI, tS, tB]), ir[31]], [N.OR(tU, tJ), ir[i]]]));
      else if (i <= 30) imm.push(pick([[N.NOT(tU), ir[31]], [tU, ir[i]]]));
      else imm.push(ir[31]);
    }
    N.pop();
    N.push('rf');
    N.push('wdec');
    const dec = N.decoder(MW.rd);
    const we = dec.map((x) => N.AND(x, MW.regW));
    N.pop();
    N.push('cells');
    for (let r = 1; r < 32; r++) N.connect(RF[r], wbData, we[r]);
    N.pop();
    N.push('rd1'); const rf1 = N.muxTree(RF, rs1); N.pop();
    N.push('rd2'); const rf2 = N.muxTree(RF, rs2); N.pop();
    N.push('byp');
    const byp1 = N.AND(MW.regW, N.eqv(MW.rd, rs1)), byp2 = N.AND(MW.regW, N.eqv(MW.rd, rs2));
    const rs1v = N.muxv(rf1, wbData, byp1), rs2v = N.muxv(rf2, wbData, byp2);
    N.pop();
    N.pop();
    N.push('haz');
    const m1 = N.AND(useRs1, N.eqv(DX.rd, rs1)), m2 = N.AND(useRs2, N.eqv(DX.rd, rs2));
    const mDX = N.OR(m1, m2);
    const loadUse = N.AND(N.AND(DX.memR, DX.regW), mDX);
    const e1 = N.AND(useRs1, N.eqv(XM.rd, rs1)), e2 = N.AND(useRs2, N.eqv(XM.rd, rs2));
    const rawStall = N.AND(N.NOT(cfgFwd), N.OR(N.AND(DX.regW, mDX), N.AND(XM.regW, N.OR(e1, e2))));
    const stall = N.AND(FD.v, N.OR(loadUse, rawStall));
    const idRedir = N.AND(N.AND(FD.v, N.OR(isJAL, predT)), N.NOT(stall));
    N.pop();
    N.push('bta');
    const idTarget = N.adderKS(FD.pc, imm, 0).s;
    N.pop();
    N.pop();

    // ---- IF ----
    N.push('ifu');
    N.push('inc');
    const pc4 = N.adderKS(PC, N.constBus(32, 4), 0).s;
    N.pop();
    N.push('npc');
    const npc = N.muxv(N.muxv(N.muxv(pc4, idTarget, idRedir), PC, stall), exTarget, exRedir);
    N.pop();
    N.pop();

    // ---- register D inputs ----
    N.push('ifu'); N.push('pc'); N.connect(PC, npc, 1, nrst, 0); N.pop(); N.pop();
    N.push('ifid');
    const nstall = N.NOT(stall);
    const fdV = N.AND(nrst, N.AND(N.NOT(N.OR(exRedir, idRedir)), N.OR(nstall, FD.v)));
    N.connect([FD.v], [fdV], 1);
    N.connect(FD.pc, PC, nstall); N.connect(FD.pc4, pc4, nstall); N.connect(FD.ir, imem, nstall);
    N.pop();
    N.push('idex');
    const dxV = N.AND(N.AND(FD.v, nrst), N.NOT(N.OR(stall, exRedir)));
    N.connect([DX.v], [dxV], 1);
    const ctl = (q, d) => N.connect(q, d.map((x) => N.AND(x, dxV)), 1);
    ctl([DX.regW], [regW]); ctl([DX.memR], [isLD]); ctl([DX.memW], [isST]); ctl([DX.isBr], [isBR]);
    ctl([DX.isJalr], [isJALR]); ctl([DX.predT], [predT]);
    N.connect(DX.pc, FD.pc, 1); N.connect(DX.pc4, FD.pc4, 1); N.connect(DX.rs1v, rs1v, 1); N.connect(DX.rs2v, rs2v, 1);
    N.connect(DX.imm, imm, 1); N.connect(DX.bt, idTarget, 1); N.connect(DX.rd, rd, 1); N.connect(DX.rs1, rs1, 1);
    N.connect(DX.rs2, rs2, 1); N.connect(DX.f3, f3, 1); N.connect(DX.aluF3, aluF3, 1); N.connect([DX.sub], [sub], 1);
    N.connect([DX.sra], [f7[5]], 1); N.connect([DX.aPC], [isAUIPC], 1); N.connect([DX.aZero], [isLUI], 1);
    N.connect([DX.bImm], [bImm], 1); N.connect(DX.rsel, rsel, 1);
    N.pop();
    N.push('exmem');
    N.connect([XM.v], [DX.v], 1, nrst, 0); N.connect([XM.regW], [DX.regW], 1, nrst, 0);
    N.connect([XM.memR], [DX.memR], 1, nrst, 0); N.connect([XM.memW], [DX.memW], 1, nrst, 0);
    N.connect(XM.pc, DX.pc, 1); N.connect(XM.res, exRes, 1); N.connect(XM.sd, rs2f, 1); N.connect(XM.rd, DX.rd, 1);
    N.connect(XM.f3, DX.f3, 1);
    N.pop();
    N.push('memwb');
    N.connect([MW.v], [XM.v], 1, nrst, 0); N.connect([MW.regW], [XM.regW], 1, nrst, 0);
    N.connect([MW.memR], [XM.memR], 1, nrst, 0);
    N.connect(MW.pc, XM.pc, 1); N.connect(MW.res, XM.res, 1); N.connect(MW.ld, ldv, 1); N.connect(MW.rd, XM.rd, 1);
    N.pop();
    // primary outputs (what the fault simulator observes) and the trace port (what the lockstep checker reads)
    N.outs = { imem_addr: PC, dmem_addr: addr, dmem_wdata: wdata, dmem_be: be, dmem_we: [XM.memW], retire_valid: [MW.v] };
    N.trace = { retire_pc: MW.pc, retire_rd: MW.rd, retire_we: [MW.regW], retire_wdata: wbData };
    N.probes = {
      stall: [stall], loadUse: [loadUse], exRedir: [exRedir], idRedir: [idRedir], mispred: [mispred], cond: [cond],
      fA1: [fA1], fA2: [fA2], fB1: [fB1], fB2: [fB2], aluOut, mulHi: P.slice(32), exRes,
      pcIF: PC, pcID: FD.pc, pcEX: DX.pc, pcMEM: XM.pc, pcWB: MW.pc, vID: [FD.v], vEX: [DX.v], vMEM: [XM.v], vWB: [MW.v],
      irID: FD.ir, isBrID: [isBR], isJalID: [isJAL], isBrEX: [DX.isBr], isJalrEX: [DX.isJalr], predEX: [DX.predT],
      wbData, wbRd: MW.rd, wbWe: [MW.regW], memR: [XM.memR], memW: [XM.memW], rf: RF.slice(1),
      mulA: rs1f, mulB: rs2f, rs1vID: rs1v, immID: imm, ldv, exTarget, idTarget, dxRs1v: DX.rs1v, dxImm: DX.imm, memWdata: wdata,
    };
    return N;
  }

  // ===================================================================================================
  // finalize: dead-logic sweep, levelize, renumber (consts, inputs, DFFs, gates in level order), emit code
  // ===================================================================================================
  function finalize(N) {
    const n0 = N.t.length;
    const live = new Uint8Array(n0);
    const stackv = [];
    const mark = (x) => { if (!live[x]) { live[x] = 1; stackv.push(x); } };
    mark(0); mark(1);
    for (const k in N.ins) N.ins[k].forEach(mark);
    for (const grp of [N.outs, N.trace, N.probes]) for (const k in grp) {
      const v = grp[k];
      if (Array.isArray(v[0])) v.forEach((row) => row.forEach(mark)); else v.forEach(mark);
    }
    while (stackv.length) {
      const x = stackv.pop(), t = N.t[x];
      if (t === T.DFF) { if (N.a[x] < 0) throw new Error('unconnected DFF ' + x + ' in ' + N.mods[N.m[x]].path); mark(N.a[x]); }
      else if (t >= T.NOT) { mark(N.a[x]); if (t !== T.NOT) mark(N.b[x]); if (t === T.MUX) mark(N.c[x]); }
    }
    // levels (creation order is topological for combinational cells)
    const lvl = new Int32Array(n0);
    for (let x = 0; x < n0; x++) {
      const t = N.t[x];
      if (!live[x] || t < T.NOT) continue;
      let L = lvl[N.a[x]];
      if (t !== T.NOT) L = Math.max(L, lvl[N.b[x]]);
      if (t === T.MUX) L = Math.max(L, lvl[N.c[x]]);
      lvl[x] = L + 1;
    }
    // new order
    const order = [0, 1];
    const ins = [], dffs = [], gates = [];
    for (let x = 2; x < n0; x++) {
      if (!live[x]) continue;
      if (N.t[x] === T.IN) ins.push(x); else if (N.t[x] === T.DFF) dffs.push(x); else gates.push(x);
    }
    // DFFs grouped by module (stable), gates by level then module then bit
    dffs.sort((x, y) => N.m[x] - N.m[y] || x - y);
    gates.sort((x, y) => lvl[x] - lvl[y] || N.m[x] - N.m[y] || x - y);
    order.push(...ins, ...dffs, ...gates);
    const map = new Int32Array(n0).fill(-1);
    order.forEach((x, i) => (map[x] = i));
    const n = order.length;
    const D = {
      n, nIn: ins.length, dffStart: 2 + ins.length, nDff: dffs.length, gateStart: 2 + ins.length + dffs.length,
      type: new Uint8Array(n), inA: new Int32Array(n), inB: new Int32Array(n), inS: new Int32Array(n),
      mod: new Uint16Array(n), bit: new Int16Array(n), level: new Uint16Array(n),
      mods: N.mods, names: TNAME, nandEq: NAND_EQ,
    };
    for (let i = 0; i < n; i++) {
      const x = order[i], t = N.t[x];
      D.type[i] = t; D.mod[i] = N.m[x]; D.bit[i] = N.bit[x]; D.level[i] = lvl[x];
      if (t === T.DFF) D.inA[i] = map[N.a[x]];
      else if (t >= T.NOT) { D.inA[i] = map[N.a[x]]; D.inB[i] = t === T.NOT ? 0 : map[N.b[x]]; D.inS[i] = t === T.MUX ? map[N.c[x]] : 0; }
    }
    const remap = (grp) => {
      const o = {};
      for (const k in grp) {
        const v = grp[k];
        o[k] = Array.isArray(v[0]) ? v.map((row) => Int32Array.from(row, (x) => map[x])) : Int32Array.from(v, (x) => map[x]);
      }
      return o;
    };
    D.ins = remap(N.ins); D.outs = remap(N.outs); D.trace = remap(N.trace); D.probes = remap(N.probes);
    D.dIdx = new Int32Array(D.nDff);
    for (let k = 0; k < D.nDff; k++) D.dIdx[k] = D.inA[D.dffStart + k];
    let maxL = 0;
    for (let i = D.gateStart; i < n; i++) if (D.level[i] > maxL) maxL = D.level[i];
    D.maxLevel = maxL;
    // level boundaries in the gate range
    D.levelStart = new Int32Array(maxL + 2);
    { let i = D.gateStart; for (let L = 1; L <= maxL + 1; L++) { while (i < n && D.level[i] < L) i++; D.levelStart[L] = i; } D.levelStart[0] = D.dffStart; }
    D.daddaStages = N.daddaStages; D.fas = N.fas; D.has = N.has;
    D.critical = critical(D);
    return D;
  }

  // longest flop-to-flop path: max level over DFF D inputs, traced back through the deepest input of each gate
  function critical(D) {
    let best = -1, bestL = -1;
    for (let k = 0; k < D.nDff; k++) { const d = D.dIdx[k]; if (D.level[d] > bestL) { bestL = D.level[d]; best = k; } }
    const path = [];
    let x = D.dIdx[best];
    path.push(D.dffStart + best);
    while (x >= D.gateStart) {
      path.push(x);
      const t = D.type[x];
      let nx = D.inA[x];
      if (t !== T.NOT && D.level[D.inB[x]] > D.level[nx]) nx = D.inB[x];
      if (t === T.MUX && D.level[D.inS[x]] > D.level[nx]) nx = D.inS[x];
      x = nx;
    }
    path.push(x);
    path.reverse();
    return { levels: bestL, path, endDff: D.dffStart + best };
  }

  // Straight-line code: one function per slice of a level (at most 1600 statements, under V8's optimizing limit)
  function emitChunks(D, maxStmts = 1600) {
    const chunks = []; // {level, src}
    const ty = D.type, A = D.inA, B = D.inB, S = D.inS;
    for (let L = 1; L <= D.maxLevel; L++) {
      const s0 = D.levelStart[L], s1 = D.levelStart[L + 1];
      for (let i = s0; i < s1; i += maxStmts) {
        const e = Math.min(s1, i + maxStmts);
        const lines = [];
        for (let g = i; g < e; g++) {
          const a = A[g], b = B[g], c = S[g];
          switch (ty[g]) {
            case T.NOT: lines.push(`s[${g}]=~s[${a}];`); break;
            case T.AND: lines.push(`s[${g}]=s[${a}]&s[${b}];`); break;
            case T.OR: lines.push(`s[${g}]=s[${a}]|s[${b}];`); break;
            case T.NAND: lines.push(`s[${g}]=~(s[${a}]&s[${b}]);`); break;
            case T.NOR: lines.push(`s[${g}]=~(s[${a}]|s[${b}]);`); break;
            case T.XOR: lines.push(`s[${g}]=s[${a}]^s[${b}];`); break;
            case T.XNOR: lines.push(`s[${g}]=~(s[${a}]^s[${b}]);`); break;
            case T.MUX: lines.push(`s[${g}]=s[${a}]^((s[${a}]^s[${b}])&s[${c}]);`); break;
            default: throw new Error('bad gate type ' + ty[g]);
          }
        }
        chunks.push({ level: L, src: lines.join('\n') });
      }
    }
    return chunks;
  }
  function compileChunks(chunks) {
    return chunks.map((c) => new Function('s', '"use strict";\n' + c.src));
  }

  G.HDL = { T, TNAME, NAND_EQ, NL, buildCore, finalize, emitChunks, compileChunks };
})(typeof self !== 'undefined' ? self : globalThis);

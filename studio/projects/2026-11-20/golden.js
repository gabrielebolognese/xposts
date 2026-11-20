// Every Gate: the golden ISA model. An RV32I+MUL/MULH interpreter written straight from the ISA manual, independent
// of the netlist. step() executes one instruction and returns what it retired: pc, rd/wdata and any store.
// Memory map: ROM 16 KiB at 0x0000_0000 (fetch only), RAM 64 KiB at 0x0001_0000, UART TX byte at 0x2000_0000.
(function (G) {
  'use strict';
  class Golden {
    constructor(rom, ramInit) {
      this.rom = rom;
      this.ramInit = ramInit;
      this.reset();
    }
    reset() {
      this.pc = 0;
      this.x = new Int32Array(32);
      this.ram = new Uint8Array(this.ramInit);
      this.uart = [];
      this.n = 0;
      this.res = { pc: 0, ir: 0, rd: 0, wdata: 0, st: null };
      this.stRec = { addr: 0, be: 0, data: 0 };
    }
    ld8(a) { a >>>= 0; return a >>> 16 === 1 ? this.ram[a & 0xffff] : 0; }
    st8(a, v) { a >>>= 0; if (a >>> 16 === 1) this.ram[a & 0xffff] = v & 0xff; }
    step() {
      const pc = this.pc, x = this.x;
      const w = this.rom[(pc >>> 2) & 0xfff] | 0;
      const op = w & 0x7f, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7, r1 = (w >>> 15) & 31, r2 = (w >>> 20) & 31, f7 = (w >>> 25) & 0x7f;
      const a = x[r1], b = x[r2];
      const iI = w >> 20;
      const iS = ((w >> 25) << 5) | ((w >>> 7) & 31);
      const iB = ((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1);
      const iU = w & 0xfffff000;
      const iJ = ((w >> 31) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1);
      let next = (pc + 4) | 0, wr = false, v = 0, st = null;
      const alu = (f, a, b, alt) => {
        switch (f) {
          case 0: return alt ? (a - b) | 0 : (a + b) | 0;
          case 1: return a << (b & 31);
          case 2: return a < b ? 1 : 0;
          case 3: return a >>> 0 < b >>> 0 ? 1 : 0;
          case 4: return a ^ b;
          case 5: return alt ? a >> (b & 31) : (a >>> (b & 31)) | 0;
          case 6: return a | b;
          default: return a & b;
        }
      };
      switch (op) {
        case 0x37: wr = true; v = iU; break;
        case 0x17: wr = true; v = (pc + iU) | 0; break;
        case 0x6f: wr = true; v = next; next = (pc + iJ) | 0; break;
        case 0x67: wr = true; v = next; next = ((a + iI) & ~1) | 0; break;
        case 0x63: {
          let c;
          if (f3 & 4) c = f3 & 2 ? a >>> 0 < b >>> 0 : a < b; else c = a === b;
          if (f3 & 1) c = !c;
          if (c) next = (pc + iB) | 0;
          break;
        }
        case 0x03: {
          const ad = (a + iI) | 0;
          wr = true;
          const b0 = this.ld8(ad), b1 = this.ld8(ad + 1), b2 = this.ld8(ad + 2), b3 = this.ld8(ad + 3);
          switch (f3 & 3) {
            case 0: v = f3 & 4 ? b0 : (b0 << 24) >> 24; break;
            case 1: { const h = b0 | (b1 << 8); v = f3 & 4 ? h : (h << 16) >> 16; break; }
            default: v = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
          }
          break;
        }
        case 0x23: {
          const ad = (a + iS) | 0, size = f3 & 3;
          const nb = size === 0 ? 1 : size === 1 ? 2 : 4;
          for (let k = 0; k < nb; k++) this.st8(ad + k, b >>> (8 * k));
          if (ad >>> 0 === 0x20000000 && nb === 1) this.uart.push(b & 0xff);
          const sh = 8 * (ad & 3);
          st = this.stRec;
          st.addr = ad; st.be = (((1 << nb) - 1) << (ad & 3)) & 15; st.data = nb === 4 ? b : (b << sh) | 0;
          break;
        }
        case 0x13: wr = true; v = alu(f3, a, f3 === 5 || f3 === 1 ? iI & 31 : iI, f3 === 5 && (f7 & 0x20)); break;
        case 0x33:
          if (f7 & 1) {
            if (f3 === 0) { wr = true; v = Math.imul(a, b); }
            else if (f3 === 1) { wr = true; v = Number((BigInt(a) * BigInt(b)) >> 32n) | 0; }
          } else { wr = true; v = alu(f3, a, b, f7 & 0x20); }
          break;
        default: break; // FENCE, ECALL, EBREAK and anything else: no architectural effect
      }
      if (wr && rd) x[rd] = v; else { wr = false; v = 0; }
      this.pc = next;
      this.n++;
      const r = this.res;
      r.pc = pc; r.ir = w; r.rd = wr ? rd : 0; r.wdata = v; r.st = st;
      return r;
    }
  }
  G.Golden = Golden;
})(typeof self !== 'undefined' ? self : globalThis);

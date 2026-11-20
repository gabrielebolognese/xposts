// Every Gate: a two-pass RV32I+MUL/MULH assembler (labels, .equ, .word/.half/.byte/.ascii/.asciz/.space/.align,
// pseudo-instructions) and a disassembler for the trace views.
(function (G) {
  'use strict';
  const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
    's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
  const REG = {};
  ABI.forEach((n, i) => { REG[n] = i; REG['x' + i] = i; });
  REG.fp = 8;

  const R = { add: [0, 0], sub: [0, 0x20], sll: [1, 0], slt: [2, 0], sltu: [3, 0], xor: [4, 0], srl: [5, 0], sra: [5, 0x20], or: [6, 0], and: [7, 0], mul: [0, 1], mulh: [1, 1] };
  const IA = { addi: 0, slti: 2, sltiu: 3, xori: 4, ori: 6, andi: 7 };
  const SH = { slli: [1, 0], srli: [5, 0], srai: [5, 0x400] };
  const LD = { lb: 0, lh: 1, lw: 2, lbu: 4, lhu: 5 };
  const ST = { sb: 0, sh: 1, sw: 2 };
  const BR = { beq: 0, bne: 1, blt: 4, bge: 5, bltu: 6, bgeu: 7 };

  const encR = (f7, rs2, rs1, f3, rd, op) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
  const encI = (imm, rs1, f3, rd, op) => (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
  const encS = (imm, rs2, rs1, f3, op) => ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1f) << 7) | op) >>> 0;
  const encB = (imm, rs2, rs1, f3) => ((((imm >> 12) & 1) << 31) | (((imm >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (((imm >> 1) & 0xf) << 8) | (((imm >> 11) & 1) << 7) | 0x63) >>> 0;
  const encU = (imm, rd, op) => ((imm & 0xfffff000) | (rd << 7) | op) >>> 0;
  const encJ = (imm, rd) => ((((imm >> 20) & 1) << 31) | (((imm >> 1) & 0x3ff) << 21) | (((imm >> 11) & 1) << 20) | (((imm >> 12) & 0xff) << 12) | (rd << 7) | 0x6f) >>> 0;
  const hiLo = (v) => { v |= 0; const hi = (v + 0x800) >> 12; const lo = v - (hi << 12); return [hi << 12, lo]; };

  // ---- expression evaluator: numbers, 'c', symbols, + - * / << >> & | ( ) ----
  function evalExpr(str, sym, line) {
    const toks = str.match(/0x[0-9a-fA-F]+|0b[01]+|\d+|'(?:\\.|[^'])'|[A-Za-z_.][\w.]*|<<|>>|[-+*/()&|~]/g) || [];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    function atom() {
      const t = next();
      if (t === undefined) throw new Error(`line ${line}: bad expression '${str}'`);
      if (t === '(') { const v = expr(); next(); return v; }
      if (t === '-') return -atom();
      if (t === '~') return ~atom();
      if (t === '+') return atom();
      if (/^0x/.test(t)) return parseInt(t, 16);
      if (/^0b/.test(t)) return parseInt(t.slice(2), 2);
      if (/^\d/.test(t)) return parseInt(t, 10);
      if (t[0] === "'") { const c = t.slice(1, -1); return c[0] === '\\' ? { n: 10, t: 9, 0: 0, '\\': 92, "'": 39 }[c[1]] : c.charCodeAt(0); }
      if (t in sym) return sym[t];
      throw new Error(`line ${line}: unknown symbol '${t}'`);
    }
    function term() { let v = atom(); while (peek() === '*' || peek() === '/') { const o = next(), w = atom(); v = o === '*' ? v * w : Math.trunc(v / w); } return v; }
    function sum() { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), w = term(); v = o === '+' ? v + w : v - w; } return v; }
    function shift() { let v = sum(); while (peek() === '<<' || peek() === '>>') { const o = next(), w = sum(); v = o === '<<' ? v << w : v >> w; } return v; }
    function expr() { let v = shift(); while (peek() === '&' || peek() === '|') { const o = next(), w = shift(); v = o === '&' ? v & w : v | w; } return v; }
    const v = expr();
    if (i !== toks.length) throw new Error(`line ${line}: trailing tokens in '${str}'`);
    return v;
  }

  function splitArgs(s) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && s[i - 1] !== '\\') q = !q;
      if (c === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function parseStr(s) {
    const m = s.match(/^"(.*)"$/);
    if (!m) throw new Error('bad string ' + s);
    return m[1].replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', 0: '\0', '\\': '\\', '"': '"' }[c] || c));
  }

  function assemble(src, opt = {}) {
    const textBase = opt.textBase || 0, dataBase = opt.dataBase || 0x10000;
    const lines = src.split('\n').map((raw, i) => {
      let s = raw.replace(/#.*$/, '').trim();
      const labels = [];
      let m;
      while ((m = s.match(/^([A-Za-z_.][\w.]*):\s*(.*)$/))) { labels.push(m[1]); s = m[2]; }
      let op = '', args = [];
      if (s) { const k = s.search(/\s/); op = (k < 0 ? s : s.slice(0, k)).toLowerCase(); args = k < 0 ? [] : splitArgs(s.slice(k + 1)); }
      return { raw, n: i + 1, labels, op, args };
    });
    const sym = {};
    const reg = (r, ln) => { const v = REG[r.trim()]; if (v === undefined) throw new Error(`line ${ln}: bad register '${r}'`); return v; };
    const tryEval = (e) => { try { return evalExpr(e, sym, 0); } catch (err) { return null; } };
    // pass 1: sizes and labels
    let sec = 'text', pc = { text: textBase, data: dataBase };
    for (const L of lines) {
      if (L.op === '.equ' || L.op === '.set') { sym[L.args[0]] = evalExpr(L.args[1], sym, L.n); L.size = 0; continue; }
      if (L.op === '.text' || L.op === '.data') { sec = L.op.slice(1); L.size = 0; L.labels.forEach((l) => (sym[l] = pc[sec])); continue; }
      if (L.op === '.align') { const a = 1 << evalExpr(L.args[0], sym, L.n); pc[sec] = (pc[sec] + a - 1) & -a; }
      L.labels.forEach((l) => (sym[l] = pc[sec]));
      L.sec = sec; L.addr = pc[sec];
      let size = 0;
      switch (L.op) {
        case '': case '.align': size = 0; break;
        case '.word': size = 4 * L.args.length; break;
        case '.half': size = 2 * L.args.length; break;
        case '.byte': size = L.args.length; break;
        case '.ascii': size = parseStr(L.args[0]).length; break;
        case '.asciz': case '.string': size = parseStr(L.args[0]).length + 1; break;
        case '.space': size = evalExpr(L.args[0], sym, L.n); break;
        case 'li': { const v = tryEval(L.args[1]); size = v !== null && v >= -2048 && v <= 2047 ? 4 : 8; break; }
        case 'la': size = 8; break;
        default: size = 4;
      }
      L.size = size;
      pc[sec] += size;
    }
    // pass 2: encode
    const text = [], data = new Map(), listing = [];
    const put = (L, w) => { const a = L.addr + L.out * 4; text[(a - textBase) >> 2] = w >>> 0; L.words.push(w >>> 0); L.out++; };
    for (const L of lines) {
      if (!L.size) continue;
      const a = L.args, n = L.n, e = (x) => evalExpr(x, sym, n), r = (x) => reg(x, n);
      L.words = []; L.out = 0;
      if (L.sec === 'data' || L.op[0] === '.') {
        let p = L.addr;
        const b = (v) => data.set(p++, v & 0xff);
        switch (L.op) {
          case '.word': for (const x of a) { const v = e(x); b(v); b(v >> 8); b(v >> 16); b(v >> 24); } break;
          case '.half': for (const x of a) { const v = e(x); b(v); b(v >> 8); } break;
          case '.byte': for (const x of a) b(e(x)); break;
          case '.ascii': for (const c of parseStr(a[0])) b(c.charCodeAt(0)); break;
          case '.asciz': case '.string': for (const c of parseStr(a[0])) b(c.charCodeAt(0)); b(0); break;
          case '.space': for (let k = 0; k < L.size; k++) b(0); break;
          default: throw new Error(`line ${n}: ${L.op} in data`);
        }
        continue;
      }
      const memArg = (s) => { const m = s.match(/^(.*)\((\w+)\)$/); if (!m) throw new Error(`line ${n}: bad memory operand '${s}'`); return [m[1].trim() ? e(m[1]) : 0, r(m[2])]; };
      const op = L.op;
      const rel = (x) => e(x) - (L.addr + L.out * 4);
      if (op in R) { const [f3, f7] = R[op]; put(L, encR(f7, r(a[2]), r(a[1]), f3, r(a[0]), 0x33)); }
      else if (op in IA) put(L, encI(e(a[2]), r(a[1]), IA[op], r(a[0]), 0x13));
      else if (op in SH) { const [f3, hi] = SH[op]; put(L, encI(hi | (e(a[2]) & 31), r(a[1]), f3, r(a[0]), 0x13)); }
      else if (op in LD) { const [off, base] = memArg(a[1]); put(L, encI(off, base, LD[op], r(a[0]), 0x03)); }
      else if (op in ST) { const [off, base] = memArg(a[1]); put(L, encS(off, r(a[0]), base, ST[op], 0x23)); }
      else if (op in BR) put(L, encB(rel(a[2]), r(a[1]), r(a[0]), BR[op]));
      else switch (op) {
        case 'lui': put(L, encU(e(a[1]) << 12, r(a[0]), 0x37)); break;
        case 'auipc': put(L, encU(e(a[1]) << 12, r(a[0]), 0x17)); break;
        case 'jal': if (a.length === 1) put(L, encJ(rel(a[0]), 1)); else put(L, encJ(rel(a[1]), r(a[0]))); break;
        case 'jalr': if (a.length === 1) put(L, encI(0, r(a[0]), 0, 1, 0x67)); else { const [off, base] = memArg(a[1]); put(L, encI(off, base, 0, r(a[0]), 0x67)); } break;
        case 'fence': put(L, 0x0ff0000f); break;
        case 'ecall': put(L, 0x00000073); break;
        case 'ebreak': put(L, 0x00100073); break;
        case 'nop': put(L, encI(0, 0, 0, 0, 0x13)); break;
        case 'li': {
          const v = e(a[1]) | 0, rd = r(a[0]);
          if (L.size === 4) put(L, encI(v, 0, 0, rd, 0x13));
          else { const [hi, lo] = hiLo(v); put(L, encU(hi, rd, 0x37)); put(L, encI(lo, rd, 0, rd, 0x13)); }
          break;
        }
        case 'la': { const [hi, lo] = hiLo(e(a[1])); const rd = r(a[0]); put(L, encU(hi, rd, 0x37)); put(L, encI(lo, rd, 0, rd, 0x13)); break; }
        case 'mv': put(L, encI(0, r(a[1]), 0, r(a[0]), 0x13)); break;
        case 'not': put(L, encI(-1, r(a[1]), 4, r(a[0]), 0x13)); break;
        case 'neg': put(L, encR(0x20, r(a[1]), 0, 0, r(a[0]), 0x33)); break;
        case 'j': put(L, encJ(rel(a[0]), 0)); break;
        case 'call': put(L, encJ(rel(a[0]), 1)); break;
        case 'jr': put(L, encI(0, r(a[0]), 0, 0, 0x67)); break;
        case 'ret': put(L, encI(0, 1, 0, 0, 0x67)); break;
        case 'beqz': put(L, encB(rel(a[1]), 0, r(a[0]), 0)); break;
        case 'bnez': put(L, encB(rel(a[1]), 0, r(a[0]), 1)); break;
        case 'bltz': put(L, encB(rel(a[1]), 0, r(a[0]), 4)); break;
        case 'bgez': put(L, encB(rel(a[1]), 0, r(a[0]), 5)); break;
        case 'blez': put(L, encB(rel(a[1]), r(a[0]), 0, 5)); break;
        case 'bgtz': put(L, encB(rel(a[1]), r(a[0]), 0, 4)); break;
        case 'bgt': put(L, encB(rel(a[2]), r(a[0]), r(a[1]), 4)); break;
        case 'ble': put(L, encB(rel(a[2]), r(a[0]), r(a[1]), 5)); break;
        case 'bgtu': put(L, encB(rel(a[2]), r(a[0]), r(a[1]), 6)); break;
        case 'bleu': put(L, encB(rel(a[2]), r(a[0]), r(a[1]), 7)); break;
        default: throw new Error(`line ${n}: unknown instruction '${op}'`);
      }
      if (L.out * 4 !== L.size) throw new Error(`line ${n}: size mismatch`);
      listing.push({ addr: L.addr, words: L.words, src: L.raw.replace(/#.*$/, '').trim(), line: n, labels: L.labels });
    }
    const words = new Uint32Array(text.length);
    text.forEach((w, i) => (words[i] = w || 0));
    return { text: words, data, sym, listing };
  }

  // ---- disassembler ----
  const sx = (v, b) => (v << (32 - b)) >> (32 - b);
  function immI(w) { return w >> 20; }
  function immS(w) { return ((w >> 25) << 5) | ((w >>> 7) & 31); }
  function immB(w) { return sx((((w >>> 31) & 1) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1), 13); }
  function immJ(w) { return sx((((w >>> 31) & 1) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1), 21); }
  const hx = (v) => '0x' + (v >>> 0).toString(16);
  function disasm(w, pc) {
    w |= 0;
    const op = w & 0x7f, rd = ABI[(w >>> 7) & 31], f3 = (w >>> 12) & 7, rs1 = ABI[(w >>> 15) & 31], rs2 = ABI[(w >>> 20) & 31], f7 = (w >>> 25) & 0x7f;
    const pad = (m) => (m + '      ').slice(0, 6);
    switch (op) {
      case 0x37: return [pad('lui'), `${rd}, ${hx(w >>> 12)}`];
      case 0x17: return [pad('auipc'), `${rd}, ${hx(w >>> 12)}`];
      case 0x6f: { const t = (pc + immJ(w)) >>> 0; return rd === 'zero' ? [pad('j'), hx(t)] : rd === 'ra' ? [pad('call'), hx(t)] : [pad('jal'), `${rd}, ${hx(t)}`]; }
      case 0x67: return ((w >>> 7) & 31) === 0 && ((w >>> 15) & 31) === 1 && immI(w) === 0 ? [pad('ret'), ''] : [pad('jalr'), `${rd}, ${immI(w)}(${rs1})`];
      case 0x63: { const m = ['beq', 'bne', '?', '?', 'blt', 'bge', 'bltu', 'bgeu'][f3]; const t = (pc + immB(w)) >>> 0; return ((w >>> 20) & 31) === 0 && f3 < 2 ? [pad(m + 'z'), `${rs1}, ${hx(t)}`] : [pad(m), `${rs1}, ${rs2}, ${hx(t)}`]; }
      case 0x03: return [pad(['lb', 'lh', 'lw', '?', 'lbu', 'lhu', '?', '?'][f3]), `${rd}, ${immI(w)}(${rs1})`];
      case 0x23: return [pad(['sb', 'sh', 'sw', '?', '?', '?', '?', '?'][f3]), `${rs2}, ${immS(w)}(${rs1})`];
      case 0x13: {
        if (f3 === 1) return [pad('slli'), `${rd}, ${rs1}, ${(w >>> 20) & 31}`];
        if (f3 === 5) return [pad(f7 & 0x20 ? 'srai' : 'srli'), `${rd}, ${rs1}, ${(w >>> 20) & 31}`];
        const m = ['addi', '', 'slti', 'sltiu', 'xori', '', 'ori', 'andi'][f3];
        if (f3 === 0 && ((w >>> 15) & 31) === 0) return ((w >>> 7) & 31) === 0 && immI(w) === 0 ? [pad('nop'), ''] : [pad('li'), `${rd}, ${immI(w)}`];
        if (f3 === 0 && immI(w) === 0) return [pad('mv'), `${rd}, ${rs1}`];
        return [pad(m), `${rd}, ${rs1}, ${immI(w)}`];
      }
      case 0x33: {
        if (f7 & 1) return [pad(['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'][f3]), `${rd}, ${rs1}, ${rs2}`];
        const m = f7 & 0x20 ? ['sub', '', '', '', '', 'sra', '', ''][f3] : ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'][f3];
        return [pad(m), `${rd}, ${rs1}, ${rs2}`];
      }
      case 0x0f: return [pad('fence'), ''];
      case 0x73: return [pad(w >>> 20 ? 'ebreak' : 'ecall'), ''];
      default: return [pad('.word'), hx(w)];
    }
  }

  G.ASM = { assemble, disasm, ABI, REG };
})(typeof self !== 'undefined' ? self : globalThis);

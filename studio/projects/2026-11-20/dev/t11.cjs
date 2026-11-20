// random instruction streams: every RV32I+MUL/MULH instruction class, dense RAW / load-use hazards, branches, loops,
// JAL/JALR, all in lockstep against the golden model, with forwarding and prediction on and off
require('./load.cjs')('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js');
const S = SIM.setup();
const D = S.D, rd = SIM.rd, tr = D.trace;

function gen(seed, n) {
  let st = seed >>> 0;
  const r = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const regs = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  const R = () => 'x' + pick(regs), Rs = () => (r() < 0.06 ? 'x0' : r() < 0.1 ? 'x8' : R());
  const out = ['.text', '_start:', '    la x8, buf'];
  for (const x of regs) out.push(`    li x${x}, ${(ri(-2147483648, 2147483647)) | 0}`);
  let lab = 0;
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.22) out.push(`    ${pick(['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and'])} ${R()}, ${Rs()}, ${Rs()}`);
    else if (k < 0.36) out.push(`    ${pick(['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'])} ${R()}, ${Rs()}, ${ri(-2048, 2047)}`);
    else if (k < 0.42) out.push(`    ${pick(['slli', 'srli', 'srai'])} ${R()}, ${Rs()}, ${ri(0, 31)}`);
    else if (k < 0.52) out.push(`    ${pick(['mul', 'mulh'])} ${R()}, ${Rs()}, ${Rs()}`);
    else if (k < 0.55) out.push(`    ${pick(['lui', 'auipc'])} ${R()}, ${ri(0, 0xfffff)}`);
    else if (k < 0.67) { const op = pick(['lb', 'lh', 'lw', 'lbu', 'lhu']); const al = op === 'lw' ? 4 : op[1] === 'h' ? 2 : 1; out.push(`    ${op} ${R()}, ${ri(0, 255) * al}(x8)`); if (r() < 0.5) out.push(`    ${pick(['add', 'xor', 'sub'])} ${R()}, x${0}, ${R()}`); }
    else if (k < 0.77) { const op = pick(['sb', 'sh', 'sw']); const al = op === 'sw' ? 4 : op === 'sh' ? 2 : 1; out.push(`    ${op} ${Rs()}, ${ri(0, 255) * al}(x8)`); }
    else if (k < 0.86) { const l = 'f' + lab++; out.push(`    ${pick(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'])} ${Rs()}, ${Rs()}, ${l}`); for (let j = ri(0, 3); j > 0; j--) out.push(`    addi ${R()}, ${Rs()}, ${ri(-50, 50)}`); out.push(`${l}:`); }
    else if (k < 0.90) { const l = 'j' + lab++; out.push(`    jal ${r() < 0.3 ? 'x0' : R()}, ${l}`); for (let j = ri(0, 2); j > 0; j--) out.push(`    xori ${R()}, ${Rs()}, ${ri(-50, 50)}`); out.push(`${l}:`); }
    else if (k < 0.93) { const t = R(); out.push(`    auipc ${t}, 0`); out.push(`    jalr ${R()}, ${12 + 4 * ri(0, 1)}(${t})`); out.push(`    addi ${R()}, ${Rs()}, 1`); out.push(`    addi ${R()}, ${Rs()}, 2`); }
    else if (k < 0.97) {
      const l = 'L' + lab++; out.push(`    li x9, ${ri(1, 5)}`); out.push(`${l}:`);
      for (let j = ri(1, 5); j > 0; j--) { const q = r(); out.push(q < 0.3 ? `    mul ${R()}, ${Rs()}, ${Rs()}` : q < 0.5 ? `    lw ${R()}, ${ri(0, 255) * 4}(x8)` : `    add ${R()}, ${Rs()}, ${Rs()}`); }
      out.push('    addi x9, x9, -1'); out.push(`    ${r() < 0.5 ? 'bnez x9' : 'blt x0, x9'}, ${l}`);
    }
    else out.push(`    ${pick(['fence', 'ecall', 'ebreak', 'nop'])}`);
  }
  out.push('end:', '    j end', '.data', 'buf:', '    .space 1024');
  return out.join('\n');
}

let total = 0, bad = 0;
for (let seed = +(process.env.S0 || 1); seed <= +(process.env.S1 || 24); seed++) {
  const src = gen(seed * 7919, +(process.env.NI || 900));
  const a = ASM.assemble(src);
  const rom = new Int32Array(4096); rom.set(new Int32Array(a.text.buffer, 0, a.text.length));
  const ram = new Uint8Array(65536);
  let st = seed; for (let i = 0; i < 65536; i++) { st = (Math.imul(st, 1103515245) + 12345) | 0; ram[i] = st >>> 24; }
  for (const [ad, v] of a.data) ram[ad - 0x10000] = v;
  const prog = { rom, ram };
  const fwd = seed % 3 !== 0 ? 1 : 0, btfn = seed % 2;
  const M = new SIM.Machine(D, S.chunks, prog); M.cfgFwd = fwd; M.cfgBtfn = btfn;
  const g = new Golden(rom, ram);
  let last = null, div = 0, ret = 0;
  for (let c = 0; c < 30000; c++) {
    const s = M.evalCycle();
    if (s[D.outs.retire_valid[0]] & 1) {
      const pc = rd(s, tr.retire_pc), we = s[tr.retire_we[0]] & 1, rdn = we ? rd(s, tr.retire_rd) : 0, wd = we ? rd(s, tr.retire_wdata) : 0;
      const x = g.step(); ret++;
      let b = x.pc !== pc || x.rd !== rdn || (x.rd && x.wdata !== wd);
      if (x.st) { if (!last || last.addr !== x.st.addr || last.be !== x.st.be) b = true; else { let m = 0; for (let k = 0; k < 4; k++) if ((x.st.be >> k) & 1) m |= 0xff << (8 * k); if (((last.data ^ x.st.data) & m) !== 0) b = true; } }
      else if (last) b = true;
      if (b) { div++; if (div < 3) console.log('  DIV seed', seed, 'cyc', c, ASM.disasm(x.ir, x.pc).join(' '), { pc: pc.toString(16), rdn, wd, last }, { pc: x.pc.toString(16), rd: x.rd, wdata: x.wdata, st: x.st }); break; }
    }
    last = M.commit();
    M.cyc++;
    if (g.pc === a.sym.end && ret > 50) break;
  }
  total += ret; if (div) bad++;
  console.log(`seed ${String(seed).padStart(2)} fwd ${fwd} btfn ${btfn} words ${a.text.length} retired ${ret} divergences ${div}`);
}
console.log('TOTAL retired', total, 'failing programs', bad);

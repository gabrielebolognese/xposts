// lockstep: gate-level core vs golden model on the Mandelbrot program, with toggle counting
require('./load.cjs')('hdl.js', 'asm.js', 'golden.js', 'prog.js', 'simcore.js');
const prog = PROG.build({ maxit: +(process.argv[3] || 32) });
const S = SIM.setup();
const M = new SIM.Machine(S.D, S.chunks, prog);
M.cfgFwd = +(process.env.FWD ?? 1); M.cfgBtfn = +(process.env.BTFN ?? 1);
const gold = new Golden(prog.rom, prog.ram);
const rd = SIM.rd, tr = S.D.trace, D = S.D;
const cycles = +(process.argv[2] || 200000);
const togg = process.argv[4] !== 'notog';
let instret = 0, div = 0, lastStore = null, tog = 0;
const prev = new Int32Array(D.n), heat = new Uint16Array(D.n);
const t0 = Date.now();
for (let c = 0; c < cycles; c++) {
  const s = M.evalCycle();
  if (togg) { let t = 0; for (let i = D.dffStart, n = D.n; i < n; i++) { const v = s[i], d = (v ^ prev[i]) & 1; prev[i] = v; heat[i] += d; t += d; } tog += t; }
  if (s[D.outs.retire_valid[0]] & 1) {
    const pc = rd(s, tr.retire_pc), we = s[tr.retire_we[0]] & 1, rdn = we ? rd(s, tr.retire_rd) : 0, wd = we ? rd(s, tr.retire_wdata) : 0;
    const g = gold.step();
    instret++;
    let bad = g.pc !== pc || g.rd !== rdn || (g.rd && g.wdata !== wd);
    if (g.st) { if (!lastStore || lastStore.addr !== g.st.addr || lastStore.be !== g.st.be) bad = true; else { let m = 0; for (let k = 0; k < 4; k++) if ((g.st.be >> k) & 1) m |= 0xff << (8 * k); if (((lastStore.data ^ g.st.data) & m) !== 0) bad = true; } }
    else if (lastStore) bad = true;
    if (bad) { div++; if (div < 5) console.log('DIVERGENCE cycle', c, 'instret', instret, { pc: pc.toString(16), rdn, wd, lastStore }, { pc: g.pc.toString(16), rd: g.rd, wdata: g.wdata, st: g.st }, ASM.disasm(g.ir, g.pc).join(' ')); }
  }
  lastStore = M.commit();
  M.cyc++;
}
const dt = (Date.now() - t0) / 1000;
console.log('cycles', cycles, 'instret', instret, 'IPC', (instret / cycles).toFixed(3), 'divergences', div, 'sec', dt.toFixed(2), 'Hz', Math.round(cycles / dt), 'toggles/cyc', (tog / cycles).toFixed(1), 'alpha', (tog / cycles / (D.n - D.dffStart)).toFixed(4));
const u = String.fromCharCode(...M.uart);
console.log(u.slice(-300));
console.log('golden uart same:', String.fromCharCode(...gold.uart) === u);

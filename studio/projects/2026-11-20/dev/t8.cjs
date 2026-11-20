require('./load.cjs')('asm.js', 'golden.js', 'prog.js');
for (const [w0, maxit] of [[2.88, 32], [2.4, 32], [2.0, 32], [1.6, 32], [3.2, 32]]) {
  PROG.VIEW.width0 = w0;
  const prog = PROG.build({ maxit });
  const g = new Golden(prog.rom, prog.ram);
  let last = 0, nl = 0, frames = [];
  for (let i = 0; i < 12e6 && frames.length < 5; i++) {
    g.step();
    if (g.uart.length > nl) { const s = String.fromCharCode(...g.uart.slice(nl)); nl = g.uart.length; if (s.includes('\n') && String.fromCharCode(...g.uart).split('\n').slice(-2)[0].startsWith('f=')) { frames.push([g.n - last, String.fromCharCode(...g.uart).split('\n').slice(-2)[0]]); last = g.n; } }
  }
  console.log('w0', w0, 'maxit', maxit, frames.map(([n, l]) => `${(n / 0.953 / 24000).toFixed(1)}s ${l}`).join(' | '));
}

importScripts('../hdl.js', '../asm.js', '../golden.js', '../prog.js', '../simcore.js', 'wasmtog.js');
onmessage = (e) => {
  const N = HDL.buildCore(); const D = HDL.finalize(N);
  const out = [];
  const time = (label, n, fn) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); out.push(label + ' ' + ((performance.now() - t0) * 1000 / n).toFixed(2) + ' us'); };
  const n4 = (D.n + 3) & ~3;
  const pages = Math.ceil((n4 * 12) / 65536) + 1;
  const mem = new WebAssembly.Memory({ initial: pages });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(wasmTogModule(pages)), { env: { mem } });
  const ws = new Int32Array(mem.buffer, 0, D.n);
  const s = new Int32Array(D.n); s[1] = -1;
  let seed = 1; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) | 0);
  const noise = () => { for (let i = D.dffStart; i < D.gateStart; i += 3) s[i] = -(rnd() & 1); };
  const f = HDL.emitChunks(D, 560).map((c) => new Function('s', '"use strict";return function(){' + c.src + '}')(s));
  const tog = inst.exports.tog;
  const ev = () => { noise(); for (let k = 0; k < f.length; k++) f[k](); };
  const evT = () => { noise(); for (let k = 0; k < f.length; k++) f[k](); ws.set(s); return tog(0, n4 * 4, n4 * 4, n4 * 8); };
  for (let i = 0; i < 40000; i++) { ev(); evT(); }
  time('noise only', 20000, noise);
  time('eval', 20000, ev);
  time('eval + copy + wasm tog', 20000, evT);
  time('copy only', 20000, () => ws.set(s));
  postMessage(out.join('\n'));
};

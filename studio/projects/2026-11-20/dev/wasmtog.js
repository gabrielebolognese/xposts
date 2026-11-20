// hand-assembled WebAssembly (SIMD) toggle pass: for i in [start,end) step 16 bytes:
//   d = s ^ p; p = s; h -= d; acc -= d   (every net is 0 or -1 in the single-machine sim, so -d counts toggles)
function wasmTogModule(pages) {
  const u = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
  const sec = (id, body) => [id, ...u(body.length), ...body];
  const str = (s) => [...u(s.length), ...[...s].map((c) => c.charCodeAt(0))];
  const get = (k) => [0x20, k], set = (k) => [0x21, k];
  const load = [0xfd, 0x00, 0x02, 0x00], store = [0xfd, 0x0b, 0x02, 0x00], xor = [0xfd, 0x51], sub4 = [0xfd, 0xb1, 0x01];
  const lane = (k) => [0xfd, 0x1b, k], add = [0x6a];
  const code = [
    0x02, 0x40, 0x03, 0x40,
    ...get(0), ...get(1), 0x4f, 0x0d, 0x01,
    ...get(0), ...load, ...set(4),
    ...get(4), ...get(0), ...get(2), ...add, ...load, ...xor, ...set(5),
    ...get(0), ...get(2), ...add, ...get(4), ...store,
    ...get(0), ...get(3), ...add, ...get(0), ...get(3), ...add, ...load, ...get(5), ...sub4, ...store,
    ...get(6), ...get(5), ...sub4, ...set(6),
    ...get(0), 0x41, 0x10, ...add, ...set(0), 0x0c, 0x00,
    0x0b, 0x0b,
    ...get(6), ...lane(0), ...get(6), ...lane(1), ...add, ...get(6), ...lane(2), ...add, ...get(6), ...lane(3), ...add,
    0x0b,
  ];
  const body = [0x01, 0x03, 0x7b, ...code];
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...sec(1, [0x01, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f]),
    ...sec(2, [0x01, ...str('env'), ...str('mem'), 0x02, 0x00, ...u(pages)]),
    ...sec(3, [0x01, 0x00]),
    ...sec(7, [0x01, ...str('tog'), 0x00, 0x00]),
    ...sec(10, [0x01, ...u(body.length), ...body]),
  ];
  return new Uint8Array(bytes);
}

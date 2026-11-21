(() => {
  const E = window.EHT, N = 96, EH = 80, UAS = Math.PI / 180 / 3600e6, d = 2 * EH / N;
  const ax = { l0: (EH - d / 2) * UAS, dl: -d * UAS, m0: (-EH + d / 2) * UAS, dm: d * UAS };
  const toPng = (img, scale = 3) => { const c = document.createElement('canvas'); c.width = N * scale; c.height = N * scale; const x = c.getContext('2d'); let mx = 0; for (const v of img) mx = Math.max(mx, v);
    for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) { const t = Math.max(0, img[y * N + i] / mx); const col = GLX.inferno(Math.sqrt(t)); x.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`; x.fillRect(i * scale, (N - 1 - y) * scale, scale, scale); } return c.toDataURL('image/png'); };
  // synthetic ring: d = 50 uas, brighter on the left (alpha < 0)
  const ring = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const al = -EH + (x + 0.5) * d, be = -EH + (y + 0.5) * d; const r = Math.hypot(al, be); ring[y * N + x] = Math.exp(-((r - 25) ** 2) / (2 * 2.5 ** 2)) * (1 - 0.6 * al / 25); }
  const uv = []; for (let i = -20; i <= 20; i++) for (let j = 0; j <= 20; j++) { if (j === 0 && i <= 0) continue; uv.push(i * 0.4e9, j * 0.4e9); }
  const V = E.vis(ring, ax, Float64Array.from(uv));
  const K = uv.length / 2, pts = new Float64Array(K * 5);
  let v0 = 0; for (const v of ring) v0 += v;
  for (let k = 0; k < K; k++) pts.set([uv[2 * k], uv[2 * k + 1], 1 / (2 * K), V.re[k] / v0, V.im[k] / v0], 5 * k);
  const dirty = E.dirty(ax, pts, 0, N, false);
  // the model 230 GHz image at the current time
  const X = APP.eht;
  return { ring: toPng(ring), dirtyRing: toPng(dirty), model: toPng(X.img), modelBlur: toPng(X.imgBlur), dirtyNow: toPng(X.dirty), beam: toPng(X.beam) };
})()

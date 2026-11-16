// Engine Room: chess pieces as vector paths, drawn by hand on a 100 x 100 grid (base at y = 88). No glyphs, no images.
'use strict';
const PIECES = (() => {
  const base = 'M22 88 Q20 88 20 86 L20 83 Q20 80 23 80 L77 80 Q80 80 80 83 L80 86 Q80 88 78 88 Z M27 80 L28 74 Q28 72 31 72 L69 72 Q72 72 72 74 L73 80 Z';
  const d = {
    1: base + ' M50 16 A11 11 0 1 1 49.99 16 Z M38 39 Q38 37 41 37 L59 37 Q62 37 62 39 L62 43 Q62 45 59 45 L41 45 Q38 45 38 43 Z' +
      ' M42 45 C42 56 37 64 33 72 L67 72 C63 64 58 56 58 45 Z',
    2: base + ' M33 72 C33 61 38 54 45 48 C39 50 32 54 27 57 C23 60 17 58 17 53 C17 49 20 46 24 42 C30 35 34 27 40 21 L38 10 L47 17' +
      ' C52 15 58 16 62 19 C72 26 78 40 76 55 C75 63 72 68 70 72 Z',
    3: base + ' M38 72 C38 62 42 56 44 51 L56 51 C58 56 62 62 62 72 Z M35 47 Q35 44 38 44 L62 44 Q65 44 65 47 Q65 51 62 51 L38 51 Q35 51 35 47 Z' +
      ' M50 15 C63 23 68 33 63 44 L37 44 C32 33 37 23 50 15 Z M50 4 A5 5 0 1 1 49.99 4 Z',
    4: base + ' M33 72 L35 41 L65 41 L67 72 Z M27 35 L73 35 L73 41 L27 41 Z' +
      ' M26 35 L26 15 L36 15 L36 22 L45 22 L45 15 L55 15 L55 22 L64 22 L64 15 L74 15 L74 35 Z',
    5: base + ' M34 72 C37 61 39 53 37 45 L63 45 C61 53 63 61 66 72 Z M31 45 Q31 41 35 41 L65 41 Q69 41 69 45 Q69 49 65 49 L35 49 Q31 49 31 45 Z' +
      ' M31 41 L24 19 L35 31 L37 14 L45 29 L50 12 L55 29 L63 14 L65 31 L76 19 L69 41 Z' +
      ' M24 11.5 A3.6 3.6 0 1 1 23.99 11.5 Z M37 6.5 A3.6 3.6 0 1 1 36.99 6.5 Z M50 4.5 A3.6 3.6 0 1 1 49.99 4.5 Z M63 6.5 A3.6 3.6 0 1 1 62.99 6.5 Z M76 11.5 A3.6 3.6 0 1 1 75.99 11.5 Z',
    6: base + ' M34 72 C37 62 39 55 37 47 L63 47 C61 55 63 62 66 72 Z M31 47 C26 38 29 28 39 28 C44 28 48 31 50 35 C52 31 56 28 61 28 C71 28 74 38 69 47 Z' +
      ' M47 7 L53 7 L53 13 L59 13 L59 19 L53 19 L53 29 L47 29 L47 19 L41 19 L41 13 L47 13 Z',
  };
  // inner detail lines (drawn in the contrast colour)
  const det = {
    1: 'M37 72 L63 72',
    2: 'M58 22 C66 30 70 42 69 56 M62 28 C66 34 67 41 66 48 M30 40 C33 37 36 33 38 29',
    3: 'M54 23 L46 35 M38 72 L62 72',
    4: 'M33 47 L67 47 M33 66 L67 66',
    5: 'M37 57 L63 57',
    6: 'M31 47 L69 47 M37 58 L63 58 M50 35 L50 46',
  };
  const fill = {}, detail = {};
  for (const k in d) { fill[k] = new Path2D(d[k]); detail[k] = new Path2D(det[k]); }
  const eye = new Path2D('M37.5 31 A2.4 2.4 0 1 1 37.49 31 Z M21.5 51.5 A1.4 1.4 0 1 1 21.49 51.5 Z');
  const cache = new WeakMap();
  function grad(ctx, white) {
    let m = cache.get(ctx);
    if (!m) cache.set(ctx, (m = {}));
    const key = white ? 'w' : 'b';
    let g = m[key];
    if (g) return g;
    g = ctx.createLinearGradient(15, 0, 85, 0);
    if (white) { g.addColorStop(0, '#FFF8E8'); g.addColorStop(0.55, '#F4EAD5'); g.addColorStop(1, '#D8C39E'); }
    else { g.addColorStop(0, '#4A3B2E'); g.addColorStop(0.5, '#2A211A'); g.addColorStop(1, '#17110C'); }
    m[key] = g;
    return g;
  }
  // draws piece p (1-6 white, 9-14 black) with its box at (x, y), size s px
  function draw(ctx, p, x, y, s, alpha = 1) {
    const t = p & 7, white = p < 8;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(s / 100, s / 100);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(51, 89, 31, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = grad(ctx, white);
    ctx.fill(fill[t]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = white ? '#2A211A' : '#B59B78';
    ctx.stroke(fill[t]);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = white ? 'rgba(42,33,26,0.75)' : 'rgba(232,211,167,0.55)';
    ctx.stroke(detail[t]);
    if (t === 2) { ctx.fillStyle = white ? '#2A211A' : '#E8D3A7'; ctx.fill(eye); }
    ctx.restore();
  }
  return { draw };
})();

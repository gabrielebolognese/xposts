// Every Gate: shared drawing helpers. Palette, fonts, DPR-sized canvases, panel chrome, number formatting.
(function (G) {
  'use strict';
  const DPR = window.devicePixelRatio || 1;
  const P = {
    bg: '#06070A', surface: '#0D0F14', surface2: '#10131A', line: '#1E232C', line2: '#272D38', text: '#D9DFEA', muted: '#6A7386', dim: '#3E4554',
    blue: '#3D8BFF', magenta: '#D25CFF', red: '#FF4D5E', green: '#36D27A', gold: '#FFC24A', cyan: '#3FE0DC',
    up: '#36D27A', down: '#FF5C5C', warn: '#FFB020', active: '#FFE55C',
  };
  const F = {
    mono: (px, w = 400) => `${w} ${px}px 'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console', monospace`,
    title: (px = 11, w = 600) => `${w} ${px}px 'Bahnschrift SemiCondensed', Bahnschrift, 'Segoe UI Variable', 'Segoe UI', sans-serif`,
    ui: (px = 11, w = 400) => `${w} ${px}px 'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', sans-serif`,
  };
  const stage = () => document.getElementById('stage');

  function canvas(x, y, w, h, z = 1) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
    Object.assign(c.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', zIndex: z });
    stage().appendChild(c);
    const ctx = c.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    return { c, ctx, x, y, w, h };
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function mix(h1, h2, t) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t), g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t), bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return `rgb(${r},${g},${bl})`;
  }

  // Panel chrome: surface, 1 px border, 22 px title bar with an uppercase spaced title
  function frame(ctx, w, h, title, sub, right, rightColor) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = P.surface; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0A0C10'; ctx.fillRect(0, 0, w, 22);
    ctx.strokeStyle = P.line; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.beginPath(); ctx.moveTo(0, 22.5); ctx.lineTo(w, 22.5); ctx.stroke();
    ctx.fillStyle = P.blue; ctx.fillRect(8, 8, 2, 7);
    ctx.font = F.title(11, 600); ctx.letterSpacing = '1.2px'; ctx.fillStyle = P.text; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(title.toUpperCase(), 15, 12);
    let x = 15 + ctx.measureText(title.toUpperCase()).width + 10;
    ctx.letterSpacing = '0px';
    if (sub) { ctx.font = F.ui(11); ctx.fillStyle = P.muted; ctx.fillText(sub, x, 12); }
    if (right) { ctx.font = F.mono(10); ctx.fillStyle = rightColor || P.muted; ctx.textAlign = 'right'; ctx.fillText(right, w - 8, 12); ctx.textAlign = 'left'; }
  }

  function text(ctx, s, x, y, font, color, align = 'left', base = 'middle') {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y);
  }
  // small uppercase label
  function label(ctx, s, x, y, color = P.muted, align = 'left', px = 9) {
    ctx.font = F.title(px, 600); ctx.letterSpacing = '0.8px'; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(s.toUpperCase(), x, y); ctx.letterSpacing = '0px';
  }
  function hline(ctx, x0, x1, y, color = P.line) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); }
  function vline(ctx, x, y0, y1, color = P.line) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); ctx.stroke(); }
  function box(ctx, x, y, w, h, color = P.line) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1); }

  const fmt = {
    int: (v) => Math.round(v).toLocaleString('en-US'),
    hex8: (v) => (v >>> 0).toString(16).padStart(8, '0'),
    hex: (v, n) => (v >>> 0).toString(16).padStart(n, '0'),
    fix: (v, d) => (isFinite(v) ? v.toFixed(d) : '-'),
    si: (v, d = 1) => (v >= 1e9 ? (v / 1e9).toFixed(d) + ' G' : v >= 1e6 ? (v / 1e6).toFixed(d) + ' M' : v >= 1e3 ? (v / 1e3).toFixed(d) + ' k' : v.toFixed(0) + ' '),
    pct: (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '-'),
  };

  G.UI = { DPR, P, F, canvas, frame, text, label, hline, vline, box, rgba, mix, fmt, stage };
})(window);

// Canvas 2D helpers: palette, fonts, panel chrome, number formatting.
(function (G) {
  'use strict';
  const UI = {};
  UI.C = {
    bg: '#07060A', surface: '#0F0D14', line: '#28222F', text: '#ECE4D8', muted: '#8C8397', dim: '#5E5669',
    amber: '#FFB63D', orange: '#FF6A1A', magenta: '#D1357A', cyan: '#59D8FF', violet: '#8F7BFF', white: '#F4F1E8',
    up: '#6BE38A', down: '#FF5468', warn: '#FFC93D', active: '#59D8FF', grid: '#1C1823', faint: '#16131C',
  };
  UI.F = {
    title: (px = 13) => `600 ${px}px Bahnschrift`,
    big: (px = 20) => `600 ${px}px Bahnschrift`,
    mono: (px = 10) => `${px}px "Cascadia Mono", "Cascadia Code", Consolas, monospace`,
    monoB: (px = 10) => `600 ${px}px "Cascadia Mono", "Cascadia Code", Consolas, monospace`,
    label: (px = 10) => `${px}px "Segoe UI Variable Small", "Segoe UI Variable", "Segoe UI", sans-serif`,
    labelB: (px = 10) => `600 ${px}px "Segoe UI Variable Small", "Segoe UI Variable", "Segoe UI", sans-serif`,
  };
  // live: CPU raster for the 2D panels, so the iGPU stays free for the ray tracer; render (controlled clock): GPU raster
  UI.ctxOpts = () => (window.STUDIO && STUDIO.mode === 'render' ? {} : { willReadFrequently: true });
  UI.dpr = () => Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  // a canvas placed on the stage at (x, y, w, h) in stage px, backing store scaled by devicePixelRatio
  UI.canvas = (x, y, w, h, cls = 'ov', id, noCtx = false) => {
    const c = document.createElement('canvas');
    const d = UI.dpr();
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    Object.assign(c.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    if (cls) c.className = cls;
    if (id) c.id = id;
    document.getElementById('stage').appendChild(c);
    if (noCtx) return { c, ctx: null, x, y, w, h, d };
    const ctx = c.getContext('2d', UI.ctxOpts());
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
    return { c, ctx, x, y, w, h, d };
  };

  UI.setFont = (ctx, f, stretch) => {
    const st = stretch || 'normal';
    if (ctx._f !== f) { ctx.font = f; ctx._f = f; }
    if (ctx._st !== st && 'fontStretch' in ctx) { ctx.fontStretch = st; ctx._st = st; }
  };
  // title text in Bahnschrift SemiCondensed
  UI.title = (ctx, s, x, y, px = 12, color = UI.C.text, align = 'left') => {
    UI.setFont(ctx, UI.F.title(px), 'semi-condensed');
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  UI.big = (ctx, s, x, y, px = 20, color = UI.C.text, align = 'left') => {
    UI.setFont(ctx, UI.F.big(px), 'semi-condensed');
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  UI.mono = (ctx, s, x, y, color = UI.C.text, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.monoB(px) : UI.F.mono(px), 'normal');
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  UI.label = (ctx, s, x, y, color = UI.C.muted, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.labelB(px) : UI.F.label(px), 'normal');
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
  };
  const wCache = new Map();
  // widths measured before the system fonts finished loading would be wrong: drop the cache when they are ready
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => wCache.clear());
  UI.clearWidths = () => wCache.clear();
  UI.textW = (ctx, s, f) => {
    const k = f + '|' + s;
    let w = wCache.get(k);
    if (w === undefined) { UI.setFont(ctx, f, 'normal'); w = ctx.measureText(s).width; if (wCache.size > 4000) wCache.clear(); wCache.set(k, w); }
    return w;
  };

  // panel background, hairline border and title strip
  UI.panel = (ctx, w, h, title, tag, opts = {}) => {
    ctx.fillStyle = UI.C.surface;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = UI.C.line; ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    if (title) {
      UI.title(ctx, title, 8, 15, 12, UI.C.text);
      if (tag) UI.label(ctx, tag, w - 8, 14, UI.C.muted, 'right', 10);
      ctx.fillStyle = UI.C.line;
      ctx.fillRect(1, 21, w - 2, 1);
      if (opts.mark) { ctx.fillStyle = opts.mark; ctx.fillRect(1, 1, 2, 20); }
    }
  };

  // number formatting
  UI.fx = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
  UI.int = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
  UI.sci = (v, d = 2) => {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(v)));
    const m = v / 10 ** e;
    return m.toFixed(d) + 'e' + (e < 0 ? '−' + -e : e);
  };
  UI.si = (v, d = 2) => {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(d) + ' G';
    if (a >= 1e6) return (v / 1e6).toFixed(d) + ' M';
    if (a >= 1e3) return (v / 1e3).toFixed(d) + ' k';
    return v.toFixed(d) + ' ';
  };
  UI.neg = (s) => String(s).replace(/-/g, '−');
  UI.hhmm = (sec) => {
    const s = ((Math.floor(sec) % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
  };
  UI.rgba = (col, a) => {
    if (col[0] === 'r') { const m = col.match(/[\d.]+/g); return `rgba(${m[0]},${m[1]},${m[2]},${a})`; } // rgb(...) strings too
    const n = parseInt(col.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  UI.mix = (h1, h2, t) => {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const c = [16, 8, 0].map((s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  // crisp 1 px lines: snap to half pixels
  UI.hline = (ctx, x0, x1, y, color) => { ctx.fillStyle = color; ctx.fillRect(x0, Math.round(y), x1 - x0, 1); };
  UI.vline = (ctx, x, y0, y1, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), y0, 1, y1 - y0); };

  G.UI = UI;
})(window);

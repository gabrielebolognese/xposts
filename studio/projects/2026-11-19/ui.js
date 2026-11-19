// Xenon Night: the cockpit. Static frames on one canvas, a canvas per panel redrawn at its own rhythm (a small
// scheduler keeps every frame inside the budget), WebGL heatmaps for the core and the four field maps.
(function () {
  'use strict';
  const DPR = window.devicePixelRatio || 1;
  const NA = 17, N = 136;
  const DAY = 1440;
  const COLS = 'ABCDEFGHJKLMNPQRS';
  const PAL = {
    bg: '#05090F', surf: '#0B1320', surf2: '#0E1828', line: '#1A2A3D', line2: '#24384F', text: '#D6E4F0', muted: '#5F7790',
    dim: '#3A4E66', blue: '#3FB8FF', cyan: '#6FE3FF', violet: '#9B8CFF', amber: '#FFB547', white: '#F2F7FF',
    up: '#47E0A0', down: '#FF5D5D', warn: '#FFB547',
  };
  const TITLE = '"Bahnschrift SemiCondensed", Bahnschrift, "Segoe UI", sans-serif';
  const MONO = '"Cascadia Mono", "Cascadia Code", Consolas, "Lucida Console", monospace';
  const CAP = '"Segoe UI Variable Small", "Segoe UI Variable", "Segoe UI", sans-serif';
  const FT = (px, w = 600) => `${w} ${px}px ${TITLE}`;
  const FM = (px, w = 400) => `${w} ${px}px ${MONO}`;
  const FC = (px, w = 400) => `${w} ${px}px ${CAP}`;
  const MINUS = '−';
  // signed / negative formats that never print a negative zero
  const sgn = (v, d = 0) => {
    const a = Math.abs(v).toFixed(d);
    return (+a === 0 ? '' : v > 0 ? '+' : MINUS) + a;
  };
  const neg = (v, d = 0) => {
    const a = Math.abs(v).toFixed(d);
    return (+a !== 0 && v < 0 ? MINUS : '') + a;
  };
  // exponent notation with the mantissa normalised to [1, 10) after rounding
  const fe = (v, d = 2) => {
    if (!isFinite(v) || v === 0) return '0';
    let e = Math.floor(Math.log10(Math.abs(v)));
    let m = v / Math.pow(10, e);
    if (Math.abs(+m.toFixed(d)) >= 10) {
      e += 1;
      m = v / Math.pow(10, e);
    }
    return `${m.toFixed(d)}e${e}`;
  };
  const clock = (t) => {
    const d = Math.floor(t / DAY) + 1, m = Math.floor(t - (d - 1) * DAY + 1e-6);
    return `D${d} ${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const hhmm = (t) => {
    const m = Math.floor(((t % DAY) + DAY) % DAY + 1e-6);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  const R = {
    status: { x: 8, y: 8, w: 1904, h: 40 },
    controls: { x: 8, y: 56, w: 352, h: 452 },
    kinetics: { x: 8, y: 516, w: 352, h: 236 },
    log: { x: 8, y: 760, w: 352, h: 312 },
    core: { x: 368, y: 56, w: 760, h: 760 },
    solver: { x: 368, y: 824, w: 376, h: 248 },
    montecarlo: { x: 752, y: 824, w: 376, h: 248 },
    xenon: { x: 1136, y: 56, w: 776, h: 226 },
    loadfollow: { x: 1136, y: 290, w: 776, h: 190 },
    tilt: { x: 1136, y: 488, w: 776, h: 170 },
    fields: { x: 1136, y: 666, w: 776, h: 196 },
    compute: { x: 1136, y: 870, w: 776, h: 202 },
  };
  // core map geometry (local to the core panel)
  const MAP = { x: 32, y: 36, s: 680 };
  const PX = { x: 32, y: 36 + 680 + 2, w: 680, h: 41 }; // x-profile strip under the map (top 11 px: legend band)
  const PY = { x: 32 + 680 + 2, y: 36, w: 44, h: 680 }; // y-profile strip right of the map (right 11 px: label band)
  const PBAND = 11, PROF1 = '#3FB8FF', PROF2 = '#B8F4FF'; // fast flux blue, thermal flux pale cyan
  const AS = MAP.s / NA; // 40 px per assembly
  // shared 48 h time axis of the right column (local x)
  const TX0 = 52, TX1 = 596, TBACK = 44 * 60, TFWD = 4 * 60;

  const stage = document.getElementById('stage');
  function mk(r, z) {
    const c = document.createElement('canvas');
    c.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;z-index:${z || 1}`;
    c.width = Math.round(r.w * DPR);
    c.height = Math.round(r.h * DPR);
    stage.appendChild(c);
    const ctx = c.getContext('2d');
    ctx.scale(DPR, DPR);
    return { c, ctx, x: r.x, y: r.y, w: r.w, h: r.h };
  }
  function setStretch(ctx) {
    try {
      ctx.fontStretch = 'semi-condensed';
    } catch (e) {}
  }
  function T(ctx, s, x, y, font, color, align) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.fillText(s, x, y);
  }
  function hline(ctx, x0, x1, y, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(y) + 0.5);
    ctx.lineTo(x1, Math.round(y) + 0.5);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }
  function vline(ctx, x, y0, y1, color, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, y0);
    ctx.lineTo(Math.round(x) + 0.5, y1);
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }
  function rect(ctx, x, y, w, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }
  function hexA(h, a) {
    const n = parseInt(h.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  // label above / value below (instrument readout)
  function readout(ctx, x, y, label, value, color, unit, align = 'left', vfont = FM(12, 600)) {
    setStretch(ctx);
    T(ctx, label, x, y, FT(9, 600), PAL.muted, align);
    ctx.font = vfont;
    ctx.fillStyle = color || PAL.text;
    ctx.textAlign = align;
    ctx.fillText(value, x, y + 13);
    if (unit) {
      const w = ctx.measureText(value).width;
      T(ctx, unit, align === 'left' ? x + w + 3 : x - w - 3, y + 13, FC(9), PAL.muted, align);
    }
  }
  // key / value row (label left, value right-aligned)
  function kv(ctx, x0, x1, y, label, value, color, unit) {
    setStretch(ctx);
    T(ctx, label, x0, y, FT(9.5, 500), PAL.muted);
    let xr = x1;
    if (unit) {
      T(ctx, unit, x1, y, FC(8.5), PAL.muted, 'right');
      ctx.font = FC(8.5);
      xr = x1 - ctx.measureText(unit).width - 3;
    }
    T(ctx, value, xr, y, FM(10, 600), color || PAL.text, 'right');
  }

  // ---------- canvases ----------
  const bg = mk({ x: 0, y: 0, w: 1920, h: 1080 }, 0);
  const coreGLc = document.createElement('canvas');
  coreGLc.style.cssText = `position:absolute;left:${R.core.x + MAP.x}px;top:${R.core.y + MAP.y}px;width:${MAP.s}px;height:${MAP.s}px;z-index:1`;
  coreGLc.width = Math.round(MAP.s * DPR);
  coreGLc.height = Math.round(MAP.s * DPR);
  stage.appendChild(coreGLc);
  const FIELDS_GL = { x: R.fields.x, y: R.fields.y + 24, w: R.fields.w, h: 140 };
  const fieldGLc = document.createElement('canvas');
  fieldGLc.style.cssText = `position:absolute;left:${FIELDS_GL.x}px;top:${FIELDS_GL.y}px;width:${FIELDS_GL.w}px;height:${FIELDS_GL.h}px;z-index:1`;
  fieldGLc.width = Math.round(FIELDS_GL.w * DPR);
  fieldGLc.height = Math.round(FIELDS_GL.h * DPR);
  stage.appendChild(fieldGLc);
  const tracksC = mk({ x: R.core.x + MAP.x, y: R.core.y + MAP.y, w: MAP.s, h: MAP.s }, 2);
  const coreStatic = mk(R.core, 3);
  const coreNums = mk(R.core, 4);
  const coreFx = mk(R.core, 5);
  const P = {};
  for (const k of ['status', 'controls', 'kinetics', 'log', 'solver', 'montecarlo', 'xenon', 'loadfollow', 'tilt', 'fields', 'compute']) P[k] = mk(R[k], 6);
  let heatCore = null, heatFields = null;
  try {
    heatCore = window.HEAT.create(coreGLc, DPR, true);
    heatFields = window.HEAT.create(fieldGLc, DPR);
  } catch (e) {
    console.error(String(e));
  }

  // ---------- static background: panel frames and titles ----------
  const TITLES = {
    controls: ['OPERATOR CONTROLS', 'OPERATION · CONTROL · FEEDBACK · SOLVER · MC'],
    kinetics: ['ROD-STEP KINETICS', 'INHOUR · 6 GROUPS'],
    log: ['EVENT LOG', ''],
    core: ['CORE MAP', '17×17 ASSEMBLIES · 20 cm PITCH · 2.5 cm MESH · 136×136'],
    solver: ['DIFFUSION SOLVER', 'TWO-GROUP · POWER ITERATION · RED-BLACK SOR'],
    montecarlo: ['MONTE CARLO TRANSPORT', '6 WORKERS · WOODCOCK DELTA TRACKING'],
    xenon: ['IODINE-135 · XENON-135', 'CORE AVERAGE · 48 h'],
    loadfollow: ['LOAD FOLLOW · CONTROL', 'DEMAND · POWER · BANK D · BORON'],
    tilt: ['QUADRANT TILT · PEAKING', 'QPTR · F_xy · F_cell'],
    fields: ['FIELD MAPS', 'ABSOLUTE UNITS · 136×136 CELLS'],
    compute: ['COMPUTE PLANT', ''],
  };
  function drawBackground() {
    const g = bg.ctx;
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, 1920, 1080);
    // faint blueprint grid
    g.strokeStyle = 'rgba(26,42,61,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= 1920; x += 24) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, 1080);
    }
    for (let y = 0; y <= 1080; y += 24) {
      g.moveTo(0, y + 0.5);
      g.lineTo(1920, y + 0.5);
    }
    g.stroke();
    for (const [k, r] of Object.entries(R)) {
      g.fillStyle = PAL.surf;
      g.fillRect(r.x, r.y, r.w, r.h);
      if (k === 'core') {
        const cx = r.x + MAP.x + MAP.s / 2, cy = r.y + MAP.y + MAP.s / 2;
        const gr = g.createRadialGradient(cx, cy, 250, cx, cy, 470);
        gr.addColorStop(0, 'rgba(63,184,255,0.16)');
        gr.addColorStop(0.45, 'rgba(63,184,255,0.06)');
        gr.addColorStop(1, 'rgba(63,184,255,0)');
        g.fillStyle = gr;
        g.fillRect(r.x + MAP.x, r.y + MAP.y, MAP.s, MAP.s);
      }
      rect(g, r.x, r.y, r.w, r.h, PAL.line);
      if (k === 'status') continue;
      // title strip
      g.fillStyle = PAL.surf2;
      g.fillRect(r.x + 1, r.y + 1, r.w - 2, 19);
      hline(g, r.x + 1, r.x + r.w - 1, r.y + 20, PAL.line);
      g.fillStyle = PAL.blue;
      g.fillRect(r.x + 7, r.y + 7, 3, 7);
      setStretch(g);
      g.letterSpacing = '1px';
      T(g, TITLES[k][0], r.x + 15, r.y + 14, FT(11, 700), PAL.text);
      g.font = FT(11, 700);
      const tw = g.measureText(TITLES[k][0]).width;
      g.letterSpacing = '0.5px';
      if (TITLES[k][1]) T(g, TITLES[k][1], r.x + 15 + tw + 10, r.y + 14, FT(9, 500), PAL.muted);
      g.letterSpacing = '0px';
      // corner ticks
      g.fillStyle = PAL.line2;
      g.fillRect(r.x, r.y, 4, 1);
      g.fillRect(r.x, r.y, 1, 4);
      g.fillRect(r.x + r.w - 4, r.y + r.h - 1, 4, 1);
      g.fillRect(r.x + r.w - 1, r.y + r.h - 4, 1, 4);
    }
  }

  // ---------- core map statics ----------
  let CM = null; // core material per assembly
  function coreAsm() {
    const Q = [
      [3, 2, 2, 2, 3, 2, 2, 1, 4], [2, 2, 2, 2, 2, 2, 2, 1, 4], [2, 2, 2, 2, 2, 2, 1, 1, 4], [2, 2, 2, 2, 2, 2, 1, 4, 4],
      [3, 2, 2, 2, 3, 1, 1, 4, 0], [2, 2, 2, 2, 1, 1, 4, 4, 0], [2, 2, 1, 1, 1, 4, 4, 0, 0], [1, 1, 1, 4, 4, 4, 0, 0, 0],
      [4, 4, 4, 4, 0, 0, 0, 0, 0],
    ];
    const m = new Int8Array(NA * NA);
    for (let ar = 0; ar < NA; ar++) for (let ac = 0; ac < NA; ac++) m[ar * NA + ac] = Q[Math.abs(ar - 8)][Math.abs(ac - 8)];
    return m;
  }
  function drawCoreStatic() {
    const g = coreStatic.ctx;
    g.clearRect(0, 0, coreStatic.w, coreStatic.h);
    const x0 = MAP.x, y0 = MAP.y;
    // column letters and row numbers
    setStretch(g);
    for (let i = 0; i < NA; i++) {
      T(g, COLS[i], x0 + i * AS + AS / 2, y0 - 5, FT(9, 600), PAL.muted, 'center');
      T(g, String(i + 1), x0 - 6, y0 + i * AS + AS / 2 + 3, FT(9, 600), PAL.muted, 'right');
    }
    // assembly grid inside the core
    g.strokeStyle = 'rgba(5,9,15,0.55)';
    g.lineWidth = 1;
    g.beginPath();
    for (let ar = 0; ar < NA; ar++) {
      for (let ac = 0; ac < NA; ac++) {
        if (!CM[ar * NA + ac]) continue;
        const x = x0 + ac * AS, y = y0 + ar * AS;
        g.rect(x + 0.5, y + 0.5, AS, AS);
      }
    }
    g.stroke();
    // fuel / reflector boundary and outer boundary
    const edge = (test, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let ar = 0; ar < NA; ar++) {
        for (let ac = 0; ac < NA; ac++) {
          if (!test(ar, ac)) continue;
          const x = x0 + ac * AS, y = y0 + ar * AS;
          const nb = [[ar - 1, ac, x, y, x + AS, y], [ar + 1, ac, x, y + AS, x + AS, y + AS], [ar, ac - 1, x, y, x, y + AS], [ar, ac + 1, x + AS, y, x + AS, y + AS]];
          for (const [r2, c2, ax, ay, bx, by] of nb) {
            const inside = r2 >= 0 && r2 < NA && c2 >= 0 && c2 < NA && test(r2, c2);
            if (!inside) {
              g.moveTo(ax + 0.5, ay + 0.5);
              g.lineTo(bx + 0.5, by + 0.5);
            }
          }
        }
      }
      g.stroke();
    };
    edge((r, c) => CM[r * NA + c] !== 0, 'rgba(214,228,240,0.45)', 1);
    edge((r, c) => CM[r * NA + c] !== 0 && CM[r * NA + c] !== 4, 'rgba(63,184,255,0.35)', 1);
    // core axes (quadrant split)
    g.setLineDash([2, 4]);
    g.strokeStyle = 'rgba(214,228,240,0.22)';
    g.beginPath();
    g.moveTo(x0 + MAP.s / 2 + 0.5, y0);
    g.lineTo(x0 + MAP.s / 2 + 0.5, y0 + MAP.s);
    g.moveTo(x0, y0 + MAP.s / 2 + 0.5);
    g.lineTo(x0 + MAP.s, y0 + MAP.s / 2 + 0.5);
    g.stroke();
    g.setLineDash([]);
    // profile strip frames
    g.fillStyle = 'rgba(5,9,15,0.45)';
    g.fillRect(PX.x, PX.y, PX.w, PX.h);
    g.fillRect(PY.x, PY.y, PY.w, PY.h);
    rect(g, PX.x, PX.y, PX.w, PX.h, PAL.line);
    rect(g, PY.x, PY.y, PY.w, PY.h, PAL.line);
    hline(g, PX.x + 1, PX.x + PX.w - 1, PX.y + PBAND, PAL.line);
    vline(g, PY.x + PY.w - PBAND - 1, PY.y + 1, PY.y + PY.h - 1, PAL.line);
    // scale bar: 1 m
    const sx = MAP.x + 8, sy = MAP.y + MAP.s - 10;
    g.fillStyle = PAL.muted;
    g.fillRect(sx, sy, 100 * (MAP.s / 340), 1);
    g.fillRect(sx, sy - 3, 1, 4);
    g.fillRect(sx + 100 * (MAP.s / 340) - 1, sy - 3, 1, 4);
    T(g, '1 m', sx + 100 * (MAP.s / 340) + 5, sy + 3, FM(8.5), PAL.muted);
  }

  // ---------- data helpers ----------
  const layerDefs = {
    POWER: { key: 'pow', ramp: 0, label: 'RELATIVE POWER DENSITY', fixed: 2.0, contour: 0.1, fuelOnly: true, fmt: (v) => v.toFixed(2), unit: '' },
    'φ1': { key: 'phi1', ramp: 1, label: 'FAST FLUX φ1', contour: 0, fmt: (v) => fe(v, 2), unit: 'n/cm²s' },
    'φ2': { key: 'phi2', ramp: 2, label: 'THERMAL FLUX φ2', contour: 0, fmt: (v) => fe(v, 2), unit: 'n/cm²s' },
    Xe: { key: 'xe', ramp: 3, label: 'XE-135', contour: 0, fuelOnly: true, fmt: (v) => fe(v, 2), unit: 'atoms/cm³' },
    I: { key: 'io', ramp: 4, label: 'I-135', contour: 0, fuelOnly: true, fmt: (v) => fe(v, 2), unit: 'atoms/cm³' },
  };
  let maskAct = null, maskFuel = null;
  function buildMasks(f) {
    maskAct = new Uint8Array(N * N);
    maskFuel = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const m = CM[((j / 8) | 0) * NA + ((i / 8) | 0)];
      maskAct[j * N + i] = m ? 1 : 0;
      maskFuel[j * N + i] = m && m !== 4 ? 1 : 0;
    }
  }
  function stats(arr, mask) {
    let mn = Infinity, mx = -Infinity, s = 0, n = 0;
    for (let c = 0; c < N * N; c++) {
      if (!mask[c]) continue;
      const v = arr[c];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      s += v;
      n++;
    }
    return { min: mn, max: mx, mean: s / n };
  }
  const texBuf = new Float32Array(N * N * 4);
  function pack(arr, vmax, fuelOnly) {
    const iv = 1 / (vmax || 1);
    for (let c = 0; c < N * N; c++) {
      const a = maskAct[c], fu = maskFuel[c];
      const use = fuelOnly ? fu : a;
      texBuf[4 * c] = use ? Math.min(1, arr[c] * iv) : 0;
      texBuf[4 * c + 1] = a;
      texBuf[4 * c + 2] = fu;
      texBuf[4 * c + 3] = 1;
    }
    return texBuf;
  }

  // ---------- state of the views ----------
  const V = { fSeq: -1, layer: 'POWER', vmax: {}, st: {}, dataSeq: -1, kinSeq: -1, solveSeq: -1, mcSeq: -1, logSeq: -1, logAnim: 0,
    logOffset: 0, dirty: new Set(), lastStatus: 0, lastCompute: -1, metricsT: -1, coreNumSeq: -1 };

  // hero: the new field goes into the older of two textures (no re-packing of the previous one)
  function uploadHero(APP) {
    const f = APP.f;
    const L = layerDefs[APP.ctl.layer];
    const key = L.key;
    const s1 = stats(f[key], L.fuelOnly ? maskFuel : maskAct);
    const vmax = L.fixed || s1.max * 1.02;
    V.vmax.hero = vmax;
    V.st.hero = s1;
    if (heatCore) {
      if (!V.heroInit) {
        heatCore.upload('A', pack(APP.fPrev[key], vmax, L.fuelOnly));
        heatCore.upload('B', pack(f[key], vmax, L.fuelOnly));
        V.heroPrev = 'A';
        V.heroCur = 'B';
        V.heroInit = true;
      } else {
        const t = V.heroPrev;
        V.heroPrev = V.heroCur;
        V.heroCur = t;
        heatCore.upload(V.heroCur, pack(f[key], vmax, L.fuelOnly));
      }
    }
    // centre-line profiles (rows/cols 67 and 68 averaged: the axis falls between them)
    const px1 = new Float32Array(N), px2 = new Float32Array(N), py1 = new Float32Array(N), py2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      px1[i] = 0.5 * (f.phi1[67 * N + i] + f.phi1[68 * N + i]);
      px2[i] = 0.5 * (f.phi2[67 * N + i] + f.phi2[68 * N + i]);
      py1[i] = 0.5 * (f.phi1[i * N + 67] + f.phi1[i * N + 68]);
      py2[i] = 0.5 * (f.phi2[i * N + 67] + f.phi2[i * N + 68]);
    }
    V.prof = { px1, px2, py1, py2 };
  }
  // one small-multiple field per call (staggered over the frames after a data arrival)
  function uploadField(APP, i) {
    const m = FIELD_MAPS[i];
    const s = stats(APP.f[m.k], m.fo ? maskFuel : maskAct);
    V.st.fields = V.st.fields || {};
    V.st.fields[m.k] = s;
    if (heatFields) heatFields.upload(m.k, pack(APP.f[m.k], s.max * 1.02, m.fo));
  }

  function drawGL(APP) {
    if (!heatCore) return;
    const L = layerDefs[APP.ctl.layer];
    const mix = Math.max(0, Math.min(1, (APP.clock - APP.fT) / APP.macro));
    heatCore.draw(V.heroPrev, V.heroCur, APP.phase === 'rt' ? mix : 1, { rect: { x: 0, y: 0, w: MAP.s, h: MAP.s }, ramp: L.ramp, contour: L.contour, fuelOnly: L.fuelOnly, refl: '#0C1A2B', bg: PAL.surf });
  }
  const FIELD_MAPS = [
    { k: 'phi1', ramp: 1, name: 'φ1 FAST FLUX', unit: 'n/cm²/s', fo: false },
    { k: 'phi2', ramp: 2, name: 'φ2 THERMAL FLUX', unit: 'n/cm²/s', fo: false },
    { k: 'xe', ramp: 3, name: 'Xe-135', unit: 'atoms/cm³', fo: true },
    { k: 'io', ramp: 4, name: 'I-135', unit: 'atoms/cm³', fo: true },
  ];
  const FCOL = 194; // field column width
  function drawFieldGL() {
    if (!heatFields || !V.st.fields || Object.keys(V.st.fields).length < 4) return;
    heatFields.clear(PAL.surf);
    FIELD_MAPS.forEach((m, i) => {
      heatFields.draw(m.k, m.k, 0, { rect: { x: i * FCOL + 8, y: 2, w: N, h: N }, ramp: m.ramp, contour: 0, fuelOnly: m.fo, refl: '#0C1726', bg: PAL.surf });
    });
  }

  // ---------- per-assembly numbers, rods, quadrant readouts ----------
  function textOn(v) {
    const c = window.HEAT.rampColor(0, v / 2.0);
    const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
    return lum > 0.6;
  }
  function drawCoreNums(APP) {
    const g = coreNums.ctx;
    g.clearRect(0, 0, coreNums.w, coreNums.h);
    const x0 = MAP.x, y0 = MAP.y;
    const L = layerDefs[APP.ctl.layer];
    g.textAlign = 'center';
    const rodPct = Math.round((228 - APP.rodSteps) / 228 * 100);
    const rodAt = {};
    APP.rods.forEach((r, i) => (rodAt[r.ar * NA + r.ac] = i));
    // two-line labels in the upper part of each cell, no plate: a dark halo round the digits keeps them readable
    // over the heatmap and the tracks, and the lower part of every assembly is pure field
    const labels = [];
    for (let ar = 0; ar < NA; ar++) {
      for (let ac = 0; ac < NA; ac++) {
        const a = ar * NA + ac, m = CM[a];
        if (!m || m === 4) continue;
        const x = x0 + ac * AS + AS / 2, y = y0 + ar * AS;
        const isRod = rodAt[a] !== undefined;
        const yv = isRod ? y + 21 : y + 13, yd = isRod ? y + 31 : y + 23;
        const dp = APP.asmDelta[a];
        const ds = Math.abs(dp).toFixed(3);
        const zero = +ds === 0;
        labels.push([APP.asm[a].toFixed(3), x, yv, zero ? '0.000' : (dp > 0 ? '+' : MINUS) + ds, yd, zero ? 'rgba(214,228,240,0.62)' : dp > 0 ? '#2FBF80' : '#FF4A4A']);
      }
    }
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(4,8,14,0.9)';
    g.lineWidth = 2.8;
    g.font = FM(9.5, 700);
    for (const l of labels) g.strokeText(l[0], l[1], l[2]);
    g.fillStyle = PAL.white;
    for (const l of labels) g.fillText(l[0], l[1], l[2]);
    g.font = FM(8.5, 700);
    for (const l of labels) g.strokeText(l[3], l[1], l[4]);
    for (const l of labels) {
      g.fillStyle = l[5];
      g.fillText(l[3], l[1], l[4]);
    }
    // hottest assembly (F_xy location)
    let ha = -1, hv = 0;
    for (let a = 0; a < NA * NA; a++) if (CM[a] && CM[a] !== 4 && APP.asm[a] > hv) {
      hv = APP.asm[a];
      ha = a;
    }
    if (ha >= 0) {
      const hx = x0 + (ha % NA) * AS, hy = y0 + Math.floor(ha / NA) * AS;
      g.strokeStyle = PAL.white;
      g.lineWidth = 1.5;
      g.beginPath();
      for (const [cx, cy, dx, dy] of [[hx + 1, hy + 1, 1, 1], [hx + AS - 1, hy + 1, -1, 1], [hx + 1, hy + AS - 1, 1, -1], [hx + AS - 1, hy + AS - 1, -1, -1]]) {
        g.moveTo(cx + dx * 7, cy);
        g.lineTo(cx, cy);
        g.lineTo(cx, cy + dy * 7);
      }
      g.stroke();
    }
    // Bank D rods
    setStretch(g);
    APP.rods.forEach((r, i) => {
      const x = x0 + r.ac * AS, y = y0 + r.ar * AS;
      const dropped = APP.dropped && i === APP.dropRod;
      const lbl = dropped ? 'DROPPED' : `D ${rodPct}%`;
      if (!dropped) {
        g.strokeStyle = PAL.amber;
        g.lineWidth = 1.5;
        g.strokeRect(x + 2.5, y + 2.5, AS - 5, AS - 5);
      }
      g.font = FT(8.5, 700);
      g.textAlign = 'center';
      g.strokeStyle = 'rgba(4,8,14,0.9)';
      g.lineWidth = 2.6;
      g.strokeText(lbl, x + AS / 2, y + 10);
      g.fillStyle = dropped ? '#FF6B6B' : PAL.amber;
      g.fillText(lbl, x + AS / 2, y + 10);
    });
    // quadrant readouts in the void corners
    const r = APP.hist.at(-1);
    if (r) {
      const names = ['NW', 'NE', 'SW', 'SE'];
      const ref = findHist(APP, r.t - 60);
      const pos = [[x0 + 6, y0 + 12, 'left'], [x0 + MAP.s - 6, y0 + 12, 'right'], [x0 + 6, y0 + MAP.s - 58, 'left'], [x0 + MAP.s - 6, y0 + MAP.s - 58, 'right']];
      names.forEach((nm, q) => {
        const [x, y, al] = pos[q];
        const v = r.q[q];
        const isMax = Math.abs(v - r.qptr) < 1e-9 && r.qptr > 1.0005;
        T(g, `QUADRANT ${nm}${isMax ? ' · MAX' : ''}`, x, y, FT(9, 600), isMax && r.qptr > 1.02 ? PAL.warn : PAL.muted, al);
        T(g, v.toFixed(4), x, y + 19, FM(17, 600), isMax && r.qptr > 1.02 ? PAL.warn : PAL.white, al);
        if (ref) {
          const d = v - ref.q[q];
          T(g, `1 h ${sgn(d, 4)}`, x, y + 32, FM(9), Math.abs(d) < 5e-5 ? PAL.muted : d > 0 ? PAL.up : PAL.down, al);
        }
      });
    }
    // title-strip extras: layer, colour bar with min/max
    const st = V.st.hero;
    if (st) {
      const bx = 572, by = 7, bw = 130;
      for (let i = 0; i < bw; i++) {
        const c = window.HEAT.rampColor(L.ramp, i / (bw - 1));
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(bx + i, by, 1, 6);
      }
      rect(g, bx - 1, by - 1, bw + 2, 8, PAL.line2);
      const vm = V.vmax.hero;
      const mk2 = (v, col) => {
        const xx = bx + Math.max(0, Math.min(1, v / vm)) * (bw - 1);
        g.fillStyle = col;
        g.fillRect(Math.round(xx), by + 7, 1, 4);
      };
      mk2(st.min, PAL.text);
      mk2(st.max, PAL.text);
      T(g, '0', bx - 4, by + 7, FM(8.5), PAL.muted, 'right');
      T(g, L.fmt(vm), bx + bw + 4, by + 7, FM(8.5), PAL.muted, 'left');
      T(g, `min ${L.fmt(st.min)} · max ${L.fmt(st.max)}`, bx - 16, by + 7, FM(8.5), PAL.text, 'right');
    }
    // profiles
    drawProfiles(g, APP);
  }
  function findHist(APP, t) {
    const h = APP.hist;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= t + 1e-6) return h[i];
    return null;
  }
  function drawProfiles(g, APP) {
    if (!V.prof) return;
    const { px1, px2, py1, py2 } = V.prof;
    const m1 = Math.max(...px1, ...py1), m2 = Math.max(...px2, ...py2);
    const cs = MAP.s / N, A = 25;
    const xb = PX.y + PX.h - 3; // baseline of the x-profile (plot below the legend band)
    const yb = PY.x + 3; // baseline of the y-profile (plot left of the label band)
    const xs = (i) => PX.x + (i + 0.5) * cs, ys = (i) => PY.y + (i + 0.5) * cs;
    // gridlines at 0.5 and 1.0 of the axis maximum
    g.setLineDash([2, 3]);
    g.strokeStyle = 'rgba(95,119,144,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    for (const f of [0.5, 1]) {
      const y = Math.round(xb - f * A) + 0.5, x = Math.round(yb + f * A) + 0.5;
      g.moveTo(PX.x + 1, y);
      g.lineTo(PX.x + PX.w - 1, y);
      g.moveTo(x, PY.y + 1);
      g.lineTo(x, PY.y + PY.h - 1);
    }
    g.stroke();
    g.setLineDash([]);
    T(g, '1.0', PX.x - 3, xb - A + 3, FM(7.5), PAL.muted, 'right');
    T(g, '0.5', PX.x - 3, xb - 0.5 * A + 3, FM(7.5), PAL.muted, 'right');
    T(g, '0', PX.x - 3, xb + 2, FM(7.5), PAL.muted, 'right');
    T(g, '.5', yb + 0.5 * A, PY.y + PY.h + 11, FM(7.5), PAL.muted, 'center');
    T(g, '1', yb + A, PY.y + PY.h + 11, FM(7.5), PAL.muted, 'center');
    const path = (arr, m, horiz) => {
      g.beginPath();
      let st = false;
      for (let i = 0; i < N; i++) {
        const v = arr[i] / m;
        if (!(v > 0)) {
          st = false;
          continue;
        }
        const px = horiz ? xs(i) : yb + v * A, py = horiz ? xb - v * A : ys(i);
        if (!st) g.moveTo(px, py);
        else g.lineTo(px, py);
        st = true;
      }
    };
    const fill = (arr, m, horiz) => {
      g.beginPath();
      let first = -1, last = -1;
      for (let i = 0; i < N; i++) {
        const v = arr[i] / m;
        if (!(v > 0)) continue;
        if (first < 0) {
          first = i;
          if (horiz) g.moveTo(xs(i), xb);
          else g.moveTo(yb, ys(i));
        }
        if (horiz) g.lineTo(xs(i), xb - v * A);
        else g.lineTo(yb + v * A, ys(i));
        last = i;
      }
      if (last >= 0) {
        if (horiz) g.lineTo(xs(last), xb);
        else g.lineTo(yb, ys(last));
        g.closePath();
        g.fill();
      }
    };
    g.fillStyle = 'rgba(63,184,255,0.16)';
    fill(px1, m1, true);
    fill(py1, m1, false);
    g.lineWidth = 1.4;
    g.strokeStyle = PROF1;
    path(px1, m1, true);
    g.stroke();
    path(py1, m1, false);
    g.stroke();
    g.lineWidth = 1.2;
    g.strokeStyle = PROF2;
    path(px2, m2, true);
    g.stroke();
    path(py2, m2, false);
    g.stroke();
    // the dropped rod's column (x-profile) and row (y-profile)
    if (APP && APP.dropped) {
      const r = APP.rods[APP.dropRod];
      const dx = Math.round(MAP.x + (r.ac + 0.5) * AS) + 0.5, dy = Math.round(MAP.y + (r.ar + 0.5) * AS) + 0.5;
      g.setLineDash([3, 2]);
      g.strokeStyle = hexA('#FF5D5D', 0.85);
      g.beginPath();
      g.moveTo(dx, PX.y + PBAND + 1);
      g.lineTo(dx, PX.y + PX.h - 1);
      g.moveTo(PY.x + 1, dy);
      g.lineTo(PY.x + PY.w - PBAND - 2, dy);
      g.stroke();
      g.setLineDash([]);
    }
    // legend band above the x-profile: caption, swatches drawn in the exact stroke colours, scale
    setStretch(g);
    const ly = PX.y + 8.5;
    let lx = PX.x + 6;
    T(g, 'x-PROFILE \u00b7 E-W AXIS', lx, ly, FT(8.5, 600), PAL.muted);
    g.font = FT(8.5, 600);
    lx += g.measureText('x-PROFILE \u00b7 E-W AXIS').width + 14;
    const sw = (col, w, label) => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 14, ly - 3);
      g.stroke();
      T(g, label, lx + 18, ly, FM(8.5, 600), col);
      g.font = FM(8.5, 600);
      lx += 18 + g.measureText(label).width + 14;
    };
    sw(PROF1, 1.6, '\u03c61 FAST');
    sw(PROF2, 1.4, '\u03c62 THERMAL');
    if (APP && APP.dropped) {
      const r = APP.rods[APP.dropRod];
      g.strokeStyle = hexA('#FF5D5D', 0.85);
      g.setLineDash([3, 2]);
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 14, ly - 3);
      g.stroke();
      g.setLineDash([]);
      T(g, `DROPPED ROD ${COLS[r.ac]}${r.ar + 1}`, lx + 18, ly, FT(8.5, 700), PAL.down);
    }
    T(g, `1.0 = \u03c61 ${fe(m1, 2)} \u00b7 \u03c62 ${fe(m2, 2)} n/cm\u00b2/s`, PX.x + PX.w - 6, ly, FM(8.5), PAL.text, 'right');
    // label band right of the y-profile
    g.save();
    g.translate(PY.x + PY.w - PBAND + 1, PY.y + 6);
    g.rotate(Math.PI / 2);
    T(g, 'y-PROFILE \u00b7 N-S AXIS', 0, 0, FT(8.5, 600), PAL.muted);
    T(g, `\u03c61 / \u03c62 \u00b7 SAME SCALE AS x`, PY.h - 12, 0, FT(8.5, 600), PAL.muted, 'right');
    g.restore();
  }

  // dropped rod flash + MC tracks (every frame)
  function drawCoreFx(APP, now) {
    const g = coreFx.ctx;
    g.clearRect(MAP.x - 2, MAP.y - 2, MAP.s + 4, MAP.s + 4);
    if (APP.dropped) {
      const r = APP.rods[APP.dropRod];
      const x = MAP.x + r.ac * AS, y = MAP.y + r.ar * AS;
      if (V.dropPage === undefined) V.dropPage = now;
      const age = (now - V.dropPage) / 1000;
      if (age < 2.4) {
        // the moment of the drop: expanding rings from the rod
        g.save();
        g.beginPath();
        g.rect(MAP.x, MAP.y, MAP.s, MAP.s);
        g.clip();
        for (let k = 0; k < 3; k++) {
          const a = age - k * 0.35;
          if (a < 0 || a > 1.5) continue;
          const rr = 8 + a * 260;
          g.strokeStyle = hexA('#FF5D5D', 0.85 * (1 - a / 1.5));
          g.lineWidth = 2.5 - a;
          g.beginPath();
          g.arc(x + AS / 2, y + AS / 2, rr, 0, Math.PI * 2);
          g.stroke();
        }
        g.restore();
      }
      const ph = 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 2 * 1.6);
      g.strokeStyle = hexA('#FF5D5D', 0.45 + 0.55 * ph);
      g.lineWidth = 2;
      g.strokeRect(x + 1.5, y + 1.5, AS - 3, AS - 3);
      setStretch(g);
      // callout over the void / reflector assemblies to the west
      const cx = MAP.x + 6, cy = MAP.y + 13 * AS + 4;
      const rr = APP.hist.at(-1);
      const dw = rr && rr.dropWorth ? rr.dropWorth : null;
      g.fillStyle = 'rgba(5,9,15,0.88)';
      g.fillRect(cx, cy, 114, 40);
      rect(g, cx, cy, 114, 40, hexA('#FF5D5D', 0.6 + 0.4 * ph));
      T(g, 'DROPPED ROD \u00b7 100% IN', cx + 6, cy + 11, FT(9, 700), PAL.down);
      T(g, `${r.name} ${COLS[r.ac]}${r.ar + 1} \u00b7 ${clock(APP.dropAt)}`, cx + 6, cy + 23, FM(8.5, 600), PAL.text);
      T(g, dw !== null ? `worth ${neg(rr.dropWorth0, 0)} · now ${neg(dw, 0)} pcm` : 'worth \u2013', cx + 5, cy + 35, FM(7.5, 700), PAL.down);
      g.strokeStyle = hexA('#FF5D5D', 0.6);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx + 114, cy + 4);
      g.lineTo(x + 1, y + AS - 4);
      g.stroke();
    }
  }
  function drawTracks(APP) {
    const g = tracksC.ctx;
    g.clearRect(0, 0, MAP.s, MAP.s);
    const MC = APP.mc;
    if (!MC || !MC.tracks.length) return;
    const sc = MAP.s / 340;
    const LIFE = 50;
    g.lineCap = 'butt';
    g.lineJoin = 'bevel';
    const NB = 4;
    // glow pass (additive, wide) then the core line; fast group violet-white, thermal Cherenkov blue
    for (let pass = 0; pass < 2; pass++) {
      g.globalCompositeOperation = pass === 0 ? 'lighter' : 'source-over';
      for (let grp = 1; grp <= 2; grp++) {
        for (let b = 0; b < NB; b++) {
          const a0 = b / NB, a1 = (b + 1) / NB;
          const fade = 1 - (a0 + a1) / 2;
          if (pass === 0) {
            g.strokeStyle = grp === 1 ? hexA('#9B8CFF', 0.24 * fade) : hexA('#3FB8FF', 0.3 * fade);
            g.lineWidth = 2.6;
          } else {
            g.strokeStyle = grp === 1 ? hexA('#E4DEFF', 0.85 * fade) : hexA('#8FEBFF', 0.95 * fade);
            g.lineWidth = grp === 1 ? 0.9 : 1.2;
          }
          g.beginPath();
          for (const t of MC.tracks) {
            const a = (APP.frame - t.born) / LIFE;
            if (a < a0 || a >= a1) continue;
            const p = t.p;
            for (let i = 3; i < p.length; i += 3) {
              if (p[i + 2] !== grp) continue;
              g.moveTo(p[i - 3] * sc, p[i - 2] * sc);
              g.lineTo(p[i] * sc, p[i + 1] * sc);
            }
          }
          g.stroke();
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
    // the current fission source (every 13th of the 20,000 banked sites): a shimmer that follows the power
    const S2 = MC.sites;
    if (S2) {
      g.fillStyle = 'rgba(165,238,255,0.6)';
      const n = S2.length / 2;
      for (let i = (APP.frame * 7) % 13; i < n; i += 13) g.fillRect(S2[2 * i] * sc - 0.7, S2[2 * i + 1] * sc - 0.7, 1.4, 1.4);
    }
    // birth points (fission sites) and the newest collisions
    for (const t of MC.tracks) {
      const age = APP.frame - t.born;
      if (age > 10) continue;
      const p = t.p;
      g.fillStyle = hexA('#FFFFFF', 1 - age / 10);
      g.fillRect(p[0] * sc - 1, p[1] * sc - 1, 2, 2);
    }
  }

  // ---------- status bar ----------
  function drawStatus(APP) {
    const p = P.status, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const r = APP.hist.at(-1);
    if (!r) return;
    setStretch(g);
    g.letterSpacing = '1.5px';
    T(g, 'XENON NIGHT', 14, 26, FT(18, 700), PAL.white);
    g.letterSpacing = '0.5px';
    T(g, 'PWR CORE 3411 MWt', 148, 26, FT(12, 600), PAL.blue);
    g.letterSpacing = '0px';
    let x = 290;
    const cell = (w, label, value, color, unit, chip) => {
      vline(g, x, 6, p.h - 6, PAL.line);
      if (chip) {
        g.fillStyle = hexA(chip, 0.16);
        g.fillRect(x + 4, 5, w - 8, p.h - 10);
        rect(g, x + 4, 5, w - 8, p.h - 10, hexA(chip, 0.7));
      }
      T(g, label, x + 10, 15, FT(9, 600), PAL.muted);
      g.font = FM(15, 600);
      g.fillStyle = color || PAL.text;
      g.textAlign = 'left';
      g.fillText(value, x + 10, 33);
      if (unit) {
        const vw = g.measureText(value).width;
        T(g, unit, x + 10 + vw + 4, 33, FC(9.5), PAL.muted);
      }
      x += w;
    };
    const mc = APP.mc;
    cell(110, 'SIM TIME', clock(APP.clock), PAL.white);
    cell(80, 'ACCEL', `×${APP.accel}`, PAL.text, 'min/s');
    cell(156, 'CORE POWER', `${r.power.toFixed(1)}%`, PAL.white, `${(r.power / 100 * 3411).toFixed(0)} MWt`);
    cell(108, 'k_eff', r.k.toFixed(6), PAL.white);
    cell(100, 'REACTIVITY', sgn(r.rho, 1), Math.abs(r.rho) > 10 ? PAL.warn : PAL.text, 'pcm');
    cell(84, 'BANK D', String(r.steps), PAL.amber, 'st');
    cell(100, 'BORON', r.ppm.toFixed(1), PAL.up, 'ppm');
    cell(108, 'ρ XENON', neg(r.xe, 0), PAL.amber, 'pcm');
    cell(92, 'QPTR', r.qptr.toFixed(4), r.qptr > 1.02 ? PAL.warn : PAL.text, '', r.qptr > 1.02 ? PAL.warn : null);
    cell(72, 'F_xy', r.fxy.toFixed(3), PAL.text);
    const q = V.mcQ || APP.mcShown(); // the same tally snapshot the Monte Carlo panel shows
    cell(166, q.prev ? 'MONTE CARLO k \u00b7 PREV \u00b7 \u03c3(MEAN)' : 'MONTE CARLO k \u00b7 \u03c3(MEAN)', q.n > 1 ? q.kMean.toFixed(5) : '\u2013', PAL.blue, q.n > 1 ? `\u00b1${(q.kSig * 1e5).toFixed(0)} pcm` : `gen ${mc.genRun}`);
    vline(g, x, 6, p.h - 6, PAL.line);
    // chips
    const lf = r.demand < 100 || r.power < 99.95;
    const lfState = r.power > r.demand + 0.01 ? '↓' : r.power < r.demand - 0.01 ? '↑' : r.demand < 100 ? '50%' : '100%';
    const chips = [
      ['AUTO ROD', APP.ctl.auto, PAL.blue],
      [`LOAD-FOLLOW ${lfState}`, true, PAL.violet],
      ['ROD DROPPED', APP.dropped, PAL.down],
    ];
    let cx = x + 10;
    const cws = [118, 132];
    cws.push(p.w - 10 - cx - 16 - cws[0] - cws[1]);
    let ci = 0;
    for (const [name, on, col] of chips) {
      const cw = cws[ci++];
      const flash = name === 'ROD DROPPED' && on ? 0.55 + 0.45 * Math.sin(APP.now / 1000 * Math.PI * 2 * 1.6) : 1;
      g.fillStyle = on ? hexA(col, 0.18 * flash) : 'rgba(26,42,61,0.35)';
      g.fillRect(cx, 6, cw, 28);
      rect(g, cx, 6, cw, 28, on ? hexA(col, 0.9 * flash) : PAL.line);
      g.fillStyle = on ? col : PAL.dim;
      g.beginPath();
      g.arc(cx + 12, 20, 3, 0, Math.PI * 2);
      g.fill();
      g.letterSpacing = '0.5px';
      if (name === 'ROD DROPPED' && on && r.qptr > 1.02) {
        g.letterSpacing = '0px';
        T(g, 'ROD DROPPED \u00b7 QPTR>1.02', cx + 22, 24, FT(10, 700), col);
      } else T(g, name, cx + 22, 24, FT(10.5, 700), on ? col : PAL.dim);
      g.letterSpacing = '0px';
      cx += cw + 8;
    }
  }

  // ---------- controls ----------
  function slider(g, x, y, w, frac, mark) {
    g.fillStyle = PAL.line;
    g.fillRect(x, y - 1, w, 3);
    g.fillStyle = hexA('#3FB8FF', 0.55);
    g.fillRect(x, y - 1, w * frac, 3);
    for (let i = 0; i <= 10; i++) g.fillRect(Math.round(x + (w * i) / 10), y + 4, 1, i % 5 ? 2 : 3);
    if (mark !== undefined) {
      g.fillStyle = PAL.white;
      g.fillRect(Math.round(x + w * mark) - 0.5, y - 5, 1, 11);
    }
    g.fillStyle = PAL.surf;
    g.strokeStyle = PAL.blue;
    g.lineWidth = 1.5;
    g.beginPath();
    g.rect(Math.round(x + w * frac) - 3.5, y - 4.5, 7, 10);
    g.fill();
    g.stroke();
  }
  function toggle(g, x, y, opts, on) {
    let xx = x;
    setStretch(g);
    for (let i = 0; i < opts.length; i++) {
      g.font = FT(9, 700);
      const w = g.measureText(opts[i]).width + 12;
      const act = i === on;
      g.fillStyle = act ? hexA('#3FB8FF', 0.22) : 'rgba(26,42,61,0.4)';
      g.fillRect(xx, y - 8, w, 13);
      rect(g, xx, y - 8, w, 13, act ? PAL.blue : PAL.line);
      T(g, opts[i], xx + w / 2, y + 2, FT(9, 700), act ? PAL.cyan : PAL.dim, 'center');
      xx += w - 1;
    }
    return xx;
  }
  function knob(g, x, y, frac, color) {
    g.strokeStyle = PAL.line2;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 7, Math.PI * 0.75, Math.PI * 2.25);
    g.stroke();
    g.strokeStyle = color || PAL.blue;
    g.beginPath();
    g.arc(x, y, 7, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * frac));
    g.stroke();
    const a = Math.PI * (0.75 + 1.5 * frac);
    g.strokeStyle = PAL.white;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
    g.stroke();
  }
  function field(g, x, y, w, s) {
    g.fillStyle = '#08101B';
    g.fillRect(x, y - 9, w, 14);
    rect(g, x, y - 9, w, 14, PAL.line2);
    T(g, s, x + w - 4, y + 1, FM(9.5, 600), PAL.text, 'right');
  }
  function drawControls(APP) {
    const p = P.controls, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const r = APP.hist.at(-1);
    if (!r) return;
    const c = APP.ctl;
    setStretch(g);
    const LX = 10, CX = 112, CW = 80, VX = 270;
    let y = 36;
    const group = (name) => {
      y += 4;
      g.letterSpacing = '1px';
      T(g, name, LX, y, FT(9, 700), PAL.blue);
      g.letterSpacing = '0px';
      g.font = FT(9, 700);
      hline(g, LX + g.measureText(name).width + 10, VX, y - 3, PAL.line);
      y += 15;
    };
    const label = (s) => T(g, s, LX, y + 3, FT(10, 500), PAL.text);
    const val = (s, color, unit) => {
      let xr = VX;
      if (unit) {
        T(g, unit, VX, y + 3, FC(8.5), PAL.muted, 'right');
        g.font = FC(8.5);
        xr -= g.measureText(unit).width + 3;
      }
      T(g, s, xr, y + 3, FM(10, 600), color || PAL.white, 'right');
    };
    group('OPERATION');
    label('Power demand');
    slider(g, CX, y, CW, (r.demand - 30) / 70, (r.power - 30) / 70);
    val(r.demand.toFixed(0), PAL.white, '%');
    y += 19;
    label('Ramp rate');
    slider(g, CX, y, CW, (c.ramp - 0.2) / 4.8);
    val(c.ramp.toFixed(1), PAL.white, '%/min');
    y += 19;
    label('Time acceleration');
    slider(g, CX, y, CW, (c.accel - 1) / 59);
    val(String(c.accel), PAL.white, 'min/s');
    y += 19;
    label('Dropped rod');
    const dr = APP.rods[APP.dropRod];
    g.fillStyle = '#08101B';
    g.fillRect(CX, y - 9, VX - CX, 14);
    rect(g, CX, y - 9, VX - CX, 14, APP.dropped ? hexA('#FF5D5D', 0.7) : PAL.line2);
    T(g, `${dr.name} · ${COLS[dr.ac]}${dr.ar + 1} · ${clock(APP.dropAt)}`, CX + 5, y + 1, FM(9, 600), APP.dropped ? PAL.down : PAL.text);
    g.fillStyle = PAL.muted;
    g.beginPath();
    g.moveTo(VX - 11, y - 3);
    g.lineTo(VX - 5, y - 3);
    g.lineTo(VX - 8, y + 1);
    g.fill();
    y += 19;
    group('CONTROL');
    label('Rod control');
    toggle(g, CX, y, ['AUTO', 'MANUAL'], c.auto ? 0 : 1);
    val(`${r.steps} st`, PAL.amber);
    y += 19;
    label('Boron (crit. search)');
    field(g, CX, y, CW, r.ppm.toFixed(1));
    val(`${neg(r.bw, 2)}`, PAL.text, 'pcm/ppm');
    y += 19;
    label('Dilution limit');
    slider(g, CX, y, CW, (c.ppmLimit - 0.5) / 9.5);
    val(c.ppmLimit.toFixed(1), PAL.white, 'ppm/min');
    y += 19;
    group('FEEDBACK');
    label('Xenon / iodine');
    toggle(g, CX, y, ['ON', 'OFF'], c.xenon ? 0 : 1);
    val(`${neg(r.xe, 0)}`, PAL.amber, 'pcm');
    y += 19;
    label('Doppler coefficient');
    knob(g, CX + 8, y, (-c.doppler - 1) / 4, PAL.violet);
    T(g, `set ${neg(c.doppler, 1)}`, CX + 22, y + 3, FM(9), PAL.muted);
    val(neg(r.dc, 2), PAL.violet, 'pcm/K');
    y += 19;
    label('Moderator feedback');
    toggle(g, CX, y, ['ON'], 0);
    knob(g, CX + 40, y, -c.mtc / 40, PAL.cyan);
    T(g, neg(c.mtc, 0), CX + 54, y + 3, FM(9), PAL.muted);
    val(neg(r.mtc, 1), PAL.cyan, 'pcm/K');
    y += 19;
    label('Axial buckling B²');
    field(g, CX, y, CW, '0.80e-4');
    val('cm⁻²', PAL.muted);
    y += 19;
    group('SOLVER');
    label('SOR ω');
    slider(g, CX, y, CW, (c.omega - 1) / 0.95);
    val(c.omega.toFixed(2), PAL.white);
    y += 19;
    label('Outer tolerance');
    field(g, CX, y, CW, 'Δk 1e-6 · S 1e-5');
    val('3+3 sw', PAL.text);
    y += 19;
    group('MONTE CARLO');
    label('Neutrons / generation');
    slider(g, CX, y, CW, Math.log(c.mcN / 1000) / Math.log(100));
    val(c.mcN.toLocaleString('en-US'), PAL.white);
    y += 19;
    label('Inactive generations');
    field(g, CX, y, CW, String(c.mcInactive));
    val(`${APP.mc.genRun > c.mcInactive ? 'ACTIVE' : 'SETTLING'}`, APP.mc.genRun > c.mcInactive ? PAL.blue : PAL.warn);
    y += 21;
    // map layer switch
    g.letterSpacing = '1px';
    T(g, 'MAP LAYER', LX, y + 4, FT(9, 700), PAL.blue);
    g.letterSpacing = '0px';
    const layers = ['POWER', 'φ1', 'φ2', 'Xe', 'I'];
    const sx = 72, sw = (VX - sx) / layers.length;
    layers.forEach((L, i) => {
      const act = L === c.layer;
      g.fillStyle = act ? hexA('#3FB8FF', 0.22) : 'rgba(26,42,61,0.4)';
      g.fillRect(sx + i * sw, y - 6, sw - 2, 15);
      rect(g, sx + i * sw, y - 6, sw - 2, 15, act ? PAL.blue : PAL.line);
      T(g, L, sx + i * sw + (sw - 2) / 2, y + 5, L === 'POWER' ? FT(9, 700) : FM(9.5, 600), act ? PAL.cyan : PAL.muted, 'center');
    });
    // Bank D DRPI column
    drawDRPI(g, APP, r);
  }
  function drawDRPI(g, APP, r) {
    const x0 = 282, y0 = 34, h = 380, x1 = 342;
    setStretch(g);
    T(g, 'BANK D', (x0 + x1) / 2, y0 - 2, FT(9, 700), PAL.amber, 'center');
    const top = y0 + 10, bot = y0 + 10 + h - 40;
    const sy = (s) => bot - (s / 228) * (bot - top);
    // scale
    for (let s = 0; s <= 228; s += 12) {
      const yy = Math.round(sy(s)) + 0.5;
      g.fillStyle = s % 48 === 0 || s === 228 ? PAL.muted : PAL.dim;
      g.fillRect(x0 + 13, yy, s % 48 === 0 ? 4 : 2, 1);
      if (s % 48 === 0 || s === 228) T(g, String(s), x0 + 11, yy + 3, FM(8), PAL.muted, 'right');
    }
    // main column: LED segments up to the position (steps withdrawn)
    const bx = x0 + 19, bw = 9;
    g.fillStyle = '#08101B';
    g.fillRect(bx, top, bw, bot - top);
    rect(g, bx - 1, top - 1, bw + 2, bot - top + 2, PAL.line2);
    for (let s = 0; s < 228; s += 6) {
      const on = s < r.steps;
      g.fillStyle = on ? (s >= 204 ? PAL.amber : hexA('#FFB547', 0.75)) : 'rgba(26,42,61,0.7)';
      g.fillRect(bx + 1, Math.round(sy(s + 6)) + 1, bw - 2, Math.max(1, Math.round(sy(s) - sy(s + 6)) - 1));
    }
    // target 210
    const ty = Math.round(sy(210)) + 0.5;
    g.fillStyle = PAL.cyan;
    g.beginPath();
    g.moveTo(bx + bw + 2, ty);
    g.lineTo(bx + bw + 6, ty - 3);
    g.lineTo(bx + bw + 6, ty + 3);
    g.fill();
    // 9 rod columns
    const rx = bx + bw + 9;
    APP.rods.forEach((rd, i) => {
      const xx = rx + i * 3;
      const dropped = APP.dropped && i === APP.dropRod;
      const st = dropped ? 0 : r.steps;
      g.fillStyle = 'rgba(26,42,61,0.7)';
      g.fillRect(xx, top, 2, bot - top);
      g.fillStyle = dropped ? PAL.down : hexA('#FFB547', 0.55);
      g.fillRect(xx, sy(st), 2, bot - sy(st));
      if (dropped) g.fillRect(xx - 1, bot + 2, 4, 3);
    });
    T(g, String(r.steps), (x0 + x1) / 2 + 4, bot + 20, FM(15, 600), PAL.amber, 'center');
    T(g, 'steps withdrawn', (x0 + x1) / 2 + 4, bot + 31, FC(8), PAL.muted, 'center');
    T(g, `target 210 · ${(228 - r.steps) / 228 * 100 < 10 ? ' ' : ''}${((228 - r.steps) / 228 * 100).toFixed(0)}% in`, (x0 + x1) / 2 + 4, bot + 41, FC(8), PAL.muted, 'center');
  }

  // ---------- kinetics ----------
  function drawKinetics(APP) {
    const p = P.kinetics, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const k = APP.kin;
    setStretch(g);
    if (!k) return;
    T(g, `${clock(k.t)}  D ${k.from}→${k.to}`, p.w - 8, 14, FM(9, 600), PAL.amber, 'right');
    const per = Math.abs(k.period) > 99999 ? '∞' : `${k.period >= 0 ? '+' : MINUS}${Math.abs(k.period).toFixed(0)}`;
    readout(g, 10, 34, 'ρ STEP', sgn(k.rho, 1), k.rho >= 0 ? PAL.up : PAL.down, 'pcm');
    readout(g, 96, 34, 'PROMPT JUMP', k.jump.toFixed(4), PAL.white, 'P/P0');
    readout(g, 190, 34, 'STABLE PERIOD', per, PAL.cyan, 's');
    readout(g, 274, 34, 'ω ROOT', fe(k.omega, 2), PAL.text, 's⁻¹');
    // P(t)/P0
    const ax = { x: 34, y: 66, w: 140, h: 82 };
    drawFrame(g, ax);
    T(g, 'P(t)/P0  BACKWARD EULER, dt 1 ms', ax.x, ax.y - 4, FT(8.5, 600), PAL.muted);
    if (k.trace) {
      const tr = k.trace;
      let mn = Infinity, mx = -Infinity;
      for (const v of tr) {
        mn = Math.min(mn, v);
        mx = Math.max(mx, v);
      }
      mn = Math.min(mn, 1);
      mx = Math.max(mx, 1);
      const pad = (mx - mn) * 0.32 || 0.001;
      mn -= pad;
      mx += pad;
      const yy = (v) => ax.y + ax.h - ((v - mn) / (mx - mn)) * ax.h;
      hline(g, ax.x, ax.x + ax.w, yy(1), PAL.line2, [2, 3]);
      g.strokeStyle = PAL.cyan;
      g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i < tr.length; i++) {
        const x = ax.x + (i / (tr.length - 1)) * ax.w;
        if (i === 0) g.moveTo(x, yy(1));
        else g.lineTo(x, yy(tr[i]));
      }
      g.stroke();
      // prompt jump marker
      g.fillStyle = PAL.white;
      g.fillRect(ax.x + 1, yy(k.jump) - 1, 3, 2);
      T(g, mx.toFixed(4), ax.x - 3, ax.y + 7, FM(7.5), PAL.muted, 'right');
      T(g, mn.toFixed(4), ax.x - 3, ax.y + ax.h, FM(7.5), PAL.muted, 'right');
      T(g, 'P', ax.x - 3, yy(1) + 3, FM(7.5), PAL.muted, 'right');
      // end value beside the trace end (above a rising trace, below a falling one), with a leader
      const ye = yy(tr[tr.length - 1]), xe = ax.x + ax.w;
      const ly = Math.max(ax.y + 9, Math.min(ax.y + ax.h - 3, k.rho >= 0 ? ye - 9 : ye + 15));
      T(g, tr[tr.length - 1].toFixed(4), xe - 12, ly, FM(8), PAL.cyan, 'right');
      g.strokeStyle = hexA('#6FE3FF', 0.6);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xe - 11, ly + (k.rho >= 0 ? 2 : -8));
      g.lineTo(xe - 1, ye);
      g.stroke();
    }
    for (const s of [0, 30, 60, 90, 120]) T(g, String(s), ax.x + (s / 120) * ax.w, ax.y + ax.h + 9, FM(7.5), PAL.muted, 'center');
    T(g, 's', ax.x + ax.w + 4, ax.y + ax.h + 9, FC(8), PAL.muted);
    // inhour curve
    const bx = { x: 214, y: 66, w: 128, h: 82 };
    drawFrame(g, bx);
    T(g, 'INHOUR  ρ(ω)', bx.x, bx.y - 4, FT(8.5, 600), PAL.muted);
    const wmin = -0.0124 * 0.999, wmax = Math.max(0.004, Math.abs(k.omega) * 2.5);
    const rmax = Math.max(60, Math.ceil(Math.abs(k.rho) * 1.35 / 20) * 20), rmin = -rmax;
    const xw = (w) => bx.x + ((w - wmin) / (wmax - wmin)) * bx.w;
    const yr = (r) => bx.y + bx.h - ((r - rmin) / (rmax - rmin)) * bx.h;
    hline(g, bx.x, bx.x + bx.w, yr(0), PAL.line2);
    vline(g, xw(0), bx.y, bx.y + bx.h, PAL.line2);
    g.save();
    g.beginPath();
    g.rect(bx.x, bx.y, bx.w, bx.h);
    g.clip();
    g.strokeStyle = PAL.violet;
    g.lineWidth = 1.3;
    g.beginPath();
    let st = false;
    for (let i = 0; i <= 160; i++) {
      const w = wmin + ((wmax - wmin) * i) / 160;
      const rho = inhour(w) * 1e5;
      const X = xw(w), Y = yr(Math.max(rmin - 50, Math.min(rmax + 50, rho)));
      if (!st) g.moveTo(X, Y);
      else g.lineTo(X, Y);
      st = true;
    }
    g.stroke();
    hline(g, bx.x, bx.x + bx.w, yr(k.rho), hexA('#6FE3FF', 0.6), [3, 2]);
    g.restore();
    const rx = xw(k.omega), ry = yr(Math.max(rmin, Math.min(rmax, k.rho)));
    g.fillStyle = PAL.cyan;
    g.beginPath();
    g.arc(rx, ry, 3, 0, Math.PI * 2);
    g.fill();
    T(g, '+' + rmax, bx.x - 3, bx.y + 7, FM(7.5), PAL.muted, 'right');
    T(g, MINUS + rmax, bx.x - 3, bx.y + bx.h, FM(7.5), PAL.muted, 'right');
    T(g, '0', bx.x - 3, yr(0) + 3, FM(7.5), PAL.muted, 'right');
    T(g, MINUS + 'λ1', bx.x, bx.y + bx.h + 9, FM(7.5), PAL.muted, 'left');
    T(g, '0', xw(0), bx.y + bx.h + 9, FM(7.5), PAL.muted, 'center');
    T(g, fe(wmax, 0), bx.x + bx.w, bx.y + bx.h + 9, FM(7.5), PAL.muted, 'right');
    // precursor groups
    const gy = 180, gh = 30;
    T(g, 'PRECURSORS AT t = 120 s \u00b7 BAR C\u1d62/C\u1d62(0) \u00b7 TICK P/P0 \u00b7 LABEL C\u1d62/C\u1d62,eq', 10, gy - 11, FT(8.5, 600), PAL.muted);
    const BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
    const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
    const cEnd = k.cEnd || APP.prec.map(() => 1);
    const pEnd = k.pEnd || 1;
    const dev = Math.max(0.02, Math.abs(pEnd - 1), ...cEnd.map((c) => Math.abs(c - 1)));
    const colw = (p.w - 20) / 6;
    for (let i = 0; i < 6; i++) {
      const x = 10 + i * colw, cw2 = colw - 8;
      const by0 = gy + 4, bh = gh - 4, mid = by0 + bh / 2;
      const sc = (bh / 2 - 1) / dev;
      g.fillStyle = 'rgba(26,42,61,0.55)';
      g.fillRect(x, by0, cw2, bh);
      const col = i < 2 ? PAL.violet : i < 4 ? PAL.blue : PAL.cyan;
      const d = (cEnd[i] - 1) * sc;
      g.fillStyle = hexA(col, 0.85);
      g.fillRect(x + 4, d >= 0 ? mid - d : mid, cw2 - 8, Math.max(1, Math.abs(d)));
      g.fillStyle = PAL.white;
      g.fillRect(x, Math.round(mid), cw2, 1);
      g.fillStyle = PAL.cyan;
      g.fillRect(x, Math.round(mid - (pEnd - 1) * sc), 4, 1.5);
      g.fillRect(x + cw2 - 4, Math.round(mid - (pEnd - 1) * sc), 4, 1.5);
      const lag = cEnd[i] / pEnd;
      T(g, `G${i + 1}`, x, gy, FC(8.5, 600), PAL.muted);
      T(g, lag.toFixed(3), x + cw2, gy, FM(8.5, 600), Math.abs(lag - 1) < 0.0005 ? PAL.text : lag > 1 ? PAL.amber : PAL.cyan, 'right');
      T(g, `\u03b2 ${BETA[i].toExponential(2).replace('e-', 'e\u2212')}`, x, gy + gh + 10, FM(7.5), PAL.muted);
      T(g, `\u03bb ${LAM[i]}/s`, x, gy + gh + 20, FM(7.5), PAL.muted);
    }
  }
  function inhour(w) {
    const BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
    const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
    let s = w * 2e-5;
    for (let i = 0; i < 6; i++) s += BETA[i] * w / (w + LAM[i]);
    return s;
  }
  function drawFrame(g, a) {
    g.fillStyle = 'rgba(5,9,15,0.45)';
    g.fillRect(a.x, a.y, a.w, a.h);
    rect(g, a.x, a.y, a.w, a.h, PAL.line);
  }

  // ---------- event log ----------
  const KIND = {
    bench: ['BENCH', PAL.up], solver: ['SOLVE', PAL.blue], ctrl: ['CTRL', PAL.text], fb: ['FDBK', PAL.violet], rod: ['ROD', PAL.amber],
    boron: ['BORON', PAL.up], xe: ['XE', PAL.amber], meas: ['MEAS', PAL.cyan], mc: ['MC', PAL.violet], alarm: ['ALARM', PAL.down],
  };
  const LOG_LH = 11.6;
  function drawLog(APP, dt) {
    const p = P.log, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    setStretch(g);
    T(g, `${APP.logSeq.toLocaleString('en-US')} EVENTS`, p.w - 8, 14, FM(9, 600), PAL.muted, 'right');
    // pinned: the boot validation line
    const B = APP.bench;
    if (B) {
      g.fillStyle = 'rgba(71,224,160,0.08)';
      g.fillRect(2, 23, p.w - 4, 15);
      T(g, 'D1 00:00', 6, 34, FM(8.8), PAL.muted);
      T(g, 'BENCH', 58, 34, FT(8.8, 700), PAL.up);
      T(g, `IAEA-2D k = ${B.k.toFixed(5)}, ref 1.02959, Δ = ${sgn(B.dpcm, 1)} pcm`, 92, 34, FM(8.8, 600), PAL.up);
      hline(g, 2, p.w - 2, 38, PAL.line);
    }
    const y0 = 40, y1 = p.h - 6;
    g.save();
    g.beginPath();
    g.rect(1, y0, p.w - 2, y1 - y0);
    g.clip();
    const n = Math.ceil((y1 - y0) / LOG_LH) + 2;
    const logs = APP.logs;
    let y = y1 - 4 + V.logOffset;
    for (let i = logs.length - 1, c = 0; i >= 0 && c < n; i--, c++) {
      const l = logs[i];
      const [tag, col] = KIND[l.kind] || ['INFO', PAL.text];
      if (l.kind === 'alarm') {
        g.fillStyle = 'rgba(255,93,93,0.14)';
        g.fillRect(2, y - 9, p.w - 4, LOG_LH);
      }
      T(g, clock(l.t), 6, y, FM(8.8), PAL.muted);
      T(g, tag, 58, y, FT(8.8, 700), col);
      g.font = FM(8.8, l.kind === 'alarm' ? 700 : 400);
      g.fillStyle = l.kind === 'alarm' ? PAL.down : l.kind === 'bench' ? PAL.up : PAL.text;
      g.textAlign = 'left';
      let s = l.text;
      if (s.length > 47) s = s.slice(0, 46) + '…';
      g.fillText(s, 92, y);
      y -= LOG_LH;
    }
    g.restore();
  }

  // ---------- solver ----------
  function drawSolver(APP, now) {
    const p = P.solver, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const s = APP.solve;
    if (!s) return;
    setStretch(g);
    // residual per outer
    const a = { x: 30, y: 36, w: 210, h: 62 };
    drawFrame(g, a);
    T(g, `LOG₁₀ max|ΔS|/S PER OUTER  ·  ${s.label === 'rod' ? 'AFTER ROD MOVE' : 'MACRO STEP'} ${clock(s.t)}`, a.x, a.y - 5, FT(8.5, 600), PAL.muted);
    const n = s.hres.length;
    const ylo = -7, yhi = 0;
    const yr = (v) => a.y + a.h - ((Math.max(ylo, Math.min(yhi, v)) - ylo) / (yhi - ylo)) * a.h;
    for (const e of [0, -2, -4, -6]) {
      hline(g, a.x, a.x + a.w, yr(e), 'rgba(26,42,61,0.6)');
      T(g, String(e).replace('-', MINUS), a.x - 4, yr(e) + 3, FM(7.5), PAL.muted, 'right');
    }
    hline(g, a.x, a.x + a.w, yr(-5), hexA('#FFB547', 0.8), [3, 2]);
    T(g, 'tol 1e-5', a.x + a.w - 2, yr(-5) - 2, FM(7.5), PAL.warn, 'right');
    const bw = Math.max(1, a.w / Math.max(n, 1));
    for (let i = 0; i < n; i++) {
      const v = Math.log10(Math.max(1e-9, s.hres[i]));
      const x = a.x + i * bw;
      const y = yr(v);
      g.fillStyle = v < -5 ? hexA('#47E0A0', 0.85) : hexA('#3FB8FF', 0.7);
      g.fillRect(x, y, Math.max(1, bw - (bw > 2 ? 1 : 0)), a.y + a.h - y);
    }
    // k per outer
    const b = { x: 30, y: 116, w: 210, h: 40 };
    drawFrame(g, b);
    T(g, 'k PER OUTER  (k ← k · ΣSₙₑₓ / ΣSₒₗₔ)', b.x, b.y - 5, FT(8.5, 600), PAL.muted);
    let kmn = Infinity, kmx = -Infinity;
    for (const v of s.hk) {
      kmn = Math.min(kmn, v);
      kmx = Math.max(kmx, v);
    }
    const kp = Math.max(2e-6, (kmx - kmn) * 0.1);
    kmn -= kp;
    kmx += kp;
    g.strokeStyle = PAL.white;
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = a.x + (i + 0.5) * bw;
      const y = b.y + b.h - ((s.hk[i] - kmn) / (kmx - kmn)) * b.h;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    T(g, kmx.toFixed(6), b.x + b.w - 3, b.y + 8, FM(7.5), PAL.muted, 'right');
    T(g, kmn.toFixed(6), b.x + b.w - 3, b.y + b.h - 3, FM(7.5), PAL.muted, 'right');
    T(g, `${n} outers`, b.x + b.w - 3, b.y + b.h + 9, FM(8), PAL.muted, 'right');
    // readouts
    const rx0 = 252, rx1 = p.w - 8;
    let y = 40;
    const sps = APP.solveTimes.length / 2;
    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 13.4;
    };
    row('k_eff', s.k.toFixed(6), PAL.white);
    row('outers', String(s.outers), PAL.cyan);
    row('residual', fe(s.res, 1), s.res < 1e-5 ? PAL.up : PAL.warn);
    row('dominance ratio', s.dr.toFixed(4), PAL.violet);
    row('inner sweeps', `${s.sweeps}+${s.sweeps}`, PAL.text, '/outer');
    row('solve time', String(Math.round(s.ms)), PAL.text, 'ms');
    row('solves', sps.toFixed(1), PAL.blue, '/s');
    row('cell updates', `${(s.outers * 2 * s.sweeps * 15424 / 1e6).toFixed(2)}`, PAL.text, 'M');
    row('total solves', APP.solves.toLocaleString('en-US'), PAL.text);
    // outers per macro step sparkline
    const c = { x: 30, y: 178, w: 338, h: 28 };
    drawFrame(g, c);
    T(g, 'OUTERS PER MACRO STEP (ALL SOLVES)', c.x, c.y - 5, FT(8.5, 600), PAL.muted);
    const steps = APP.steps.slice(-169);
    const sorted = steps.map((q) => q.outers).sort((u, v) => u - v);
    const p98 = sorted.length ? sorted[Math.floor(0.98 * (sorted.length - 1))] : 50;
    const om = Math.max(50, Math.ceil(p98 * 1.15 / 10) * 10);
    const sw = c.w / 169;
    let lastCapX = -1e9;
    for (let i = 0; i < steps.length; i++) {
      const q = steps[i];
      const cap = q.outers > om;
      const hh = Math.max(1, (Math.min(q.outers, om) / om) * (c.h - 2));
      const bx = c.x + 1 + i * sw;
      g.fillStyle = cap ? PAL.down : q.solves > 1 ? hexA('#FFB547', 0.8) : hexA('#3FB8FF', 0.75);
      g.fillRect(bx, c.y + c.h - 1 - hh, Math.max(1, sw - 0.6), hh);
      if (cap) {
        g.fillStyle = PAL.white;
        g.fillRect(bx - 1, c.y + 1, Math.max(1, sw - 0.6) + 2, 1);
        if (bx - lastCapX > 30) {
          const cl = String(q.outers);
          g.font = FM(7.5, 700);
          const cw2 = g.measureText(cl).width;
          const tx = bx + 4 + cw2 > c.x + c.w ? bx - 3 - cw2 : bx + 4;
          g.fillStyle = 'rgba(5,9,15,0.85)';
          g.fillRect(tx - 2, c.y + 2, cw2 + 4, 9);
          T(g, cl, tx, c.y + 9, FM(7.5, 700), PAL.down);
          lastCapX = bx;
        }
      }
    }
    T(g, String(om), c.x - 3, c.y + 8, FM(7.5), PAL.muted, 'right');
    T(g, '0', c.x - 3, c.y + c.h, FM(7.5), PAL.muted, 'right');
    // benchmark line
    const B = APP.bench;
    if (B) {
      const ok = Math.abs(B.dpcm) <= 30;
      g.fillStyle = ok ? 'rgba(71,224,160,0.10)' : 'rgba(255,93,93,0.12)';
      g.fillRect(8, 214, p.w - 16, 28);
      rect(g, 8, 214, p.w - 16, 28, ok ? 'rgba(71,224,160,0.5)' : PAL.down);
      T(g, 'BOOT VALIDATION · IAEA 2D PWR BENCHMARK (ANL-7416 S2, PROBLEM 11)', 14, 225, FT(8.5, 700), ok ? PAL.up : PAL.down);
      T(g, `k ${B.k.toFixed(5)}  ref 1.02959  Δ ${sgn(B.dpcm, 1)} pcm  ·  ${B.outers} outers`, 14, 237, FM(9, 600), PAL.white);
      T(g, `DR ${B.dr.toFixed(3)}`, p.w - 14, 237, FM(9, 600), PAL.violet, 'right');
    }
  }

  // ---------- Monte Carlo ----------
  function drawMC(APP, now) {
    const p = P.montecarlo, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const M = APP.mc;
    setStretch(g);
    const kd = M.kDiff;
    // k per generation: a scrolling window of 600 generations across snapshot runs (earlier runs ghosted)
    const a = { x: 34, y: 36, w: 220, h: 70 };
    drawFrame(g, a);
    T(g, `k PER GENERATION \u00b7 LAST 600 GENS \u00b7 RUN ${M.run}`, a.x, a.y - 5, FT(8.5, 600), PAL.muted);
    const W = 600, g1 = M.gen, g0 = g1 - W;
    const span = 0.03;
    const yk = (k) => a.y + a.h - ((k - (kd - span)) / (2 * span)) * a.h;
    for (const d of [-0.02, -0.01, 0.01, 0.02]) hline(g, a.x, a.x + a.w, yk(kd + d), 'rgba(26,42,61,0.6)');
    T(g, (kd + span).toFixed(2), a.x - 3, a.y + 7, FM(7), PAL.muted, 'right');
    T(g, (kd - span).toFixed(2), a.x - 3, a.y + a.h, FM(7), PAL.muted, 'right');
    const xg = (q) => a.x + ((q - g0) / W) * a.w;
    const gk = M.gk;
    g.save();
    g.beginPath();
    g.rect(a.x, a.y, a.w, a.h);
    g.clip();
    // per run: inactive shading, k_diff line, +-3 sigma band of the running mean, mean line
    for (let ri = 0; ri < M.runs.length; ri++) {
      const R0 = M.runs[ri], cur = R0.run === M.run;
      const s0 = R0.start, s1 = ri + 1 < M.runs.length ? M.runs[ri + 1].start : g1;
      if (s1 < g0) continue;
      g.fillStyle = 'rgba(95,119,144,0.10)';
      g.fillRect(xg(s0), a.y, xg(Math.min(s1, s0 + M.inactive)) - xg(s0), a.h);
      g.strokeStyle = hexA('#FFB547', cur ? 0.9 : 0.4);
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(xg(s0), yk(R0.kDiff));
      g.lineTo(xg(s1), yk(R0.kDiff));
      g.stroke();
      g.setLineDash([]);
      const pts = gk.filter((e) => e.run === R0.run && e.act && e.g >= g0);
      if (pts.length > 1) {
        g.fillStyle = hexA('#3FB8FF', cur ? 0.24 : 0.12);
        g.beginPath();
        pts.forEach((e, j) => (j ? g.lineTo(xg(e.g), yk(e.mean + 3 * e.sig)) : g.moveTo(xg(e.g), yk(e.mean + 3 * e.sig))));
        for (let j = pts.length - 1; j >= 0; j--) g.lineTo(xg(pts[j].g), yk(pts[j].mean - 3 * pts[j].sig));
        g.fill();
        g.strokeStyle = cur ? PAL.white : 'rgba(242,247,255,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        pts.forEach((e, j) => (j ? g.lineTo(xg(e.g), yk(e.mean)) : g.moveTo(xg(e.g), yk(e.mean))));
        g.stroke();
      }
    }
    // k_gen dots: inactive grey, active blue, earlier runs at 30 %
    for (const e of gk) {
      if (e.g < g0) continue;
      const cur = e.run === M.run;
      g.fillStyle = e.act ? hexA('#3FB8FF', cur ? 0.95 : 0.3) : `rgba(95,119,144,${cur ? 0.95 : 0.3})`;
      g.fillRect(xg(e.g) - 0.75, yk(e.k) - 0.75, 1.5, 1.5);
    }
    g.restore();
    // snapshot dividers
    let lastLabelEnd = -1e9;
    for (const R0 of M.runs) {
      if (R0.start <= g0) continue;
      const x = xg(R0.start);
      vline(g, x, a.y, a.y + a.h, hexA('#FFB547', 0.7), [2, 2]);
      const lbl = `SNAP ${hhmm(R0.matT)}`;
      g.font = FT(7.5, 700);
      const w = g.measureText(lbl).width;
      let lx = x + 3 + w > a.x + a.w - 2 ? x - 3 - w : x + 3;
      if (lx < lastLabelEnd + 3) continue; // no room: the divider line alone marks it
      lastLabelEnd = lx + w;
      g.fillStyle = 'rgba(5,9,15,0.8)';
      g.fillRect(lx - 2, a.y + a.h - 11, w + 4, 10);
      T(g, lbl, lx, a.y + a.h - 3, FT(7.5, 700), PAL.warn);
    }
    T(g, 'band \u00b13\u03c3', a.x + 3, a.y + 9, FM(7.5), PAL.blue);
    T(g, 'k diff', a.x + a.w - 2, yk(kd) - 3, FM(7.5), PAL.warn, 'right');
    for (let q = Math.ceil(g0 / 100) * 100; q <= g1; q += 100) {
      if (q <= g0) continue;
      g.fillStyle = PAL.line2;
      g.fillRect(Math.round(xg(q)), a.y + a.h, 1, 3);
      T(g, String(q), xg(q), a.y + a.h + 9, FM(7), PAL.muted, 'center');
    }
    // entropy: continuous across runs (the fission source carries over)
    const b = { x: 34, y: 133, w: 220, h: 28 };
    drawFrame(g, b);
    T(g, 'SHANNON ENTROPY OF THE SOURCE, 17\u00d717 BINS (bits)', b.x, b.y - 5, FT(8.5, 600), PAL.muted);
    let hmn = Infinity, hmx = -Infinity;
    for (const e of gk) if (e.g >= g0) {
      hmn = Math.min(hmn, e.H);
      hmx = Math.max(hmx, e.H);
    }
    if (!isFinite(hmn)) {
      hmn = 7;
      hmx = 7.5;
    }
    const hp = Math.max(0.05, (hmx - hmn) * 0.25);
    hmn -= hp;
    hmx += hp;
    g.strokeStyle = PAL.violet;
    g.lineWidth = 1.1;
    g.beginPath();
    let st = false;
    for (const e of gk) {
      if (e.g < g0) continue;
      const x = xg(e.g), y = b.y + b.h - ((e.H - hmn) / (hmx - hmn)) * b.h;
      if (!st) g.moveTo(x, y);
      else g.lineTo(x, y);
      st = true;
    }
    g.stroke();
    for (const R0 of M.runs) if (R0.start > g0) vline(g, xg(R0.start), b.y, b.y + b.h, hexA('#FFB547', 0.5), [2, 2]);
    T(g, hmx.toFixed(2), b.x - 3, b.y + 7, FM(7), PAL.muted, 'right');
    T(g, hmn.toFixed(2), b.x - 3, b.y + b.h, FM(7), PAL.muted, 'right');
    // readouts
    const rx0 = 264, rx1 = p.w - 8;
    let y = 40;
    const hs = M.histT.length > 1 ? M.histT.slice(1).reduce((s, q) => s + q[1], 0) / ((M.histT.at(-1)[0] - M.histT[0][0]) / 1000) : 0;
    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 12.4;
    };
    const q = APP.mcShown();
    V.mcQ = q;
    const act = q.n > 1;
    const qc = q.prev ? PAL.muted : PAL.blue;
    row(q.prev ? 'k̄ prev run' : 'k̄ MC', act ? q.kMean.toFixed(5) : '–', qc);
    row('\u03c3(mean)', act ? (q.kSig * 1e5).toFixed(0) : '\u2013', qc, 'pcm');
    row('\u03c3 per gen', act ? (q.kStd * 1e5).toFixed(0) : '\u2013', PAL.muted, 'pcm');
    row('k diff', q.kDiff.toFixed(5), PAL.warn);
    row('Δ MC−diff', act ? sgn((q.kMean - q.kDiff) * 1e5, 0) : '–', q.prev ? PAL.muted : PAL.text, 'pcm');
    row('active / inact.', `${M.act.n} / ${Math.min(M.genRun, M.inactive)}`, PAL.text);
    row('H source', M.last ? M.last.H.toFixed(3) : '–', PAL.violet, 'bits');
    const gps = M.histT.length > 1 ? (M.histT.length - 1) / ((M.histT.at(-1)[0] - M.histT[0][0]) / 1000) : 0;
    row(`hist/s · ${gps.toFixed(0)} gen/s`, (hs / 1e6).toFixed(2), PAL.cyan, 'M');
    row('total', (M.total / 1e6).toFixed(1), PAL.white, 'M');
    row('collisions/hist', M.last ? (M.last.coll / M.last.n).toFixed(1) : '–', PAL.text);
    row('leakage', M.last ? (M.last.leak / M.last.n * 100).toFixed(2) : '–', PAL.text, '%');
    // source map 17x17
    const sx = 34, sy = 176, ss = 3;
    if (M.bins) {
      let mx = 0;
      for (const v of M.bins) mx = Math.max(mx, v);
      for (let j = 0; j < NA; j++) for (let i = 0; i < NA; i++) {
        const v = M.bins[j * NA + i] / mx;
        if (v <= 0) continue;
        const c = window.HEAT.rampColor(2, 0.15 + 0.85 * v);
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(sx + i * ss, sy + j * ss, ss - 0.4, ss - 0.4);
      }
    }
    rect(g, sx - 2, sy - 2, NA * ss + 4, NA * ss + 4, PAL.line);
    T(g, 'SOURCE', sx + NA * ss + 6, sy + 8, FT(8, 600), PAL.muted);
    T(g, `${M.last ? M.last.nb : 0}`, sx + NA * ss + 6, sy + 19, FM(8), PAL.text);
    T(g, 'sites', sx + NA * ss + 6, sy + 29, FC(7.5), PAL.muted);
    // workers: compute time (worker clock) vs the frame-clock period of one generation
    const wx0 = 122, wy = 176;
    const sh = M.last ? M.last.shares : [0];
    const per = M.period || 16.7;
    T(g, `WORKERS \u00b7 ${Math.min(...sh).toLocaleString('en-US')} n EACH \u00b7 BUSY | WAIT OF ${per.toFixed(1)} ms/GEN`, wx0, wy + 2, FT(8, 600), PAL.muted);
    for (let i = 0; i < 6; i++) {
      const x = wx0 + (i % 3) * 82, yy = wy + 12 + Math.floor(i / 3) * 26;
      const ms = M.workerMs[i];
      const busy = Math.min(1, ms / per);
      T(g, `MC${i + 1}`, x, yy + 7, FT(8.5, 700), PAL.violet);
      g.fillStyle = 'rgba(26,42,61,0.7)';
      g.fillRect(x + 25, yy + 1, 52, 6);
      g.fillStyle = hexA('#9B8CFF', 0.9);
      g.fillRect(x + 25, yy + 1, 52 * busy, 6);
      const rate = ms > 0 ? (sh[i] || 0) / ms : 0; // histories per ms of compute
      T(g, `${ms.toFixed(1)}|${Math.max(0, per - ms).toFixed(1)} ${(rate).toFixed(0)}k/s`, x + 77, yy + 17, FM(7.5), PAL.text, 'right');
    }
  }

  // ---------- right column: shared time axis ----------
  function tAxis(APP) {
    const t1 = APP.clock + TFWD, t0 = APP.clock - TBACK;
    return { t0, t1, x: (t) => TX0 + ((t - t0) / (t1 - t0)) * (TX1 - TX0) };
  }
  function shadeLoadFollow(g, A, y0, y1, APP) {
    // scheduled 50% periods: 20:00 -> 02:00 (from Day 1)
    g.fillStyle = 'rgba(155,140,255,0.07)';
    for (let d = 0; d < 6; d++) {
      const s = d * DAY + 20 * 60, e = s + 6 * 60;
      const xs = Math.max(TX0, A.x(s)), xe = Math.min(TX1, A.x(e));
      if (xe > xs) g.fillRect(xs, y0, xe - xs, y1 - y0);
    }
  }
  function timeGrid(g, A, y0, y1, labels, APP) {
    const start = Math.ceil(A.t0 / 120) * 120;
    for (let t = start; t <= A.t1; t += 120) {
      const x = A.x(t);
      const major = t % 360 === 0;
      vline(g, x, y0, y1, major ? 'rgba(36,56,79,0.75)' : 'rgba(26,42,61,0.45)');
      if (labels && major) {
        const midnight = ((t % DAY) + DAY) % DAY === 0;
        T(g, midnight ? `D${Math.floor(t / DAY) + 1}` : hhmm(t), x, y1 + 10, midnight ? FT(8.5, 700) : FM(7.5), midnight ? PAL.text : PAL.muted, 'center');
      }
    }
    // future region and now line
    const xn = A.x(APP.clock);
    g.fillStyle = 'rgba(5,9,15,0.35)';
    g.fillRect(xn, y0, TX1 - xn, y1 - y0);
    vline(g, xn, y0, y1, hexA('#6FE3FF', 0.75));
    if (APP.dropped) {
      const xd = A.x(APP.dropAt);
      if (xd > TX0) vline(g, xd, y0, y1, hexA('#FF5D5D', 0.7), [3, 2]);
    }
  }
  function series(g, A, hist, get, yf, color, width, dash, step) {
    g.strokeStyle = color;
    g.lineWidth = width || 1.2;
    if (dash) g.setLineDash(dash);
    g.beginPath();
    let st = false, py = 0;
    for (const r of hist) {
      if (r.t < A.t0 - 30) continue;
      const v = get(r);
      if (v === null || !isFinite(v)) continue;
      const x = Math.max(TX0, A.x(r.t)), y = yf(v);
      if (!st) g.moveTo(x, y);
      else if (step) {
        g.lineTo(x, py);
        g.lineTo(x, y);
      } else g.lineTo(x, y);
      st = true;
      py = y;
    }
    g.stroke();
    if (dash) g.setLineDash([]);
  }
  function rangeOf(hist, A, get, pad) {
    let mn = Infinity, mx = -Infinity;
    for (const r of hist) {
      if (r.t < A.t0) continue;
      const v = get(r);
      if (!isFinite(v)) continue;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
    const p = (mx - mn) * (pad || 0.1) || 1;
    return [mn - p, mx + p];
  }
  // round tick values inside [lo, hi], labels kept 7 px away from the plot edges (no clash between stacked plots)
  function axisLabels(g, x, y0, y1, lo, hi, fmt, color, align, n = 3) {
    const span = hi - lo;
    if (!(span > 0)) return;
    const raw = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = mag;
    for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) {
      step = m * mag;
      break;
    }
    const nice = [1, 2, 2.5, 5, 10];
    const fits = (st) => {
      let c = 0;
      for (let v = Math.ceil(lo / st) * st; v <= hi + 1e-9; v += st) {
        const y = y1 - ((v - lo) / span) * (y1 - y0);
        if (y >= y0 + 6 && y <= y1 - 4) c++;
      }
      return c;
    };
    for (let guard = 0; guard < 6 && fits(step) < 3; guard++) {
      const m = step / Math.pow(10, Math.floor(Math.log10(step)));
      const k = nice.findIndex((q) => Math.abs(q - m) < 1e-6);
      step = k > 0 ? nice[k - 1] * Math.pow(10, Math.floor(Math.log10(step))) : 0.5 * step;
    }
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) === 2.5 ? 1 : 0));
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = y1 - ((v - lo) / span) * (y1 - y0);
      if (y < y0 + 6 || y > y1 - 4) continue;
      T(g, fmt(v), x, y + 3, FM(7.5), color || PAL.muted, align);
      g.fillStyle = 'rgba(36,56,79,0.28)';
      g.fillRect(TX0 + 1, Math.round(y), TX1 - TX0 - 2, 1);
    }
  }
  function unitTag(g, s, x, y, color, align) {
    g.font = FC(7.5);
    const w = g.measureText(s).width;
    const xx = align === 'right' ? x - w - 6 : x;
    g.fillStyle = 'rgba(5,9,15,0.8)';
    g.fillRect(xx, y - 8, w + 6, 11);
    T(g, s, xx + 3, y, FC(7.5), color || PAL.muted);
  }
  // legend in the panel title strip, right-aligned
  function legendStrip(g, items, xr) {
    let x = xr;
    for (let i = items.length - 1; i >= 0; i--) {
      const [n, c, dash] = items[i];
      g.font = FT(8.5, 600);
      const w = g.measureText(n).width;
      T(g, n, x, 14, FT(8.5, 600), c, 'right');
      x -= w + 4;
      if (dash) {
        g.fillStyle = c;
        g.fillRect(x - 10, 10, 4, 2);
        g.fillRect(x - 4, 10, 4, 2);
      } else {
        g.fillStyle = c;
        g.fillRect(x - 10, 10, 10, 2);
      }
      x -= 22;
    }
  }
  function plotBox(g, y0, y1) {
    g.fillStyle = 'rgba(5,9,15,0.4)';
    g.fillRect(TX0, y0, TX1 - TX0, y1 - y0);
    rect(g, TX0, y0, TX1 - TX0, y1 - y0, PAL.line);
  }

  function drawXenon(APP) {
    const p = P.xenon, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const A = tAxis(APP), h = APP.hist;
    setStretch(g);
    const a0 = 28, a1 = 112, b0 = 120, b1 = 200;
    for (const [y0, y1] of [[a0, a1], [b0, b1]]) {
      plotBox(g, y0, y1);
      shadeLoadFollow(g, A, y0, y1, APP);
      timeGrid(g, A, y0, y1, y1 === b1, APP);
    }
    // concentrations: Xe-135 (left axis) and I-135 (right axis), each on its own scale
    const [xlo, xhi] = rangeOf(h, A, (r) => r.X, 0.12);
    const [ilo, ihi] = rangeOf(h, A, (r) => r.I, 0.12);
    const yX = (v) => a1 - ((v - xlo) / (xhi - xlo)) * (a1 - a0);
    const yI = (v) => a1 - ((v - ilo) / (ihi - ilo)) * (a1 - a0);
    g.save();
    g.beginPath();
    g.rect(TX0, a0, TX1 - TX0, a1 - a0);
    g.clip();
    series(g, A, h, (r) => r.I, yI, PAL.violet, 1.6);
    series(g, A, h, (r) => r.X, yX, PAL.amber, 1.9);
    g.restore();
    axisLabels(g, TX0 - 4, a0, a1, xlo, xhi, (v) => (v / 1e15).toFixed(2), PAL.amber, 'right', 4);
    axisLabels(g, TX1 + 4, a0, a1, ilo, ihi, (v) => (v / 1e15).toFixed(1), PAL.violet, 'left', 4);
    unitTag(g, '×10¹⁵ atoms/cm³ · Xe-135 left axis · I-135 right axis', TX0 + 3, a0 + 10, PAL.text);
    // xenon worth with the pit markers
    const [rlo, rhi] = rangeOf(h, A, (r) => r.xe, 0.18);
    const yR = (v) => b1 - ((v - rlo) / (rhi - rlo)) * (b1 - b0);
    g.save();
    g.beginPath();
    g.rect(TX0, b0, TX1 - TX0, b1 - b0);
    g.clip();
    g.fillStyle = 'rgba(255,181,71,0.10)';
    g.beginPath();
    let st = false, lastX = TX0;
    for (const r of h) {
      if (r.t < A.t0 - 30) continue;
      const x = Math.max(TX0, A.x(r.t));
      if (!st) g.moveTo(x, b0);
      g.lineTo(x, yR(r.xe));
      st = true;
      lastX = x;
    }
    g.lineTo(lastX, b0);
    g.fill();
    hline(g, TX0, TX1, yR(APP.xeEq), 'rgba(214,228,240,0.3)', [2, 3]);
    series(g, A, h, (r) => r.xe, yR, PAL.white, 1.5);
    g.restore();
    axisLabels(g, TX0 - 4, b0, b1, rlo, rhi, (v) => neg(v, 0), PAL.text, 'right', 4);
    for (const pk of APP.xePeaks) {
      if (!pk || pk.t < A.t0 || pk.xe > -100) continue;
      const x = A.x(pk.t), y = yR(pk.xe);
      g.fillStyle = PAL.amber;
      g.beginPath();
      g.moveTo(x, y + 2);
      g.lineTo(x - 4, y + 8);
      g.lineTo(x + 4, y + 8);
      g.fill();
      const lbl = `PIT ${neg(pk.xe, 0)} pcm · ${clock(pk.t)}`;
      g.font = FM(8.5, 600);
      const w = g.measureText(lbl).width;
      const lx = Math.min(TX1 - w - 4, Math.max(TX0 + 4, x - w / 2));
      const ly = Math.min(b1 - 4, y + 19);
      g.fillStyle = 'rgba(5,9,15,0.85)';
      g.fillRect(lx - 3, ly - 9, w + 6, 12);
      T(g, lbl, lx, ly, FM(8.5, 600), PAL.amber);
    }
    legendStrip(g, [['Xe-135 (left)', PAL.amber], ['I-135 (right)', PAL.violet], ['ρXe', PAL.white], ['LOAD-FOLLOW 50%', hexA('#9B8CFF', 0.8)]], p.w - 8);
    g.font = FT(8.5, 600);
    const fl = `XENON WORTH \u03c1Xe = (1/k_noXe \u2212 1/k)\u00b710\u2075 pcm \u00b7 DASHED: EQ 100% ${neg(APP.xeEq, 0)}`;
    g.fillStyle = 'rgba(5,9,15,0.85)';
    g.fillRect(TX0 + 3, b0 + 3, g.measureText(fl).width + 8, 12);
    T(g, fl, TX0 + 7, b0 + 12, FT(8.5, 600), PAL.white);
    {
      const nl = `NOW ${clock(APP.clock)}`;
      g.font = FM(8, 600);
      const nw = g.measureText(nl).width;
      const nx = A.x(APP.clock);
      g.fillStyle = 'rgba(5,9,15,0.85)';
      g.fillRect(nx - nw - 8, a0 + 2, nw + 6, 12);
      T(g, nl, nx - 5, a0 + 11, FM(8, 600), PAL.cyan, 'right');
    }
    // readouts
    const r = h.at(-1);
    const rx0 = 650, rx1 = p.w - 8;
    let y = 36;
    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 14;
    };
    row('ρXe now', neg(r.xe, 0), PAL.amber, 'pcm');
    row('Xe-135', fe(r.X, 3), PAL.amber);
    row('I-135', fe(r.I, 3), PAL.violet);
    row('eq @100%', neg(APP.xeEq, 0), PAL.text, 'pcm');
    const pk = APP.xePeaks.filter(Boolean).at(-1);
    row('last pit', pk ? neg(pk.xe, 0) : '–', PAL.white, 'pcm');
    row('at', pk ? clock(pk.t) : '–', PAL.muted);
    row('σa Xe', '2.65e-18', PAL.muted, 'cm²');
    row('λI / λX', '2.87 / 2.09', PAL.muted, 'e-5/s');
    row('γI / γX', '.0639/.0024', PAL.muted);
    row('k no-Xe', APP.kNoXe.toFixed(5), PAL.text);
    row('macro step', `${APP.macro} min`, PAL.muted);
  }

  function drawLoadFollow(APP) {
    const p = P.loadfollow, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const A = tAxis(APP), h = APP.hist;
    setStretch(g);
    const a0 = 28, a1 = 86, b0 = 96, b1 = 162;
    for (const [y0, y1] of [[a0, a1], [b0, b1]]) {
      plotBox(g, y0, y1);
      shadeLoadFollow(g, A, y0, y1, APP);
      timeGrid(g, A, y0, y1, y1 === b1, APP);
    }
    // power: demand vs actual
    const yP = (v) => a1 - ((v - 40) / 65) * (a1 - a0);
    g.save();
    g.beginPath();
    g.rect(TX0, a0, TX1 - TX0, a1 - a0);
    g.clip();
    // scheduled demand into the future
    g.strokeStyle = hexA('#F2F7FF', 0.55);
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    g.beginPath();
    let st = false;
    const dem = (t) => (t < 20 * 60 ? 100 : (((t % DAY) + DAY) % DAY >= 1200 || ((t % DAY) + DAY) % DAY < 120 ? 50 : 100));
    for (let t = Math.floor(A.t0 / 5) * 5; t <= A.t1; t += 5) {
      const x = A.x(t), y = yP(dem(t));
      if (!st) g.moveTo(x, y);
      else g.lineTo(x, y);
      st = true;
    }
    g.stroke();
    g.setLineDash([]);
    series(g, A, h, (r) => r.power, yP, PAL.cyan, 1.8);
    g.restore();
    axisLabels(g, TX0 - 4, a0, a1, 40, 105, (v) => v.toFixed(0), PAL.muted, 'right', 3);
    unitTag(g, 'POWER %', TX0 + 3, a0 + 10, PAL.cyan);
    // bank D and boron
    const [slo, shi] = rangeOf(h, A, (r) => r.steps, 0.15);
    const sl = Math.min(slo, 190), sh = 230;
    const yS = (v) => b1 - ((v - sl) / (sh - sl)) * (b1 - b0);
    const [plo, phi] = rangeOf(h, A, (r) => r.ppm, 0.15);
    const yB = (v) => b1 - ((v - plo) / (phi - plo)) * (b1 - b0);
    g.save();
    g.beginPath();
    g.rect(TX0, b0, TX1 - TX0, b1 - b0);
    g.clip();
    hline(g, TX0, TX1, yS(210), hexA('#FFB547', 0.35), [2, 3]);
    series(g, A, h, (r) => r.ppm, yB, PAL.up, 1.5);
    series(g, A, h, (r) => r.steps, yS, PAL.amber, 1.4, null, true);
    g.restore();
    axisLabels(g, TX0 - 4, b0, b1, sl, sh, (v) => v.toFixed(0), PAL.amber, 'right', 3);
    axisLabels(g, TX1 + 4, b0, b1, plo, phi, (v) => v.toFixed(0), PAL.up, 'left', 3);
    unitTag(g, 'BANK D steps', TX0 + 3, b0 + 10, PAL.amber);
    unitTag(g, 'BORON ppm', TX1 - 3, b0 + 10, PAL.up, 'right');
    legendStrip(g, [['DEMAND', hexA('#F2F7FF', 0.7), true], ['CORE POWER', PAL.cyan], ['BANK D (left)', PAL.amber], ['BORON (right)', PAL.up], ['TARGET 210 st', hexA('#FFB547', 0.6), true]], p.w - 8);
    // readouts
    const r = h.at(-1);
    const rx0 = 650, rx1 = p.w - 8;
    let y = 36;
    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 13.6;
    };
    row('Doppler', neg(r.dc, 2), PAL.violet, 'pcm/K');
    row('power defect', neg(r.pd, 0), PAL.violet, 'pcm');
    row('MTC', neg(r.mtc, 1), PAL.cyan, 'pcm/K');
    row('boron worth', neg(r.bw, 2), PAL.up, 'pcm/ppm');
    row('D diff. worth', r.dw.toFixed(1), PAL.amber, 'pcm/st');
    row('T avg', r.tm.toFixed(1), PAL.text, 'K');
    row('Tf mean', r.tf.toFixed(0), PAL.text, 'K');
    row('Tf max', r.tfMax.toFixed(0), r.tfMax > 1700 ? PAL.warn : PAL.text, 'K');
    row('demand', r.demand.toFixed(0), PAL.white, '%');
    row('op. fuel νΣf₂', `×${APP.fuelScale.toFixed(3)}`, PAL.muted);
  }

  function drawTilt(APP) {
    const p = P.tilt, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const A = tAxis(APP), h = APP.hist;
    setStretch(g);
    const a0 = 28, a1 = 96, b0 = 104, b1 = 144;
    for (const [y0, y1] of [[a0, a1], [b0, b1]]) {
      plotBox(g, y0, y1);
      shadeLoadFollow(g, A, y0, y1, APP);
      timeGrid(g, A, y0, y1, y1 === b1, APP);
    }
    let qmin = Infinity, qmax = -Infinity;
    for (const r of h) {
      if (r.t < A.t0) continue;
      qmin = Math.min(qmin, ...r.q);
      qmax = Math.max(qmax, r.qptr);
    }
    const qlo = Math.min(0.95, qmin - 0.06), qhi = Math.max(1.05, qmax + 0.13);
    const yQ = (v) => a1 - ((v - qlo) / (qhi - qlo)) * (a1 - a0);
    g.save();
    g.beginPath();
    g.rect(TX0, a0, TX1 - TX0, a1 - a0);
    g.clip();
    hline(g, TX0, TX1, yQ(1.02), hexA('#FFB547', 0.9), [4, 3]);
    hline(g, TX0, TX1, yQ(1.0), 'rgba(214,228,240,0.25)');
    const QC = [PAL.cyan, PAL.violet, PAL.down, PAL.up];
    for (let q = 0; q < 4; q++) series(g, A, h, (r) => r.q[q], yQ, hexA(QC[q], 0.85), 1.1);
    series(g, A, h, (r) => r.qptr, yQ, PAL.white, 1.8);
    g.restore();
    T(g, 'LIMIT 1.02', TX0 + 190, yQ(1.02) - 3, FM(7.5, 600), PAL.warn, 'left');
    {
      // the tilt beyond ~1.2 is xenon redistribution in a loosely coupled core, not the rod alone: say so on the trace
      const last = h.at(-1);
      if (APP.dropped && last && last.qptr > 1.2) {
        const tag = `XENON-DRIVEN · DR ${APP.solve ? APP.solve.dr.toFixed(3) : '-'} · UNCONTROLLED`;
        g.font = FT(8, 700);
        const tw = g.measureText(tag).width;
        const tx = A.x(APP.clock) - 8 - tw, ty = Math.min(a1 - 18, yQ(last.qptr) + 12);
        g.fillStyle = 'rgba(5,9,15,0.85)';
        g.fillRect(tx - 3, ty - 8, tw + 6, 11);
        T(g, tag, tx, ty, FT(8, 700), PAL.amber);
      }
    }
    axisLabels(g, TX0 - 4, a0, a1, qlo, qhi, (v) => v.toFixed(2), PAL.muted, 'right', 4);
    unitTag(g, 'QUADRANT POWER / MEAN', TX0 + 3, a0 + 10, PAL.text);
    if (APP.dropped) {
      const xd = A.x(APP.dropAt);
      if (xd > TX0) {
        const lbl = `ROD DROP ${hhmm(APP.dropAt)} SW E13`;
        g.font = FT(8.5, 700);
        const lw = g.measureText(lbl).width + 8;
        const lx2 = xd + 3 + lw > TX1 - 2 ? xd - 3 - lw : xd + 3;
        g.fillStyle = 'rgba(5,9,15,0.85)';
        g.fillRect(lx2, a1 - 15, lw, 12);
        T(g, lbl, lx2 + 4, a1 - 6, FT(8.5, 700), PAL.down);
      }
    }
    // peaking
    let [flo, fhi] = rangeOf(h, A, (r) => r.fcell, 0.1);
    flo = Math.min(flo, rangeOf(h, A, (r) => r.fxy, 0.1)[0]);
    const yF = (v) => b1 - ((v - flo) / (fhi - flo)) * (b1 - b0);
    g.save();
    g.beginPath();
    g.rect(TX0, b0, TX1 - TX0, b1 - b0);
    g.clip();
    series(g, A, h, (r) => r.fcell, yF, PAL.blue, 1.2);
    series(g, A, h, (r) => r.fxy, yF, PAL.amber, 1.5);
    g.restore();
    axisLabels(g, TX0 - 4, b0, b1, flo, fhi, (v) => v.toFixed(2), PAL.muted, 'right', 3);
    unitTag(g, 'PEAKING', TX0 + 3, b0 + 10, PAL.amber);
    legendStrip(g, [['QPTR', PAL.white], ['NW', PAL.cyan], ['NE', PAL.violet], ['SW', PAL.down], ['SE', PAL.up], ['LIMIT 1.02', PAL.warn, true], ['F_xy', PAL.amber], ['F_cell', PAL.blue]], p.w - 8);
    const r = h.at(-1);
    const rx0 = 650, rx1 = p.w - 8;
    let y = 36;
    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 12.4;
    };
    row('QPTR', r.qptr.toFixed(4), r.qptr > 1.02 ? PAL.warn : PAL.white);
    row('max (drop)', APP.dropped ? APP.qptrMax.toFixed(4) : '–', APP.qptrMax > 1.02 ? PAL.warn : PAL.muted);
    row('NW', r.q[0].toFixed(4), PAL.cyan);
    row('NE', r.q[1].toFixed(4), PAL.violet);
    row('SW', r.q[2].toFixed(4), PAL.down);
    row('SE', r.q[3].toFixed(4), PAL.up);
    row('F_xy', r.fxy.toFixed(3), PAL.amber);
    row('F_cell', r.fcell.toFixed(3), PAL.blue);
    row('F_xy max', APP.fxyMax.toFixed(3), PAL.muted);
    row('rod worth @drop', APP.dropped && r.dropWorth0 ? neg(r.dropWorth0, 0) : '\u2013', PAL.down, 'pcm');
    row('rod worth now', APP.dropped && r.dropWorth ? neg(r.dropWorth, 0) : '\u2013', PAL.down, 'pcm');
  }

  function drawFields(APP) {
    const p = P.fields, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    if (!V.st.fields) return;
    setStretch(g);
    FIELD_MAPS.forEach((m, i) => {
      const x0 = i * FCOL;
      const s = V.st.fields[m.k];
      const mx = s.max * 1.02;
      // colour bar
      const bx = x0 + 8 + N + 6, by = 26, bh = N;
      for (let k = 0; k < bh; k++) {
        const c = window.HEAT.rampColor(m.ramp, 1 - k / (bh - 1));
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.fillRect(bx, by + k, 6, 1);
      }
      rect(g, bx - 1, by - 1, 8, bh + 2, PAL.line2);
      T(g, fe(mx, 1), bx + 9, by + 7, FM(7.5), PAL.muted);
      T(g, fe(mx / 2, 1), bx + 9, by + bh / 2 + 3, FM(7.5), PAL.muted);
      T(g, '0', bx + 9, by + bh, FM(7.5), PAL.muted);
      const ym = (v) => by + bh - (v / mx) * bh;
      g.fillStyle = PAL.white;
      g.fillRect(bx - 3, Math.round(ym(s.mean)), 3, 1);
      rect(g, x0 + 7, 25, N + 2, N + 2, PAL.line);
      T(g, m.name, x0 + 10, 35, FT(8.5, 700), PAL.white);
      T(g, m.unit, x0 + 8 + N - 2, 35, FC(7.5), PAL.text, 'right');
      T(g, `min ${fe(s.min, 2)}  max ${fe(s.max, 2)}`, x0 + 8, 176, FM(8), PAL.text);
      T(g, `mean ${fe(s.mean, 3)}`, x0 + 8, 188, FM(8), PAL.muted);
      if (i < 3) vline(g, x0 + FCOL - 1, 24, p.h - 4, PAL.line);
    });
  }

  // ---------- compute plant ----------
  function drawCompute(APP, now) {
    const p = P.compute, g = p.ctx;
    g.clearRect(0, 0, p.w, p.h);
    const S = window.STUDIO;
    const m = S.metrics();
    const hist = S.history(30);
    const sys = S.system || {};
    setStretch(g);
    T(g, `${(sys.cpu || 'CPU').replace(' with Radeon Graphics', '')} · ${sys.cores || 8}C/${sys.threads || 16}T · ${sys.ramGB || ''} GB · ${sys.gpu || ''}`, 160, 14, FT(9, 500), PAL.muted);
    const nT = Math.max(16, (m.cpu || []).length);
    const cw = 29, x0 = 12, ledTop = 30, ledH = 92, nSeg = 23;
    T(g, `CPU ${m.cpuTotal != null ? m.cpuTotal.toFixed(0) : '–'}%`, p.w - 8, 14, FM(9, 600), PAL.cyan, 'right');
    for (let i = 0; i < 16; i++) {
      const x = x0 + i * cw;
      const v = m.cpu && m.cpu[i] != null ? m.cpu[i] : 0;
      const lit = Math.round((v / 100) * nSeg);
      for (let s = 0; s < nSeg; s++) {
        const y = ledTop + ledH - (s + 1) * (ledH / nSeg);
        const on = s < lit;
        g.fillStyle = on ? (s >= nSeg * 0.85 ? PAL.amber : s >= nSeg * 0.6 ? PAL.cyan : hexA('#3FB8FF', 0.8)) : 'rgba(26,42,61,0.55)';
        g.fillRect(x + 4, Math.round(y) + 1, 14, Math.max(1, ledH / nSeg - 1.2));
      }
      T(g, `T${String(i).padStart(2, '0')}`, x + 11, ledTop + ledH + 11, FT(8, 600), PAL.muted, 'center');
      T(g, `${v.toFixed(0)}`, x + 11, ledTop + ledH + 22, FM(8.5, 600), v > 85 ? PAL.amber : PAL.text, 'center');
      // 30 s sparkline
      const sy0 = ledTop + ledH + 27, sh = 26;
      g.fillStyle = 'rgba(5,9,15,0.5)';
      g.fillRect(x + 1, sy0, cw - 4, sh);
      g.strokeStyle = hexA('#6FE3FF', 0.85);
      g.lineWidth = 1;
      g.beginPath();
      const n = hist.length;
      for (let k = 0; k < n; k++) {
        const vv = hist[k].cpu && hist[k].cpu[i] != null ? hist[k].cpu[i] : 0;
        const xx = x + 1 + (k / Math.max(1, n - 1)) * (cw - 4), yy = sy0 + sh - (vv / 100) * (sh - 2) - 1;
        if (k === 0) g.moveTo(xx, yy);
        else g.lineTo(xx, yy);
      }
      g.stroke();
    }
    T(g, '30 s', x0 + 16 * cw - 4, ledTop + ledH + 27 + 26 + 10, FC(7.5), PAL.muted, 'right');
    T(g, 'THREAD LOAD % · ROD-POSITION COLUMNS', x0, ledTop + ledH + 27 + 26 + 10, FT(8, 600), PAL.muted);
    vline(g, 482, 26, p.h - 6, PAL.line);
    // right side
    const rx0 = 492, rx1 = p.w - 8;
    let y = 36;
    const bar = (label, frac, text, color) => {
      T(g, label, rx0, y, FT(9, 600), PAL.muted);
      T(g, text, rx1, y, FM(9.5, 600), color || PAL.text, 'right');
      g.fillStyle = 'rgba(26,42,61,0.6)';
      g.fillRect(rx0 + 40, y - 6, 120, 5);
      if (frac != null) {
        g.fillStyle = color || PAL.blue;
        g.fillRect(rx0 + 40, y - 6, 120 * Math.max(0, Math.min(1, frac)), 5);
      }
      y += 14;
    };
    bar('RAM', m.ramTotal ? m.ramUsed / m.ramTotal : null, m.ramTotal ? `${m.ramUsed.toFixed(1)} / ${m.ramTotal.toFixed(1)} GB` : '–', PAL.blue);
    bar('GPU', m.gpu != null ? m.gpu / 100 : null, m.gpu != null ? `${m.gpu.toFixed(0)}%` : '–', PAL.violet);
    const dr = m.diskR != null ? m.diskR : null, dw = m.diskW != null ? m.diskW : null;
    bar('DISK', dr != null ? Math.min(1, (dr + dw) / 50) : null, dr != null ? `R ${dr.toFixed(1)} · W ${dw.toFixed(1)} MB/s` : '–', PAL.cyan);
    const pf = S.perf();
    bar('PAGE', pf.fps / 60, `${pf.fps} fps · ${pf.frameMs.toFixed(1)} ms`, PAL.up);
    // frame time trace: page frame interval (kit) and this page's real JavaScript per frame
    const f = { x: rx0 + 40, y: y - 4, w: rx1 - rx0 - 40, h: 34 };
    drawFrame(g, f);
    T(g, 'FRAME', rx0, y + 6, FT(8.5, 600), PAL.muted);
    T(g, 'ms', rx0, y + 17, FC(7.5), PAL.muted);
    const js = APP.jsSeries || [];
    let jmax = 0, jsum = 0;
    for (const v of js) {
      jmax = Math.max(jmax, v);
      jsum += v;
    }
    g.fillStyle = hexA('#6FE3FF', 0.55);
    for (let k = 0; k < js.length; k++) {
      const hh = Math.max(1, (Math.min(40, js[k]) / 40) * f.h);
      g.fillRect(f.x + (k / 240) * f.w, f.y + f.h - hh, Math.max(1, f.w / 240 - 0.2), hh);
    }
    T(g, `JS ${js.length ? (jsum / js.length).toFixed(1) : '-'} avg \u00b7 ${jmax.toFixed(0)} max`, f.x + 3, f.y + 9, FM(7), PAL.cyan);
    const yms = (v) => f.y + f.h - (Math.min(40, v) / 40) * f.h;
    hline(g, f.x, f.x + f.w, yms(16.7), hexA('#FFB547', 0.8), [3, 2]);
    T(g, '16.7', f.x + f.w - 2, yms(16.7) - 2, FM(7), PAL.warn, 'right');
    g.strokeStyle = PAL.up;
    g.lineWidth = 1.1;
    g.beginPath();
    const ps = APP.perfSeries;
    for (let k = 0; k < ps.length; k++) {
      const xx = f.x + (k / 119) * f.w, yy = yms(ps[k].ms);
      if (k === 0) g.moveTo(xx, yy);
      else g.lineTo(xx, yy);
    }
    g.stroke();
    y += f.h + 8;
    // workers
    T(g, 'WORKERS', rx0, y + 4, FT(8.5, 700), PAL.blue);
    const sps = APP.solveTimes.length / 2;
    const steps = APP.steps.slice(-6);
    const ops = steps.length ? steps.reduce((s, q) => s + q.outers, 0) : 0;
    T(g, 'DIFF', rx0 + 52, y + 4, FT(8.5, 700), PAL.cyan);
    T(g, `${sps.toFixed(1)} solves/s · ${APP.diffMs} ms/step · ${ops} outers`, rx0 + 76, y + 4, FM(8), PAL.muted);
    y += 13;
    const M = APP.mc;
    const hsTot = M.histT.length > 1 ? M.histT.slice(1).reduce((s, q) => s + q[1], 0) / ((M.histT.at(-1)[0] - M.histT[0][0]) / 1000) : 0;
    const shares = M.last ? M.last.shares : [];
    for (let i = 0; i < 6; i++) {
      const x = rx0 + (i % 3) * 94, yy = y + Math.floor(i / 3) * 12;
      const ms = M.workerMs[i];
      T(g, `MC${i + 1}`, x, yy + 4, FT(8.5, 700), PAL.violet);
      T(g, `${ms > 0 ? ((shares[i] || 0) / ms).toFixed(0) : 0}k/s ${ms.toFixed(1)}ms`, x + 24, yy + 4, FM(8), PAL.muted);
    }
  }

  // ---------- scheduler ----------
  const RealDate = Object.getPrototypeOf(Date).now ? Object.getPrototypeOf(Date) : Date;
  const prof = (name, fn) => {
    const P2 = window.__PROF;
    if (!P2) return fn();
    const t0 = RealDate.now();
    const r = fn();
    const d = RealDate.now() - t0;
    const e = P2[name] || (P2[name] = { n: 0, sum: 0, max: 0 });
    e.n++;
    e.sum += d;
    if (d > e.max) e.max = d;
    return r;
  };
  let inited = false;
  function init(APP) {
    CM = coreAsm();
    buildMasks();
    drawBackground();
    drawCoreStatic();
    inited = true;
  }
  const order = ['coreNums', 'xenon', 'loadfollow', 'tilt', 'controls', 'solver', 'fields', 'kinetics'];
  function frame(APP, now, dt) {
    if (!inited) init(APP);
    // data arrival: hero texture now, the four field maps over the next four frames
    let heavy = false;
    if (APP.fSeq !== V.fSeq) {
      V.fSeq = APP.fSeq;
      prof('upload', () => uploadHero(APP));
      V.fieldQ = [0, 1, 2, 3];
      V.dirty.add('coreNums');
      heavy = true;
    } else if (V.fieldQ && V.fieldQ.length) {
      const i = V.fieldQ.shift();
      prof('upload', () => uploadField(APP, i));
      if (!V.fieldQ.length) {
        prof('fieldGL', () => drawFieldGL());
        V.dirty.add('fields');
      }
    }
    if (APP.dataSeq !== V.dataSeq) {
      V.dataSeq = APP.dataSeq;
      for (const k of ['xenon', 'loadfollow', 'tilt', 'controls', 'coreNums']) V.dirty.add(k);
    }
    if (APP.solveSeq !== V.solveSeq) {
      V.solveSeq = APP.solveSeq;
      V.dirty.add('solver');
    }
    if (APP.kinSeq !== V.kinSeq) {
      V.kinSeq = APP.kinSeq;
      V.dirty.add('kinetics');
    }
    // every frame: heatmap blend, tracks, rod flash
    prof('gl', () => drawGL(APP));
    if (APP.frame % 2 === 1 && !window.__NOTRACKS) prof('tracks', () => drawTracks(APP));
    prof('fx', () => drawCoreFx(APP, now));
    // status: every other frame
    if (APP.frame % 2 === 0) prof('status', () => drawStatus(APP));
    // Monte Carlo panel: every third frame
    if (APP.frame % 4 === 1 && APP.mc.seq !== V.mcSeq) {
      V.mcSeq = APP.mc.seq;
      prof('mc', () => drawMC(APP, now));
    }
    // compute plant: when a new sample arrives, at most every 6 frames
    if (APP.frame % 6 === 3) prof('compute', () => drawCompute(APP, now));
    // log: smooth scroll
    if (APP.logSeq !== V.logSeq) {
      const added = APP.logSeq - (V.logSeq < 0 ? APP.logSeq : V.logSeq);
      V.logSeq = APP.logSeq;
      V.logOffset = Math.min(LOG_LH * 6, V.logOffset + added * LOG_LH);
      V.logAnim = 1;
    }
    if (V.logAnim) {
      V.logOffset *= Math.pow(0.0005, dt / 1000);
      if (V.logOffset < 0.3) {
        V.logOffset = 0;
        V.logAnim = 0;
      }
      prof('log', () => drawLog(APP, dt));
    }
    // dirty panels: at most one per frame, none in the frame that uploads the hero
    let drawn = heavy ? 1 : 0;
    for (const k of order) {
      if (drawn >= 1) break;
      if (!V.dirty.has(k)) continue;
      V.dirty.delete(k);
      drawn++;
      prof(k, () => {
        if (k === 'coreNums') drawCoreNums(APP);
        else if (k === 'xenon') drawXenon(APP);
        else if (k === 'loadfollow') drawLoadFollow(APP);
        else if (k === 'tilt') drawTilt(APP);
        else if (k === 'controls') drawControls(APP);
        else if (k === 'solver') drawSolver(APP, now);
        else if (k === 'fields') drawFields(APP);
        else if (k === 'kinetics') drawKinetics(APP);
      });
    }
  }

  window.UI = { frame, clock };
})();

p='ui.js'; s=open(p,encoding='utf8').read()
def rep(old,new):
    global s
    if old not in s: raise SystemExit('MISSING: '+old[:90])
    s=s.replace(old,new)
rep("""  UI.setFont = (ctx, f, stretch) => {
    ctx.font = f;
    if ('fontStretch' in ctx) ctx.fontStretch = stretch || 'normal';
  };""","""  UI.setFont = (ctx, f, stretch) => {
    const st = stretch || 'normal';
    if (ctx._f !== f) { ctx.font = f; ctx._f = f; }
    if (ctx._st !== st && 'fontStretch' in ctx) { ctx.fontStretch = st; ctx._st = st; }
  };""")
rep("""    if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
  };
  UI.big""","""  };
  UI.big""")
rep("""    ctx.fillText(s, x, y);
    if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
  };
  UI.mono""","""    ctx.fillText(s, x, y);
  };
  UI.mono""")
rep("""  UI.mono = (ctx, s, x, y, color = UI.C.text, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.monoB(px) : UI.F.mono(px));""","""  UI.mono = (ctx, s, x, y, color = UI.C.text, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.monoB(px) : UI.F.mono(px), 'normal');""")
rep("""  UI.label = (ctx, s, x, y, color = UI.C.muted, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.labelB(px) : UI.F.label(px));""","""  UI.label = (ctx, s, x, y, color = UI.C.muted, align = 'left', px = 10, bold = false) => {
    UI.setFont(ctx, bold ? UI.F.labelB(px) : UI.F.label(px), 'normal');""")
rep("""  UI.textW = (ctx, s, f) => { UI.setFont(ctx, f); return ctx.measureText(s).width; };""","""  const wCache = new Map();
  UI.textW = (ctx, s, f) => {
    const k = f + '|' + s;
    let w = wCache.get(k);
    if (w === undefined) { UI.setFont(ctx, f, 'normal'); w = ctx.measureText(s).width; if (wCache.size > 4000) wCache.clear(); wCache.set(k, w); }
    return w;
  };""")
open(p,'w',encoding='utf8').write(s)

# inferno LUT
p='gl.js'; s=open(p,encoding='utf8').read()
rep("""  GLX.inferno = (t) => {
    t = Math.min(1, Math.max(0, t)) * 10;
    const i = Math.min(9, Math.floor(t)), f = t - i;
    const a = INFERNO[i], b = INFERNO[i + 1];
    const h = (s, k) => parseInt(s.slice(1 + 2 * k, 3 + 2 * k), 16);
    return [0, 1, 2].map((k) => h(a, k) + (h(b, k) - h(a, k)) * f);
  };""","""  const INF_RGB = INFERNO.map((s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)));
  const INF_LUT = Array.from({ length: 1024 }, (_, j) => {
    const t = (j / 1023) * 10, i = Math.min(9, Math.floor(t)), f = t - i;
    return [0, 1, 2].map((k) => INF_RGB[i][k] + (INF_RGB[i + 1][k] - INF_RGB[i][k]) * f);
  });
  GLX.inferno = (t) => INF_LUT[Math.round(Math.min(1, Math.max(0, t || 0)) * 1023)];""")
open(p,'w',encoding='utf8').write(s)

p='panels.js'; s=open(p,encoding='utf8').read()
# ---- geodesics: two views, static rays cached
a=s.index('  // ------------------------------------------------------------------ geodesics (meridional plane)'); b=s.index('  // ------------------------------------------------------------------ spin sweep')
s=s[:a]+'''  // ------------------------------------------------------------------ geodesics: meridional x-z (alpha = 0 rays) and equatorial x-y (beta = 0 rays)
  let geoStatic = null, geoKey = null;
  const GW = 416, GH = 300;
  const GV1 = { x0: 4, y0: 24, w: 272, h: 252, cx: 4 + 136, cy: 24 + 126, s: 12.0 };   // x-z, +-11 M
  const GV2 = { x0: 280, y0: 24, w: 132, h: 252, cx: 280 + 66, cy: 24 + 112, s: 6.4 }; // x-y, top view
  const FATE_COL = (r) => (r.fate === 1 ? (r.n === 0 ? C.amber : r.n === 1 ? C.magenta : C.white) : r.fate === 2 ? C.cyan : C.violet);
  function geoStaticRender() {
    const d = UI.dpr(), cv = document.createElement('canvas');
    cv.width = GW * d; cv.height = GH * d;
    const ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    UI.panel(ctx, GW, GH, 'Photon geodesics', 'CPU fp64 · 64 rays from the image midlines', { mark: C.cyan });
    const D = A.D, a = A.P.a;
    for (const V of [GV1, GV2]) {
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(V.x0, V.y0, V.w, V.h);
      ctx.save(); ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
      const X = (x) => V.cx + x * V.s, Z = (z) => V.cy - z * V.s;
      for (let g = -20; g <= 20; g += 5) { ctx.fillStyle = C.faint; ctx.fillRect(Math.round(X(g)), V.y0, 1, V.h); ctx.fillRect(V.x0, Math.round(Z(g)), V.w, 1); }
      for (const r of [D.rphP, D.rphR]) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = UI.rgba(C.cyan, 0.6); ctx.beginPath(); ctx.arc(X(0), Z(0), r * V.s, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
      if (V === GV1) {
        ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = UI.rgba(C.magenta, 0.9); ctx.beginPath();
        for (let k = 0; k <= 120; k++) { const th = (2 * Math.PI * k) / 120, r = K.rergo(a, th); const x = X(r * Math.sin(th)), z = Z(r * Math.cos(th)); k ? ctx.lineTo(x, z) : ctx.moveTo(x, z); }
        ctx.stroke(); ctx.restore();
        for (const sg of [1, -1]) {
          const grd = ctx.createLinearGradient(X(0), 0, X(sg * A.P.rout), 0);
          grd.addColorStop(0, C.white); grd.addColorStop(0.12, C.amber); grd.addColorStop(1, UI.rgba(C.orange, 0.1));
          ctx.fillStyle = grd; ctx.fillRect(Math.min(X(sg * D.risco), X(sg * A.P.rout)), Z(0) - 1.5, (A.P.rout - D.risco) * V.s, 3);
        }
      } else {
        // disk seen from above: ISCO and outer edge, ergosphere (equatorial r = 2)
        const grd = ctx.createRadialGradient(X(0), Z(0), D.risco * V.s, X(0), Z(0), A.P.rout * V.s);
        grd.addColorStop(0, UI.rgba(C.amber, 0.28)); grd.addColorStop(1, UI.rgba(C.orange, 0.02));
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(X(0), Z(0), A.P.rout * V.s, 0, 2 * Math.PI); ctx.arc(X(0), Z(0), D.risco * V.s, 0, 2 * Math.PI, true); ctx.fill();
        ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = UI.rgba(C.magenta, 0.9); ctx.beginPath(); ctx.arc(X(0), Z(0), 2 * V.s, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = UI.rgba(C.amber, 0.9); ctx.beginPath(); ctx.arc(X(0), Z(0), D.risco * V.s, 0, 2 * Math.PI); ctx.stroke();
      }
      // rays
      ctx.lineWidth = 0.9;
      for (const r of A.geo) {
        if ((V === GV1) !== (r.al === 0)) continue;
        const p = r.path;
        ctx.strokeStyle = UI.rgba(FATE_COL(r), V === GV1 ? 0.5 : 0.55);
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 3) { const x = X(p[i]), z = V === GV1 ? Z(p[i + 1]) : Z(p[i + 2]); i ? ctx.lineTo(x, z) : ctx.moveTo(x, z); }
        ctx.stroke();
      }
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(X(0), Z(0), D.rplus * V.s, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(0), Z(0), D.rplus * V.s, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
      frame(ctx, V.x0, V.y0, V.w, V.h, C.line);
    }
    // labels
    const X1 = (x) => GV1.cx + x * GV1.s, Z1 = (z) => GV1.cy - z * GV1.s;
    UI.label(ctx, 'meridian x–z · rays α = 0', GV1.x0 + 6, GV1.y0 + 12, C.text, 'left', 9.5);
    UI.label(ctx, 'equator x–y · β = 0', GV2.x0 + 6, GV2.y0 + 12, C.text, 'left', 9.5);
    const lab = (t, x, y, col, al = 'left') => UI.mono(ctx, t, x, y, col, al, 9.5);
    lab(`r+ ${D.rplus.toFixed(3)}`, X1(0) + 3, Z1(-1.3) + 10, C.white);
    lab('ergosphere', X1(-2.2), Z1(1.9), C.magenta, 'right');
    lab(`r_ph ${D.rphP.toFixed(2)}–${D.rphR.toFixed(2)}`, X1(0), Z1(-D.rphR) + 12, C.cyan, 'center');
    ctx.fillStyle = C.amber; ctx.fillRect(Math.round(X1(D.risco)), Z1(0) - 6, 1, 12); ctx.fillRect(Math.round(X1(-D.risco)), Z1(0) - 6, 1, 12);
    lab(`ISCO ${D.risco.toFixed(3)}`, X1(D.risco) + 3, Z1(0) - 7, C.amber);
    lab(`disk → ${A.P.rout} M`, GV1.x0 + GV1.w - 4, Z1(0) + 13, C.amber, 'right');
    const oz = Z1(9.6 / Math.tan(D.inc));
    ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X1(7.2), Z1(7.2 / Math.tan(D.inc))); ctx.lineTo(X1(10.6), Z1(10.6 / Math.tan(D.inc))); ctx.stroke();
    lab(`observer, i ${A.P.incDeg}°`, GV1.x0 + GV1.w - 4, Math.max(GV1.y0 + 24, oz - 6), C.text, 'right');
    const X2 = (x) => GV2.cx + x * GV2.s, Y2 = (y) => GV2.cy - y * GV2.s;
    lab('ISCO', X2(0), Y2(-D.risco) + 12, C.amber, 'center');
    lab('ergo r=2', X2(0), Y2(2.4) - 2, C.magenta, 'center');
    lab('prograde ↺', GV2.x0 + GV2.w - 4, GV2.y0 + GV2.h - 6, C.orange, 'right');
    // legend
    const lg2 = [['disk n=0', C.amber], ['n=1', C.magenta], ['captured', C.violet], ['escaped', C.cyan]];
    let lx = 8;
    for (const [t, c] of lg2) { ctx.fillStyle = c; ctx.fillRect(lx, GH - 12, 10, 2); UI.label(ctx, t, lx + 14, GH - 8, C.muted, 'left', 9.5); lx += UI.textW(ctx, t, F.label(9.5)) + 26; }
    const cnt = A.geo.reduce((s2, r) => s2 + r.path.length / 3, 0);
    UI.mono(ctx, `${UI.int(cnt)} points, h 0.03`, GW - 8, GH - 8, C.dim, 'right', 9.5);
    return cv;
  }
  function drawGeo(ctx, w, h, now) {
    if (!geoStatic || geoKey !== A.geo) { geoStatic = geoStaticRender(); geoKey = A.geo; }
    ctx.drawImage(geoStatic, 0, 0, w, h);
    const D = A.D, T = now / 1000;
    for (const V of [GV1, GV2]) {
      const X = (x) => V.cx + x * V.s, Z = (z) => V.cy - z * V.s;
      ctx.save(); ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
      A.geo.forEach((r, k) => {
        if ((V === GV1) !== (r.al === 0)) return;
        const p = r.path, n = p.length / 3;
        if (n < 3) return;
        const ph = (T * 0.3 + k * 0.137) % 1;
        const i = Math.floor(ph * (n - 1));
        const col = FATE_COL(r);
        for (let tr = 5; tr >= 0; tr--) {
          const j = i - tr * 2;
          if (j < 0) continue;
          const x = X(p[j * 3]), z = V === GV1 ? Z(p[j * 3 + 1]) : Z(p[j * 3 + 2]);
          ctx.fillStyle = tr ? UI.rgba(col, 0.75 - tr * 0.12) : C.white;
          const s2 = tr ? 1.6 : 2.6;
          ctx.fillRect(x - s2 / 2, z - s2 / 2, s2, s2);
        }
      });
      ctx.restore();
    }
  }

'''+s[b:]

# ---- uv: cached sample layer
rep("""    const S = A.eht.samples;
    for (const s of S) {
      const c = BASE_COL[s.k];
      ctx.fillStyle = c;
      ctx.fillRect(X(s.u) - 0.7, Y(s.v) - 0.7, 1.4, 1.4);
      ctx.fillRect(X(-s.u) - 0.7, Y(-s.v) - 0.7, 1.4, 1.4);
    }""","""    const S = A.eht.samples;
    if (!uvLayer || uvLayer.n !== S.length) {
      const d = UI.dpr();
      if (!uvLayer) { uvLayer = document.createElement('canvas'); uvLayer.width = w * d; uvLayer.height = h * d; }
      const c2 = uvLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of S) {
        c2.fillStyle = BASE_COL[s2.k];
        c2.fillRect(X(s2.u) - 0.7, Y(s2.v) - 0.7, 1.4, 1.4);
        c2.fillRect(X(-s2.u) - 0.7, Y(-s2.v) - 0.7, 1.4, 1.4);
      }
      uvLayer.n = S.length;
    }
    ctx.drawImage(uvLayer, 0, 0, w, h);""")
rep("""  // ------------------------------------------------------------------ uv coverage""","""  // ------------------------------------------------------------------ uv coverage
  let uvLayer = null, visLayer = null;""")
rep("""    for (const s of A.eht.samples) { ctx.fillStyle = UI.rgba(BASE_COL[s.k], 0.75); ctx.fillRect(X(Math.hypot(s.u, s.v)) - 0.8, Y(s.amp) - 0.8, 1.6, 1.6); }""","""    const SM = A.eht.samples;
    if (!visLayer || visLayer.n !== SM.length) {
      const d = UI.dpr();
      if (!visLayer) { visLayer = document.createElement('canvas'); visLayer.width = w * d; visLayer.height = h * d; }
      const c2 = visLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of SM) { c2.fillStyle = UI.rgba(BASE_COL[s2.k], 0.8); c2.fillRect(X(Math.hypot(s2.u, s2.v)) - 1, Y(s2.amp) - 1, 2, 2); }
      visLayer.n = SM.length;
    }
    ctx.drawImage(visLayer, 0, 0, w, h);""")

# ---- hero colorbar cached
rep("""    const cbx = w - 26, cby = 150, cbh = 260;
    for (let i = 0; i < cbh; i++) {
      const c = GLX.inferno(1 - i / cbh);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(cbx, cby + i, 10, 1);
    }""","""    const cbx = w - 26, cby = 150, cbh = 260;
    if (!heroBar) {
      heroBar = document.createElement('canvas'); heroBar.width = 1; heroBar.height = cbh;
      const c2 = heroBar.getContext('2d'), im = c2.createImageData(1, cbh);
      for (let i = 0; i < cbh; i++) { const c = GLX.inferno(1 - i / cbh); im.data.set([c[0], c[1], c[2], 255], i * 4); }
      c2.putImageData(im, 0, 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heroBar, cbx, cby, 10, cbh);
    ctx.imageSmoothingEnabled = true;""")
rep("""  // ------------------------------------------------------------------ hero overlay""","""  // ------------------------------------------------------------------ hero overlay
  let heroBar = null;""")

# ---- maps colorbars cached per (k, lo, hi)
rep("""        for (let i = 0; i < cw; i++) {
          const t = i / (cw - 1);
          const v = k === 0 ? lo + (hi - lo) * t : k === 1 ? t : 1 - t; // delay: colour index is sqrt(dt / range)
          const c = mapColor(k === 0 ? 0 : k === 1 ? 1 : 3, k === 0 ? v : k === 1 ? v : 1 - (1 - v), lo, hi);
          ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
          ctx.fillRect(cx + i, cy, 1, 7);
        }""","""        const key = k + ':' + lo.toFixed(4) + ':' + hi.toFixed(4);
        if (!mapBars[k] || mapBars[k].key !== key) {
          const bc = document.createElement('canvas'); bc.width = cw; bc.height = 1;
          const c2 = bc.getContext('2d'), im = c2.createImageData(cw, 1);
          for (let i = 0; i < cw; i++) {
            const t = i / (cw - 1);
            const v = k === 0 ? lo + (hi - lo) * t : t; // delay: colour index is sqrt(dt / range); radius: inner = bright
            const c = mapColor(k === 0 ? 0 : k === 1 ? 1 : 3, v, lo, hi);
            im.data.set([c[0], c[1], c[2], 255], i * 4);
          }
          c2.putImageData(im, 0, 0);
          mapBars[k] = { key, cv: bc };
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mapBars[k].cv, cx, cy, cw, 7);
        ctx.imageSmoothingEnabled = true;""")
rep("""  function drawMaps(ctx, w, h) {""","""  const mapBars = [];
  function drawMaps(ctx, w, h) {""")
# scheduler rates
rep("""    add('top', 8, 8, 1904, 32, 2, 0, drawTop);""","""    add('top', 8, 8, 1904, 32, 3, 0, drawTop);""")
rep("""    add('uv', 1240, 832, 216, 240, 2, 1, drawUV);""","""    add('uv', 1240, 832, 216, 240, 3, 1, drawUV);""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
# geodesics: alpha = 0 rays over beta in +-12 with density near the critical values, beta = 0 rays over alpha
old=s[s.index("  function geodesics() {"):s.index("  // the part of a path inside r < 40")]
new='''  function geodesics() {
    const rays = [];
    const opt = (path) => ({ h: 0.03, maxSteps: 8000, r0: 1000, disk: true, rIn: D.risco, rOut: P.rout, path });
    // beta from -12 to 12, denser near the shadow edge (|beta| ~ 4-6 M)
    for (let k = 0; k < 44; k++) {
      const u = -1 + (2 * (k + 0.5)) / 44;
      const be = Math.sign(u) * (3.2 + 8.8 * Math.pow(Math.abs(u), 1.6)) * (Math.abs(u) < 0.02 ? 0 : 1) + (Math.abs(u) < 0.25 ? u * 6 : 0) * 0;
      const path = [];
      const r = K.trace(P.a, D.inc, 0.0, be, opt(path));
      rays.push({ al: 0, be, fate: r.fate, n: r.n, r: r.r, path: compress(path) });
    }
    for (let k = 0; k < 20; k++) {
      const u = -1 + (2 * (k + 0.5)) / 20;
      const al = D.critMid + Math.sign(u) * (3 + 9 * Math.pow(Math.abs(u), 1.4));
      const path = [];
      const r = K.trace(P.a, D.inc, al, 0.0, opt(path));
      rays.push({ al, be: 0, fate: r.fate, n: r.n, r: r.r, path: compress(path) });
    }
    APP.geo = rays;
  }
'''
s=s.replace(old,new)
s=s.replace("""      if (r > 40) continue;""","""      if (r > 26) continue;""")
open(p,'w',encoding='utf8').write(s)
print('ok')

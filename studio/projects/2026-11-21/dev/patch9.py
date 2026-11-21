p='panels.js'; s=open(p,encoding='utf8').read()
a=s.index("  function drawUV(ctx, w, h, now) {"); b=s.index("  // ------------------------------------------------------------------ init + scheduler")
new=r'''  function drawUV(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'uv coverage · 230 GHz', 'EHT 2017 · Gλ', { mark: C.cyan });
    const X0 = w / 2, Y0 = 26 + 86, R = 84, RM = 9.5e9;
    const X = (u) => X0 - (u / RM) * R, Y = (v) => Y0 - (v / RM) * R; // u east to the left, as on the sky
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(X0 - R, Y0 - R, 2 * R, 2 * R);
    for (const g of [-8, -4, 0, 4, 8]) { ctx.fillStyle = C.grid; ctx.fillRect(Math.round(X(g * 1e9)), Y0 - R, 1, 2 * R); ctx.fillRect(X0 - R, Math.round(Y(g * 1e9)), 2 * R, 1); }
    const fit = A.eht.fit;
    if (fit) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = UI.rgba(C.amber, 0.5); ctx.beginPath(); ctx.arc(X0, Y0, (fit.nullG / RM) * R, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
    const S = A.eht.samples;
    if (!uvLayer || uvLayer.n !== S.length) {
      const d = UI.dpr();
      if (!uvLayer) { uvLayer = document.createElement('canvas'); uvLayer.width = w * d; uvLayer.height = h * d; }
      const c2 = uvLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of S) {
        c2.fillStyle = UI.rgba(BASE_COL[s2.k], 0.75);
        c2.fillRect(X(s2.u) - 0.7, Y(s2.v) - 0.7, 1.4, 1.4);
        c2.fillRect(X(-s2.u) - 0.7, Y(-s2.v) - 0.7, 1.4, 1.4);
      }
      uvLayer.n = S.length;
    }
    ctx.drawImage(uvLayer, 0, 0, w, h);
    // the newest samples: track segments drawn bright and a ring that decays over three epochs (15 sim-min)
    const tNow = A.simSec, life = 900;
    const recent = {};
    for (let i = S.length - 1; i >= 0 && S[i].t > tNow - life - 300; i--) (recent[S[i].k] = recent[S[i].k] || []).push(S[i]);
    ctx.lineCap = 'round';
    for (const k in recent) {
      const pts = recent[k];
      for (let i = 0; i + 1 < pts.length; i++) {
        const age = tNow - pts[i].t, al = Math.max(0, 1 - age / life);
        if (al <= 0) continue;
        for (const sg of [1, -1]) {
          ctx.strokeStyle = UI.rgba(BASE_COL[k], 0.35 + 0.65 * al); ctx.lineWidth = 1 + 1.6 * al;
          ctx.beginPath(); ctx.moveTo(X(sg * pts[i].u), Y(sg * pts[i].v)); ctx.lineTo(X(sg * pts[i + 1].u), Y(sg * pts[i + 1].v)); ctx.stroke();
        }
      }
      const p0 = pts[0], age = tNow - p0.t;
      if (age < life) {
        const f = age / life;
        for (const sg of [1, -1]) {
          ctx.strokeStyle = UI.rgba(C.white, 0.9 * (1 - f)); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(X(sg * p0.u), Y(sg * p0.v), 2 + 9 * f, 0, 2 * Math.PI); ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const p of A.eht.upNow) {
      const c = BASE_COL[p.k];
      for (const sg of [1, -1]) {
        ctx.strokeStyle = UI.rgba(C.white, 0.35 + 0.5 * pulse); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(sg * p.u), Y(sg * p.v), 2.5 + 1.5 * pulse, 0, 2 * Math.PI); ctx.stroke();
        dot(ctx, X(sg * p.u), Y(sg * p.v), 1.6, c);
      }
    }
    for (const g of [-8, -4, 0, 4, 8]) UI.mono(ctx, UI.neg(String(-g)), X(g * 1e9), Y0 + R + 11, C.muted, 'center', 9);
    UI.label(ctx, 'v', X0 - R + 4, Y0 - R + 11, C.muted, 'left', 9.5);
    UI.label(ctx, 'u', X0 + R - 4, Y0 + R - 4, C.muted, 'right', 9.5);
    const X2 = A.eht;
    const ry = h - 10;
    kv(ctx, 'up', `${X2.upNow.length}/28`, 8, ry, C.up);
    kv(ctx, 'vis', UI.int(X2.visCount), 66, ry, C.text);
    kv(ctx, 'cov', `${(100 * X2.cov).toFixed(0)}%`, 150, ry, C.cyan);
  }

  // ------------------------------------------------------------------ visibilities: |V| of every sample, and the
  // phase-centred real part whose bin means estimate the circularly averaged visibility (ring fit, first null)
  function drawVis(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'Visibilities', 'all samples · ring fit', { mark: C.cyan });
    const x0 = 34, x1 = w - 8, ya0 = 26, ya1 = 104, yb0 = 112, yb1 = 186;
    const X = (r) => x0 + (r / 10e9) * (x1 - x0);
    const lo = -2, hi = 0.04;
    const Ya = (v) => ya1 - ((lg(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * (ya1 - ya0);
    const rlo = -0.45, rhi = 1.05;
    const Yb = (v) => yb1 - ((Math.min(rhi, Math.max(rlo, v)) - rlo) / (rhi - rlo)) * (yb1 - yb0);
    for (const [y0, y1] of [[ya0, ya1], [yb0, yb1]]) { ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    for (let e = -2; e <= 0; e++) { const yy = Math.round(Ya(10 ** e)); ctx.fillStyle = C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, e === 0 ? '1' : `1e${UI.neg(String(e))}`, x0 - 3, yy + 3, C.muted, 'right', 9); }
    for (const v of [0, 0.5, 1]) { const yy = Math.round(Yb(v)); ctx.fillStyle = v === 0 ? C.line : C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, v.toFixed(1), x0 - 3, yy + 3, C.muted, 'right', 9); }
    for (let g = 0; g <= 10; g += 2) {
      const xx = Math.round(X(g * 1e9));
      ctx.fillStyle = C.grid; ctx.fillRect(xx, ya0, 1, ya1 - ya0); ctx.fillRect(xx, yb0, 1, yb1 - yb0);
      UI.mono(ctx, String(g), xx, yb1 + 10, C.muted, 'center', 9);
    }
    UI.label(ctx, 'ρ [Gλ]', x1, yb1 + 20, C.muted, 'right', 9);
    // every sampled visibility, faint per-baseline colour (cached, redrawn when samples arrive)
    const SM = A.eht.samples;
    if (!visLayer || visLayer.n !== SM.length) {
      const d = UI.dpr();
      if (!visLayer) { visLayer = document.createElement('canvas'); visLayer.width = w * d; visLayer.height = h * d; }
      const c2 = visLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of SM) {
        const xr = X(Math.hypot(s2.u, s2.v));
        if (xr > x1) continue;
        c2.fillStyle = UI.rgba(BASE_COL[s2.k], 0.55);
        c2.fillRect(xr - 0.8, Ya(s2.amp) - 0.8, 1.6, 1.6);
        c2.fillRect(xr - 0.8, Yb(s2.re) - 0.8, 1.6, 1.6);
      }
      visLayer.n = SM.length;
    }
    ctx.drawImage(visLayer, 0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, ya0, x1 - x0, yb1 - ya0); ctx.clip();
    // top: azimuthal mean of the sampled |V| per 0.4 G lambda bin, and the model's full-uv mean for comparison
    const pol = A.eht.polar;
    if (pol) dashLine(ctx, pol.rho.map((r, j) => [X(r), Ya(pol.inc[j])]), UI.rgba(C.text, 0.5), [3, 2], 1);
    const ab = A.eht.ampBins;
    if (ab && ab.length) {
      line(ctx, ab.map(([r, v]) => [X(r), Ya(v)]), C.white, 1.2);
      for (const [r, v] of ab) dot(ctx, X(r), Ya(v), 2, C.white);
    }
    // bottom: bin means of Re V and the fitted ring J0(pi d rho) exp(-(pi w rho)^2 / 4 ln 2)
    const fit = A.eht.fit;
    if (fit) {
      const UASr = Math.PI / 180 / 3600e6, k = Math.PI * fit.d * UASr, kw = Math.PI * fit.w * UASr;
      const pts = [];
      for (let i = 0; i <= 120; i++) { const r = (i / 120) * 10e9; pts.push([X(r), Yb(E.J0(k * r) * Math.exp(-((kw * r) ** 2) / (4 * Math.LN2)))]); }
      line(ctx, pts, C.amber, 1.5);
      for (const [r, v] of fit.bins) dot(ctx, X(r), Yb(v), 2.2, C.white);
    }
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const c of A.eht.cur) { if (!E.baselines[c.k] || E.baselines[c.k].len < 10000) continue; dot(ctx, X(Math.hypot(c.u, c.v)), Ya(c.amp), 1.6 + pulse, C.cyan); }
    ctx.restore();
    UI.label(ctx, '|V|/V₀: no null for this crescent', x0 + 4, ya1 - 4, C.muted, 'left', 9);
    UI.label(ctx, 'Re V, phase-centred on the hole', x0 + 4, yb0 + 10, C.muted, 'left', 9);
    if (fit) {
      const xn = X(fit.nullG);
      dashLine(ctx, [[xn, yb0], [xn, yb1]], C.amber, [3, 3], 1);
      ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(xn, Yb(0) + 1); ctx.lineTo(xn - 3, Yb(0) + 6); ctx.lineTo(xn + 3, Yb(0) + 6); ctx.fill();
    }
    const ry = h - 22;
    kv(ctx, 'ring fit d', fit ? `${fit.d.toFixed(1)} µas` : '…', 8, ry, C.amber);
    kv(ctx, 'width', fit ? `${fit.w.toFixed(0)}` : '…', 132, ry, C.text);
    kv(ctx, 'first null', fit ? `${(fit.nullG / 1e9).toFixed(2)} Gλ` : '…', 8, h - 8, C.amber);
    kv(ctx, 'model', A.eht.nullG ? `${(A.eht.nullG / 1e9).toFixed(2)}` : '…', 132, h - 8, C.muted);
  }

  // ------------------------------------------------------------------ dirty image
  let dirtyCv = null, dirtyPrev = null, trueCv = null, beamCv = null, dirtyStamp = -1, trueStamp = -1, fadeAt = -1e9, contourSeg = [];
  function imgToCanvas(cv, data, N, norm, mode) {
    if (!cv) { cv = document.createElement('canvas'); cv.width = N; cv.height = N; }
    const ctx = cv.getContext('2d'), im = ctx.createImageData(N, N);
    let mx = 0, mn = 0;
    for (const v of data) { mx = Math.max(mx, v); mn = Math.min(mn, v); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = data[y * N + x], o = ((N - 1 - y) * N + x) * 4; // row 0 is the bottom (beta min)
      let c;
      if (mode === 'beam') { const t = v / (mx || 1); c = t >= 0 ? [89 * t + 15 * (1 - t), 216 * t + 12 * (1 - t), 255 * t + 20 * (1 - t)] : [80 * -t, 20 * -t, 50 * -t]; }
      else if (mode === 'dirty' && v < 0) { const t = Math.min(1, -v / (mx || 1)); c = [10 + 20 * t, 14 + 40 * t, 28 + 70 * t]; }
      else { const t = Math.max(0, v / (mx || 1)); c = GLX.inferno(Math.pow(t, mode === 'true' ? 0.75 : 0.9)); }
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return cv;
  }
  // marching squares: segments of the contour img = level, in pixel coordinates (x right, y up)
  function contour(img, N, level) {
    const seg = [];
    const lerp = (a, b) => (level - a) / (b - a);
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const a = img[y * N + x], b = img[y * N + x + 1], c = img[(y + 1) * N + x + 1], d = img[(y + 1) * N + x];
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const e = { B: [x + lerp(a, b), y], R: [x + 1, y + lerp(b, c)], T: [x + lerp(d, c), y + 1], L: [x, y + lerp(a, d)] };
      const T = { 1: 'LB', 2: 'BR', 3: 'LR', 4: 'RT', 5: 'LBRT', 6: 'BT', 7: 'LT', 8: 'LT', 9: 'BT', 10: 'LTBR', 11: 'RT', 12: 'LR', 13: 'BR', 14: 'LB' }[idx];
      for (let i = 0; i < T.length; i += 2) seg.push([...e[T[i]], ...e[T[i + 1]]]);
    }
    return seg;
  }
  function drawDirty(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'Dirty image', 'uniform weights', { mark: C.amber });
    const X = A.eht, N = A.EN;
    if (X.dirty && dirtyStamp !== X.dirtyAt) {
      if (dirtyCv) { dirtyPrev = dirtyPrev || document.createElement('canvas'); dirtyPrev.width = N; dirtyPrev.height = N; dirtyPrev.getContext('2d').drawImage(dirtyCv, 0, 0); }
      dirtyCv = imgToCanvas(null, X.dirty, N, 1, 'dirty'); beamCv = imgToCanvas(beamCv, X.beam, N, 1, 'beam');
      dirtyStamp = X.dirtyAt; fadeAt = now;
    }
    if (X.imgBlur && trueStamp !== X.img) {
      trueCv = imgToCanvas(trueCv, X.imgBlur, N, 1, 'true'); trueStamp = X.img;
      let mx = 0; for (const v of X.imgBlur) mx = Math.max(mx, v);
      contourSeg = contour(X.imgBlur, N, 0.5 * mx);
    }
    const ix = 8, iy = 28, isz = 140;
    ctx.fillStyle = '#000'; ctx.fillRect(ix, iy, isz, isz);
    ctx.imageSmoothingEnabled = true;
    const f = Math.min(1, (now - fadeAt) / 900);
    if (dirtyPrev && f < 1) ctx.drawImage(dirtyPrev, ix, iy, isz, isz);
    if (dirtyCv) { ctx.globalAlpha = dirtyPrev ? f : 1; ctx.drawImage(dirtyCv, ix, iy, isz, isz); ctx.globalAlpha = 1; }
    frame(ctx, ix - 1, iy - 1, isz + 2, isz + 2, f < 1 ? UI.mix(C.amber, C.line, f) : C.line);
    // half-maximum contour of the model blurred to the beam: what the array should recover
    const px = (xx) => ix + ((xx + 0.5) / N) * isz, py = (yy) => iy + ((N - 1 - yy + 0.5) / N) * isz;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, isz, isz); ctx.clip();
    ctx.strokeStyle = UI.rgba(C.cyan, 0.9); ctx.lineWidth = 1.2; ctx.beginPath();
    for (const [a1, b1, a2, b2] of contourSeg) { ctx.moveTo(px(a1), py(b1)); ctx.lineTo(px(a2), py(b2)); }
    ctx.stroke();
    ctx.restore();
    if (f < 1) UI.mono(ctx, `+${X.lastAdded || 0} vis`, ix + isz - 4, iy + 12, UI.rgba(C.amber, 1 - 0.7 * f), 'right', 9.5);
    // 50 µas bar and beam ellipse
    const pxu = isz / (2 * A.EH);
    ctx.fillStyle = C.white; ctx.fillRect(ix + 6, iy + isz - 8, 50 * pxu, 1.5);
    UI.mono(ctx, '50 µas', ix + 6, iy + isz - 12, C.white, 'left', 9);
    if (X.beamFit) {
      const bf = X.beamFit;
      ctx.strokeStyle = C.white; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(ix + isz - 16, iy + isz - 16, (bf.maj / 2) * pxu, (bf.min / 2) * pxu, (-(90 - bf.pa) * Math.PI) / 180, 0, 2 * Math.PI); ctx.stroke();
    }
    // insets: model image at EHT resolution, dirty beam
    const sx = ix + isz + 6, ssz = w - sx - 8;
    UI.label(ctx, 'model ⊛', sx, iy + 8, C.muted, 'left', 9);
    if (trueCv) ctx.drawImage(trueCv, sx, iy + 12, ssz, ssz);
    frame(ctx, sx - 1, iy + 11, ssz + 2, ssz + 2, C.line);
    UI.label(ctx, 'beam', sx, iy + 30 + ssz, C.muted, 'left', 9);
    if (beamCv) ctx.drawImage(beamCv, sx, iy + 34 + ssz, ssz, ssz);
    frame(ctx, sx - 1, iy + 33 + ssz, ssz + 2, ssz + 2, C.line);
    UI.mono(ctx, `g³r^−${A.Q_MM}`, sx, iy + 50 + 2 * ssz, C.muted, 'left', 9);
    let ry = iy + isz + 17;
    kv(ctx, 'N vis', UI.int((X.dirtyK || 0) * 2), 8, ry, C.text);
    kv(ctx, 'imaged', `UT ${UI.hhmm(A.utOf(X.dirtyAt || 0)).slice(0, 5)} ×${X.dirtyCount || 0}`, 92, ry, C.muted);
    ry += 14;
    kv(ctx, 'beam', X.beamFit ? `${X.beamFit.maj.toFixed(1)} × ${X.beamFit.min.toFixed(1)} µas` : '…', 8, ry, C.cyan);
    ry += 14;
    kv(ctx, 'PA', X.beamFit ? `${X.beamFit.pa.toFixed(0)}°` : '…', 8, ry, C.text);
    ctx.fillStyle = C.cyan; ctx.fillRect(66, ry - 4, 10, 1.5);
    UI.label(ctx, 'model⊛beam, half max', 80, ry, C.cyan, 'left', 9.5);
  }

'''
s=s[:a]+new+s[b:]
s=s.replace("""    add('dirty', 1704, 832, 208, 240, 12, 7, drawDirty);""","""    add('dirty', 1704, 832, 208, 240, 3, 2, drawDirty);""")
s=s.replace("""    add('vis', 1464, 832, 232, 240, 6, 4, drawVis);""","""    add('vis', 1464, 832, 232, 240, 4, 3, drawVis);""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
old="""    X.dirtyAt = APP.simSec;"""
assert old in s
s=s.replace(old,"""    X.dirtyAt = APP.simSec;
    X.dirtyCount = (X.dirtyCount || 0) + 1;""")
old="""          X.visCount = X.samples.length * 2;
          log('eht',"""
assert old in s
s=s.replace(old,"""          X.visCount = X.samples.length * 2;
          X.lastAdded = ns * 2;
          log('eht',""")
open(p,'w',encoding='utf8').write(s)
print('ok')

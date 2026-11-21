p='panels.js'; s=open(p,encoding='utf8').read()
def rep(old,new):
    global s
    if old not in s: raise SystemExit('MISSING: '+old[:90])
    s=s.replace(old,new)

# offscreen helper
rep("""  // ------------------------------------------------------------------ panel registry""","""  function offscreen(w, h) {
    const d = UI.dpr(), cv = document.createElement('canvas');
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { cv, ctx };
  }

  // ------------------------------------------------------------------ panel registry""")

# ---- top bar: static part cached
a=s.index('  function drawTop(ctx, w, h) {'); b=s.index('  // ------------------------------------------------------------------ controls')
s=s[:a]+'''  let topStatic = null, topX = 0;
  function drawTop(ctx, w, h) {
    const D = A.D, P = A.P;
    let x = 232;
    const sep = (c) => { c.fillStyle = C.line; c.fillRect(x, 7, 1, 18); x += 12; };
    const item = (c, k, v, vc = C.text, gap = 14, vw = null) => {
      UI.label(c, k, x, 20, C.muted, 'left', 10);
      x += UI.textW(c, k, F.label(10)) + 5;
      UI.mono(c, v, x, 20, vc, 'left', 11);
      x += (vw != null ? vw : UI.textW(c, v, F.mono(11))) + gap;
    };
    if (!topStatic) {
      const o = offscreen(w, h), c = o.ctx;
      c.fillStyle = C.surface; c.fillRect(0, 0, w, h);
      frame(c, 0, 0, w, h);
      UI.big(c, 'PHOTON RING', 12, 22, 17, C.white);
      UI.label(c, 'Sgr A*, ray by ray', 120, 21, C.muted, 'left', 11);
      sep(c);
      item(c, 'target', 'Sgr A*', C.amber);
      item(c, 'M', '4.297e6 M☉');
      item(c, 'D', '8.277 kpc');
      item(c, 'θg', `${D.uasPerM.toFixed(3)} µas/M`);
      item(c, 'GM/c³', `${D.tg.toFixed(2)} s`, C.text, 12);
      sep(c);
      item(c, 'a', P.a.toFixed(3), C.cyan);
      item(c, 'i', `${P.incDeg}°`, C.cyan, 12);
      sep(c);
      UI.label(c, 'Kerr null geodesics · Page–Thorne disk · EHT 2017 array', w - 10, 20, C.dim, 'right', 10);
      topStatic = o.cv; topX = x;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(topStatic, 0, 0, w, h);
    x = topX;
    const m7 = UI.textW(ctx, '0', F.mono(11));
    item(ctx, 'UT', UI.hhmm(A.utOf(A.simSec)), C.white, 14, m7 * 8);
    item(ctx, 'night', '2026-08-24');
    item(ctx, 't_obs', `${UI.fx(A.simSec / D.tg - A.nightStart / D.tg, 1)} M`, C.text, 12, m7 * 8);
    sep(ctx);
    item(ctx, 'rays traced', UI.int(A.raysTotal), C.text, 14, m7 * 11);
    const nt = A.tileOrder.length, pc = A.passTile / nt;
    item(ctx, 'pass', `${A.passCurId()}`, C.text, 6, m7 * 3);
    ctx.fillStyle = C.line; ctx.fillRect(x, 14, 64, 4);
    ctx.fillStyle = C.cyan; ctx.fillRect(x, 14, 64 * pc, 4);
    x += 70;
    UI.mono(ctx, `${UI.int(A.passTile)}/${UI.int(nt)} tiles`, x, 20, C.muted, 'left', 10);
    x += 118;
    sep(ctx);
    const perf = STUDIO.perf();
    item(ctx, 'fps', String(perf.fps), perf.fps >= 55 ? C.up : perf.fps >= 40 ? C.warn : C.down, 12);
  }

'''+s[b:]

# ---- hero: static layer
rep("""  function drawHero(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const D = A.D, P = A.P, ua = D.uasPerM;
    frame(ctx, 0, 0, w, h);""","""  let heroStatic = null, heroKey = null;
  function drawHero(ctx, w, h) {
    const key = (A.crit ? 1 : 0) + ':' + (A.critJob && A.critJob.kind === 'cur' ? A.critJob.doneCount : -1) + ':' + A.P.showCrit;
    if (!heroStatic || heroKey !== key) { heroStatic = heroStatic || offscreen(w, h); heroStatic.ctx.clearRect(0, 0, w, h); drawHeroStatic(heroStatic.ctx, w, h); heroKey = key; }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(heroStatic.cv, 0, 0, w, h);
    drawHeroDyn(ctx, w, h);
  }
  function drawHeroStatic(ctx, w, h) {
    const D = A.D, P = A.P, ua = D.uasPerM;
    frame(ctx, 0, 0, w, h);""")
rep("""    // centroid crosshair (intensity weighted, from the 128^2 readback)
    const d = A.dyn;""","""  }
  function drawHeroDyn(ctx, w, h) {
    const D = A.D, ua = D.uasPerM, cr = A.crit;
    // centroid crosshair (intensity weighted, from the 128^2 readback)
    const d = A.dyn;""")
# move scale bar, compass, colorbar into static: they are after the centroid block in the original. Restructure:
a=s.index("    // scale bar 50 µas"); b=s.index("    // corner readouts")
static_block=s[a:b]
s=s[:a]+s[b:]
rep("""  }
  function drawHeroDyn(ctx, w, h) {""",static_block.replace("\n    const d = A.dyn;","")+"""  }
  function drawHeroDyn(ctx, w, h) {""")

# ---- centroid: batched trail
rep("""    const n = pts.length;
    for (let i = 1; i < n; i++) {
      const age = (tNow - pts[i].t) / (winT * 2);
      ctx.strokeStyle = UI.rgba(age < 0.5 ? C.cyan : C.violet, Math.max(0.06, 1 - age) * 0.9);
      ctx.lineWidth = age < 0.5 ? 1.3 : 1;
      ctx.beginPath(); ctx.moveTo(X(pts[i - 1].cx), Y(pts[i - 1].cy)); ctx.lineTo(X(pts[i].cx), Y(pts[i].cy)); ctx.stroke();
    }""","""    const n = pts.length;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, sz, sz); ctx.clip();
    const NB = 16;
    for (let b = 0; b < NB; b++) {
      const i0 = Math.floor((b * (n - 1)) / NB), i1 = Math.floor(((b + 1) * (n - 1)) / NB);
      const age = (tNow - pts[i1].t) / (winT * 2);
      ctx.strokeStyle = UI.rgba(age < 0.5 ? C.cyan : C.violet, Math.max(0.08, 1 - age) * 0.95);
      ctx.lineWidth = age < 0.5 ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(X(pts[i0].cx), Y(pts[i0].cy));
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(X(pts[i].cx), Y(pts[i].cy));
      ctx.stroke();
    }
    ctx.restore();""")
rep("""    R = ticks(0, R * 1.25, 2).v.slice(-1)[0] || R * 1.25;""","""    { const st = ticks(0, R * 1.15, 2).step; R = Math.ceil((R * 1.15) / st) * st; }""")

# ---- integrator: cached truncated log text
rep("""      UI.setFont(ctx, F.mono(9.5));
      let t = e.text;
      const maxW = w - 58;
      if (ctx.measureText(t).width > maxW) { while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); t += '…'; }
      ctx.fillStyle = e.kind === 'eht' ? C.text : col; ctx.textAlign = 'left';
      ctx.fillText(t, 48, ly);""","""      UI.setFont(ctx, F.mono(9.5), 'normal');
      if (e.short === undefined) {
        let t = e.text;
        const maxW = w - 58;
        if (ctx.measureText(t).width > maxW) { while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); t += '…'; }
        e.short = t;
      }
      ctx.fillStyle = e.kind === 'eht' ? C.text : col; ctx.textAlign = 'left';
      ctx.fillText(e.short, 48, ly);""")
rep("""    add('geo', 1240, 48, 416, 300, 1, 0, drawGeo);""","""    add('geo', 1240, 48, 416, 300, 2, 0, drawGeo);""")
open(p,'w',encoding='utf8').write(s)
print('ok')

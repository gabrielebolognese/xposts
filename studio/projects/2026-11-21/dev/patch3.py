import re
p='panels.js'; s=open(p,encoding='utf8').read()
def rep(old,new,count=1):
    global s
    if old not in s: raise SystemExit('MISSING: '+old[:80])
    s=s.replace(old,new,count)

# ---- controls: narrower track, shorter readouts
rep("""      const tx = 186, tw = 72, ty = y + 6;""","""      const tx = 186, tw = 60, ty = y + 6;""")
rep("""    slider('Accretion ṁ', P.mdot.toFixed(3), 'L_Edd', (lg(P.mdot) + 4) / 4, `Ṁ ${UI.sci(D.Mdot * 3.156e7 / 1.989e30, 2)} M☉/yr`);""","""    slider('Accretion ṁ', P.mdot.toFixed(3), 'Edd', (lg(P.mdot) + 4) / 4, `${UI.sci(D.Mdot * 3.156e7 / 1.989e30, 1)} M☉/yr`);""")
rep("""    slider('Playback', `${P.speed}×`, '', P.speed / 600, '1 s = 2 sim-min', C.muted, C.violet);""","""    slider('Playback', `${P.speed}×`, '', P.speed / 600, '1 s = 2 min', C.muted, C.violet);""")
rep("""    slider('RK4 step h', P.h.toFixed(3), '', (P.h - 0.01) / 0.19, `${UI.fx(A.pass.steps / Math.max(1, A.pass.rays), 1)} st/ray`, C.cyan, C.cyan);""","""    slider('RK4 step h', P.h.toFixed(3), '', (P.h - 0.01) / 0.19, `${UI.fx(A.pass.steps / Math.max(1, A.pass.rays), 1)}/ray`, C.cyan, C.cyan);""")

# ---- integrator
rep("""    kv(ctx, 'null resid.', UI.sci(p.res, 1), c1, y, p.res < 1e-2 ? C.up : C.warn, 60);""","""    kv(ctx, 'null resid.', UI.sci(p.res, 1), c1, y, p.res < 1e-2 ? C.up : C.warn, 60);
    UI.label(ctx, 'max, disk rays', c1 + 108, y, C.dim, 'left', 9);""")
rep("""    kv(ctx, 'probes', pr.cpu ? `${pr.agree}/64 fate · ${pr.n} hits` : '…', c2, y, pr.cpu ? C.text : C.muted, 74);""","""    kv(ctx, 'probe fates', pr.cpu ? `${pr.agree}/64 same` : '…', c2, y, pr.cpu ? C.up : C.muted, 74);""")

# ---- system: sparkline width
rep("""      ctx.fillStyle = '#0B0A10'; ctx.fillRect(70, y, 190, 24);
      if (vals) spark(ctx, vals, 70, y + 2, 190, 22, color, max);""","""      ctx.fillStyle = '#0B0A10'; ctx.fillRect(70, y, 150, 24);
      if (vals) spark(ctx, vals, 70, y + 2, 150, 22, color, max);""")
rep("""    const jx = 70, jw = 190, jh = 40;""","""    const jx = 70, jw = 150, jh = 40;""")

# ---- hero: readout box above the tick band, centroid label backing
rep("""    const bx = w - 236, by = h - 104;
    ctx.fillStyle = 'rgba(7,6,10,0.78)'; ctx.fillRect(bx, by, 235, 103);
    frame(ctx, bx, by, 235, 103, C.line);""","""    const bx = w - 248, by = h - 128;
    ctx.fillStyle = 'rgba(7,6,10,0.8)'; ctx.fillRect(bx, by, 236, 102);
    frame(ctx, bx, by, 236, 102, C.line);""")
rep("""    const rr = (k, v, vc = C.text) => { kvR(ctx, k, v, w - 10, ry, vc); ry += 14; };""","""    const rr = (k, v, vc = C.text) => { kvR(ctx, k, v, w - 20, ry, vc); ry += 14; };""")
rep("""      UI.mono(ctx, `centroid ${UI.neg(d.cx.toFixed(1))}, ${UI.neg(d.cy.toFixed(1))} µas`, cx + 12, cy + 18, C.cyan, 'left', 9.5);""","""      const ct = `centroid ${UI.neg(d.cx.toFixed(1))}, ${UI.neg(d.cy.toFixed(1))} µas`;
      const ctw = UI.textW(ctx, ct, F.mono(9.5));
      ctx.fillStyle = 'rgba(7,6,10,0.72)'; ctx.fillRect(cx + 9, cy + 9, ctw + 8, 14);
      UI.mono(ctx, ct, cx + 13, cy + 19, C.cyan, 'left', 9.5);""")

# ---- light curve: trough labels inside, readout spacing
rep("""        ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(xx, yy + 3); ctx.lineTo(xx - 3, yy + 8); ctx.lineTo(xx + 3, yy + 8); ctx.fill();
        UI.mono(ctx, `${spotPct[e.i].toFixed(1)}`, xx, yy + 17, C.muted, 'center', 9);""","""        ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(xx, yy - 3); ctx.lineTo(xx - 3, yy - 8); ctx.lineTo(xx + 3, yy - 8); ctx.fill();
        UI.mono(ctx, `${spotPct[e.i].toFixed(1)}%`, xx, yy - 11, C.muted, 'center', 9);""")
rep("""    kv(ctx, 'P_orbit', `${D.spotPeriodMin.toFixed(2)} min`, 8, ry, C.cyan);
    kv(ctx, 'peak-to-peak', pp ? `${pp.toFixed(1)} min` : '…', 118, ry, C.amber);
    kv(ctx, 'modulation', `${((100 * (mx - mn)) / (mx + mn)).toFixed(0)} %`, 236, ry, C.text);
    kv(ctx, 'now', `${spotPct[spotPct.length - 1].toFixed(2)}%`, 334, ry, C.amber);""","""    kv(ctx, 'P_orbit', `${D.spotPeriodMin.toFixed(2)} min`, 8, ry, C.cyan);
    kv(ctx, 'peak-to-peak', pp ? `${pp.toFixed(1)} min` : '…', 112, ry, C.amber);
    kv(ctx, 'mod.', `${((100 * (mx - mn)) / (mx + mn)).toFixed(0)}%`, 240, ry, C.text);
    kv(ctx, 'now', `${spotPct[spotPct.length - 1].toFixed(2)}%`, 316, ry, C.amber);""")

# ---- centroid: smaller plot
rep("""    const sz = Math.min(w - 50, h - 64), x0 = 38, y0 = 28;""","""    const sz = Math.min(w - 54, h - 82), x0 = 40, y0 = 30;""")
rep("""    const ry = h - 22;
    kv(ctx, 'loop', `${Math.hypot(ax1 - ax0, ay1 - ay0).toFixed(2)} µas`, 8, ry, C.cyan);
    kv(ctx, 'Δα', `${(ax1 - ax0).toFixed(2)}`, 116, ry, C.text);
    kv(ctx, 'Δβ', `${(ay1 - ay0).toFixed(2)}`, 180, ry, C.text);
    kv(ctx, 'now', `${UI.neg(c.cx.toFixed(2))}, ${UI.neg(c.cy.toFixed(2))} µas`, 8, h - 8, C.white);""","""    const ry = h - 24;
    kv(ctx, 'loop', `${Math.hypot(ax1 - ax0, ay1 - ay0).toFixed(2)} µas`, 8, ry, C.cyan);
    kv(ctx, 'Δα', `${(ax1 - ax0).toFixed(1)}`, 128, ry, C.text);
    kv(ctx, 'Δβ', `${(ay1 - ay0).toFixed(1)}`, 188, ry, C.text);
    kv(ctx, 'now', `${UI.neg(c.cx.toFixed(2))}, ${UI.neg(c.cy.toFixed(2))} µas`, 8, h - 9, C.white);""")
# right-side info in centroid
rep("""    const c = pts[n - 1];
    dot(ctx, X(c.cx), Y(c.cy), 3.2, C.white);""","""    const c = pts[n - 1];
    UI.label(ctx, '1.25 orbits', x0 + sz + 6, y0 + 10, C.muted, 'left', 9);
    ctx.fillStyle = C.cyan; ctx.fillRect(x0 + sz + 6, y0 + 16, 10, 2);
    UI.label(ctx, 'recent', x0 + sz + 6, y0 + 28, C.muted, 'left', 9);
    ctx.fillStyle = C.violet; ctx.fillRect(x0 + sz + 6, y0 + 34, 10, 2);
    UI.label(ctx, 'older', x0 + sz + 6, y0 + 46, C.muted, 'left', 9);
    dot(ctx, X(c.cx), Y(c.cy), 3.2, C.white);""")

# ---- spectrum: legend top-left, peak label top
rep("""    UI.mono(ctx, `ν_pk ${UI.sci(S.nuPeak, 2)} Hz`, xp + 4, y0 + 22, C.amber, 'left', 9.5);
    // legend
    ctx.fillStyle = C.amber; ctx.fillRect(x1 - 112, y1 - 33, 12, 2); UI.label(ctx, 'relativistic', x1 - 96, y1 - 29, C.text, 'left', 9.5);
    dashLine(ctx, [[x1 - 112, y1 - 20], [x1 - 100, y1 - 20]], C.text, [3, 2]); UI.label(ctx, 'Newtonian g=1', x1 - 96, y1 - 16, C.muted, 'left', 9.5);
    ctx.fillStyle = C.magenta; ctx.fillRect(x1 - 112, y1 - 8, 12, 2); UI.label(ctx, 'hot spot (live)', x1 - 96, y1 - 4, C.magenta, 'left', 9.5);""","""    UI.mono(ctx, `ν_pk ${UI.sci(S.nuPeak, 2)} Hz`, xp + 5, y1 - 6, C.amber, 'left', 9.5);
    // legend (upper left, where the spectrum is low)
    const lx = x0 + 8;
    ctx.fillStyle = C.amber; ctx.fillRect(lx, y0 + 21, 12, 2); UI.label(ctx, 'relativistic', lx + 16, y0 + 25, C.text, 'left', 9.5);
    dashLine(ctx, [[lx, y0 + 35], [lx + 12, y0 + 35]], C.text, [3, 2]); UI.label(ctx, 'Newtonian g=1', lx + 16, y0 + 39, C.muted, 'left', 9.5);
    ctx.fillStyle = C.magenta; ctx.fillRect(lx, y0 + 49, 12, 2); UI.label(ctx, 'hot spot, live', lx + 16, y0 + 53, C.magenta, 'left', 9.5);""")
rep("""    UI.label(ctx, 'νLν [W]', x0 + 4, y0 + 11, C.muted, 'left', 9.5);""","""    UI.label(ctx, 'νLν [W]', x0 + 8, y0 + 11, C.muted, 'left', 9.5);""")

# ---- Fe line: 3-9 keV
rep("""    const X = (E) => x0 + ((E - 3) / 5) * (x1 - x0), Y = (v) => y1 - v * 0.9 * (y1 - y0);
    for (let e = 3; e <= 8; e++) {""","""    const E0 = S.lineE0, E1 = S.lineE1, dE = (E1 - E0) / 100;
    const X = (E) => x0 + ((E - E0) / (E1 - E0)) * (x1 - x0), Y = (v) => y1 - v * 0.86 * (y1 - y0);
    for (let e = E0; e <= E1; e++) {""")
rep("""      const E = 3 + (b + 0.5) * 0.05;""","""      const E = E0 + (b + 0.5) * dE;""")
rep("""    const Ebp = 3 + (bp + 0.5) * 0.05, Erw = 3 + rw * 0.05;""","""    const Ebp = E0 + (bp + 0.5) * dE, Erw = E0 + rw * dE;""")
rep("""    UI.mono(ctx, `blue horn ${Ebp.toFixed(2)}`, Math.min(xb + 6, x1 - 92), Y(S.line[bp]) - 2, C.white, 'left', 9.5);""","""    UI.mono(ctx, `blue horn ${Ebp.toFixed(2)} keV`, xb - 6, Y(S.line[bp]) - 4, C.white, 'right', 9.5);""")
rep("""    UI.mono(ctx, '6.40 keV rest', xr - 4, y0 + 11, C.cyan, 'right', 9.5);""","""    UI.mono(ctx, '6.40 rest', xr - 4, y0 + 11, C.cyan, 'right', 9.5);""")
rep("""    kv(ctx, 'FWZI', `${(6.4 * (S.gmaxWide - S.gminWide)).toFixed(2)} keV`, 8, ry, C.text);
    kv(ctx, 'g range', `${S.gminWide.toFixed(2)}–${S.gmaxWide.toFixed(2)}`, 128, ry, C.cyan);
    kv(ctx, 'bins', '100', 262, ry, C.muted);""","""    kv(ctx, 'g range', `${S.gminWide.toFixed(2)}–${S.gmaxWide.toFixed(2)}`, 8, ry, C.cyan);
    kv(ctx, 'bins', `100 × ${(dE * 1000).toFixed(0)} eV`, 128, ry, C.text);
    kv(ctx, 'res.', '140 eV', 262, ry, C.muted);""")

# ---- uv layout
rep("""    const X0 = w / 2, Y0 = 30 + 92, R = 90, RM = 9.5e9;""","""    const X0 = w / 2, Y0 = 26 + 86, R = 84, RM = 9.5e9;""")
rep("""    for (const g of [-8, 0, 8]) UI.mono(ctx, UI.neg(String(-g)), X(g * 1e9), Y0 + R + 11, C.muted, 'center', 9);
    UI.label(ctx, 'u [Gλ]', X0 + R, Y0 + R + 22, C.muted, 'right', 9);""","""    for (const g of [-8, -4, 0, 4, 8]) UI.mono(ctx, UI.neg(String(-g)), X(g * 1e9), Y0 + R + 11, C.muted, 'center', 9);
    UI.label(ctx, 'u [Gλ]', X0 - R, Y0 + R + 11, C.muted, 'left', 9);""")

# ---- vis layout
rep("""    const x0 = 34, x1 = w - 8, y0 = 30, y1 = h - 44;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const X = (r) => x0 + (r / 10e9) * (x1 - x0);""","""    const x0 = 34, x1 = w - 8, y0 = 30, y1 = h - 50;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const X = (r) => x0 + (r / 10e9) * (x1 - x0);""")
rep("""    UI.label(ctx, 'ρ [Gλ]', x1, y1 + 22, C.muted, 'right', 9);""","""    UI.label(ctx, 'ρ [Gλ]', x0, y1 + 22, C.muted, 'left', 9);""")
rep("""    kv(ctx, 'ring d', A.eht.ringUas ? `${A.eht.ringUas.toFixed(1)} µas` : '…', 8, ry, C.amber);
    UI.mono(ctx, `|⟨V⟩ψ|`, x1, h - 24, C.cyan, 'right', 9.5);
    UI.mono(ctx, `⟨|V|⟩ψ`, x1 - 48, h - 24, C.muted, 'right', 9.5);
    UI.mono(ctx, `0.7655/ρ₀`, x1, ry, C.muted, 'right', 9.5);""","""    kv(ctx, 'ring d = 0.7655/ρ₀', A.eht.ringUas ? `${A.eht.ringUas.toFixed(1)} µas` : '…', 8, ry, C.amber);
    ctx.fillStyle = C.cyan; ctx.fillRect(x1 - 112, y1 + 19, 10, 2); UI.mono(ctx, '|⟨V⟩ψ|', x1 - 98, y1 + 23, C.cyan, 'left', 9.5);
    dashLine(ctx, [[x1 - 52, y1 + 20], [x1 - 42, y1 + 20]], C.text, [2, 2]); UI.mono(ctx, '⟨|V|⟩ψ', x1 - 38, y1 + 23, C.muted, 'left', 9.5);""")

# ---- spin sweep label positions
rep("""      UI.label(ctx, label, px0 + 4, y0 + 11, C.muted, 'left', 9.5);
      // analytic curves""","""      // analytic curves""")
rep("""    plot(30, 150, 'd', Math.min(...dv) - 0.4, Math.max(...dv) + 0.4, 'd_shadow [µas]');
    plot(164, 262, 'o', Math.min(...ov) - 0.8, Math.max(...ov) + 0.8, 'offset α_c [µas]');""","""    plot(40, 150, 'd', Math.min(...dv) - 0.4, Math.max(...dv) + 0.4, 'd_shadow [µas]');
    plot(174, 262, 'o', Math.min(...ov) - 0.8, Math.max(...ov) + 0.8, 'offset α_c [µas]');
    UI.label(ctx, 'shadow diameter d [µas]', px0, 35, C.muted, 'left', 9.5);
    UI.label(ctx, 'centroid offset α_c [µas]', px0, 169, C.muted, 'left', 9.5);""")

# ---- maps: delay map with sqrt scale, stats from reduction sums
rep("""        const [lo, hi] = k === 0 ? [p.gmin, p.gmax] : k === 1 ? [0, p.tmax - p.tmin] : [D.risco, A.P.rout];""","""        const [lo, hi] = k === 0 ? [p.gmin, p.gmax] : k === 1 ? [0, p.tmax - p.tmin] : [D.risco, A.P.rout];
        const sq = k === 1;""")
rep("""        const vals = k === 0 ? [lo, 1, hi] : k === 1 ? [0, (hi) / 2, hi] : [lo, (lo + hi) / 2, hi];
        vals.forEach((v, i) => {
          const tx = k === 0 ? cx + ((v - lo) / (hi - lo)) * cw : cx + (i / 2) * cw;""","""        const vals = k === 0 ? [lo, 1, hi] : k === 1 ? [0, hi / 4, hi] : [lo, (lo + hi) / 2, hi];
        vals.forEach((v, i) => {
          const tx = k === 0 ? cx + ((v - lo) / (hi - lo)) * cw : sq ? cx + Math.sqrt(v / hi) * cw : cx + (i / 2) * cw;""")
rep("""      [['range', `0 – ${(p.tmax - p.tmin).toFixed(1)} M`], ['= in seconds', `${((p.tmax - p.tmin) * D.tg / 60).toFixed(1)} min`], ['t_hit min', `${p.tmin.toFixed(1)} M`], ['mean Δt', A.dtMean ? `${A.dtMean.toFixed(2)} M` : '—', C.cyan]],""","""      [['range', `0 – ${(p.tmax - p.tmin).toFixed(1)} M`], ['in time', `${((p.tmax - p.tmin) * D.tg / 60).toFixed(1)} min`], ['t_hit min (from r 1000)', `${p.tmin.toFixed(1)} M`], ['mean Δt over disk', p.hit ? `${(p.sumT / p.hit + 1000 - p.tmin).toFixed(2)} M` : '—', C.cyan]],""")
rep("""      [['min / max', `${p.gmin.toFixed(3)} / ${p.gmax.toFixed(3)}`], ['mean over disk', A.gMean ? A.gMean.toFixed(3) : '—'], ['spot ⟨g⟩ now', d ? d.gs.toFixed(3) : '—', C.cyan], ['g⁴ beaming max', (p.gmax ** 4).toFixed(2) + '×', C.amber]],""","""      [['min / max', `${p.gmin.toFixed(3)} / ${p.gmax.toFixed(3)}`], ['mean over disk', p.hit ? (p.sumG / p.hit).toFixed(3) : '—'], ['spot ⟨g⟩ now', d ? d.gs.toFixed(3) : '—', C.cyan], ['g⁴ beaming max', (p.gmax ** 4).toFixed(2) + '×', C.amber]],""")

# colorbar for delay uses sqrt
rep("""          const v = k === 0 ? lo + (hi - lo) * t : k === 1 ? t : 1 - t;""","""          const v = k === 0 ? lo + (hi - lo) * t : k === 1 ? t : 1 - t; // delay: colour index is sqrt(dt / range)""")
open(p,'w',encoding='utf8').write(s)

# ---- gl.js: delay map sqrt scale, reduction column 44 (sum g, sum t-1000)
p='gl.js'; s=open(p,encoding='utf8').read()
s=s.replace("""      else if (uMode == 1) c = rampDelta((a.z - uTmin) / max(uHi, 1e-3));""","""      else if (uMode == 1) c = rampDelta(sqrt(max(a.z - uTmin, 0.0) / max(uHi, 1e-3)));""")
s=s.replace("""  else {
    col = 43.0;""","""  else if (uWhich == 5) { col = 44.0; vC = hit * vec4(a.w, a.z - 1000.0, 0.0, 0.0); }
  else {
    col = 43.0;""")
s=s.replace("""    for (let w = 0; w < 5; w++) {
      gl.blendEquation(w < 3 ? gl.FUNC_ADD : gl.MAX);""","""    for (let w = 0; w < 6; w++) {
      gl.blendEquation(w < 3 || w === 5 ? gl.FUNC_ADD : gl.MAX);""")
s=s.replace("""      for (let i = 42 * 4; i < 44 * 4; i++) out[i] = Math.max(out[i], d[o + i]);""","""      for (let i = 42 * 4; i < 44 * 4; i++) out[i] = Math.max(out[i], d[o + i]);
      for (let i = 44 * 4; i < 45 * 4; i++) out[i] += d[o + i];""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
s=s.replace("""    limit: 0, res: 0, tmin: 1e9, tmax: -1e9, gmin: 1e9, gmax: -1e9, iref: 0, sumR: 0, hist: new Float64Array(GLX.HIST_BINS) });""","""    limit: 0, res: 0, tmin: 1e9, tmax: -1e9, gmin: 1e9, gmax: -1e9, iref: 0, sumR: 0, sumG: 0, sumT: 0, hist: new Float64Array(GLX.HIST_BINS) });""")
s=s.replace("""    acc.iref = Math.max(acc.iref, d[o43 + 2]);""","""    acc.iref = Math.max(acc.iref, d[o43 + 2]);
    acc.sumG += d[176]; acc.sumT += d[177];""")
open(p,'w',encoding='utf8').write(s)
print('ok')

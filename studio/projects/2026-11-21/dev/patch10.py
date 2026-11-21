p='panels.js'; s=open(p,encoding='utf8').read()
def rep(old,new):
    global s
    if old not in s: raise SystemExit('MISSING: '+old[:90])
    s=s.replace(old,new)

# ---- Fe line: spot marker above the envelope, pill label that avoids the other labels
rep("""      if (xs > x0 && xs < x1) {
        ctx.fillStyle = C.magenta; ctx.fillRect(Math.round(xs) - 1, y0 + 16, 2, y1 - y0 - 16);
        const sl = `spot ${Es.toFixed(2)}`, sw = UI.textW(ctx, sl, F.mono(9.5));
        const left = xs + sw + 10 > x1 || (xs < X(6.4) && xs - sw - 10 > x0);
        const sy = y0 + 0.62 * (y1 - y0);
        ctx.fillStyle = 'rgba(11,10,16,0.8)'; ctx.fillRect(left ? xs - sw - 9 : xs + 3, sy - 10, sw + 6, 13);
        UI.mono(ctx, sl, left ? xs - 6 : xs + 6, sy, C.magenta, left ? 'right' : 'left', 9.5);
      }""","""      if (xs > x0 && xs < x1) {
        // the marker stays above the histogram (and above the red-wing label row), its label sits on a pill
        const bi = Math.max(0, Math.min(99, Math.floor((Es - E0) / dE)));
        let env = y1;
        for (let k = Math.max(0, bi - 1); k <= Math.min(99, bi + 1); k++) env = Math.min(env, Y(S.line[k]));
        const lineBot = Math.min(env - 3, y1 - 34), lineTop = y0 + 4;
        ctx.fillStyle = C.magenta; ctx.fillRect(Math.round(xs) - 1, lineTop, 2, Math.max(0, lineBot - lineTop));
        const sl = `spot ${Es.toFixed(2)}`;
        UI.setFont(ctx, F.mono(9.5), 'normal');
        const sw = ctx.measureText(sl).width;
        // candidate positions: right of the line, left of the line, at the line's top or just above the envelope
        const hornL = xb - 6 - UI.textW(ctx, `blue horn ${Ebp.toFixed(2)} keV`, F.mono(9.5)) - 2, hornR = xb + 6, hornY = Y(S.line[bp]) - 4;
        const cands = [];
        for (const yy of [lineTop + 10, Math.max(lineTop + 10, lineBot - 6)]) for (const side of [1, -1]) cands.push([side, yy]);
        let pick = cands[0];
        for (const [side, yy] of cands) {
          const bx = side > 0 ? xs + 4 : xs - sw - 10;
          if (bx < x0 + 2 || bx + sw + 8 > x1 - 2) continue;
          const hitsHorn = bx < hornR && bx + sw + 8 > hornL && Math.abs(yy - hornY) < 14;
          const hitsRest = Math.abs(bx + (sw + 8) / 2 - X(6.4)) < (sw + 8) / 2 + 2 && Math.abs(yy - (y0 + 0.42 * (y1 - y0))) < 14;
          if (!hitsHorn && !hitsRest) { pick = [side, yy]; break; }
        }
        const [side, sy] = pick, bx = side > 0 ? xs + 4 : xs - sw - 10;
        ctx.fillStyle = 'rgba(11,10,16,0.88)'; ctx.beginPath(); ctx.roundRect(bx, sy - 10, sw + 6, 13, 4); ctx.fill();
        ctx.strokeStyle = UI.rgba(C.magenta, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(bx + 0.5, sy - 9.5, sw + 5, 12, 4); ctx.stroke();
        UI.mono(ctx, sl, bx + 3, sy, C.magenta, 'left', 9.5);
      }""")

# ---- centroid: expand-only symmetric range starting at 15 µas
rep("""    let R = 0.5;
    for (const p of pts) R = Math.max(R, Math.abs(p.cx - mx), Math.abs(p.cy - my));
    { const st = ticks(0, R * 1.15, 2).step; R = Math.ceil((R * 1.15) / st) * st; }""","""    let R = 0.5;
    for (const p of pts) R = Math.max(R, Math.abs(p.cx - mx), Math.abs(p.cy - my));
    // fixed ±15 µas; only ever expands (by 5 µas steps), so the loop never jumps in size
    centR = Math.max(centR, Math.ceil((R * 1.1) / 5) * 5);
    R = centR;""")
rep("""  function drawCentroid(ctx, w, h) {""","""  let centR = 15;
  function drawCentroid(ctx, w, h) {""")

# ---- spin sweep: padded ranges, labels in empty corners, 17° markers on top and offset
rep("""    const px0 = 36, px1 = w - 8;
    const X = (a) => px0 + (a / 1) * (px1 - px0);""","""    const px0 = 36, px1 = w - 8;
    const X = (a) => px0 + 6 + (a / 1) * (px1 - px0 - 10);""")
rep("""      // measured points
      // i = 72°: hollow amber circles; i = 17°: small filled violet squares, offset 2 px right so both read
      for (const s of pts) {
        const v = key === 'd' ? s.diamUas : s.offUas;
        if (s.tag === 17) {
          ctx.fillStyle = '#0B0A10'; ctx.fillRect(X(s.a) + 2 - 2.6, Y(v) - 2.6, 5.2, 5.2);
          ctx.fillStyle = C.violet; ctx.fillRect(X(s.a) + 2 - 1.8, Y(v) - 1.8, 3.6, 3.6);
        } else {
          ctx.fillStyle = '#0B0A10'; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 3.2, 0, 2 * Math.PI); ctx.fill();
          ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 2.6, 0, 2 * Math.PI); ctx.stroke();
        }
      }""","""      // measured points: i = 72° hollow amber circles first, then i = 17° filled violet squares on top, 4 px right
      for (const s of pts) {
        if (s.tag === 17) continue;
        const v = key === 'd' ? s.diamUas : s.offUas;
        ctx.fillStyle = '#0B0A10'; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 3.2, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 2.6, 0, 2 * Math.PI); ctx.stroke();
      }
      for (const s of pts) {
        if (s.tag !== 17) continue;
        const v = key === 'd' ? s.diamUas : s.offUas;
        ctx.fillStyle = '#0B0A10'; ctx.fillRect(X(s.a) + 4 - 3, Y(v) - 3, 6, 6);
        ctx.fillStyle = C.violet; ctx.fillRect(X(s.a) + 4 - 2.2, Y(v) - 2.2, 4.4, 4.4);
      }""")
rep("""    plot(40, 150, 'd', Math.min(...dv) - 0.4, Math.max(...dv) + 0.4, 'd_shadow [µas]');
    plot(174, 262, 'o', Math.min(...ov) - 0.8, Math.max(...ov) + 0.8, 'offset α_c [µas]');
    UI.label(ctx, 'shadow diameter d [µas]', px0 + 4, 145, C.muted, 'left', 9.5);
    UI.label(ctx, 'centroid offset α_c [µas]', px0, 169, C.muted, 'left', 9.5);""","""    const pad = (v, f) => { const a = Math.min(...v), b = Math.max(...v), p = (b - a) * f; return [a - p, b + p]; };
    const [dlo, dhi] = pad(dv, 0.08), [olo, ohi] = pad(ov, 0.1);
    plot(40, 150, 'd', dlo, dhi, 'd_shadow [µas]');
    plot(174, 262, 'o', olo, ohi, 'offset α_c [µas]');
    UI.label(ctx, 'shadow diameter d [µas]', px1, 35, C.muted, 'right', 9.5);
    UI.label(ctx, 'centroid offset α_c [µas]', px0, 169, C.muted, 'left', 9.5);""")

# ---- visibilities: note and the null a 51 µas ring would have
rep("""    const ry = h - 22;
    kv(ctx, 'ring fit d', fit ? `${fit.d.toFixed(1)} µas` : '…', 8, ry, C.amber);
    kv(ctx, 'width', fit ? `${fit.w.toFixed(0)}` : '…', 132, ry, C.text);
    kv(ctx, 'first null', fit ? `${(fit.nullG / 1e9).toFixed(2)} Gλ` : '…', 8, h - 8, C.amber);
    kv(ctx, 'model', A.eht.nullG ? `${(A.eht.nullG / 1e9).toFixed(2)}` : '…', 132, h - 8, C.muted);""","""    // where a ring the size of the shadow (51 µas) would null, for comparison
    const dSh = A.crit ? A.crit.diamUas : A.D.critDiamM * A.D.uasPerM;
    const nSh = 0.7655 / (dSh * Math.PI / 180 / 3600e6), xsh = X(nSh);
    dashLine(ctx, [[xsh, yb0], [xsh, yb1]], UI.rgba(C.cyan, 0.85), [2, 3], 1);
    const ry = h - 22;
    kv(ctx, 'ring fit', fit ? `${fit.d.toFixed(1)} µas → ${(fit.nullG / 1e9).toFixed(2)} Gλ` : '…', 8, ry, C.amber);
    UI.mono(ctx, `${dSh.toFixed(0)} µas ring → ${(nSh / 1e9).toFixed(2)}`, w - 8, ry, C.cyan, 'right', 9.5);
    UI.label(ctx, 'crescent: the light comes from inside the critical curve', 8, h - 8, C.muted, 'left', 9);""")

# ---- CPU sparklines: label row reserved above each trace
rep("""      spark(ctx, vals, cx, cy + 9, cw, ch - 9, col);
      UI.mono(ctx, `T${String(k).padStart(2, '0')}`, cx + 3, cy + 9, C.muted, 'left', 9);
      UI.mono(ctx, cur == null ? '—' : `${cur.toFixed(0)}%`, cx + cw - 3, cy + 9, C.text, 'right', 9);""","""      ctx.save(); ctx.beginPath(); ctx.rect(cx, cy + 11, cw, ch - 11); ctx.clip();
      spark(ctx, vals, cx, cy + 12, cw, ch - 13, col);
      ctx.restore();
      ctx.fillStyle = C.faint; ctx.fillRect(cx, cy + 10, cw, 1);
      UI.mono(ctx, `T${String(k).padStart(2, '0')}`, cx + 3, cy + 8.5, C.muted, 'left', 9);
      UI.mono(ctx, cur == null ? '—' : `${cur.toFixed(0)}%`, cx + cw - 3, cy + 8.5, C.text, 'right', 9);""")
open(p,'w',encoding='utf8').write(s)
print('ok')

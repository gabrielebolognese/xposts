import io
p = 'ui.js'
s = io.open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:90]
    s = s.replace(old, new)


# --- formatting (issue 6)
rep("""  const sgn = (v, d = 0) => (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(d);
  const neg = (v, d = 0) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);""", """  // signed / negative formats that never print a negative zero
  const sgn = (v, d = 0) => {
    const a = Math.abs(v).toFixed(d);
    return (+a === 0 ? '' : v > 0 ? '+' : MINUS) + a;
  };
  const neg = (v, d = 0) => {
    const a = Math.abs(v).toFixed(d);
    return (+a !== 0 && v < 0 ? MINUS : '') + a;
  };""")
old = s[s.index("  const fe = (v, d = 2) => {"):s.index("  const clock = (t) => {")]
rep(old, """  // exponent notation with the mantissa normalised to [1, 10) after rounding
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
""")
# --- profile strips (issue 8)
rep("""    // profile strip frames
    const px0 = MAP.x, py0 = MAP.y + MAP.s + 6, pw = MAP.s, ph = 34;
    rect(g, px0, py0, pw, ph, PAL.line);
    const qx0 = MAP.x + MAP.s + 6, qy0 = MAP.y, qw = 34, qh = MAP.s;
    rect(g, qx0, qy0, qw, qh, PAL.line);""", """    // profile strip frames
    g.fillStyle = 'rgba(5,9,15,0.45)';
    g.fillRect(PX.x, PX.y, PX.w, PX.h);
    g.fillRect(PY.x, PY.y, PY.w, PY.h);
    rect(g, PX.x, PX.y, PX.w, PX.h, PAL.line);
    rect(g, PY.x, PY.y, PY.w, PY.h, PAL.line);""")
rep("""  const MAP = { x: 32, y: 36, s: 680 };""", """  const MAP = { x: 32, y: 36, s: 680 };
  const PX = { x: 32, y: 36 + 680 + 4, w: 680, h: 38 }; // x-profile strip under the map
  const PY = { x: 32 + 680 + 4, y: 36, w: 38, h: 680 }; // y-profile strip right of the map""")
old = s[s.index("  function drawProfiles(g) {"):s.index("  // dropped rod flash + MC tracks (every frame)")]
rep(old, """  function drawProfiles(g, APP) {
    if (!V.prof) return;
    const { px1, px2, py1, py2 } = V.prof;
    const m1 = Math.max(...px1, ...py1), m2 = Math.max(...px2, ...py2);
    const cs = MAP.s / N, A = PX.h - 7;
    const xb = PX.y + PX.h - 3; // baseline of the x-profile
    const yb = PY.x + 3; // baseline of the y-profile
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
    // fast-flux fill, then both lines
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
    g.fillStyle = 'rgba(155,140,255,0.16)';
    fill(px1, m1, true);
    fill(py1, m1, false);
    g.lineWidth = 1.3;
    g.strokeStyle = PAL.violet;
    path(px1, m1, true);
    g.stroke();
    path(py1, m1, false);
    g.stroke();
    g.strokeStyle = PAL.cyan;
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
      g.moveTo(dx, PX.y + 1);
      g.lineTo(dx, PX.y + PX.h - 1);
      g.moveTo(PY.x + 1, dy);
      g.lineTo(PY.x + PY.w - 1, dy);
      g.stroke();
      g.setLineDash([]);
      T(g, `${COLS[r.ac]}${r.ar + 1}`, dx + 3, PX.y + 9, FT(8, 700), PAL.down);
      T(g, `${COLS[r.ac]}${r.ar + 1}`, PY.x + 3, dy - 3, FT(8, 700), PAL.down);
    }
    // labels on dark chips along the bottom edge (where only the fill sits)
    setStretch(g);
    const chip = (str, x, y, font, color, align) => {
      g.font = font;
      const w = g.measureText(str).width;
      const x0 = align === 'right' ? x - w : x;
      g.fillStyle = 'rgba(5,9,15,0.82)';
      g.fillRect(x0 - 3, y - 8, w + 6, 11);
      T(g, str, x, y, font, color, align);
      return w;
    };
    let lx = PX.x + 44;
    lx += chip('x-PROFILE \\u00b7 E-W AXIS', lx, xb - 1, FT(8.5, 600), PAL.muted) + 10;
    lx += chip('\\u03c61 FAST', lx, xb - 1, FM(8.5, 600), PAL.violet) + 10;
    chip('\\u03c62 THERMAL', lx, xb - 1, FM(8.5, 600), PAL.cyan);
    chip(`1.0 = \\u03c61 ${fe(m1, 2)} \\u00b7 \\u03c62 ${fe(m2, 2)} n/cm\\u00b2/s`, PX.x + PX.w - 44, xb - 1, FM(8.5), PAL.text, 'right');
    g.save();
    g.translate(PY.x + PY.w - 8, PY.y + PY.h - 200);
    g.rotate(Math.PI / 2);
    chip('y-PROFILE \\u00b7 N-S AXIS', 0, 0, FT(8.5, 600), PAL.muted);
    g.restore();
  }

""")
rep("    // profiles\n    drawProfiles(g);", "    // profiles\n    drawProfiles(g, APP);")
# --- per-assembly labels (issue 1)
a = s.index("    for (let ar = 0; ar < NA; ar++) {\n      for (let ac = 0; ac < NA; ac++) {\n        const a = ar * NA + ac, m = CM[a];\n        if (!m || m === 4) continue;\n        const x = x0 + ac * AS + AS / 2, y = y0 + ar * AS;")
b = s.index("    // hottest assembly (F_xy location)")
s = s[:a] + """    // two-line labels on a 50 % navy chip (tracks underneath show at half strength), dark halo round the digits
    const labels = [];
    for (let ar = 0; ar < NA; ar++) {
      for (let ac = 0; ac < NA; ac++) {
        const a = ar * NA + ac, m = CM[a];
        if (!m || m === 4) continue;
        const x = x0 + ac * AS + AS / 2, y = y0 + ar * AS;
        const isRod = rodAt[a] !== undefined;
        const yv = isRod ? y + 21 : y + 17, yd = isRod ? y + 31 : y + 29;
        g.fillStyle = 'rgba(5,12,24,0.5)';
        if (isRod) g.fillRect(x - 17, y + 12.5, 34, 21);
        else g.fillRect(x - 18, y + 7.5, 36, 25);
        const dp = APP.asmDelta[a];
        const ds = Math.abs(dp).toFixed(3);
        const zero = +ds === 0;
        labels.push([APP.asm[a].toFixed(3), x, yv, zero ? '0.000' : (dp > 0 ? '+' : MINUS) + ds, yd, zero ? 'rgba(214,228,240,0.62)' : dp > 0 ? '#2FBF80' : '#FF4A4A']);
      }
    }
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(4,8,14,0.92)';
    g.lineWidth = 2.6;
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
""" + s[b:]
rep("""      if (dropped) return; // drawn flashing on the fx layer
      g.strokeStyle = PAL.amber;
      g.lineWidth = 1.5;
      g.strokeRect(x + 2.5, y + 2.5, AS - 5, AS - 5);
      const light = textOn(APP.asm[r.ar * NA + r.ac]);
      T(g, `D ${rodPct}%`, x + AS / 2, y + 11, FT(8.5, 700), light ? '#4A2E00' : PAL.amber, 'center');""", """      const lbl = dropped ? 'DROPPED' : `D ${rodPct}%`;
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
      g.fillText(lbl, x + AS / 2, y + 10);""")
# --- dropped rod: ring + callout with worth on fx, no fill over the numbers
rep("""      const ph = 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 2 * 1.6);
      g.strokeStyle = hexA('#FF5D5D', 0.45 + 0.55 * ph);
      g.lineWidth = 2;
      g.strokeRect(x + 2, y + 2, AS - 4, AS - 4);
      g.fillStyle = hexA('#FF5D5D', 0.12 + 0.18 * ph);
      g.fillRect(x + 3, y + 3, AS - 6, AS - 6);
      setStretch(g);
      T(g, 'DROPPED', x + AS / 2, y + 11, FT(8.5, 700), PAL.down, 'center');
      // callout over the void / reflector assemblies to the west
      const cx = MAP.x + 6, cy = MAP.y + 13 * AS + 6;
      g.fillStyle = 'rgba(5,9,15,0.85)';
      g.fillRect(cx, cy, 108, 28);
      rect(g, cx, cy, 108, 28, hexA('#FF5D5D', 0.6 + 0.4 * ph));
      T(g, 'DROPPED ROD · 100% IN', cx + 6, cy + 11, FT(9, 700), PAL.down);
      T(g, `${r.name} ${COLS[r.ac]}${r.ar + 1} · ${clock(APP.dropAt)}`, cx + 6, cy + 23, FM(8.5, 600), PAL.text);""", """      const ph = 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 2 * 1.6);
      g.strokeStyle = hexA('#FF5D5D', 0.45 + 0.55 * ph);
      g.lineWidth = 2;
      g.strokeRect(x + 1.5, y + 1.5, AS - 3, AS - 3);
      setStretch(g);
      // callout over the void / reflector assemblies to the west
      const cx = MAP.x + 6, cy = MAP.y + 13 * AS + 4;
      const rr = APP.hist.at(-1);
      const dw = rr && rr.dropWorth ? rr.dropWorth : null;
      g.fillStyle = 'rgba(5,9,15,0.88)';
      g.fillRect(cx, cy, 110, 40);
      rect(g, cx, cy, 110, 40, hexA('#FF5D5D', 0.6 + 0.4 * ph));
      T(g, 'DROPPED ROD \\u00b7 100% IN', cx + 6, cy + 11, FT(9, 700), PAL.down);
      T(g, `${r.name} ${COLS[r.ac]}${r.ar + 1} \\u00b7 ${clock(APP.dropAt)}`, cx + 6, cy + 23, FM(8.5, 600), PAL.text);
      T(g, dw !== null ? `worth ${neg(dw, 0)} pcm` : 'worth \\u2013', cx + 6, cy + 35, FM(8.5, 700), PAL.down);""")
rep("""      g.moveTo(cx + 108, cy + 4);
      g.lineTo(x + 2, y + AS - 4);""", """      g.moveTo(cx + 110, cy + 4);
      g.lineTo(x + 1, y + AS - 4);""")
io.open(p, 'w', encoding='utf8').write(s)
print('ok')

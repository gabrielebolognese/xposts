import io
p = 'ui.js'
s = io.open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:90]
    s = s.replace(old, new)


rep("  const PX = { x: 32, y: 36 + 680 + 4, w: 680, h: 38 }; // x-profile strip under the map\n  const PY = { x: 32 + 680 + 4, y: 36, w: 38, h: 680 }; // y-profile strip right of the map",
    "  const PX = { x: 32, y: 36 + 680 + 2, w: 680, h: 41 }; // x-profile strip under the map (top 11 px: legend band)\n"
    "  const PY = { x: 32 + 680 + 2, y: 36, w: 44, h: 680 }; // y-profile strip right of the map (right 11 px: label band)\n"
    "  const PBAND = 11, PROF1 = '#3FB8FF', PROF2 = '#B8F4FF'; // fast flux blue, thermal flux pale cyan")
rep("    rect(g, PY.x, PY.y, PY.w, PY.h, PAL.line);",
    "    rect(g, PY.x, PY.y, PY.w, PY.h, PAL.line);\n"
    "    hline(g, PX.x + 1, PX.x + PX.w - 1, PX.y + PBAND, PAL.line);\n"
    "    vline(g, PY.x + PY.w - PBAND - 1, PY.y + 1, PY.y + PY.h - 1, PAL.line);")

a = s.index("  function drawProfiles(g, APP) {")
b = s.index("  // dropped rod flash + MC tracks (every frame)")
s = s[:a] + """  function drawProfiles(g, APP) {
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
    T(g, 'x-PROFILE \\u00b7 E-W AXIS', lx, ly, FT(8.5, 600), PAL.muted);
    g.font = FT(8.5, 600);
    lx += g.measureText('x-PROFILE \\u00b7 E-W AXIS').width + 14;
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
    sw(PROF1, 1.6, '\\u03c61 FAST');
    sw(PROF2, 1.4, '\\u03c62 THERMAL');
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
    T(g, `1.0 = \\u03c61 ${fe(m1, 2)} \\u00b7 \\u03c62 ${fe(m2, 2)} n/cm\\u00b2/s`, PX.x + PX.w - 6, ly, FM(8.5), PAL.text, 'right');
    // label band right of the y-profile
    g.save();
    g.translate(PY.x + PY.w - 4, PY.y + 6);
    g.rotate(Math.PI / 2);
    T(g, 'y-PROFILE \\u00b7 N-S AXIS', 0, 0, FT(8.5, 600), PAL.muted);
    T(g, `\\u03c61 / \\u03c62 \\u00b7 SAME SCALE AS x`, PY.h - 12, 0, FT(8.5, 600), PAL.muted, 'right');
    g.restore();
  }

""" + s[b:]
io.open(p, 'w', encoding='utf8').write(s)
print('ok')

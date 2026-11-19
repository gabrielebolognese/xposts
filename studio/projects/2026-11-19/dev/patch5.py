import io


def load(p):
    return io.open(p, encoding='utf8').read()


def save(p, s):
    io.open(p, 'w', encoding='utf8').write(s)


def rep(s, old, new):
    if new in s:
        return s  # already applied
    assert old in s, old[:100]
    return s.replace(old, new)


# ---------------- main.js: per-generation sigma alongside sigma of the mean
p = 'main.js'
s = load(p)
s = rep(s, "      MC.kSig = A.n > 1 ? Math.sqrt(Math.max(0, v) / A.n) : 0;",
        "      MC.kSig = A.n > 1 ? Math.sqrt(Math.max(0, v) / A.n) : 0; // sigma of the mean\n      MC.kStd = A.n > 1 ? Math.sqrt(Math.max(0, v)) : 0; // per-generation spread")
s = rep(s, "MC.prev = { kMean: MC.kMean, kSig: MC.kSig, kDiff: MC.kDiff,", "MC.prev = { kMean: MC.kMean, kSig: MC.kSig, kStd: MC.kStd, kDiff: MC.kDiff,")
s = rep(s, "return { kMean: MC.kMean, kSig: MC.kSig, kDiff: MC.kDiff, n: MC.act.n, prev: false, run: MC.run };",
        "return { kMean: MC.kMean, kSig: MC.kSig, kStd: MC.kStd || 0, kDiff: MC.kDiff, n: MC.act.n, prev: false, run: MC.run };")
save(p, s)

# ---------------- plant.js: annotate the xenon-driven tilt once QPTR passes 1.2
p = 'plant.js'
s = load(p)
s = rep(s, """        } else if (band > S.qptrBand) {
          S.qptrBand = band;""", """        } else if (band > S.qptrBand) {
          if (band >= 2 && S.qptrBand < 2 && S.lastSolve) {
            log('xe', `XE AZIMUTHAL REDISTRIBUTION \\u00b7 DR ${S.lastSolve.dr.toFixed(3)}`);
            log('ctrl', 'tilt growth uncontrolled: no Xe tilt control');
          }
          S.qptrBand = band;""")
save(p, s)

# ---------------- ui.js
p = 'ui.js'
s = load(p)
# status bar: widths, MC from the same snapshot as the MC panel, sigma(mean) label, one-line drop chip
s = rep(s, "cell(116, 'SIM TIME'", "cell(110, 'SIM TIME'")
s = rep(s, "cell(164, 'CORE POWER'", "cell(156, 'CORE POWER'")
s = rep(s, "cell(106, 'BORON'", "cell(100, 'BORON'")
a = s.index("    const q = APP.mcShown();\n    cell(170,")
b = s.index("\n", s.index("cell(170,", a)) + 1
s = s[:a] + """    const q = V.mcQ || APP.mcShown(); // the same tally snapshot the Monte Carlo panel shows
    cell(166, q.prev ? 'MONTE CARLO k \\u00b7 PREV \\u00b7 \\u03c3(MEAN)' : 'MONTE CARLO k \\u00b7 \\u03c3(MEAN)', q.n > 1 ? q.kMean.toFixed(5) : '\\u2013', PAL.blue, q.n > 1 ? `\\u00b1${(q.kSig * 1e5).toFixed(0)} pcm` : `gen ${mc.genRun}`);
""" + s[b:]
s = rep(s, """    let cx = x + 10;
    const cw = Math.floor((p.w - 10 - cx - 16) / 3);
    for (const [name, on, col] of chips) {""", """    let cx = x + 10;
    const cws = [118, 132];
    cws.push(p.w - 10 - cx - 16 - cws[0] - cws[1]);
    let ci = 0;
    for (const [name, on, col] of chips) {
      const cw = cws[ci++];""")
s = rep(s, """      if (name === 'ROD DROPPED' && on && r.qptr > 1.02) {
        T(g, 'ROD DROPPED', cx + 22, 18, FT(10, 700), col);
        g.letterSpacing = '0px';
        T(g, 'TS QPTR>1.02: REDUCE PWR', cx + 22, 29, FT(7.5, 600), PAL.text);
      } else T(g, name, cx + 22, 24, FT(10.5, 700), on ? col : PAL.dim);""", """      if (name === 'ROD DROPPED' && on && r.qptr > 1.02) {
        g.letterSpacing = '0px';
        T(g, 'ROD DROPPED \\u00b7 QPTR>1.02', cx + 22, 24, FT(10, 700), col);
      } else T(g, name, cx + 22, 24, FT(10.5, 700), on ? col : PAL.dim);""")
# Monte Carlo readouts: snapshot shared with the status bar, sigma(mean) and per-generation sigma
s = rep(s, """    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 13.2;
    };
    const q = APP.mcShown();""", """    const row = (l, v, c, u) => {
      kv(g, rx0, rx1, y, l, v, c, u);
      y += 12.4;
    };
    const q = APP.mcShown();
    V.mcQ = q;""")
s = rep(s, "    row('σ', act ? (q.kSig * 1e5).toFixed(0) : '–', qc, 'pcm');",
        "    row('\\u03c3(mean)', act ? (q.kSig * 1e5).toFixed(0) : '\\u2013', qc, 'pcm');\n    row('\\u03c3 per gen', act ? (q.kStd * 1e5).toFixed(0) : '\\u2013', PAL.muted, 'pcm');")
# solver sparkline: scale clipped at the 98th percentile, capped spikes in red with their value
s = rep(s, """    const steps = APP.steps.slice(-169);
    let om = 50;
    for (const q of steps) om = Math.max(om, q.outers);
    const sw = c.w / 169;
    for (let i = 0; i < steps.length; i++) {
      const q = steps[i];
      const hh = Math.max(1, (q.outers / om) * (c.h - 2));
      g.fillStyle = q.t >= APP.dropAt && q.t < APP.dropAt + 6 ? PAL.down : q.solves > 1 ? hexA('#FFB547', 0.8) : hexA('#3FB8FF', 0.75);
      g.fillRect(c.x + 1 + i * sw, c.y + c.h - 1 - hh, Math.max(1, sw - 0.6), hh);
    }""", """    const steps = APP.steps.slice(-169);
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
    }""")
# xenon worth subplot: equilibrium label moves into the formula chip
s = rep(s, "    T(g, `eq 100% ${neg(APP.xeEq, 0)}`, TX0 + 4, yR(APP.xeEq) - 3, FM(7.5), PAL.muted);\n", "")
s = rep(s, "    const fl = 'XENON WORTH ρXe = (1/k_noXe − 1/k)·10⁵  pcm';",
        "    const fl = `XENON WORTH \\u03c1Xe = (1/k_noXe \\u2212 1/k)\\u00b710\\u2075 pcm \\u00b7 DASHED: EQ 100% ${neg(APP.xeEq, 0)}`;")
save(p, s)
print('ok')

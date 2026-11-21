p='gl.js'; s=open(p,encoding='utf8').read()
def rep(old,new,cnt=1):
    global s
    if s.count(old) < 1: raise SystemExit('MISSING: '+old[:90])
    s=s.replace(old,new) if cnt==0 else s.replace(old,new,cnt)
# outer-edge taper of the emission (hero + readbacks)
rep("""  float I = g4 * Fhat(r) * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem));
  float age = tem - uSpotBirth;
  if (age > 0.0) {""","""  float I = g4 * Fhat(r) * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem)) * (1.0 - smoothstep(uRout - 2.0, uRout, r));
  float age = tem - uSpotBirth;
  if (age > 0.0) {""")
rep("""      float Id = em * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem));""","""      float Id = em * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem)) * (1.0 - smoothstep(uRout - 2.0, uRout, r));""")
# stars: denser, brighter
rep("""  float cell = 0.011;""","""  float cell = 0.009;""")
rep("""  if ((h & 255u) < 120u) {""","""  if ((h & 255u) < 150u) {""")
rep("""    float bright = pow(float(h2 & 1023u) / 1023.0, 4.0) * 1.6;""","""    float bright = pow(float(h2 & 1023u) / 1023.0, 2.6) * 2.4;""")
rep("""    float sz = 1.3e-4;""","""    float sz = 1.5e-4;""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
s=s.replace("""  const CRIT_N = 180, CRIT_BUDGET = 3400;""","""  const CRIT_N = 180, CRIT_BUDGET = 6000;""")
open(p,'w',encoding='utf8').write(s)

p='panels.js'; s=open(p,encoding='utf8').read()
def rp(old,new):
    global s
    if old not in s: raise SystemExit('MISSING P: '+old[:90])
    s=s.replace(old,new)
# integrator rows
old=s[s.index("    let y = 38;\n    const c1 = 8, c2 = 172;"):s.index("    // steps histogram (this pass)")]
new='''    let y = 36;
    const c1 = 8, c2 = 172;
    kv(ctx, 'rays/s', UI.int(rps), c1, y, C.cyan, 62);
    kv(ctx, 'RK4 steps/s', `${(sps / 1e6).toFixed(1)} M`, c2, y, C.cyan, 82);
    y += 14;
    kv(ctx, 'mean steps', UI.fx(p.steps / Math.max(1, p.rays), 1), c1, y, C.text, 62);
    kv(ctx, 'max steps', UI.int(p.maxSteps), c2, y, C.text, 82);
    y += 14;
    const fr = (x) => `${((100 * x) / Math.max(1, p.rays)).toFixed(1)}%`;
    kv(ctx, 'captured', fr(p.capt), c1, y, C.violet, 62);
    kv(ctx, 'escaped', fr(p.esc), c1 + 108, y, C.cyan, 46);
    kv(ctx, 'disk', fr(p.hit), c2 + 62, y, C.amber, 28);
    y += 14;
    const pr = A.probes || {};
    kv(ctx, 'null resid.', UI.sci(p.res, 1), c1, y, C.text, 62);
    kv(ctx, 'fp64 probes', pr.cpu ? UI.sci(pr.res64, 1) : '…', c2, y, C.up, 82);
    y += 14;
    kv(ctx, 'fp32−fp64 Δr', pr.cpu ? `${UI.sci(pr.rms, 1)} M` : '…', c1, y, pr.cpu ? C.up : C.muted, 76);
    kv(ctx, 'probe fates', pr.cpu ? `${pr.agree}/64 same` : '…', c2, y, pr.cpu ? C.up : C.muted, 82);
    y += 14;
    const gp = GLX.gpu || {};
    kv(ctx, 'GPU trace', gp.trace != null ? `${gp.trace.toFixed(2)} ms` : '—', c1, y, C.text, 62);
    kv(ctx, 'GPU shade', gp.hero != null ? `${gp.hero.toFixed(2)} ms` : '—', c2, y, C.text, 82);
'''
s=s.replace(old,new)
rp("""    y += 10;
    const hx = 8, hw = w - 16, hh = 44, hy = y;""","""    y += 8;
    const hx = 8, hw = w - 16, hh = 40, hy = y;""")
# controls: fill the bottom with derived numbers
rp("""    tog('Light-travel delay', P.delay, 8, y + 20);
    tog('Analytic curve', P.showCrit, 168, y + 20);""","""    tog('Light-travel delay', P.delay, 8, y + 20);
    tog('Analytic curve', P.showCrit, 168, y + 20);
    y += 40;
    ctx.fillStyle = C.faint; ctx.fillRect(8, y, w - 16, 1);
    const Ws = 1 / (Math.pow(P.rs, 1.5) + P.a);
    UI.mono(ctx, `P_spot ${D.spotPeriodMin.toFixed(2)} min  Ω_s ${Ws.toFixed(4)} rad/M  T_spot ${UI.sci(D.Ts, 2)} K`, 8, y + 13, C.muted, 'left', 9.5);
    UI.mono(ctx, `Ṁ ${UI.sci(D.Mdot, 2)} kg/s  T_max ${UI.sci(D.Tmax, 2)} K  ${(D.spotPeriodM).toFixed(1)} M/orbit`, 8, y + 26, C.muted, 'left', 9.5);""")
# light curve: legend in the header, no in-plot axis labels
rp("""    UI.panel(ctx, w, h, 'Hot-spot light curve', `r_s ${A.P.rs} M · σ_s ${A.P.sig} M · delays on`, { mark: C.orange });""","""    UI.panel(ctx, w, h, 'Hot-spot light curve', '', { mark: C.orange });
    ctx.fillStyle = C.amber; ctx.fillRect(w - 214, 11, 10, 6);
    UI.label(ctx, 'spot, % of ⟨F⟩ (left)', w - 200, 17, C.amber, 'left', 9.5);
    ctx.fillStyle = C.white; ctx.fillRect(w - 98, 13, 10, 1.5);
    UI.label(ctx, 'F/⟨F⟩ (right)', w - 84, 17, C.text, 'left', 9.5);""")
rp("""    UI.label(ctx, 'spot % of ⟨F⟩', x0 + 4, y0 + 11, C.amber, 'left', 9.5);
    UI.label(ctx, 'F/⟨F⟩', x1 - 4, y0 + 11, C.muted, 'right', 9.5);""","""""")
# spin sweep: diameter label inside bottom-left
rp("""    UI.label(ctx, 'shadow diameter d [µas]', px0, 35, C.muted, 'left', 9.5);""","""    UI.label(ctx, 'shadow diameter d [µas]', px0 + 4, 145, C.muted, 'left', 9.5);""")
# Fe line: rest label lower
rp("""    UI.mono(ctx, '6.40 rest', xr - 4, y0 + 11, C.cyan, 'right', 9.5);""","""    UI.mono(ctx, '6.40 rest', xr - 4, y0 + 0.42 * (y1 - y0), C.cyan, 'right', 9.5);""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
s=s.replace("""    APP.probes.max = maxd; APP.probes.n = n; APP.probes.agree = agree;""","""    APP.probes.max = maxd; APP.probes.n = n; APP.probes.agree = agree;
    APP.probes.res64 = Math.max(...out.filter((c) => c.fate === 1).map((c) => c.res || 0));""")
open(p,'w',encoding='utf8').write(s)
print('ok')

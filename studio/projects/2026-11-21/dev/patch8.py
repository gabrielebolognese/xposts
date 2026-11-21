p='main.js'; s=open(p,encoding='utf8').read()
a=s.index("    // all readbacks are polled on the same frames (one sync per 4 frames)")
b=s.index("    sec('polls');")
s=s[:a]+'''    // one packed readback per 4-frame cycle (requested on band 3, read 3 frames later)
    const hb = F % 4 === 2 ? S.hub.poll(F, 3) : null;
    if (hb) {
      const tg = hb.tag;
      for (let b = 0; b < 4; b++) {
        const t = tg.red[b];
        if (!t) continue;
        const red = GLX.collapseBand(hb.view.red, b);
        passAdd(t.pid, red, t.n);
        APP.rayTimes.push([t.now, t.n * 1024, red[160]]);
      }
      const p = processDyn(hb.view.dyn0, hb.view.dyn1, 128, 128, 0, tg.dynT);
      pushLC(p);
      APP.dyn = p;
      if (p.anno) APP.anno = p.anno;
      onLightPoint();
      if (tg.cycle % 2 === 0) {
        const Is = [], gs = [];
        const d0 = hb.view.dyn0;
        for (let i = 0; i < 128 * 128; i++) { const v = d0[i * 4 + 1]; if (v > 1e-3 * p.ismax) { Is.push(v); gs.push(d0[i * 4 + 2] / v); } }
        spotPending = { cmd: 'spot', Is: Float64Array.from(Is), gs: Float64Array.from(gs), dA: (field[2] / 128) * (field[3] / 128),
          fluxUnit: D.fluxUnit, Ts: D.Ts, rg: D.rg, t: p.t };
      }
      if (hb.view.eht) { const e = hb.view.eht; APP.ehtImgPending = Float64Array.from({ length: EN * EN }, (_, q) => e[q * 4]); }
    }
'''+s[b:]
old="""    if (band === 3 && !GLX.reduceRequest(S, F, redTags)) for (const t of redTags) if (t) passAdd(t.pid, null, t.n);
    GLX.timeEnd(S);"""
new="""    GLX.timeEnd(S);
    if (band === 3) {
      // live image 128^2 and, every 4th cycle, the EHT crop, read back together with the reduction
      GLX.timeBegin(S, 'dyn');
      GLX.renderRead(S, S.dynFb, 128, 128, 1, field, 2, APP.simSec / D.tg, 0, shadeParams());
      const items = [{ fb: S.redFb, att: 0, w: GLX.RED_W, h: 64, key: 'red' }, { fb: S.dynFb, att: 0, w: 128, h: 128, key: 'dyn0' },
        { fb: S.dynFb, att: 1, w: 128, h: 128, key: 'dyn1' }];
      hubCycle++;
      if (hubCycle % 4 === 0) {
        GLX.renderRead(S, S.ehtFb, EN, EN, 1, ehtRegion(), 2, APP.simSec / D.tg, 0, shadeParams(), 1);
        items.push({ fb: S.ehtFb, att: 0, w: EN, h: EN, key: 'eht' });
      }
      if (!S.hub.request(items, F, { red: redTags, dynT: APP.simSec, cycle: hubCycle })) for (const t of redTags) if (t) passAdd(t.pid, null, t.n);
      GLX.timeEnd(S);
    }"""
assert old in s; s=s.replace(old,new)
s=s.replace("""  let last = null, passTile = 0, passId = 1, lastReport = -1e9, lastSpotPeak = null, redTags = [];""","""  let last = null, passTile = 0, passId = 1, lastReport = -1e9, lastSpotPeak = null, redTags = [], hubCycle = 0;""")
a=s.index("    // --- dynamic readback every 4 frames")
b=s.index("    tickEhtTime();")
s=s[:a]+"    sec('dyn');\n"+s[b:]
open(p,'w',encoding='utf8').write(s)
print('ok')

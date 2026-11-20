import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

patch('panels.js', [
("""    text(ctx, 'IPC per frame · 0.6-1.0 · 10 s', ix0 + 4, hy + 6, F.mono(8), P.muted);""",
 """    text(ctx, 'IPC per frame · axis 0.6-1.0 · last 10 s', ix0 + 4, hy + hh - 6, F.mono(8), P.muted);"""),
# probe: datapath cells of the multiplier / ALU only
("""      for (let k = D.gateStart - D.dffStart; k < hf.length; k++) { const pth = D.mods[D.mod[k + D.dffStart]].path; if (hf[k] > bv && pth.includes('exu/') && hf[k] < s.n) { bv = hf[k]; best = k; } }""",
 """      for (let k = D.gateStart - D.dffStart; k < hf.length; k++) {
        const i = k + D.dffStart;
        if (hf[k] <= bv || hf[k] >= s.n || D.bit[i] < 0) continue;
        const pth = D.mods[D.mod[i]].path;
        if (pth.includes('exu/mul') || pth.includes('exu/alu')) { bv = hf[k]; best = k; }
      }"""),
("""      let bx = x + 10, by = y + 8;
      if (bx + bw > L.dieX + L.dieW - 4) bx = x - 10 - bw;
      if (by + 40 > L.ctlY - 20) by = y - 48;""",
 """      let bx = x + 12, by = y + 10;
      if (bx + bw > L.dieX + L.dieW - 4) bx = x - 12 - bw;
      if (by + 40 > L.dpY + L.dpH - 4) by = y - 52;"""),
# site grid in the static layer, drawn under the cells
("""    // stage boxes and module outlines""",
 """    // empty placement sites (one dim dot per free site in the core area)
    const occ = new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4));
    const cw4 = Math.ceil(w / 4);
    for (let i = D.dffStart; i < D.n; i++) { const sx = Math.round(L.pos[i * 2] / 4), sy = Math.round(L.pos[i * 2 + 1] / 4); if (sx >= 0) occ[sy * cw4 + sx] = 1; }
    ctx.fillStyle = '#161A22';
    for (let y = L.dpY; y < L.ctlY + L.ctlH; y += 4) {
      if (y >= L.dpY + L.dpH && y < L.ctlY) continue;
      for (let x = L.x0; x < L.x0 + L.usedW; x += 4) if (!occ[Math.round(y / 4) * cw4 + Math.round(x / 4)]) ctx.fillRect(x + 1, y + 1, 1, 1);
    }
    // stage boxes and module outlines"""),
])
patch('floorplan.js', [
("      vec3 base = v_col * 0.22 + vec3(0.018, 0.02, 0.026);", "      vec3 base = v_col * 0.17 + vec3(0.016, 0.018, 0.024);"),
])
print('ok')

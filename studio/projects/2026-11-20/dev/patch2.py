import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

patch('main.js', [("const PREWARM_CYCLES = 700000, PREWARM_CHUNK = 3000;","const PREWARM_CYCLES = 330000, PREWARM_CHUNK = 3000;")])

patch('floorplan.js', [
("  const CROWS = 19;","  const CROWS = 18;"),
("    const dpY = dieY + 48, dpRows = 128, dpH = dpRows * PITCH;\n    const ctlY = dpY + dpH + 22, ctlH = CROWS * PITCH;",
 "    const dpY = dieY + 52, dpRows = 128, dpH = dpRows * PITCH;\n    const ctlY = dpY + dpH + 26, ctlH = CROWS * PITCH;"),
])

patch('panels.js', [
# hierarchy: compact numbers
("    const cols = [['CELLS', 124], ['DFF', 154], ['NAND2', 190], ['DEP', 207], ['TOG/C', 239], ['α%', 265], ['µW', 299], ['COV%', 336]];",
 "    const cols = [['CELLS', 118], ['DFF', 145], ['NAND2', 179], ['DEP', 199], ['TOG/C', 231], ['α%', 258], ['µW', 295], ['COV%', 336]];"),
("      const vals = [fmt.int(cells), dff ? fmt.int(dff) : '·', fmt.int(S.nand[m]), String(S.depth[m]), tg >= 100 ? fmt.int(tg) : tg.toFixed(1), (alpha * 100).toFixed(1), (tg * pw).toFixed(1), sim ? (cov * 100).toFixed(1) : '·'];",
 "      const vals = [String(cells), dff ? String(dff) : '·', String(Math.round(S.nand[m])), String(S.depth[m]), tg >= 100 ? String(Math.round(tg)) : tg.toFixed(1), (alpha * 100).toFixed(1), (tg * pw).toFixed(1), sim ? (cov * 100).toFixed(1) : '·'];"),
# top bar badge
("    ctx.fillStyle = rgba(bc, 0.14); ctx.fillRect(x, 19, 150, 16); box(ctx, x, 19, 150, 16, rgba(bc, 0.7));",
 "    ctx.fillStyle = rgba(bc, 0.14); ctx.fillRect(x, 19, 196, 16); box(ctx, x, 19, 196, 16, rgba(bc, 0.7));"),
("    text(ctx, fmt.int(s.checked) + ' chk', x + 146, 27.5, F.mono(9), rgba(bc, 0.8), 'right');",
 "    text(ctx, fmt.int(s.checked) + ' checked', x + 191, 27.5, F.mono(9), rgba(bc, 0.85), 'right');"),
# controls: no trailing est.
("        text(ctx, 'est.', w - 10, cy, F.mono(9), P.muted, 'right');\n", ""),
# floorplan: fwd routes + tags
("""    const yF1 = L.dpY - 8, yF2 = L.dpY - 14;
    const fx = fwdM.x + fwdM.w / 2;
    route([[xmS.x + xmS.w / 2, L.dpY - 3], [xmS.x + xmS.w / 2, yF1], [fx, yF1], [fx, L.dpY - 3]], P.cyan, 0.25 + 0.75 * Math.min(1, actFrac.fwdXM * 2.5), 1.5);
    route([[mwS.x + mwS.w / 2, L.dpY - 3], [mwS.x + mwS.w / 2, yF2], [fx - 3, yF2], [fx - 3, L.dpY - 3]], P.magenta, 0.25 + 0.75 * Math.min(1, actFrac.fwdMW * 2.5), 1.5);
    text(ctx, `fwd EX/MEM ${(actFrac.fwdXM * 100).toFixed(0)}%`, fx + 6, yF1 - 4, F.mono(8.5), P.cyan);
    text(ctx, `fwd MEM/WB ${(actFrac.fwdMW * 100).toFixed(0)}%`, (fx + xmS.x) / 2 + 30, yF2 - 4, F.mono(8.5), P.magenta);
    const yW = L.dpY + L.dpH + 4;""",
"""    const yF1 = L.dpY - 7, yF2 = L.dpY - 13;
    const fx = fwdM.x + fwdM.w / 2;
    route([[xmS.x + xmS.w / 2, L.dpY - 3], [xmS.x + xmS.w / 2, yF1], [fx, yF1], [fx, L.dpY - 3]], P.cyan, 0.25 + 0.75 * Math.min(1, actFrac.fwdXM * 2.5), 1.5);
    route([[mwS.x + mwS.w / 2, L.dpY - 3], [mwS.x + mwS.w / 2, yF2], [fx - 3, yF2], [fx - 3, L.dpY - 3]], P.magenta, 0.25 + 0.75 * Math.min(1, actFrac.fwdMW * 2.5), 1.5);
    const tagOn = (s1, x, y, col) => { ctx.font = F.mono(8.5); const tw = ctx.measureText(s1).width + 8; ctx.fillStyle = 'rgba(6,7,10,0.95)'; ctx.fillRect(x, y - 5, tw, 10); box(ctx, x, y - 5, tw, 10, rgba(col, 0.6)); text(ctx, s1, x + 4, y + 0.5, F.mono(8.5), col); };
    tagOn(`fwd EX/MEM -> EX ${(actFrac.fwdXM * 100).toFixed(0)}% of cycles`, fx + (xmS.x - fx) * 0.18, yF1, P.cyan);
    tagOn(`fwd MEM/WB -> EX ${(actFrac.fwdMW * 100).toFixed(0)}% of cycles`, fx + (xmS.x - fx) * 0.55, yF2, P.magenta);
    const yW = L.dpY + L.dpH + 10;"""),
("""    const yR = L.ctlY + L.ctlH + 6;""", """    const yR = L.dpY + L.dpH + 4;"""),
("""    route([[bcM.x + bcM.w / 2, L.ctlY + L.ctlH + 1], [bcM.x + bcM.w / 2, yR], [npcM.x + npcM.w / 2, yR], [npcM.x + npcM.w / 2, L.ctlY + L.ctlH + 1]], P.red, 0.25 + 0.75 * Math.min(1, actFrac.flush * 12), 1.5);""",
 """    route([[bcM.x + bcM.w / 2 + 2, L.dpY + L.dpH + 1], [bcM.x + bcM.w / 2 + 2, yR], [npcM.x + npcM.w / 2, yR], [npcM.x + npcM.w / 2, L.dpY + L.dpH + 1]], P.red, 0.25 + 0.75 * Math.min(1, actFrac.flush * 12), 1.5);"""),
("""    const wbl = `write-back x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`;
    ctx.font = F.mono(8.5);
    const wbx = (rfM.x + wbM.x) / 2 - 60;
    ctx.fillStyle = 'rgba(6,7,10,0.9)'; ctx.fillRect(wbx - 3, yW - 5, ctx.measureText(wbl).width + 6, 10);
    text(ctx, wbl, wbx, yW + 0.5, F.mono(8.5), wbOn ? P.green : P.muted);
    const rdl = `pc redirect ${fmt.hex8(pr.exTarget)} · ${s.C.flush.toLocaleString('en-US')} flushes`;
    const rdx = (npcM.x + bcM.x) / 2 - 80;
    ctx.fillStyle = 'rgba(6,7,10,0.92)'; ctx.fillRect(rdx - 3, yR - 5, ctx.measureText(rdl).width + 6, 10);
    text(ctx, rdl, rdx, yR + 0.5, F.mono(8.5), actFrac.flush > 0 ? P.red : P.muted);""",
"""    tagOn(`write-back x${pr.rrd} ${ABI[pr.rrd]} <- ${fmt.hex8(pr.rwd)}`, rfM.x + rfM.w + 30, yW, wbOn ? P.green : P.muted);
    tagOn(`pc redirect -> ${fmt.hex8(pr.exTarget)} · ${s.C.flush.toLocaleString('en-US')} flushes`, (npcM.x + bcM.x) / 2 + 120, yR, actFrac.flush > 0 ? P.red : P.muted);"""),
# instruction labels rows
("      const y = L.dieY + 11 + rowk * 14;", "      const y = L.dieY + 11 + rowk * 15;"),
("      vline(ctx, lx, y + 7, L.dpY - (nm === 'EX' ? 17 : 4), rgba(P.blue, v ? 0.45 : 0.2));", "      vline(ctx, lx, y + 7, L.dpY - 3, rgba(P.blue, v ? 0.45 : 0.2));"),
# crit label in the empty corner of the Dadda block
("""    const clx = Math.min(L.dieX + L.dieW - clw - 8, ex - clw + 40), cly = L.ctlY - 12;""",
 """    const dadM = modx('exu/mul/dadda');
    const clx = dadM.x + dadM.w - clw - 6, cly = L.dpY + 14;"""),
# probe: prefer EX datapath gates
("""      for (let k = D.gateStart - D.dffStart; k < hf.length; k++) if (hf[k] > bv && !(D.mods[D.mod[k + D.dffStart]].path.includes('rf'))) { bv = hf[k]; best = k; }""",
 """      for (let k = D.gateStart - D.dffStart; k < hf.length; k++) { const pth = D.mods[D.mod[k + D.dffStart]].path; if (hf[k] > bv && pth.includes('exu/') && hf[k] < s.n) { bv = hf[k]; best = k; } }"""),
# module names lower in the gap
("    const ny = L.dpY + L.dpH + 11;", "    const ny = L.dpY + L.dpH + 19;"),
# pipeline rows: instances fetched early enough to show their whole life
("""    const ids = [...seen.values()].sort((a, b) => a.id - b.id);
    const rows = ids.slice(-12);""",
 """    const ids = [...seen.values()].sort((a, b) => a.id - b.id);
    const early = ids.filter((r) => Math.min(...r.cells.map((x) => x[0])) <= NC - 5);
    const rows = early.slice(-12);"""),
])
print('ok')

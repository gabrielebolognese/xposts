import sys
p='sim-worker.js'
s=open(p,encoding='utf-8').read()
s=s.replace("const PIPE_N = 24;","const PIPE_N = 16;")
open(p,'w',encoding='utf-8').write(s)
p='panels.js'
s=open(p,encoding='utf-8').read()
def rep(a,b):
    global s
    if a not in s:
        print('MISSING:', a[:80]); sys.exit(1)
    s=s.replace(a,b)
rep("""    frame(ctx, w, h, 'Pipeline', 'occupancy · last 24 cycles', `IPC ${(s.instret / s.cyc).toFixed(3)} · CPI ${(s.cyc / s.instret).toFixed(3)}`);
    const pipe = s.pipe;
    const NC = pipe.length;
    const cx0 = 162, cw = 12.8, y0 = 30;""","""    frame(ctx, w, h, 'Pipeline', `occupancy · last ${s.pipe.length} cycles`, `IPC ${(s.instret / s.cyc).toFixed(3)} · CPI ${(s.cyc / s.instret).toFixed(3)}`);
    const pipe = s.pipe;
    const NC = pipe.length;
    const cx0 = 166, cw = (w - 8 - 166) / NC, y0 = 29;""")
rep("""    // header: cycle numbers
    for (let c = 0; c < NC; c += 4) text(ctx, String(pipe[c][0] % 10000).padStart(4, '0'), cx0 + c * cw + 1, y0 + 2, F.mono(7.5), P.dim);""","""    // header: cycle numbers
    for (let c = 0; c < NC; c += 2) text(ctx, String(pipe[c][0] % 100000), cx0 + c * cw + 1, y0 + 3, F.mono(7.5), P.dim);""")
rep("""        ctx.fillRect(x, y, cw - 1.5, rh - 1.5);
        text(ctx, STL[k], x + (cw - 1.5) / 2, y + 4.6, F.mono(8, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');""","""        ctx.fillRect(x, y, cw - 2, rh - 1.5);
        text(ctx, ['IF', 'ID', 'EX', 'MEM', 'WB'][k], x + (cw - 2) / 2, y + 4.6, F.mono(7.5, 600), squashed ? P.red : stall ? P.warn : STC[k], 'center');""")
rep("""      if (f & 1) { ctx.fillStyle = P.warn; ctx.fillRect(x, yr, cw - 1.5, 2); }
      if (f & 2) { ctx.fillStyle = P.down; ctx.fillRect(x, yr + 3, cw - 1.5, 2); }
      if (f & 4) { ctx.fillStyle = P.cyan; ctx.fillRect(x, yr + 6, cw - 1.5, 2); }
    });
    text(ctx, 'stall', 8, yr + 1, F.mono(7.5), P.warn); text(ctx, 'flush', 34, yr + 4, F.mono(7.5), P.down); text(ctx, 'id redirect', 64, yr + 7, F.mono(7.5), P.cyan);""","""      if (f & 1) { ctx.fillStyle = P.warn; ctx.fillRect(x, yr, cw - 2, 2); }
      if (f & 2) { ctx.fillStyle = P.down; ctx.fillRect(x, yr + 3, cw - 2, 2); }
      if (f & 4) { ctx.fillStyle = P.cyan; ctx.fillRect(x, yr + 6, cw - 2, 2); }
    });
    text(ctx, 'stall', 8, yr + 4, F.mono(8), P.warn); text(ctx, 'flush', 40, yr + 4, F.mono(8), P.down); text(ctx, 'ID redirect', 74, yr + 4, F.mono(8), P.cyan);""")
rep("""    ip.forEach((v, i) => { const x = ix0 + 2 + (i / Math.max(1, ip.length - 1)) * (ix1 - ix0 - 70), y = hy + hh - 2 - (hh - 4) * Math.min(1, v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });""","""    ip.forEach((v, i) => { const x = ix0 + 2 + (i / Math.max(1, ip.length - 1)) * (ix1 - ix0 - 70), y = hy + hh - 2 - (hh - 4) * Math.max(0, Math.min(1, (v - 0.6) / 0.4)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });""")
rep("""    text(ctx, 'IPC', ix1 - 62, hy + 6, F.mono(8), P.muted);""","""    text(ctx, 'IPC per frame · 0.6-1.0 · 10 s', ix0 + 4, hy + 6, F.mono(8), P.muted);""")
a=s.index("    // coverage curve with Wilson band")
b=s.index("    // summary\n    const sy = h - 12;")
new=open('dev/fault_mid.js',encoding='utf-8').read()
s=s[:a]+new+s[b:]
open(p,'w',encoding='utf-8').write(s)
print('patched')

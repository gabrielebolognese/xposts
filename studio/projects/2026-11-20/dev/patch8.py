import sys
p='panels.js'
s=open(p,encoding='utf-8').read()
a=s.index("    CTRL = [\n      { name: 'Clock target'")
b=s.index("    ];\n    const el = cv.controls.c;")
new='''    const S = () => APP.sim, FA = () => APP.fault;
    const pw = () => 0.5 * APP.totTog * c.C * 1e-15 * c.V * c.V * c.f * 1e6 * 1e3;
    CTRL = [
      { name: 'Clock target', kind: 'slider', get: () => c.clockHz / 1000, set: (v) => (c.clockHz = Math.round(v * 1000)), min: 1, max: 60, step: 0.5, range: ['1', '60 kHz'],
        r1: () => (c.clockHz / 1000).toFixed(1) + ' kHz', r2: () => 'measured ' + (APP.hz / 1000).toFixed(2) },
      { name: 'Forwarding unit', kind: 'toggle', get: () => c.fwd, set: (v) => (c.fwd = v), on: 'ON', off: 'OFF',
        r1: () => ((S().C.fwdXM + S().C.fwdMW) / Math.max(1, S().instret)).toFixed(3) + '/instr', r2: () => 'off: stall on RAW' },
      { name: 'Branch predictor', kind: 'seg', opts: ['NOT-TAKEN', 'BTFN'], get: () => c.btfn, set: (v) => (c.btfn = v),
        r1: () => (S().C.br ? fmt.pct(1 - S().C.misp / S().C.br, 2) : '-'), r2: () => 'accuracy' },
      { name: 'MAXIT', kind: 'num', get: () => c.maxit, set: (v) => (c.maxit = v), min: 8, max: 64, step: 4, val: (v) => String(v), range: '8-64',
        r1: () => String(S().params[4]), r2: () => 'RAM 0x0001_0010' },
      { name: 'Zoom per frame', kind: 'knob', get: () => c.zoom, set: (v) => (c.zoom = v), min: 1.25, max: 4, step: 0.25, range: '×1.25-×4.0',
        r1: () => '×' + c.zoom.toFixed(2), r2: () => 'next w ' + (((S().params[2] / PROG.Q) * 48 * S().params[3]) / PROG.Q).toFixed(4) },
      { name: 'Golden lockstep', kind: 'toggle', get: () => c.lockstep, set: (v) => (c.lockstep = v), on: 'ON', off: 'OFF',
        r1: () => fmt.si(S().checked, 2).trim(), r2: () => `checked · ${S().div} div` },
      { name: 'Fault model', kind: 'pair', opts: ['SA0', 'SA1'], get: () => [c.sa0, c.sa1], set: (k) => { if (k === 0) c.sa0 ^= 1; else c.sa1 ^= 1; if (!c.sa0 && !c.sa1) c.sa0 = c.sa1 = 1; },
        r1: () => (c.sa0 && c.sa1 ? 'both' : c.sa0 ? 'SA0' : 'SA1'), r2: () => fmt.int(FA().universe) + ' faults' },
      { name: 'Fault workers', kind: 'slider', get: () => c.workers, set: (v) => APP.setWorkers(Math.round(v)), min: 1, max: 12, step: 1, range: ['1', '12'],
        r1: () => String(c.workers), r2: () => '64 cyc/frame each' },
      { name: 'Test length', kind: 'num', get: () => c.testLen, set: (v) => (c.testLen = v), min: 512, max: 16384, step: 512, val: (v) => v + ' cyc', range: '512-16384',
        r1: () => '#' + FA().batchSeq, r2: () => 'batches issued' },
      { name: 'Process (power est.)', kind: 'fields', r1: () => pw().toFixed(3) + ' mW', r2: () => '½·tog·C·V²·f' },
      { name: 'Heat decay', kind: 'slider', get: () => c.decay, set: (v) => (c.decay = v), min: 0.8, max: 0.99, step: 0.01, range: ['0.80', '0.99'],
        r1: () => c.decay.toFixed(2), r2: () => 'half-life ' + (Math.log(0.5) / Math.log(c.decay) / 60).toFixed(2) + ' s' },
'''
s=s[:a]+new+s[b:]
pairs=[
("""        text(ctx, ct.val(v), w - 10, cy - (ct.extra ? 4 : 0), F.mono(10.5, 600), P.active, 'right');
        if (ct.extra) text(ctx, ct.extra(), w - 10, cy + 8, F.mono(8.5), P.muted, 'right');
""", ""),
("""        text(ctx, ct.hint, w - 10, cy, F.mono(8.5), P.muted, 'right');
""", ""),
("""        const vs = ct.kind === 'seg' ? ct.opts[sel] : sel[0] && sel[1] ? 'both' : sel[0] ? 'SA0' : 'SA1';
        text(ctx, vs, w - 10, cy, F.mono(10.5, 600), P.active, 'right');
""", ""),
("""        text(ctx, ct.range, X0 + 26, cy, F.mono(8.5), P.dim);
        text(ctx, ct.val(v), w - 10, cy, F.mono(10.5, 600), P.active, 'right');""", """        text(ctx, ct.range, X0 + 26, cy, F.mono(8.5), P.dim);"""),
("""          fx += a === 'f' ? 0 : a === 'C' ? 70 : 62;
        }
      }
    });""", """          fx += a === 'f' ? 0 : a === 'C' ? 70 : 62;
        }
      }
      if (ct.r1 && APP.sim) {
        text(ctx, ct.r1(), w - 10, cy - 4, F.mono(10, 600), P.active, 'right');
        text(ctx, ct.r2(), w - 10, cy + 8, F.mono(8), P.muted, 'right');
      }
    });"""),
("    const ny = L.dpY + L.dpH + 19;", "    const ny = L.dpY + L.dpH + 20.5;"),
]
for x,y in pairs:
    if x not in s: print('MISSING', x[:70]); sys.exit(1)
    s=s.replace(x,y)
open(p,'w',encoding='utf-8').write(s)
print('ok')

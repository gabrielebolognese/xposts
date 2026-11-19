import io
p = 'plant.js'
s = io.open(p, encoding='utf8').read()


def rep(old, new):
    global s
    assert old in s, old[:90]
    s = s.replace(old, new)


# kinetics trace also returns the precursor inventories at the end of the window
rep("""      if (n % every === 0) out[n / every] = P;
    }
    return out;""", """      if (n % every === 0) out[n / every] = P;
    }
    const c0 = LAM.map((l, i) => BETA[i] / (l * GEN));
    return { trace: out, cEnd: Cq.map((c, i) => c / c0[i]), pEnd: P };""")
rep("""        jump: BT / (BT - rho), trace: S.fast ? null : kineticsTrace(rho),
      };""", """        jump: BT / (BT - rho), trace: null, cEnd: null, pEnd: null,
      };
      if (!S.fast) {
        const kt = kineticsTrace(rho);
        S.kin.trace = kt.trace;
        S.kin.cEnd = kt.cEnd;
        S.kin.pEnd = kt.pEnd;
      }""")
# dropped-rod worth: paired solve with the rod back at the bank position (Tf frozen)
rep("""    function measureMTC() {""", """    function measureDropWorth() {
      const r = paired('drop', () => (M.dropped[S.dropRod] = 0), () => (M.dropped[S.dropRod] = 1), true, 'plain');
      S.dropWorth = (1 / r.k1 - 1 / r.k0) * 1e5;
      return r;
    }
    function measureMTC() {""")
rep("""      let s = runSolve(true, 'step');
      let rho = pcm(s.k);
      for (let mv = 0;""", """      let s = runSolve(true, 'step');
      let rho = pcm(s.k);
      if (events.drop) {
        measureDropWorth();
        const r = rods[S.dropRod];
        log('meas', `${r.name} ${COLS[r.ac]}${r.ar + 1} drop worth ${S.dropWorth.toFixed(0)} pcm (paired solve)`);
      }
      for (let mv = 0;""")
rep("""        const which = S.measureIdx++ % 4;""", """        const which = S.measureIdx++ % (S.dropped ? 5 : 4);""")
rep("""        } else {
          measurePD();
          log('meas', `power defect 0→100% ${S.pdef.toFixed(0)} pcm`);
        }""", """        } else if (which === 3) {
          measurePD();
          log('meas', `power defect 0→100% ${S.pdef.toFixed(0)} pcm`);
        } else {
          measureDropWorth();
          log('meas', `dropped rod worth ${S.dropWorth.toFixed(0)} pcm`);
        }""")
# tech-spec alarms (no protective action in this run: labelled)
rep("""      if (S.dropped && !S.qptrAlarm && S.qptr > 1.02) {
        S.qptrAlarm = true;
        log('alarm', `QPTR ${S.qptr.toFixed(4)} > 1.02 TECH-SPEC LIMIT`);
      }""", """      if (S.dropped && S.qptr > 1.02) {
        const band = Math.floor((S.qptr - 1) * 10); // a new alarm line for every +0.1 of tilt
        if (!S.qptrAlarm) {
          S.qptrAlarm = true;
          S.qptrBand = band;
          log('alarm', `TS QPTR ${S.qptr.toFixed(4)} > 1.02 \\u00b7 ACTION: REDUCE POWER`);
          log('ctrl', 'operator action not modelled (demo run)');
        } else if (band > S.qptrBand) {
          S.qptrBand = band;
          log('alarm', `TS QPTR ${S.qptr.toFixed(2)} \\u00b7 REDUCE POWER (not modelled)`);
        }
      }""")
rep("""        tm: M.Tm, tf: S.tfMean, tfMax: S.tfMax, dc: S.dc, pd: S.pdef, mtc: S.mtc, bw: S.bw, dw: S.dw,""", """        tm: M.Tm, tf: S.tfMean, tfMax: S.tfMax, dc: S.dc, pd: S.pdef, mtc: S.mtc, bw: S.bw, dw: S.dw,
        dropWorth: S.dropped ? S.dropWorth : 0,""")
rep("""      kNoXe: 1,""", """      kNoXe: 1, dropWorth: 0, qptrBand: 0,""")
io.open(p, 'w', encoding='utf8').write(s)
print('ok')

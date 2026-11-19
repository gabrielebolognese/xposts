// Xenon Night: the diffusion worker. Owns the core model and the plant. Messages:
//   {type:'boot'}            benchmark, operating state, equilibrium xenon, critical boron, calibration
//   {type:'step', dt, full}  one macro step of dt sim-minutes (full: send the field maps)
//   {type:'mat'}             material snapshot for the Monte Carlo
importScripts('core.js', 'plant.js');
const C = self.CORE, P = self.PLANT;
const FUEL_SCALE = 1.04;
let S = null;
const NN = C.N * C.N;

function fields() {
  const M = S.M;
  const f = { phi1: new Float32Array(NN), phi2: new Float32Array(NN), pow: new Float32Array(NN), xe: new Float32Array(NN), io: new Float32Array(NN), tf: new Float32Array(NN) };
  let ps = 0;
  for (const c of C.FUEL) ps += M.NSF[c] * M.phi2[c];
  const pm = ps / C.FUEL.length || 1;
  for (const c of C.ACT) {
    const j = ((c / C.NP) | 0) - 1, i = (c % C.NP) - 1, u = j * C.N + i;
    f.phi1[u] = M.phi1[c];
    f.phi2[u] = M.phi2[c];
    f.pow[u] = (M.NSF[c] * M.phi2[c]) / pm;
    f.xe[u] = M.X[c];
    f.io[u] = M.I[c];
    f.tf[u] = C.cmat[c] !== 4 ? M.Tf[c] : 0;
  }
  return f;
}

function snapshot(full) {
  const L = S.lastSolve;
  const out = {
    t: S.t, rec: S.record(), logs: S.logs.splice(0), asm: Float32Array.from(S.asmPow),
    solve: L ? { k: L.k, outers: L.outers, res: L.res, dr: L.dr, ms: L.ms, label: L.label, sweeps: L.sweeps, t: L.t,
      hres: Float32Array.from(L.hist.res), hk: Float64Array.from(L.hist.k), hdr: Float32Array.from(L.hist.dr) } : null,
    kin: S.kin, prec: S.prec.slice(), solves: S.solves, outersTotal: S.outersTotal, stepMs: S.stepMs,
    dropped: S.dropped, rodSteps: S.M.steps, kNoXe: S.kNoXe,
  };
  S.kin = null;
  if (full) out.f = fields();
  return out;
}

function material() {
  const m = S.M.mcMaterial();
  m.t = S.t;
  m.k = S.k;
  return m;
}

onmessage = (e) => {
  const d = e.data;
  if (d.type === 'boot') {
    S = P.createPlant({ fuelScale: FUEL_SCALE });
    const t0 = performance.now();
    S.boot();
    const out = snapshot(true);
    out.type = 'boot';
    out.bench = S.bench;
    out.bankWorth = S.bankWorth;
    out.ppmEq = S.ppmEq;
    out.xeEq = S.xeEq;
    out.bootMs = performance.now() - t0;
    out.fuelScale = FUEL_SCALE;
    out.mat = material();
    out.rods = C.rods.map((r) => ({ ac: r.ac, ar: r.ar, name: r.name }));
    out.dropRod = S.dropRod;
    out.dropAt = S.dropAt;
    out.aD = S.M.aD;
    out.aM = S.M.aM;
    postMessage(out);
  } else if (d.type === 'step') {
    S.fast = !!d.fast;
    S.step(d.dt);
    const out = snapshot(d.full);
    out.type = 'step';
    out.fast = S.fast;
    if (d.mat) out.mat = material();
    postMessage(out);
  }
};

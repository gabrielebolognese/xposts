// Reentry: procedural four-chamber long-axis slice on a 512 x 512 grid (cell units, x right, y down).
// Builds the tissue fields (type, D, epsilon factor), face conductances (harmonic means), landmarks, the
// endocardial contours for the Purkinje tree and the loop around the scar used for the anchored-rotor winding number.
(function () {
  const RE = (window.RE = window.RE || {});
  const N = 512;
  const T = { OUT: 0, BLOOD: 1, RA: 2, LA: 3, ANN: 4, AVN: 5, HIS: 6, MYO: 7, BZ: 8, SCAR: 9, INS: 10 };
  RE.N = N;
  RE.T = T;
  const deg = Math.PI / 180;

  // exact Euclidean distance transform (Felzenszwalb and Huttenlocher), distance to the nearest feature cell
  function edt(feature) {
    const INF = 1e12;
    const f = new Float64Array(N * N);
    for (let i = 0; i < N * N; i++) f[i] = feature[i] ? 0 : INF;
    const d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1), g = new Float64Array(N);
    const pass = (get, set) => {
      for (let q = 0; q < N; q++) g[q] = get(q);
      let k = 0;
      v[0] = 0;
      z[0] = -INF;
      z[1] = INF;
      for (let q = 1; q < N; q++) {
        let s;
        for (;;) {
          const p = v[k];
          s = (g[q] + q * q - (g[p] + p * p)) / (2 * q - 2 * p);
          if (s <= z[k]) k--;
          else break;
        }
        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < N; q++) {
        while (z[k + 1] < q) k++;
        const p = v[k];
        d[q] = (q - p) * (q - p) + g[p];
      }
      for (let q = 0; q < N; q++) set(q, d[q]);
    };
    for (let x = 0; x < N; x++) pass((q) => f[q * N + x], (q, val) => (f[q * N + x] = val));
    for (let y = 0; y < N; y++) pass((q) => f[y * N + q], (q, val) => (f[y * N + q] = val));
    const out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = Math.sqrt(f[i]);
    return out;
  }

  // heart frame: u across (to the patient's left = image right), w along the long axis toward the apex
  function frame(P) {
    const cs = Math.cos(P.tilt), sn = Math.sin(P.tilt);
    return {
      toImg: (u, w) => ({ x: P.ox + u * cs + w * sn, y: P.oy - u * sn + w * cs }),
      toHeart: (x, y) => {
        const dx = x - P.ox, dy = y - P.oy;
        return { u: dx * cs - dy * sn, w: dx * sn + dy * cs };
      },
    };
  }
  // egg-shaped cavity in the heart frame: ellipse whose width tapers toward the apex end
  function egg(c, F) {
    const cs = Math.cos(c.rot || 0), sn = Math.sin(c.rot || 0);
    return (x, y) => {
      const h = F.toHeart(x, y);
      const du = h.u - c.u, dw = h.w - c.w;
      const ur = du * cs - dw * sn, wr = du * sn + dw * cs;
      const a = c.a * (1 - (c.taper || 0) * Math.max(-1, Math.min(1, wr / c.b)));
      return (ur / a) * (ur / a) + (wr / c.b) * (wr / c.b);
    };
  }

  RE.defaultAnatomy = () => ({
    ox: 238, oy: 186, tilt: 16 * deg, ann: 3,
    lv: { u: 60, w: 112, a: 56, b: 124, rot: 0, taper: 0.26 }, lvWall: 26,
    rv: { u: -52, w: 92, a: 76, b: 108, rot: 6 * deg, taper: 0.1 }, rvWall: 13, septum: 27,
    ra: { u: -74, w: -44, a: 64, b: 80, rot: -0.12 }, la: { u: 70, w: -48, a: 60, b: 82, rot: 0.1 }, atWall: 8, atSeptum: 26,
    // infarct on the LV lateral wall: wall-frame window (angle around the LV centre, transmural depth from the endocardium)
    infarct: { ang0: 100, ang1: 120, tau0: 10, tau1: 16, bz: 3, isthmusAng: 110, isthmusW: 0 },
    D: { myo: 1.0, bz: 0.25, avn: 0.08, atria: 1.0, his: 1.0 },
    hEpi: 1.35, rvTau: 0.5, hAtria: 1.5, bzEps: 1.2, avnLen: 0, avEntry: 9, hisW: 7.5, insR: 6.5,
  });

  RE.buildAnatomy = function (P) {
    const n = N * N;
    const type = new Uint8Array(n);
    const F = frame(P);
    const lvIn = egg(P.lv, F), rvIn = egg(P.rv, F), raIn = egg(P.ra, F), laIn = egg(P.la, F);
    const W = new Float32Array(n); // long-axis coordinate of every cell
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) W[y * N + x] = F.toHeart(x, y).w;
    const lvCav = new Uint8Array(n), rvEll = new Uint8Array(n), raCav = new Uint8Array(n), laCav = new Uint8Array(n);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (lvIn(x, y) < 1) lvCav[i] = 1;
        if (rvIn(x, y) < 1) rvEll[i] = 1;
        if (raIn(x, y) < 1) raCav[i] = 1;
        if (laIn(x, y) < 1) laCav[i] = 1;
      }
    const dLV = edt(lvCav);
    const rvCav = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (rvEll[i] && dLV[i] > P.septum && !lvCav[i]) rvCav[i] = 1;
    const dRV = edt(rvCav), dRA = edt(raCav), dLA = edt(laCav);
    const ann = P.ann;
    const tau = new Float32Array(n); // transmural coordinate 0 endo .. 1 epi (ventricles)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const ventTissue = !lvCav[i] && !rvCav[i] && (dLV[i] <= P.lvWall || dRV[i] <= P.rvWall);
        const atTissue = !raCav[i] && !laCav[i] && (dRA[i] <= P.atWall || dLA[i] <= P.atWall || dRA[i] + dLA[i] <= P.atSeptum + Math.max(0, W[i] + 30));
        const w = W[i];
        if (w > ann) {
          if (lvCav[i] || rvCav[i]) type[i] = T.BLOOD;
          else if (dLV[i] <= P.lvWall) {
            type[i] = T.MYO;
            tau[i] = Math.min(1, dLV[i] / P.lvWall);
          } else if (dRV[i] <= P.rvWall) {
            type[i] = T.MYO;
            tau[i] = Math.min(1, dRV[i] / P.rvWall) * P.rvTau;
          }
        } else if (w < -ann) {
          if (raCav[i] || laCav[i]) type[i] = T.BLOOD;
          else if (atTissue) type[i] = dRA[i] <= dLA[i] ? T.RA : T.LA;
        } else {
          if (lvCav[i] || rvCav[i] || raCav[i] || laCav[i]) type[i] = T.BLOOD;
          else if (ventTissue || atTissue) type[i] = T.ANN;
        }
      }

    // landmarks: septum centres along lines of constant w (heart frame)
    const at = (u, w, arr) => {
      const p = F.toImg(u, w);
      const x = Math.round(p.x), y = Math.round(p.y);
      return x >= 0 && y >= 0 && x < N && y < N ? arr[y * N + x] : 0;
    };
    const septumU = (w, left, right) => {
      let lr = -1e9, rl = 1e9;
      for (let u = -160; u <= 160; u += 0.5) {
        if (at(u, w, left)) lr = Math.max(lr, u);
        if (at(u, w, right)) rl = Math.min(rl, u);
      }
      return (lr + rl) / 2;
    };
    const uA = septumU(-P.avEntry, raCav, laCav), uH = septumU(P.hisW, rvCav, lvCav);
    const avA = F.toImg(uA, -P.avEntry);
    const hisC = F.toImg(uH, P.hisW);
    // insulation (central fibrous body) around the His pocket, then the AV node bridge and the pocket itself
    const segDist = (x, y, a, b) => {
      const vx = b.x - a.x, vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)));
      return Math.hypot(x - a.x - t * vx, y - a.y - t * vy);
    };
    const avB = F.toImg(uH, P.hisW - 3);
    for (let y = Math.floor(hisC.y - 40); y < hisC.y + 30; y++)
      for (let x = Math.floor(hisC.x - 30); x < hisC.x + 30; x++) {
        const i = y * N + x;
        const w = W[i];
        const dh = Math.hypot(x - hisC.x, y - hisC.y);
        const db = segDist(x, y, avA, avB);
        if (type[i] !== T.OUT && type[i] !== T.BLOOD && w > -ann && (dh < P.insR || db < 6.5)) type[i] = T.INS;
        if (db < 2.6 && type[i] !== T.BLOOD) type[i] = w > -P.avnLen ? T.AVN : T.RA;
        if (dh < 3.2) type[i] = T.HIS;
      }

    // infarct: angle around the LV centre measured from the apex direction toward the lateral side
    const lv = P.lv;
    const lvAngle = (x, y) => {
      const h = F.toHeart(x, y);
      return Math.atan2(h.u - lv.u, h.w - lv.w) / deg; // 0 at apex, +90 lateral, 180 base
    };
    const lvR = (x, y) => {
      const h = F.toHeart(x, y);
      return Math.hypot(h.u - lv.u, h.w - lv.w);
    };
    const inf = P.infarct;
    const scar = new Uint8Array(n);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (type[i] !== T.MYO || W[i] < ann) continue;
        const d = dLV[i];
        if (d > P.lvWall + 0.5) continue;
        const ang = lvAngle(x, y), r = lvR(x, y);
        const arc0 = (inf.ang0 - ang) * deg * r, arc1 = (ang - inf.ang1) * deg * r;
        const half = (inf.tau1 - inf.tau0) / 2, mid = (inf.tau0 + inf.tau1) / 2;
        const ex = Math.max(arc0, arc1);
        const inside = ex <= 0 ? Math.abs(d - mid) <= half : Math.hypot(ex, d - mid) <= half;
        if (!inside) continue;
        if (inf.isthmusW > 0 && Math.abs((ang - inf.isthmusAng) * deg * r) < inf.isthmusW / 2) continue; // surviving isthmus
        scar[i] = 1;
      }
    const dScar = edt(scar);
    for (let i = 0; i < n; i++) {
      if (type[i] !== T.MYO) continue;
      if (scar[i]) type[i] = T.SCAR;
      else if (dScar[i] <= inf.bz) type[i] = T.BZ;
    }

    // per-cell conductivity and epsilon factor
    const D = new Float32Array(n), eps = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = type[i];
      if (t === T.RA || t === T.LA) {
        D[i] = P.D.atria;
        eps[i] = P.hAtria;
      } else if (t === T.AVN) {
        D[i] = P.D.avn;
        eps[i] = 1.0;
      } else if (t === T.HIS) {
        D[i] = P.D.his;
        eps[i] = 1.0;
      } else if (t === T.MYO || t === T.BZ) {
        const h = 1 + (P.hEpi - 1) * tau[i];
        D[i] = t === T.BZ ? P.D.bz : P.D.myo;
        eps[i] = h * (t === T.BZ ? P.bzEps : 1);
      }
    }
    // face conductances: harmonic mean of the two cells (0 if either is 0, so scar and the outside are no-flux)
    const faces = new Float32Array(n * 4); // E, W, S(y+1), N(y-1)
    const hm = (a, b) => (a > 0 && b > 0 ? (2 * a * b) / (a + b) : 0);
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        if (!(D[i] > 0)) continue;
        faces[i * 4] = hm(D[i], D[i + 1]);
        faces[i * 4 + 1] = hm(D[i], D[i - 1]);
        faces[i * 4 + 2] = hm(D[i], D[i + N]);
        faces[i * 4 + 3] = hm(D[i], D[i - N]);
      }

    // endocardial contours (tissue cells touching each ventricular cavity), ordered by angle around the cavity centre
    const contour = (cav, c) => {
      const pts = [];
      for (let y = 1; y < N - 1; y++)
        for (let x = 1; x < N - 1; x++) {
          const i = y * N + x;
          const t = type[i];
          if (W[i] < ann + 2) continue;
          if (t !== T.MYO && t !== T.BZ && t !== T.SCAR) continue;
          if (cav[i + 1] || cav[i - 1] || cav[i + N] || cav[i - N]) {
            const h = F.toHeart(x, y);
            pts.push({ x, y, ang: Math.atan2(h.u - c.u, h.w - c.w) / deg, t });
          }
        }
      pts.sort((a, b) => a.ang - b.ang);
      return pts;
    };
    const lvEndo = contour(lvCav, P.lv), rvEndo = contour(rvCav, P.rv);

    // ordered loop through the border zone around the scar (for the anchored-rotor winding number)
    const loop = [];
    {
      let sx = 0, sy = 0, cnt = 0;
      for (let i = 0; i < n; i++) if (scar[i]) { sx += i % N; sy += (i / N) | 0; cnt++; }
      const cx = sx / Math.max(1, cnt), cy = sy / Math.max(1, cnt);
      const cand = [];
      for (let i = 0; i < n; i++) {
        if (type[i] !== T.BZ && type[i] !== T.MYO) continue;
        if (Math.abs(dScar[i] - (inf.bz - 1.5)) < 0.75) {
          const x = i % N, y = (i / N) | 0;
          cand.push({ x, y, a: Math.atan2(y - cy, x - cx) });
        }
      }
      cand.sort((a, b) => a.a - b.a);
      const want = 96;
      for (let k = 0; k < want && cand.length; k++) loop.push(cand[Math.floor((k * cand.length) / want)]);
      loop.center = { x: cx, y: cy };
    }

    // counts
    let tissue = 0, vent = 0;
    for (let i = 0; i < n; i++) {
      if (D[i] > 0) tissue++;
      if (type[i] === T.MYO || type[i] === T.BZ) vent++;
    }
    return { P, F, W, type, D, eps, faces, tau, dLV, dRV, dScar, lvCav, rvCav, raCav, laCav, scar, lvEndo, rvEndo, loop, avA, avB, hisC, tissue, vent, lvAngle };
  };
})();

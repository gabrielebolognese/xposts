// Xenon Night: 2D two-group Monte Carlo neutron transport on the diffusion mesh (one of 6 workers, or node tests).
// Sigma_t,g = 1/(3 D_g). Collision: absorption (Sa_g + D_g B^2)/St (buckling leakage as absorption), downscatter
// S12/St in group 1, otherwise isotropic scattering. Directions sampled in 3D, flights projected on x-y.
// Woodcock delta tracking with a majorant per group. Collision estimator k = sum nuSf2/St / N. Fission sites banked.
(function (root) {
  'use strict';
  const N = 136, H = 2.5, L = N * H, IH = 1 / H;

  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createMC() {
    const mat = { ok: false };
    // cell arrays (unpadded, c = j * N + i): St1, St2, cumulative probabilities, score per collision
    const St1 = new Float32Array(N * N), St2 = new Float32Array(N * N);
    const pa1 = new Float32Array(N * N), pd1 = new Float32Array(N * N), pa2 = new Float32Array(N * N);
    const sc2 = new Float32Array(N * N);
    const live = new Uint8Array(N * N);
    let maj1 = 0, maj2 = 0;

    // m = {D1, D2, S12, A1, A2, NSF (Float64Array N*N, 0 outside), B2}
    function setMaterial(m) {
      maj1 = 0;
      maj2 = 0;
      for (let c = 0; c < N * N; c++) {
        if (!(m.D1[c] > 0)) {
          live[c] = 0;
          St1[c] = St2[c] = 0;
          continue;
        }
        live[c] = 1;
        const s1 = 1 / (3 * m.D1[c]), s2 = 1 / (3 * m.D2[c]);
        St1[c] = s1;
        St2[c] = s2;
        pa1[c] = (m.A1[c] + m.D1[c] * m.B2) / s1;
        pd1[c] = pa1[c] + m.S12[c] / s1;
        pa2[c] = (m.A2[c] + m.D2[c] * m.B2) / s2;
        sc2[c] = m.NSF[c] / s2;
        if (s1 > maj1) maj1 = s1;
        if (s2 > maj2) maj2 = s2;
      }
      mat.ok = true;
    }

    // one share of a generation. sites: Float32Array [x, y, ...]; returns tallies, bank, tracks.
    // The mulberry32 generator and the direction sampling are written inline (no closures in the hot loop).
    function run(sites, n, seed, kPrev, nTracks) {
      let ra = seed | 0, tq = 0, u = 0, v = 0, w = 0, r2 = 0;
      let bank = new Float32Array(Math.max(64, Math.ceil(n * 2.6)));
      let nb = 0;
      let score = 0, coll = 0, flights = 0, leak = 0, abs1 = 0, abs2 = 0, down = 0;
      const tracks = [];
      const ik = 1 / kPrev;
      const im1 = 1 / maj1, im2 = 1 / maj2;
      for (let h = 0; h < n; h++) {
        let x = sites[2 * h], y = sites[2 * h + 1];
        let g = 1, im = im1, maj = maj1;
        const keep = h < nTracks;
        const tr = keep ? [x, y, 1] : null;
        let dx = 0, dy = 0;
        // isotropic 3D direction projected on x-y: |d| = sin(theta), azimuth from a point in the unit disc
        ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); w = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
        w = 2 * w - 1;
        let st = Math.sqrt(1 - w * w);
        do {
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); u = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); v = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
          u = 2 * u - 1;
          v = 2 * v - 1;
          r2 = u * u + v * v;
        } while (r2 > 1 || r2 < 1e-12);
        st /= r2;
        dx = (u * u - v * v) * st;
        dy = 2 * u * v * st;
        for (;;) {
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); u = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
          const s = -Math.log(1 - u) * im;
          x += s * dx;
          y += s * dy;
          flights++;
          if (x < 0 || y < 0 || x >= L || y >= L) {
            leak++;
            if (keep) tr.push(x, y, g);
            break;
          }
          const c = ((y * IH) | 0) * N + ((x * IH) | 0);
          if (live[c] === 0) {
            leak++;
            if (keep) tr.push(x, y, g);
            break;
          }
          // delta tracking: real collision with probability St / majorant
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); u = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
          if (u * maj >= (g === 1 ? St1[c] : St2[c])) continue;
          coll++;
          if (keep) tr.push(x, y, g);
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); u = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
          if (g === 1) {
            if (u < pa1[c]) {
              abs1++;
              break;
            }
            if (u < pd1[c]) {
              g = 2;
              im = im2;
              maj = maj2;
              down++;
            }
          } else {
            const f = sc2[c];
            if (f > 0) {
              score += f;
              ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); v = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
              let nf = (f * ik + v) | 0;
              while (nf-- > 0) {
                if (nb + 2 > bank.length) {
                  const b2 = new Float32Array(bank.length * 2);
                  b2.set(bank);
                  bank = b2;
                }
                bank[nb++] = x;
                bank[nb++] = y;
              }
            }
            if (u < pa2[c]) {
              abs2++;
              break;
            }
          }
          // isotropic re-emission
          ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); w = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
        w = 2 * w - 1;
          st = Math.sqrt(1 - w * w);
          do {
            ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); u = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
            ra = (ra + 0x6d2b79f5) | 0; tq = Math.imul(ra ^ (ra >>> 15), ra | 1); tq ^= tq + Math.imul(tq ^ (tq >>> 7), tq | 61); v = ((tq ^ (tq >>> 14)) >>> 0) * 2.3283064365386963e-10;
            u = 2 * u - 1;
            v = 2 * v - 1;
            r2 = u * u + v * v;
          } while (r2 > 1 || r2 < 1e-12);
          st /= r2;
          dx = (u * u - v * v) * st;
          dy = 2 * u * v * st;
        }
        if (keep) tracks.push(Float32Array.from(tr));
      }
      return { score, n, coll, flights, leak, abs1, abs2, down, bank: bank.slice(0, nb), tracks };
    }
    return { setMaterial, run, mat };
  }

  root.MCK = { createMC, rngFrom, N, H, L };
})(typeof self !== 'undefined' ? self : globalThis);

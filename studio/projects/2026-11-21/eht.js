// Virtual EHT: 2017 stations, Earth-rotation uv tracks for Sgr A*, elevation limits. Shared by the page and the dev tests.
(function (G) {
  const E = {};
  E.stations = [
    { id: 'ALMA', x: 2225061.2, y: -5440057.4, z: -2481681.2 },
    { id: 'APEX', x: 2225039.5, y: -5441197.6, z: -2479303.4 },
    { id: 'SMT', x: -1828796.2, y: -5054406.8, z: 3427865.2 },
    { id: 'JCMT', x: -5464584.7, y: -2493001.2, z: 2150654.0 },
    { id: 'SMA', x: -5464555.5, y: -2492928.0, z: 2150797.2 },
    { id: 'LMT', x: -768715.6, y: -5988507.1, z: 2063354.9 },
    { id: 'PV', x: 5088967.8, y: -301681.2, z: 3825012.2 },
    { id: 'SPT', x: 809.8, y: -816.9, z: -6359568.7 },
  ];
  // geodetic normal (WGS84) of each station
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
  for (const s of E.stations) {
    const p = Math.hypot(s.x, s.y), lon = Math.atan2(s.y, s.x);
    let lat = Math.atan2(s.z, p * (1 - E2));
    for (let i = 0; i < 6; i++) {
      const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
      lat = Math.atan2(s.z + E2 * N * Math.sin(lat), p);
    }
    s.lat = lat; s.lon = lon;
    s.n = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }
  E.baselines = [];
  for (let i = 0; i < E.stations.length; i++)
    for (let j = i + 1; j < E.stations.length; j++) {
      const a = E.stations[i], b = E.stations[j];
      const B = [b.x - a.x, b.y - a.y, b.z - a.z];
      E.baselines.push({ i, j, name: a.id + '-' + b.id, B, len: Math.hypot(...B) });
    }
  E.ra = ((17 + 45 / 60 + 40.04 / 3600) * 15 * Math.PI) / 180;
  E.dec = (-29.0078 * Math.PI) / 180;

  // Julian date from a UT Date-like ms timestamp, GMST in radians
  E.jd = (ms) => ms / 86400000 + 2440587.5;
  E.gmst = (ms) => {
    const D = E.jd(ms) - 2451545.0;
    const h = 18.697374558 + 24.06570982441908 * D;
    return ((((h % 24) + 24) % 24) * Math.PI) / 12;
  };
  // source elevation (rad) at a station for Greenwich hour angle H
  E.elev = (s, H) => {
    const cd = Math.cos(E.dec);
    const v = [cd * Math.cos(H), -cd * Math.sin(H), Math.sin(E.dec)];
    return Math.asin(v[0] * s.n[0] + v[1] * s.n[1] + v[2] * s.n[2]);
  };
  // u, v in wavelengths
  E.uv = (B, H, lam) => {
    const sH = Math.sin(H), cH = Math.cos(H), sd = Math.sin(E.dec), cd = Math.cos(E.dec);
    return [(sH * B[0] + cH * B[1]) / lam, (-sd * cH * B[0] + sd * sH * B[1] + cd * B[2]) / lam];
  };
  // all baselines up at time ms with elevation limit (rad): [{k, u, v}]
  E.snapshot = (ms, lam, elLim) => {
    const H = E.gmst(ms) - E.ra;
    const el = E.stations.map((s) => E.elev(s, H));
    const out = [];
    E.baselines.forEach((b, k) => {
      if (el[b.i] > elLim && el[b.j] > elLim) {
        const [u, v] = E.uv(b.B, H, lam);
        out.push({ k, u, v });
      }
    });
    return { H, el, up: out };
  };


  // ---- DFT (separable phase factors by angle-addition recurrences), image 96 x 96, l = l0 + x dl, m = m0 + y dm (rad)
  const N = 96, TWO_PI = 2 * Math.PI;
  E.N = N;
  function phases(f, x0, dx, n, c, s) {
    const a0 = TWO_PI * f * x0, d = TWO_PI * f * dx;
    const cd = Math.cos(d), sd = Math.sin(d);
    let cr = Math.cos(a0), sr = Math.sin(a0);
    for (let j = 0; j < n; j++) {
      c[j] = cr; s[j] = sr;
      const t = cr * cd - sr * sd;
      sr = sr * cd + cr * sd; cr = t;
      if ((j & 31) === 31) { const a = a0 + (j + 1) * d; cr = Math.cos(a); sr = Math.sin(a); }
    }
  }
  const cl = new Float64Array(N), sl = new Float64Array(N), cm = new Float64Array(N), sm = new Float64Array(N);
  // V(u, v) = sum I(l, m) exp(-2 pi i (u l + v m)); uv = [u0, v0, u1, v1, ...] in wavelengths
  E.vis = (img, ax, uv) => {
    const n = uv.length >> 1, re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      phases(uv[2 * k], ax.l0, ax.dl, N, cl, sl);
      phases(uv[2 * k + 1], ax.m0, ax.dm, N, cm, sm);
      let R = 0, I = 0;
      for (let y = 0; y < N; y++) {
        let ar = 0, ai = 0;
        const o = y * N;
        for (let x = 0; x < N; x++) { const p = img[o + x]; ar += p * cl[x]; ai -= p * sl[x]; }
        R += ar * cm[y] + ai * sm[y];
        I += ai * cm[y] - ar * sm[y];
      }
      re[k] = R; im[k] = I;
    }
    return { re, im };
  };
  // rows y0..y1 of I_D(l, m) = sum_k w_k Re[V_k exp(2 pi i (u l + v m))] over both halves of the uv plane
  // (the conjugate sample doubles the real part); beam: V_k = 1. pts = [u, v, w, re, im] x K
  E.dirty = (ax, pts, y0, y1, beam) => {
    const K = pts.length / 5, rows = y1 - y0;
    const out = new Float64Array(rows * N), cy = new Float64Array(rows), sy = new Float64Array(rows);
    const c2 = new Float64Array(N), s2 = new Float64Array(N);
    for (let k = 0; k < K; k++) {
      const w = pts[5 * k + 2], vr = beam ? 1 : pts[5 * k + 3], vi = beam ? 0 : pts[5 * k + 4];
      phases(pts[5 * k], ax.l0, ax.dl, N, c2, s2);
      phases(pts[5 * k + 1], ax.m0 + y0 * ax.dm, ax.dm, rows, cy, sy);
      for (let j = 0; j < rows; j++) {
        const cr = w * (vr * cy[j] - vi * sy[j]), ci = w * (vr * sy[j] + vi * cy[j]);
        const o = j * N;
        for (let x = 0; x < N; x++) out[o + x] += 2 * (cr * c2[x] - ci * s2[x]);
      }
    }
    return out;
  };

  // Bessel J0 (Abramowitz & Stegun 9.4.1 / 9.4.3 rational approximations)
  E.J0 = (x) => {
    const ax = Math.abs(x);
    if (ax < 8) {
      const y = x * x;
      return (57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))))) /
        (57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y)))));
    }
    const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
    const p = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const q = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p - z * Math.sin(xx) * q);
  };
  // ring fit to the circularly averaged visibility estimated from the samples: bins [rho, mean Re V, n];
  // model J0(pi d rho) exp(-(pi w rho)^2 / 4 ln 2), least squares weighted by n, grid over d and w (microarcsec)
  E.ringFit = (bins) => {
    const UAS = Math.PI / 180 / 3600e6;
    let best = { c: Infinity };
    for (let d = 25; d <= 75; d += 0.25) {
      const k = Math.PI * d * UAS;
      for (let w = 0; w <= 40; w += 0.5) {
        const kw = Math.PI * w * UAS;
        let c = 0;
        for (const [r, v, n] of bins) { const m = E.J0(k * r) * Math.exp(-((kw * r) ** 2) / (4 * Math.LN2)); c += n * (v - m) * (v - m); }
        if (c < best.c) best = { c, d, w };
      }
    }
    let wsum = 0, vv = 0;
    for (const [, v, n] of bins) { wsum += n; vv += n * v * v; }
    best.rms = Math.sqrt(best.c / Math.max(1, wsum));
    best.r2 = 1 - best.c / Math.max(1e-12, vv);
    best.nullG = 0.7655 / (best.d * UAS);
    return best;
  };

  // Gaussian blur of the 96 x 96 image (FWHM in pixels), separable
  E.blur = (img, fwhmPix) => {
    const sg = fwhmPix / 2.3548, R = Math.ceil(3 * sg);
    const k = []; let ks = 0;
    for (let i = -R; i <= R; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); ks += v; }
    const tmp = new Float64Array(N * N), out = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -R; i <= R; i++) { const xx = x + i; if (xx >= 0 && xx < N) s += img[y * N + xx] * k[i + R]; }
      tmp[y * N + x] = s / ks;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -R; i <= R; i++) { const yy = y + i; if (yy >= 0 && yy < N) s += tmp[yy * N + x] * k[i + R]; }
      out[y * N + x] = s / ks;
    }
    return out;
  };

  G.EHT = E;
  if (typeof module !== 'undefined') module.exports = E;
})(typeof self !== 'undefined' ? self : globalThis);

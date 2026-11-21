// WebGL2: Kerr null-geodesic tracer (fragment shader, Mino time, RK4), per-frame shading, maps, GPU reductions and
// asynchronous float readbacks. No libraries.
(function (G) {
  'use strict';
  const GLX = {};
  let S_GPU = {};
  const MAP_W = 1760, MAP_H = 1440, TILE = 32;
  const TX = MAP_W / TILE, TY = MAP_H / TILE;
  GLX.MAP_W = MAP_W; GLX.MAP_H = MAP_H; GLX.TILE = TILE; GLX.TX = TX; GLX.TY = TY; GLX.NT = TX * TY;
  GLX.HALF_A = 20; GLX.HALF_B = 20 * MAP_H / MAP_W; // image half-spans in M
  GLX.HIST_BINS = 40; GLX.HIST_W = 10; // steps histogram: 40 bins of 10 steps, the last one >= 390
  const RED_W = 48; // reduction columns: 40 bins + 4 summaries

  const HDR = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

  // ---------------------------------------------------------------- tracer
  const TRACE_VS = HDR + `
uniform vec2 uTiles[128];
uniform vec2 uSize;
uniform float uTile;
void main() {
  int v = gl_VertexID;
  vec2 c = vec2((v == 1 || v == 2 || v == 4) ? 1.0 : 0.0, (v == 2 || v == 4 || v == 5) ? 1.0 : 0.0);
  vec2 p = uTiles[gl_InstanceID] + c * uTile;
  gl_Position = vec4(p / uSize * 2.0 - 1.0, 0.0, 1.0);
}`;

  const TRACE_FS = HDR + `
uniform vec2 uSize;      // target size in texels
uniform vec4 uField;     // alpha0, beta0, alpha span, beta span
uniform float uA, uInc, uH, uR0, uRin, uRout, uProj, uKc;
uniform int uMaxSteps;
layout(location = 0) out vec4 o0; // disk: (r, phi, t, g) | escaped: (-1, theta, phi, t) | captured: (-2, ...) | limit (-3)
layout(location = 1) out vec4 o1; // (n, lambda, r_min, steps)
layout(location = 2) out vec4 o2; // (null residual, polar residual, eta, 1)
float A2, LAM, L2, Q, ETA;
void deriv(float r, float th, float vr, float vth, out vec4 d, out vec2 e) {
  float s = sin(th), c = cos(th);
  s = abs(s) < 1e-6 ? (s < 0.0 ? -1e-6 : 1e-6) : s;
  float s2 = s * s;
  float P = r * r + A2 - uA * LAM, D = r * r - 2.0 * r + A2;
  d = vec4(vr, vth, 2.0 * r * P - (r - 1.0) * Q, -A2 * s * c + L2 * c / (s2 * s));
  e = vec2((uA / D) * P - uA + LAM / s2, ((r * r + A2) / D) * P + uA * (LAM - uA * s2));
}
float Rf(float r) { float P = r * r + A2 - uA * LAM; return P * P - (r * r - 2.0 * r + A2) * Q; }
float Thf(float th) { float s = sin(th), c = cos(th); return ETA + A2 * c * c - L2 * c * c / max(s * s, 1e-12); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float al = uField.x + uv.x * uField.z, be = uField.y + uv.y * uField.w;
  float st0 = sin(uInc), ct0 = cos(uInc);
  A2 = uA * uA;
  LAM = -al * st0;
  L2 = LAM * LAM;
  ETA = (al * al - A2) * ct0 * ct0 + be * be;
  Q = ETA + (LAM - uA) * (LAM - uA);
  float rh = (1.0 + sqrt(max(0.0, 1.0 - A2))) * (1.0 + 1e-3);
  float rEsc = 1.05 * uR0;
  float r = uR0, th = uInc, ph = 0.0, t = 0.0;
  float vr = -sqrt(max(0.0, Rf(r)));
  float vth = -be; // sqrt(Theta(th0)) = |beta|; the backward ray with beta > 0 heads north
  float n = 0.0, rmin = r, res = 0.0;
  int steps = 0;
  int fate = 0;
  float hr = 0.0, hph = 0.0, ht = 0.0;
  for (int k = 0; k < 8000; k++) {
    if (k >= uMaxSteps) break;
    float s0 = sin(th), c0 = cos(th);
    float s0a = max(abs(s0), 1e-6);
    float curv = uKc * sqrt(abs(L2 * c0 / (s0a * s0a * s0a)));
    curv += 0.5 * abs(LAM) * c0 * c0 / (s0a * s0a) + 0.3 * abs(vth) * max(0.0, 1.0 / s0a - 5.0);
    float ds = uH * clamp(r / 60.0, 1.0, 3.0) / (abs(vr) / r + abs(vth) + curv + 1e-6);
    vec4 k1, k2, k3, k4; vec2 e1, e2, e3, e4;
    deriv(r, th, vr, vth, k1, e1);
    deriv(r + 0.5 * ds * k1.x, th + 0.5 * ds * k1.y, vr + 0.5 * ds * k1.z, vth + 0.5 * ds * k1.w, k2, e2);
    deriv(r + 0.5 * ds * k2.x, th + 0.5 * ds * k2.y, vr + 0.5 * ds * k2.z, vth + 0.5 * ds * k2.w, k3, e3);
    deriv(r + ds * k3.x, th + ds * k3.y, vr + ds * k3.z, vth + ds * k3.w, k4, e4);
    vec4 dy = (ds / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    vec2 de = (ds / 6.0) * (e1 + 2.0 * e2 + 2.0 * e3 + e4);
    float nr = r + dy.x, nth = th + dy.y, nvr = vr + dy.z, nvth = vth + dy.w;
    float nph = ph + de.x, nt = t + de.y;
    steps++;
    float c1 = cos(nth);
    if ((c0 > 0.0) != (c1 > 0.0)) {
      float f = c0 / (c0 - c1);
      float rx = r + f * (nr - r);
      if (rx >= uRin && rx <= uRout) {
        hr = rx;
        hph = ph + f * (nph - ph);
        if (sin(th + f * (nth - th)) < 0.0) hph += 3.14159265;
        ht = t + f * (nt - t);
        rmin = min(rmin, rx);
        fate = 1;
        break;
      }
      n += 1.0;
    }
    r = nr; th = nth; vr = nvr; vth = nvth; ph = nph; t = nt;
    float Rn = Rf(r), Pn = r * r + A2 - uA * LAM;
    res = max(res, abs(vr * vr - Rn) / (Rn + 1.0));
    if (Rn > uProj * Pn * Pn) vr = (vr < 0.0 ? -1.0 : 1.0) * sqrt(Rn);
    rmin = min(rmin, r);
    if (r < rh) { fate = 3; break; }
    if (r > rEsc && vr > 0.0) { fate = 2; break; }
  }
  float tres = abs(vth * vth - Thf(th)) / (abs(Thf(th)) + 1.0);
  if (fate == 1) {
    float x = sqrt(hr);
    float g = pow(hr, 0.75) * sqrt(max(hr * x - 3.0 * x + 2.0 * uA, 0.0)) / (hr * x + uA - LAM);
    o0 = vec4(hr, hph, ht, g);
  } else if (fate == 2) {
    o0 = vec4(-1.0, th, ph, t);
  } else if (fate == 3) {
    o0 = vec4(-2.0, th, ph, 0.0);
  } else {
    o0 = vec4(-3.0, th, ph, 0.0);
  }
  o1 = vec4(n, LAM, rmin, float(steps));
  o2 = vec4(res, tres, ETA, 1.0);
}`;

  // ---------------------------------------------------------------- shared shading code
  const SHADE_LIB = `
uniform highp sampler2D uMap0, uMap1;
uniform sampler2D uFhat;       // F^(r) LUT (R32F, 1024 wide over [uRin, uFmax])
uniform float uA, uRin, uRoutLut, uTobs, uTmin, uDelay, uDopp, uGrav;
uniform float uRs, uSig, uSpotA, uSpotPhi0, uSpotBirth, uNoiseAmp, uRout;
float Fhat(float r) {
  float u = clamp((r - uRin) / (uRoutLut - uRin), 0.0, 1.0) * 1023.0;
  float i0 = floor(u);
  float a = texelFetch(uFhat, ivec2(int(i0), 0), 0).r;
  float b = texelFetch(uFhat, ivec2(min(int(i0) + 1, 1023), 0), 0).r;
  return mix(a, b, u - i0);
}
float gfac(float r, float lam) {
  float x = sqrt(r);
  float W = 1.0 / (r * x + uA);
  if (uDopp > 0.5 && uGrav > 0.5) return pow(r, 0.75) * sqrt(max(r * x - 3.0 * x + 2.0 * uA, 0.0)) / (r * x + uA - lam);
  if (uGrav > 0.5) {
    float D = r * r - 2.0 * r + uA * uA, Ab = (r * r + uA * uA) * (r * r + uA * uA) - uA * uA * D;
    return sqrt(max(r * r * D / Ab, 0.0)) / (1.0 - 2.0 * uA * r / Ab * lam);
  }
  if (uDopp > 0.5) { float v = r * W; return sqrt(max(1.0 - v * v, 0.0)) / (1.0 - W * lam); }
  return 1.0;
}
uint hashu(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
uniform sampler2D uN1, uN2, uN3; // value noise, periodic (REPEAT), heights 24 / 48 / 96 = cells around the disk
float vn(sampler2D t, vec2 p, vec2 sz) {
  vec2 q = p + 0.5, i = floor(q), f = q - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return texture(t, (i + f - 0.5) / sz).r * 2.0 - 1.0;
}
// turbulence in the co-rotating frame, log-polar, azimuthally stretched
float turb(float r, float phi, float sx, float sy) {
  float y = fract(phi * 0.15915494 + sy);
  float x = log(r) * 4.5 + sx;
  return vn(uN1, vec2(x, y * 24.0), vec2(64.0, 24.0)) * 1.15
       + (texture(uN2, vec2(x * 2.0 + 17.3, y * 48.0) / vec2(128.0, 48.0)).r * 2.0 - 1.0) * 0.6;
}
// two-layer cross-faded flow noise: each layer shears with the local Keplerian rate for at most one fade period
float flow(float r, float phi, float tem) {
  float W = 1.0 / (pow(r, 1.5) + uA);
  float P = 0.4 * 6.2831853 / W;
  float n = 0.0;
  for (int k = 0; k < 2; k++) {
    float tk = tem / P + 0.5 * float(k);
    float cyc = floor(tk), fr = tk - cyc;
    float w = 1.0 - abs(2.0 * fr - 1.0);
    float sd = cyc * 2.0 + float(k);
    n += w * turb(r, phi - W * fr * P, fract(sd * 0.6180339) * 40.0, fract(sd * 0.7548777));
  }
  return n;
}
// observed bolometric intensity of one map texel: x = total, y = spot, z = g, w = n (or -1 no disk)
vec4 texelI(ivec2 p, vec4 a) {
  if (a.x <= 0.0) return vec4(0.0, 0.0, 0.0, -1.0);
  float r = a.x, phi = a.y;
  float g = a.w;
  if (uDopp < 0.5 || uGrav < 0.5) g = gfac(r, texelFetch(uMap1, p, 0).y);
  float g4 = g * g; g4 *= g4;
  float dt = uDelay > 0.5 ? a.z - uTmin : 0.0;
  float tem = uTobs - dt;
  float I = g4 * Fhat(r) * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem));
  float age = tem - uSpotBirth;
  float Is = 0.0;
  if (age > 0.0) {
    float Ws = 1.0 / (pow(uRs, 1.5) + uA);
    float ps = uSpotPhi0 + Ws * age;
    float d2 = r * r + uRs * uRs - 2.0 * r * uRs * cos(phi - ps);
    Is = uSpotA * smoothstep(0.0, 12.0, age) * g4 * exp(-d2 / (2.0 * uSig * uSig));
  }
  return vec4(I + Is, Is, g, 0.0);
}
`;

  const QUAD_VS = HDR + `
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

  // hero cache: per canvas pixel (1 map texel per pixel), static for a given map:
  // c0 = (r or fate, phi mod 2 pi, t_hit - t_min, g), c1 = lensed star colour
  const CACHE_FS = HDR + `
uniform highp sampler2D uMap0;
uniform vec4 uVp;
uniform float uTmin, uStarGain;
layout(location = 0) out vec4 c0;
layout(location = 1) out vec4 c1;
uint hashu(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
vec3 dirOf(vec4 a) { float s = sin(a.y); return vec3(s * cos(a.z), s * sin(a.z), cos(a.y)); }
vec3 stars(ivec2 p, vec4 a) {
  vec3 d = dirOf(a);
  vec4 ax = texelFetch(uMap0, p + ivec2(1, 0), 0), ay = texelFetch(uMap0, p + ivec2(0, 1), 0);
  float fp = (ax.x == -1.0 && ay.x == -1.0) ? max(length(dirOf(ax) - d), length(dirOf(ay) - d)) : 0.05;
  vec3 col = vec3(0.0);
  float cell = 0.009;
  vec3 q = d / cell;
  ivec3 c = ivec3(floor(q));
  uint h = hashu(uvec3(c) + uvec3(77u, 991u, 3571u));
  if ((h & 255u) < 150u) {
    vec3 sp = (vec3(c) + 0.2 + 0.6 * vec3(float((h >> 8u) & 255u), float((h >> 16u) & 255u), float((h >> 24u) & 255u)) / 255.0) * cell;
    uint h2 = hashu(uvec3(c) + 5u);
    float bright = pow(float(h2 & 1023u) / 1023.0, 2.6) * 2.4;
    float tint = float((h2 >> 10u) & 255u) / 255.0;
    float sz = 1.5e-4;
    float sig = max(sz, 0.6 * fp);
    float dd = length(d - normalize(sp));
    float v = bright * (sz * sz) / (sig * sig) * exp(-dd * dd / (2.0 * sig * sig));
    col = v * mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.66), tint);
  }
  return col;
}
void main() {
  vec2 fp = (gl_FragCoord.xy - uVp.xy) / uVp.zw * vec2(${MAP_W}.0, ${MAP_H}.0);
  ivec2 p = clamp(ivec2(floor(fp)), ivec2(0), ivec2(${MAP_W - 2}, ${MAP_H - 2}));
  vec4 a = texelFetch(uMap0, p, 0);
  if (a.x > 0.0) {
    c0 = vec4(a.x, mod(a.y, 6.2831853), a.z - uTmin, a.w);
    c1 = vec4(0.0);
  } else {
    c0 = vec4(a.x, 0.0, 0.0, 0.0);
    c1 = a.x == -1.0 ? vec4(stars(p, a) * uStarGain + vec3(0.016, 0.012, 0.026), 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
  }
}`;

  // hero: one cache texel per canvas pixel, log-intensity inferno
  const HERO_FS = HDR + SHADE_LIB + `
uniform highp sampler2D uC0;
uniform sampler2D uC1;
uniform vec4 uVp;
uniform float uLogRef, uLogRange;
uniform sampler2D uLut;
out vec4 o;
const vec3 SKY = vec3(0.016, 0.012, 0.026);
// colour of one disk pixel from its cache texel c (r, phi mod 2 pi, delay, g) at cache position q
vec3 shadeDisk(vec4 c, ivec2 q, float fw) {
  float r = c.x, phi = c.y, g = c.w;
  if (uDopp < 0.5 || uGrav < 0.5) {
    vec2 fp = (vec2(q) + 0.5) / uVp.zw * vec2(${MAP_W}.0, ${MAP_H}.0);
    g = gfac(r, texelFetch(uMap1, ivec2(fp), 0).y);
  }
  float g4 = g * g; g4 *= g4;
  float tem = uTobs - (uDelay > 0.5 ? c.z : 0.0);
  float I = g4 * Fhat(r) * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem));
  float age = tem - uSpotBirth;
  if (age > 0.0) {
    float Ws = 1.0 / (pow(uRs, 1.5) + uA);
    float d2 = r * r + uRs * uRs - 2.0 * r * uRs * cos(phi - uSpotPhi0 - Ws * age);
    I += uSpotA * smoothstep(0.0, 12.0, age) * g4 * exp(-d2 / (2.0 * uSig * uSig));
  }
  // tone curve: 2.9 decades below the disk maximum map to 0..0.85, the hot spot's headroom above it rolls off
  // softly to 1 (soft knee), so the spot keeps its structure near the beaming peak
  float x = log(max(I, 1e-30)) * 0.4342945 - uLogRef;
  float v = x <= 0.0 ? 0.85 + 0.85 * x / uLogRange : 0.85 + 0.15 * (1.0 - exp(-x / 0.5));
  v = clamp(v, 0.0, 1.0);
  vec3 col = mix(SKY, texture(uLut, vec2(v * 0.996 + 0.002, 0.5)).rgb, smoothstep(0.0, 0.08, v));
  // the hot spot's orbit r = r_s as a faint dashed contour (its lensed image)
  if (fw < 0.4) {
    float ln = 1.0 - smoothstep(0.35 * fw, 1.1 * fw + 1e-4, abs(r - uRs));
    float dash = step(0.45, fract(phi * 0.15915494 * 36.0));
    col = mix(col, vec3(0.35, 0.85, 1.0), ln * dash * 0.55);
  }
  return col;
}
// radial gradient of r_hit per pixel, from disk neighbours only (one-sided where a neighbour is not disk)
float rgrad(float r, float l, float rr, float d, float u) {
  float gx = (l > 0.0 && rr > 0.0) ? 0.5 * abs(rr - l) : l > 0.0 ? abs(r - l) : rr > 0.0 ? abs(rr - r) : 0.0;
  float gy = (d > 0.0 && u > 0.0) ? 0.5 * abs(u - d) : d > 0.0 ? abs(r - d) : u > 0.0 ? abs(u - r) : 0.0;
  return max(max(gx, gy), 1e-4);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy - uVp.xy);
  vec4 c = texelFetch(uC0, q, 0);
  float fw = fwidth(c.x); // before any branch: the orbit contour needs screen-space derivatives
  vec4 nl = texelFetch(uC0, q + ivec2(-1, 0), 0), nr = texelFetch(uC0, q + ivec2(1, 0), 0);
  vec4 nd = texelFetch(uC0, q + ivec2(0, -1), 0), nu = texelFetch(uC0, q + ivec2(0, 1), 0);
  if (c.x > 0.0) {
    // anti-aliased outer rim, two-sided: r_hit is a distance field to r_out (in pixels: (r_out - r) / |grad r|)
    float g = rgrad(c.x, nl.x, nr.x, nd.x, nu.x);
    float cov = clamp((uRout - c.x) / g + 0.5, 0.0, 1.0);
    o = vec4(mix(SKY, shadeDisk(c, q, fw), cov), 1.0);
    return;
  }
  vec3 bg = texelFetch(uC1, q, 0).rgb;
  if (c.x == -1.0) {
    // a sky pixel on the rim takes the partial coverage of its disk neighbour, extrapolated one pixel outward
    vec4 nb = vec4(0.0); ivec2 dir = ivec2(0);
    if (nl.x > nb.x) { nb = nl; dir = ivec2(-1, 0); }
    if (nr.x > nb.x) { nb = nr; dir = ivec2(1, 0); }
    if (nd.x > nb.x) { nb = nd; dir = ivec2(0, -1); }
    if (nu.x > nb.x) { nb = nu; dir = ivec2(0, 1); }
    if (nb.x > uRout - 1.0) {
      vec4 n2 = texelFetch(uC0, q + 2 * dir, 0);
      float g = n2.x > 0.0 ? max(abs(nb.x - n2.x), 1e-4) : 0.05;
      float cov = clamp(0.5 - (nb.x + g - uRout) / g, 0.0, 0.5);
      if (cov > 0.0) bg = mix(bg, shadeDisk(nb, q + dir, fw), cov);
    }
  }
  o = vec4(bg, 1.0);
}`;

  // image-plane decomposition maps
  const MAPS_FS = HDR + SHADE_LIB + `
uniform vec4 uVp;
uniform int uMode, uSS;
uniform float uLo, uHi;
uniform vec2 uSpot; // spot image position in map texels (or -1)
out vec4 o;
vec3 rampDelta(float x) {
  vec3 c0 = vec3(0.07, 0.05, 0.14), c1 = vec3(0.56, 0.48, 1.0), c2 = vec3(0.35, 0.85, 1.0), c3 = vec3(0.96, 0.95, 0.91);
  x = clamp(x, 0.0, 1.0);
  return x < 0.4 ? mix(c0, c1, x / 0.4) : x < 0.75 ? mix(c1, c2, (x - 0.4) / 0.35) : mix(c2, c3, (x - 0.75) / 0.25);
}
vec3 rampG(float g) {
  vec3 mid = vec3(0.16, 0.14, 0.2), red = vec3(1.0, 0.33, 0.25), blue = vec3(0.35, 0.85, 1.0);
  if (g < 1.0) { float x = clamp((1.0 - g) / max(1.0 - uLo, 1e-3), 0.0, 1.0); return mix(mid, red, pow(x, 0.75)) * (1.0 - 0.35 * x * x); }
  float x = clamp((g - 1.0) / max(uHi - 1.0, 1e-3), 0.0, 1.0);
  return mix(mid, blue, pow(x, 0.75)) + vec3(0.5) * x * x * x;
}
vec3 rampR(float x) {
  vec3 c0 = vec3(0.98, 0.95, 0.85), c1 = vec3(1.0, 0.71, 0.24), c2 = vec3(0.82, 0.21, 0.48), c3 = vec3(0.12, 0.07, 0.2);
  x = clamp(x, 0.0, 1.0);
  return x < 0.2 ? mix(c0, c1, x / 0.2) : x < 0.55 ? mix(c1, c2, (x - 0.2) / 0.35) : mix(c2, c3, (x - 0.55) / 0.45);
}
vec3 colN(float n) {
  if (n < 0.5) return vec3(1.0, 0.71, 0.24);
  if (n < 1.5) return vec3(0.82, 0.21, 0.48);
  if (n < 2.5) return vec3(0.35, 0.85, 1.0);
  return vec3(0.96, 0.95, 0.91);
}
void main() {
  vec3 col = vec3(0.0);
  for (int j = 0; j < uSS; j++) for (int i = 0; i < uSS; i++) {
    vec2 sub = (vec2(float(i), float(j)) + 0.5) / float(uSS);
    vec2 fp = (gl_FragCoord.xy - 0.5 + sub - uVp.xy) / uVp.zw * vec2(${MAP_W}.0, ${MAP_H}.0);
    ivec2 p = clamp(ivec2(floor(fp)), ivec2(0), ivec2(${MAP_W - 1}, ${MAP_H - 1}));
    vec4 a = texelFetch(uMap0, p, 0);
    vec4 b = texelFetch(uMap1, p, 0);
    vec3 c;
    if (a.x > 0.0) {
      if (uMode == 0) c = rampG(gfac(a.x, b.y));
      else if (uMode == 1) c = rampDelta(sqrt(max(a.z - uTmin, 0.0) / max(uHi, 1e-3)));
      else if (uMode == 2) c = colN(b.x);
      else c = rampR((a.x - uLo) / max(uHi - uLo, 1e-3));
    } else if (a.x == -1.0) c = vec3(0.045, 0.038, 0.06);
    else c = vec3(0.0);
    col += c;
  }
  col /= float(uSS * uSS);
  o = vec4(col, 1.0);
}`;

  // readback renders: region of the image plane, averaged over taps; time blocks stacked in y
  const READ_FS = HDR + SHADE_LIB + `
uniform vec4 uRegion;   // alpha0, beta0, alpha span, beta span (M)
uniform ivec2 uOut;     // block size
uniform int uTaps;
uniform float uT0, uDT; // time of block 0, step per block (M)
uniform vec4 uField;    // map field: alpha0, beta0, alpha span, beta span
uniform int uEmMode;
uniform float uQ, uSpotA1;
layout(location = 0) out vec4 o0; // mean I, mean I_spot, mean I_spot*g, max g
layout(location = 1) out vec4 o1; // mean I for n = 0, 1, >= 2, hit fraction
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int blk = q.y / uOut.y;
  q.y -= blk * uOut.y;
  float tob = uT0 + float(blk) * uDT;
  vec4 s0 = vec4(0.0), s1 = vec4(0.0);
  float gmax = 0.0;
  for (int j = 0; j < uTaps; j++) for (int i = 0; i < uTaps; i++) {
    vec2 sub = (vec2(float(i), float(j)) + 0.5) / float(uTaps);
    vec2 ab = uRegion.xy + (vec2(q) + sub) / vec2(uOut) * uRegion.zw;
    vec2 fp = (ab - uField.xy) / uField.zw * vec2(${MAP_W}.0, ${MAP_H}.0);
    ivec2 p = clamp(ivec2(floor(fp)), ivec2(0), ivec2(${MAP_W - 1}, ${MAP_H - 1}));
    vec4 a = texelFetch(uMap0, p, 0);
    if (a.x > 0.0) {
      vec4 b = texelFetch(uMap1, p, 0);
      float r = a.x, phi = a.y;
      float g = (uDopp > 0.5 && uGrav > 0.5) ? a.w : gfac(r, b.y);
      float g4 = g * g; g4 *= g4;
      float dt = uDelay > 0.5 ? a.z - uTmin : 0.0;
      float tem = tob - dt;
      // mode 0: bolometric thermal disk, g^4 F^; mode 1: 230 GHz optically thin equatorial emission, g^3 r^-q
      float g3 = g * g * g;
      float em = uEmMode == 0 ? g4 * Fhat(r) : g3 * pow(r, -uQ);
      float Id = em * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem)) * (1.0 - smoothstep(uRout - 0.5, uRout, r));
      float age = tem - uSpotBirth, Is = 0.0;
      if (age > 0.0) {
        float Ws = 1.0 / (pow(uRs, 1.5) + uA);
        float ps = uSpotPhi0 + Ws * age;
        float d2 = r * r + uRs * uRs - 2.0 * r * uRs * cos(phi - ps);
        Is = (uEmMode == 0 ? uSpotA * g4 : uSpotA1 * g3) * smoothstep(0.0, 12.0, age) * exp(-d2 / (2.0 * uSig * uSig));
      }
      float It = Id + Is;
      s0 += vec4(It, Is, Is * g, 0.0);
      gmax = max(gmax, g);
      if (b.x < 0.5) s1.x += It; else if (b.x < 1.5) s1.y += It; else s1.z += It;
      s1.w += 1.0;
    }
  }
  float nt = float(uTaps * uTaps);
  o0 = vec4(s0.xyz / nt, gmax);
  o1 = s1 / nt;
}`;

  // static samples (point) of a map: (r or fate, g, n, t) and (steps, rmin, lambda, res)
  const STATIC_FS = HDR + `
uniform highp sampler2D uMap0, uMap1, uMap2;
uniform vec2 uSrc;
uniform ivec2 uOut;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 p = ivec2((vec2(q) + 0.5) / vec2(uOut) * uSrc);
  vec4 a = texelFetch(uMap0, p, 0), b = texelFetch(uMap1, p, 0), c = texelFetch(uMap2, p, 0);
  o0 = vec4(a.x, a.x > 0.0 ? a.w : a.y, b.x, a.z);
  o1 = vec4(b.w, b.z, b.y, c.x);
}`;

  // probe gather: 64 texels listed in a uniform array
  const PROBE_FS = HDR + `
uniform highp sampler2D uMap0, uMap1;
uniform ivec2 uProbe[64];
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  int k = int(gl_FragCoord.x);
  ivec2 p = uProbe[k];
  o0 = texelFetch(uMap0, p, 0);
  o1 = texelFetch(uMap1, p, 0);
}`;

  // reduction of the rays just traced: one point per ray scattered into a 48 x 1 float target with blending
  // columns 0-39 steps histogram (add), 40 (steps, captured, escaped, disk) add, 41 (n>=1, n>=2, step limit, sum r) add,
  // 42 (max steps, max null residual, max t_hit, max g) max, 43 (2000 - min t_hit, 10 - min g, max g^4 F, 0) max
  const RED_VS = HDR + `
uniform highp sampler2D uMap0, uMap1, uMap2;
uniform sampler2D uFhat;
uniform vec2 uTiles[128];
uniform int uWhich, uBand, uTileBase;
uniform float uBinW, uRin, uRoutLut, uOutW;
out vec4 vC;
void main() {
  int id = gl_VertexID, t = id >> 10, k = id & 1023;
  ivec2 p = ivec2(uTiles[t]) + ivec2(k & 31, k >> 5);
  vec4 a = texelFetch(uMap0, p, 0), b = texelFetch(uMap1, p, 0);
  float hit = a.x > 0.0 ? 1.0 : 0.0;
  float col = 0.0;
  if (uWhich == 0) { col = min(floor(b.w / uBinW), 39.0); vC = vec4(1.0, 0.0, 0.0, 0.0); }
  else if (uWhich == 1) { col = 40.0; vC = vec4(b.w, a.x == -2.0 ? 1.0 : 0.0, a.x == -1.0 ? 1.0 : 0.0, hit); }
  else if (uWhich == 2) { col = 41.0; vC = vec4(hit * (b.x > 0.5 ? 1.0 : 0.0), hit * (b.x > 1.5 ? 1.0 : 0.0), a.x == -3.0 ? 1.0 : 0.0, hit * a.x); }
  else if (uWhich == 3) { col = 42.0; float rs = texelFetch(uMap2, p, 0).x; vC = vec4(b.w, hit * rs, hit * a.z, hit * a.w); }
  else if (uWhich == 5) { col = 44.0; float rs = texelFetch(uMap2, p, 0).x; vC = hit * vec4(a.w, a.z - 1000.0, rs * rs, 0.0); }
  else if (uWhich == 6) { col = float(uTileBase + t); vC = vec4(b.w, 1.0, 0.0, 0.0); }
  else {
    col = 43.0;
    float u = clamp((a.x - uRin) / (uRoutLut - uRin), 0.0, 1.0) * 1023.0;
    float F = texelFetch(uFhat, ivec2(int(u), 0), 0).r;
    float g4 = a.w * a.w; g4 *= g4;
    vC = hit * vec4(2000.0 - a.z, 10.0 - a.w, g4 * F, 0.0);
  }
  gl_Position = uWhich == 6 ? vec4((col + 0.5) / uOutW * 2.0 - 1.0, 0.0, 0.0, 1.0)
                            : vec4((col + 0.5) / 48.0 * 2.0 - 1.0, (float((id & 15) + 16 * uBand) + 0.5) / 64.0 * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
  const RED_FS = HDR + `
in vec4 vC;
out vec4 o;
void main() { o = vC; }`;

  GLX.SRC = { TRACE_VS, TRACE_FS, HDR };
  // ---------------------------------------------------------------- GL plumbing
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('shader: ' + log + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).slice(0, 400).join('\n').slice(0, 2000));
    }
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  function tex(gl, w, h, ifmt, fmt, type, filter, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fbo(gl, texs) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fbo incomplete ' + st);
    return f;
  }

  // asynchronous readback of an MRT framebuffer (RGBA32F) through a PBO, consumed a fixed number of frames later
  class Readback {
    constructor(gl, w, h, nt, ring = 3) {
      this.gl = gl; this.w = w; this.h = h; this.nt = nt;
      this.bytes = w * h * 16;
      this.slots = Array.from({ length: ring }, () => {
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, this.bytes * nt, gl.STREAM_READ);
        return { pbo, busy: null };
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.next = 0;
      this.queue = [];
      this.out = Array.from({ length: nt }, () => new Float32Array(w * h * 4));
    }
    free() { return this.queue.length < this.slots.length; }
    request(fb, frame, tag, w = this.w, h = this.h) {
      if (!this.free()) return false;
      const gl = this.gl, slot = this.slots[this.next];
      this.next = (this.next + 1) % this.slots.length;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
      for (let i = 0; i < this.nt; i++) {
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, this.bytes * i);
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      this.queue.push({ slot, frame, tag, w, h, fence });
      return true;
    }
    // the oldest request once 'lag' frames have passed and its fence has signalled (live); in render mode at the
    // fixed lag, so the recording is deterministic (the controlled clock hides any stall)
    poll(frame, lag = 2) {
      const q = this.queue[0];
      if (!q || frame - q.frame < lag) return null;
      const gl = this.gl;
      const t0 = performance.now();
      const st = gl.clientWaitSync(q.fence, 0, 0);
      const t1 = performance.now();
      GLX.ps.wait += t1 - t0; GLX.ps.n++;
      const ready = st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED;
      if (!ready) GLX.ps.notReady++;
      if (!ready && GLX.live && frame - q.frame < lag + 30) return null;
      this.queue.shift();
      gl.deleteSync(q.fence);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.slot.pbo);
      const n = q.w * q.h * 4;
      for (let i = 0; i < this.nt; i++) gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, this.bytes * i, this.out[i], 0, n);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      GLX.ps.read += performance.now() - t1; GLX.ps.reads++;
      return { tag: q.tag, data: this.out, w: q.w, h: q.h, frame: q.frame };
    }
  }


  // all per-cycle readbacks (reduction, live image, EHT image) packed into one PBO and fetched with a single
  // getBufferSubData: one synchronous round trip per cycle instead of one per target
  class Hub {
    constructor(gl, bytes, ring = 3) {
      this.gl = gl; this.bytes = bytes;
      this.slots = Array.from({ length: ring }, () => {
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        return { pbo };
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.next = 0; this.queue = [];
      this.out = new Float32Array(bytes / 4);
    }
    free() { return this.queue.length < this.slots.length; }
    // items: [{fb, att, w, h, key}]
    request(items, frame, tag) {
      if (!this.free()) return false;
      const gl = this.gl, slot = this.slots[this.next];
      this.next = (this.next + 1) % this.slots.length;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
      let off = 0;
      const map = {};
      for (const it of items) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, it.fb);
        gl.readBuffer(gl.COLOR_ATTACHMENT0 + (it.att || 0));
        gl.readPixels(0, 0, it.w, it.h, gl.RGBA, gl.FLOAT, off);
        map[it.key] = { off: off / 4, n: it.w * it.h * 4, w: it.w, h: it.h };
        off += it.w * it.h * 16;
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      this.queue.push({ slot, frame, tag, map, bytes: off, fence });
      return true;
    }
    // render mode: read the buffer between frames (called from the awaited promise), so the frame that consumes it
    // spends no time in the synchronous copy
    prefetch(frame, lag) {
      const q = this.queue[0];
      if (!q || frame - q.frame < lag || this.pre) return;
      this.pre = this.poll(frame, lag, true);
      if (this.pre) this.pre.due = frame;
    }
    poll(frame, lag, inPrefetch = false) {
      if (!inPrefetch && this.pre) { const r = this.pre; this.pre = null; return r.due <= frame ? r : null; }
      const q = this.queue[0];
      if (!q || frame - q.frame < lag) return null;
      const gl = this.gl;
      const st = gl.clientWaitSync(q.fence, 0, 0);
      const ready = st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED;
      if (!ready && GLX.live && frame - q.frame < lag + 30) return null;
      this.queue.shift();
      gl.deleteSync(q.fence);
      const t0r = window.STUDIO && STUDIO.mode === 'render' ? Object.getPrototypeOf(Date).now() : performance.now();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, q.slot.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.out, 0, q.bytes / 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const dtr = (window.STUDIO && STUDIO.mode === 'render' ? Object.getPrototypeOf(Date).now() : performance.now()) - t0r;
      GLX.ps.read += dtr; GLX.ps.reads++; GLX.ps.max = Math.max(GLX.ps.max || 0, dtr); (GLX.ps.hist = GLX.ps.hist || []).push(dtr);
      const view = {};
      for (const [k, m] of Object.entries(q.map)) view[k] = this.out.subarray(m.off, m.off + m.n);
      return { tag: q.tag, view, frame: q.frame };
    }
  }
  GLX.Hub = Hub;
  // a promise that resolves when a fence has signalled, polled with the real timer (render mode only: the recorder
  // waits for it before the next frame, so reading the buffer later never stalls a frame)
  GLX.fenceDone = (gl, fence) => new Promise((res) => {
    const T = window.__STUDIO_REAL_TIMEOUT__ || setTimeout;
    let n = 0;
    const check = () => {
      const st = gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED || st === gl.WAIT_FAILED || ++n > 4000) res();
      else T(check, 1);
    };
    check();
  });
  GLX.program = (gl, vs, fs) => program(gl, vs, fs);
  GLX.live = !(window.STUDIO && STUDIO.mode === 'render');
  GLX.ps = { wait: 0, n: 0, read: 0, reads: 0, notReady: 0 };
  GLX.init = function (canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
    gl.getExtension('EXT_color_buffer_half_float');
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const S = { gl, timer, queries: [], gpuMs: null };
    S.trace = program(gl, TRACE_VS, TRACE_FS);
    S.hero = program(gl, QUAD_VS, HERO_FS);
    S.cache = program(gl, QUAD_VS, CACHE_FS);
    S.maps = program(gl, QUAD_VS, MAPS_FS);
    S.read = program(gl, QUAD_VS, READ_FS);
    S.stat = program(gl, QUAD_VS, STATIC_FS);
    S.probe = program(gl, QUAD_VS, PROBE_FS);
    S.red = program(gl, RED_VS, RED_FS);
    S.floatBlend = !!gl.getExtension('EXT_float_blend');
    // geodesic map (full resolution) and its wide-field 256^2 sibling for the spectrum
    const mk = (w, h) => {
      const t0 = tex(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
      const t1 = tex(gl, w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
      const t2 = tex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
      return { t: [t0, t1, t2], fb: fbo(gl, [t0, t1, t2]), w, h };
    };
    S.map = mk(MAP_W, MAP_H);
    S.wide = mk(256, 256);
    // reduction target
    S.redTex = tex(gl, RED_W, 64, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    S.redFb = fbo(gl, [S.redTex]);
    S.redRb = new Readback(gl, RED_W, 64, 1, 4);
    S.hub = new Hub(gl, (RED_W * 64 + 128 * 128 * 2 + 96 * 96) * 16, 3);
    // dynamic readback 128^2 (and the backfill: blocks stacked in y)
    S.dynW = 128; S.dynH = 128; S.dynBlocks = 32;
    S.dynT = [0, 1].map(() => tex(gl, 128, 128 * S.dynBlocks, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST));
    S.dynFb = fbo(gl, S.dynT);
    S.benchT = tex(gl, 880, 720, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    S.benchFb = fbo(gl, [S.benchT]);
    S.dynRb = new Readback(gl, 128, 128, 2);
    // EHT crop 96^2 (blocks for the backfill)
    S.ehtBlocks = 16;
    S.ehtT = [0, 1].map(() => tex(gl, 96, 96 * S.ehtBlocks, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST));
    S.ehtFb = fbo(gl, S.ehtT);
    S.ehtRb = new Readback(gl, 96, 96, 1);
    // static 256^2 of the wide map
    S.statT = [0, 1].map(() => tex(gl, 256, 256, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST));
    S.statFb = fbo(gl, S.statT);
    // probes
    S.probeT = [0, 1].map(() => tex(gl, 64, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST));
    S.probeFb = fbo(gl, S.probeT);
    // LUTs
    S.fhatTex = tex(gl, 1024, 1, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, new Float32Array(1024));
    S.lutTex = tex(gl, 256, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, GLX.lutBytes());
    const rng = (window.STUDIO && STUDIO.rng) ? STUDIO.rng(4242) : Math.random;
    S.noise = [[64, 24], [128, 48], [256, 96]].map(([w, h]) => {
      const d = new Uint8Array(w * h);
      for (let i = 0; i < d.length; i++) d[i] = Math.floor(rng() * 256);
      const t = tex(gl, w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, d);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return t;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    S.vao = gl.createVertexArray();
    gl.bindVertexArray(S.vao);
    return S;
  };

  // inferno, matplotlib stops every 0.1
  const INFERNO = ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'];
  const INF_RGB = INFERNO.map((s) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)));
  const INF_LUT = Array.from({ length: 1024 }, (_, j) => {
    const t = (j / 1023) * 10, i = Math.min(9, Math.floor(t)), f = t - i;
    return [0, 1, 2].map((k) => INF_RGB[i][k] + (INF_RGB[i + 1][k] - INF_RGB[i][k]) * f);
  });
  GLX.inferno = (t) => INF_LUT[Math.round(Math.min(1, Math.max(0, t || 0)) * 1023)];
  GLX.lutBytes = () => {
    const b = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const c = GLX.inferno(i / 255);
      b[i * 4] = c[0]; b[i * 4 + 1] = c[1]; b[i * 4 + 2] = c[2]; b[i * 4 + 3] = 255;
    }
    return b;
  };

  GLX.setFhat = (S, Fhat, rin, rmax) => {
    const gl = S.gl, d = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) d[i] = Fhat(rin + ((rmax - rin) * i) / 1023);
    gl.bindTexture(gl.TEXTURE_2D, S.fhatTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1024, 1, gl.RED, gl.FLOAT, d);
  };

  function bindTex(gl, prog, name, unit, t) {
    if (prog.u[name] === undefined || prog.u[name] === null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.u[name], unit);
  }
  function setShade(S, prog, P) {
    const gl = S.gl, u = prog.u;
    bindTex(gl, prog, 'uMap0', 0, S.map.t[0]);
    bindTex(gl, prog, 'uMap1', 1, S.map.t[1]);
    bindTex(gl, prog, 'uFhat', 2, S.fhatTex);
    bindTex(gl, prog, 'uN1', 5, S.noise[0]);
    bindTex(gl, prog, 'uN2', 6, S.noise[1]);
    bindTex(gl, prog, 'uN3', 7, S.noise[2]);
    const f1 = (n, v) => { if (u[n]) gl.uniform1f(u[n], v); };
    f1('uA', P.a); f1('uRin', P.rin); f1('uRoutLut', P.rLut); f1('uTobs', P.tobs); f1('uTmin', P.tmin);
    f1('uDelay', P.delay ? 1 : 0); f1('uDopp', P.dopp ? 1 : 0); f1('uGrav', P.grav ? 1 : 0);
    f1('uRs', P.rs); f1('uSig', P.sig); f1('uSpotA', P.spotA); f1('uSpotPhi0', P.spotPhi0); f1('uSpotBirth', P.spotBirth);
    f1('uNoiseAmp', P.noise); f1('uRout', P.rout);
  }

  // trace a list of tiles [[x, y], ...] into a map (target: S.map or S.wide), field = [a0, b0, aspan, bspan]
  GLX.trace = (S, target, tiles, P, field) => {
    const gl = S.gl, pr = S.trace;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.viewport(0, 0, target.w, target.h);
    gl.uniform2f(pr.u.uSize, target.w, target.h);
    gl.uniform4f(pr.u.uField, field[0], field[1], field[2], field[3]);
    gl.uniform1f(pr.u.uTile, TILE);
    gl.uniform1f(pr.u.uA, P.a); gl.uniform1f(pr.u.uInc, P.inc); gl.uniform1f(pr.u.uH, P.h);
    gl.uniform1f(pr.u.uR0, 1000); gl.uniform1f(pr.u.uRin, P.rin); gl.uniform1f(pr.u.uRout, P.rout);
    gl.uniform1f(pr.u.uProj, 0.1); gl.uniform1f(pr.u.uKc, 1.0);
    gl.uniform1i(pr.u.uMaxSteps, P.maxSteps);
    for (let i = 0; i < tiles.length; i += 128) {
      const chunk = tiles.slice(i, i + 128);
      const arr = new Float32Array(256);
      chunk.forEach((t, k) => { arr[2 * k] = t[0] * TILE; arr[2 * k + 1] = t[1] * TILE; });
      gl.uniform2fv(pr.u.uTiles, arr);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, chunk.length);
      if (tiles.length > 128) gl.flush();
    }
  };

  // GPU reduction of the rays of up to 128 tiles of the main map -> RED_W x 1 texels (blended)
  function scatter(S, tiles, P, band = 0) {
    const gl = S.gl, pr = S.red;
    gl.useProgram(pr.p);
    gl.uniform1i(pr.u.uBand, band);
    bindTex(gl, pr, 'uMap0', 0, S.map.t[0]);
    bindTex(gl, pr, 'uMap1', 1, S.map.t[1]);
    bindTex(gl, pr, 'uMap2', 3, S.map.t[2]);
    bindTex(gl, pr, 'uFhat', 2, S.fhatTex);
    gl.uniform1f(pr.u.uRin, P.rin); gl.uniform1f(pr.u.uRoutLut, P.rLut);
    gl.uniform1f(pr.u.uBinW, GLX.HIST_W);
    const arr = new Float32Array(256);
    tiles.forEach((t, k) => { arr[2 * k] = t[0] * TILE; arr[2 * k + 1] = t[1] * TILE; });
    gl.uniform2fv(pr.u.uTiles, arr);
    const n = tiles.length * 1024;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let w = 0; w < 6; w++) {
      gl.blendEquation(w < 3 || w === 5 ? gl.FUNC_ADD : gl.MAX);
      gl.uniform1i(pr.u.uWhich, w);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  }
  // band b of 4 (one per frame); the target is cleared at band 0 and read after band 3
  GLX.reduce = (S, tiles, P, band) => {
    const gl = S.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.redFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, RED_W, 64);
    if (band === 0) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    scatter(S, tiles, P, band);
  };
  GLX.reduceRequest = (S, frame, tag) => S.redRb.request(S.redFb, frame, tag, RED_W, 64);
  // fold the 4 bands of 16 rows: add for columns 0-41 and 44, max for 42-43 (per band, for per-frame use)
  GLX.collapseBand = (d, band) => {
    const out = new Float64Array(RED_W * 4);
    for (let y = band * 16; y < band * 16 + 16; y++) {
      const o = y * RED_W * 4;
      for (let i = 0; i < 42 * 4; i++) out[i] += d[o + i];
      for (let i = 42 * 4; i < 44 * 4; i++) out[i] = Math.max(out[i], d[o + i]);
      for (let i = 44 * 4; i < 45 * 4; i++) out[i] += d[o + i];
    }
    return out;
  };
  // synchronous, all tiles (prewarm): blended over several batches, read once
  GLX.reduceSync = (S, tiles, P) => {
    const gl = S.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.redFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, RED_W, 64);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < tiles.length; i += 128) scatter(S, tiles.slice(i, i + 128), P, 0);
    return GLX.collapse(GLX.readSync(S, S.redFb, RED_W, 64, 1)[0]);
  };
  GLX.RED_W = RED_W;
  // RK4 steps of every tile of the map (one column per tile), for the work-balanced tile budget
  GLX.tileCosts = (S, tiles) => {
    const gl = S.gl, n = tiles.length;
    const t = tex(gl, n, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST), fb = fbo(gl, [t]);
    gl.viewport(0, 0, n, 1);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const pr = S.red;
    gl.useProgram(pr.p);
    bindTex(gl, pr, 'uMap0', 0, S.map.t[0]);
    bindTex(gl, pr, 'uMap1', 1, S.map.t[1]);
    bindTex(gl, pr, 'uMap2', 3, S.map.t[2]);
    bindTex(gl, pr, 'uFhat', 2, S.fhatTex);
    gl.uniform1i(pr.u.uWhich, 6); gl.uniform1i(pr.u.uBand, 0); gl.uniform1f(pr.u.uOutW, n);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
    for (let i = 0; i < n; i += 128) {
      const ch = tiles.slice(i, i + 128), arr = new Float32Array(256);
      ch.forEach((q, k) => { arr[2 * k] = q[0] * TILE; arr[2 * k + 1] = q[1] * TILE; });
      gl.uniform2fv(pr.u.uTiles, arr);
      gl.uniform1i(pr.u.uTileBase, i);
      gl.drawArrays(gl.POINTS, 0, ch.length * 1024);
    }
    gl.disable(gl.BLEND);
    const d = GLX.readSync(S, fb, n, 1, 1)[0];
    gl.deleteFramebuffer(fb); gl.deleteTexture(t);
    return Float64Array.from({ length: n }, (_, k) => d[k * 4]);
  };
  // fold the 64 rows of the reduction target: add for columns 0-41, max for 42-43
  GLX.collapse = (d) => {
    const out = new Float64Array(RED_W * 4);
    for (let y = 0; y < 64; y++) {
      const o = y * RED_W * 4;
      for (let i = 0; i < 42 * 4; i++) out[i] += d[o + i];
      for (let i = 42 * 4; i < 44 * 4; i++) out[i] = Math.max(out[i], d[o + i]);
      for (let i = 44 * 4; i < 45 * 4; i++) out[i] += d[o + i];
    }
    return out;
  };

  // rebuild the hero cache (after a pass completes or a toggle changes)
  GLX.buildCache = (S, P, w, h) => {
    const gl = S.gl;
    if (!S.cacheT || S.cacheW !== w || S.cacheH !== h) {
      S.cacheT = [tex(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST), tex(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST)];
      S.cacheFb = fbo(gl, S.cacheT);
      S.cacheW = w; S.cacheH = h;
    }
    const pr = S.cache;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.cacheFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, w, h);
    bindTex(gl, pr, 'uMap0', 0, S.map.t[0]);
    gl.uniform4f(pr.u.uVp, 0, 0, w, h);
    gl.uniform1f(pr.u.uTmin, P.tmin);
    gl.uniform1f(pr.u.uStarGain, P.starGain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  GLX.drawHero = (S, P, vp) => {
    const gl = S.gl, pr = S.hero;
    gl.useProgram(pr.p);
    setShade(S, pr, P);
    bindTex(gl, pr, 'uLut', 4, S.lutTex);
    bindTex(gl, pr, 'uC0', 3, S.cacheT[0]);
    bindTex(gl, pr, 'uC1', 8, S.cacheT[1]);
    gl.uniform4f(pr.u.uVp, vp[0], vp[1], vp[2], vp[3]);
    gl.uniform1f(pr.u.uLogRef, P.logRef);
    gl.uniform1f(pr.u.uLogRange, P.logRange);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  GLX.drawMap = (S, P, vp, ss, mode, lo, hi) => {
    const gl = S.gl, pr = S.maps;
    gl.useProgram(pr.p);
    setShade(S, pr, P);
    gl.uniform4f(pr.u.uVp, vp[0], vp[1], vp[2], vp[3]);
    gl.uniform1i(pr.u.uSS, ss);
    gl.uniform1i(pr.u.uMode, mode);
    gl.uniform1f(pr.u.uLo, lo);
    gl.uniform1f(pr.u.uHi, hi);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // readback render into fb (2 targets): blocks of outW x outH stacked in y, block k at time t0 + k dt
  GLX.renderRead = (S, fb, outW, outH, blocks, region, taps, t0, dt, P, emMode = 0) => {
    const gl = S.gl, pr = S.read;
    gl.useProgram(pr.p);
    setShade(S, pr, P);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, outW, outH * blocks);
    gl.uniform4f(pr.u.uRegion, region[0], region[1], region[2], region[3]);
    gl.uniform2i(pr.u.uOut, outW, outH);
    gl.uniform1i(pr.u.uTaps, taps);
    gl.uniform1f(pr.u.uT0, t0);
    gl.uniform1f(pr.u.uDT, dt);
    gl.uniform4f(pr.u.uField, -GLX.HALF_A, -GLX.HALF_B, 2 * GLX.HALF_A, 2 * GLX.HALF_B);
    gl.uniform1i(pr.u.uEmMode, emMode);
    gl.uniform1f(pr.u.uQ, P.q);
    gl.uniform1f(pr.u.uSpotA1, P.spotA1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // synchronous read of an MRT fb (prewarm only)
  GLX.readSync = (S, fb, w, h, nt) => {
    const gl = S.gl, out = [];
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
    for (let i = 0; i < nt; i++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      const d = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, d);
      out.push(d);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return out;
  };

  GLX.staticRead = (S) => {
    const gl = S.gl, pr = S.stat;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.statFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, 256, 256);
    bindTex(gl, pr, 'uMap0', 0, S.wide.t[0]);
    bindTex(gl, pr, 'uMap1', 1, S.wide.t[1]);
    bindTex(gl, pr, 'uMap2', 3, S.wide.t[2]);
    gl.uniform2f(pr.u.uSrc, 256, 256);
    gl.uniform2i(pr.u.uOut, 256, 256);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return GLX.readSync(S, S.statFb, 256, 256, 2);
  };

  GLX.probeRead = (S, texels) => {
    const gl = S.gl, pr = S.probe;
    gl.useProgram(pr.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.probeFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, 64, 1);
    bindTex(gl, pr, 'uMap0', 0, S.map.t[0]);
    bindTex(gl, pr, 'uMap1', 1, S.map.t[1]);
    const arr = new Int32Array(128);
    texels.forEach((p, k) => { arr[2 * k] = p[0]; arr[2 * k + 1] = p[1]; });
    gl.uniform2iv(pr.u.uProbe, arr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return GLX.readSync(S, S.probeFb, 64, 1, 2);
  };

  // GPU timer around a block of work (EXT_disjoint_timer_query_webgl2), averaged when results arrive
  GLX.timeBegin = (S, label = 'trace') => {
    if (!S.timer || S.qActive || S.queries.length >= 12) return;
    const gl = S.gl, q = gl.createQuery();
    gl.beginQuery(S.timer.TIME_ELAPSED_EXT, q);
    S.qActive = q; S.qLabel = label;
  };
  GLX.timeEnd = (S) => {
    if (!S.qActive) return;
    const gl = S.gl;
    gl.endQuery(S.timer.TIME_ELAPSED_EXT);
    S.queries.push([S.qActive, S.qLabel]);
    S.qActive = null;
  };
  S_GPU = {};
  GLX.gpu = S_GPU;
  GLX.timePoll = (S) => {
    const gl = S.gl;
    while (S.queries.length) {
      const [q, label] = S.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(S.timer.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      if (!disjoint) {
        const v = ns / 1e6;
        S_GPU[label] = S_GPU[label] == null ? v : S_GPU[label] * 0.9 + v * 0.1;
        if (label === 'trace') S.gpuMs = S_GPU[label];
      }
      gl.deleteQuery(q);
      S.queries.shift();
    }
  };

  G.GLX = GLX;
})(window);

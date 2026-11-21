p='gl.js'; s=open(p,encoding='utf8').read()
def rep(old,new):
    global s
    if old not in s: raise SystemExit('MISSING: '+old[:90])
    s=s.replace(old,new)

# hero cache pass: per canvas pixel, (r, phi mod 2pi, dt, g) in RGBA16F and the lensed star colour in RGBA8
a=s.index('  // hero: canvas pixel -> map texels'); b=s.index('  // image-plane decomposition maps')
s=s[:a]+'''  // hero cache: per canvas pixel (1 map texel per pixel), static for a given map:
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
  float cell = 0.011;
  vec3 q = d / cell;
  ivec3 c = ivec3(floor(q));
  uint h = hashu(uvec3(c) + uvec3(77u, 991u, 3571u));
  if ((h & 255u) < 120u) {
    vec3 sp = (vec3(c) + 0.2 + 0.6 * vec3(float((h >> 8u) & 255u), float((h >> 16u) & 255u), float((h >> 24u) & 255u)) / 255.0) * cell;
    uint h2 = hashu(uvec3(c) + 5u);
    float bright = pow(float(h2 & 1023u) / 1023.0, 4.0) * 1.6;
    float tint = float((h2 >> 10u) & 255u) / 255.0;
    float sz = 1.3e-4;
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
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy - uVp.xy);
  vec4 c = texelFetch(uC0, q, 0);
  if (c.x <= 0.0) { o = vec4(texelFetch(uC1, q, 0).rgb, 1.0); return; }
  float r = c.x, phi = c.y, g = c.w;
  if (uDopp < 0.5 || uGrav < 0.5) {
    vec2 fp = (gl_FragCoord.xy - uVp.xy) / uVp.zw * vec2(${MAP_W}.0, ${MAP_H}.0);
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
  float v = clamp((log(max(I, 1e-30)) * 0.4342945 - uLogRef) / uLogRange + 1.0, 0.0, 1.0);
  o = vec4(texture(uLut, vec2(v * 0.996 + 0.002, 0.5)).rgb, 1.0);
}`;

'''+s[b:]
rep("""    S.hero = program(gl, QUAD_VS, HERO_FS);""","""    S.hero = program(gl, QUAD_VS, HERO_FS);
    S.cache = program(gl, QUAD_VS, CACHE_FS);""")
# cache targets created on demand (size of the hero in device px)
rep("""  GLX.drawHero = (S, P, vp, ss) => {
    const gl = S.gl, pr = S.hero;
    gl.useProgram(pr.p);
    setShade(S, pr, P);
    bindTex(gl, pr, 'uLut', 4, S.lutTex);
    gl.uniform4f(pr.u.uVp, vp[0], vp[1], vp[2], vp[3]);
    gl.uniform1i(pr.u.uSS, ss);
    gl.uniform1f(pr.u.uLogRef, P.logRef);
    gl.uniform1f(pr.u.uLogRange, P.logRange);
    gl.uniform1f(pr.u.uStarGain, P.starGain);
    if (pr.u.uDbg) gl.uniform1i(pr.u.uDbg, P.dbg | 0);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };""","""  // rebuild the hero cache (after a pass completes or a toggle changes)
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
  };""")
# readback lag 3 for the reduction
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
def rep2(old,new):
    global s
    if old not in s: raise SystemExit('MISSING2: '+old[:90])
    s=s.replace(old,new)
rep2("""    h: 0.06, maxSteps: 2000, raysPerFrame: 12288,""","""    h: 0.06, maxSteps: 2000, raysPerFrame: 8192,""")
rep2("""    const SP = shadeParams();
    GLX.drawHero(S, SP, [0, (1024 - 720) * DPR, 880 * DPR, 720 * DPR], 1);
    if (!APP.mapsDrawn || APP.mapsDirty) { drawMaps(SP); APP.mapsDrawn = true; APP.mapsDirty = false; }""","""    const SP = shadeParams();
    if (!APP.mapsDrawn || APP.mapsDirty) {
      GLX.buildCache(S, SP, 880 * DPR, 720 * DPR);
      drawMaps(SP); APP.mapsDrawn = true; APP.mapsDirty = false;
    }
    GLX.drawHero(S, SP, [0, (1024 - 720) * DPR, 880 * DPR, 720 * DPR]);""")
rep2("""    const rb = S.redRb.poll(F);""","""    const rb = S.redRb.poll(F, 3);""")
rep2("""    const dr = S.dynRb.poll(F);""","""    const dr = S.dynRb.poll(F, 3);""")
rep2("""    const er = S.ehtRb.poll(F);""","""    const er = S.ehtRb.poll(F, 3);""")
# remove old hero bench code (uses dbg)
a=s.index("    const syncB = () =>"); b=s.index("    return JSON.stringify(out);\n  };\n\n  // ------------------------------------------------------------------ boot")
s=s[:a]+s[b:]
open(p,'w',encoding='utf8').write(s)
print('ok')

p='gl.js'; s=open(p,encoding='utf8').read()

# 1. noise: texture value noise replaces hash gradient noise
a=s.index('uint hashu(uvec3 v) {'); b=s.index('// two-layer cross-faded flow noise')
s=s[:a]+'''uint hashu(uvec3 v) {
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
  float x = log(r) * 7.0 + sx;
  return (vn(uN1, vec2(x, y * 24.0), vec2(64.0, 24.0)) * 0.64
        + vn(uN2, vec2(x * 2.0 + 17.3, y * 48.0), vec2(128.0, 48.0)) * 0.27
        + vn(uN3, vec2(x * 4.0 + 5.1, y * 96.0), vec2(256.0, 96.0)) * 0.11) * 1.7;
}
'''+s[b:]
old=s[s.index('float flow(float r, float phi, float tem) {'):s.index('// observed bolometric intensity of one map texel')]
new='''float flow(float r, float phi, float tem) {
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
'''
s=s.replace(old,new)

# 2. texelI: one fetch when both shifts are on
old=s[s.index('vec4 texelI(ivec2 p) {'):s.index('`;\n\n  const QUAD_VS')]
new='''vec4 texelI(ivec2 p, vec4 a) {
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
'''
s=s.replace(old,new)
s=s.replace("""      vec4 I = (uDbg & 1) != 0 ? vec4(Fhat(a.x), 0.0, 0.0, 0.0) : texelI(p);""","""      vec4 I = (uDbg & 1) != 0 ? vec4(Fhat(a.x), 0.0, 0.0, 0.0) : texelI(p, a);""")

# READ_FS: time per block
old=s[s.index('    vec4 I;\n    {\n      float keep = uTobs;'):s.index('  float nt = float(uTaps * uTaps);')]
new='''    vec4 a = texelFetch(uMap0, p, 0);
    if (a.x > 0.0) {
      vec4 b = texelFetch(uMap1, p, 0);
      float r = a.x, phi = a.y;
      float g = (uDopp > 0.5 && uGrav > 0.5) ? a.w : gfac(r, b.y);
      float g4 = g * g; g4 *= g4;
      float dt = uDelay > 0.5 ? a.z - uTmin : 0.0;
      float tem = tob - dt;
      float Id = g4 * Fhat(r) * max(0.0, 1.0 + uNoiseAmp * flow(r, phi, tem));
      float age = tem - uSpotBirth, Is = 0.0;
      if (age > 0.0) {
        float Ws = 1.0 / (pow(uRs, 1.5) + uA);
        float ps = uSpotPhi0 + Ws * age;
        float d2 = r * r + uRs * uRs - 2.0 * r * uRs * cos(phi - ps);
        Is = uSpotA * smoothstep(0.0, 12.0, age) * g4 * exp(-d2 / (2.0 * uSig * uSig));
      }
      float It = Id + Is;
      s0 += vec4(It, Is, Is * g, 0.0);
      gmax = max(gmax, g);
      if (b.x < 0.5) s1.x += It; else if (b.x < 1.5) s1.y += It; else s1.z += It;
      s1.w += 1.0;
    }
  }
'''
s=s.replace(old,new)

# 3. reduction by point scatter with blending
a=s.index('  // per-tile reduction of the rays just traced'); b=s.index('  GLX.SRC = {')
s=s[:a]+'''  // reduction of the rays just traced: one point per ray scattered into a 48 x 1 float target with blending
  // columns 0-39 steps histogram (add), 40 (steps, captured, escaped, disk) add, 41 (n>=1, n>=2, step limit, sum r) add,
  // 42 (max steps, max null residual, max t_hit, max g) max, 43 (2000 - min t_hit, 10 - min g, max g^4 F, 0) max
  const RED_VS = HDR + `
uniform highp sampler2D uMap0, uMap1, uMap2;
uniform sampler2D uFhat;
uniform vec2 uTiles[128];
uniform int uWhich;
uniform float uBinW, uRin, uRoutLut;
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
  else if (uWhich == 3) { col = 42.0; float rs = texelFetch(uMap2, p, 0).x; vC = vec4(b.w, rs, hit * a.z, hit * a.w); }
  else {
    col = 43.0;
    float u = clamp((a.x - uRin) / (uRoutLut - uRin), 0.0, 1.0) * 1023.0;
    float F = texelFetch(uFhat, ivec2(int(u), 0), 0).r;
    float g4 = a.w * a.w; g4 *= g4;
    vC = hit * vec4(2000.0 - a.z, 10.0 - a.w, g4 * F, 0.0);
  }
  gl_Position = vec4((col + 0.5) / 48.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;
  const RED_FS = HDR + `
in vec4 vC;
out vec4 o;
void main() { o = vC; }`;

'''+s[b:]
s=s.replace("  const RED_W = 44; // reduction columns: 40 bins + 4 summaries","  const RED_W = 48; // reduction columns: 40 bins + 4 summaries")
s=s.replace("    S.red = program(gl, QUAD_VS, RED_FS);","    S.red = program(gl, RED_VS, RED_FS);\n    S.floatBlend = !!gl.getExtension('EXT_float_blend');")
s=s.replace("""    S.redTex = tex(gl, RED_W, 128, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    S.redFb = fbo(gl, [S.redTex]);
    S.redRb = new Readback(gl, RED_W, 128, 1);""","""    S.redTex = tex(gl, RED_W, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    S.redFb = fbo(gl, [S.redTex]);
    S.redRb = new Readback(gl, RED_W, 1, 1, 4);""")
a=s.index('  // GPU reduction of up to 128 tiles'); b=s.index('  GLX.RED_W = RED_W;')
s=s[:a]+'''  // GPU reduction of the rays of up to 128 tiles of the main map -> RED_W x 1 texels (blended)
  function scatter(S, tiles, P) {
    const gl = S.gl, pr = S.red;
    gl.useProgram(pr.p);
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
    for (let w = 0; w < 5; w++) {
      gl.blendEquation(w < 3 ? gl.FUNC_ADD : gl.MAX);
      gl.uniform1i(pr.u.uWhich, w);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  }
  GLX.reduce = (S, tiles, P, frame, tag) => {
    const gl = S.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.redFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, RED_W, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    scatter(S, tiles, P);
    return S.redRb.request(S.redFb, frame, tag, RED_W, 1);
  };
  // synchronous, all tiles (prewarm): blended over several batches, read once
  GLX.reduceSync = (S, tiles, P) => {
    const gl = S.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.redFb);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, RED_W, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < tiles.length; i += 128) scatter(S, tiles.slice(i, i + 128), P);
    return GLX.readSync(S, S.redFb, RED_W, 1, 1)[0];
  };
'''+s[b:]

# 4. noise textures + preserveDrawingBuffer
s=s.replace("preserveDrawingBuffer: false","preserveDrawingBuffer: true")
s=s.replace("""    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);""","""    const rng = (window.STUDIO && STUDIO.rng) ? STUDIO.rng(4242) : Math.random;
    S.noise = [[64, 24], [128, 48], [256, 96]].map(([w, h]) => {
      const d = new Uint8Array(w * h);
      for (let i = 0; i < d.length; i++) d[i] = Math.floor(rng() * 256);
      const t = tex(gl, w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, d);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return t;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);""")
s=s.replace("""    bindTex(gl, prog, 'uFhat', 2, S.fhatTex);
    const f1""","""    bindTex(gl, prog, 'uFhat', 2, S.fhatTex);
    bindTex(gl, prog, 'uN1', 5, S.noise[0]);
    bindTex(gl, prog, 'uN2', 6, S.noise[1]);
    bindTex(gl, prog, 'uN3', 7, S.noise[2]);
    const f1""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
s=s.replace("""    h: 0.06, maxSteps: 2000, raysPerFrame: 40960,""","""    h: 0.06, maxSteps: 2000, raysPerFrame: 16384,""")
old=s[s.index('  function accumulate(acc, data, n) {'):s.index('  // ------------------------------------------------------------------ prewarm')]
new='''  function accumulate(acc, d, nTiles) {
    for (let b = 0; b < GLX.HIST_BINS; b++) acc.hist[b] += d[b * 4];
    const o40 = 160, o41 = 164, o42 = 168, o43 = 172;
    acc.steps += d[o40]; acc.capt += d[o40 + 1]; acc.esc += d[o40 + 2]; acc.hit += d[o40 + 3];
    acc.hit1 += d[o41]; acc.hit2 += d[o41 + 1]; acc.limit += d[o41 + 2]; acc.sumR += d[o41 + 3];
    acc.maxSteps = Math.max(acc.maxSteps, d[o42]); acc.res = Math.max(acc.res, d[o42 + 1]);
    if (d[o40 + 3] > 0) {
      acc.tmax = Math.max(acc.tmax, d[o42 + 2]); acc.gmax = Math.max(acc.gmax, d[o42 + 3]);
      acc.tmin = Math.min(acc.tmin, 2000 - d[o43]); acc.gmin = Math.min(acc.gmin, 10 - d[o43 + 1]);
    }
    acc.iref = Math.max(acc.iref, d[o43 + 2]);
    acc.tiles += nTiles; acc.rays += nTiles * 1024;
  }

'''
s=s.replace(old,new)
s=s.replace("""    const red = GLX.reduceSync(S, tileOrder, TP);
    const pass = newPass(0);
    for (const r of red) accumulate(pass, r.data, r.n);""","""    const red = GLX.reduceSync(S, tileOrder, TP);
    const pass = newPass(0);
    accumulate(pass, red, tileOrder.length);""")
s=s.replace("""    const rb = S.redRb.poll(F);
    if (rb) {
      accumulate(APP.passCur, rb.data[0], rb.h);
      APP.rayTimes.push([now, rb.h * 1024, sumSteps(rb.data[0], rb.h)]);""","""    const rb = S.redRb.poll(F);
    if (rb) {
      accumulate(APP.passCur, rb.data[0], rb.tag);
      APP.rayTimes.push([now, rb.tag * 1024, rb.data[0][160]]);""")
s=s.replace("""    GLX.reduce(S, tiles, traceParams(), F, 'tiles');""","""    GLX.reduce(S, tiles, traceParams(), F, tiles.length);""")
s=s.replace("""  function sumSteps(data, n) {
    let s = 0;
    for (let k = 0; k < n; k++) s += data[(k * GLX.RED_W + 40) * 4];
    return s;
  }
""","")
s=s.replace("""    T('reduce40', () => { GLX.reduce(S, tiles, traceParams(), 0, 'b'); S.redRb.poll(1e12, 0); }, S.redFb, true);""","""    T('reduce16', () => { GLX.reduce(S, tiles.slice(0, 16), traceParams(), 0, 16); S.redRb.poll(1e12, 0); }, S.redFb, true);
    out.floatBlend = S.floatBlend;""")
s=s.replace("""    T('trace40mid', () => GLX.trace(S, S.map, tiles, traceParams(), field), S.map.fb, true);
    T('trace40top', () => GLX.trace(S, S.map, tilesEdge, traceParams(), field), S.map.fb, true);""","""    T('trace16mid', () => GLX.trace(S, S.map, tiles.slice(0, 16), traceParams(), field), S.map.fb, true);
    T('trace16top', () => GLX.trace(S, S.map, tilesEdge.slice(0, 16), traceParams(), field), S.map.fb, true);""")
s=s.replace("""    for (const [nm, dbg, ss] of [['hero', 0, 2], ['heroSS1', 0, 1], ['heroNoFlow', 1, 2], ['heroNoStars', 2, 2], ['heroNone', 3, 2]]) {""","""    for (const [nm, dbg, ss] of [['hero', 0, 1], ['heroSS2', 0, 2], ['heroNoFlow', 1, 1]]) {""")
s=s.replace("""    const ss = Math.max(1, Math.min(3, Math.round(GLX.MAP_W / (880 * DPR))));
    const hy = (1024 - 720) * DPR;
    GLX.drawHero(S, SP, [0, hy, 880 * DPR, 720 * DPR], ss);""","""    const hy = (1024 - 720) * DPR;
    GLX.drawHero(S, SP, [0, hy, 880 * DPR, 720 * DPR], 1);""")
s=s.replace("""    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, glc.c.width, glc.c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const SP""","""    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const SP""")
open(p,'w',encoding='utf8').write(s)
print('ok')

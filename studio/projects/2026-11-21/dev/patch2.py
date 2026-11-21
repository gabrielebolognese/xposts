p='gl.js'; s=open(p,encoding='utf8').read()
# far-field step multiplier in the shader
old="""    float ds = uH / (abs(vr) / r + abs(vth) + curv + 1e-6);"""
new="""    curv += 0.5 * abs(LAM) * c0 * c0 / (s0a * s0a);
    float ds = uH * clamp(r / 60.0, 1.0, 3.0) / (abs(vr) / r + abs(vth) + curv + 1e-6);"""
assert old in s; s=s.replace(old,new)
# reduction spread over 64 rows
s=s.replace("""  gl_Position = vec4((col + 0.5) / 48.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);""","""  gl_Position = vec4((col + 0.5) / 48.0 * 2.0 - 1.0, (float(id & 63) + 0.5) / 64.0 * 2.0 - 1.0, 0.0, 1.0);""")
s=s.replace("""    S.redTex = tex(gl, RED_W, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    S.redFb = fbo(gl, [S.redTex]);
    S.redRb = new Readback(gl, RED_W, 1, 1, 4);""","""    S.redTex = tex(gl, RED_W, 64, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    S.redFb = fbo(gl, [S.redTex]);
    S.redRb = new Readback(gl, RED_W, 64, 1, 4);""")
s=s.replace("""    gl.viewport(0, 0, RED_W, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    scatter(S, tiles, P);
    return S.redRb.request(S.redFb, frame, tag, RED_W, 1);""","""    gl.viewport(0, 0, RED_W, 64);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    scatter(S, tiles, P);
    return S.redRb.request(S.redFb, frame, tag, RED_W, 64);""")
s=s.replace("""    gl.viewport(0, 0, RED_W, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < tiles.length; i += 128) scatter(S, tiles.slice(i, i + 128), P);
    return GLX.readSync(S, S.redFb, RED_W, 1, 1)[0];""","""    gl.viewport(0, 0, RED_W, 64);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < tiles.length; i += 128) scatter(S, tiles.slice(i, i + 128), P);
    return GLX.collapse(GLX.readSync(S, S.redFb, RED_W, 64, 1)[0]);""")
s=s.replace("""  GLX.RED_W = RED_W;""","""  GLX.RED_W = RED_W;
  // fold the 64 rows of the reduction target: add for columns 0-41, max for 42-43
  GLX.collapse = (d) => {
    const out = new Float64Array(RED_W * 4);
    for (let y = 0; y < 64; y++) {
      const o = y * RED_W * 4;
      for (let i = 0; i < 42 * 4; i++) out[i] += d[o + i];
      for (let i = 42 * 4; i < 44 * 4; i++) out[i] = Math.max(out[i], d[o + i]);
    }
    return out;
  };""")
open(p,'w',encoding='utf8').write(s)

p='main.js'; s=open(p,encoding='utf8').read()
s=s.replace("""      accumulate(APP.passCur, rb.data[0], rb.tag);
      APP.rayTimes.push([now, rb.tag * 1024, rb.data[0][160]]);""","""      const red = GLX.collapse(rb.data[0]);
      accumulate(APP.passCur, red, rb.tag);
      APP.rayTimes.push([now, rb.tag * 1024, red[160]]);""")
s=s.replace("""    h: 0.06, maxSteps: 2000, raysPerFrame: 16384,""","""    h: 0.06, maxSteps: 2000, raysPerFrame: 12288,""")
# hero bench into an offscreen fbo
s=s.replace("""      T(nm, () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); GLX.drawHero(S, SPd, [0, (1024 - 720) * DPR, 880 * DPR, 720 * DPR], ss); }, null, false);""","""      T(nm, () => { gl.bindFramebuffer(gl.FRAMEBUFFER, S.map.fb); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); GLX.drawHero(S, SPd, [0, 0, 880 * DPR, 720 * DPR], ss); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]); }, S.map.fb, true);""")
open(p,'w',encoding='utf8').write(s)

p='kerr.js'; s=open(p,encoding='utf8').read()
s=s.replace("""    const kp = opt.kp ?? 0.5, rfar = opt.rfar ?? 40, fmax = opt.fmax ?? 5;""","""    const kp = opt.kp ?? 0.5, rfar = opt.rfar ?? 60, fmax = opt.fmax ?? 3;""")
open(p,'w',encoding='utf8').write(s)
print('ok')

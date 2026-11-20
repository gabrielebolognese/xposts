import sys
def patch(p, pairs):
    s=open(p,encoding='utf-8').read()
    for a,b in pairs:
        if a not in s:
            print('MISSING in',p,':', a[:90]); sys.exit(1)
        s=s.replace(a,b)
    open(p,'w',encoding='utf-8').write(s)

patch('sim-worker.js', [
("let S, D, M, gold, prog, R, heat, prev, togFn,", "let S, D, M, gold, prog, R, heat, heatSnap, prev, togFn,"),
("  heat = new Uint16Array(D.n);\n", "  heat = new Uint16Array(D.n);\n  heatSnap = new Uint16Array(D.n);\n"),
("    if (c === n - 1) { for (let i = D.n - 1; i >= D.gateStart; i--) if ((s[i] ^ prev[i]) & 1) { deepest = D.level[i]; break; } }",
 "    if (c === n - 1) { for (let i = D.n - 1; i >= D.gateStart; i--) if ((s[i] ^ prev[i]) & 1) { deepest = D.level[i]; break; } }\n    if (c === Math.max(0, n - 4)) heatSnap.set(heat);"),
("  const h = heat.slice();\n", "  const h = heat.slice();\n  const recent = new Uint8Array(D.n);\n  for (let i = D.dffStart; i < D.n; i++) recent[i] = heat[i] - heatSnap[i];\n"),
("trace: trace.slice(-26), uart: uartNew, fb, params, deepest, frames,", "trace: trace.slice(-26), uart: uartNew, fb, params, deepest, frames, recent,"),
("  postMessage(out, [wave.buffer, togCyc.buffer, retCyc.buffer, h.buffer]);", "  postMessage(out, [wave.buffer, togCyc.buffer, retCyc.buffer, h.buffer, recent.buffer]);"),
])

patch('main.js', [
("    heat: new Float32Array(NCELL), heatFrame: new Uint16Array(NCELL),", "    heat: new Float32Array(NCELL), flash: new Float32Array(NCELL), heatFrame: new Uint16Array(NCELL),"),
("""      if (t) { const x = Math.min(1, 0.35 + (t / n) * 2.6); if (x > APP.heat[k]) APP.heat[k] = x; }
    }""", """      if (t) { const x = Math.min(1, 0.2 + (t / n) * 2.2); if (x > APP.heat[k]) APP.heat[k] = x; }
      if (m.recent[st + k]) APP.flash[k] = 1;
    }"""),
("""    for (let i = 0; i < NCELL; i++) ht[i] *= k;""", """    const fl = APP.flash;
    for (let i = 0; i < NCELL; i++) { ht[i] *= k; fl[i] *= 0.62; }"""),
])

patch('floorplan.js', [
("    in vec2 a_pos; in float a_slot; in float a_heat; in float a_flag;", "    in vec2 a_pos; in float a_slot; in float a_heat; in float a_flag; in float a_flash;"),
("    out vec3 v_col; out float v_heat; out float v_flag;\n    void main(){", "    out vec3 v_col; out float v_heat; out float v_flag; out float v_flash;\n    void main(){"),
("      v_col = u_pal[int(a_slot + 0.5)]; v_heat = a_heat; v_flag = a_flag;", "      v_col = u_pal[int(a_slot + 0.5)]; v_heat = a_heat; v_flag = a_flag; v_flash = a_flash;"),
("    in vec3 v_col; in float v_heat; in float v_flag; out vec4 o;", "    in vec3 v_col; in float v_heat; in float v_flag; in float v_flash; out vec4 o;"),
("        float d = length(q) * 2.0; float a = max(1.0 - d, 0.0); a = a * a * v_heat * 0.42;\n        o = vec4(v_col * a, a); return;",
 "        float d = length(q) * 2.0; float a = max(1.0 - d, 0.0); a = a * a * (v_heat * 0.3 + v_flash * 0.55);\n        o = vec4(mix(v_col, vec3(1.0), v_flash * 0.3) * a, a); return;"),
("      if (e > 0.34) c *= 0.72;", "      c = mix(c, vec3(1.0), v_flash * 0.55);\n      if (e > 0.34) c *= 0.72;"),
("    buf(flagA, 'a_flag', 1);", "    buf(flagA, 'a_flag', 1);\n    const flashBuf = buf(new Float32Array(n), 'a_flash', 1, true);"),
("      draw(heat) {", "      draw(heat, flash) {"),
("        gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, heat);", "        gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, heat);\n        gl.bindBuffer(gl.ARRAY_BUFFER, flashBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, flash);"),
])
patch('panels.js', [("    if (GL) GL.draw(APP.heat);", "    if (GL) GL.draw(APP.heat, APP.flash);")])
print('ok')

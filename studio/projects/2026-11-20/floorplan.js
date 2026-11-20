// Every Gate: the die floorplan. Placement (bit-sliced datapath rows, control strip below), a WebGL renderer that
// draws every cell as a lit square with a toggle-heat glow, and the 2D overlay (rulers, module outlines, buses with
// their live values, instruction per stage, critical path, undetected faults, probe).
(function (G) {
  'use strict';
  const { P, F, DPR, rgba } = G.UI;
  const PITCH = 4, CELL = 3;
  const CROWS = 18;
  const STAGES = [
    { name: 'IF', mods: ['ifu/pc', 'ifu/inc', 'ifu/npc', 'core'] },
    { name: 'IF/ID', mods: ['ifid'], preg: true },
    { name: 'ID', mods: ['idu/dec', 'idu/haz', 'idu/imm', 'idu/bta', 'idu/rf/wdec', 'idu/rf/cells', 'idu/rf/rd1', 'idu/rf/rd2', 'idu/rf/byp'] },
    { name: 'ID/EX', mods: ['idex'], preg: true },
    { name: 'EX', mods: ['exu/fwd', 'exu/alu/opsel', 'exu/alu/ks', 'exu/alu/slt', 'exu/alu/log', 'exu/alu/shf', 'exu/alu/res', 'exu/bcmp', 'exu/mul/pp', 'exu/mul/dadda', 'exu/mul/ks64', 'exu/rsel'] },
    { name: 'EX/MEM', mods: ['exmem'], preg: true },
    { name: 'MEM', mods: ['lsu/be', 'lsu/st', 'lsu/ld'] },
    { name: 'MEM/WB', mods: ['memwb'], preg: true },
    { name: 'WB', mods: ['wbu'] },
  ];
  const SHORT = {
    'ifu/pc': 'pc', 'ifu/inc': 'pc+4', 'ifu/npc': 'npc', core: '', ifid: 'IF/ID', 'idu/dec': 'dec', 'idu/haz': 'haz', 'idu/imm': 'imm', 'idu/bta': 'bta',
    'idu/rf/wdec': 'wdec', 'idu/rf/cells': 'regfile', 'idu/rf/rd1': 'rd1', 'idu/rf/rd2': 'rd2', 'idu/rf/byp': 'byp', idex: 'ID/EX',
    'exu/fwd': 'fwd', 'exu/alu/opsel': 'op', 'exu/alu/ks': 'KS32', 'exu/alu/slt': '', 'exu/alu/log': 'log', 'exu/alu/shf': 'shift', 'exu/alu/res': 'res',
    'exu/bcmp': 'bcmp', 'exu/mul/pp': 'Baugh-Wooley', 'exu/mul/dadda': 'Dadda tree 900 FA', 'exu/mul/ks64': 'KS64', 'exu/rsel': 'rsel', exmem: 'EX/MEM',
    'lsu/be': 'be', 'lsu/st': 'st', 'lsu/ld': 'ld', memwb: 'MEM/WB', wbu: 'wb',
  };
  // cell type -> colour slot: 0 INV, 1 AND/NAND, 2 OR/NOR, 3 XOR/XNOR, 4 MUX, 5 DFF
  const SLOT = [0, 0, 0, 5, 0, 1, 2, 1, 2, 3, 3, 4];
  const SLOT_COL = [P.red, P.blue, P.green, P.cyan, P.magenta, P.gold];
  const SLOT_NAME = ['INV', 'AND/NAND', 'OR/NOR', 'XOR/XNOR', 'MUX2', 'DFF'];

  function layout(D, W, H) {
    const T = G.HDL.T;
    const path = (i) => D.mods[D.mod[i]].path.replace(/^core\/?/, '') || 'core';
    const groups = new Map();
    for (let i = D.dffStart; i < D.n; i++) {
      const p = path(i);
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(i);
    }
    const RULER = 16;
    const dieX = RULER + 4, dieY = 22 + RULER + 4, dieW = W - dieX - 6, dieH = H - dieY - 6;
    const dpY = dieY + 52, dpRows = 128, dpH = dpRows * PITCH;
    const ctlY = dpY + dpH + 26, ctlH = CROWS * PITCH;
    const x0 = dieX + 26;
    const pos = new Float32Array(D.n * 2).fill(-100);
    const mods = [];
    // per-module placement in local columns
    for (const st of STAGES) for (const p of st.mods) {
      const cells = groups.get(p) || [];
      const wide = p.startsWith('exu/mul');
      const rpb = wide ? 2 : 4, nb = wide ? 64 : 32;
      const dp = cells.filter((i) => D.bit[i] >= 0).sort((a, b) => D.level[a] - D.level[b] || a - b);
      const ctl = cells.filter((i) => D.bit[i] < 0).sort((a, b) => D.level[a] - D.level[b] || a - b);
      const slot = new Int32Array(nb);
      const loc = [];
      let dpCols = 0;
      for (const i of dp) {
        const b = Math.min(nb - 1, D.bit[i]), k = slot[b]++;
        const row = (nb - 1 - b) * rpb + (k % rpb), col = Math.floor(k / rpb);
        loc.push([i, col, dpY + row * PITCH]);
        dpCols = Math.max(dpCols, col + 1);
      }
      let ctlCols = 0;
      ctl.forEach((i, k) => { const col = Math.floor(k / CROWS); loc.push([i, col, ctlY + (k % CROWS) * PITCH]); ctlCols = Math.max(ctlCols, col + 1); });
      mods.push({ path: p, stage: st.name, cols: Math.max(dpCols, ctlCols, 1), dpCols, ctlCols, loc, n: cells.length, preg: !!st.preg });
    }
    // horizontal packing: 1 empty column between modules, a gutter between stages (stretched to fill the die)
    const totalCols = mods.reduce((s, m) => s + m.cols, 0);
    const gaps = mods.length - STAGES.length;
    const avail = dieX + dieW - 10 - x0;
    const gutter = Math.max(10, Math.floor((avail - totalCols * PITCH - gaps * PITCH) / (STAGES.length - 1)));
    let x = x0;
    const stages = [];
    for (const st of STAGES) {
      const sx = x;
      st.mods.forEach((p, j) => {
        const m = mods.find((mm) => mm.path === p);
        m.x = x; m.w = m.cols * PITCH;
        for (const [i, col, y] of m.loc) { pos[i * 2] = x + col * PITCH; pos[i * 2 + 1] = y; }
        x += m.w + (j < st.mods.length - 1 ? PITCH : 0);
      });
      stages.push({ name: st.name, x: sx, w: x - sx, preg: !!st.preg });
      x += gutter;
    }
    const usedW = x - gutter - x0;
    // bit row centre y for bit b of a 32-bit bus
    const rowY = (b) => dpY + (31 - b) * 4 * PITCH + 2 * PITCH;
    return { pos, mods, stages, dieX, dieY, dieW, dieH, dpY, dpH, ctlY, ctlH, x0, gutter, rowY, usedW, PITCH, CELL, SHORT, STAGES, path };
  }

  // ---------------- WebGL cells ----------------
  function createGL(canvas, D, L) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });
    if (!gl) return null;
    const vs = `#version 300 es
    in vec2 a_pos; in float a_slot; in float a_heat; in float a_flag; in float a_flash;
    uniform vec2 u_res; uniform float u_size; uniform vec3 u_pal[6];
    out vec3 v_col; out float v_heat; out float v_flag; out float v_flash;
    void main(){
      vec2 p = (a_pos + vec2(${CELL / 2})) / u_res * 2.0 - 1.0; p.y = -p.y;
      gl_Position = vec4(p, 0.0, 1.0);
      gl_PointSize = u_size;
      v_col = u_pal[int(a_slot + 0.5)]; v_heat = a_heat; v_flag = a_flag; v_flash = a_flash;
    }`;
    const fs = `#version 300 es
    precision mediump float;
    in vec3 v_col; in float v_heat; in float v_flag; in float v_flash; out vec4 o;
    uniform float u_glow;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      if (u_glow > 0.5) {
        float d = length(q) * 2.0; float a = max(1.0 - d, 0.0); a = a * a * (v_heat * 0.3 + v_flash * 0.55);
        o = vec4(mix(v_col, vec3(1.0), v_flash * 0.3) * a, a); return;
      }
      float h = v_heat;
      vec3 base = v_col * 0.17 + vec3(0.016, 0.018, 0.024);
      vec3 lit = mix(v_col, vec3(1.0), 0.28 + 0.3 * h);
      vec3 c = mix(base, lit, smoothstep(0.0, 1.0, h));
      float e = max(abs(q.x), abs(q.y));
      c = mix(c, vec3(1.0), v_flash * 0.55);
      if (e > 0.34) c *= 0.72;
      if (v_flag > 0.5) c = mix(c, vec3(1.0, 0.86, 0.36), 0.85);
      o = vec4(c, 1.0);
    }`;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const prg = gl.createProgram();
    gl.attachShader(prg, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prg, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prg);
    if (!gl.getProgramParameter(prg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prg));
    const n = D.n - D.dffStart;
    const posA = new Float32Array(n * 2), slotA = new Float32Array(n), flagA = new Float32Array(n);
    for (let k = 0; k < n; k++) { const i = D.dffStart + k; posA[k * 2] = L.pos[i * 2]; posA[k * 2 + 1] = L.pos[i * 2 + 1]; slotA[k] = SLOT[D.type[i]]; }
    for (const i of D.critical.path) if (i >= D.dffStart) flagA[i - D.dffStart] = 1;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data, loc, size, dyn) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); const l = gl.getAttribLocation(prg, loc); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); return b; };
    buf(posA, 'a_pos', 2); buf(slotA, 'a_slot', 1);
    const heatBuf = buf(new Float32Array(n), 'a_heat', 1, true);
    buf(flagA, 'a_flag', 1);
    const flashBuf = buf(new Float32Array(n), 'a_flash', 1, true);
    const U = (k) => gl.getUniformLocation(prg, k);
    const pal = new Float32Array(18);
    SLOT_COL.forEach((h, k) => { const v = parseInt(h.slice(1), 16); pal[k * 3] = ((v >> 16) & 255) / 255; pal[k * 3 + 1] = ((v >> 8) & 255) / 255; pal[k * 3 + 2] = (v & 255) / 255; });
    gl.useProgram(prg);
    gl.uniform3fv(U('u_pal[0]'), pal);
    gl.uniform2f(U('u_res'), canvas.width / DPR, canvas.height / DPR);
    return {
      draw(heat, flash) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prg); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, heatBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, heat);
        gl.bindBuffer(gl.ARRAY_BUFFER, flashBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, flash);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform1f(U('u_glow'), 1); gl.uniform1f(U('u_size'), 11 * DPR);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1f(U('u_glow'), 0); gl.uniform1f(U('u_size'), CELL * DPR);
        gl.drawArrays(gl.POINTS, 0, n);
      },
    };
  }

  G.FP = { layout, createGL, SLOT, SLOT_COL, SLOT_NAME, PITCH, CELL, STAGES };
})(window);

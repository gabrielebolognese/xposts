// Xenon Night: hand-written WebGL2 heatmaps for the core map and the four field maps. A 136 x 136 RGBA16F texture
// per field: R = normalised value (0 outside), G = core mask, B = fuel mask. Bilinear filtering divided by the mask
// keeps the staircase edge crisp; a 1D ramp texture colours it; optional iso-contours.
(function () {
  'use strict';
  const N = 136;
  const VS = `#version 300 es
in vec2 aP;
uniform vec4 uRect; // x0, y0, x1, y1 in uv of the source texture
out vec2 vUV;
void main() {
  vec2 t = aP * 0.5 + 0.5;
  vUV = mix(uRect.xy, uRect.zw, vec2(t.x, 1.0 - t.y)); // data uv: x right, y down (row 0 = north)
  gl_Position = vec4(aP, 0.0, 1.0);
}`;
  const FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uRamp;
uniform float uMix;
uniform float uRampRow;
uniform float uContour;
uniform float uFuelOnly;
uniform vec3 uRefl;
uniform vec3 uBg;
uniform float uAlpha;
out vec4 o;
void main() {
  vec4 s = mix(texture(uA, vUV), texture(uB, vUV), uMix);
  float act = smoothstep(0.38, 0.62, s.g);
  float fuel = smoothstep(0.38, 0.62, s.b);
  float w = uFuelOnly > 0.5 ? max(s.b, 1e-4) : max(s.g, 1e-4);
  float v = clamp(s.r / w, 0.0, 1.0);
  vec3 c = texture(uRamp, vec2(v, uRampRow)).rgb;
  if (uContour > 0.0) {
    float q = v / uContour;
    float d = abs(fract(q + 0.5) - 0.5) / max(fwidth(q), 1e-5);
    float line = 1.0 - clamp(d, 0.0, 1.0);
    c = mix(c, c * 0.55, line * 0.55);
  }
  if (uFuelOnly > 0.5) c = mix(uRefl, c, fuel);
  if (uAlpha > 0.5) {
    o = vec4(c, act);
  } else {
    c = mix(uBg, c, act);
    o = vec4(c, 1.0);
  }
}`;

  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // colour ramps (stops [t, hex])
  const RAMPS = [
    [[0, '#050C18'], [0.2, '#0A2346'], [0.38, '#0F4C8F'], [0.52, '#1F86D6'], [0.64, '#3FB8FF'], [0.74, '#6FE3FF'], [0.82, '#F2F7FF'], [0.9, '#FFB547'], [1, '#FF5D5D']],
    [[0, '#060E1E'], [0.3, '#0F3A78'], [0.62, '#2C8FE0'], [0.84, '#3FB8FF'], [1, '#F2F7FF']], // fast flux: blue
    [[0, '#04131A'], [0.3, '#0B4651'], [0.6, '#1FA7B8'], [0.82, '#6FE3FF'], [1, '#F2FFFF']], // thermal flux: teal to cyan
    [[0, '#0A0D14'], [0.3, '#3A2A12'], [0.62, '#B87A22'], [0.85, '#FFB547'], [1, '#FFF0D2']],
    [[0, '#0B0A1C'], [0.3, '#33205E'], [0.62, '#8A5CD6'], [0.85, '#C3A8FF'], [1, '#F4EEFF']],
  ];
  function rampPixels() {
    const W = 256, px = new Uint8Array(W * RAMPS.length * 4);
    RAMPS.forEach((stops, r) => {
      for (let i = 0; i < W; i++) {
        const t = i / (W - 1);
        let k = 0;
        while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
        const [t0, h0] = stops[k], [t1, h1] = stops[k + 1];
        const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
        const a = hex(h0), b = hex(h1);
        for (let ch = 0; ch < 3; ch++) px[(r * W + i) * 4 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * u);
        px[(r * W + i) * 4 + 3] = 255;
      }
    });
    return { px, W, H: RAMPS.length };
  }
  function rampColor(r, t) {
    const stops = RAMPS[r];
    t = Math.max(0, Math.min(1, t));
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, h0] = stops[k], [t1, h1] = stops[k + 1];
    const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
    const a = hex(h0), b = hex(h1);
    return [0, 1, 2].map((ch) => Math.round(a[ch] + (b[ch] - a[ch]) * u));
  }

  function create(canvas, dpr, transparent) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: !!transparent });
    if (!gl) throw new Error('WebGL2 unavailable');
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aP');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['uA', 'uB', 'uRamp', 'uMix', 'uRampRow', 'uContour', 'uFuelOnly', 'uRefl', 'uBg', 'uRect', 'uAlpha']) U[n] = gl.getUniformLocation(prog, n);
    const mkTex = (filter) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const ramp = rampPixels();
    const rampTex = mkTex(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ramp.W, ramp.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, ramp.px);
    const texs = {};
    function upload(name, data) {
      if (!texs[name]) {
        texs[name] = mkTex(gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, N, N, 0, gl.RGBA, gl.FLOAT, data);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, texs[name]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, data);
      }
    }
    // draw into a rect of the canvas (css px, origin top-left); src: uv rect of the field
    function draw(a, b, mix, opt) {
      const { x, y, w, h } = opt.rect;
      const H = canvas.height;
      const vx = Math.round(x * dpr), vy = Math.round(H - (y + h) * dpr), vw = Math.round(w * dpr), vh = Math.round(h * dpr);
      gl.viewport(vx, vy, vw, vh);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(vx, vy, vw, vh);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texs[a]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texs[b]);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, rampTex);
      gl.uniform1i(U.uA, 0);
      gl.uniform1i(U.uB, 1);
      gl.uniform1i(U.uRamp, 2);
      gl.uniform1f(U.uMix, mix);
      gl.uniform1f(U.uRampRow, (opt.ramp + 0.5) / RAMPS.length);
      gl.uniform1f(U.uContour, opt.contour || 0);
      gl.uniform1f(U.uFuelOnly, opt.fuelOnly ? 1 : 0);
      const rf = hex(opt.refl || '#0D1A2A').map((v) => v / 255), bg = hex(opt.bg || '#0B1320').map((v) => v / 255);
      gl.uniform3f(U.uRefl, rf[0], rf[1], rf[2]);
      gl.uniform3f(U.uBg, bg[0], bg[1], bg[2]);
      gl.uniform1f(U.uAlpha, transparent ? 1 : 0);
      const s = opt.src || [0, 0, 1, 1];
      gl.uniform4f(U.uRect, s[0], s[1], s[2], s[3]);
      if (transparent) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
    }
    function clear(hexc) {
      const c = hex(hexc).map((v) => v / 255);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(c[0], c[1], c[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return { gl, upload, draw, clear };
  }

  window.HEAT = { create, rampColor, RAMPS };
})();

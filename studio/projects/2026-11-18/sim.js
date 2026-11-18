// Reentry: WebGL2 monodomain Aliev-Panfilov solver on 512 x 512 cells.
// State is packed two cells per texel (RGBA32F 256 x 512: u0, v0, u1, v1), ping-pong. The last substep of every frame
// is the same step with MRT outputs that also updates the activation maps (LAT, repolarisation time, APD, DI, CL).
// GPU reductions: 9-electrode pseudo-ECG (3 samples per frame), a gather of probe and junction cells, phase-singularity
// compaction in 16 x 16 blocks and a rotating slice of 128 x 128 maps; all land in one small readback texture that is
// read asynchronously through a pixel-pack buffer one frame later.
(function () {
  const RE = window.RE;
  const N = RE.N, HW = N / 2;
  const MAXS = 48;
  const RBW = 128, RBH = 30;
  RE.TMS = 12.9; // ms per model time unit
  // readback layout (one readback every second frame): rows 0-1 ECG (6 samples), 2-3 gather of the first frame,
  // 4-5 gather of the second frame, 6-13 phase singularities, 14-29 map slice
  RE.RB = { W: RBW, H: RBH, GA: 2, GB: 4, PS0: 6, MAP0: 14 };

  const VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

  const VS_SPAN = `#version 300 es
in vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}`;
  // one draw = `two` ? two : one forward-Euler step(s). For two steps every fragment (two cells) first advances the
  // 8 cells of its 2-ring stencil by one step, then its own two cells by a second step.
  const STEP = (maps, two) => {
    const cellsW = []; // local window: wx 0..5 -> x = 2X-2+wx, wy 0..4 -> y-2+wy
    const L = [];
    L.push('#version 300 es', 'precision highp float;precision highp int;precision highp sampler2D;');
    L.push('uniform sampler2D uS,uF,uP;');
    if (maps) L.push('uniform sampler2D uMA,uMB,uMC;uniform float uT0,uT1;');
    L.push('uniform float uK,uA,uEps0,uMu1,uMu2,uDt,uInvDx2,uShock;');
    L.push(`uniform vec4 uStim[${MAXS}];uniform int uNS;uniform vec4 uPlane;`);
    L.push('layout(location=0) out vec4 oS;');
    if (maps) L.push('layout(location=1) out vec4 oA;layout(location=2) out vec4 oB;layout(location=3) out vec4 oC;');
    L.push(`float stim(vec2 c,float flag){if(flag<0.5)return 0.0;float I=uShock;
  for(int i=0;i<uNS;i++){vec2 d=c-uStim[i].xy;if(dot(d,d)<=uStim[i].z)I+=uStim[i].w;}
  if(uPlane.w!=0.0&&flag>1.5&&dot(uPlane.xy,c)<uPlane.z)I+=uPlane.w;return I;}
vec2 react(float u,float v,float lap,float epsF,float flag,vec2 c){
  if(flag<0.5)return vec2(0.0);
  float du=lap*uInvDx2-uK*u*(u-uA)*(u-1.0)-u*v+stim(c,flag);
  float eps=epsF*(uEps0+uMu1*v/(u+uMu2));
  float dv=eps*(-v-uK*u*(u-uA-1.0));
  return vec2(u+uDt*du,v+uDt*dv);}`);
    L.push('void main(){', 'ivec2 p=ivec2(gl_FragCoord.xy);', `ivec2 mx=ivec2(${HW - 1},${N - 1});`, 'int X=p.x,Y=p.y;');
    const T = (dx, dy) => `texelFetch(uS,clamp(ivec2(X+(${dx}),Y+(${dy})),ivec2(0),mx),0)`;
    if (!two) {
      L.push(`vec4 c=${T(0, 0)};float Lu=${T(-1, 0)}.z;float Ru=${T(1, 0)}.x;vec4 Dn=${T(0, 1)};vec4 Up=${T(0, -1)};`);
      L.push('ivec2 q=ivec2(X*2,Y);vec4 f0=texelFetch(uF,q,0),f1=texelFetch(uF,q+ivec2(1,0),0);vec4 pr=texelFetch(uP,p,0);');
      L.push('vec2 c0=vec2(q)+0.5,c1=c0+vec2(1.0,0.0);');
      L.push('vec2 n0=react(c.x,c.y,f0.x*(c.z-c.x)+f0.y*(Lu-c.x)+f0.z*(Dn.x-c.x)+f0.w*(Up.x-c.x),pr.x,pr.y,c0);');
      L.push('vec2 n1=react(c.z,c.w,f1.x*(Ru-c.z)+f1.y*(c.x-c.z)+f1.z*(Dn.z-c.z)+f1.w*(Up.z-c.z),pr.z,pr.w,c1);');
      L.push('vec4 o=vec4(n0,n1);');
    } else {
      // window of u and v (step 0)
      for (let wy = 0; wy < 5; wy++) {
        for (let tx = 0; tx < 3; tx++) {
          const need = wy === 2 || ((wy === 1 || wy === 3)) || tx === 1;
          if (!need) continue;
          L.push(`vec4 w${wy}_${tx}=${T(tx - 1, wy - 2)};`);
        }
      }
      const uv = (wx, wy) => {
        const tx = wx >> 1, comp = wx & 1;
        return comp ? [`w${wy}_${tx}.z`, `w${wy}_${tx}.w`] : [`w${wy}_${tx}.x`, `w${wy}_${tx}.y`];
      };
      const s1 = [[1, 2], [2, 2], [3, 2], [4, 2], [2, 1], [3, 1], [2, 3], [3, 3]];
      for (const [wx, wy] of s1) {
        const cx = `X*2-2+${wx}`, cy = `Y-2+${wy}`;
        L.push(`vec4 f${wx}${wy}=texelFetch(uF,ivec2(${cx},${cy}),0);`);
        const tx = wx >> 1, comp = wx & 1;
        L.push(`vec4 pp${wx}${wy}=texelFetch(uP,ivec2(X-1+${tx},${cy}),0);float e${wx}${wy}=pp${wx}${wy}.${comp ? 'z' : 'x'},g${wx}${wy}=pp${wx}${wy}.${comp ? 'w' : 'y'};`);
        const [u, v] = uv(wx, wy), [ue] = uv(wx + 1, wy), [uw] = uv(wx - 1, wy), [us] = uv(wx, wy + 1), [un] = uv(wx, wy - 1);
        L.push(`vec2 a${wx}${wy}=react(${u},${v},f${wx}${wy}.x*(${ue}-${u})+f${wx}${wy}.y*(${uw}-${u})+f${wx}${wy}.z*(${us}-${u})+f${wx}${wy}.w*(${un}-${u}),e${wx}${wy},g${wx}${wy},vec2(float(${cx})+0.5,float(${cy})+0.5));`);
      }
      const out = [[2, 2], [3, 2]];
      const n = [];
      for (const [wx, wy] of out) {
        const cx = `X*2-2+${wx}`, cy = `Y-2+${wy}`;
        const c = `a${wx}${wy}`, E = `a${wx + 1}${wy}.x`, W = `a${wx - 1}${wy}.x`, S = `a${wx}${wy + 1}.x`, Nn = `a${wx}${wy - 1}.x`;
        L.push(`vec2 b${wx}${wy}=react(${c}.x,${c}.y,f${wx}${wy}.x*(${E}-${c}.x)+f${wx}${wy}.y*(${W}-${c}.x)+f${wx}${wy}.z*(${S}-${c}.x)+f${wx}${wy}.w*(${Nn}-${c}.x),e${wx}${wy},g${wx}${wy},vec2(float(${cx})+0.5,float(${cy})+0.5));`);
        n.push(`b${wx}${wy}`);
      }
      L.push(`vec4 o=vec4(${n[0]},${n[1]});`);
    }
    L.push('oS=o;');
    if (maps) {
      L.push(`vec4 A=texelFetch(uMA,p,0),B=texelFetch(uMB,p,0),C=texelFetch(uMC,p,0);float span=uT1-uT0;
  float up=C.x,un=o.x;
  if(up<0.5&&un>=0.5){float tc=uT0+(0.5-up)/max(un-up,1e-6)*span;C.z=tc-A.x;B.z=tc-A.z;A.x=tc;}
  if(up>=0.1&&un<0.1&&A.x>A.z){float tr=uT0+(up-0.1)/max(up-un,1e-6)*span;A.z=tr;B.x=tr-A.x;}
  C.x=un;up=C.y;un=o.z;
  if(up<0.5&&un>=0.5){float tc=uT0+(0.5-up)/max(un-up,1e-6)*span;C.w=tc-A.y;B.w=tc-A.w;A.y=tc;}
  if(up>=0.1&&un<0.1&&A.y>A.w){float tr=uT0+(up-0.1)/max(up-un,1e-6)*span;A.w=tr;B.y=tr-A.y;}
  C.y=un;oA=A;oB=B;oC=C;`);
    }
    L.push('}');
    return L.join('\n');
  };

  // pseudo-ECG reduction, level 1: one fragment per (coarse row r, electrode group g, column chunk ch of 32 columns)
  const ECG1 = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uS,uW;out vec4 o;
void main(){int r=int(gl_FragCoord.x);int j=int(gl_FragCoord.y)%24;int g=j/8,ch=j-g*8;vec4 acc=vec4(0.0);
  for(int k=0;k<32;k++){int c=ch*32+k;vec4 a=texelFetch(uS,ivec2(c,2*r),0),b=texelFetch(uS,ivec2(c,2*r+1),0);
    float u=0.25*(a.x+a.z+b.x+b.z);acc+=u*texelFetch(uW,ivec2(c,r+256*g),0);}
  o=acc;}`;
  // topological charge of the 2 x 2 plaquettes whose first corner is one of the texel's two cells (+1, -1 or 0),
  // written as 0.5 + 0.5 q; theta = atan2(v - v*, u - u*), a plaquette counts only if its 4 corners are excitable
  const CHARGE = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uS,uP;uniform vec2 uStar;out vec4 o;
const float PI=3.14159265;
float wrapd(float d){return d-6.28318531*floor((d+PI)/6.28318531);}
void main(){ivec2 p=ivec2(gl_FragCoord.xy);ivec2 mx=ivec2(${HW - 1},${N - 1});
  vec4 s00=texelFetch(uS,p,0),s10=texelFetch(uS,min(p+ivec2(1,0),mx),0),s01=texelFetch(uS,min(p+ivec2(0,1),mx),0),s11=texelFetch(uS,min(p+ivec2(1,1),mx),0);
  vec4 p00=texelFetch(uP,p,0),p10=texelFetch(uP,min(p+ivec2(1,0),mx),0),p01=texelFetch(uP,min(p+ivec2(0,1),mx),0),p11=texelFetch(uP,min(p+ivec2(1,1),mx),0);
  // cells: a=(2X,y) b=(2X+1,y) c=(2X+2,y) and d,e,f one row down
  float ta=atan(s00.y-uStar.y,s00.x-uStar.x),tb=atan(s00.w-uStar.y,s00.z-uStar.x),tc=atan(s10.y-uStar.y,s10.x-uStar.x);
  float td=atan(s01.y-uStar.y,s01.x-uStar.x),te=atan(s01.w-uStar.y,s01.z-uStar.x),tf=atan(s11.y-uStar.y,s11.x-uStar.x);
  bool oa=p00.y>0.5,ob=p00.w>0.5,oc=p10.y>0.5,od=p01.y>0.5,oe=p01.w>0.5,of=p11.y>0.5;
  float q0=0.0,q1=0.0;
  if(oa&&ob&&od&&oe){float s=wrapd(tb-ta)+wrapd(te-tb)+wrapd(td-te)+wrapd(ta-td);if(abs(s)>3.14159)q0=sign(s);}
  if(ob&&oc&&oe&&of){float s=wrapd(tc-tb)+wrapd(tf-tc)+wrapd(te-tf)+wrapd(tb-te);if(abs(s)>3.14159)q1=sign(s);}
  o=vec4(0.5+0.5*q0,0.5+0.5*q1,0.0,1.0);}`;

  // one readout draw fills the whole readback texture:
  //   row 0: pseudo-ECG level 2 (3 samples x 3 groups x 8 column chunks), rows 1-2: gather of listed cells,
  //   rows 3-10: phase singularities per 16 x 16 block, rows 11-26: a rotating slice of the 128 x 128 maps
  const READOUT = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uS,uP,uBM,uE,uMA,uMB,uMC,uPts,uQ;uniform vec2 uStar;uniform int uSlice,uGR;out vec4 o;
const float PI=3.14159265;
float wrapd(float d){return d-6.28318531*floor((d+PI)/6.28318531);}
vec4 ecg(int j){vec4 acc=vec4(0.0);if(j>=144)return acc;for(int r=0;r<256;r++)acc+=texelFetch(uE,ivec2(r,j),0);return acc;}
vec4 gather(int idx){vec4 pt=texelFetch(uPts,ivec2(idx%${RBW},idx/${RBW}),0);if(pt.x<0.0)return vec4(0.0);
  ivec2 cell=ivec2(pt.xy);ivec2 t=ivec2(cell.x>>1,cell.y);vec4 s=texelFetch(uS,t,0);vec4 a=texelFetch(uMA,t,0);
  bool odd=(cell.x&1)==1;return odd?vec4(s.z,s.w,a.y,a.w):vec4(s.x,s.y,a.x,a.z);}
vec4 ps(int idx){int bx=idx%32,by=idx/32;float np=0.0,nn=0.0,first=-1.0,second=-1.0;
  if(texelFetch(uBM,ivec2(bx,by),0).x<0.5)return vec4(0.0,0.0,-1.0,-1.0);
  for(int j=0;j<16;j++)for(int i=0;i<8;i++){vec4 q=texelFetch(uQ,ivec2(bx*8+i,by*16+j),0);
    for(int k=0;k<2;k++){float c=(k==0?q.x:q.y)*2.0-1.0;if(abs(c)>0.5){float code=float(j*16+i*2+k)+(c>0.0?256.0:0.0);
      if(c>0.0)np+=1.0;else nn+=1.0;if(first<0.0)first=code;else if(second<0.0)second=code;}}}
  return vec4(np,nn,first,second);}
vec4 mapslice(int row,int cx){int cy=uSlice*16+row;ivec2 cell=ivec2(cx*4+2,cy*4+2);ivec2 t=ivec2(cell.x>>1,cell.y);
  vec4 a=texelFetch(uMA,t,0),b=texelFetch(uMB,t,0),c=texelFetch(uMC,t,0),p=texelFetch(uP,t,0);return vec4(a.x,b.x,c.z,p.y);}
void main(){ivec2 f=ivec2(gl_FragCoord.xy);
  if(f.y<2)o=ecg(f.y*${RBW}+f.x);
  else if(f.y<uGR+2&&f.y>=uGR)o=gather((f.y-uGR)*${RBW}+f.x);
  else if(f.y<14)o=ps((f.y-6)*${RBW}+f.x);
  else o=mapslice(f.y-14,f.x);}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n').slice(0, 3000));
    return s;
  }
  RE.program = function (gl, fs, names, vs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs || VS));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = {};
    for (const n of names) p.u[n] = gl.getUniformLocation(p, n);
    return p;
  };
  function tex(gl, w, h, ifmt, fmt, type, data, linear) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  RE.tex = tex;
  function fbo(gl, list) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    list.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(list.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + st);
    return f;
  }

  class Solver {
    constructor(gl, A, params) {
      this.gl = gl;
      this.A = A;
      this.p = Object.assign({ k: 8, a: 0.15, eps0: 0.002, mu1: 0.2, mu2: 0.3, dt: 0.02, dx: 0.3 }, params || {});
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float missing');
      const F = gl.FLOAT;
      // packed props: eps factor and flag (0 inert, 1 excitable atrial/nodal, 2 excitable ventricular)
      const T = RE.T;
      const props = new Float32Array(HW * N * 4);
      const faces = A.faces;
      for (let i = 0; i < N * N; i++) {
        const t = A.type[i];
        const fl = A.D[i] > 0 ? (t === T.MYO || t === T.BZ ? 2 : 1) : 0;
        const x = i % N, y = (i / N) | 0;
        const o = (y * HW + (x >> 1)) * 4 + (x & 1) * 2;
        props[o] = A.eps[i];
        props[o + 1] = fl;
      }
      this.tS = [0, 1].map(() => tex(gl, HW, N, gl.RGBA32F, gl.RGBA, F));
      this.tA = [0, 1].map(() => tex(gl, HW, N, gl.RGBA32F, gl.RGBA, F));
      this.tB = [0, 1].map(() => tex(gl, HW, N, gl.RGBA32F, gl.RGBA, F));
      this.tC = [0, 1].map(() => tex(gl, HW, N, gl.RGBA32F, gl.RGBA, F));
      this.tF = tex(gl, N, N, gl.RGBA16F, gl.RGBA, F, faces);
      this.tP = tex(gl, HW, N, gl.RGBA16F, gl.RGBA, F, props);
      this.tW = tex(gl, 256, 768, gl.RGBA32F, gl.RGBA, F, new Float32Array(256 * 768 * 4));
      this.tE = tex(gl, 256, 144, gl.RGBA32F, gl.RGBA, F);
      this.tRB = tex(gl, RBW, RBH, gl.RGBA32F, gl.RGBA, F);
      this.tPts = tex(gl, RBW, 2, gl.RGBA32F, gl.RGBA, F, new Float32Array(RBW * 2 * 4).fill(-1));
      this.fS = [0, 1].map((i) => fbo(gl, [this.tS[i]]));
      this.fSM = {};
      for (const s of [0, 1]) for (const m of [0, 1]) this.fSM[s + '' + m] = fbo(gl, [this.tS[s], this.tA[m], this.tB[m], this.tC[m]]);
      this.fE = fbo(gl, [this.tE]);
      this.fRB = fbo(gl, [this.tRB]);
      const stepU = ['uS', 'uF', 'uP', 'uK', 'uA', 'uEps0', 'uMu1', 'uMu2', 'uDt', 'uInvDx2', 'uShock', 'uStim', 'uNS', 'uPlane'];
      const mapU = [...stepU, 'uMA', 'uMB', 'uMC', 'uT0', 'uT1'];
      this.progs = {
        s1: RE.program(gl, STEP(false, false), stepU, VS_SPAN),
        s2: RE.program(gl, STEP(false, true), stepU, VS_SPAN),
        m1: RE.program(gl, STEP(true, false), mapU, VS_SPAN),
        m2: RE.program(gl, STEP(true, true), mapU, VS_SPAN),
      };
      this.pE1 = RE.program(gl, ECG1, ['uS', 'uW']);
      this.pRO = RE.program(gl, READOUT, ['uS', 'uP', 'uBM', 'uE', 'uMA', 'uMB', 'uMC', 'uPts', 'uQ', 'uStar', 'uSlice', 'uGR']);
      this.half = 0; // 0: first frame of a pair (no readback), 1: second frame (readback of both)
      this.pairInfo = [];
      this.pQ = RE.program(gl, CHARGE, ['uS', 'uP', 'uStar'], VS_SPAN);
      const q0 = new Uint8Array(HW * N * 4);
      for (let i = 0; i < HW * N; i++) { q0[i * 4] = 128; q0[i * 4 + 1] = 128; q0[i * 4 + 3] = 255; }
      this.tQ = tex(gl, HW, N, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, q0);
      this.fQ = fbo(gl, [this.tQ]);
      this.vao = gl.createVertexArray();
      // the solver only rasterises texel runs that contain tissue; every other texel is constant zero
      const quads = [];
      let texels = 0;
      for (let y = 0; y < N; y++) {
        let x0 = -1;
        for (let X = 0; X <= HW; X++) {
          const on = X < HW && (A.D[y * N + 2 * X] > 0 || A.D[y * N + 2 * X + 1] > 0);
          if (on && x0 < 0) x0 = X;
          if (!on && x0 >= 0) {
            const a = (x0 / HW) * 2 - 1, b = (X / HW) * 2 - 1, c = (y / N) * 2 - 1, d = ((y + 1) / N) * 2 - 1;
            quads.push(a, c, b, c, a, d, a, d, b, c, b, d);
            texels += X - x0;
            x0 = -1;
          }
        }
      }
      this.spanVerts = quads.length / 2;
      this.spanTexels = texels;
      this.spanVao = gl.createVertexArray();
      gl.bindVertexArray(this.spanVao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quads), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      // 32 x 32 block mask (blocks of 16 x 16 cells containing excitable tissue) for the phase-singularity pass
      const bm = new Uint8Array(32 * 32 * 4);
      for (let i = 0; i < N * N; i++) if (A.D[i] > 0) bm[((((i / N) | 0) >> 4) * 32 + ((i % N) >> 4)) * 4] = 255;
      this.tBM = tex(gl, 32, 32, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      // two pixel-pack buffers: a readback is read one frame after the next one was issued, so its copy is done
      this.pbos = [0, 1].map(() => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, RBW * RBH * 16, gl.STREAM_READ);
        return b;
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.queue = [];
      this.rbCount = 0;
      this.rb = new Float32Array(RBW * RBH * 4);
      this.cur = 0; // state index
      this.mcur = 0; // maps index
      this.t = 0; // ms
      this.pending = false;
      this.pendingInfo = null;
      this.slice = 0;
      this.steps = 0;
      this.stimBuf = new Float32Array(MAXS * 4);
      this.reset();
    }
    get dtms() {
      return this.p.dt * RE.TMS;
    }
    reset() {
      const gl = this.gl;
      const z = new Float32Array(HW * N * 4);
      const mA = new Float32Array(HW * N * 4);
      for (let i = 0; i < HW * N; i++) {
        mA[i * 4] = mA[i * 4 + 1] = -10000;
        mA[i * 4 + 2] = mA[i * 4 + 3] = -9999;
      }
      for (const i of [0, 1]) {
        gl.bindTexture(gl.TEXTURE_2D, this.tS[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, N, gl.RGBA, gl.FLOAT, z);
        gl.bindTexture(gl.TEXTURE_2D, this.tA[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, N, gl.RGBA, gl.FLOAT, mA);
        gl.bindTexture(gl.TEXTURE_2D, this.tB[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, N, gl.RGBA, gl.FLOAT, z);
        gl.bindTexture(gl.TEXTURE_2D, this.tC[i]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, N, gl.RGBA, gl.FLOAT, z);
      }
      this.t = 0;
    }
    setWeights(w) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tW);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 768, gl.RGBA, gl.FLOAT, w);
    }
    setPoints(list) {
      const gl = this.gl;
      const a = new Float32Array(RBW * 2 * 4).fill(-1);
      list.forEach((p, i) => {
        a[i * 4] = p.x;
        a[i * 4 + 1] = p.y;
      });
      gl.bindTexture(gl.TEXTURE_2D, this.tPts);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, RBW, 2, gl.RGBA, gl.FLOAT, a);
      this.nPts = list.length;
    }
    // reads the readback of the previous frame (blocks only if its GPU work is unfinished)
    // the readback issued two frames ago (in the frame after the next pair's first frame)
    collect(all) {
      const q = this.queue;
      if (!q.length) return null;
      if (!all && !(q.length >= 2 || (q.length === 1 && this.half === 1))) return null;
      const e = q.shift();
      const gl = this.gl;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, e.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.rb);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (e.fence) gl.deleteSync(e.fence);
      this.pending = q.length > 0;
      return Object.assign({ rb: this.rb }, e.info);
    }
    // GPU timer queries (EXT_disjoint_timer_query_webgl2), polled without blocking; results arrive a few frames late
    timerBegin() {
      const gl = this.gl;
      if (this.tqx === undefined) {
        this.tqx = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;
        this.tqPending = [];
        this.gpuMs = null;
        this.gpuSamples = 0;
      }
      if (!this.tqx) return null;
      // collect finished queries
      while (this.tqPending.length) {
        const q = this.tqPending[0];
        if (!gl.getQueryParameter(q.q, gl.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = gl.getParameter(this.tqx.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q.q, gl.QUERY_RESULT);
        if (!disjoint && ns > 0) {
          const ms = ns / 1e6;
          this.gpuMs = this.gpuMs === null ? ms : this.gpuMs * 0.9 + ms * 0.1;
          this.gpuLast = ms;
          this.gpuSteps = q.n;
          this.gpuSamples++;
        }
        gl.deleteQuery(q.q);
        this.tqPending.shift();
      }
      if (this.tqPending.length > 6) return null;
      const q = gl.createQuery();
      gl.beginQuery(this.tqx.TIME_ELAPSED_EXT, q);
      this.tqPending.push({ q, n: 0 });
      return q;
    }
    // the draw plan of a frame: steps of 2 (one draw) or 1, hitting the three ECG sample points exactly
    plan(nsub) {
      if (this._plan && this._plan.key === nsub) return this._plan;
      const marks = [Math.round(nsub / 3), Math.round((2 * nsub) / 3), nsub];
      const draws = [];
      let at = 0;
      marks.forEach((m, mi) => {
        while (at < m) {
          const n = m - at >= 2 ? 2 : 1;
          draws.push({ n, ecg: -1 });
          at += n;
        }
        draws[draws.length - 1].ecg = mi;
      });
      this._plan = { key: nsub, draws, marks };
      return this._plan;
    }
    // runs nsub substeps; hooks.stimAt(t) returns the active stimulus list at time t (ms), hooks.shockAt(t) the uniform
    // shock current, hooks.planeAt(t) the cross-field half plane [nx, ny, c, amp] or null
    advance(nsub, hooks) {
      const gl = this.gl, p = this.p;
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      const t0 = this.t;
      const dtms = this.dtms;
      const { draws } = this.plan(nsub);
      const ecgT = [];
      // GPU timer: the solver pass (substeps + ECG reductions) is timed on the GPU itself
      const tq = this.timerBegin();
      let at = 0;
      let curProg = null;
      for (let d = 0; d < draws.length; d++) {
        const dr = draws[d];
        const last = d === draws.length - 1;
        const prog = last ? (dr.n === 2 ? this.progs.m2 : this.progs.m1) : dr.n === 2 ? this.progs.s2 : this.progs.s1;
        const tk = t0 + at * dtms;
        gl.bindVertexArray(this.spanVao);
        if (prog !== curProg) {
          gl.useProgram(prog);
          curProg = prog;
          const U = prog.u;
          gl.uniform1i(U.uS, 0);
          gl.uniform1i(U.uF, 1);
          gl.uniform1i(U.uP, 2);
          gl.uniform1f(U.uK, p.k);
          gl.uniform1f(U.uA, p.a);
          gl.uniform1f(U.uEps0, p.eps0);
          gl.uniform1f(U.uMu1, p.mu1);
          gl.uniform1f(U.uMu2, p.mu2);
          gl.uniform1f(U.uDt, p.dt);
          gl.uniform1f(U.uInvDx2, 1 / (p.dx * p.dx));
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this.tF);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, this.tP);
          prog.key = null;
        }
        // stimuli active at this draw (sampled at its first substep)
        const st = hooks.stimAt(tk);
        const shock = hooks.shockAt(tk);
        const plane = hooks.planeAt(tk);
        let key = shock + '|' + (plane ? plane.join(',') : '');
        for (const x of st) key += ',' + x.id;
        const U = prog.u;
        if (key !== prog.key) {
          const n = Math.min(MAXS, st.length);
          for (let i = 0; i < n; i++) {
            this.stimBuf[i * 4] = st[i].x + 0.5;
            this.stimBuf[i * 4 + 1] = st[i].y + 0.5;
            this.stimBuf[i * 4 + 2] = st[i].r * st[i].r;
            this.stimBuf[i * 4 + 3] = st[i].amp;
          }
          gl.uniform4fv(U.uStim, this.stimBuf);
          gl.uniform1i(U.uNS, n);
          gl.uniform1f(U.uShock, shock);
          gl.uniform4f(U.uPlane, ...(plane || [0, 0, 0, 0]));
          prog.key = key;
        }
        if (last) {
          gl.uniform1i(U.uMA, 3);
          gl.uniform1i(U.uMB, 4);
          gl.uniform1i(U.uMC, 5);
          gl.uniform1f(U.uT0, t0);
          gl.uniform1f(U.uT1, t0 + nsub * dtms);
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, this.tA[this.mcur]);
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, this.tB[this.mcur]);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, this.tC[this.mcur]);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fSM[1 - this.cur + '' + (1 - this.mcur)]);
        } else gl.bindFramebuffer(gl.FRAMEBUFFER, this.fS[1 - this.cur]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.tS[this.cur]);
        gl.viewport(0, 0, HW, N);
        gl.drawArrays(gl.TRIANGLES, 0, this.spanVerts);
        this.cur = 1 - this.cur;
        if (last) this.mcur = 1 - this.mcur;
        at += dr.n;
        if (dr.ecg >= 0) {
          this.ecgReduce(dr.ecg + 3 * this.half);
          ecgT.push(t0 + at * dtms);
          curProg = null;
        }
      }
      if (tq) {
        gl.endQuery(this.tqx.TIME_ELAPSED_EXT);
        this.tqPending[this.tqPending.length - 1].n = nsub;
      }
      this.steps += nsub;
      this.draws = draws.length;
      this.t = t0 + nsub * dtms;
      this.pairInfo.push({ t: this.t, ecgT });
      if (this.half === 0) {
        this.gatherOnly();
        this.half = 1;
      } else {
        this.readout();
        this.queue[this.queue.length - 1].info = { frames: this.pairInfo, slice: this.slice, t: this.t };
        this.pairInfo = [];
        this.slice = (this.slice + 1) % 8;
        this.half = 0;
      }
      return this.t;
    }
    ecgReduce(k) {
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.pE1);
      gl.uniform1i(this.pE1.u.uS, 0);
      gl.uniform1i(this.pE1.u.uW, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tW);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tS[this.cur]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fE);
      gl.viewport(0, k * 24, 256, 24);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // gather of the first frame of a pair into rows 2-3 (state and LAT at that moment)
    gatherOnly() {
      const gl = this.gl, P = this.pRO, U = P.u;
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fRB);
      gl.useProgram(P);
      const bind = (unit, name, t) => {
        gl.uniform1i(U[name], unit);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
      };
      bind(0, 'uS', this.tS[this.cur]);
      bind(4, 'uMA', this.tA[this.mcur]);
      bind(7, 'uPts', this.tPts);
      gl.uniform1i(U.uGR, 2);
      gl.viewport(0, 2, RBW, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    readout() {
      const gl = this.gl, P = this.pRO, U = P.u;
      // charge pass over the tissue spans
      gl.bindVertexArray(this.spanVao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fQ);
      gl.useProgram(this.pQ);
      gl.uniform1i(this.pQ.u.uS, 0);
      gl.uniform1i(this.pQ.u.uP, 1);
      gl.uniform2f(this.pQ.u.uStar, 0.5, 1.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tS[this.cur]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tP);
      gl.viewport(0, 0, HW, N);
      gl.drawArrays(gl.TRIANGLES, 0, this.spanVerts);
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fRB);
      gl.useProgram(P);
      const bind = (unit, name, t) => {
        gl.uniform1i(U[name], unit);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
      };
      bind(0, 'uS', this.tS[this.cur]);
      bind(1, 'uP', this.tP);
      bind(2, 'uBM', this.tBM);
      bind(3, 'uE', this.tE);
      bind(4, 'uMA', this.tA[this.mcur]);
      bind(5, 'uMB', this.tB[this.mcur]);
      bind(6, 'uMC', this.tC[this.mcur]);
      bind(7, 'uPts', this.tPts);
      bind(8, 'uQ', this.tQ);
      gl.uniform2f(U.uStar, 0.5, 1.0);
      gl.uniform1i(U.uSlice, this.slice);
      gl.uniform1i(U.uGR, 4);
      gl.viewport(0, 0, RBW, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.viewport(0, 4, RBW, RBH - 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      const pbo = this.pbos[this.rbCount++ % 2];
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(0, 0, RBW, RBH, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.queue.push({ pbo, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0), info: null });
      gl.flush();
      this.pending = true;
    }
    // the 9 electrode sums of ECG sample s (0..2) from a readback
    ecgSample(rb, s, out) {
      for (let e = 0; e < 9; e++) {
        const g = (e / 4) | 0, ch = e % 4;
        let v = 0;
        for (let c = 0; c < 8; c++) v += rb[(s * 24 + g * 8 + c) * 4 + ch]; // rows 0-1 are contiguous
        out[e] = v;
      }
      return out;
    }
    // checkpoint of the GPU state (state and maps) and the solver clock
    save() {
      const gl = this.gl;
      if (!this.bk) {
        this.bk = [0, 1, 2, 3].map(() => tex(gl, HW, N, gl.RGBA32F, gl.RGBA, gl.FLOAT));
        this.bkF = this.bk.map((t) => fbo(gl, [t]));
        this.srcF = {};
      }
      const src = [this.tS[this.cur], this.tA[this.mcur], this.tB[this.mcur], this.tC[this.mcur]];
      src.forEach((t, i) => this.blit(t, this.bkF[i]));
      this.saved = { t: this.t, steps: this.steps, slice: this.slice };
    }
    restore() {
      const gl = this.gl;
      const dst = [this.tS[this.cur], this.tA[this.mcur], this.tB[this.mcur], this.tC[this.mcur]];
      dst.forEach((t, i) => {
        const f = fbo(gl, [t]);
        this.blit(this.bk[i], f);
        gl.deleteFramebuffer(f);
      });
      Object.assign(this, this.saved);
      this.pending = false;
      this.queue = [];
      this.half = 0;
      this.pairInfo = [];
    }
    blit(srcTex, dstFbo) {
      const gl = this.gl;
      const rf = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rf);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, srcTex, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFbo);
      gl.blitFramebuffer(0, 0, HW, N, 0, 0, HW, N, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.deleteFramebuffer(rf);
    }
    // full-resolution snapshot of u (for the dev lab only)
    snapshot() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fS[this.cur]);
      const a = new Float32Array(HW * N * 4);
      gl.readPixels(0, 0, HW, N, gl.RGBA, gl.FLOAT, a);
      return a;
    }
  }
  RE.Solver = Solver;
})();

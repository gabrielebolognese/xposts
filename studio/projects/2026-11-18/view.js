// Reentry: GPU display of the tissue (hero voltage map) and the three electrophysiology maps, drawn straight from the
// solver's textures into the shared WebGL canvas.
(function () {
  const RE = window.RE;
  const N = RE.N, T = RE.T;

  const COMMON = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uS,uMA,uMB,uLook,uLook2;uniform vec4 uRect;uniform vec3 uCrop;uniform float uDpr;out vec4 o;
float uAt(ivec2 c){c=clamp(c,ivec2(0),ivec2(${N - 1}));vec4 s=texelFetch(uS,ivec2(c.x>>1,c.y),0);return (c.x&1)==1?s.z:s.x;}
float vAt(ivec2 c){c=clamp(c,ivec2(0),ivec2(${N - 1}));vec4 s=texelFetch(uS,ivec2(c.x>>1,c.y),0);return (c.x&1)==1?s.w:s.y;}
float latAt(ivec2 c){c=clamp(c,ivec2(0),ivec2(${N - 1}));vec4 a=texelFetch(uMA,ivec2(c.x>>1,c.y),0);return (c.x&1)==1?a.y:a.x;}
float apdAt(ivec2 c){c=clamp(c,ivec2(0),ivec2(${N - 1}));vec4 b=texelFetch(uMB,ivec2(c.x>>1,c.y),0);return (c.x&1)==1?b.y:b.x;}
float mAt(ivec2 c){c=clamp(c,ivec2(0),ivec2(${N - 1}));return texelFetch(uLook2,c,0).a;}
vec2 cellCoord(){vec2 f=(gl_FragCoord.xy-uRect.xy)/uRect.zw;return uCrop.xy+vec2(f.x,(1.0-f.y)*uRect.w/uRect.z)*uCrop.z;}
vec3 hex(float r,float g,float b){return vec3(r,g,b)/255.0;}
// Vm colour map: slate (-80 mV), teal, amber, crimson (+20 mV)
vec3 vmColor(float u){
  vec3 c0=hex(138.,152.,172.),c1=hex(96.,150.,166.),c2=hex(14.,140.,122.),c3=hex(232.,163.,61.),c4=hex(222.,92.,46.),c5=hex(200.,16.,46.);
  float x=clamp(u,0.0,1.0);
  if(x<0.12)return mix(c0,c1,x/0.12);
  if(x<0.32)return mix(c1,c2,(x-0.12)/0.2);
  if(x<0.58)return mix(c2,c3,(x-0.32)/0.26);
  if(x<0.8)return mix(c3,c4,(x-0.58)/0.22);
  return mix(c4,c5,(x-0.8)/0.2);
}
float aaLine(float d,float w){float fw=max(fwidth(d),1e-4);return 1.0-smoothstep(w*0.5*fw,(w*0.5+1.0)*fw,abs(d));}
`;

  const HERO = COMMON + `
uniform float uTref,uIsoOn,uFlash,uIsoSpan,uModCL,uTnow;
void main(){
  vec2 c=cellCoord();
  vec4 L=texture(uLook,c/${N}.0);   // r tissue, g scar, b border zone, a blood
  vec4 L2=texture(uLook2,c/${N}.0); // r fibrous, g atria, b AV node / His
  vec3 col=vec3(1.0);
  // background: faint registration dots every 32 cells, soft drop shadow of the slice
  vec2 g=fract(c/32.0+0.5)-0.5;float dots=1.0-smoothstep(0.0,0.035,length(g));col=mix(col,hex(221.,213.,203.),dots*0.8);
  float sh=0.0;
  for(int i=0;i<4;i++){vec2 o2=vec2(2.5,3.5)+vec2(float(i&1),float(i>>1))*2.0;sh+=texture(uLook,(c-o2)/${N}.0).r+texture(uLook2,(c-o2)/${N}.0).r*0.6;}
  col*=1.0-0.10*clamp(sh*0.25,0.0,1.0);
  col=mix(col,hex(248.,238.,236.),smoothstep(0.35,0.65,L.a));                 // blood
  col=mix(col,hex(229.,219.,203.),smoothstep(0.35,0.65,L2.r));                // fibrous annulus / central body
  // tissue: bilinear u and LAT over excitable neighbours only
  vec2 q=c-0.5;ivec2 i0=ivec2(floor(q));vec2 f=fract(q);
  float m00=mAt(i0),m10=mAt(i0+ivec2(1,0)),m01=mAt(i0+ivec2(0,1)),m11=mAt(i0+ivec2(1,1));
  float u00=uAt(i0),u10=uAt(i0+ivec2(1,0)),u01=uAt(i0+ivec2(0,1)),u11=uAt(i0+ivec2(1,1));
  float w00=(1.-f.x)*(1.-f.y)*m00,w10=f.x*(1.-f.y)*m10,w01=(1.-f.x)*f.y*m01,w11=f.x*f.y*m11;float ws=w00+w10+w01+w11;
  float tis=smoothstep(0.38,0.62,L.r);
  if(ws>1e-4&&tis>0.0){
    float u=(w00*u00+w10*u10+w01*u01+w11*u11)/ws;
    float vv=(w00*vAt(i0)+w10*vAt(i0+ivec2(1,0))+w01*vAt(i0+ivec2(0,1))+w11*vAt(i0+ivec2(1,1)))/ws;
    vec3 tc=vmColor(u);
    // activation front: freshly excited tissue (u high, recovery variable still low) glows hot
    float front=smoothstep(0.35,0.85,u)*(1.0-smoothstep(0.05,0.45,vv));
    tc=mix(tc,hex(255.,214.,140.),0.42*front);
    // relief: normal from the bilinear gradient of u, light from the upper left
    float gx=mix(u10-u00,u11-u01,f.y),gy=mix(u01-u00,u11-u10,f.x);
    vec3 n=normalize(vec3(-gx*5.0,-gy*5.0,1.0));vec3 l=normalize(vec3(-0.45,-0.55,0.9));
    float dif=clamp(dot(n,l),0.0,1.0);float spec=pow(clamp(dot(reflect(-l,n),vec3(0.,0.,1.)),0.0,1.0),28.0);
    tc=tc*(0.74+0.32*dif)+spec*0.22*smoothstep(0.15,0.6,u);
    // bevel: wall relief from the gradient of the smoothed tissue mask
    float mx1=texture(uLook,(c+vec2(1.6,0.0))/${N}.0).r-texture(uLook,(c-vec2(1.6,0.0))/${N}.0).r;
    float my1=texture(uLook,(c+vec2(0.0,1.6))/${N}.0).r-texture(uLook,(c-vec2(0.0,1.6))/${N}.0).r;
    vec3 nb=normalize(vec3(-mx1*1.6,-my1*1.6,1.0));
    float bev=dot(nb,normalize(vec3(-0.5,-0.6,0.62)))-0.62;
    tc*=1.0+0.55*bev;
    // isochrones of the current beat
    if(uIsoOn>0.5){
      float a00=latAt(i0),a10=latAt(i0+ivec2(1,0)),a01=latAt(i0+ivec2(0,1)),a11=latAt(i0+ivec2(1,1));
      float lmin=min(min(a00,a10),min(a01,a11)),lmax=max(max(a00,a10),max(a01,a11));
      float lat=(w00*a00+w10*a10+w01*a01+w11*a11)/ws-uTref;
      if(uModCL>0.0){
        // reentry: isochrones of LAT modulo the cycle length
        if(uTnow-lmax<2.0*uModCL&&lmax-lmin<25.0&&L2.g<0.5){float n=floor(uModCL/50.0+0.5);float d=fract(fract(lat/uModCL)*n+0.5)-0.5;tc=mix(tc,hex(28.,31.,38.),0.22*aaLine(d,0.8*uDpr));}
      }else if(lmin-uTref>-2.0&&lat<uIsoSpan&&lmax-lmin<25.0){float d=fract(lat/20.0+0.5)-0.5;tc=mix(tc,hex(28.,31.,38.),0.26*aaLine(d,0.8*uDpr));}
    }
    col=mix(col,tc,tis);
  }
  // scar: grey with diagonal hatching
  float sc=smoothstep(0.35,0.65,L.g);
  if(sc>0.0){float h=fract((gl_FragCoord.x+gl_FragCoord.y)/(5.0*uDpr));vec3 scol=mix(hex(172.,166.,160.),hex(108.,103.,98.),1.0-smoothstep(0.12,0.24,abs(h-0.5)));col=mix(col,scol,sc);}
  // outlines: tissue boundary, border zone (purple), AV node / His (amber)
  col=mix(col,hex(36.,50.,79.),0.55*aaLine(L.r-0.5,1.0*uDpr)*step(0.02,L.r)*step(L.r,0.98));
  float bzs=L.b+L.g;col=mix(col,hex(107.,79.,163.),0.95*aaLine(bzs-0.5,1.3*uDpr)*step(0.02,bzs)*step(bzs,0.98));
  col=mix(col,hex(232.,163.,61.),0.9*aaLine(L2.b-0.5,1.1*uDpr)*step(0.02,L2.b)*step(L2.b,0.98));
  // defibrillation flash
  col=mix(col,vec3(0.86,0.91,1.0),uFlash*0.55);
  o=vec4(col,1.0);
}`;

  // maps: 0 LAT of the current beat, 1 APD, 2 phase
  const MAP = COMMON + `
uniform int uMode;uniform float uTref,uSpan,uTnow,uModCL;
vec3 rainbow(float x){x=clamp(x,0.0,1.0);
  vec3 a=hex(200.,16.,46.),b=hex(232.,120.,40.),c=hex(236.,196.,64.),d=hex(70.,170.,96.),e=hex(47.,111.,176.),f=hex(107.,79.,163.);
  if(x<0.2)return mix(a,b,x/0.2);if(x<0.4)return mix(b,c,(x-0.2)/0.2);if(x<0.6)return mix(c,d,(x-0.4)/0.2);if(x<0.8)return mix(d,e,(x-0.6)/0.2);return mix(e,f,(x-0.8)/0.2);}
vec3 seq(float x){x=clamp(x,0.0,1.0);vec3 a=hex(36.,50.,79.),b=hex(47.,111.,176.),c=hex(14.,140.,122.),d=hex(232.,163.,61.),e=hex(250.,236.,200.);
  if(x<0.25)return mix(a,b,x/0.25);if(x<0.5)return mix(b,c,(x-0.25)/0.25);if(x<0.75)return mix(c,d,(x-0.5)/0.25);return mix(d,e,(x-0.75)/0.25);}
vec3 cyc(float th){float x=fract(th/6.28318531+1.0)*6.0;
  vec3 p[6];p[0]=hex(200.,16.,46.);p[1]=hex(232.,163.,61.);p[2]=hex(236.,214.,120.);p[3]=hex(14.,140.,122.);p[4]=hex(47.,111.,176.);p[5]=hex(107.,79.,163.);
  int k=int(floor(x));float r=fract(x);return mix(p[k%6],p[(k+1)%6],r);}
void main(){
  vec2 c=cellCoord();ivec2 ic=ivec2(floor(c));
  vec4 L=texture(uLook,c/${N}.0);vec4 L2=texture(uLook2,c/${N}.0);
  vec3 col=vec3(1.0);
  col=mix(col,hex(246.,240.,238.),smoothstep(0.35,0.65,L.a));
  col=mix(col,hex(229.,219.,203.),smoothstep(0.35,0.65,L2.r));
  float tis=smoothstep(0.3,0.7,L.r);
  if(tis>0.0&&(mAt(ic)>0.5||uMode==3)){
    vec3 tc;
    if(uMode==0){float la=latAt(ic);float lat=la-uTref;
      if(uModCL>0.0){
        if(uTnow-la>2.0*uModCL)tc=hex(206.,203.,198.);
        else{float ph=fract(lat/uModCL);tc=rainbow(ph);float n=floor(uModCL/20.0+0.5);float d=fract(ph*n+0.5)-0.5;tc=mix(tc,hex(28.,31.,38.),0.45*aaLine(d,0.8*uDpr));}
      }else{
        // smoothed: mean of the 3 x 3 neighbourhood of tissue cells activated in this beat
        float s=0.0,n=0.0;
        for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){ivec2 q=ic+ivec2(dx,dy);if(mAt(q)<0.5)continue;float r=latAt(q)-uTref;if(r<-2.0||r>uSpan+60.0)continue;float wgt=3.0-0.5*float(abs(dx)+abs(dy));s+=r*wgt;n+=wgt;}
        if(n<0.5)tc=hex(206.,203.,198.);
        else{float lt=s/n;tc=rainbow(lt/max(uSpan,1.0));float d=fract(lt/20.0+0.5)-0.5;tc=mix(tc,hex(28.,31.,38.),0.32*aaLine(d,0.8*uDpr));}
      }}
    else if(uMode==1){float s=0.0,n=0.0;
      for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){ivec2 q=ic+ivec2(dx,dy);if(mAt(q)<0.5)continue;float a=apdAt(q);if(a<20.0)continue;s+=a;n+=1.0;}
      tc=n<1.0?hex(206.,203.,198.):seq((s/n-120.0)/220.0);}
    else if(uMode==2){float u=uAt(ic),v=vAt(ic);tc=cyc(atan(v-1.0,u-0.5));}
    else{
      // inset: phase from bilinearly interpolated u and v (excitable neighbours only), with a soft relief
      vec2 q=c-0.5;ivec2 i0=ivec2(floor(q));vec2 f=fract(q);
      float m00=mAt(i0),m10=mAt(i0+ivec2(1,0)),m01=mAt(i0+ivec2(0,1)),m11=mAt(i0+ivec2(1,1));
      float w00=(1.-f.x)*(1.-f.y)*m00,w10=f.x*(1.-f.y)*m10,w01=(1.-f.x)*f.y*m01,w11=f.x*f.y*m11;float ws=max(w00+w10+w01+w11,1e-5);
      float u=(w00*uAt(i0)+w10*uAt(i0+ivec2(1,0))+w01*uAt(i0+ivec2(0,1))+w11*uAt(i0+ivec2(1,1)))/ws;
      float v=(w00*vAt(i0)+w10*vAt(i0+ivec2(1,0))+w01*vAt(i0+ivec2(0,1))+w11*vAt(i0+ivec2(1,1)))/ws;
      tc=cyc(atan(v-1.0,u-0.5));
      tc=mix(tc,hex(255.,236.,200.),0.35*smoothstep(0.55,0.95,u)*(1.0-smoothstep(0.05,0.4,v)));
    }
    col=mix(col,tc,tis);
  }
  float sc=smoothstep(0.35,0.65,L.g);
  if(sc>0.0){float h=fract((gl_FragCoord.x+gl_FragCoord.y)/(4.0*uDpr));col=mix(col,mix(hex(172.,166.,160.),hex(108.,103.,98.),1.0-smoothstep(0.12,0.24,abs(h-0.5))),sc);}
  col=mix(col,hex(36.,50.,79.),0.5*aaLine(L.r-0.5,0.9*uDpr)*step(0.02,L.r)*step(L.r,0.98));
  o=vec4(col,1.0);
}`;

  class View {
    constructor(gl, heart, canvasCss) {
      this.gl = gl;
      this.h = heart;
      this.css = canvasCss; // {w, h} of the GL canvas in css px
      const A = heart.A;
      // display masks, lightly blurred so that outlines are smooth curves; the exact binary tissue mask (used to
      // weight the field) is kept in look2.a
      const raw = new Float32Array(N * N * 8);
      for (let i = 0; i < N * N; i++) {
        const t = A.type[i];
        raw[i * 8] = A.D[i] > 0 ? 1 : 0;
        raw[i * 8 + 1] = t === T.SCAR ? 1 : 0;
        raw[i * 8 + 2] = t === T.BZ ? 1 : 0;
        raw[i * 8 + 3] = t === T.BLOOD ? 1 : 0;
        raw[i * 8 + 4] = t === T.ANN || t === T.INS ? 1 : 0;
        raw[i * 8 + 5] = t === T.RA || t === T.LA ? 1 : 0;
        raw[i * 8 + 6] = t === T.AVN || t === T.HIS ? 1 : 0;
      }
      const K = [1, 2, 1];
      const tmp = new Float32Array(N * N * 8), blr = new Float32Array(N * N * 8);
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          for (let c = 0; c < 7; c++) {
            let s = 0;
            for (let d = -1; d <= 1; d++) s += K[d + 1] * raw[(y * N + Math.min(N - 1, Math.max(0, x + d))) * 8 + c];
            tmp[(y * N + x) * 8 + c] = s / 4;
          }
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          for (let c = 0; c < 7; c++) {
            let s = 0;
            for (let d = -1; d <= 1; d++) s += K[d + 1] * tmp[(Math.min(N - 1, Math.max(0, y + d)) * N + x) * 8 + c];
            blr[(y * N + x) * 8 + c] = s / 4;
          }
      const look = new Uint8Array(N * N * 4), look2 = new Uint8Array(N * N * 4);
      for (let i = 0; i < N * N; i++) {
        for (let c = 0; c < 4; c++) look[i * 4 + c] = Math.round(255 * blr[i * 8 + c]);
        for (let c = 0; c < 3; c++) look2[i * 4 + c] = Math.round(255 * blr[i * 8 + 4 + c]);
        look2[i * 4 + 3] = A.D[i] > 0 ? 255 : 0;
      }
      this.tLook = RE.tex(gl, N, N, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, look, true);
      this.tLook2 = RE.tex(gl, N, N, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, look2, true);
      const common = ['uS', 'uMA', 'uMB', 'uLook', 'uLook2', 'uRect', 'uCrop', 'uDpr'];
      this.pHero = RE.program(gl, HERO, [...common, 'uTref', 'uIsoOn', 'uFlash', 'uIsoSpan', 'uModCL', 'uTnow']);
      this.pMap = RE.program(gl, MAP, [...common, 'uMode', 'uTref', 'uSpan', 'uTnow', 'uModCL']);
      this.vao = gl.createVertexArray();
      // LAT snapshot of the last measured beat (what the LAT map and the isochrones show until the next beat)
      this.tSnap = RE.tex(gl, N / 2, N, gl.RGBA32F, gl.RGBA, gl.FLOAT);
      this.fSnap = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fSnap);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tSnap, 0);
      this.fRead = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.snapped = false;
    }
    snapshot() {
      const gl = this.gl, s = this.h.solver;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fRead);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.tA[s.mcur], 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fSnap);
      gl.blitFramebuffer(0, 0, N / 2, N, 0, 0, N / 2, N, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      this.snapped = true;
    }
    bindCommon(p, rect, dpr, crop, live) {
      const gl = this.gl, s = this.h.solver;
      const H = this.css.h;
      const r = [rect.x * dpr, (H - rect.y - rect.h) * dpr, rect.w * dpr, rect.h * dpr];
      gl.viewport(r[0], r[1], r[2], r[3]);
      gl.uniform4f(p.u.uRect, r[0], r[1], r[2], r[3]);
      gl.uniform1f(p.u.uDpr, dpr);
      gl.uniform3f(p.u.uCrop, crop ? crop.x : 0, crop ? crop.y : 0, crop ? crop.s : N);
      const bind = (unit, name, t) => {
        gl.uniform1i(p.u[name], unit);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
      };
      bind(0, 'uS', s.tS[s.cur]);
      bind(1, 'uMA', this.snapped && !live ? this.tSnap : s.tA[s.mcur]);
      bind(2, 'uMB', s.tB[s.mcur]);
      bind(3, 'uLook', this.tLook);
      bind(4, 'uLook2', this.tLook2);
    }
    hero(rect, dpr, o) {
      const gl = this.gl, p = this.pHero;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(this.vao);
      gl.useProgram(p);
      this.bindCommon(p, rect, dpr, o.crop, o.modCL > 0);
      gl.uniform1f(p.u.uTref, o.tref);
      gl.uniform1f(p.u.uModCL, o.modCL || 0);
      gl.uniform1f(p.u.uTnow, o.tnow || 0);
      gl.uniform1f(p.u.uIsoOn, o.iso ? 1 : 0);
      gl.uniform1f(p.u.uFlash, o.flash || 0);
      gl.uniform1f(p.u.uIsoSpan, o.isoSpan || 400);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    map(rect, dpr, mode, o) {
      const gl = this.gl, p = this.pMap;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(this.vao);
      gl.useProgram(p);
      this.bindCommon(p, rect, dpr, o.crop, mode === 0 && o.modCL > 0);
      gl.uniform1f(p.u.uModCL, mode === 0 ? o.modCL || 0 : 0);
      gl.uniform1i(p.u.uMode, mode);
      gl.uniform1f(p.u.uTref, o.tref);
      gl.uniform1f(p.u.uSpan, o.span);
      gl.uniform1f(p.u.uTnow, o.tnow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  RE.View = View;
})();

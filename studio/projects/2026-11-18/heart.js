// Reentry: the heart = anatomy + GPU solver + conduction system + pacing protocol, stepped frame by frame.
(function () {
  const RE = window.RE;
  const N = RE.N, T = RE.T;

  class Heart {
    constructor(gl, opt) {
      this.o = Object.assign({ hr: 72, saR: 3, saAmp: 2.5, cvP: 8, cvA: 8 }, opt || {});
      this.P = Object.assign(RE.defaultAnatomy(), this.o.anatomy || {});
      this.A = RE.buildAnatomy(this.P);
      this.solver = new RE.Solver(gl, this.A, this.o.model || {});
      this.sys = RE.buildConduction(this.A, { cvP: this.o.cvP, cvA: this.o.cvA, dmg: this.o.dmg ?? 0 });
      this.listeners = [];
      this.resetState();
      // gather list: conduction nodes (His + junctions) first, then probes, the scar loop and the S2 site
      const pts = [];
      this.gIdx = new Map();
      const addPt = (key, x, y) => {
        this.gIdx.set(key, pts.length);
        pts.push({ x: Math.round(x), y: Math.round(y) });
      };
      addPt('n' + this.sys.his.id, this.sys.his.x, this.sys.his.y);
      for (const j of this.cs.junctions) addPt('n' + j.id, j.x, j.y);
      this.probes = this.makeProbes();
      for (const p of this.probes) addPt('p' + p.key, p.x, p.y);
      this.A.loop.forEach((p, i) => addPt('l' + i, p.x, p.y));
      this.s2site = this.makeS2Site();
      addPt('s2', this.s2site.x, this.s2site.y);
      if (pts.length > 256) throw new Error('too many gather points ' + pts.length);
      this.pts = pts;
      this.solver.setPoints(pts);
      this.g = new Float32Array(pts.length * 4);
      this.hooks = {
        stimAt: (t) => {
          const a = this.cs.active(t);
          for (const s of this.extra) if (t >= s.t0 && t < s.t1) a.push(s);
          return a;
        },
        shockAt: (t) => {
          let s = 0;
          for (const k of this.shocks) if (t >= k.t0 && t < k.t1) s += k.amp;
          return s;
        },
        planeAt: (t) => (this.plane && t >= this.plane.t0 && t < this.plane.t1 ? this.plane.v : null),
      };
    }
    resetState() {
      this.cs = new RE.Conduction(this.sys, { retroExit: !!this.o.retroExit });
      this.t = 0;
      this.frame = 0;
      this.nextSA = this.o.saStart ?? 20;
      this.saTimes = [];
      this.extra = []; // protocol stimuli {id, x, y, r, amp, t0, t1}
      this.shocks = []; // {t0, t1, amp}
      this.plane = null; // {t0, t1, v: [nx, ny, c, amp]}
      this.haveG = false;
      if (this.solver) {
        this.solver.reset();
        this.solver.collect();
        this.solver.pending = false;
      }
    }
    // checkpoint of everything (GPU textures, tree, queue, stimuli, clocks)
    save() {
      this.solver.collect();
      this.solver.save();
      const cs = this.cs;
      this.ck = {
        nodes: cs.nodes.map((n) => [n.last, n.lastFrom, n.retro, n.v, n.u]),
        q: cs.q.a.map((e) => ({ ...e })), stims: cs.stims.map((e) => ({ ...e })), jState: new Map(cs.jState), hisLat: cs.hisLat,
        flash: cs.flash.slice(), sid: cs.sid,
        t: this.t, frame: this.frame, nextSA: this.nextSA, saTimes: this.saTimes.slice(), extra: this.extra.map((e) => ({ ...e })),
        shocks: this.shocks.map((e) => ({ ...e })), plane: this.plane, g: this.g.slice(), haveG: this.haveG,
      };
    }
    restore() {
      const k = this.ck, cs = this.cs;
      this.solver.restore();
      cs.nodes.forEach((n, i) => ([n.last, n.lastFrom, n.retro, n.v, n.u] = k.nodes[i]));
      cs.q.a = k.q.map((e) => ({ ...e }));
      cs.stims = k.stims.map((e) => ({ ...e }));
      cs.jState = new Map(k.jState);
      cs.hisLat = k.hisLat;
      cs.flash = k.flash.slice();
      cs.sid = k.sid;
      Object.assign(this, { t: k.t, frame: k.frame, nextSA: k.nextSA, saTimes: k.saTimes.slice(), extra: k.extra.map((e) => ({ ...e })), shocks: k.shocks.map((e) => ({ ...e })), plane: k.plane, haveG: k.haveG });
      this.g.set(k.g);
    }
    makeProbes() {
      const A = this.A, F = A.F, P = this.P;
      const find = (x0, y0, pred, R = 30) => {
        let best = null, bd = 1e9;
        for (let y = Math.max(1, Math.round(y0 - R)); y < Math.min(N - 1, y0 + R); y++)
          for (let x = Math.max(1, Math.round(x0 - R)); x < Math.min(N - 1, x0 + R); x++) {
            if (!pred(A.type[y * N + x], y * N + x)) continue;
            const d = (x - x0) ** 2 + (y - y0) ** 2;
            if (d < bd) { bd = d; best = { x, y }; }
          }
        return best || { x: x0, y: y0 };
      };
      const sa = this.sys.sa;
      const raC = F.toImg(P.ra.u, P.ra.w);
      const lvTis = (t) => t === T.MYO;
      // LV endo / epi probes on the lateral wall above the infarct, the border-zone probe at the isthmus
      const latAng = (P.infarct.ang1 + 22);
      const endoPt = this.wallPoint(latAng, 3), epiPt = this.wallPoint(latAng, P.lvWall - 3);
      const bz = this.wallPoint(P.infarct.isthmusAng, (P.infarct.tau0 + P.infarct.tau1) / 2);
      return [
        { key: 'SA', name: 'SA node', ...find(sa.x, sa.y, (t) => t === T.RA) },
        { key: 'RA', name: 'RA lateral', ...find(raC.x - 70, raC.y + 20, (t) => t === T.RA, 60) },
        { key: 'AV', name: 'AV node', ...find((A.avA.x + A.avB.x) / 2, (A.avA.y + A.avB.y) / 2 + 4, (t) => t === T.AVN) },
        { key: 'His', name: 'His entry', x: Math.round(A.hisC.x), y: Math.round(A.hisC.y) },
        { key: 'LVendo', name: 'LV endo', ...find(endoPt.x, endoPt.y, lvTis, 8) },
        { key: 'LVepi', name: 'LV epi', ...find(epiPt.x, epiPt.y, lvTis, 8) },
        { key: 'BZ', name: 'Border zone', ...find(bz.x, bz.y, (t) => t === T.BZ, 8) },
      ];
    }
    // a point in the LV wall at a given angle around the LV centre and depth from the endocardium
    wallPoint(ang, depth) {
      const A = this.A;
      let best = null, bd = 1e9;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          if (A.type[i] !== T.MYO && A.type[i] !== T.BZ) continue;
          if (A.W[i] < 10) continue;
          const da = Math.abs(A.lvAngle(x, y) - ang), dd = Math.abs(A.dLV[i] - depth);
          const s = da * 2 + dd;
          if (s < bd) { bd = s; best = { x, y }; }
        }
      return best;
    }
    makeS2Site() {
      const P = this.P;
      const inf = P.infarct;
      // border zone at the endocardial side of the scar's upper (basal) end
      const p = this.wallPoint(this.o.s2Ang ?? inf.ang1 + 4, this.o.s2Depth ?? 4);
      return p;
    }
    gatherFrom(arr, key) {
      const i = this.gIdx.get(key);
      return { u: arr[i * 4], v: arr[i * 4 + 1], lat: arr[i * 4 + 2], rep: arr[i * 4 + 3] };
    }
    gather(key) {
      const i = this.gIdx.get(key);
      if (i === undefined || !this.haveG) return null;
      const g = this.g;
      return { u: g[i * 4], v: g[i * 4 + 1], lat: g[i * 4 + 2], rep: g[i * 4 + 3] };
    }
    on(fn) {
      this.listeners.push(fn);
    }
    step(nsub) {
      const s = this.solver;
      const r = s.collect();
      if (r) {
        // a readback holds two frames: sense the tree with each frame's gather in order
        const RB = RE.RB, len = this.g.length;
        r.g = [r.rb.slice(RB.GA * RB.W * 4, RB.GA * RB.W * 4 + len), r.rb.slice(RB.GB * RB.W * 4, RB.GB * RB.W * 4 + len)];
        for (let fi = 0; fi < r.frames.length; fi++) {
          this.g.set(r.g[fi]);
          this.haveG = true;
          this.cs.sense(r.frames[fi].t, (id) => this.gather('n' + id));
        }
        for (const fn of this.listeners) fn(r, this);
      }
      const t0 = s.t, t1 = t0 + nsub * s.dtms;
      // SA node
      while (this.nextSA < t1) {
        const ts = Math.max(this.nextSA, t0);
        const sa = this.sys.sa;
        this.extra.push({ id: 'sa' + this.saTimes.length, x: sa.x, y: sa.y, r: this.o.saR, amp: this.o.saAmp, t0: ts, t1: ts + RE.TMS, kind: 'SA' });
        this.cs.fireSA(ts);
        this.saTimes.push(ts);
        this.nextSA += 60000 / this.o.hr;
      }
      this.cs.run(t1);
      s.advance(nsub, this.hooks);
      this.t = s.t;
      this.frame++;
      if (this.frame % 30 === 0) {
        this.cs.prune(t0);
        this.extra = this.extra.filter((e) => e.t1 > t0);
      }
    }
  }
  RE.Heart = Heart;
})();

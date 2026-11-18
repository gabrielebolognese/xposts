// Reentry: the event-driven conduction system, coupled both ways to the tissue.
// Two trees of segments: atrial fast pathways from the SA node (internodal tracts and Bachmann's bundle, needed because
// the atria are spatially scaled like the ventricles) and the His-Purkinje tree along the LV and RV endocardium.
// A node fires at most once per refractory period; each segment adds delay = length / CV. A terminal junction injects
// a stimulus disc into the tissue if the tissue there is not refractory (v < 0.6); a junction whose tissue is excited
// first fires the tree retrogradely.
(function () {
  const RE = window.RE;
  const N = RE.N, T = RE.T;
  const deg = Math.PI / 180;

  class Heap {
    constructor() {
      this.a = [];
    }
    push(e) {
      const a = this.a;
      a.push(e);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].t <= a[i].t) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.a;
      const top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].t < a[m].t) m = l;
          if (r < a.length && a[r].t < a[m].t) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    }
    peek() {
      return this.a[0];
    }
    get size() {
      return this.a.length;
    }
  }

  RE.buildConduction = function (A, opt) {
    const o = Object.assign({ cvP: 8, cvA: 4, refrP: 300, refrA: 220, dmg: 0 }, opt || {});
    const F = A.F, P = A.P;
    const nodes = [];
    const add = (x, y, parent, kind, sys) => {
      const nd = { id: nodes.length, x, y, parent: parent ? parent.id : -1, kids: [], kind, sys, len: 0, last: -1e9, lastFrom: 0, depth: parent ? parent.depth + 1 : 0 };
      if (parent) {
        parent.kids.push(nd.id);
        nd.len = Math.hypot(x - parent.x, y - parent.y);
      }
      nodes.push(nd);
      return nd;
    };
    const isTissue = (x, y) => {
      const i = Math.round(y) * N + Math.round(x);
      return A.D[i] > 0;
    };
    // a junction site: walk from an endocardial cell into the wall so the stimulus disc sits in tissue
    const into = (p, cx, cy, depth) => {
      let dx = p.x - cx, dy = p.y - cy;
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      let x = p.x, y = p.y;
      for (let s = 0; s < depth; s++) if (isTissue(x + dx, y + dy)) { x += dx; y += dy; }
      return { x, y };
    };
    // endocardial sample at a given angle (median of the contour cells within +-1.5 degrees)
    const at = (list, ang) => {
      let best = null, bd = 1e9;
      for (const p of list) {
        const d = Math.abs(p.ang - ang);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    const cavC = (c) => F.toImg(c.u, c.w);
    const lvC = cavC(P.lv), rvC = cavC(P.rv);
    // a point offset from the endocardium into the cavity (where the subendocardial network runs)
    const off = (p, c, d) => {
      const dx = c.x - p.x, dy = c.y - p.y, L = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / L) * d, y: p.y + (dy / L) * d };
    };

    // ---- His-Purkinje ----
    const his = add(A.hisC.x, A.hisC.y, null, 'his', 'P');
    const hb = F.toHeart(A.hisC.x, A.hisC.y);
    const bif = F.toImg(hb.u, hb.w + 22);
    const B = add(bif.x, bif.y, his, 'bundle', 'P');
    // a line of nodes along an endocardial contour from angle a0 to a1, fed by node `from`; every line node sends a
    // twig to one junction, every other twig forks into two
    const line = (list, c, from, a0, a1, step, kindName) => {
      let prev = from;
      const dir = Math.sign(a1 - a0);
      const out = [];
      let k = 0;
      for (let a = a0; dir > 0 ? a <= a1 + 1e-6 : a >= a1 - 1e-6; a += dir * step, k++) {
        const e = at(list, a);
        if (!e) continue;
        const q = off(e, c, 4);
        const nd = add(q.x, q.y, prev, kindName, 'P');
        out.push(nd);
        // junctions
        if (k % 2 === 0) {
          const ea = at(list, a - step * 0.3), eb = at(list, a + step * 0.3);
          const fq = off(e, c, 1.5);
          const fork = add(fq.x, fq.y, nd, 'twig', 'P');
          for (const ee of [ea, eb]) {
            const j = into(ee, c.x, c.y, 6);
            add(j.x, j.y, fork, 'pmj', 'P');
          }
        } else {
          const j = into(e, c.x, c.y, 6);
          add(j.x, j.y, nd, 'pmj', 'P');
        }
        prev = nd;
      }
      return out;
    };
    // LV: left bundle to the upper septum, septal fascicle down to the apex, anterior and posterior fascicles crossing
    // the cavity (false tendons) to the lateral wall
    const l0e = at(A.lvEndo, -150);
    const l0p = off(l0e, lvC, 4);
    const L0 = add(l0p.x, l0p.y, B, 'bundle', 'P');
    line(A.lvEndo, lvC, L0, -138, -6, 12, 'fasc');
    const antE = at(A.lvEndo, 118), postE = at(A.lvEndo, 52);
    const antP = off(antE, lvC, 4), postP = off(postE, lvC, 4);
    const ant = add(antP.x, antP.y, L0, 'fasc', 'P');
    const post = add(postP.x, postP.y, L0, 'fasc', 'P');
    line(A.lvEndo, lvC, ant, 130, 152, 11, 'fasc');
    line(A.lvEndo, lvC, ant, 106, 84, 11, 'fasc');
    line(A.lvEndo, lvC, post, 64, 74, 10, 'fasc');
    line(A.lvEndo, lvC, post, 40, 6, 11, 'fasc');
    // RV: right bundle down the septal surface, moderator band across to the free wall
    const r0e = at(A.rvEndo, 150);
    const r0p = off(r0e, rvC, 4);
    const R0 = add(r0p.x, r0p.y, B, 'bundle', 'P');
    const rs = line(A.rvEndo, rvC, R0, 136, 40, 16, 'fasc');
    const modE = at(A.rvEndo, -60);
    const modP = off(modE, rvC, 4);
    const mod = add(modP.x, modP.y, rs[Math.min(rs.length - 1, 4)], 'fasc', 'P');
    line(A.rvEndo, rvC, mod, -76, -140, 16, 'fasc');
    line(A.rvEndo, rvC, mod, -44, 20, 16, 'fasc');

    // ---- atrial fast pathways from the SA node ----
    // SA node: high RA near the junction with the superior vena cava
    const raC = cavC(P.ra), laC = cavC(P.la);
    const ringPt = (c, cav, ang, d) => {
      // walk outward from the cavity centre at a heart-frame angle until leaving the cavity, then d cells into the wall
      const cs = Math.cos(ang * deg), sn = Math.sin(ang * deg);
      const dirImg = { x: cs * Math.cos(P.tilt) + sn * Math.sin(P.tilt), y: -cs * Math.sin(P.tilt) + sn * Math.cos(P.tilt) };
      let x = c.x, y = c.y;
      for (let s = 0; s < 300; s++) {
        x += dirImg.x;
        y += dirImg.y;
        const i = Math.round(y) * N + Math.round(x);
        if (!cav[i]) break;
      }
      for (let s = 0; s < d; s++) {
        x += dirImg.x;
        y += dirImg.y;
      }
      return { x, y };
    };
    // angle in the heart frame: 0 = +u (patient's left), 90 = +w (toward the ventricles), -90 = roof
    const saP = ringPt(raC, A.raCav, -118, 4);
    const sa = add(saP.x, saP.y, null, 'sa', 'A');
    const tract = (from, pts) => {
      let prev = from;
      for (const p of pts) {
        const nd = add(p.x, p.y, prev, 'aj', 'A');
        prev = nd;
      }
      return prev;
    };
    // RA lateral wall (crista terminalis) down to the lateral annulus
    tract(sa, [-140, -162, 176, 152, 130].map((a) => ringPt(raC, A.raCav, a, 4)));
    // anterior internodal: across the roof to the septal side, down the atrial septum to the AV node
    const raSept = [-80, -55, -30, -5, 20].map((a) => ringPt(raC, A.raCav, a, 4));
    tract(sa, [...raSept, { x: A.avA.x, y: A.avA.y - 2 }]);
    // Bachmann's bundle to the LA roof, then around the LA
    const bb = [-110, -135, -160, 170, 140].map((a) => ringPt(laC, A.laCav, a, 4));
    const laRoof = tract(sa, [ringPt(raC, A.raCav, -95, 4), ringPt(laC, A.laCav, -95, 4)]);
    tract(laRoof, bb);
    tract(laRoof, [-70, -45, -20, 5, 30].map((a) => ringPt(laC, A.laCav, a, 4)));

    // only nodes that land in tissue can be junctions
    for (const nd of nodes) {
      if ((nd.kind === 'pmj' || nd.kind === 'aj') && !isTissue(nd.x, nd.y)) nd.dead = true;
      // a junction couples only to tissue of its own system (no accessory pathways)
      const ty = A.type[Math.round(nd.y) * N + Math.round(nd.x)];
      if (nd.kind === 'aj' && ty !== T.RA && ty !== T.LA) nd.dead = true;
      if (nd.kind === 'pmj' && ty !== T.MYO && ty !== T.BZ) nd.dead = true;
      if (nd.kind === 'pmj' && A.type[Math.round(nd.y) * N + Math.round(nd.x)] === T.SCAR) nd.dead = true;
      // the infarct destroyed the Purkinje network in its territory
      if (nd.kind === 'pmj' && o.dmg > 0 && A.dScar[Math.round(nd.y) * N + Math.round(nd.x)] < o.dmg) nd.dead = true;
    }
    for (const nd of nodes) {
      nd.cv = nd.sys === 'P' ? o.cvP : o.cvA;
      nd.refr = nd.sys === 'P' ? o.refrP : o.refrA;
      nd.junction = (nd.kind === 'pmj' || nd.kind === 'aj') && !nd.dead;
    }
    return { nodes, his, sa, opt: o, segments: nodes.filter((n) => n.parent >= 0).length, pmj: nodes.filter((n) => n.kind === 'pmj' && !n.dead).length };
  };

  // runtime: events and stimuli
  class Conduction {
    constructor(sys, opt) {
      this.sys = sys;
      this.nodes = sys.nodes;
      for (const nd of this.nodes) {
        nd.last = -1e9;
        nd.lastFrom = 0;
        nd.v = 0;
        nd.u = 0;
      }
      this.q = new Heap();
      this.o = Object.assign({ jR: 3, jAmp: 2.5, jDur: RE.TMS, vRef: 0.6, retroDelay: 2, hv: 26 }, opt || {});
      this.stims = [];
      this.sid = 1000;
      this.log = [];
      this.flash = new Float64Array(this.nodes.length).fill(-1e9); // activation time of each node (display)
      this.junctions = this.nodes.filter((n) => n.junction);
      this.jState = new Map(); // junction id -> latest tissue LAT seen
      this.blocked = 0;
      this.retro = 0;
      this.injected = 0;
      this.skipped = 0;
    }
    // retro: the impulse entered the tree from the tissue at a junction (concealed: it never re-exits into the muscle)
    fire(node, t, from, retro) {
      if (t - node.last < node.refr) {
        this.blocked++;
        return false;
      }
      node.last = t;
      node.lastFrom = from;
      node.retro = !!retro;
      this.flash[node.id] = t;
      const nb = [];
      if (node.parent >= 0) nb.push(node.parent);
      for (const k of node.kids) nb.push(k);
      for (const id of nb) {
        if (id === from) continue;
        const m = this.nodes[id];
        const len = id === node.parent ? node.len : m.len;
        const hv = (node.kind === 'his' || m.kind === 'his') ? this.o.hv : 0; // His bundle conduction (HV interval)
        this.q.push({ t: t + len / node.cv + hv, id, from: node.id, retro: !!retro });
      }
      return true;
    }
    // tissue -> tree: called with the gathered (u, v, LAT) of every junction and of the His entry cell
    sense(t, gatherOf) {
      // His entry
      const h = gatherOf(this.sys.his.id);
      if (h && h.lat > 0 && h.lat > (this.hisLat ?? -1e9) + 1) {
        this.hisLat = h.lat;
        this.fire(this.sys.his, h.lat, -1);
      }
      for (const j of this.junctions) {
        const g = gatherOf(j.id);
        if (!g) continue;
        const prev = this.jState.get(j.id) ?? -1e9;
        if (g.lat > 0 && g.lat > prev + 1) {
          this.jState.set(j.id, g.lat);
          // excited by the tissue before the tree reached it: retrograde entry
          if (g.lat - j.last > j.refr) {
            if (this.fire(j, g.lat + this.o.retroDelay, -2, true)) this.retro++;
          }
        }
        j.v = g.v;
        j.u = g.u;
      }
    }
    // tree events up to tEnd; junction arrivals become tissue stimuli
    run(tEnd) {
      while (this.q.size && this.q.peek().t < tEnd) {
        const e = this.q.pop();
        const nd = this.nodes[e.id];
        if (!this.fire(nd, e.t, e.from, e.retro)) continue;
        if (nd.junction && (!e.retro || this.o.retroExit)) {
          if ((nd.v ?? 0) < this.o.vRef) {
            this.stims.push({ id: this.sid++, x: nd.x, y: nd.y, r: this.o.jR, amp: this.o.jAmp, t0: e.t, t1: e.t + this.o.jDur, kind: nd.sys });
            this.injected++;
          } else this.skipped++;
        }
      }
    }
    fireSA(t) {
      this.fire(this.sys.sa, t, -1);
    }
    active(t) {
      const out = [];
      for (const s of this.stims) if (t >= s.t0 && t < s.t1) out.push(s);
      return out;
    }
    prune(t) {
      if (this.stims.length > 64) this.stims = this.stims.filter((s) => s.t1 > t);
    }
  }
  RE.Conduction = Conduction;
})();

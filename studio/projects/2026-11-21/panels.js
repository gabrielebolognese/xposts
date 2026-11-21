// Canvas 2D panels: every number on screen is read from APP (the simulation) or STUDIO (the kit's measurements).
(function () {
  'use strict';
  const C = UI.C, F = UI.F;
  const K = window.Kerr, E = window.EHT;
  const P_ = {};
  let A = null; // APP
  const BASE_COL = [];

  // baseline colours: 28 baselines, hues from the palette family
  function baseColors() {
    const pal = ['#FFB63D', '#FF6A1A', '#D1357A', '#59D8FF', '#8F7BFF', '#F4F1E8', '#6BE38A', '#FFC93D'];
    for (let k = 0; k < 28; k++) {
      const b = E.baselines[k];
      BASE_COL.push(UI.mix(pal[(b.i + b.j * 3) % 8], pal[(b.i * 5 + b.j) % 8], 0.35));
    }
  }

  // ------------------------------------------------------------------ small drawing helpers
  function frame(ctx, x, y, w, h, color = C.line) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1); }
  function dashLine(ctx, pts, color, dash = [4, 3], lw = 1) {
    ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
  }
  function line(ctx, pts, color, lw = 1, close = false) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    let first = true;
    for (const p of pts) { if (!p || !isFinite(p[1])) { first = true; continue; } if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]); }
    if (close) ctx.closePath();
    ctx.stroke();
  }
  function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
  function kv(ctx, k, v, x, y, vc = C.text, wk = null) {
    UI.label(ctx, k, x, y, C.muted, 'left', 10);
    const kw = wk != null ? wk : UI.textW(ctx, k, F.label(10)) + 5;
    UI.mono(ctx, v, x + kw, y, vc, 'left', 10.5);
  }
  function kvR(ctx, k, v, xr, y, vc = C.text) {
    UI.mono(ctx, v, xr, y, vc, 'right', 10.5);
    const vw = UI.textW(ctx, v, F.mono(10.5));
    UI.label(ctx, k, xr - vw - 5, y, C.muted, 'right', 10);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lg = Math.log10;
  // nice ticks
  function ticks(a, b, n = 5) {
    const span = b - a, step0 = span / n, mag = 10 ** Math.floor(lg(step0)), r = step0 / mag;
    const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * span; v += step) out.push(+v.toFixed(10));
    return { v: out, step };
  }
  const fmtT = (v, step) => { const d = Math.max(0, -Math.floor(lg(step) + 1e-9)); return UI.neg(v.toFixed(d)); };

  function offscreen(w, h) {
    const d = UI.dpr(), cv = document.createElement('canvas');
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    const ctx = cv.getContext('2d', UI.ctxOpts());
    ctx.setTransform(d, 0, 0, d, 0, 0);
    return { cv, ctx };
  }

  // ------------------------------------------------------------------ panel registry
  const panels = [];
  function add(name, x, y, w, h, every, offset, draw) {
    const cv = UI.canvas(x, y, w, h, 'ov');
    panels.push({ name, cv, every, offset, draw });
  }

  // ------------------------------------------------------------------ top bar
  let topStatic = null, topX = 0;
  function drawTop(ctx, w, h) {
    const D = A.D, P = A.P;
    let x = 232;
    const sep = (c) => { c.fillStyle = C.line; c.fillRect(x, 7, 1, 18); x += 12; };
    const item = (c, k, v, vc = C.text, gap = 14, vw = null) => {
      UI.label(c, k, x, 20, C.muted, 'left', 10);
      x += UI.textW(c, k, F.label(10)) + 5;
      UI.mono(c, v, x, 20, vc, 'left', 11);
      x += (vw != null ? vw : UI.textW(c, v, F.mono(11))) + gap;
    };
    if (!topStatic) {
      const o = offscreen(w, h), c = o.ctx;
      c.fillStyle = C.surface; c.fillRect(0, 0, w, h);
      frame(c, 0, 0, w, h);
      UI.big(c, 'PHOTON RING', 12, 22, 17, C.white);
      UI.label(c, 'Sgr A*, ray by ray', 120, 21, C.muted, 'left', 11);
      sep(c);
      item(c, 'target', 'Sgr A*', C.amber);
      item(c, 'M', '4.297e6 M☉');
      item(c, 'D', '8.277 kpc');
      item(c, 'θg', `${D.uasPerM.toFixed(3)} µas/M`);
      item(c, 'GM/c³', `${D.tg.toFixed(2)} s`, C.text, 12);
      sep(c);
      item(c, 'a', P.a.toFixed(3), C.cyan);
      item(c, 'i', `${P.incDeg}°`, C.cyan, 12);
      sep(c);
      UI.label(c, 'Kerr null geodesics · Page–Thorne disk · EHT 2017 array', w - 10, 20, C.dim, 'right', 10);
      topStatic = o.cv; topX = x;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(topStatic, 0, 0, w, h);
    x = topX;
    const m7 = UI.textW(ctx, '0', F.mono(11));
    item(ctx, 'UT', UI.hhmm(A.utOf(A.simSec)), C.white, 14, m7 * 8);
    item(ctx, 'night', '2026-08-24');
    item(ctx, 't_obs', `${UI.fx(A.simSec / D.tg - A.nightStart / D.tg, 1)} M`, C.text, 12, m7 * 8);
    sep(ctx);
    item(ctx, 'rays traced', UI.int(A.raysTotal), C.text, 14, m7 * 11);
    const nt = A.tileOrder.length, pc = A.passTile / nt;
    item(ctx, 'pass', `${A.passCurId()}`, C.text, 6, m7 * 3);
    ctx.fillStyle = C.line; ctx.fillRect(x, 14, 64, 4);
    ctx.fillStyle = C.cyan; ctx.fillRect(x, 14, 64 * pc, 4);
    x += 70;
    UI.mono(ctx, `${UI.int(A.passTile)}/${UI.int(nt)} tiles`, x, 20, C.muted, 'left', 10);
    x += 118;
    sep(ctx);
    const perf = STUDIO.perf();
    item(ctx, 'fps', String(perf.fps), perf.fps >= 55 ? C.up : perf.fps >= 40 ? C.warn : C.down, 12);
  }

  // ------------------------------------------------------------------ controls
  const CTRL = [];
  function drawControls(ctx, w, h) {
    UI.panel(ctx, w, h, 'Physics & numerics', '19 parameters · live', { mark: C.amber });
    const P = A.P, D = A.D;
    let y = 30;
    const slider = (label, val, unit, frac, readout, rc = C.muted, accent = C.amber) => {
      UI.label(ctx, label, 8, y + 10, C.text, 'left', 10);
      UI.mono(ctx, val, 150, y + 10, C.white, 'right', 10.5);
      if (unit) UI.label(ctx, unit, 153, y + 10, C.muted, 'left', 9.5);
      const tx = 186, tw = 60, ty = y + 6;
      ctx.fillStyle = C.line; ctx.fillRect(tx, ty, tw, 2);
      ctx.fillStyle = accent; ctx.fillRect(tx, ty, tw * clamp(frac, 0, 1), 2);
      ctx.fillStyle = C.white; ctx.fillRect(Math.round(tx + tw * clamp(frac, 0, 1)) - 1, ty - 3, 3, 8);
      if (readout) UI.mono(ctx, readout, w - 8, y + 10, rc, 'right', 9.5);
      y += 18;
    };
    // spin and derived radii
    slider('Spin a', P.a.toFixed(3), '', P.a / 0.998, `r+ ${D.rplus.toFixed(3)}`, C.cyan, C.cyan);
    UI.mono(ctx, `r_isco ${D.risco.toFixed(3)}  r_ph+ ${D.rphP.toFixed(3)}  r_ph− ${D.rphR.toFixed(3)}  η ${D.eff.toFixed(4)}`, 8, y + 8, C.muted, 'left', 9.5);
    y += 16;
    ctx.fillStyle = C.faint; ctx.fillRect(8, y, w - 16, 1); y += 5;
    // inclination knob + mass / distance fields
    const kx = 26, ky = y + 19, kr = 15;
    ctx.strokeStyle = C.line; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(kx, ky, kr, 0.75 * Math.PI, 2.25 * Math.PI); ctx.stroke();
    const fr = (P.incDeg - 1) / 88;
    ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.arc(kx, ky, kr, 0.75 * Math.PI, 0.75 * Math.PI + fr * 1.5 * Math.PI); ctx.stroke();
    const ka = 0.75 * Math.PI + fr * 1.5 * Math.PI;
    ctx.strokeStyle = C.white; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx + (kr - 4) * Math.cos(ka), ky + (kr - 4) * Math.sin(ka)); ctx.stroke();
    UI.label(ctx, 'Inclination i', 48, y + 13, C.text, 'left', 10);
    UI.mono(ctx, `${P.incDeg}°`, 48, y + 28, C.white, 'left', 12, true);
    UI.label(ctx, '1°–89°', 80, y + 28, C.muted, 'left', 9.5);
    UI.mono(ctx, `cos i ${Math.cos(D.inc).toFixed(3)}`, 48, y + 39, C.muted, 'left', 9.5);
    const field = (label, val, unit, fx, fy) => {
      UI.label(ctx, label, fx, fy + 9, C.muted, 'left', 9.5);
      frame(ctx, fx + 54, fy, 98, 15, C.line);
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(fx + 55, fy + 1, 96, 13);
      UI.mono(ctx, val, fx + 59, fy + 11, C.white, 'left', 10.5);
      UI.label(ctx, unit, fx + 148, fy + 11, C.muted, 'right', 9.5);
    };
    field('Mass M', '4.297e6', 'M☉', 168, y + 4);
    field('Distance D', '8.277', 'kpc', 168, y + 24);
    y += 54;
    UI.mono(ctx, `r_g ${UI.sci(D.rg, 3)} m  L_Edd ${UI.sci(D.LEdd, 2)} W`, 8, y, C.muted, 'left', 9.5);
    y += 6;
    ctx.fillStyle = C.faint; ctx.fillRect(8, y, w - 16, 1); y += 5;
    const ph = A.spot ? (((A.spot.phi0 + (2 * Math.PI / D.spotPeriodM) * (A.simSec / D.tg - A.spot.birthM)) % (2 * Math.PI)) * 180) / Math.PI : 0;
    slider('Accretion ṁ', P.mdot.toFixed(3), 'Edd', (lg(P.mdot) + 4) / 4, `${UI.sci(D.Mdot * 3.156e7 / 1.989e30, 1)} M☉/yr`);
    slider('Disk outer r_out', P.rout.toFixed(0), 'M', (P.rout - 10) / 30, `${(P.rout * D.uasPerM).toFixed(0)} µas`);
    slider('Hot-spot r_s', P.rs.toFixed(1), 'M', (P.rs - D.risco) / (15 - D.risco), `φ_s ${ph.toFixed(1)}°`, C.orange);
    slider('Hot-spot σ_s', P.sig.toFixed(1), 'M', (P.sig - 0.2) / 1.8, `${(P.sig * D.uasPerM).toFixed(2)} µas`);
    slider('Line index q', P.q.toFixed(1), '', (P.q - 1.5) / 3.5, `ε ∝ r^−${P.q.toFixed(1)}`);
    slider('RK4 step h', P.h.toFixed(3), '', (P.h - 0.01) / 0.19, `${UI.fx(A.pass.steps / Math.max(1, A.pass.rays), 1)}/ray`, C.cyan, C.cyan);
    slider('Rays / frame', UI.int(P.raysPerFrame), 'avg', (P.raysPerFrame - 4096) / (131072 - 4096), `now ${A.curTiles ? A.curTiles.length : 0} tiles`, C.cyan, C.cyan);
    slider('Playback', `${P.speed}×`, '', P.speed / 600, '1 s = 2 min', C.muted, C.violet);
    slider('Elevation limit', `${P.elLimDeg}°`, '', P.elLimDeg / 30, `${A.eht.upNow.length}/28 up`, C.up, C.violet);
    ctx.fillStyle = C.faint; ctx.fillRect(8, y + 2, w - 16, 1); y += 7;
    // fields: max steps, observing frequency
    field('Max steps', UI.int(P.maxSteps), 'ray', 8, y);
    field('Obs. freq', `${P.freqGHz}`, 'GHz', 168, y);
    y += 20;
    UI.mono(ctx, `limit hit ${UI.int(A.pass.limit)} rays`, 8, y + 6, A.pass.limit ? C.warn : C.muted, 'left', 9.5);
    UI.mono(ctx, `λ ${(D.lamObs * 1e3).toFixed(4)} mm`, w - 8, y + 6, C.muted, 'right', 9.5);
    y += 12;
    // toggles
    const tog = (label, on, tx, ty) => {
      const pw = 24, ph2 = 12;
      ctx.fillStyle = on ? UI.rgba(C.cyan, 0.22) : C.faint;
      ctx.beginPath(); ctx.roundRect(tx, ty, pw, ph2, 6); ctx.fill();
      ctx.strokeStyle = on ? C.cyan : C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(tx + 0.5, ty + 0.5, pw - 1, ph2 - 1, 6); ctx.stroke();
      dot(ctx, on ? tx + pw - 6 : tx + 6, ty + 6, 4, on ? C.cyan : C.muted);
      UI.label(ctx, label, tx + pw + 6, ty + 10, on ? C.text : C.muted, 'left', 10);
    };
    tog('Doppler beaming', P.dopp, 8, y + 2);
    tog('Grav. redshift', P.grav, 168, y + 2);
    tog('Light-travel delay', P.delay, 8, y + 20);
    tog('Analytic curve', P.showCrit, 168, y + 20);
    y += 36;
    ctx.fillStyle = C.faint; ctx.fillRect(8, y, w - 16, 1);
    const Ws = 1 / (Math.pow(P.rs, 1.5) + P.a);
    UI.mono(ctx, `P_spot ${D.spotPeriodMin.toFixed(2)} min  Ω_s ${Ws.toFixed(4)} rad/M  T_spot ${UI.sci(D.Ts, 2)} K`, 8, y + 12, C.muted, 'left', 9.5);
    UI.mono(ctx, `Ṁ ${UI.sci(D.Mdot, 2)} kg/s  T_max ${UI.sci(D.Tmax, 2)} K  ${(D.spotPeriodM).toFixed(1)} M/orbit`, 8, y + 24, C.muted, 'left', 9.5);
  }

  // ------------------------------------------------------------------ integrator + log
  const LOG_COL = { trace: C.cyan, crit: C.amber, sweep: C.violet, eht: C.text, rise: C.up, set: C.down, spot: C.orange, probe: C.magenta, spec: C.amber };
  function drawIntegrator(ctx, w, h) {
    UI.panel(ctx, w, h, 'Integrator · Mino-time RK4', 'fp32 fragment shader', { mark: C.cyan });
    const p = A.pass, S = A.S;
    const rps = A.raysPerSec(), sps = A.stepsPerSec();
    let y = 36;
    const c1 = 8, c2 = 172;
    const SL = A.statsSec ? A.statsSec() : null; // rays traced in the last second (the tiles under the cursor)
    const ms = SL && SL.rays ? SL.steps / SL.rays : null;
    kv(ctx, 'rays/s', UI.int(rps), c1, y, C.cyan, 62);
    kv(ctx, 'RK4 steps/s', `${(sps / 1e6).toFixed(1)} M`, c2, y, C.cyan, 82);
    y += 14;
    kv(ctx, 'steps/ray', ms != null ? `${ms.toFixed(1)}` : '…', c1, y, C.cyan, 62);
    UI.mono(ctx, `(pass ${UI.fx(p.steps / Math.max(1, p.rays), 1)})`, c1 + 100, y, C.dim, 'left', 9);
    kv(ctx, 'max steps', SL ? UI.int(SL.maxSteps) : '…', c2, y, C.text, 82);
    UI.mono(ctx, `/ ${UI.int(p.maxSteps)}`, c2 + 112, y, C.dim, 'left', 9);
    y += 14;
    const R = SL && SL.rays ? SL : p;
    const fr = (x) => `${((100 * x) / Math.max(1, R.rays)).toFixed(1)}%`;
    kv(ctx, 'captured', fr(R.capt), c1, y, C.violet, 62);
    kv(ctx, 'escaped', fr(R.esc), c1 + 108, y, C.cyan, 46);
    kv(ctx, 'disk', fr(R.hit), c2 + 62, y, C.amber, 28);
    y += 14;
    const pr = A.probes || {};
    const rms = p.hit ? Math.sqrt(p.sumRes2 / p.hit) : null;
    UI.label(ctx, '|v_r²−R|/(R+1)', c1, y, C.muted, 'left', 9.5);
    UI.mono(ctx, rms != null ? `rms ${UI.sci(rms, 1)}` : '…', c1 + 80, y, C.up, 'left', 10);
    UI.mono(ctx, `max ${UI.sci(p.res, 1)}`, c1 + 160, y, C.text, 'left', 10);
    UI.mono(ctx, pr.cpu ? `fp64 max ${UI.sci(pr.res64, 1)}` : '', w - 8, y, C.dim, 'right', 9);
    y += 12;
    UI.label(ctx, 'null-constraint drift per step, disk rays, before v_r is re-projected', c1, y, C.dim, 'left', 9);
    y += 14;
    kv(ctx, 'fp32−fp64 Δr', pr.cpu ? `${UI.sci(pr.rms, 1)} M` : '…', c1, y, pr.cpu ? C.up : C.muted, 76);
    kv(ctx, 'probe fates', pr.cpu ? `${pr.agree}/64 same` : '…', c2, y, pr.cpu ? C.up : C.muted, 82);
    y += 14;
    const gp = GLX.gpu || {};
    kv(ctx, 'GPU trace', gp.trace != null ? `${gp.trace.toFixed(2)} ms` : '—', c1, y, C.text, 62);
    kv(ctx, 'GPU shade', gp.hero != null ? `${gp.hero.toFixed(2)} ms` : '—', c2, y, C.text, 82);
    // steps histogram: the whole pass (dim) and the last second of rays (bright), the current tiles' bin marked
    y += 8;
    const hx = 8, hw = w - 16, hh = 36, hy = y;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(hx, hy, hw, hh);
    const hist = p.hist, hs = SL ? SL.hist : null;
    let hm = 0, hm2 = 0;
    for (let b = 0; b < hist.length; b++) { hm = Math.max(hm, hist[b]); if (hs) hm2 = Math.max(hm2, hs[b]); }
    const bw = hw / hist.length;
    for (let b = 0; b < hist.length; b++) {
      const v = hist[b] / (hm || 1), bh = Math.max(v > 0 ? 1 : 0, Math.sqrt(v) * (hh - 10));
      ctx.fillStyle = UI.rgba(C.cyan, 0.22);
      ctx.fillRect(hx + b * bw + 0.5, hy + hh - 1 - bh, bw - 1, bh);
      if (hs) {
        const v2 = hs[b] / (hm2 || 1), bh2 = Math.max(v2 > 0 ? 1 : 0, Math.sqrt(v2) * (hh - 10));
        ctx.fillStyle = b === hist.length - 1 ? C.warn : UI.mix('#2B6F86', C.cyan, Math.min(1, v2 * 1.5));
        ctx.fillRect(hx + b * bw + 1.5, hy + hh - 1 - bh2, bw - 3, bh2);
      }
    }
    if (ms != null) {
      const bi = Math.min(hist.length - 1, Math.floor(ms / GLX.HIST_W)), pulse = 0.5 + 0.5 * Math.sin((A.now || 0) / 140);
      ctx.strokeStyle = UI.rgba(C.white, 0.4 + 0.5 * pulse); ctx.lineWidth = 1;
      ctx.strokeRect(hx + bi * bw + 0.5, hy + 1.5, bw - 1, hh - 3);
    }
    UI.label(ctx, 'steps/ray · 1 s bright · pass dim', hx + hw - 4, hy + 10, C.muted, 'right', 9);
    const top = GLX.HIST_W * GLX.HIST_BINS;
    for (const s2 of [0, 100, 200, 300]) UI.mono(ctx, String(s2), hx + (s2 / top) * hw + 2, hy + hh + 10, C.dim, 'left', 9);
    UI.mono(ctx, `≥${top - GLX.HIST_W}`, hx + hw, hy + hh + 10, C.dim, 'right', 9);
    // event log
    y = hy + hh + 16;
    ctx.fillStyle = C.line; ctx.fillRect(1, y, w - 2, 1);
    UI.label(ctx, 'EVENT LOG', 8, y + 12, C.muted, 'left', 9.5, true);
    UI.mono(ctx, `${A.logSeq} events`, w - 8, y + 12, C.dim, 'right', 9);
    const lines = Math.floor((h - y - 20) / 12.2);
    const L = A.log.slice(-lines);
    let ly = y + 26;
    ctx.save(); ctx.beginPath(); ctx.rect(4, y + 15, w - 8, h - y - 17); ctx.clip();
    for (const e of L) {
      const ts = UI.hhmm(A.utOf(e.sim)).slice(0, 5);
      UI.mono(ctx, ts, 8, ly, C.dim, 'left', 9.5);
      const col = LOG_COL[e.kind] || C.text;
      ctx.fillStyle = col; ctx.fillRect(41, ly - 7, 2, 7);
      UI.setFont(ctx, F.mono(9.5), 'normal');
      if (e.short === undefined) {
        let t = e.text;
        const maxW = w - 58;
        if (ctx.measureText(t).width > maxW) { while (t.length > 4 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); t += '…'; }
        e.short = t;
      }
      ctx.fillStyle = e.kind === 'eht' ? C.text : col; ctx.textAlign = 'left';
      ctx.fillText(e.short, 48, ly);
      ly += 12.2;
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ system resources
  function spark(ctx, vals, x, y, w, h, color, max = 100, fill = true) {
    if (!vals.length) return;
    const n = vals.length;
    ctx.beginPath();
    vals.forEach((v, i) => { const px = x + (i / (n - 1 || 1)) * w, py = y + h - clamp(v / max, 0, 1) * h; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    if (fill) { ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fillStyle = UI.rgba(color, 0.12); ctx.fill(); }
  }
  function drawSystem(ctx, w, h) {
    const sys = STUDIO.system || {};
    UI.panel(ctx, w, h, 'This PC', `${(sys.cpu || 'CPU').replace(/ with .*$/, '').replace('AMD ', '')} · ${sys.threads || 16} threads · 7 workers`, { mark: C.violet });
    const hist = STUDIO.history(60), m = STUDIO.metrics();
    const nT = Math.max(16, (m.cpu || []).length);
    const cw = (w - 16 - 3 * 4) / 4, ch = 30;
    for (let k = 0; k < 16; k++) {
      const cx = 8 + (k % 4) * (cw + 4), cy = 28 + Math.floor(k / 4) * (ch + 4);
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(cx, cy, cw, ch);
      const vals = hist.map((s) => (s.cpu && s.cpu[k] != null ? s.cpu[k] : 0));
      const cur = m.cpu && m.cpu[k] != null ? m.cpu[k] : null;
      const col = cur > 80 ? C.orange : cur > 50 ? C.amber : C.violet;
      ctx.save(); ctx.beginPath(); ctx.rect(cx, cy + 11, cw, ch - 11); ctx.clip();
      spark(ctx, vals, cx, cy + 12, cw, ch - 13, col);
      ctx.restore();
      ctx.fillStyle = C.faint; ctx.fillRect(cx, cy + 10, cw, 1);
      UI.mono(ctx, `T${String(k).padStart(2, '0')}`, cx + 3, cy + 8.5, C.muted, 'left', 9);
      UI.mono(ctx, cur == null ? '—' : `${cur.toFixed(0)}%`, cx + cw - 3, cy + 8.5, C.text, 'right', 9);
    }
    let y = 28 + 4 * (ch + 4) + 4;
    const row = (label, vals, max, color, valStr, sub) => {
      UI.label(ctx, label, 8, y + 11, C.text, 'left', 10);
      if (sub) UI.label(ctx, sub, 8, y + 22, C.muted, 'left', 9);
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(70, y, 150, 24);
      if (vals) spark(ctx, vals, 70, y + 2, 150, 22, color, max);
      UI.mono(ctx, valStr, w - 8, y + 15, vals ? C.text : C.muted, 'right', 10.5);
      y += 28;
    };
    const ramT = m.ramTotal || sys.ramGB || 16;
    row('RAM', hist.map((s) => s.ramUsed || 0), ramT, C.cyan, `${UI.fx(m.ramUsed, 1)}/${UI.fx(ramT, 1)} GB`, `${((100 * (m.ramUsed || 0)) / ramT).toFixed(0)}% used`);
    const gpuOk = m.gpu != null;
    row('GPU', gpuOk ? hist.map((s) => s.gpu || 0) : null, 100, C.amber, gpuOk ? `${m.gpu.toFixed(0)}%` : '—', 'Radeon iGPU');
    const dOk = m.diskR != null || m.diskW != null;
    const dmax = Math.max(1, ...hist.map((s) => (s.diskR || 0) + (s.diskW || 0)));
    row('Disk', dOk ? hist.map((s) => (s.diskR || 0) + (s.diskW || 0)) : null, dmax, C.violet, dOk ? `${UI.fx(m.diskR || 0, 1)}r ${UI.fx(m.diskW || 0, 1)}w MB/s` : '—', 'read + write');
    // fps + frame-time histogram (this page's real JS ms per frame)
    const perf = STUDIO.perf();
    UI.label(ctx, 'Page', 8, y + 11, C.text, 'left', 10);
    UI.big(ctx, String(perf.fps), 8, y + 34, 22, perf.fps >= 55 ? C.up : perf.fps >= 40 ? C.warn : C.down);
    UI.label(ctx, 'fps', 36, y + 33, C.muted, 'left', 10);
    UI.mono(ctx, `${UI.fx(perf.frameMs, 1)} ms`, 8, y + 47, C.muted, 'left', 9.5);
    const jx = 70, jw = 150, jh = 40;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(jx, y, jw, jh);
    const bins = new Array(24).fill(0);
    for (const v of A.jsHist) bins[Math.min(23, Math.floor(v / 1))]++;
    const bm = Math.max(1, ...bins);
    for (let b = 0; b < 24; b++) {
      const bh = (bins[b] / bm) * (jh - 10);
      ctx.fillStyle = b >= 16 ? C.down : b >= 12 ? C.warn : C.cyan;
      ctx.fillRect(jx + b * (jw / 24) + 1, y + jh - bh, jw / 24 - 2, bh);
    }
    UI.label(ctx, 'JS ms per frame, this page', jx + 3, y + 9, C.muted, 'left', 9);
    for (const t of [0, 8, 16]) UI.mono(ctx, String(t), jx + (t / 24) * jw, y + jh + 10, C.dim, 'left', 9);
    const js = A.jsHist.slice(-60);
    const avg = js.reduce((a, b) => a + b, 0) / Math.max(1, js.length);
    UI.mono(ctx, `avg ${avg.toFixed(1)}`, w - 8, y + 15, C.text, 'right', 10);
    UI.mono(ctx, `p99 ${quant(A.jsHist, 0.99).toFixed(1)}`, w - 8, y + 29, C.muted, 'right', 9.5);
    const gp = GLX.gpu || {};
    const gf = (gp.trace || 0) + (gp.reduce || 0) + (gp.hero || 0) + (gp.dyn || 0) / 4;
    UI.mono(ctx, gp.trace != null ? `GPU ${gf.toFixed(1)} ms` : 'GPU —', w - 8, y + 43, C.muted, 'right', 9.5);

  }
  function quant(a, q) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

  // ------------------------------------------------------------------ hero overlay
  let heroBar = null;
  const HW = 880, HH = 720;
  const hx = (al) => ((al + 20) / 40) * HW;
  const hy = (be) => ((A.field[1] + A.field[3] - be) / A.field[3]) * HH;
  let heroStatic = null, heroKey = null;
  function drawHero(ctx, w, h) {
    const key = (A.crit ? 1 : 0) + ':' + (A.critJob && A.critJob.kind === 'cur' ? A.critJob.doneCount : -1) + ':' + A.P.showCrit;
    if (!heroStatic || heroKey !== key) { heroStatic = heroStatic || offscreen(w, h); heroStatic.ctx.clearRect(0, 0, w, h); drawHeroStatic(heroStatic.ctx, w, h); heroKey = key; }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(heroStatic.cv, 0, 0, w, h);
    drawHeroDyn(ctx, w, h);
  }
  function drawHeroStatic(ctx, w, h) {
    const D = A.D, P = A.P, ua = D.uasPerM;
    frame(ctx, 0, 0, w, h);
    // title block
    const tb = 24; // title block sits below the top axis strip
    ctx.fillStyle = 'rgba(7,6,10,0.72)'; ctx.fillRect(1, tb, 300, 54);
    UI.title(ctx, 'KERR RAY TRACE · log I', 10, tb + 16, 13, C.white);
    UI.mono(ctx, `a ${P.a.toFixed(3)} · i ${P.incDeg}° · ${GLX.MAP_W}×${GLX.MAP_H} geodesics · inferno`, 10, tb + 31, C.muted, 'left', 9.5);
    dashLine(ctx, [[10, tb + 43], [34, tb + 43]], C.cyan, [6, 4], 1.5);
    UI.label(ctx, `hot-spot orbit r_s = ${P.rs} M, as lensed`, 40, tb + 47, C.text, 'left', 9.5);
    // axes: alpha ticks in M along the bottom, microarcseconds along the top; beta on the left (M) and right (µas)
    ctx.fillStyle = C.text;
    for (let al = -15; al <= 15; al += 5) {
      const x = Math.round(hx(al)) + 0.5;
      ctx.fillStyle = UI.rgba(C.white, 0.5); ctx.fillRect(x - 0.5, h - 7, 1, 6);
      UI.mono(ctx, UI.neg(String(al)), x, h - 10, UI.rgba(C.white, 0.6), 'center', 9.5);
    }
    UI.label(ctx, 'α [M]', hx(17.5), h - 10, C.muted, 'center', 9.5);
    for (let u = -75; u <= 75; u += 25) {
      const x = Math.round(hx(u / ua)) + 0.5;
      ctx.fillStyle = UI.rgba(C.white, 0.5); ctx.fillRect(x - 0.5, 1, 1, 6);
      UI.mono(ctx, UI.neg(String(u)), x, 17, UI.rgba(C.white, 0.6), 'center', 9.5);
    }
    UI.label(ctx, 'µas', hx(97 / ua), 17, C.muted, 'center', 9.5);
    for (let be = -15; be <= 15; be += 5) {
      const y = Math.round(hy(be)) + 0.5;
      ctx.fillStyle = UI.rgba(C.white, 0.5); ctx.fillRect(1, y - 0.5, 6, 1);
      if (be < 10) UI.mono(ctx, UI.neg(String(be)), 10, y + 3, UI.rgba(C.white, 0.6), 'left', 9.5);
    }
    UI.label(ctx, 'β [M]', 10, hy(-12.5) + 3, C.muted, 'left', 9.5);
    for (let u = -75; u <= 75; u += 25) {
      const y = Math.round(hy(u / ua)) + 0.5;
      ctx.fillStyle = UI.rgba(C.white, 0.5); ctx.fillRect(w - 7, y - 0.5, 6, 1);
    }
    // analytic critical curve (Bardeen) and the bisection points
    const cr = A.crit;
    if (cr) {
      for (const [a, b] of cr.pts) { ctx.fillStyle = C.amber; ctx.fillRect(hx(a) - 0.8, hy(b) - 0.8, 1.6, 1.6); }
    } else if (A.critJob && A.critJob.kind === 'cur') {
      const J = A.critJob;
      for (let k = 0; k < J.res.length; k++) { const d = J.res[k]; if (!d) continue; const ps = (2 * Math.PI * k) / J.res.length; ctx.fillStyle = C.amber; ctx.fillRect(hx(J.cx + d.rho * Math.cos(ps)) - 1, hy(J.cy + d.rho * Math.sin(ps)) - 1, 2, 2); }
    }
    if (P.showCrit) {
      const pts = D.crit.map(([a, b]) => [hx(a), hy(b)]);
      pts.push(pts[0]);
      dashLine(ctx, pts, UI.rgba(C.cyan, 0.95), [6, 6], 1.5);
    }
    // labels for the curve
    const lx = hx(D.critMid + D.critDiamM * 0.62), ly = hy(D.critDiamM * 0.42);
    ctx.strokeStyle = UI.rgba(C.cyan, 0.7); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx(D.critMid + D.critDiamM * 0.36), hy(D.critDiamM * 0.33)); ctx.lineTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke();
    UI.label(ctx, 'Bardeen critical curve (analytic)', lx + 22, ly - 2, C.cyan, 'left', 10);
    UI.mono(ctx, cr ? `· ${cr.pts.length} ray-traced points, fp64` : '· bisecting…', lx + 22, ly + 10, C.amber, 'left', 9.5);
    // scale bar 50 µas
    const sbw = (50 / ua / 40) * HW, sbx = 22, sby = h - 46;
    ctx.fillStyle = C.white; ctx.fillRect(sbx, sby, sbw, 2);
    ctx.fillRect(sbx, sby - 4, 1, 10); ctx.fillRect(sbx + sbw - 1, sby - 4, 1, 10);
    UI.mono(ctx, '50 µas', sbx, sby - 8, C.white, 'left', 10.5, true);
    UI.mono(ctx, `= ${(50 / ua).toFixed(2)} M = ${((50 / ua) * D.rg / 1.496e11).toFixed(3)} au`, sbx + 50, sby - 8, C.muted, 'left', 9.5);
    // spin-axis compass
    const kx = w - 118, ky = 66;
    ctx.fillStyle = 'rgba(7,6,10,0.6)'; ctx.beginPath(); ctx.arc(kx, ky, 34, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(kx, ky, 34, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = UI.rgba(C.amber, 0.8); ctx.beginPath(); ctx.ellipse(kx, ky, 26, 26 * Math.cos(D.inc), 0, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = C.white; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(kx, ky - 26 * Math.sin(D.inc)); ctx.stroke();
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(kx, ky - 26 * Math.sin(D.inc) - 5); ctx.lineTo(kx - 3.5, ky - 26 * Math.sin(D.inc) + 1); ctx.lineTo(kx + 3.5, ky - 26 * Math.sin(D.inc) + 1); ctx.fill();
    UI.mono(ctx, 'J', kx + 6, ky - 20, C.white, 'left', 10, true);
    // rotation sense arrow on the ellipse (approaching side on the left)
    ctx.strokeStyle = C.orange; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(kx, ky, 26, 26 * Math.cos(D.inc), 0, 0.15 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    UI.label(ctx, 'spin axis', kx, ky + 46, C.muted, 'center', 9.5);
    // colorbar
    const cbx = w - 24, cby = 40, cbh = 150;
    if (!heroBar) {
      heroBar = document.createElement('canvas'); heroBar.width = 1; heroBar.height = cbh;
      const c2 = heroBar.getContext('2d'), im = c2.createImageData(1, cbh);
      for (let i = 0; i < cbh; i++) { const c = GLX.inferno(1 - i / cbh); im.data.set([c[0], c[1], c[2], 255], i * 4); }
      c2.putImageData(im, 0, 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heroBar, cbx, cby, 10, cbh);
    ctx.imageSmoothingEnabled = true;
    frame(ctx, cbx - 1, cby - 1, 12, cbh + 2, C.line);
    // ticks: decades relative to the brightest disk pixel; 2.9 dex below it map linearly, the hot spot's headroom
    // above 0 rolls off in a soft knee
    const vOf = (x) => (x <= 0 ? 0.85 + (0.85 * x) / 2.9 : 0.85 + 0.15 * (1 - Math.exp(-x / 0.5)));
    for (const dd of [1, 0, -1, -2]) {
      const yy = cby + (1 - vOf(dd)) * cbh;
      ctx.fillStyle = dd === 0 ? C.amber : C.text; ctx.fillRect(cbx - 4, Math.round(yy), dd === 0 ? 14 : 3, 1);
      UI.mono(ctx, dd > 0 ? '+1' : dd === 0 ? '0' : UI.neg(String(dd)), cbx - 7, yy + 3, dd === 0 ? C.amber : C.text, 'right', 9.5);
    }

    UI.label(ctx, 'log I/I_max', cbx + 10, cby + cbh + 22, C.muted, 'right', 9.5);
  }
  function annotate(ctx, ax, ay, lx, ly, text, sub, col, side) {
    const tw = Math.max(UI.textW(ctx, text, F.label(10)), sub ? UI.textW(ctx, sub, F.mono(9.5)) : 0);
    ctx.strokeStyle = UI.rgba(col, 0.75); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke();
    dot(ctx, ax, ay, 2, col);
    const right = side ? side > 0 : lx >= ax;
    const bx = right ? lx + 4 : lx - tw - 12;
    ctx.fillStyle = 'rgba(7,6,10,0.7)'; ctx.fillRect(bx, ly - 11, tw + 8, sub ? 26 : 15);
    UI.label(ctx, text, bx + 4, ly, col, 'left', 10);
    if (sub) UI.mono(ctx, sub, bx + 4, ly + 12, C.muted, 'left', 9.5);
  }
  function drawHeroDyn(ctx, w, h) {
    const D = A.D, ua = D.uasPerM, cr = A.crit;
    const an = A.anno;
    if (an) {
      if (an.bright) annotate(ctx, hx(an.bright[0]), hy(an.bright[1]), hx(-18.6), hy(6.2), 'approaching side', `g^4 boost up to ${(A.pass.gmax ** 4).toFixed(2)}×`, C.amber, 1);
      if (an.arch) annotate(ctx, hx(an.arch[0]), hy(an.arch[1]), hx(an.arch[0] - 9), hy(an.arch[1] + 2.4), 'lensed far side', 'bent over the north pole', C.text, -1);
      if (an.n1) annotate(ctx, hx(an.n1[0]), hy(an.n1[1]), hx(an.n1[0] - 5), hy(an.n1[1] - 2.4), 'n = 1 image of the underside', `${A.dyn ? (100 * (A.dyn.f1 + A.dyn.f2)).toFixed(2) : '—'} % of the flux`, C.magenta, -1);
    }
    // centroid crosshair (intensity weighted, from the 128^2 readback)
    const d = A.dyn;
    if (d) {
      const cx = hx(d.cx / ua), cy = hy(d.cy / ua);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx - 3, cy); ctx.moveTo(cx + 3, cy); ctx.lineTo(cx + 9, cy);
      ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy - 3); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, 2 * Math.PI); ctx.stroke();
      const ct = `centroid ${UI.neg(d.cx.toFixed(1))}, ${UI.neg(d.cy.toFixed(1))} µas`;
      UI.setFont(ctx, F.mono(9.5), 'normal');
      const ctw = ctx.measureText(ct).width; // measured every frame, so the box always fits the text
      // keep the label off the shadow: flip it to the left of the crosshair when it would cross the critical curve
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const [a, b] of D.crit) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
      const sx0 = hx(a0), sx1 = hx(a1), sy0 = hy(b1), sy1 = hy(b0);
      let lx = cx + 9;
      const ly = cy + 9;
      if (lx + ctw + 8 > sx0 && lx < sx1 && ly + 14 > sy0 && ly < sy1) lx = cx - 9 - ctw - 8;
      ctx.fillStyle = 'rgba(7,6,10,0.82)'; ctx.fillRect(lx, ly, ctw + 8, 14);
      UI.mono(ctx, ct, lx + 4, ly + 10, C.cyan, 'left', 9.5);
    }
    // corner readouts
    const bx = w - 248, by = h - 128;
    ctx.fillStyle = 'rgba(7,6,10,0.8)'; ctx.fillRect(bx, by, 236, 102);
    frame(ctx, bx, by, 236, 102, C.line);
    let ry = by + 16;
    const rr = (k, v, vc = C.text) => { kvR(ctx, k, v, w - 20, ry, vc); ry += 14; };
    rr('shadow d (area-eq.)', cr ? `${cr.diamUas.toFixed(3)} µas` : '…', C.cyan);
    rr('EHT 2022 ring', '51.8 ± 2.3 µas', C.muted);
    rr('vs Bardeen, mean |Δr|/r', cr ? `${UI.sci(cr.errPct, 2)} %` : '…', C.up);
    rr('r_isco', `${D.risco.toFixed(4)} M`);
    rr('g_max (visible disk)', isFinite(A.pass.gmax) ? A.pass.gmax.toFixed(4) : '—', C.cyan);
    rr('n≥1 flux share', d ? `${(100 * (d.f1 + d.f2)).toFixed(2)} %` : '—', C.magenta);
    // the tiles being re-traced right now: a faint scanline across their row, their 32 x 32 outlines and a tag
    const tiles = A.curTiles || [];
    if (tiles.length) {
      const tw = (GLX.TILE / GLX.MAP_W) * w, th = (GLX.TILE / GLX.MAP_H) * h;
      const TXc = (t) => (t[0] * GLX.TILE / GLX.MAP_W) * w, TYc = (t) => h - ((t[1] + 1) * GLX.TILE / GLX.MAP_H) * h;
      const t0 = tiles[0], tl = tiles[tiles.length - 1];
      ctx.fillStyle = UI.rgba(C.cyan, 0.05); ctx.fillRect(1, TYc(t0), w - 2, th);
      ctx.strokeStyle = UI.rgba(C.cyan, 0.6); ctx.lineWidth = 1;
      for (const t of tiles) ctx.strokeRect(Math.round(TXc(t)) + 0.5, Math.round(TYc(t)) + 0.5, Math.round(tw) - 1, Math.round(th) - 1);
      const tag = `re-trace tile ${UI.int(A.passTile)}/${UI.int(A.tileOrder.length)}`;
      UI.setFont(ctx, F.mono(9), 'normal');
      const tgw = ctx.measureText(tag).width;
      let gx = TXc(tl) + tw + 4;
      if (gx + tgw + 6 > w - 30) gx = TXc(t0) - tgw - 10;
      const gy = TYc(tl) + th / 2 + 4;
      ctx.fillStyle = 'rgba(7,6,10,0.75)'; ctx.fillRect(gx - 2, gy - 9, tgw + 6, 12);
      UI.mono(ctx, tag, gx + 1, gy, C.cyan, 'left', 9);
    }
  }

  // ------------------------------------------------------------------ maps strip
  const MAP_T = [['REDSHIFT g', 'Doppler + gravitational'], ['DELAY Δt', 'light travel, M'], ['RING ORDER n', 'equator crossings'], ['EMISSION r', 'disk radius, M']];
  function mapColor(mode, v, lo, hi) {
    const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    if (mode === 0) {
      const mid = [41, 36, 51], red = [255, 84, 64], blue = [89, 217, 255];
      if (v < 1) { const x = clamp((1 - v) / Math.max(1 - lo, 1e-3), 0, 1); return mix(mid, red, Math.pow(x, 0.75)).map((c) => c * (1 - 0.35 * x * x)); }
      const x = clamp((v - 1) / Math.max(hi - 1, 1e-3), 0, 1); return mix(mid, blue, Math.pow(x, 0.75)).map((c) => Math.min(255, c + 127 * x * x * x));
    }
    if (mode === 1) {
      const c0 = [18, 13, 36], c1 = [143, 122, 255], c2 = [89, 217, 255], c3 = [245, 242, 232];
      const x = clamp(v, 0, 1);
      return x < 0.4 ? mix(c0, c1, x / 0.4) : x < 0.75 ? mix(c1, c2, (x - 0.4) / 0.35) : mix(c2, c3, (x - 0.75) / 0.25);
    }
    const c0 = [250, 242, 217], c1 = [255, 181, 61], c2 = [209, 54, 122], c3 = [31, 18, 51];
    const x = clamp(v, 0, 1);
    return x < 0.2 ? mix(c0, c1, x / 0.2) : x < 0.55 ? mix(c1, c2, (x - 0.2) / 0.35) : mix(c2, c3, (x - 0.55) / 0.45);
  }
  const mapBars = [];
  function drawMaps(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const p = A.pass, D = A.D, d = A.dyn;
    const st = mapStats();
    for (let k = 0; k < 4; k++) {
      const x0 = k * 222;
      ctx.fillStyle = C.surface;
      ctx.fillRect(x0, 0, 214, 20); ctx.fillRect(x0, 195, 214, h - 195);
      frame(ctx, x0, 0, 214, h);
      ctx.fillStyle = C.line; ctx.fillRect(x0 + 1, 20, 212, 1); ctx.fillRect(x0 + 1, 195, 212, 1);
      UI.title(ctx, MAP_T[k][0], x0 + 7, 14, 11.5, C.text);
      UI.label(ctx, MAP_T[k][1], x0 + 207, 14, C.muted, 'right', 9.5);
      // colorbar
      const cx = x0 + 10, cw = 194, cy = 203;
      if (k === 2) {
        const cats = [['0', '#FFB63D'], ['1', '#D1357A'], ['2', '#59D8FF'], ['≥3', '#F4F1E8']];
        cats.forEach(([lab, col], i) => {
          ctx.fillStyle = col; ctx.fillRect(cx + i * 49, cy, 45, 7);
          UI.mono(ctx, `n=${lab}`, cx + i * 49 + 22, cy + 18, C.text, 'center', 9.5);
        });
      } else {
        const [lo, hi] = k === 0 ? [p.gmin, p.gmax] : k === 1 ? [0, p.tmax - p.tmin] : [D.risco, A.P.rout];
        const sq = k === 1;
        const key = k + ':' + lo.toFixed(4) + ':' + hi.toFixed(4);
        if (!mapBars[k] || mapBars[k].key !== key) {
          const bc = document.createElement('canvas'); bc.width = cw; bc.height = 1;
          const c2 = bc.getContext('2d'), im = c2.createImageData(cw, 1);
          for (let i = 0; i < cw; i++) {
            const t = i / (cw - 1);
            const v = k === 0 ? lo + (hi - lo) * t : t; // delay: colour index is sqrt(dt / range); radius: inner = bright
            const c = mapColor(k === 0 ? 0 : k === 1 ? 1 : 3, v, lo, hi);
            im.data.set([c[0], c[1], c[2], 255], i * 4);
          }
          c2.putImageData(im, 0, 0);
          mapBars[k] = { key, cv: bc };
        }
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mapBars[k].cv, cx, cy, cw, 7);
        ctx.imageSmoothingEnabled = true;
        const fl = k === 0 ? (v) => v.toFixed(2) : (v) => v.toFixed(0);
        const vals = k === 0 ? [lo, 1, hi] : k === 1 ? [0, hi / 4, hi] : [lo, (lo + hi) / 2, hi];
        vals.forEach((v, i) => {
          const tx = k === 0 ? cx + ((v - lo) / (hi - lo)) * cw : sq ? cx + Math.sqrt(v / hi) * cw : cx + (i / 2) * cw;
          ctx.fillStyle = C.text; ctx.fillRect(Math.round(tx), cy + 8, 1, 3);
          UI.mono(ctx, k === 3 && i === 0 ? v.toFixed(2) : fl(v), clamp(tx, cx + 10, cx + cw - 10), cy + 19, C.text, i === 0 ? 'left' : i === 2 ? 'right' : 'center', 9.5);
        });
      }
      // stats
      const s = st[k];
      let yy = 238;
      for (const [lab, val, col] of s) {
        UI.label(ctx, lab, x0 + 9, yy, C.muted, 'left', 10);
        UI.mono(ctx, val, x0 + 205, yy, col || C.text, 'right', 10.5);
        yy += 14;
      }
      // spot marker on each map
      if (d && d.Is > 0) {
        const mx = x0 + ((d.spx + 20) / 40) * 214, my = 20 + ((A.field[1] + A.field[3] - d.spy) / A.field[3]) * 175;
        if (my > 22 && my < 193) {
          ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my, 5, 0, 2 * Math.PI); ctx.stroke();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(mx, my, 6.2, 0, 2 * Math.PI); ctx.stroke();
        }
      }
    }
  }
  function mapStats() {
    const p = A.pass, D = A.D, d = A.dyn, sp = A.spotProbe || {};
    const hitPct = (100 * p.hit) / Math.max(1, p.rays);
    return [
      [['min / max', `${p.gmin.toFixed(3)} / ${p.gmax.toFixed(3)}`], ['mean over disk', p.hit ? (p.sumG / p.hit).toFixed(3) : '—'], ['spot ⟨g⟩ now', d ? d.gs.toFixed(3) : '—', C.cyan], ['g⁴ beaming max', (p.gmax ** 4).toFixed(2) + '×', C.amber]],
      [['range', `0 – ${(p.tmax - p.tmin).toFixed(1)} M`], ['in time', `${((p.tmax - p.tmin) * D.tg / 60).toFixed(1)} min`], ['t_hit min (from r 1000)', `${p.tmin.toFixed(1)} M`], ['mean Δt over disk', p.hit ? `${(p.sumT / p.hit + 1000 - p.tmin).toFixed(2)} M` : '—', C.cyan]],
      [['disk pixels', `${hitPct.toFixed(1)} %`], ['n≥1 / n≥2 px', `${((100 * p.hit1) / Math.max(1, p.rays)).toFixed(2)} / ${((100 * p.hit2) / Math.max(1, p.rays)).toFixed(3)} %`], ['flux n=1', d ? `${(100 * d.f1).toFixed(2)} %` : '—', C.magenta], ['flux n≥2', d ? `${(100 * d.f2).toFixed(3)} %` : '—', C.cyan]],
      [['r range', `${D.risco.toFixed(2)} – ${A.P.rout} M`], ['mean r_hit', `${(p.sumR / Math.max(1, p.hit)).toFixed(2)} M`], ['ISCO', `${D.risco.toFixed(3)} M`], ['flux peak r', `${D.rFmax.toFixed(2)} M`, C.amber]],
    ];
  }

  // ------------------------------------------------------------------ geodesics: meridional x-z (alpha = 0 rays) and equatorial x-y (beta = 0 rays)
  let geoStatic = null, geoKey = null, geoArc = null;
  const GW = 416, GH = 300;
  const GV1 = { x0: 4, y0: 24, w: 272, h: 252, cx: 4 + 136, cy: 24 + 126, s: 12.0 };   // x-z, +-11 M
  const GV2 = { x0: 280, y0: 24, w: 132, h: 252, cx: 280 + 66, cy: 24 + 112, s: 6.4 }; // x-y, top view
  const FATE_COL = (r) => (r.fate === 1 ? (r.n === 0 ? C.amber : r.n === 1 ? C.magenta : C.white) : r.fate === 2 ? C.cyan : C.violet);
  function geoStaticRender() {
    const d = UI.dpr(), cv = document.createElement('canvas');
    cv.width = GW * d; cv.height = GH * d;
    const ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    UI.panel(ctx, GW, GH, 'Photon geodesics', 'CPU fp64 · 64 rays from the image midlines', { mark: C.cyan });
    const D = A.D, a = A.P.a;
    for (const V of [GV1, GV2]) {
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(V.x0, V.y0, V.w, V.h);
      ctx.save(); ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
      const X = (x) => V.cx + x * V.s, Z = (z) => V.cy - z * V.s;
      for (let g = -20; g <= 20; g += 5) { ctx.fillStyle = C.faint; ctx.fillRect(Math.round(X(g)), V.y0, 1, V.h); ctx.fillRect(V.x0, Math.round(Z(g)), V.w, 1); }
      for (const r of [D.rphP, D.rphR]) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = UI.rgba(C.cyan, 0.6); ctx.beginPath(); ctx.arc(X(0), Z(0), r * V.s, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
      if (V === GV1) {
        ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = UI.rgba(C.magenta, 0.9); ctx.beginPath();
        for (let k = 0; k <= 120; k++) { const th = (2 * Math.PI * k) / 120, r = K.rergo(a, th); const x = X(r * Math.sin(th)), z = Z(r * Math.cos(th)); k ? ctx.lineTo(x, z) : ctx.moveTo(x, z); }
        ctx.stroke(); ctx.restore();
        for (const sg of [1, -1]) {
          const grd = ctx.createLinearGradient(X(0), 0, X(sg * A.P.rout), 0);
          grd.addColorStop(0, C.white); grd.addColorStop(0.12, C.amber); grd.addColorStop(1, UI.rgba(C.orange, 0.1));
          ctx.fillStyle = grd; ctx.fillRect(Math.min(X(sg * D.risco), X(sg * A.P.rout)), Z(0) - 1.5, (A.P.rout - D.risco) * V.s, 3);
        }
      } else {
        // disk seen from above: ISCO and outer edge, ergosphere (equatorial r = 2)
        const grd = ctx.createRadialGradient(X(0), Z(0), D.risco * V.s, X(0), Z(0), A.P.rout * V.s);
        grd.addColorStop(0, UI.rgba(C.amber, 0.28)); grd.addColorStop(1, UI.rgba(C.orange, 0.02));
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(X(0), Z(0), A.P.rout * V.s, 0, 2 * Math.PI); ctx.arc(X(0), Z(0), D.risco * V.s, 0, 2 * Math.PI, true); ctx.fill();
        ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = UI.rgba(C.magenta, 0.9); ctx.beginPath(); ctx.arc(X(0), Z(0), 2 * V.s, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = UI.rgba(C.amber, 0.9); ctx.beginPath(); ctx.arc(X(0), Z(0), D.risco * V.s, 0, 2 * Math.PI); ctx.stroke();
      }
      // rays
      ctx.lineWidth = 0.9;
      for (const r of A.geo) {
        if ((V === GV1) !== (r.al === 0)) continue;
        const p = r.path;
        ctx.strokeStyle = UI.rgba(FATE_COL(r), V === GV1 ? 0.5 : 0.55);
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 3) { const x = X(p[i]), z = V === GV1 ? Z(p[i + 1]) : Z(p[i + 2]); i ? ctx.lineTo(x, z) : ctx.moveTo(x, z); }
        ctx.stroke();
      }
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(X(0), Z(0), D.rplus * V.s, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(0), Z(0), D.rplus * V.s, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
      frame(ctx, V.x0, V.y0, V.w, V.h, C.line);
    }
    // labels
    const X1 = (x) => GV1.cx + x * GV1.s, Z1 = (z) => GV1.cy - z * GV1.s;
    UI.label(ctx, 'meridian x–z · rays α = 0', GV1.x0 + 6, GV1.y0 + 12, C.text, 'left', 9.5);
    UI.label(ctx, 'equator x–y · β = 0', GV2.x0 + 6, GV2.y0 + 12, C.text, 'left', 9.5);
    const lab = (t, x, y, col, al = 'left') => {
      const tw = UI.textW(ctx, t, F.mono(9.5)), bx = al === 'right' ? x - tw : al === 'center' ? x - tw / 2 : x;
      ctx.fillStyle = 'rgba(11,10,16,0.82)'; ctx.fillRect(bx - 2, y - 9, tw + 4, 12);
      UI.mono(ctx, t, x, y, col, al, 9.5);
    };
    lab(`r+ ${D.rplus.toFixed(3)}`, X1(0) + 3, Z1(-1.3) + 10, C.white);
    lab('ergosphere', X1(-2.2), Z1(1.9), C.magenta, 'right');
    lab(`r_ph ${D.rphP.toFixed(2)}–${D.rphR.toFixed(2)}`, X1(0), Z1(-D.rphR) + 12, C.cyan, 'center');
    ctx.fillStyle = C.amber; ctx.fillRect(Math.round(X1(D.risco)), Z1(0) - 6, 1, 12); ctx.fillRect(Math.round(X1(-D.risco)), Z1(0) - 6, 1, 12);
    lab(`ISCO ${D.risco.toFixed(3)}`, X1(D.risco) + 3, Z1(0) - 7, C.amber);
    lab(`disk → ${A.P.rout} M`, GV1.x0 + GV1.w - 4, Z1(0) + 13, C.amber, 'right');
    const oz = Z1(9.6 / Math.tan(D.inc));
    ctx.strokeStyle = C.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X1(7.2), Z1(7.2 / Math.tan(D.inc))); ctx.lineTo(X1(10.6), Z1(10.6 / Math.tan(D.inc))); ctx.stroke();
    lab(`observer, i ${A.P.incDeg}°`, GV1.x0 + GV1.w - 4, Math.max(GV1.y0 + 24, oz - 6), C.text, 'right');
    const X2 = (x) => GV2.cx + x * GV2.s, Y2 = (y) => GV2.cy - y * GV2.s;
    lab('ISCO', X2(0), Y2(-D.risco) + 12, C.amber, 'center');
    lab('prograde ↺', GV2.x0 + GV2.w - 4, GV2.y0 + GV2.h - 6, C.orange, 'right');
    // legend
    const lg2 = [['disk n=0', C.amber], ['n=1', C.magenta], ['captured', C.violet], ['escaped', C.cyan]];
    let lx = 8;
    for (const [t, c] of lg2) { ctx.fillStyle = c; ctx.fillRect(lx, GH - 12, 10, 2); UI.label(ctx, t, lx + 14, GH - 8, C.muted, 'left', 9.5); lx += UI.textW(ctx, t, F.label(9.5)) + 26; }
    const cnt = A.geo.reduce((s2, r) => s2 + r.path.length / 3, 0);
    UI.mono(ctx, `${UI.int(cnt)} points, h 0.03`, GW - 8, GH - 8, C.dim, 'right', 9.5);
    return cv;
  }
  function drawGeo(ctx, w, h, now) {
    if (!geoStatic || geoKey !== A.geo) { geoStatic = geoStaticRender(); geoKey = A.geo; }
    ctx.drawImage(geoStatic, 0, 0, w, h);
    const T = now / 1000;
    if (!geoArc || geoArc.key !== A.geo) {
      const rng = STUDIO.rng(77);
      geoArc = { key: A.geo, rays: A.geo.map((r) => {
        const p = r.path, n = p.length / 3, cum = new Float64Array(n);
        const zi = r.al === 0 ? 1 : 2;
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 3] - p[i * 3 - 3], p[i * 3 + zi] - p[i * 3 + zi - 3]);
        return { cum, off: rng() * 60, speed: 9 + 4 * rng() };
      }) };
    }
    for (const V of [GV1, GV2]) {
      const X = (x) => V.cx + x * V.s, Z = (z) => V.cy - z * V.s;
      ctx.save(); ctx.beginPath(); ctx.rect(V.x0, V.y0, V.w, V.h); ctx.clip();
      A.geo.forEach((r, k) => {
        if ((V === GV1) !== (r.al === 0)) return;
        const p = r.path, n = p.length / 3, g = geoArc.rays[k];
        if (n < 3) return;
        const L = g.cum[n - 1], period = L + 20;
        const sNow = (T * g.speed + g.off) % period;
        const col = FATE_COL(r);
        for (let tr = 5; tr >= 0; tr--) {
          const sp = sNow - tr * 1.1;
          if (sp < 0 || sp > L) continue;
          let lo = 0, hi = n - 1;
          while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.cum[m] <= sp) lo = m; else hi = m - 1; }
          const jj = lo;
          const x = X(p[jj * 3]), z = V === GV1 ? Z(p[jj * 3 + 1]) : Z(p[jj * 3 + 2]);
          ctx.fillStyle = tr ? UI.rgba(col, 0.75 - tr * 0.12) : C.white;
          const s2 = tr ? 1.6 : 2.6;
          ctx.fillRect(x - s2 / 2, z - s2 / 2, s2, s2);
        }
      });
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ spin sweep
  let sweepCurves = null;
  function sweepAna() {
    const out = {};
    for (const deg of [72, 17]) {
      const inc = (deg * Math.PI) / 180, d = [], o = [];
      for (let k = 0; k <= 60; k++) {
        const a = (0.998 * k) / 60;
        const crit = K.critCurve(a, inc, 360), ar = K.polyArea(crit);
        d.push([a, 2 * Math.sqrt(ar.A / Math.PI) * A.D.uasPerM]); o.push([a, ar.cx * A.D.uasPerM]);
      }
      out[deg] = { d, o };
    }
    return out;
  }
  function drawSweep(ctx, w, h) {
    UI.panel(ctx, w, h, 'Spin sweep', 'ray-traced vs analytic', { mark: C.violet });
    if (!sweepCurves) sweepCurves = sweepAna();
    const pts = A.sweep;
    const px0 = 36, px1 = w - 8;
    const X = (a) => px0 + 6 + (a / 1) * (px1 - px0 - 10);
    const plot = (y0, y1, key, lo, hi, label, fmt) => {
      ctx.fillStyle = '#0B0A10'; ctx.fillRect(px0, y0, px1 - px0, y1 - y0);
      const Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
      const tk = ticks(lo, hi, 4);
      for (const v of tk.v) { const yy = Math.round(Y(v)); ctx.fillStyle = C.grid; ctx.fillRect(px0, yy, px1 - px0, 1); UI.mono(ctx, fmtT(v, tk.step), px0 - 4, yy + 3, C.muted, 'right', 9.5); }
      for (const a of [0, 0.5, 1]) { ctx.fillStyle = C.grid; ctx.fillRect(Math.round(X(a)), y0, 1, y1 - y0); }
      // analytic curves
      line(ctx, sweepCurves[72][key].map(([a, v]) => [X(a), Y(v)]), C.cyan, 1.2);
      dashLine(ctx, sweepCurves[17][key].map(([a, v]) => [X(a), Y(v)]), UI.rgba(C.violet, 0.9), [3, 2], 1);
      // current spin
      ctx.fillStyle = UI.rgba(C.white, 0.35); ctx.fillRect(Math.round(X(A.P.a)), y0, 1, y1 - y0);
      // measured points: i = 72° hollow amber circles first, then i = 17° filled violet squares on top, 4 px right
      for (const s of pts) {
        if (s.tag === 17) continue;
        const v = key === 'd' ? s.diamUas : s.offUas;
        ctx.fillStyle = '#0B0A10'; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 3.2, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(X(s.a), Y(v), 2.6, 0, 2 * Math.PI); ctx.stroke();
      }
      for (const s of pts) {
        if (s.tag !== 17) continue;
        const v = key === 'd' ? s.diamUas : s.offUas;
        ctx.fillStyle = '#0B0A10'; ctx.fillRect(X(s.a) + 4 - 3, Y(v) - 3, 6, 6);
        ctx.fillStyle = C.violet; ctx.fillRect(X(s.a) + 4 - 2.2, Y(v) - 2.2, 4.4, 4.4);
      }
      // point in progress
      const J = A.critJob;
      if (J && J.kind === 'sweep') {
        const fr = J.doneCount / 180;
        ctx.strokeStyle = UI.rgba(J.tag === 17 ? C.violet : C.amber, 0.8); ctx.lineWidth = 1;
        const v = key === 'd' ? 2 * Math.sqrt(K.polyArea(J.crit).A / Math.PI) * A.D.uasPerM : K.polyArea(J.crit).cx * A.D.uasPerM;
        ctx.beginPath(); ctx.arc(X(J.a), Y(v), 5, -Math.PI / 2, -Math.PI / 2 + fr * 2 * Math.PI); ctx.stroke();
      }
    };
    const dv = [...sweepCurves[72].d, ...sweepCurves[17].d].map((p) => p[1]);
    const ov = [...sweepCurves[72].o, ...sweepCurves[17].o].map((p) => p[1]);
    const pad = (v, f) => { const a = Math.min(...v), b = Math.max(...v), p = (b - a) * f; return [a - p, b + p]; };
    const [dlo, dhi] = pad(dv, 0.08), [olo, ohi] = pad(ov, 0.1);
    plot(40, 150, 'd', dlo, dhi, 'd_shadow [µas]');
    plot(174, 262, 'o', olo, ohi, 'offset α_c [µas]');
    UI.label(ctx, 'shadow diameter d [µas]', px1, 35, C.muted, 'right', 9.5);
    UI.label(ctx, 'centroid offset α_c [µas]', px0, 169, C.muted, 'left', 9.5);
    for (const a of [0, 0.5, 1]) UI.mono(ctx, a.toFixed(1), X(a), 274, C.muted, a === 0 ? 'left' : a === 1 ? 'right' : 'center', 9.5);
    UI.label(ctx, 'spin a', (px0 + px1) / 2 + 30, 274, C.muted, 'left', 9.5);
    const n72 = pts.filter((s) => s.tag === 72).length, n17 = pts.filter((s) => s.tag === 17).length;
    const last = pts[pts.length - 1];
    ctx.strokeStyle = C.amber; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(12, 285, 2.6, 0, 2 * Math.PI); ctx.stroke();
    UI.mono(ctx, `i 72° ${n72}/24`, 20, 289, C.text, 'left', 9.5);
    ctx.fillStyle = C.violet; ctx.fillRect(100, 283, 4, 4);
    UI.mono(ctx, `17° ${n17}/24`, 110, 289, C.text, 'left', 9.5);
    UI.mono(ctx, last ? `${last.secs.toFixed(1)} s/pt` : '', w - 8, 289, C.muted, 'right', 9.5);
  }

  // ------------------------------------------------------------------ light curve
  function drawLC(ctx, w, h) {
    UI.panel(ctx, w, h, 'Hot-spot light curve', '', { mark: C.orange });
    ctx.fillStyle = C.amber; ctx.fillRect(w - 214, 11, 10, 6);
    UI.label(ctx, 'spot, % of ⟨F⟩ (left)', w - 200, 17, C.amber, 'left', 9.5);
    ctx.fillStyle = C.white; ctx.fillRect(w - 98, 13, 10, 1.5);
    UI.label(ctx, 'F/⟨F⟩ (right)', w - 84, 17, C.text, 'left', 9.5);
    const L = A.lc;
    if (L.length < 2) return;
    const tNow = L[L.length - 1].t, win = 150 * 60, t0 = tNow - win;
    const x0 = 40, x1 = w - 40, y0 = 30, y1 = 176;
    const X = (t) => x0 + ((t - t0) / win) * (x1 - x0);
    const meanIt = L.reduce((s, p) => s + p.It, 0) / L.length;
    const pts = L.filter((p) => p.t >= t0);
    const spotPct = pts.map((p) => (100 * p.Is) / meanIt);
    const smax = Math.max(1, ...spotPct) * 1.15;
    const tot = pts.map((p) => p.It / meanIt);
    const tlo = Math.min(...tot), thi = Math.max(...tot);
    const tpad = (thi - tlo) * 0.15 + 1e-3;
    const Ys = (v) => y1 - (v / smax) * (y1 - y0);
    const Yt = (v) => y1 - ((v - (tlo - tpad)) / (thi - tlo + 2 * tpad)) * (y1 - y0);
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const tk = ticks(0, smax, 4);
    for (const v of tk.v) { const yy = Math.round(Ys(v)); ctx.fillStyle = C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, fmtT(v, tk.step), x0 - 4, yy + 3, C.amber, 'right', 9.5); }
    const tk2 = ticks(tlo - tpad, thi + tpad, 4);
    for (const v of tk2.v) UI.mono(ctx, v.toFixed(3), x1 + 4, Yt(v) + 3, C.muted, 'left', 9.5);
    // UT ticks every 30 min
    const ut0 = A.utOf(t0);
    for (let u = Math.ceil(ut0 / 1800) * 1800; u < A.utOf(tNow); u += 1800) {
      const xx = Math.round(X(u - A.utOf(0)));
      ctx.fillStyle = C.grid; ctx.fillRect(xx, y0, 1, y1 - y0);
      UI.mono(ctx, UI.hhmm(u).slice(0, 5), xx, y1 + 12, C.muted, 'center', 9.5);
    }

    // spot (filled) and total (line)
    ctx.beginPath(); ctx.moveTo(X(pts[0].t), y1);
    pts.forEach((p, i) => ctx.lineTo(X(p.t), Ys(spotPct[i])));
    ctx.lineTo(X(pts[pts.length - 1].t), y1); ctx.closePath();
    const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, UI.rgba(C.amber, 0.45)); g.addColorStop(1, UI.rgba(C.orange, 0.05));
    ctx.fillStyle = g; ctx.fill();
    line(ctx, pts.map((p, i) => [X(p.t), Ys(spotPct[i])]), C.amber, 1.3);
    line(ctx, pts.map((p, i) => [X(p.t), Yt(tot[i])]), UI.rgba(C.white, 0.75), 1);
    // peaks and troughs of the spot flux (local extrema over +-6 min)
    const ext = [];
    const half = Math.round(360 / Math.max(1, (pts[pts.length - 1].t - pts[0].t) / pts.length));
    for (let i = half; i < pts.length - half; i++) {
      let isMax = true, isMin = true;
      for (let j = i - half; j <= i + half; j++) { if (spotPct[j] > spotPct[i]) isMax = false; if (spotPct[j] < spotPct[i]) isMin = false; }
      if (isMax) ext.push({ i, max: true }); else if (isMin) ext.push({ i, max: false });
    }
    const peaks = [];
    let lastLab = -1e9;
    for (const e of ext) {
      const p = pts[e.i], xx = X(p.t), yy = Ys(spotPct[e.i]);
      if (e.max) {
        peaks.push(p.t);
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = UI.rgba(C.amber, 0.45); ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, y0); ctx.lineTo(Math.round(xx) + 0.5, y1); ctx.stroke(); ctx.restore();
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(xx, yy - 3); ctx.lineTo(xx - 3.5, yy - 9); ctx.lineTo(xx + 3.5, yy - 9); ctx.fill();
        if (xx - lastLab > 50 && xx < x1 - 30) { UI.mono(ctx, `${spotPct[e.i].toFixed(1)}%`, xx + 5, Math.max(y0 + 22, yy - 4), C.amber, 'left', 9.5); lastLab = xx; }
      } else if (xx > x0 + 20 && xx < x1 - 30) {
        ctx.fillStyle = C.muted; ctx.beginPath(); ctx.moveTo(xx, yy + 2); ctx.lineTo(xx - 3, yy + 7); ctx.lineTo(xx + 3, yy + 7); ctx.fill();
      }
    }
    // now marker
    ctx.fillStyle = C.cyan; ctx.fillRect(Math.round(X(tNow)) - 1, y0, 2, y1 - y0);
    // readouts
    const D = A.D;
    let pp = null;
    if (peaks.length >= 2) pp = (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) / 60;
    const recent = spotPct.slice(-Math.round(pts.length * (D.spotPeriodMin / 150)));
    const mx = Math.max(...recent), mn = Math.min(...recent);
    const ry = h - 12;
    kv(ctx, 'P_orbit', `${D.spotPeriodMin.toFixed(2)} min`, 8, ry, C.cyan);
    kv(ctx, 'peaks', pp ? `${pp.toFixed(1)} min` : '…', 118, ry, C.amber);
    kv(ctx, 'max/min', `${mx.toFixed(1)}/${mn.toFixed(1)}%`, 214, ry, C.text);
    kv(ctx, 'now', `${spotPct[spotPct.length - 1].toFixed(1)}%`, 344, ry, C.amber);
  }

  // ------------------------------------------------------------------ centroid loop
  let centR = 15;
  function drawCentroid(ctx, w, h) {
    UI.panel(ctx, w, h, 'Centroid loop', 'astrometry, µas', { mark: C.cyan });
    const L = A.lc;
    if (L.length < 3) return;
    const D = A.D;
    const winT = D.spotPeriodMin * 60 * 1.25;
    const tNow = L[L.length - 1].t;
    const pts = L.filter((p) => p.t >= tNow - winT * 2);
    const mx = pts.reduce((s, p) => s + p.cx, 0) / pts.length, my = pts.reduce((s, p) => s + p.cy, 0) / pts.length;
    let R = 0.5;
    for (const p of pts) R = Math.max(R, Math.abs(p.cx - mx), Math.abs(p.cy - my));
    // fixed ±15 µas; only ever expands (by 5 µas steps), so the loop never jumps in size
    centR = Math.max(centR, Math.ceil((R * 1.1) / 5) * 5);
    R = centR;
    const sz = Math.min(w - 54, h - 82), x0 = 40, y0 = 30;
    const X = (v) => x0 + sz / 2 + ((v - mx) / R) * (sz / 2), Y = (v) => y0 + sz / 2 - ((v - my) / R) * (sz / 2);
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, sz, sz);
    ctx.fillStyle = C.grid; ctx.fillRect(x0, Math.round(y0 + sz / 2), sz, 1); ctx.fillRect(Math.round(x0 + sz / 2), y0, 1, sz);
    for (const v of [-R, R]) {
      UI.mono(ctx, UI.neg(v.toFixed(R < 2 ? 1 : 0)), x0 - 4, Y(my + v) + 3, C.muted, 'right', 9.5);
      UI.mono(ctx, UI.neg(v.toFixed(R < 2 ? 1 : 0)), X(mx + v), y0 + sz + 11, C.muted, v < 0 ? 'left' : 'right', 9.5);
    }
    UI.mono(ctx, '0', x0 - 4, y0 + sz / 2 + 3, C.muted, 'right', 9.5);
    UI.label(ctx, 'Δα', x0 + sz / 2, y0 + sz + 11, C.muted, 'center', 9.5);
    UI.label(ctx, 'Δβ', x0 + sz / 2 + 4, y0 + 10, C.muted, 'left', 9.5);
    // trail: older dimmer
    const n = pts.length;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, sz, sz); ctx.clip();
    const NB = 16;
    for (let b = 0; b < NB; b++) {
      const i0 = Math.floor((b * (n - 1)) / NB), i1 = Math.floor(((b + 1) * (n - 1)) / NB);
      const age = (tNow - pts[i1].t) / (winT * 2);
      ctx.strokeStyle = UI.rgba(age < 0.5 ? C.cyan : C.violet, Math.max(0.08, 1 - age) * 0.95);
      ctx.lineWidth = age < 0.5 ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(X(pts[i0].cx), Y(pts[i0].cy));
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(X(pts[i].cx), Y(pts[i].cy));
      ctx.stroke();
    }
    ctx.restore();
    const c = pts[n - 1];
    UI.label(ctx, '1.25 orbits', x0 + sz + 6, y0 + 10, C.muted, 'left', 9);
    ctx.fillStyle = C.cyan; ctx.fillRect(x0 + sz + 6, y0 + 16, 10, 2);
    UI.label(ctx, 'recent', x0 + sz + 6, y0 + 28, C.muted, 'left', 9);
    ctx.fillStyle = C.violet; ctx.fillRect(x0 + sz + 6, y0 + 34, 10, 2);
    UI.label(ctx, 'older', x0 + sz + 6, y0 + 46, C.muted, 'left', 9);
    dot(ctx, X(c.cx), Y(c.cy), 3.2, C.white);
    ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.arc(X(c.cx), Y(c.cy), 6, 0, 2 * Math.PI); ctx.stroke();
    // loop size over the last orbit
    const orb = pts.filter((p) => p.t >= tNow - D.spotPeriodMin * 60);
    let ax0 = 1e9, ax1 = -1e9, ay0 = 1e9, ay1 = -1e9;
    for (const p of orb) { ax0 = Math.min(ax0, p.cx); ax1 = Math.max(ax1, p.cx); ay0 = Math.min(ay0, p.cy); ay1 = Math.max(ay1, p.cy); }
    const ry = h - 24;
    kv(ctx, 'loop', `${Math.hypot(ax1 - ax0, ay1 - ay0).toFixed(2)} µas`, 8, ry, C.cyan);
    kv(ctx, 'Δα', `${(ax1 - ax0).toFixed(1)}`, 128, ry, C.text);
    kv(ctx, 'Δβ', `${(ay1 - ay0).toFixed(1)}`, 188, ry, C.text);
    kv(ctx, 'now', `${UI.neg(c.cx.toFixed(2))}, ${UI.neg(c.cy.toFixed(2))} µas`, 8, h - 9, C.white);
  }

  // ------------------------------------------------------------------ spectrum
  function drawSpectrum(ctx, w, h) {
    UI.panel(ctx, w, h, 'Disk spectrum νLν', 'Page–Thorne, ṁ 0.01', { mark: C.amber });
    const S = A.spec;
    const x0 = 44, x1 = w - 10, y0 = 40, y1 = h - 42;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (!S) { UI.mono(ctx, `integrating ${(100 * (A.specProg || 0)).toFixed(0)}%`, x0 + 8, y0 + 20, C.muted); return; }
    const nu0 = 12.7, nu1 = 18.7;
    const X = (nu) => x0 + ((lg(nu) - nu0) / (nu1 - nu0)) * (x1 - x0);
    const vl = S.nus.map((n, i) => n * S.rel[i]);
    const vmax = Math.max(...vl);
    const lo = lg(vmax) - 4.2, hi = lg(vmax) + 0.35;
    const Y = (v) => y1 - ((lg(Math.max(v, 1e-300)) - lo) / (hi - lo)) * (y1 - y0);
    for (let e = Math.ceil(lo); e <= hi; e++) { const yy = Math.round(Y(10 ** e)); ctx.fillStyle = C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, `1e${e}`, x0 - 4, yy + 3, C.muted, 'right', 9); }
    for (let e = 13; e <= 18; e++) {
      const xx = Math.round(X(10 ** e)); ctx.fillStyle = C.grid; ctx.fillRect(xx, y0, 1, y1 - y0);
      UI.mono(ctx, '10', xx - 2, y1 + 12, C.muted, 'right', 9.5);
      UI.mono(ctx, String(e), xx - 1, y1 + 8, C.muted, 'left', 8);
    }
    UI.label(ctx, 'ν [Hz]', x1, y1 + 22, C.muted, 'right', 9.5);
    UI.label(ctx, 'νLν [W]', x0 + 8, y0 + 11, C.muted, 'left', 9.5);
    // bands
    const bands = [['IR', 13, 14.6], ['OPT', 14.6, 14.9], ['UV', 14.9, 15.5], ['EUV', 15.5, 16.4], ['X-ray', 16.4, 18.7]];
    for (const [t, a, b] of bands) {
      const xa = X(10 ** a), xb = X(10 ** b);
      ctx.fillStyle = C.line; ctx.fillRect(Math.round(xa), 28, 1, 6);
      UI.label(ctx, t, (xa + xb) / 2, 34, C.dim, 'center', 9);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    dashLine(ctx, S.nus.map((n, i) => [X(n), Y(n * S.newt[i])]), UI.rgba(C.text, 0.6), [4, 3], 1.1);
    line(ctx, S.nus.map((n, i) => [X(n), Y(vl[i])]), C.amber, 1.6);
    if (A.spotSpec) line(ctx, S.nus.map((n, i) => [X(n), Y(n * A.spotSpec[i])]), C.magenta, 1.1);
    ctx.restore();
    // peak marker
    const xp = X(S.nuPeak);
    ctx.fillStyle = UI.rgba(C.amber, 0.6); ctx.fillRect(Math.round(xp), y0, 1, y1 - y0);
    UI.mono(ctx, `ν_pk ${UI.sci(S.nuPeak, 2)} Hz`, x1 - 6, y0 + 12, C.amber, 'right', 9.5);
    ctx.fillStyle = C.amber; ctx.fillRect(Math.round(xp) - 2, y0, 5, 1);
    // legend (upper left, where the spectrum is low)
    const lx = x0 + 8;
    ctx.fillStyle = C.amber; ctx.fillRect(lx, y0 + 21, 12, 2); UI.label(ctx, 'relativistic', lx + 16, y0 + 25, C.text, 'left', 9.5);
    dashLine(ctx, [[lx, y0 + 35], [lx + 12, y0 + 35]], C.text, [3, 2]); UI.label(ctx, 'Newtonian g=1', lx + 16, y0 + 39, C.muted, 'left', 9.5);
    ctx.fillStyle = C.magenta; ctx.fillRect(lx, y0 + 49, 12, 2); UI.label(ctx, 'hot spot, live', lx + 16, y0 + 53, C.magenta, 'left', 9.5);
    // readouts
    let Ls = 0;
    if (A.spotSpec) for (let j = 1; j < S.nus.length; j++) Ls += 0.5 * (A.spotSpec[j] + A.spotSpec[j - 1]) * (S.nus[j] - S.nus[j - 1]);
    const ry = h - 10;
    kv(ctx, 'L', `${UI.sci(S.Lrel, 2)} W`, 8, ry, C.amber);
    kv(ctx, 'T_max', `${UI.sci(A.D.Tmax, 2)} K`, 110, ry, C.text);
    kv(ctx, 'spot', `${UI.sci(Ls, 1)} W`, 224, ry, C.magenta);
  }

  // ------------------------------------------------------------------ Fe line
  function drawLine(ctx, w, h) {
    UI.panel(ctx, w, h, 'Fe Kα line profile', `ε ∝ r^−${A.P.q.toFixed(1)} · weight g⁴`, { mark: C.orange });
    const S = A.spec;
    const x0 = 34, x1 = w - 10, y0 = 30, y1 = h - 42;
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (!S) return;
    const E0 = S.lineE0, E1 = S.lineE1, dE = (E1 - E0) / 100;
    const X = (E) => x0 + ((E - E0) / (E1 - E0)) * (x1 - x0), Y = (v) => y1 - v * 0.86 * (y1 - y0);
    for (let e = E0; e <= E1; e++) { const xx = Math.round(X(e)); ctx.fillStyle = C.grid; ctx.fillRect(xx, y0, 1, y1 - y0); UI.mono(ctx, String(e), xx, y1 + 11, C.muted, 'center', 9.5); }
    for (const v of [0.5, 1]) { const yy = Math.round(Y(v)); ctx.fillStyle = C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, v.toFixed(1), x0 - 4, yy + 3, C.muted, 'right', 9.5); }
    UI.label(ctx, 'E [keV]', x1, y1 + 22, C.muted, 'right', 9.5);
    // filled step profile
    const bw = (x1 - x0) / 100;
    for (let b = 0; b < 100; b++) {
      const v = S.line[b];
      const E = E0 + (b + 0.5) * dE;
      ctx.fillStyle = E < 6.4 ? UI.mix('#6E2A1C', C.orange, Math.min(1, v * 1.2)) : UI.mix('#2C3B6E', C.cyan, Math.min(1, v * 1.2));
      ctx.fillRect(x0 + b * bw, Y(v), bw + 0.4, y1 - Y(v));
    }
    ctx.strokeStyle = C.white; ctx.lineWidth = 1; ctx.beginPath();
    for (let b = 0; b < 100; b++) { const xa = x0 + b * bw, yy = Y(S.line[b]); b ? ctx.lineTo(xa, yy) : ctx.moveTo(xa, yy); ctx.lineTo(xa + bw, yy); }
    ctx.stroke();
    // rest energy
    const xr = X(6.4);
    dashLine(ctx, [[xr, y0], [xr, y1]], C.cyan, [3, 3], 1);
    UI.mono(ctx, '6.40 rest', xr - 4, y0 + 0.42 * (y1 - y0), C.cyan, 'right', 9.5);
    // blue peak and red wing
    let bp = 0;
    for (let b = 0; b < 100; b++) if (S.line[b] > S.line[bp]) bp = b;
    const Ebp = E0 + (bp + 0.5) * dE, Erw = S.redWing != null ? S.redWing : E0;
    const xb = X(Ebp);
    ctx.fillStyle = C.white; ctx.beginPath(); ctx.moveTo(xb, Y(S.line[bp]) - 3); ctx.lineTo(xb - 3.5, Y(S.line[bp]) - 9); ctx.lineTo(xb + 3.5, Y(S.line[bp]) - 9); ctx.fill();
    UI.mono(ctx, `blue horn ${Ebp.toFixed(2)} keV`, xb - 6, Y(S.line[bp]) - 4, C.white, 'right', 9.5);
    // red wing: where the full profile (0.5-9.5 keV) first reaches 5% of its peak; an arrow when below the window
    const below = Erw < E0, xw = below ? x0 + 1 : X(Erw);
    const rwl = below ? `◀ red wing ${Erw.toFixed(2)} keV (5% of peak)` : `red wing ${Erw.toFixed(2)} keV`, rww = UI.textW(ctx, rwl, F.mono(9.5));
    ctx.fillStyle = C.orange; ctx.fillRect(Math.round(xw), y1 - 32, 1, 32);
    ctx.fillStyle = 'rgba(11,10,16,0.8)'; ctx.fillRect(xw + 2, y1 - 30, rww + 6, 13);
    UI.mono(ctx, rwl, xw + 5, y1 - 20, C.orange, 'left', 9.5);
    // hot-spot line: E = 6.4 <g>_spot (live)
    const d = A.dyn;
    if (d && d.Is > 0) {
      const Es = 6.4 * d.gs, xs = X(Es);
      if (xs > x0 && xs < x1) {
        // the marker stays above the histogram (and above the red-wing label row), its label sits on a pill
        const bi = Math.max(0, Math.min(99, Math.floor((Es - E0) / dE)));
        let env = y1;
        for (let k = Math.max(0, bi - 1); k <= Math.min(99, bi + 1); k++) env = Math.min(env, Y(S.line[k]));
        const lineBot = Math.min(env - 3, y1 - 34), lineTop = y0 + 4;
        ctx.fillStyle = C.magenta; ctx.fillRect(Math.round(xs) - 1, lineTop, 2, Math.max(0, lineBot - lineTop));
        const sl = `spot ${Es.toFixed(2)}`;
        UI.setFont(ctx, F.mono(9.5), 'normal');
        const sw = ctx.measureText(sl).width;
        // candidate positions: right of the line, left of the line, at the line's top or just above the envelope
        const hornL = xb - 6 - UI.textW(ctx, `blue horn ${Ebp.toFixed(2)} keV`, F.mono(9.5)) - 2, hornR = xb + 6, hornY = Y(S.line[bp]) - 4;
        const cands = [];
        for (const yy of [lineTop + 10, Math.max(lineTop + 10, lineBot - 6), y0 + 0.62 * (y1 - y0), y0 + 0.78 * (y1 - y0)]) for (const side of [1, -1]) cands.push([side, yy]);
        let pick = null;
        for (const [side, yy] of cands) {
          const bx = side > 0 ? xs + 4 : xs - sw - 10;
          if (bx < x0 + 2 || bx + sw + 8 > x1 - 2) continue;
          const hitsHorn = bx < hornR && bx + sw + 8 > hornL && Math.abs(yy - hornY) < 14;
          const hitsRest = Math.abs(bx + (sw + 8) / 2 - X(6.4)) < (sw + 8) / 2 + 2 && Math.abs(yy - (y0 + 0.42 * (y1 - y0))) < 14;
          const hitsWing = Math.abs(yy - (y1 - 20)) < 14;
          if (!hitsHorn && !hitsRest && !hitsWing) { pick = [side, yy]; break; }
        }
        if (!pick) pick = [xs + sw + 12 > x1 ? -1 : 1, y0 + 0.62 * (y1 - y0)];
        const [side, sy] = pick, bx = side > 0 ? xs + 4 : xs - sw - 10;
        ctx.fillStyle = 'rgba(11,10,16,0.88)'; ctx.beginPath(); ctx.roundRect(bx, sy - 10, sw + 6, 13, 4); ctx.fill();
        ctx.strokeStyle = UI.rgba(C.magenta, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(bx + 0.5, sy - 9.5, sw + 5, 12, 4); ctx.stroke();
        UI.mono(ctx, sl, bx + 3, sy, C.magenta, 'left', 9.5);
      }
    }
    const ry = h - 10;
    kv(ctx, 'g range', `${S.gminWide.toFixed(2)}–${S.gmaxWide.toFixed(2)}`, 8, ry, C.cyan);
    kv(ctx, 'bins', `100 × ${(dE * 1000).toFixed(0)} eV`, 128, ry, C.text);
    kv(ctx, 'res.', '140 eV', 262, ry, C.muted);
  }

  // ------------------------------------------------------------------ uv coverage
  let uvLayer = null, visLayer = null;
  function drawUV(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'uv coverage · 230 GHz', 'EHT 2017 · Gλ', { mark: C.cyan });
    const X0 = w / 2, Y0 = 26 + 86, R = 84, RM = 9.5e9;
    const X = (u) => X0 - (u / RM) * R, Y = (v) => Y0 - (v / RM) * R; // u east to the left, as on the sky
    ctx.fillStyle = '#0B0A10'; ctx.fillRect(X0 - R, Y0 - R, 2 * R, 2 * R);
    for (const g of [-8, -4, 0, 4, 8]) { ctx.fillStyle = C.grid; ctx.fillRect(Math.round(X(g * 1e9)), Y0 - R, 1, 2 * R); ctx.fillRect(X0 - R, Math.round(Y(g * 1e9)), 2 * R, 1); }
    const fit = A.eht.fit;
    if (fit) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = UI.rgba(C.amber, 0.5); ctx.beginPath(); ctx.arc(X0, Y0, (fit.nullG / RM) * R, 0, 2 * Math.PI); ctx.stroke(); ctx.restore(); }
    const S = A.eht.samples;
    if (!uvLayer || uvLayer.n !== S.length) {
      const d = UI.dpr();
      if (!uvLayer) { uvLayer = document.createElement('canvas'); uvLayer.width = w * d; uvLayer.height = h * d; }
      const c2 = uvLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of S) {
        const age = A.simSec - s2.t; // older parts of the night fade
        c2.fillStyle = UI.rgba(BASE_COL[s2.k], 0.22 + 0.55 * Math.exp(-age / 14400));
        c2.fillRect(X(s2.u) - 0.7, Y(s2.v) - 0.7, 1.4, 1.4);
        c2.fillRect(X(-s2.u) - 0.7, Y(-s2.v) - 0.7, 1.4, 1.4);
      }
      uvLayer.n = S.length;
    }
    ctx.drawImage(uvLayer, 0, 0, w, h);
    // the newest samples: track segments drawn bright and a ring that decays over three epochs (15 sim-min)
    const tNow = A.simSec, life = 600; // the last 10 sim-min of every track, bright and thick
    const recent = {};
    for (let i = S.length - 1; i >= 0 && S[i].t > tNow - life - 300; i--) (recent[S[i].k] = recent[S[i].k] || []).push(S[i]);
    ctx.lineCap = 'round';
    for (const k in recent) {
      const pts = recent[k];
      for (let i = 0; i + 1 < pts.length; i++) {
        const age = tNow - pts[i].t, al = Math.max(0, 1 - age / life);
        if (al <= 0) continue;
        for (const sg of [1, -1]) {
          ctx.strokeStyle = UI.rgba(BASE_COL[k], 0.45 + 0.55 * al); ctx.lineWidth = 1.4 + 2.2 * al;
          ctx.beginPath(); ctx.moveTo(X(sg * pts[i].u), Y(sg * pts[i].v)); ctx.lineTo(X(sg * pts[i + 1].u), Y(sg * pts[i + 1].v)); ctx.stroke();
        }
      }
      const p0 = pts[0], age = tNow - p0.t;
      if (age < life) {
        const f = age / life;
        for (const sg of [1, -1]) {
          ctx.strokeStyle = UI.rgba(C.white, 0.95 * (1 - f)); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(X(sg * p0.u), Y(sg * p0.v), 2.5 + 12 * f, 0, 2 * Math.PI); ctx.stroke();
          dot(ctx, X(sg * p0.u), Y(sg * p0.v), 2.4 * (1 - f) + 1.2, UI.rgba(C.white, 0.9));
        }
      }
    }
    ctx.lineCap = 'butt';
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const p of A.eht.upNow) {
      const c = BASE_COL[p.k];
      for (const sg of [1, -1]) {
        ctx.strokeStyle = UI.rgba(C.white, 0.35 + 0.5 * pulse); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(sg * p.u), Y(sg * p.v), 3.2 + 2.2 * pulse, 0, 2 * Math.PI); ctx.stroke();
        dot(ctx, X(sg * p.u), Y(sg * p.v), 2.2, c);
      }
    }
    for (const g of [-8, -4, 0, 4, 8]) UI.mono(ctx, UI.neg(String(-g)), X(g * 1e9), Y0 + R + 11, C.muted, 'center', 9);
    UI.label(ctx, 'v', X0 - R + 4, Y0 - R + 11, C.muted, 'left', 9.5);
    UI.label(ctx, 'u', X0 + R - 4, Y0 + R - 4, C.muted, 'right', 9.5);
    const X2 = A.eht;
    const ry = h - 10;
    kv(ctx, 'up', `${X2.upNow.length}/28`, 8, ry, C.up);
    kv(ctx, 'vis', UI.int(X2.visCount), 66, ry, C.text);
    kv(ctx, 'cov', `${(100 * X2.cov).toFixed(0)}%`, 150, ry, C.cyan);
  }

  // ------------------------------------------------------------------ visibilities: |V| of every sample, and the
  // phase-centred real part whose bin means estimate the circularly averaged visibility (ring fit, first null)
  function drawVis(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'Visibilities', 'all samples · ring fit', { mark: C.cyan });
    const x0 = 34, x1 = w - 8, ya0 = 26, ya1 = 98, yb0 = 104, yb1 = 176;
    const X = (r) => x0 + (r / 10e9) * (x1 - x0);
    const lo = -1.3, hi = 0.04;
    const Ya = (v) => ya1 - ((lg(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * (ya1 - ya0);
    const rlo = -0.45, rhi = 1.05;
    const Yb = (v) => yb1 - ((Math.min(rhi, Math.max(rlo, v)) - rlo) / (rhi - rlo)) * (yb1 - yb0);
    for (const [y0, y1] of [[ya0, ya1], [yb0, yb1]]) { ctx.fillStyle = '#0B0A10'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    for (const v of [0.1, 0.3, 1]) { const yy = Math.round(Ya(v)); ctx.fillStyle = C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, String(v), x0 - 3, yy + 3, C.muted, 'right', 9); }
    for (const v of [0, 0.5, 1]) { const yy = Math.round(Yb(v)); ctx.fillStyle = v === 0 ? C.line : C.grid; ctx.fillRect(x0, yy, x1 - x0, 1); UI.mono(ctx, v.toFixed(1), x0 - 3, yy + 3, C.muted, 'right', 9); }
    for (let g = 0; g <= 10; g += 2) {
      const xx = Math.round(X(g * 1e9));
      ctx.fillStyle = C.grid; ctx.fillRect(xx, ya0, 1, ya1 - ya0); ctx.fillRect(xx, yb0, 1, yb1 - yb0);
      UI.mono(ctx, String(g), xx, yb1 + 10, C.muted, 'center', 9);
    }
    UI.label(ctx, 'ρ [Gλ]', x0 - 9, yb1 + 10, C.muted, 'right', 9);
    // every sampled visibility, faint per-baseline colour (cached, redrawn when samples arrive)
    const SM = A.eht.samples;
    if (!visLayer || visLayer.n !== SM.length) {
      const d = UI.dpr();
      if (!visLayer) { visLayer = document.createElement('canvas'); visLayer.width = w * d; visLayer.height = h * d; }
      const c2 = visLayer.getContext('2d');
      c2.setTransform(d, 0, 0, d, 0, 0); c2.clearRect(0, 0, w, h);
      for (const s2 of SM) {
        const xr = X(Math.hypot(s2.u, s2.v));
        if (xr > x1) continue;
        c2.fillStyle = UI.rgba(BASE_COL[s2.k], 0.55);
        c2.fillRect(xr - 0.8, Ya(s2.amp) - 0.8, 1.6, 1.6);
        c2.fillRect(xr - 0.8, Yb(s2.re) - 0.8, 1.6, 1.6);
      }
      visLayer.n = SM.length;
    }
    ctx.drawImage(visLayer, 0, 0, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x0, ya0, x1 - x0, yb1 - ya0); ctx.clip();
    // top: azimuthal mean of the sampled |V| per 0.4 G lambda bin, and the model's full-uv mean for comparison
    const pol = A.eht.polar;
    if (pol) dashLine(ctx, pol.rho.map((r, j) => [X(r), Ya(pol.inc[j])]), UI.rgba(C.text, 0.5), [3, 2], 1);
    const ab = A.eht.ampBins;
    if (ab && ab.length) {
      line(ctx, ab.map(([r, v]) => [X(r), Ya(v)]), C.white, 1.2);
      for (const [r, v] of ab) dot(ctx, X(r), Ya(v), 2, C.white);
    }
    // bottom: bin means of Re V and the fitted ring J0(pi d rho) exp(-(pi w rho)^2 / 4 ln 2)
    const fit = A.eht.fit;
    if (fit) {
      const UASr = Math.PI / 180 / 3600e6, k = Math.PI * fit.d * UASr, kw = Math.PI * fit.w * UASr;
      const pts = [];
      for (let i = 0; i <= 120; i++) { const r = (i / 120) * 10e9; pts.push([X(r), Yb(E.J0(k * r) * Math.exp(-((kw * r) ** 2) / (4 * Math.LN2)))]); }
      line(ctx, pts, C.amber, 1.5);
      for (const [r, v] of fit.bins) dot(ctx, X(r), Yb(v), 2.2, C.white);
    }
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const c of A.eht.cur) { if (!E.baselines[c.k] || E.baselines[c.k].len < 10000) continue; dot(ctx, X(Math.hypot(c.u, c.v)), Ya(c.amp), 1.6 + pulse, C.cyan); }
    ctx.restore();
    const tag = (t, x, y) => { const tw = UI.textW(ctx, t, F.label(9)); ctx.fillStyle = 'rgba(11,10,16,0.85)'; ctx.fillRect(x - 2, y - 9, tw + 4, 12); UI.label(ctx, t, x, y, C.muted, 'left', 9); };
    tag('|V|/V₀, all samples: no null for this crescent', x0 + 3, ya1 - 4);
    tag('Re V, phase-centred on the hole · ring fit', x0 + 3, yb1 - 4);
    if (fit) {
      const xn = X(fit.nullG);
      dashLine(ctx, [[xn, yb0], [xn, yb1]], C.amber, [3, 3], 1);
      ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(xn, Yb(0) + 1); ctx.lineTo(xn - 3, Yb(0) + 6); ctx.lineTo(xn + 3, Yb(0) + 6); ctx.fill();
    }
    // where a ring the size of the shadow (51 µas) would null, for comparison
    const dSh = A.crit ? A.crit.diamUas : A.D.critDiamM * A.D.uasPerM;
    const nSh = 0.7655 / (dSh * Math.PI / 180 / 3600e6), xsh = X(nSh);
    dashLine(ctx, [[xsh, yb0], [xsh, yb1]], UI.rgba(C.cyan, 0.85), [2, 3], 1);
    kv(ctx, 'ring fit d', fit ? `${fit.d.toFixed(1)} µas → null ${(fit.nullG / 1e9).toFixed(2)} Gλ` : '…', 8, h - 31, C.amber);
    UI.mono(ctx, `a ${dSh.toFixed(0)} µas ring would null at ${(nSh / 1e9).toFixed(2)} Gλ`, 8, h - 19, C.cyan, 'left', 9.5);
    UI.label(ctx, 'crescent: the light comes from inside the critical curve', 8, h - 7, C.muted, 'left', 9);
  }

  // ------------------------------------------------------------------ dirty image
  let dirtyData = null, diffCv = null;
  let dirtyCv = null, dirtyPrev = null, trueCv = null, beamCv = null, dirtyStamp = -1, trueStamp = -1, fadeAt = -1e9, contourSeg = [];
  function imgToCanvas(cv, data, N, norm, mode) {
    if (!cv) { cv = document.createElement('canvas'); cv.width = N; cv.height = N; }
    const ctx = cv.getContext('2d'), im = ctx.createImageData(N, N);
    let mx = 0, mn = 0;
    for (const v of data) { mx = Math.max(mx, v); mn = Math.min(mn, v); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = data[y * N + x], o = ((N - 1 - y) * N + x) * 4; // row 0 is the bottom (beta min)
      let c;
      if (mode === 'beam') { const t = v / (mx || 1); c = t >= 0 ? [89 * t + 15 * (1 - t), 216 * t + 12 * (1 - t), 255 * t + 20 * (1 - t)] : [80 * -t, 20 * -t, 50 * -t]; }
      else if (mode === 'dirty' && v < 0) { const t = Math.min(1, -v / (mx || 1)); c = [10 + 20 * t, 14 + 40 * t, 28 + 70 * t]; }
      else { const t = Math.max(0, v / (mx || 1)); c = GLX.inferno(Math.pow(t, mode === 'true' ? 0.75 : 0.9)); }
      im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
    return cv;
  }
  // marching squares: segments of the contour img = level, in pixel coordinates (x right, y up)
  function contour(img, N, level) {
    const seg = [];
    const lerp = (a, b) => (level - a) / (b - a);
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const a = img[y * N + x], b = img[y * N + x + 1], c = img[(y + 1) * N + x + 1], d = img[(y + 1) * N + x];
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const e = { B: [x + lerp(a, b), y], R: [x + 1, y + lerp(b, c)], T: [x + lerp(d, c), y + 1], L: [x, y + lerp(a, d)] };
      const T = { 1: 'LB', 2: 'BR', 3: 'LR', 4: 'RT', 5: 'LBRT', 6: 'BT', 7: 'LT', 8: 'LT', 9: 'BT', 10: 'LTBR', 11: 'RT', 12: 'LR', 13: 'BR', 14: 'LB' }[idx];
      for (let i = 0; i < T.length; i += 2) seg.push([...e[T[i]], ...e[T[i + 1]]]);
    }
    return seg;
  }
  function drawDirty(ctx, w, h, now) {
    UI.panel(ctx, w, h, 'Dirty image', 'uniform weights', { mark: C.amber });
    const X = A.eht, N = A.EN;
    if (X.dirty && dirtyStamp !== X.dirtyAt) {
      if (dirtyCv) { dirtyPrev = dirtyPrev || document.createElement('canvas'); dirtyPrev.width = N; dirtyPrev.height = N; dirtyPrev.getContext('2d').drawImage(dirtyCv, 0, 0); }
      // what the newest visibilities changed: (new - old) / max, cyan where they add flux, magenta where they remove it
      if (dirtyData) {
        let mx = 0; for (const v of X.dirty) mx = Math.max(mx, Math.abs(v));
        diffCv = diffCv || document.createElement('canvas'); diffCv.width = N; diffCv.height = N;
        const dc = diffCv.getContext('2d'), im = dc.createImageData(N, N);
        let dmx = 0; for (let i = 0; i < N * N; i++) dmx = Math.max(dmx, Math.abs(X.dirty[i] - dirtyData[i]));
        const sc = 1 / Math.max(dmx, 0.02 * mx);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const dv = (X.dirty[y * N + x] - dirtyData[y * N + x]) * sc, o = ((N - 1 - y) * N + x) * 4;
          const c = dv >= 0 ? [89, 216, 255] : [209, 53, 122];
          im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = Math.min(255, Math.abs(dv) * 255);
        }
        dc.putImageData(im, 0, 0);
      }
      dirtyData = Float64Array.from(X.dirty);
      dirtyCv = imgToCanvas(null, X.dirty, N, 1, 'dirty'); beamCv = imgToCanvas(beamCv, X.beam, N, 1, 'beam');
      dirtyStamp = X.dirtyAt; fadeAt = now;
    }
    if (X.imgBlur && trueStamp !== X.img) {
      trueCv = imgToCanvas(trueCv, X.imgBlur, N, 1, 'true'); trueStamp = X.img;
      let mx = 0; for (const v of X.imgBlur) mx = Math.max(mx, v);
      contourSeg = contour(X.imgBlur, N, 0.5 * mx);
    }
    const ix = 8, iy = 28, isz = 140;
    ctx.fillStyle = '#000'; ctx.fillRect(ix, iy, isz, isz);
    ctx.imageSmoothingEnabled = true;
    const f = Math.min(1, (now - fadeAt) / 900);
    if (dirtyPrev && f < 1) ctx.drawImage(dirtyPrev, ix, iy, isz, isz);
    if (dirtyCv) { ctx.globalAlpha = dirtyPrev ? f : 1; ctx.drawImage(dirtyCv, ix, iy, isz, isz); ctx.globalAlpha = 1; }
    const fd = Math.min(1, (now - fadeAt) / 1800);
    if (diffCv && fd < 1) { ctx.globalAlpha = 0.85 * (1 - fd); ctx.drawImage(diffCv, ix, iy, isz, isz); ctx.globalAlpha = 1; }
    frame(ctx, ix - 1, iy - 1, isz + 2, isz + 2, f < 1 ? UI.mix(C.amber, C.line, f) : C.line);
    // half-maximum contour of the model blurred to the beam: what the array should recover
    const px = (xx) => ix + ((xx + 0.5) / N) * isz, py = (yy) => iy + ((N - 1 - yy + 0.5) / N) * isz;
    ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, isz, isz); ctx.clip();
    ctx.strokeStyle = UI.rgba(C.cyan, 0.9); ctx.lineWidth = 1.2; ctx.beginPath();
    for (const [a1, b1, a2, b2] of contourSeg) { ctx.moveTo(px(a1), py(b1)); ctx.lineTo(px(a2), py(b2)); }
    ctx.stroke();
    ctx.restore();
    if (fd < 1) {
      const t = `+${X.lastAdded || 0} vis · Δ image`, tw = UI.textW(ctx, t, F.mono(9.5));
      ctx.fillStyle = `rgba(7,6,10,${0.8 * (1 - fd)})`; ctx.fillRect(ix + isz - tw - 8, iy + 3, tw + 6, 13);
      UI.mono(ctx, t, ix + isz - 4, iy + 13, UI.rgba(C.cyan, 1 - 0.8 * fd), 'right', 9.5);
    }
    // 50 µas bar and beam ellipse
    const pxu = isz / (2 * A.EH);
    ctx.fillStyle = C.white; ctx.fillRect(ix + 6, iy + isz - 8, 50 * pxu, 1.5);
    UI.mono(ctx, '50 µas', ix + 6, iy + isz - 12, C.white, 'left', 9);
    if (X.beamFit) {
      const bf = X.beamFit;
      ctx.strokeStyle = C.white; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(ix + isz - 16, iy + isz - 16, (bf.maj / 2) * pxu, (bf.min / 2) * pxu, (-(90 - bf.pa) * Math.PI) / 180, 0, 2 * Math.PI); ctx.stroke();
    }
    // insets: model image at EHT resolution, dirty beam
    const sx = ix + isz + 6, ssz = w - sx - 8;
    UI.label(ctx, 'model ⊛', sx, iy + 8, C.muted, 'left', 9);
    if (trueCv) ctx.drawImage(trueCv, sx, iy + 12, ssz, ssz);
    frame(ctx, sx - 1, iy + 11, ssz + 2, ssz + 2, C.line);
    UI.label(ctx, 'beam', sx, iy + 30 + ssz, C.muted, 'left', 9);
    if (beamCv) ctx.drawImage(beamCv, sx, iy + 34 + ssz, ssz, ssz);
    frame(ctx, sx - 1, iy + 33 + ssz, ssz + 2, ssz + 2, C.line);
    UI.mono(ctx, `g³r^−${A.Q_MM}`, sx, iy + 50 + 2 * ssz, C.muted, 'left', 9);
    let ry = iy + isz + 17;
    kv(ctx, 'N vis', UI.int((X.dirtyK || 0) * 2), 8, ry, C.text);
    kv(ctx, 'imaged', `UT ${UI.hhmm(A.utOf(X.dirtyAt || 0)).slice(0, 5)} ×${X.dirtyCount || 0}`, 92, ry, C.muted);
    ry += 14;
    kv(ctx, 'beam', X.beamFit ? `${X.beamFit.maj.toFixed(1)} × ${X.beamFit.min.toFixed(1)} µas` : '…', 8, ry, C.cyan);
    ry += 14;
    kv(ctx, 'PA', X.beamFit ? `${X.beamFit.pa.toFixed(0)}°` : '…', 8, ry, C.text);
    ctx.fillStyle = C.cyan; ctx.fillRect(66, ry - 4, 10, 1.5);
    UI.label(ctx, 'model⊛beam, half max', 80, ry, C.cyan, 'left', 9.5);
  }

  // ------------------------------------------------------------------ init + scheduler
  P_.init = () => {
    A = window.APP;
    baseColors();
    add('top', 8, 8, 1904, 32, 3, 0, drawTop);
    add('controls', 8, 48, 336, 404, 10, 1, drawControls);
    add('integrator', 8, 460, 336, 300, 4, 1, drawIntegrator);
    add('system', 8, 768, 336, 304, 8, 3, drawSystem);
    add('hero', 352, 48, 880, 720, 2, 1, drawHero);
    add('maps', 352, 776, 880, 296, 6, 2, drawMaps);
    add('geo', 1240, 48, 416, 300, 2, 0, drawGeo);
    add('sweep', 1664, 48, 248, 300, 10, 5, drawSweep);
    add('lc', 1240, 356, 416, 232, 4, 2, drawLC);
    add('centroid', 1664, 356, 248, 232, 4, 3, drawCentroid);
    add('spectrum', 1240, 596, 332, 228, 8, 6, drawSpectrum);
    add('line', 1580, 596, 332, 228, 8, 2, drawLine);
    add('uv', 1240, 832, 216, 240, 3, 1, drawUV);
    add('vis', 1464, 832, 232, 240, 4, 3, drawVis);
    add('dirty', 1704, 832, 208, 240, 3, 2, drawDirty);
    for (const p of panels) p.drawn = false;
    // expensive first draws happen here, before the first animation frame
    sweepCurves = sweepAna();
    geoStatic = geoStaticRender(); geoKey = A.geo;
    P_.draw(0, performance.now());
  };
  const RealDate = Object.getPrototypeOf(Date).now ? Object.getPrototypeOf(Date) : Date;
  const rnow = () => (STUDIO.mode === 'render' ? RealDate.now() : performance.now());
  P_.cost = {};
  P_.draw = (F, now) => {
    for (const p of panels) {
      if (p.drawn && (F + p.offset) % p.every !== 0) continue;
      const t0 = rnow();
      try { p.draw(p.cv.ctx, p.cv.w, p.cv.h, now); } catch (e) { console.error(p.name + ': ' + (e && e.stack ? e.stack : e)); }
      const c = P_.cost[p.name] || (P_.cost[p.name] = { n: 0, ms: 0 });
      c.n++; c.ms += rnow() - t0;
      p.drawn = true;
    }
  };
  window.PANELS = P_;
})();

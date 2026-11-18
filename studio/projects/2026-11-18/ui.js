// Reentry: every panel of the EP workstation, drawn with canvas 2D from the live state in APP.
(function () {
  const RE = window.RE, STUDIO = window.STUDIO;
  const C = {
    bg: '#F4F1EC', surface: '#FFFFFF', line: '#DDD5CB', text: '#1C1F26', muted: '#7A7F8A', faint: '#EEE8E0',
    crimson: '#C8102E', blue: '#2F6FB0', teal: '#0E8C7A', amber: '#E8A33D', purple: '#6B4FA3', pink: '#F3C9C9',
    rose: '#E79A9A', navy: '#24324F', up: '#1E8E5A', down: '#C62828', warn: '#E08A00', active: '#2563EB',
  };
  const FT = '"Segoe UI Variable Text","Segoe UI Variable","Segoe UI",sans-serif';
  const FM = '"Cascadia Mono","Cascadia Code",Consolas,monospace';
  const FB = '"Bahnschrift SemiCondensed","Bahnschrift",sans-serif';
  RE.C = C;

  // fast fixed-point formatting with thousands separators (toLocaleString is far too slow per frame)
  // a complex without an isoelectric segment has no measurable end: shown as '>200' (warn), never as a number tied to RR
  const qrsTxt = (b) => (b.qrsLB ? '>200' : nf(b.qrs));
  const sgnAx = (a) => (a === null || a === undefined || !isFinite(a) ? '--' : `${a >= 0 ? '+' : '−'}${Math.abs(Math.round(a))}`);
  const circMean = (angles) => {
    let sx = 0, sy = 0;
    for (const a of angles) { sx += Math.cos((a * Math.PI) / 180); sy += Math.sin((a * Math.PI) / 180); }
    return angles.length ? (Math.atan2(sy, sx) * 180) / Math.PI : null;
  };
  const sgn2 = (v) => (Math.abs(v) < 0.005 ? '±0.00' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);
  const nf = (x, d = 0) => {
    if (x === null || x === undefined || !isFinite(x)) return '--';
    const s = Math.abs(x).toFixed(d);
    const dot = s.indexOf('.');
    let ip = dot < 0 ? s : s.slice(0, dot);
    const fp = dot < 0 ? '' : s.slice(dot);
    if (ip.length > 3) {
      let o = '';
      while (ip.length > 3) {
        o = ',' + ip.slice(-3) + o;
        ip = ip.slice(0, -3);
      }
      ip = ip + o;
    }
    return (x < 0 && Number(s) !== 0 ? '-' : '') + ip + fp;
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixHex = (a, b, t) => {
    const x = hexRgb(a), y = hexRgb(b);
    return `rgb(${Math.round(lerp(x[0], y[0], t))},${Math.round(lerp(x[1], y[1], t))},${Math.round(lerp(x[2], y[2], t))})`;
  };
  const alpha = (h, a) => {
    const x = hexRgb(h);
    return `rgba(${x[0]},${x[1]},${x[2]},${a})`;
  };
  // meaning colours
  const colHR = (hr) => (hr === null || hr === undefined ? C.muted : hr > 150 ? C.down : hr > 100 ? C.warn : hr >= 60 ? C.up : C.warn);
  const colQRS = (q) => (q === null || q === undefined ? C.muted : q > 120 ? C.warn : C.text);
  const colQTc = (q) => (q === null || q === undefined ? C.muted : q > 470 ? C.warn : C.text);
  const colPR = (q) => (q === null || q === undefined ? C.muted : q > 200 ? C.warn : C.text);
  const rhythmCol = (r) => ({ SINUS: C.up, VT: C.down, SHOCK: C.active, 'POST-SHOCK': C.warn, PVC: C.warn, WIDE: C.warn, OTHER: C.muted, S2: C.active }[r] || C.muted);

  // Vm colour map (the same stops as the GPU shader)
  const VM_STOPS = [[0, [112, 126, 146]], [0.12, [83, 136, 152]], [0.32, [14, 140, 122]], [0.58, [232, 163, 61]], [0.8, [222, 92, 46]], [1, [200, 16, 46]]];
  const vmRGB = (u) => {
    u = clamp(u, 0, 1);
    for (let i = 1; i < VM_STOPS.length; i++) {
      if (u <= VM_STOPS[i][0]) {
        const [a, ca] = VM_STOPS[i - 1], [b, cb] = VM_STOPS[i];
        const t = (u - a) / (b - a);
        return `rgb(${Math.round(lerp(ca[0], cb[0], t))},${Math.round(lerp(ca[1], cb[1], t))},${Math.round(lerp(ca[2], cb[2], t))})`;
      }
    }
    return 'rgb(200,16,46)';
  };

  const RealClock = typeof Object.getPrototypeOf(Date).now === 'function' ? Object.getPrototypeOf(Date) : Date;
  const jsNow = () => (STUDIO.mode === 'render' ? RealClock.now() : performance.now());
  RE.UI = function (APP) {
    const DPR = APP.DPR, L = APP.L, H = APP.H, A = APP.A, E = APP.E;
    const N = RE.N;
    const P = {};
    for (const id of Object.keys(L)) {
      const c = document.getElementById(id);
      const r = L[id];
      c.style.left = r.x + 'px';
      c.style.top = r.y + 'px';
      c.style.width = r.w + 'px';
      c.style.height = r.h + 'px';
      c.width = Math.round(r.w * DPR);
      c.height = Math.round(r.h * DPR);
      const g = c.getContext('2d');
      P[id] = { c, g, r, w: r.w, h: r.h };
    }
    // background: page colour + cards for the panels that sit on top of the WebGL canvas are drawn by those panels
    {
      const c = document.getElementById('bg');
      c.style.left = '0px';
      c.style.top = '0px';
      c.style.width = '1920px';
      c.style.height = '1080px';
      c.width = Math.round(1920 * DPR);
      c.height = Math.round(1080 * DPR);
      const g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.fillStyle = C.bg;
      g.fillRect(0, 0, 1920, 1080);
    }
    const begin = (p) => {
      const g = p.g;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, p.w, p.h);
      g.letterSpacing = '0px';
      return g;
    };
    const rr = (g, x, y, w, h, r) => {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
    };
    function card(g, w, h, title, sub, right) {
      g.fillStyle = C.surface;
      rr(g, 0.5, 0.5, w - 1, h - 1, 4);
      g.fill();
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = C.crimson;
      g.fillRect(9, 9, 3, 9);
      g.font = `600 11px ${FT}`;
      g.letterSpacing = '0.9px';
      g.fillStyle = C.text;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.fillText(title, 17, 17.5);
      const tw = g.measureText(title).width;
      g.letterSpacing = '0px';
      if (sub) {
        g.font = `400 10.5px ${FT}`;
        g.fillStyle = C.muted;
        g.fillText(sub, 17 + tw + 10, 17.5);
      }
      if (right) {
        g.font = `9.5px ${FM}`;
        g.fillStyle = C.muted;
        g.textAlign = 'right';
        g.fillText(right, w - 10, 17.5);
        g.textAlign = 'left';
      }
      g.fillStyle = C.faint;
      g.fillRect(8, 24, w - 16, 1);
    }
    const txt = (g, s, x, y, font, color, align) => {
      g.font = font;
      g.fillStyle = color;
      g.textAlign = align || 'left';
      g.fillText(s, x, y);
      g.textAlign = 'left';
    };
    const simToPage = (t) => (t - APP.PREWARM_MS) / (60 * APP.NSUB * APP.S.dtms);

    // ======================= HEADER =======================
    let beatPulse = 0, lastBeatN = 0;
    function drawHeader(now) {
      const p = P.header, g = begin(p);
      g.fillStyle = C.surface;
      rr(g, 0.5, 0.5, p.w - 1, p.h - 1, 4);
      g.fill();
      g.strokeStyle = C.line;
      g.stroke();
      g.textBaseline = 'middle';
      const cy = 18.5;
      g.fillStyle = C.crimson;
      g.fillRect(10, 9, 4, 19);
      g.font = `600 21px ${FB}`;
      g.letterSpacing = '2.5px';
      g.fillStyle = C.text;
      g.fillText('REENTRY', 22, cy + 1);
      let x = 22 + g.measureText('REENTRY').width + 10;
      g.letterSpacing = '0px';
      txt(g, 'post-infarct ventricle', x, cy, `500 12px ${FT}`, C.text);
      x += g.measureText('post-infarct ventricle').width + 8;
      txt(g, '·  Aliev–Panfilov monodomain  ·  512²  ·  WebGL2', x, cy, `400 12px ${FT}`, C.muted);
      x += g.measureText('·  Aliev–Panfilov monodomain  ·  512²  ·  WebGL2').width + 22;
      // clock and playback
      const block = (label, value, vx, font, col) => {
        txt(g, label, vx, 11, `600 8px ${FT}`, C.muted);
        txt(g, value, vx, 25, font || `12px ${FM}`, col || C.text);
      };
      g.letterSpacing = '0.6px';
      block('SIM CLOCK', '', x);
      g.letterSpacing = '0px';
      txt(g, `${nf(H.t, 1)} ms`, x, 25, `12px ${FM}`, C.text);
      x += 118;
      g.letterSpacing = '0.6px';
      block('PLAYBACK', '', x);
      g.letterSpacing = '0px';
      const pb = (APP.NSUB * APP.S.dtms * 60) / 1000;
      txt(g, `${pb.toFixed(2)}×`, x, 25, `12px ${FM}`, C.text);
      x += 62;
      // rhythm badge
      const rh = APP.rhythm;
      const bc = rhythmCol(rh);
      if (APP.table.length !== lastBeatN) {
        lastBeatN = APP.table.length;
        beatPulse = now;
      }
      g.fillStyle = bc;
      rr(g, x, 6, 128, 24, 12);
      g.fill();
      const pulse = Math.max(0, 1 - (now - beatPulse) / 350);
      g.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * pulse})`;
      g.beginPath();
      g.arc(x + 14, 18, 3.5 + 1.5 * pulse, 0, Math.PI * 2);
      g.fill();
      g.font = `600 15px ${FB}`;
      g.letterSpacing = '1.6px';
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.fillText(rh, x + 70, 19);
      g.textAlign = 'left';
      g.letterSpacing = '0px';
      x += 146;
      // vitals
      const b = recentBeat();
      const ps = APP.ps;
      const cups = APP.stats.cups || 0;
      const vit = [
        ['HR', b ? nf(b.hrMed ?? b.hr) : '--', b ? colHR(b.hrMed ?? b.hr) : C.muted, 'bpm'],
        ['RR', b && b.rr ? nf(b.rr) : '--', C.text, 'ms'],
        ['PR', b && b.pr ? nf(b.pr) : '--', b ? colPR(b.pr) : C.muted, 'ms'],
        ['QRS', b ? qrsTxt(b) : '--', b ? colQRS(b.qrs) : C.muted, 'ms'],
        ['QTc', b && b.qtc ? nf(b.qtc) : '--', b ? colQTc(b.qtc) : C.muted, 'ms'],
        ['AXIS', b ? sgnAx(b.axis) + '°' : '--', C.text, ''],
        ['PS', String(ps.count), ps.count > 0 ? C.down : C.up, `${ps.free} free · ${ps.anchored} anch`],
        ['TAT', APP.tatLast ? nf(APP.tatLast) : '--', C.text, 'ms'],
        ['SUBSTEPS', String(APP.NSUB), C.text, `/frame · ${APP.S.draws || 15} draws`],
        ['CELL UPD/S', APP.stats.cupsGpu ? (APP.stats.cupsGpu / 1e6).toFixed(1) + ' M' : (cups / 1e6).toFixed(1) + ' M', C.active, APP.stats.cupsGpu ? 'GPU-timed' : 'delivered'],
      ];
      const ws = [74, 70, 66, 70, 70, 70, 112, 66, 118, 108];
      let vx = p.w - ws.reduce((s, w) => s + w, 0) - 8;
      // protocol phase and a mini lead II trace in the space between the badge and the vitals
      {
        const pr = APP.proto;
        const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
        let ph;
        if (!pr.s2) ph = `S2 in ${sec(APP.T2 - H.t)} · shock in ${sec(APP.TSH - H.t)}`;
        else if (!pr.shocks.length) ph = `S2 +${sec(H.t - pr.s2.t)} · shock in ${sec(APP.TSH - H.t)}`;
        else if (pr.sinusBack === null || pr.sinusBack === undefined) ph = `shock +${sec(H.t - pr.shocks[0].t0)} · awaiting sinus`;
        else ph = `sinus back +${nf(pr.sinusBack)} ms after shock`;
        g.letterSpacing = '0.7px';
        txt(g, 'PROTOCOL · SIM', x, 11, `600 8px ${FT}`, C.muted);
        g.letterSpacing = '0px';
        txt(g, ph, x, 25, `10px ${FM}`, pr.s2 && !pr.shocks.length ? C.down : C.text);
        g.font = `10px ${FM}`;
        const mx0 = Math.max(x + g.measureText(ph).width + 12, x + 178), mx1 = vx - 14;
        if (mx1 - mx0 > 40 && E.n > 10) {
          g.fillStyle = '#FDF1F1';
          g.fillRect(mx0, 6, mx1 - mx0, 25);
          g.strokeStyle = 'rgba(200,16,46,0.25)';
          g.lineWidth = 0.6;
          g.beginPath();
          for (let gx = mx0; gx <= mx1; gx += 7) { g.moveTo(gx + 0.25, 6); g.lineTo(gx + 0.25, 31); }
          for (let gy = 6; gy <= 31; gy += 7) { g.moveTo(mx0, gy + 0.25); g.lineTo(mx1, gy + 0.25); }
          g.stroke();
          const span = 3000, tN = E.t[E.idx(E.n - 1)];
          g.save();
          g.beginPath();
          g.rect(mx0, 6, mx1 - mx0, 25);
          g.clip();
          g.strokeStyle = '#141414';
          g.lineWidth = 1;
          g.beginPath();
          let st = false;
          for (let k = Math.max(1, E.n - Math.ceil(span / E.dt)); k < E.n; k += 2) {
            const t = E.t[E.idx(k)];
            const xx = mx1 - ((tN - t) / span) * (mx1 - mx0), yy = 22 - E.at(1, k) * 9;
            st ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
            st = true;
          }
          g.stroke();
          g.restore();
          txt(g, 'II', mx0 + 3, 14, `600 8px ${FT}`, '#3A2A2E');
        }
      }
      vit.forEach(([lab, val, col, unit], i) => {
        g.fillStyle = C.faint;
        g.fillRect(vx - 7, 7, 1, 22);
        g.letterSpacing = '0.7px';
        txt(g, lab, vx, 11, `600 8px ${FT}`, C.muted);
        g.letterSpacing = '0px';
        g.font = `600 19px ${FB}`;
        g.fillStyle = col;
        g.fillText(val, vx, 25);
        const vw = g.measureText(val).width;
        if (unit) txt(g, unit, vx + vw + 4, 26.5, `9px ${FM}`, C.muted);
        vx += ws[i];
      });
      g.textBaseline = 'alphabetic';
    }
    function recentBeat() {
      const b = APP.lastBeat;
      if (!b) return null;
      if (H.t - b.t > 2600) return null;
      return b;
    }

    // ======================= CONTROLS =======================
    function drawControls(now) {
      const p = P.controls, g = begin(p);
      card(g, p.w, p.h, 'PARAMETERS', null, 'monodomain · explicit Euler');
      let y = 40;
      const group = (name, note) => {
        g.letterSpacing = '0.9px';
        txt(g, name, 12, y, `600 8.5px ${FT}`, C.navy);
        const w = g.measureText(name).width;
        g.letterSpacing = '0px';
        if (note) txt(g, note, 12 + w + 8, y, `8.5px ${FM}`, C.muted);
        g.fillStyle = C.faint;
        g.fillRect(12 + w + 8 + (note ? g.measureText(note).width + 8 : 0), y - 3, p.w - 24 - w - 8 - (note ? g.measureText(note).width + 8 : 0), 1);
        y += 13;
      };
      const slider = (label, val, min, max, fmtv, col, sub) => {
        txt(g, label, 12, y + 3.5, `500 10px ${FT}`, C.text);
        const x0 = 122, x1 = 236, f = clamp((val - min) / (max - min), 0, 1);
        g.fillStyle = C.faint;
        rr(g, x0, y, x1 - x0, 3, 1.5);
        g.fill();
        g.fillStyle = col || C.navy;
        rr(g, x0, y, (x1 - x0) * f, 3, 1.5);
        g.fill();
        g.fillStyle = C.surface;
        g.strokeStyle = col || C.navy;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x0 + (x1 - x0) * f, y + 1.5, 4, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        txt(g, fmtv, p.w - 12, y + 4, `10px ${FM}`, C.text, 'right');
        if (sub) txt(g, sub, 12, y + 14, `7.5px ${FM}`, C.active);
        y += sub ? 25 : 16;
      };
      const field = (label, val, note, col) => {
        txt(g, label, 12, y + 3.5, `500 10px ${FT}`, C.text);
        g.strokeStyle = C.line;
        g.lineWidth = 1;
        rr(g, 122.5, y - 5.5, 60, 14, 2);
        g.stroke();
        txt(g, val, 128, y + 4, `10px ${FM}`, C.text);
        txt(g, note, p.w - 12, y + 4, `8.5px ${FM}`, col || C.muted, 'right');
        y += 17;
      };
      const S = APP.S, Pm = S.p, An = H.P;
      group('MODEL', 'k·u(u−a)(u−1)');
      slider('k  excitability', Pm.k, 4, 12, Pm.k.toFixed(1));
      slider('a  threshold', Pm.a, 0.05, 0.3, Pm.a.toFixed(2));
      slider('ε0  recovery rate', Pm.eps0, 0.0005, 0.01, Pm.eps0.toFixed(4));
      slider('μ1', Pm.mu1, 0.05, 0.4, Pm.mu1.toFixed(2));
      slider('μ2', Pm.mu2, 0.1, 0.6, Pm.mu2.toFixed(2));
      field('dt', Pm.dt.toFixed(3), `≤ ${(Pm.dx * Pm.dx / 4).toFixed(4)} stable`, C.up);
      field('dx', Pm.dx.toFixed(2), `${(S.dtms).toFixed(3)} ms / step`);
      y += 2;
      group('TISSUE', 'D(x), harmonic faces');
      slider('D myocardium', An.D.myo, 0.2, 1, An.D.myo.toFixed(2));
      slider('D border zone', An.D.bz, 0.05, 1, An.D.bz.toFixed(2), C.purple);
      slider('D AV node', An.D.avn, 0.02, 0.5, An.D.avn.toFixed(2), C.amber);
      slider('epicardial h', An.hEpi, 1, 2, An.hEpi.toFixed(2));
      y += 2;
      group('CONDUCTION', `${H.sys.segments} segments · ${H.sys.pmj} PMJ`);
      // knob: sinus rate
      const knob = (cx, cy, label, val, min, max, vtxt, col, live) => {
        const f = clamp((val - min) / (max - min), 0, 1);
        const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
        g.lineWidth = 3;
        g.strokeStyle = C.faint;
        g.beginPath();
        g.arc(cx, cy, 11, a0, a1);
        g.stroke();
        g.strokeStyle = col;
        g.beginPath();
        g.arc(cx, cy, 11, a0, a0 + (a1 - a0) * f);
        g.stroke();
        g.lineWidth = 1.4;
        g.strokeStyle = C.text;
        const aa = a0 + (a1 - a0) * f;
        g.beginPath();
        g.moveTo(cx + Math.cos(aa) * 4, cy + Math.sin(aa) * 4);
        g.lineTo(cx + Math.cos(aa) * 9, cy + Math.sin(aa) * 9);
        g.stroke();
        if (live > 0) {
          g.fillStyle = alpha(col, live);
          g.beginPath();
          g.arc(cx, cy, 3, 0, Math.PI * 2);
          g.fill();
        }
        txt(g, label, cx + 18, cy - 2, `500 10px ${FT}`, C.text);
        txt(g, vtxt, cx + 18, cy + 10, `10px ${FM}`, C.text);
      };
      const saAge = H.t - (H.saTimes[H.saTimes.length - 1] || -1e9);
      knob(26, y + 10, 'Sinus rate', H.o.hr, 40, 180, `${H.o.hr} bpm · SA r 3`, C.up, Math.max(0, 1 - saAge / 150));
      knob(166, y + 10, 'Purkinje CV', H.sys.opt.cvP, 2, 20, `${H.sys.opt.cvP} cells/ms`, C.navy, 0);
      y += 30;
      slider('atrial tract CV', H.sys.opt.cvA, 2, 20, `${H.sys.opt.cvA} cells/ms`, C.teal);
      y += 2;
      group('PROTOCOL', 'programmed stimulation');
      const pr = APP.proto;
      const s2txt = pr.s2 ? `S2 delivered · measured CI ${nf(pr.s2.ci)} ms` : `S2 in ${Math.max(0, (APP.T2 - H.t) / 1000).toFixed(1)} s sim`;
      slider('S2 coupling', APP.CI, 200, 500, `${APP.CI} ms`, C.active, s2txt);
      // select
      txt(g, 'S2 site', 12, y + 3.5, `500 10px ${FT}`, C.text);
      g.strokeStyle = C.line;
      rr(g, 122.5, y - 5.5, p.w - 134, 14, 2);
      g.stroke();
      txt(g, 'Border zone (LV lateral)', 128, y + 4, `9.5px ${FM}`, C.text);
      g.fillStyle = C.muted;
      g.beginPath();
      g.moveTo(p.w - 20, y - 1);
      g.lineTo(p.w - 14, y - 1);
      g.lineTo(p.w - 17, y + 3);
      g.fill();
      y += 18;
      const shk = pr.shocks.length ? pr.shocks[0] : null;
      const shTxt = shk ? `delivered ${nf((H.t - shk.t0) / 1000, 1)} s ago` : `armed, in ${Math.max(0, (APP.TSH - H.t) / 1000).toFixed(1)} s`;
      const shLive = shk ? Math.max(0, 1 - (H.t - shk.t0) / 300) : 0;
      knob(26, y + 10, 'Shock strength', APP.SHOCK, 0, 6, `${APP.SHOCK.toFixed(1)} · ${shTxt}`, C.crimson, shLive);
      y += 30;
      slider('Shock duration', APP.SHOCK_DUR, 2, 30, `${APP.SHOCK_DUR.toFixed(1)} ms`, C.crimson);
      y += 2;
      group('DISPLAY');
      slider('Playback', (APP.NSUB * APP.S.dtms * 60) / 1000, 0.1, 1, `${((APP.NSUB * APP.S.dtms * 60) / 1000).toFixed(2)}×`, C.navy);
      const tog = (x, label, on) => {
        g.fillStyle = on ? C.navy : C.faint;
        rr(g, x, y - 4, 20, 10, 5);
        g.fill();
        g.fillStyle = C.surface;
        g.beginPath();
        g.arc(on ? x + 15 : x + 5, y + 1, 3.5, 0, Math.PI * 2);
        g.fill();
        txt(g, label, x + 25, y + 4.5, `500 9.5px ${FT}`, C.text);
      };
      tog(12, 'ECG 0.5–40 Hz', E.useFilter);
      tog(110, 'isochrones', true);
      tog(196, 'Purkinje', true);
      y += 15;
      tog(12, 'electrodes', true);
      tog(110, 'spiral tips', true);
      tog(196, 'probes', true);
      y += 14;
      // protocol timeline: rhythm of every measured beat and the phase-singularity count over the whole run
      const ty = 488;
      g.fillStyle = C.faint;
      g.fillRect(8, ty - 12, p.w - 16, 1);
      g.letterSpacing = '0.9px';
      txt(g, 'PROTOCOL TIMELINE', 12, ty - 2, `600 8.5px ${FT}`, C.navy);
      g.letterSpacing = '0px';
      {
        const lab = `page ${APP.pageT.toFixed(1)} s`;
        g.font = `9px ${FM}`;
        const lw = g.measureText(lab).width;
        const phx = 44 + (clamp(APP.pageT, 0, APP.WARM + 55) / (APP.WARM + 55)) * (p.w - 12 - 44);
        if (phx > p.w - 12 - lw - 10) txt(g, lab, 128, ty - 2, `9px ${FM}`, C.text);
        else txt(g, lab, p.w - 12, ty - 2, `9px ${FM}`, C.text, 'right');
      }
      const T0 = 0, T1 = APP.WARM + 55;
      const X0 = 44, X1 = p.w - 12;
      const tx = (s) => X0 + ((s - T0) / (T1 - T0)) * (X1 - X0);
      const track = (y, h, label) => {
        txt(g, label, 12, y + h - 1.5, `7.5px ${FM}`, C.muted);
        g.fillStyle = '#F5EFE7';
        g.fillRect(X0, y, tx(APP.WARM) - X0, h);
        g.save();
        g.beginPath();
        g.rect(X0, y, tx(APP.WARM) - X0, h);
        g.clip();
        g.strokeStyle = 'rgba(122,127,138,0.22)';
        g.lineWidth = 1;
        for (let kx = -20; kx < 300; kx += 5) {
          g.beginPath();
          g.moveTo(X0 + kx, y + h);
          g.lineTo(X0 + kx + h, y);
          g.stroke();
        }
        g.restore();
        g.strokeStyle = C.line;
        g.strokeRect(X0 + 0.5, y + 0.5, X1 - X0 - 1, h - 1);
      };
      const by = ty + 5, py = ty + 19;
      track(by, 11, 'rhythm');
      track(py, 11, 'PS');
      for (const r of APP.table) {
        const s = simToPage(r.t);
        if (s < T0 || s > T1) continue;
        g.fillStyle = rhythmCol(r.rhythm);
        g.fillRect(tx(s) - 0.5, by + 1.5, 1.5, 8);
      }
      // PS count history over the run (downsampled)
      const pt = APP.psTimeline || [];
      if (pt.length > 1) {
        const mx = Math.max(2, ...pt.map((q) => q[1]));
        g.fillStyle = alpha(C.crimson, 0.25);
        g.strokeStyle = C.crimson;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(tx(Math.max(0, pt[0][0])), py + 10);
        for (const [s, n] of pt) if (s >= 0) g.lineTo(tx(s), py + 10 - (n / mx) * 8);
        g.lineTo(tx(pt[pt.length - 1][0]), py + 10);
        g.closePath();
        g.fill();
      }
      const mark = (s, col, lab) => {
        const xx = tx(s);
        g.fillStyle = col;
        g.fillRect(xx - 0.75, by - 3, 1.5, 30);
        txt(g, lab, xx, py + 22, `600 8.5px ${FT}`, col, 'center');
      };
      txt(g, 'warm-up 30 s', (X0 + tx(APP.WARM)) / 2, py + 22, `500 8.5px ${FT}`, C.muted, 'center');
      mark(APP.WARM, C.navy, 'rec');
      mark(APP.T_S2_PAGE, C.active, 'S2');
      mark(APP.T_SHOCK_PAGE, C.crimson, 'shock');
      const ph = clamp(APP.pageT, T0, T1);
      g.fillStyle = C.text;
      g.beginPath();
      g.moveTo(tx(ph), by - 1);
      g.lineTo(tx(ph) - 4, by - 7);
      g.lineTo(tx(ph) + 4, by - 7);
      g.fill();
      g.fillRect(tx(ph) - 0.5, by - 1, 1, 27);
    }

    // ======================= EVENT LOG =======================
    const LOGV = { n: 0, off: 0, lines: [] };
    const wrapCache = new Map();
    function wrapLine(g, s, maxW) {
      const key = s + '|' + maxW;
      if (wrapCache.has(key)) return wrapCache.get(key);
      const words = s.split(' ');
      const out = [];
      let cur = '';
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (g.measureText(t).width > maxW && cur) {
          out.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) out.push(cur);
      if (wrapCache.size > 2000) wrapCache.clear();
      wrapCache.set(key, out);
      return out;
    }
    const LOGCOL = { info: C.muted, beat: C.text, pk: C.blue, warn: C.warn, down: C.down, up: C.up, active: C.active };
    function drawLog() {
      const p = P.log, g = begin(p);
      card(g, p.w, p.h, 'EVENT LOG', null, `${APP.log.length} events · sim ms`);
      g.font = `9px ${FM}`;
      const lh = 12;
      // new lines slide in from the bottom
      if (APP.log.length !== LOGV.n) {
        const added = APP.log.length - LOGV.n;
        let rows = 0;
        for (const e of APP.log.slice(-Math.min(added, 20))) rows += wrapLine(g, e.text, p.w - 70).length;
        LOGV.off += rows * lh;
        LOGV.n = APP.log.length;
      }
      LOGV.off *= 0.6;
      if (LOGV.off < 0.3) LOGV.off = 0;
      g.save();
      g.beginPath();
      g.rect(1, 27, p.w - 2, p.h - 29);
      g.clip();
      let y = p.h - 9 + Math.round(LOGV.off);
      for (let i = APP.log.length - 1; i >= 0 && y > 20; i--) {
        const e = APP.log[i];
        const rows = wrapLine(g, e.text, p.w - 70);
        // a row is never cut through its glyphs: it fades out completely before its top reaches the viewport edge
        const topY = 28;
        for (let k = rows.length - 1; k >= 0; k--) {
          const a = clamp((y - 9 - topY) / lh, 0, 1);
          if (a > 0) {
            g.globalAlpha = a;
            if (k === 0) txt(g, nf(e.t, 0).padStart(6), 9, y, `9px ${FM}`, C.muted);
            txt(g, rows[k], k === 0 ? 58 : 64, y, `9px ${FM}`, LOGCOL[e.cls] || C.text);
            if (k === 0 && (e.cls === 'down' || e.cls === 'active' || e.cls === 'up')) {
              g.fillStyle = LOGCOL[e.cls];
              g.fillRect(4, y - 7.5, 2, 9 + (rows.length - 1) * lh);
            }
            g.globalAlpha = 1;
          }
          y -= lh;
        }
      }
      g.restore();
      // fades at the top and bottom of the viewport
      const fade = (y0, h, up) => {
        const gr = g.createLinearGradient(0, y0, 0, y0 + h);
        gr.addColorStop(up ? 0 : 1, 'rgba(255,255,255,1)');
        gr.addColorStop(up ? 1 : 0, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(1, y0, p.w - 2, h);
      };

      fade(p.h - 6, 5, false);
    }

    // ======================= WORKSTATION =======================
    function spark(g, x, y, w, h, vals, max, col, fill) {
      if (!vals.length) return;
      g.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const xx = x + (i / Math.max(1, vals.length - 1)) * w;
        const yy = y + h - clamp(vals[i] / max, 0, 1) * h;
        i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
      }
      if (fill) {
        g.lineTo(x + w, y + h);
        g.lineTo(x, y + h);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.beginPath();
        for (let i = 0; i < vals.length; i++) {
          const xx = x + (i / Math.max(1, vals.length - 1)) * w;
          const yy = y + h - clamp(vals[i] / max, 0, 1) * h;
          i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
        }
      }
      g.strokeStyle = col;
      g.lineWidth = 1;
      g.stroke();
    }
    function drawWork() {
      const p = P.work, g = begin(p);
      const sys = STUDIO.system || {};
      const cpuName = ((sys.cpu || '').match(/Ryzen\s+\d+\s+\w+/) || [(sys.cpu || 'CPU').replace(/AMD |with Radeon Graphics|\(TM\)/g, '').trim().slice(0, 20)])[0];
      card(g, p.w, p.h, 'WORKSTATION', null, `${cpuName} · ${sys.threads || 16} thr`);
      const hist = STUDIO.history(30);
      const m = STUDIO.metrics();
      const threads = (m.cpu && m.cpu.length) || 16;
      const cw = (p.w - 16 - 3 * 4) / 4, ch = 25;
      for (let i = 0; i < 16; i++) {
        const cx = 8 + (i % 4) * (cw + 4), cy = 31 + Math.floor(i / 4) * (ch + 4);
        g.fillStyle = '#FAF8F5';
        rr(g, cx, cy, cw, ch, 2);
        g.fill();
        const vals = hist.map((s) => (s.cpu && s.cpu[i] !== undefined ? s.cpu[i] : 0));
        const v = m.cpu && m.cpu[i] !== undefined ? m.cpu[i] : null;
        const col = v === null ? C.muted : v > 85 ? C.crimson : v > 60 ? C.amber : C.teal;
        spark(g, cx + 1, cy + 9, cw - 2, ch - 10, vals, 100, col, alpha(col, 0.13));
        txt(g, `T${String(i).padStart(2, '0')}`, cx + 3, cy + 8, `7.5px ${FM}`, C.muted);
        txt(g, v === null || i >= threads ? '--' : `${Math.round(v)}%`, cx + cw - 3, cy + 8, `8px ${FM}`, C.text, 'right');
      }
      // RAM, GPU, disk
      const y2 = 31 + 4 * (ch + 4) + 2;
      const mw = (p.w - 16 - 8) / 3, mh = 40;
      const mini = (i, label, val, vals, max, col, sub) => {
        const x = 8 + i * (mw + 4);
        g.fillStyle = '#FAF8F5';
        rr(g, x, y2, mw, mh, 2);
        g.fill();
        g.letterSpacing = '0.6px';
        txt(g, label, x + 4, y2 + 9, `600 7.5px ${FT}`, C.muted);
        g.letterSpacing = '0px';
        txt(g, val, x + mw - 4, y2 + 9.5, `9px ${FM}`, C.text, 'right');
        if (vals) spark(g, x + 2, y2 + 14, mw - 4, mh - 17, vals, max, col, alpha(col, 0.12));
        else txt(g, '—', x + mw / 2, y2 + 30, `12px ${FM}`, C.muted, 'center');
        if (sub) txt(g, sub, x + 4, y2 + mh - 3, `7px ${FM}`, C.muted);
      };
      const ramT = m.ramTotal || sys.ramGB || 16;
      mini(0, 'RAM', `${(m.ramUsed || 0).toFixed(1)}/${ramT.toFixed(1)} GB`, hist.map((s) => s.ramUsed || 0), ramT, C.purple);
      const gpuVals = m.gpu === null || m.gpu === undefined ? null : hist.map((s) => s.gpu || 0);
      mini(1, 'GPU', m.gpu === null || m.gpu === undefined ? '—' : `${Math.round(m.gpu)}%`, gpuVals, 100, C.blue);
      const dk = m.diskR === null || m.diskR === undefined ? null : hist.map((s) => (s.diskR || 0) + (s.diskW || 0));
      const dmax = dk ? Math.max(1, ...dk) : 1;
      mini(2, 'DISK', dk ? `R ${(m.diskR || 0).toFixed(1)} W ${(m.diskW || 0).toFixed(1)}` : '—', dk, dmax * 1.1, C.teal);
      // page: fps, JS frame-time histogram, GPU work
      const y3 = y2 + mh + 5;
      const pf = STUDIO.perf();
      g.fillStyle = '#FAF8F5';
      rr(g, 8, y3, 136, p.h - y3 - 7, 2);
      g.fill();
      g.letterSpacing = '0.6px';
      txt(g, 'PAGE', 12, y3 + 9, `600 7.5px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      txt(g, `${pf.fps} fps · ${pf.frameMs} ms`, 140, y3 + 9.5, `9px ${FM}`, pf.fps >= 55 ? C.up : C.warn, 'right');
      const hb = APP.stats.frameMsHist;
      const hmax = Math.max(1, ...hb);
      const hx = 12, hy = y3 + 13, hw = 128, hh = p.h - y3 - 7 - 26;
      for (let i = 0; i < 24; i++) {
        const v = hb[i] / hmax;
        g.fillStyle = i >= 16 ? C.amber : C.navy;
        g.fillRect(hx + i * (hw / 24) + 0.5, hy + hh - v * hh, hw / 24 - 1, v * hh);
      }
      g.fillStyle = C.crimson;
      g.fillRect(hx + (16.7 / 24) * hw, hy - 1, 1, hh + 2);
      const js = APP.stats.jsMs;
      const jsAvg = js.length ? js.reduce((s, x) => s + x, 0) / js.length : 0;
      txt(g, `JS ${jsAvg.toFixed(1)} ms/frame   0–24 ms`, 12, p.h - 10, `7.5px ${FM}`, C.muted);
      // GPU work
      const gx = 150, gw = p.w - gx - 8;
      g.fillStyle = '#FAF8F5';
      rr(g, gx, y3, gw, p.h - y3 - 7, 2);
      g.fill();
      g.letterSpacing = '0.6px';
      txt(g, 'GPU SOLVER', gx + 4, y3 + 9, `600 7.5px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      const S0 = APP.S;
      const rows = [
        ['substeps/frame', `${APP.stepsThisFrame || APP.NSUB} · ${S0.draws || 15} draws`],
        ['GPU pass (timer)', S0.gpuLast ? `${S0.gpuLast.toFixed(2)} ms` : '--'],
        ['upd/GPU-second', APP.stats.cupsGpu ? `${(APP.stats.cupsGpu / 1e6).toFixed(1)} M` : '--'],
        ['delivered @60fps', `${((APP.stats.cups || 0) / 1e6).toFixed(2)} M/s`],
        ['readback', '61 KB / 2 frames'],
      ];
      rows.forEach(([a, b], i) => {
        txt(g, a, gx + 4, y3 + 19 + i * 9, `8px ${FM}`, C.muted);
        txt(g, b, gx + gw - 4, y3 + 19 + i * 9, `8px ${FM}`, i === 2 ? C.active : C.text, 'right');
      });
    }

    // ======================= HERO =======================
    const F = APP.FIELD;
    // display crop of the hero: the bounding square of the heart and the precordial electrodes (with their readouts)
    const HC = (() => {
      let x0 = N, x1 = 0, y0 = N, y1 = 0;
      for (let i = 0; i < N * N; i++) {
        if (A.type[i] === RE.T.OUT) continue;
        const x = i % N, y = (i / N) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      for (const e of APP.EL.list.slice(3)) {
        x0 = Math.min(x0, e.x - 9); x1 = Math.max(x1, e.x + 9); y0 = Math.min(y0, e.y - 9); y1 = Math.max(y1, e.y + 18);
      }
      const s = Math.max(x1 - x0, y1 - y0) + 6;
      // right-aligned: the spare width becomes an instrument column on the left (legend, colour bar, scar inset)
      return { x: x1 + 4 - s, y: (y0 + y1) / 2 - s / 2, s };
    })();
    APP.heroCrop = HC;
    const hs = F.w / HC.s;
    const hx = (x) => F.x - L.hero.x + (x - HC.x) * hs, hy = (y) => F.y - L.hero.y + (y - HC.y) * hs;
    const nodes = H.sys.nodes;
    // probe label placement (px offsets from the marker, away from the tissue)
    const PROBE_LABEL = { SA: [-12, -22], RA: [18, 4], AV: [-30, -12], His: [-30, 16], LVendo: [-34, 12], LVepi: [16, -10], BZ: [22, -16] };
    const PROBE_NAME = { SA: 'SA node', RA: 'RA', AV: 'AV node', His: 'His', LVendo: 'LV endo', LVepi: 'LV epi', BZ: 'BZ' };
    // magnified inset of the scar and border-zone circuit (bottom-left corner of the field)
    const INSET = { x: F.x + 6, y: F.y + F.h - 222, w: 172, h: 216 };
    // crop: s cells across the inset width, the same scale vertically
    const INSET_CROP = (() => {
      // fit the whole circuit loop (with a margin) into the inset's aspect ratio
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const q of A.loop) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const m = 4, ar = INSET.h / INSET.w;
      const s = Math.max(x1 - x0 + 2 * m, (y1 - y0 + 2 * m) / ar);
      return { s, x: (x0 + x1) / 2 - s / 2, y: (y0 + y1) / 2 - (s * ar) / 2 };
    })();
    const zoomX = (INSET.w / INSET_CROP.s / hs).toFixed(1);
    const ix = (x) => INSET.x - L.hero.x + ((x - INSET_CROP.x) / INSET_CROP.s) * INSET.w;
    const iy = (y) => INSET.y - L.hero.y + ((y - INSET_CROP.y) / INSET_CROP.s) * INSET.w;
    // chamber label anchors
    const chamberPos = (() => {
      const Fr = A.F, Pp = H.P;
      const at = (c) => Fr.toImg(c.u, c.w);
      return [
        ['RA', at(Pp.ra)], ['LA', at(Pp.la)], ['RV', at({ u: Pp.rv.u - 18, w: Pp.rv.w + 10 })], ['LV', at({ u: Pp.lv.u, w: Pp.lv.w + 10 })],
      ];
    })();
    function edgeTag(g, e, val) {
      // a limb electrode far outside the slice: a tag near the field edge with an arrow toward it
      const cx = 256, cy = 256;
      const dx = e.x - cx, dy = e.y - cy;
      const pos = { RA: [0.075, 0.215], LA: [0.955, 0.335], LL: [0.9, 0.975] }[e.name];
      const x = F.x - L.hero.x + pos[0] * F.w, y = F.y - L.hero.y + pos[1] * F.h;
      const ang = Math.atan2(dy, dx);
      g.save();
      g.translate(x, y);
      g.fillStyle = C.navy;
      g.beginPath();
      g.moveTo(Math.cos(ang) * 12, Math.sin(ang) * 12);
      g.lineTo(Math.cos(ang + 2.6) * 6, Math.sin(ang + 2.6) * 6);
      g.lineTo(Math.cos(ang - 2.6) * 6, Math.sin(ang - 2.6) * 6);
      g.fill();
      g.restore();
      const lab = `${e.name}  ${sgn2(val)} mV`;
      g.font = `9px ${FM}`;
      const w = g.measureText(lab).width + 10;
      const bx = clamp(x - w / 2 - Math.cos(ang) * (w / 2 + 6), F.x - L.hero.x + 2, F.x - L.hero.x + F.w - w - 2);
      const byy = clamp(y - 7 - Math.sin(ang) * 12, F.y - L.hero.y + 2, F.y - L.hero.y + F.h - 16);
      g.fillStyle = 'rgba(255,255,255,0.92)';
      rr(g, bx, byy, w, 14, 7);
      g.fill();
      g.strokeStyle = C.navy;
      g.lineWidth = 1;
      g.stroke();
      txt(g, lab, bx + 5, byy + 10, `9px ${FM}`, Math.abs(val) < 0.005 ? C.muted : C.navy);
    }
    // static layer: card, conduction system at rest, probes, electrodes, labels, legend, colour bar, scale bar
    const HS = (() => {
      const c = document.getElementById('heroStatic');
      const r = L.hero;
      c.style.left = r.x + 'px';
      c.style.top = r.y + 'px';
      c.style.width = r.w + 'px';
      c.style.height = r.h + 'px';
      c.width = Math.round(r.w * DPR);
      c.height = Math.round(r.h * DPR);
      return { c, g: c.getContext('2d'), w: r.w, h: r.h };
    })();
    function drawHeroStatic() {
      const g = HS.g;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, HS.w, HS.h);
      card(g, HS.w, HS.h, 'VOLTAGE MAP', 'Vm · four-chamber long-axis slice · 512 × 512 cells', '');
      const fx = F.x - L.hero.x, fy = F.y - L.hero.y;
      g.clearRect(fx, fy, F.w, F.h);
      g.save();
      g.beginPath();
      g.rect(fx, fy, F.w, F.h);
      g.clip();
      g.lineCap = 'round';
      g.lineWidth = 0.9;
      g.strokeStyle = 'rgba(36,50,79,0.55)';
      g.beginPath();
      for (const n of nodes) {
        if (n.parent < 0 || n.sys !== 'P') continue;
        const q = nodes[n.parent];
        g.moveTo(hx(q.x), hy(q.y));
        g.lineTo(hx(n.x), hy(n.y));
      }
      g.stroke();
      g.setLineDash([3, 2.5]);
      g.strokeStyle = 'rgba(14,140,122,0.65)';
      g.beginPath();
      for (const n of nodes) {
        if (n.parent < 0 || n.sys !== 'A') continue;
        const q = nodes[n.parent];
        g.moveTo(hx(q.x), hy(q.y));
        g.lineTo(hx(n.x), hy(n.y));
      }
      g.stroke();
      g.setLineDash([]);
      for (const sys of ['P', 'A']) {
        g.fillStyle = sys === 'P' ? 'rgba(36,50,79,0.75)' : 'rgba(14,140,122,0.85)';
        g.beginPath();
        for (const n of nodes) {
          if (!n.junction || n.sys !== sys) continue;
          g.moveTo(hx(n.x) + 1.3, hy(n.y));
          g.arc(hx(n.x), hy(n.y), 1.3, 0, Math.PI * 2);
        }
        g.fill();
      }
      // chamber labels
      for (const [lab, q] of chamberPos) {
        g.letterSpacing = '1.5px';
        txt(g, lab, hx(q.x), hy(q.y), `600 15px ${FB}`, 'rgba(36,50,79,0.4)', 'center');
        g.letterSpacing = '0px';
      }
      const sa = H.sys.sa;
      void sa;
      {
        const sx0 = hx(A.loop.center.x), sy0 = hy(A.loop.center.y);
        g.strokeStyle = C.purple;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(sx0 + 6, sy0 + 4);
        g.lineTo(sx0 + 44, sy0 + 30);
        g.lineTo(sx0 + 58, sy0 + 30);
        g.stroke();
        txt(g, 'infarct scar', sx0 + 61, sy0 + 33, `600 9px ${FT}`, C.purple, 'left');
        txt(g, '+ border zone', sx0 + 61, sy0 + 44, `8px ${FM}`, C.purple, 'left');
      }
      // S2 site crosshair
      const s2 = H.s2site;
      const sx = hx(s2.x), sy = hy(s2.y);
      g.strokeStyle = C.active;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(sx - 9, sy); g.lineTo(sx - 4, sy); g.moveTo(sx + 4, sy); g.lineTo(sx + 9, sy);
      g.moveTo(sx, sy - 9); g.lineTo(sx, sy - 4); g.moveTo(sx, sy + 4); g.lineTo(sx, sy + 9);
      g.stroke();
      txt(g, 'S2', sx - 11, sy - 5, `700 9.5px ${FT}`, C.active, 'right');
      // probes
      APP.probes.forEach((q, i) => {
        const x = hx(q.x), y = hy(q.y);
        const sel = i === APP.selProbe;
        g.fillStyle = sel ? C.purple : C.navy;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y);
        g.closePath();
        g.fill();
        g.stroke();
        const off = PROBE_LABEL[q.key] || [8, -8];
        const lx = x + off[0], ly = y + off[1];
        g.strokeStyle = sel ? alpha(C.purple, 0.8) : alpha(C.navy, 0.7);
        g.lineWidth = 0.9;
        g.beginPath();
        g.moveTo(x + Math.sign(off[0]) * 4, y + Math.sign(off[1]) * 3);
        g.lineTo(lx, ly);
        g.stroke();
        const lab = PROBE_NAME[q.key] || q.key;
        g.font = `600 8.5px ${FM}`;
        g.textAlign = off[0] < 0 ? 'right' : 'left';
        const tx = lx + (off[0] < 0 ? -2 : 2), ty = ly + 3;
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.lineWidth = 3;
        g.strokeText(lab, tx, ty);
        g.fillStyle = sel ? C.purple : C.navy;
        g.fillText(lab, tx, ty);
        g.textAlign = 'left';
      });
      // precordial electrode discs (values are drawn live)
      APP.EL.list.forEach((e, j) => {
        if (j < 3) return;
        const x = hx(e.x), y = hy(e.y);
        g.fillStyle = '#fff';
        g.strokeStyle = C.navy;
        g.lineWidth = 1.3;
        g.beginPath();
        g.arc(x, y, 8.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        txt(g, e.name, x, y + 3.2, `700 8.5px ${FT}`, C.navy, 'center');
      });
      g.restore();
      // colour bar (right edge)
      const cbx = fx + 50, cby = fy + 190, cbh = 150;
      for (let i = 0; i < cbh; i++) {
        g.fillStyle = vmRGB(1 - i / cbh);
        g.fillRect(cbx, cby + i, 10, 1.2);
      }
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.strokeRect(cbx + 0.5, cby + 0.5, 9, cbh - 1);
      txt(g, 'Vm', cbx + 5, cby - 14, `600 8.5px ${FT}`, C.text, 'center');
      txt(g, 'mV', cbx + 5, cby - 4, `8px ${FM}`, C.muted, 'center');
      for (const mv of [20, 0, -20, -40, -60, -80]) {
        const yy = cby + ((20 - mv) / 100) * cbh;
        g.fillStyle = C.text;
        g.fillRect(cbx - 3, yy, 3, 1);
        txt(g, String(mv), cbx - 5, yy + 3, `8px ${FM}`, C.text, 'right');
      }
      // scale bar
      const sbx = fx + 12, sby = fy + 386, sbw = 50 * hs;
      g.fillStyle = C.text;
      g.fillRect(sbx, sby, sbw, 1.5);
      g.fillRect(sbx, sby - 4, 1.5, 9);
      g.fillRect(sbx + sbw - 1.5, sby - 4, 1.5, 9);
      txt(g, '50 cells', sbx + sbw / 2, sby - 5, `8.5px ${FM}`, C.text, 'center');
      // legend (top right)
      const lx = fx + F.w - 150, ly = fy + 8;
      g.fillStyle = 'rgba(255,255,255,0.86)';
      rr(g, lx - 6, ly - 4, 150, 64, 3);
      g.fill();
      const leg = (i, draw, lab) => {
        const yy = ly + 6 + i * 12;
        draw(lx, yy);
        txt(g, lab, lx + 22, yy + 3, `8.5px ${FT}`, C.text);
      };
      leg(0, (x, y) => { g.fillStyle = '#A8A39D'; g.fillRect(x, y - 4, 16, 8); g.strokeStyle = '#6C6762'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + k * 5, y + 4); g.lineTo(x + k * 5 + 4, y - 4); g.stroke(); } }, 'dense scar (D = 0)');
      leg(1, (x, y) => { g.strokeStyle = C.purple; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.stroke(); }, `border zone, D ${H.P.D.bz.toFixed(2)}`);
      leg(2, (x, y) => { g.strokeStyle = C.navy; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.stroke(); g.fillStyle = C.navy; g.beginPath(); g.arc(x + 16, y, 1.6, 0, 7); g.fill(); }, 'His-Purkinje · PMJ');
      leg(3, (x, y) => { g.strokeStyle = C.teal; g.setLineDash([3, 2]); g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.stroke(); g.setLineDash([]); }, 'atrial fast tracts');
      leg(4, (x, y) => { g.strokeStyle = 'rgba(28,31,38,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y); g.stroke(); }, 'isochrones 20 ms');
    }
    function drawHero(now) {
      const p = P.hero, g = begin(p);
      const fx = F.x - L.hero.x, fy = F.y - L.hero.y;
      txt(g, `t ${nf(H.t, 1)} ms`, p.w - 10, 17.5, `9.5px ${FM}`, C.muted, 'right');
      g.save();
      g.beginPath();
      g.rect(fx, fy, F.w, F.h);
      g.clip();
      const t = H.t;
      const fl = H.cs.flash;
      // segments and junctions that fired in the last 140 ms
      g.lineCap = 'round';
      // batched by intensity bucket (4 buckets) and direction: a handful of strokes per frame
      for (let b = 0; b < 4; b++) {
        for (const retro of [false, true]) {
          const k = (b + 0.5) / 4;
          let any = false;
          g.beginPath();
          for (const n of nodes) {
            if (n.parent < 0 || !!n.retro !== retro) continue;
            const age = t - fl[n.id];
            if (age < 0 || age > 140) continue;
            if (Math.min(3, Math.floor((1 - age / 140) * 4)) !== b) continue;
            const q = nodes[n.parent];
            g.moveTo(hx(q.x), hy(q.y));
            g.lineTo(hx(n.x), hy(n.y));
            if (n.junction) {
              g.moveTo(hx(n.x) + 1.4 + 1.8 * k, hy(n.y));
              g.arc(hx(n.x), hy(n.y), 1.4 + 1.8 * k, 0, Math.PI * 2);
            }
            any = true;
          }
          if (!any) continue;
          g.strokeStyle = retro ? `rgba(107,79,163,${0.18 + 0.45 * k})` : `rgba(232,${Math.round(120 + 80 * k)},40,${0.35 + 0.65 * k})`;
          g.lineWidth = retro ? 0.9 + 0.7 * k : 1 + 1.6 * k;
          g.stroke();
        }
      }
      // SA pulse
      const sa = H.sys.sa;
      const saAge = t - (H.saTimes[H.saTimes.length - 1] || -1e9);
      if (saAge >= 0 && saAge < 220) {
        const k = saAge / 220;
        g.strokeStyle = `rgba(14,140,122,${1 - k})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(hx(sa.x), hy(sa.y), 4 + 12 * k, 0, Math.PI * 2);
        g.stroke();
      }
      // S2 pulse
      const pr = APP.proto;
      if (pr.s2) {
        const a = t - pr.s2.t;
        if (a >= 0 && a < 450) {
          const k = a / 450;
          g.strokeStyle = `rgba(37,99,235,${1 - k})`;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(hx(H.s2site.x), hy(H.s2site.y), 6 + 34 * k, 0, Math.PI * 2);
          g.stroke();
        }
      }
      // electrodes: live potentials
      const kk = E.n - 1;
      const elv = (j) => (kk >= 0 ? E.el[j][E.idx(kk)] : 0);
      APP.EL.list.forEach((e, j) => {
        const v = elv(j);
        if (j < 3) return edgeTag(g, e, v);
        const x = hx(e.x), y = hy(e.y);
        const mag = clamp(Math.abs(v) / 2.5, 0, 1);
        g.strokeStyle = v >= 0 ? C.crimson : C.blue;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * mag);
        g.stroke();
        // numeric potential always; isoelectric values are greyed (V1 reads out to its left, clear of the inset)
        const side = e.name === 'V1';
        const vs = sgn2(v) + ' mV';
        g.font = `8.5px ${FM}`;
        const vw = g.measureText(vs).width;
        const vx = side ? x - 14 - vw : x - vw / 2, vy = side ? y + 3 : y + 22;
        g.fillStyle = 'rgba(255,255,255,0.9)';
        rr(g, vx - 3, vy - 8.5, vw + 6, 12, 6);
        g.fill();
        txt(g, vs, vx, vy, `8.5px ${FM}`, Math.abs(v) < 0.005 ? C.muted : C.navy);
      });
      // spiral tips: trails and markers
      for (const tr of APP.ps.trails) {
        const age = t - tr.t;
        if (age > 2000) continue;
        g.strokeStyle = tr.q > 0 ? `rgba(200,16,46,${0.45 * (1 - age / 2000)})` : `rgba(37,99,235,${0.45 * (1 - age / 2000)})`;
        g.lineWidth = 1.4;
        g.beginPath();
        tr.trail.forEach(([x, y], i) => (i ? g.lineTo(hx(x), hy(y)) : g.moveTo(hx(x), hy(y))));
        g.stroke();
      }
      for (const q of APP.ps.list) {
        if (q.seen < 2) continue;
        const col = q.q > 0 ? C.crimson : C.active;
        g.strokeStyle = col;
        g.lineWidth = 1.6;
        g.globalAlpha = 0.55;
        g.beginPath();
        q.trail.forEach(([x, y], i) => (i ? g.lineTo(hx(x), hy(y)) : g.moveTo(hx(x), hy(y))));
        g.stroke();
        g.globalAlpha = 1;
        const x = hx(q.x), y = hy(q.y);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.stroke();
        const a0 = (now / 300) * (q.q > 0 ? -1 : 1);
        g.beginPath();
        g.arc(x, y, 10, a0, a0 + 4.2 * (q.q > 0 ? -1 : 1), q.q > 0);
        g.stroke();
        txt(g, q.q > 0 ? 'PS +1' : 'PS −1', x + 12, y - 9, `700 8.5px ${FM}`, col);
      }
      // anchored rotor: wavefront comet along the loop round the scar
      const R = APP.rotor;
      if (R.q !== 0 && R.front >= 0) {
        const lp = A.loop, nL = lp.length;
        const dir = R.dir >= 0 ? 1 : -1;
        const fpred = R.front + (R.rate || 0) * Math.min(20, H.t - (R.tFront || H.t));
        for (let s = 0; s < 22; s++) {
          const f = (((fpred - dir * s * 0.9) % nL) + nL) % nL;
          const i0 = Math.floor(f), i1 = (i0 + 1) % nL, fr = f - i0;
          const x = hx(lerp(lp[i0].x, lp[i1].x, fr)), y = hy(lerp(lp[i0].y, lp[i1].y, fr));
          g.fillStyle = `rgba(200,16,46,${(1 - s / 22) * 0.9})`;
          g.beginPath();
          g.arc(x, y, 3.2 * (1 - s / 30), 0, Math.PI * 2);
          g.fill();
        }
      }
      // circuit path with arrowheads (main view, small) and the inset
      const lp = A.loop, nL = lp.length;
      const dirC = R.dir >= 0 ? 1 : -1;
      const drawCircuit = (X, Y, lw, heads, col) => {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.setLineDash([3, 2.5]);
        g.beginPath();
        for (let i = 0; i <= nL; i++) {
          const q = lp[i % nL];
          i ? g.lineTo(X(q.x), Y(q.y)) : g.moveTo(X(q.x), Y(q.y));
        }
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = col;
        for (let hI = 0; hI < heads; hI++) {
          const i0 = Math.floor((hI * nL) / heads), i1 = (i0 + dirC * 3 + nL) % nL;
          const a = lp[i0], b = lp[i1];
          const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
          const x = X(b.x), y = Y(b.y), s = 3 + lw * 1.6;
          g.beginPath();
          g.moveTo(x + Math.cos(ang) * s, y + Math.sin(ang) * s);
          g.lineTo(x + Math.cos(ang + 2.5) * s, y + Math.sin(ang + 2.5) * s);
          g.lineTo(x + Math.cos(ang - 2.5) * s, y + Math.sin(ang - 2.5) * s);
          g.fill();
        }
      };
      {
        // source box round the scar in the main view
        const bx0 = hx(INSET_CROP.x), by0 = hy(INSET_CROP.y), bs = INSET_CROP.s * hs, bh = (bs * INSET.h) / INSET.w;
        g.strokeStyle = alpha(C.purple, 0.7);
        g.lineWidth = 1;
        g.setLineDash([2, 2]);
        g.strokeRect(bx0 + 0.5, by0 + 0.5, bs, bh);
        g.setLineDash([]);
        txt(g, `${zoomX}×`, bx0 - 3, by0 + bh + 2, `700 8px ${FM}`, C.purple, 'right');
        if (R.q !== 0) drawCircuit(hx, hy, 1.1, 2, alpha(C.crimson, 0.85));
      }
      g.restore();
      g.save();
      {
        const x0 = INSET.x - L.hero.x, y0 = INSET.y - L.hero.y;
        g.beginPath();
        g.rect(x0, y0, INSET.w, INSET.h);
        g.clip();
        if (R.q !== 0) {
          drawCircuit(ix, iy, 1.6, 4, alpha('#ffffff', 0.95));
          const fpred = R.front + (R.rate || 0) * Math.min(20, H.t - (R.tFront || H.t));
          for (let s = 0; s < 26; s++) {
            const fq = (((fpred - dirC * s * 0.8) % nL) + nL) % nL;
            const j0 = Math.floor(fq), j1 = (j0 + 1) % nL, fr = fq - j0;
            g.fillStyle = `rgba(28,31,38,${(1 - s / 26) * 0.85})`;
            g.beginPath();
            g.arc(ix(lerp(lp[j0].x, lp[j1].x, fr)), iy(lerp(lp[j0].y, lp[j1].y, fr)), 4 * (1 - s / 34), 0, Math.PI * 2);
            g.fill();
          }
        }
        // phase-singularity trails (last 2 s, fading) and live tips in the inset
        for (const tr of [...APP.ps.trails.map((x) => ({ trail: x.trail, q: x.q, age: t - x.t })), ...APP.ps.list.filter((x) => x.seen >= 2).map((x) => ({ trail: x.trail, q: x.q, age: 0 }))]) {
          if (tr.age > 2000) continue;
          g.strokeStyle = tr.q > 0 ? `rgba(200,16,46,${0.9 * (1 - tr.age / 2000)})` : `rgba(37,99,235,${0.9 * (1 - tr.age / 2000)})`;
          g.lineWidth = 1.6;
          g.beginPath();
          tr.trail.forEach(([x, y], i) => (i ? g.lineTo(ix(x), iy(y)) : g.moveTo(ix(x), iy(y))));
          g.stroke();
        }
        for (const q of APP.ps.list) {
          if (q.seen < 2) continue;
          g.strokeStyle = q.q > 0 ? C.crimson : C.active;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(ix(q.x), iy(q.y), 6, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.restore();
      g.save();
      {
        const x0 = INSET.x - L.hero.x, y0 = INSET.y - L.hero.y;
        g.strokeStyle = C.purple;
        g.lineWidth = 1.2;
        g.strokeRect(x0 - 0.5, y0 - 0.5, INSET.w + 1, INSET.h + 1);
        // title inside the inset frame, on a white strip
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.fillRect(x0, y0, INSET.w, 13);
        txt(g, `SCAR CIRCUIT · phase θ · ${zoomX}×`, x0 + 4, y0 + 9.5, `700 8px ${FT}`, C.purple);
        const st = R.q !== 0 ? `rotor q ${R.q > 0 ? '+1' : '−1'} · ${R.dir >= 0 ? 'CW' : 'CCW'}${R.period ? ' · ' + nf(R.period) + ' ms' : ''}` : 'no rotor (winding 0)';
        g.fillStyle = 'rgba(255,255,255,0.88)';
        g.font = `700 8px ${FM}`;
        const sw = g.measureText(st).width + 8;
        g.fillRect(x0 + 2, y0 + INSET.h - 14, sw, 12);
        txt(g, st, x0 + 6, y0 + INSET.h - 5, `700 8px ${FM}`, R.q !== 0 ? C.crimson : C.muted);
      }
      if (APP.flash > 0.02) {
        g.globalAlpha = Math.min(1, APP.flash * 1.6);
        g.fillStyle = C.active;
        rr(g, fx + F.w / 2 - 120, fy + 300, 240, 34, 6);
        g.fill();
        g.letterSpacing = '2px';
        txt(g, `SHOCK  ${APP.SHOCK.toFixed(1)} × ${APP.SHOCK_DUR.toFixed(1)} ms`, fx + F.w / 2, fy + 322, `600 17px ${FB}`, '#fff', 'center');
        g.letterSpacing = '0px';
        g.globalAlpha = 1;
      }
      g.restore();
      // live readout (top left)
      const lines = [
        `grid 512 × 512 · ${nf(A.tissue)} excitable cells`,
        `dx 0.30 · dt 0.020 (${APP.S.dtms.toFixed(3)} ms) · D·dt/dx² ${(APP.S.p.dt / (APP.S.p.dx * APP.S.p.dx)).toFixed(3)}`,
        `${APP.NSUB} substeps/frame · ${nf(APP.S.steps)} steps`,
        `t = ${nf(H.t, 1)} ms`,
      ];
      g.fillStyle = 'rgba(255,255,255,0.86)';
      rr(g, fx + 4, fy + 4, 214, 50, 3);
      g.fill();
      lines.forEach((s, i) => txt(g, s, fx + 9, fy + 15 + i * 11, `8.5px ${FM}`, i === 3 ? C.text : C.muted));
    }

    // ======================= ECG =======================
    // a real sweep: the ink lives in the visible canvas; every frame only the band ahead of the cursor is erased and
    // the new samples are drawn. Annotations and the ribbon sit on their own canvases, redrawn when they change.
    const MM = 3.5;
    const PX = { x: 8, y: 30, w: 892.5, rowH: 36 * MM, cal: 5 * MM };
    PX.h = PX.rowH * 4 + 2 * MM;
    const PAPER_W = Math.ceil(PX.w), PAPER_H = Math.ceil(PX.h);
    const LEADMAP = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
    const SWEEP = 10000; // ms per sweep (4 columns of 2.5 s)
    const TW = 250 * MM; // trace width (px)
    const mkCanvas = (id, r) => {
      const c = document.getElementById(id);
      c.style.left = r.x + 'px';
      c.style.top = r.y + 'px';
      c.style.width = r.w + 'px';
      c.style.height = r.h + 'px';
      c.width = Math.round(r.w * DPR);
      c.height = Math.round(r.h * DPR);
      return { c, g: c.getContext('2d'), w: r.w, h: r.h, r };
    };
    const EO = mkCanvas('ecgOver', L.ecg);
    const RBY = PX.y + PAPER_H + 4;
    const ER = mkCanvas('ecgRibbon', { x: L.ecg.x, y: L.ecg.y + RBY, w: L.ecg.w, h: L.ecg.h - RBY - 1 });
    const ecgCur = document.getElementById('ecgCursor');
    ecgCur.style.height = PAPER_H - 2 + 'px';
    const grid = document.createElement('canvas');
    grid.width = Math.ceil(PAPER_W * DPR);
    grid.height = Math.ceil(PAPER_H * DPR);
    const gg = grid.getContext('2d');
    function paperGrid(g, w, h, mm) {
      g.fillStyle = '#FDF1F1';
      g.fillRect(0, 0, w, h);
      g.lineWidth = 0.6;
      g.strokeStyle = 'rgba(231,154,154,0.32)';
      g.beginPath();
      for (let x = 0; x <= w; x += mm) { g.moveTo(Math.round(x * DPR) / DPR + 0.25, 0); g.lineTo(Math.round(x * DPR) / DPR + 0.25, h); }
      for (let y = 0; y <= h; y += mm) { g.moveTo(0, Math.round(y * DPR) / DPR + 0.25); g.lineTo(w, Math.round(y * DPR) / DPR + 0.25); }
      g.stroke();
      g.lineWidth = 0.9;
      g.strokeStyle = 'rgba(200,16,46,0.34)';
      g.beginPath();
      for (let x = 0; x <= w; x += mm * 5) { g.moveTo(Math.round(x * DPR) / DPR + 0.25, 0); g.lineTo(Math.round(x * DPR) / DPR + 0.25, h); }
      for (let y = 0; y <= h; y += mm * 5) { g.moveTo(0, Math.round(y * DPR) / DPR + 0.25); g.lineTo(w, Math.round(y * DPR) / DPR + 0.25); }
      g.stroke();
    }
    gg.setTransform(DPR, 0, 0, DPR, 0, 0);
    paperGrid(gg, PAPER_W, PAPER_H, MM);
    const rowBase = (r) => MM * 2 + r * PX.rowH + PX.rowH * 0.62;
    // calibration pulses in the left margin of every row (1 mV, 200 ms)
    gg.strokeStyle = '#111';
    gg.lineWidth = 1.2;
    for (let r = 0; r < 4; r++) {
      const b = rowBase(r);
      gg.beginPath();
      gg.moveTo(1, b);
      gg.lineTo(3, b);
      gg.lineTo(3, b - 10 * MM);
      gg.lineTo(3 + 5 * MM - 4, b - 10 * MM);
      gg.lineTo(3 + 5 * MM - 4, b);
      gg.lineTo(PX.cal, b);
      gg.stroke();
    }
    const sweepX = (t) => PX.cal + ((((t % SWEEP) + SWEEP) % SWEEP) / SWEEP) * TW;
    const colOf = (t) => Math.min(3, Math.floor(((((t % SWEEP) + SWEEP) % SWEEP) / SWEEP) * 4));
    // limb leads at 10 mm/mV, chest leads at half standard (5 mm/mV), as clinical machines do for tall precordial voltages
    const yOf = (r, mv, lead) => rowBase(r) - mv * (lead >= 6 ? 5 : 10) * MM;
    let inked = -1;
    function ecgBase() {
      const p = P.ecg, g = begin(p);
      card(g, p.w, p.h, '12-LEAD ECG', 'pseudo-ECG from the tissue currents · 9 electrodes · Wilson terminal', `25 mm/s · limb 10 · chest 5 mm/mV · ${E.useFilter ? '0.5–40 Hz' : 'unfiltered'}`);
      g.drawImage(grid, PX.x, PX.y, PAPER_W, PAPER_H);
      inked = -1;
    }
    function inkSamples() {
      const n = E.n;
      if (n < 2) return;
      const g = P.ecg.g;
      g.setTransform(DPR, 0, 0, DPR, PX.x * DPR, PX.y * DPR);
      let k0 = inked < 0 ? Math.max(1, n - Math.floor((SWEEP - 300) / E.dt)) : inked + 1;
      k0 = Math.max(k0, n - E.cap + 2, 1);
      if (k0 >= n) return;
      const tNow = E.t[E.idx(n - 1)];
      const gap = 6 * MM;
      const xe = sweepX(tNow);
      const xs = sweepX(E.t[E.idx(k0 - 1)]);
      const erase = (x0, x1) => {
        x0 = Math.max(PX.cal, x0);
        x1 = Math.min(PX.cal + TW + 1, x1);
        if (x1 <= x0) return;
        g.drawImage(grid, x0 * DPR, 0, (x1 - x0) * DPR, grid.height, x0, 0, x1 - x0, PAPER_H);
      };
      if (inked >= 0) {
        if (xe >= xs) erase(xs + 0.6, xe + gap);
        else {
          erase(xs + 0.6, PX.cal + TW + 1);
          erase(PX.cal, xe + gap);
        }
        if (xe + gap > PX.cal + TW) erase(PX.cal, PX.cal + (xe + gap - (PX.cal + TW)));
      } else {
        erase(xe, xe + gap);
      }
      g.save();
      g.beginPath();
      g.rect(PX.cal, 0, TW, PAPER_H);
      g.clip();
      g.strokeStyle = '#141414';
      g.lineWidth = 1.05;
      g.lineJoin = 'round';
      g.beginPath();
      for (let r = 0; r < 4; r++) {
        for (let k = k0; k < n; k++) {
          const tp = E.t[E.idx(k - 1)], tc = E.t[E.idx(k)];
          const wrap = (tc % SWEEP) < (tp % SWEEP);
          if (wrap) continue;
          const cp = colOf(tp), cc = colOf(tc);
          if (r < 3 && cp !== cc) continue;
          const lead = r < 3 ? LEADMAP[cc][r] : 1;
          g.moveTo(sweepX(tp), yOf(r, E.at(lead, k - 1), lead));
          g.lineTo(sweepX(tc), yOf(r, E.at(lead, k), lead));
        }
      }
      g.stroke();
      g.restore();
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      inked = n - 1;
    }
    const EOV = { key: '' };
    function drawEcgOver(force) {
      const tNow = E.n ? E.t[E.idx(E.n - 1)] : 0;
      const lastB = APP.lastBeat || null;
      const key = `${APP.table.length}|${APP.proto.s2 ? 1 : 0}|${APP.proto.shocks.length}|${Math.floor(tNow / 400)}`;
      if (!force && key === EOV.key) return;
      EOV.key = key;
      const g = EO.g;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, EO.w, EO.h);
      const ox = PX.x, oy = PX.y;
      g.strokeStyle = 'rgba(200,16,46,0.4)';
      g.lineWidth = 1;
      g.strokeRect(ox + 0.5, oy + 0.5, PAPER_W - 1, PAPER_H - 1);
      const names = RE.LEADS;
      for (let c = 0; c < 4; c++) {
        const x = ox + PX.cal + (c * TW) / 4;
        for (let r = 0; r < 3; r++) {
          const nm = names[LEADMAP[c][r]];
          g.font = `600 10px ${FT}`;
          const lw2 = g.measureText(nm).width;
          g.fillStyle = 'rgba(253,241,241,0.94)';
          rr(g, x + 1.5, oy + MM * 2 + r * PX.rowH + 1.5, lw2 + 6, 13, 3);
          g.fill();
          txt(g, nm, x + 4.5, oy + MM * 2 + r * PX.rowH + 11.5, `600 10px ${FT}`, '#3A2A2E');
          if (c === 2) {
            // half-standard calibration mark at the start of the chest columns: 1 mV = 5 mm
            const b0 = oy + rowBase(r);
            g.strokeStyle = '#141414';
            g.lineWidth = 1.1;
            g.beginPath();
            g.moveTo(x - 7, b0);
            g.lineTo(x - 5, b0);
            g.lineTo(x - 5, b0 - 5 * MM);
            g.lineTo(x - 1.5, b0 - 5 * MM);
            g.lineTo(x - 1.5, b0);
            g.lineTo(x, b0);
            g.stroke();
          } else if (c > 0) {
            g.fillStyle = '#141414';
            g.fillRect(x - 0.5, oy + rowBase(r) - 9, 1, 18);
          }
        }
      }
      const stripTop = oy + MM * 2 + 3 * PX.rowH;
      g.fillStyle = 'rgba(253,241,241,0.92)';
      g.fillRect(ox + PX.cal + 2, stripTop + 2, 112, 13);
      txt(g, 'II · rhythm strip 10 s', ox + PX.cal + 5, stripTop + 12, `600 9.5px ${FT}`, '#3A2A2E');
      const labelEnd = ox + PX.cal + 118;
      const inWin = (t) => t <= tNow && tNow - t < SWEEP - 6 * MM * (SWEEP / TW);
      for (const r of APP.table) {
        if (!inWin(r.t)) continue;
        const x = ox + sweepX(r.t);
        if (x < labelEnd + 6) continue;
        g.fillStyle = rhythmCol(r.rhythm);
        g.beginPath();
        g.moveTo(x, stripTop + 16);
        g.lineTo(x - 3, stripTop + 11);
        g.lineTo(x + 3, stripTop + 11);
        g.fill();
        if (r.rr && x > labelEnd + 10) txt(g, nf(r.rr), x, stripTop + 9, `8.5px ${FM}`, '#3A2A2E', 'center');
      }
      const pr = APP.proto;
      const event = (t, label, col) => {
        if (!inWin(t)) return;
        const x = ox + sweepX(t);
        // the marker runs through all 12-lead rows: at a given x every row shows the same instant
        g.strokeStyle = alpha(col, 0.55);
        g.setLineDash([2, 3]);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, oy + 2);
        g.lineTo(x, stripTop + 18);
        g.stroke();
        g.strokeStyle = col;
        g.setLineDash([3, 2]);
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, stripTop + 18);
        g.lineTo(x, oy + PAPER_H - 3);
        g.stroke();
        g.setLineDash([]);
        g.font = `700 9px ${FM}`;
        const w = g.measureText(label).width + 8;
        g.fillStyle = col;
        rr(g, x + 3, oy + PAPER_H - 16, w, 13, 2);
        g.fill();
        txt(g, label, x + 7, oy + PAPER_H - 6.5, `700 9px ${FM}`, '#fff');
      };
      if (pr.s2) event(pr.s2.t, `S2 · CI ${nf(pr.s2.ci)} ms`, C.active);
      for (const s of pr.shocks) event(s.t0, `SHOCK ${s.amp.toFixed(1)}`, C.crimson);
      if (pr.fallback) event(pr.fallback, 'cross-field S2', C.warn);
      // calipers on the last measured beat (rhythm strip)
      const b = lastB;
      if (b && inWin(b.t) && b.tEnd) {
        const by0 = oy + rowBase(3) + 18;
        const cal = (t0, t1, lane, label, col) => {
          if (t0 === null || t1 === null || t1 <= t0) return;
          const x0 = ox + sweepX(t0), x1 = ox + sweepX(t1);
          if (x1 < x0) return;
          const yy = by0 + lane * 11;
          g.strokeStyle = col;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x0, yy - 3); g.lineTo(x0, yy + 3); g.moveTo(x0, yy); g.lineTo(x1, yy); g.moveTo(x1, yy - 3); g.lineTo(x1, yy + 3);
          g.stroke();
          g.font = `8px ${FM}`;
          const lw = g.measureText(label).width;
          if (x1 > ox + PAPER_W - 80 || x1 + 3 + lw > ox + PAPER_W - 3) txt(g, label, x0 - 3, yy + 3, `8px ${FM}`, col, 'right');
          else txt(g, label, x1 + 3, yy + 3, `8px ${FM}`, col);
        };
        if (b.pOn) cal(b.pOn, b.tOn, 0, `PR ${nf(b.pr)}`, C.navy);
        cal(b.tOn, b.tOff, b.pOn ? 1 : 0, `QRS ${nf(b.qrs)}`, b.qrs > 120 ? C.warn : C.navy);
        cal(b.tOn, b.tEnd, b.pOn ? 2 : 1, `QT ${nf(b.qt)}`, C.navy);
      }
    }
    function drawECG() {
      if (inked < 0) ecgBase();
      inkSamples();
      drawEcgOver(false);
      const tNow = E.n ? E.t[E.idx(E.n - 1)] : 0;
      ecgCur.style.transform = `translate(${(L.ecg.x + PX.x + sweepX(tNow)).toFixed(2)}px, ${L.ecg.y + PX.y + 1}px)`;
      const nb = APP.table.length;
      if (nb !== ERS.n || f - ERS.f >= 20) {
        const g = ER.g;
        g.setTransform(DPR, 0, 0, DPR, 0, -RBY * DPR);
        g.clearRect(0, RBY, ER.w, ER.h);
        drawRibbon(g, P.ecg);
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        ERS.n = nb;
        ERS.f = f;
      }
    }
    const ERS = { n: -1, f: -100 };
    // ribbon under the paper: magnified last beat with calipers, intervals, axis wheel, RR tachogram
    function drawRibbon(g, p) {
      const y0 = PX.y + PAPER_H + 8, h = p.h - y0 - 8;
      const b = APP.lastBeat || null;
      // 1. magnified beat (lead II, 50 mm/s, 20 mm/mV)
      const bw = 300;
      g.save();
      g.beginPath();
      g.rect(PX.x, y0, bw, h);
      g.clip();
      g.translate(PX.x, y0);
      g.fillStyle = '#FDF1F1';
      g.fillRect(0, 0, bw, h);
      g.lineWidth = 0.6;
      g.strokeStyle = 'rgba(231,154,154,0.3)';
      g.beginPath();
      for (let x = 0; x <= bw; x += MM * 2) { g.moveTo(x + 0.25, 0); g.lineTo(x + 0.25, h); }
      for (let y = 0; y <= h; y += MM * 2) { g.moveTo(0, y + 0.25); g.lineTo(bw, y + 0.25); }
      g.stroke();
      g.strokeStyle = 'rgba(200,16,46,0.3)';
      g.lineWidth = 0.9;
      g.beginPath();
      for (let x = 0; x <= bw; x += MM * 10) { g.moveTo(x + 0.25, 0); g.lineTo(x + 0.25, h); }
      for (let y = 0; y <= h; y += MM * 10) { g.moveTo(0, y + 0.25); g.lineTo(bw, y + 0.25); }
      g.stroke();
      if (b) {
        const t0 = b.qrsLB && b.rr ? b.t - 0.6 * b.rr : (b.pOn || b.tOn - 160) - 60;
        const t1 = b.qrsLB && b.rr ? b.t + 0.6 * b.rr : (b.tEnd || b.tOn + 420) + 60;
        const sx = (bw - 10) / Math.max(1, t1 - t0);
        const base = h * 0.66;
        const yv = (mv) => base - mv * 20 * MM * 0.55;
        g.strokeStyle = '#141414';
        g.lineWidth = 1.3;
        g.beginPath();
        let first = true;
        for (let k = Math.max(0, E.n - Math.floor(4000 / E.dt)); k < E.n; k++) {
          const t = E.t[E.idx(k)];
          if (t < t0 || t > t1) continue;
          const x = 5 + (t - t0) * sx, y = yv(E.at(1, k));
          first ? g.moveTo(x, y) : g.lineTo(x, y);
          first = false;
        }
        g.stroke();
        const vline = (t, col, lab, yy) => {
          if (!t) return;
          const x = 5 + (t - t0) * sx;
          g.strokeStyle = col;
          g.setLineDash([2, 2]);
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, 14);
          g.lineTo(x, h - 4);
          g.stroke();
          g.setLineDash([]);
          txt(g, lab, x + 2, yy, `7.5px ${FM}`, col);
        };
        if (b.qrsLB) {
          // continuous complex: no QRS boundaries to mark; show the aligned fiducial and the 80 ms axis window
          const xf = 5 + (b.t - t0) * sx;
          g.fillStyle = alpha(C.active, 0.1);
          g.fillRect(xf - 40 * sx, 14, 80 * sx, h - 18);
          vline(b.t, C.active, 'fiducial', h - 6);
          g.fillStyle = 'rgba(253,241,241,0.92)';
          g.fillRect(bw - 176, 14, 170, 11);
          txt(g, 'no isoelectric segment · QRS > 200', bw - 6, 22.5, `7.5px ${FM}`, C.warn, 'right');
        } else {
          vline(b.pOn, C.teal, 'P on', h - 6);
          vline(b.tOn, C.active, 'QRS on', h - 6);
          vline(b.tOff, C.active, 'off', h - 15);
          vline(b.tEnd, C.purple, 'T end', h - 6);
        }
      }
      g.restore();
      g.strokeStyle = 'rgba(200,16,46,0.4)';
      g.strokeRect(PX.x + 0.5, y0 + 0.5, bw - 1, h - 1);
      g.letterSpacing = '0.7px';
      txt(g, 'LAST BEAT · II · 50 mm/s · 20 mm/mV', PX.x + 6, y0 + 11, `600 8px ${FT}`, '#3A2A2E');
      g.letterSpacing = '0px';
      // 2. intervals
      const ix = PX.x + bw + 12;
      const rows = b ? [
        ['RR', nf(b.rr), 'ms', C.text], ['HR', nf(b.hr), 'bpm', colHR(b.hr)], ['PR', b.pr ? nf(b.pr) : '--', 'ms', colPR(b.pr)],
        ['QRS', qrsTxt(b), 'ms', colQRS(b.qrs)], ['QT', nf(b.qt), 'ms', C.text], ['QTc', nf(b.qtc), 'ms', colQTc(b.qtc)],
        ['AXIS', sgnAx(b.axis), '°', C.text], ['TAT', b.tat ? nf(b.tat) : '--', 'ms', C.text],
      ] : [];
      g.letterSpacing = '0.7px';
      txt(g, `BEAT #${b ? b.n : '--'} · ${b ? b.rhythm : ''}`, ix, y0 + 11, `600 8px ${FT}`, b ? rhythmCol(b.rhythm) : C.muted);
      g.letterSpacing = '0px';
      rows.forEach(([lab, v, u, col], i) => {
        const cx = ix + (i % 2) * 112, cy = y0 + 30 + Math.floor(i / 2) * 27;
        txt(g, lab, cx, cy - 8, `600 7.5px ${FT}`, C.muted);
        g.font = `600 17px ${FB}`;
        g.fillStyle = col;
        g.fillText(v, cx, cy + 9);
        const w = g.measureText(v).width;
        txt(g, u, cx + w + 3, cy + 9, `8.5px ${FM}`, C.muted);
      });
      if (b && b.qrsLB) txt(g, b.rhythm === 'VT' ? `reentry: LAT map shown modulo CL ${nf(b.rr)} ms` : 'TAT: activation-phase spread over one cycle', ix, y0 + h - 2, `8px ${FM}`, C.muted);
      else if (b && b.tat) txt(g, `LAT-map TAT ${nf(b.tat)} vs ECG QRS ${nf(b.qrs)} ms`, ix, y0 + h - 2, `8px ${FM}`, C.muted);
      // 3. axis wheel
      const wx = ix + 240 + 62, wy = y0 + h / 2 + 4, wr = 52;
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(wx, wy, wr, 0, Math.PI * 2);
      g.stroke();
      const hexa = [['I', 0], ['II', 60], ['III', 120], ['aVF', 90], ['aVL', -30], ['aVR', -150]];
      for (const [lab, a] of hexa) {
        const r = (a * Math.PI) / 180;
        g.strokeStyle = C.faint;
        g.beginPath();
        g.moveTo(wx - Math.cos(r) * wr, wy - Math.sin(r) * wr);
        g.lineTo(wx + Math.cos(r) * wr, wy + Math.sin(r) * wr);
        g.stroke();
        txt(g, lab, wx + Math.cos(r) * (wr + 9), wy + Math.sin(r) * (wr + 9) + 3, `7.5px ${FM}`, C.muted, 'center');
      }
      // normal axis sector (-30 .. +90)
      g.fillStyle = alpha(C.up, 0.08);
      g.beginPath();
      g.moveTo(wx, wy);
      g.arc(wx, wy, wr, (-30 * Math.PI) / 180, (90 * Math.PI) / 180);
      g.fill();
      if (b) {
        const r = (b.axis * Math.PI) / 180;
        g.strokeStyle = C.crimson;
        g.lineWidth = 2.2;
        g.beginPath();
        g.moveTo(wx, wy);
        g.lineTo(wx + Math.cos(r) * (wr - 4), wy + Math.sin(r) * (wr - 4));
        g.stroke();
        g.fillStyle = C.crimson;
        g.beginPath();
        g.arc(wx + Math.cos(r) * (wr - 4), wy + Math.sin(r) * (wr - 4), 3, 0, Math.PI * 2);
        g.fill();
      }
      g.letterSpacing = '0.7px';
      txt(g, 'FRONTAL AXIS', wx - wr - 8, y0 + 11, `600 8px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      // 4. RR tachogram
      const tx0 = wx + wr + 26, tw = p.w - 8 - tx0, ty0 = y0 + 16, th = h - 30;
      g.letterSpacing = '0.7px';
      txt(g, 'HEART RATE · beat by beat', tx0, y0 + 11, `600 8px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      g.fillStyle = '#FAF8F5';
      g.fillRect(tx0, ty0, tw, th);
      const span = 30000;
      const pts = APP.table.filter((r) => r.hr && H.t - r.t < span);
      // y range with 10 % headroom above the highest rate shown; limit labels sit at the left end of their lines
      const hrMin = 30, hrMax = Math.max(170, 1.1 * Math.max(0, ...pts.map((r) => r.hr)));
      const hy2 = (hr) => ty0 + th - ((clamp(hr, hrMin, hrMax) - hrMin) / (hrMax - hrMin)) * th;
      for (const [v, col] of [[100, C.warn], [150, C.down]]) {
        g.strokeStyle = alpha(col, 0.45);
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(tx0 + 18, hy2(v));
        g.lineTo(tx0 + tw, hy2(v));
        g.stroke();
        g.setLineDash([]);
        txt(g, String(v), tx0 + 2, hy2(v) + 2.5, `7.5px ${FM}`, col);
      }
      const tX = (t) => tx0 + tw - ((H.t - t) / span) * tw;
      g.lineWidth = 1.2;
      g.strokeStyle = C.navy;
      g.beginPath();
      pts.forEach((r, i) => (i ? g.lineTo(tX(r.t), hy2(r.hr)) : g.moveTo(tX(r.t), hy2(r.hr))));
      g.stroke();
      for (const r of pts) {
        g.fillStyle = rhythmCol(r.rhythm);
        g.beginPath();
        g.arc(tX(r.t), hy2(r.hr), 2, 0, Math.PI * 2);
        g.fill();
      }
      txt(g, '−30 s', tx0 + 2, ty0 + th + 9, `7.5px ${FM}`, C.muted);
      txt(g, 'now', tx0 + tw, ty0 + th + 9, `7.5px ${FM}`, C.muted, 'right');
    }

    // ======================= MAPS =======================
    const SQ = APP.MAPSQ;
    function hist(g, x, y, w, h, bins, col, label, unit, lo, hi, mean, over) {
      g.fillStyle = '#FAF8F5';
      g.fillRect(x, y, w, h);
      const ow = over !== undefined ? 22 : 0;
      const mx = Math.max(1e-9, ...bins, over || 0);
      const bw = (w - ow) / bins.length;
      for (let i = 0; i < bins.length; i++) {
        const v = bins[i] / mx;
        g.fillStyle = col;
        g.fillRect(x + i * bw + 0.5, y + h - 12 - v * (h - 26), bw - 1, v * (h - 26));
      }
      if (over !== undefined) {
        // overflow bin, hatched and labelled
        const v = (over || 0) / mx, bx = x + w - ow + 4, bh = v * (h - 26), by = y + h - 12 - bh;
        g.save();
        g.beginPath();
        g.rect(bx, by, ow - 6, bh);
        g.clip();
        g.fillStyle = alpha(col, 0.18);
        g.fillRect(bx, by, ow - 6, bh);
        g.strokeStyle = col;
        g.lineWidth = 1;
        for (let k = -40; k < 40; k += 4) {
          g.beginPath();
          g.moveTo(bx + k, by + bh);
          g.lineTo(bx + k + bh, by);
          g.stroke();
        }
        g.restore();
        txt(g, `>${hi}`, x + w - 1, y + h - 2, `7.5px ${FM}`, C.muted, 'right');
        hi = '';
      }
      g.letterSpacing = '0.6px';
      txt(g, label, x + 3, y + 9, `600 7.5px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      if (mean !== null && mean !== undefined) txt(g, mean, x + w - 3, y + 9, `8.5px ${FM}`, C.text, 'right');
      txt(g, String(lo), x + 1, y + h - 2, `7.5px ${FM}`, C.muted);
      if (hi !== '') txt(g, `${hi} ${unit}`, x + w - 1, y + h - 2, `7.5px ${FM}`, C.muted, 'right');
      else txt(g, '0.8', x + w - ow, y + h - 2, `7.5px ${FM}`, C.muted, 'right');
    }
    function computeHists() {
      const M = APP.maps, n = 128;
      M.apdHist.fill(0);
      M.cvHist.fill(0);
      let sa = 0, na = 0, over = 0;
      const cvs = [];
      const tNow = H.t;
      for (let y = 1; y < n - 1; y++)
        for (let x = 1; x < n - 1; x++) {
          const k = y * n + x;
          if (M.flag[k] < 1.5) continue;
          const apd = M.apd[k];
          if (apd > 40 && apd < 500) {
            M.apdHist[clamp(Math.floor(((apd - 100) / 250) * 32), 0, 31)]++;
            sa += apd;
            na++;
          }
          const l = M.lat[k];
          if (l < tNow - 1200) continue;
          const lx0 = M.lat[k - 1], lx1 = M.lat[k + 1], ly0 = M.lat[k - n], ly1 = M.lat[k + n];
          if (M.flag[k - 1] < 1.5 || M.flag[k + 1] < 1.5 || M.flag[k - n] < 1.5 || M.flag[k + n] < 1.5) continue;
          if (Math.max(Math.abs(lx0 - l), Math.abs(lx1 - l), Math.abs(ly0 - l), Math.abs(ly1 - l)) > 60) continue;
          const gx = (lx1 - lx0) / 8, gy = (ly1 - ly0) / 8; // ms per cell (4-cell spacing)
          const gm = Math.hypot(gx, gy);
          if (gm < 1e-3) continue;
          const cv = 1 / gm;
          if (cv > 0.8) {
            over++;
            continue;
          }
          M.cvHist[clamp(Math.floor((cv / 0.8) * 32), 0, 31)]++;
          cvs.push(cv);
        }
      M.apdMean = na ? sa / na : null;
      cvs.sort((a, b) => a - b);
      M.cvMean = cvs.length ? cvs[cvs.length >> 1] : null;
      M.cvOver = over;
    }
    function drawMaps(now) {
      const p = P.maps, g = begin(p);
      const b = APP.lastBeat;
      card(g, p.w, p.h, 'EP MAPS', 'LAT · APD · phase', b ? `beat #${b.n} · TAT ${APP.tatLast ? nf(APP.tatLast) : '--'} ms` : '');
      const ox = L.maps.x, oy = L.maps.y;
      for (const s of SQ) g.clearRect(s.x - ox, s.y - oy, s.w, s.h);
      const labs = [['LAT', APP.latMod ? `mod CL ${nf(APP.latMod)} ms` : 'activation, ms'], ['APD', 'APD90-like, ms'], ['PHASE', 'θ = atan2(v−1, u−0.5)']];
      SQ.forEach((s, i) => {
        g.strokeStyle = C.line;
        g.strokeRect(s.x - ox - 0.5, s.y - oy - 0.5, s.w + 1, s.h + 1);
        // title strip above the map
        txt(g, labs[i][0], s.x - ox + 1, s.y - oy - 5, `700 8.5px ${FT}`, C.text);
        g.font = `700 8.5px ${FT}`;
        const tw = g.measureText(labs[i][0]).width;
        txt(g, labs[i][1], s.x - ox + tw + 6, s.y - oy - 5, `7.5px ${FM}`, C.muted);
      });
      // PS markers on the phase map
      const crop = APP.mapCrop;
      const s2 = SQ[2];
      const mx = (x) => s2.x - ox + ((x - crop.x) / crop.s) * s2.w, my = (y) => s2.y - oy + ((y - crop.y) / crop.s) * s2.h;
      for (const q of APP.ps.list) {
        if (q.seen < 2) continue;
        g.strokeStyle = q.q > 0 ? C.crimson : C.active;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(mx(q.x), my(q.y), 4.5, 0, Math.PI * 2);
        g.stroke();
      }
      if (APP.rotor.q !== 0) {
        const c = A.loop.center;
        g.strokeStyle = C.crimson;
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(mx(c.x), my(c.y), 7, 0, Math.PI * 2);
        g.stroke();
        txt(g, `q ${APP.rotor.q > 0 ? '+1' : '−1'}`, mx(c.x) + 9, my(c.y) - 6, `700 8px ${FM}`, C.crimson);
      }
      // PS badge on a white pill in the empty lower-left corner of the phase map
      {
        const lab = `PS ${APP.ps.count}`;
        g.font = `700 9px ${FM}`;
        const w = g.measureText(lab).width + 10;
        const bx = s2.x - ox + 4, by = s2.y - oy + s2.h - 18;
        g.fillStyle = '#fff';
        rr(g, bx, by, w, 14, 7);
        g.fill();
        g.strokeStyle = APP.ps.count ? C.down : C.up;
        g.lineWidth = 1;
        g.stroke();
        txt(g, lab, bx + 5, by + 10, `700 9px ${FM}`, APP.ps.count ? C.down : C.up);
      }
      // colour bars under the squares
      const cby = SQ[0].y - oy + SQ[0].h + 4;
      const bar = (s, stops, lo, hi, na) => {
        const x = s.x - ox, w = s.w - (na ? 34 : 0);
        if (na) {
          g.fillStyle = 'rgb(206,203,198)';
          g.fillRect(x + w + 6, cby, 9, 5);
          txt(g, 'n/a', x + s.w, cby + 5.5, `7.5px ${FM}`, C.muted, 'right');
        }
        const gr = g.createLinearGradient(x, 0, x + w, 0);
        stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
        g.fillStyle = gr;
        g.fillRect(x, cby, w, 5);
        txt(g, lo, x, cby + 13, `7.5px ${FM}`, C.muted);
        txt(g, hi, x + w, cby + 13, `7.5px ${FM}`, C.muted, 'right');
      };
      bar(SQ[0], [C.crimson, '#E87828', '#ECC440', '#46AA60', C.blue, C.purple], '0', `${nf(APP.latMod || APP.isoSpan)} ms`, true);
      bar(SQ[1], [C.navy, C.blue, C.teal, C.amber, '#FAECC8'], '120', '340 ms', true);
      bar(SQ[2], [C.crimson, C.amber, '#ECD678', C.teal, C.blue, C.purple, C.crimson], '−π', '+π');
      // histograms and PS count history
      const hy0 = cby + 18, hh = p.h - hy0 - 7;
      const M = APP.maps;
      hist(g, SQ[0].x - ox, hy0, SQ[0].w, hh, M.cvHist, C.blue, 'CV · cells/ms', '', 0, '0.8', M.cvMean ? `median ${M.cvMean.toFixed(3)}` : '--', M.cvOver);
      hist(g, SQ[1].x - ox, hy0, SQ[1].w, hh, M.apdHist, C.teal, 'APD · ms', '', 100, '350', M.apdMean ? `mean ${nf(M.apdMean)}` : '--');
      // PS count vs time
      const px0 = SQ[2].x - ox, pw = SQ[2].w;
      g.fillStyle = '#FAF8F5';
      g.fillRect(px0, hy0, pw, hh);
      g.letterSpacing = '0.6px';
      txt(g, 'PS COUNT · last 8 s', px0 + 3, hy0 + 9, `600 7.5px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      txt(g, `peak ${APP.ps.peak}`, px0 + pw - 3, hy0 + 9, `8.5px ${FM}`, APP.ps.peak ? C.down : C.text, 'right');
      const hs2 = APP.ps.history;
      const span = 8000, top = hy0 + 14, ch = hh - 26;
      const maxN = Math.max(3, ...hs2.map((x) => x.n));
      g.fillStyle = alpha(C.crimson, 0.18);
      g.strokeStyle = C.crimson;
      g.lineWidth = 1.1;
      const X = (t) => px0 + pw - ((H.t - t) / span) * pw;
      const Y = (n) => top + ch - (n / maxN) * ch;
      g.beginPath();
      g.moveTo(px0, Y(0));
      for (const s of hs2) if (H.t - s.t < span) g.lineTo(X(s.t), Y(s.n));
      g.lineTo(px0 + pw, Y(0));
      g.fill();
      g.beginPath();
      let st = false;
      for (const s of hs2) {
        if (H.t - s.t >= span) continue;
        st ? g.lineTo(X(s.t), Y(s.n)) : g.moveTo(X(s.t), Y(s.n));
        st = true;
      }
      g.stroke();
      g.strokeStyle = C.active;
      g.beginPath();
      st = false;
      for (const s of hs2) {
        if (H.t - s.t >= span) continue;
        st ? g.lineTo(X(s.t), Y(s.f)) : g.moveTo(X(s.t), Y(s.f));
        st = true;
      }
      g.stroke();
      txt(g, '0', px0 + 1, hy0 + hh - 2, `7.5px ${FM}`, C.muted);
      txt(g, `free (blue) + anchored`, px0 + pw - 1, hy0 + hh - 2, `7.5px ${FM}`, C.muted, 'right');
    }

    // ======================= PROBES =======================
    // bedside-monitor sweep (3 s window): traces persist, only the band ahead of the cursor is redrawn
    const PCOL = [C.teal, C.teal, C.amber, C.amber, C.navy, C.blue, C.purple];
    const PO = mkCanvas('probesOver', L.probes);
    const prCur = document.getElementById('probeCursor');
    const PR = { top: 30, x0: 78, x1: L.probes.w - 58, span: 3000, done: null };
    PR.rowH = (L.probes.h - PR.top - 8) / 7;
    prCur.style.height = PR.rowH * 7 + 'px';
    const prX = (t) => PR.x0 + ((((t % PR.span) + PR.span) % PR.span) / PR.span) * (PR.x1 - PR.x0);
    const rowBg = (i) => (i % 2 === 0 ? '#FBF9F6' : '#FFFFFF');
    function probeBand(g, x0, x1) {
      if (x1 <= x0) return;
      for (let i = 0; i < 7; i++) {
        const y = PR.top + i * PR.rowH;
        g.fillStyle = rowBg(i);
        g.fillRect(x0, y, x1 - x0, PR.rowH);
        const yTop = y + 4, yBot = y + PR.rowH - 4;
        const ym = (vm) => yBot - ((vm + 85) / 110) * (yBot - yTop);
        g.fillStyle = C.faint;
        g.fillRect(x0, Math.round(ym(0)), x1 - x0, 1);
        g.fillRect(x0, Math.round(ym(-80)), x1 - x0, 1);
      }
    }
    function probesBase() {
      const p = P.probes, g = begin(p);
      card(g, p.w, p.h, 'ACTION POTENTIALS', null, '7 sites · 3 s sweep · Vm mV · v gate · DF');
      for (let i = 0; i < 7; i++) {
        const y = PR.top + i * PR.rowH;
        g.fillStyle = rowBg(i);
        g.fillRect(4, y, p.w - 8, PR.rowH);
      }
      probeBand(g, PR.x0, PR.x1);
      PR.done = APP.probes.map((q) => Math.max(1, q.n - Math.floor(PR.span / (APP.NSUB * APP.S.dtms)) + 2));
    }
    function drawProbesSweep() {
      if (!PR.done) probesBase();
      const g = P.probes.g;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      const q0 = APP.probes[0];
      if (q0.n < 2) return;
      const tNow = q0.t[(q0.n - 1) % 512];
      const tPrev = q0.t[Math.max(0, PR.done[0] - 1) % 512];
      const gap = 10;
      const xa = prX(tPrev), xb = prX(tNow);
      if (xb >= xa) probeBand(g, xa + 0.5, Math.min(PR.x1 + 1, xb + gap));
      else {
        probeBand(g, xa + 0.5, PR.x1 + 1);
        probeBand(g, PR.x0, xb + gap);
      }
      if (xb + gap > PR.x1) probeBand(g, PR.x0, PR.x0 + (xb + gap - PR.x1));
      g.save();
      g.beginPath();
      g.rect(PR.x0, PR.top, PR.x1 - PR.x0, PR.rowH * 7);
      g.clip();
      APP.probes.forEach((q, i) => {
        const y = PR.top + i * PR.rowH;
        const yTop = y + 4, yBot = y + PR.rowH - 4;
        const ym = (vm) => yBot - ((vm + 85) / 110) * (yBot - yTop);
        const yv = (v) => yBot - (v / 2.6) * (yBot - yTop);
        const k0 = Math.max(PR.done[i], q.n - 500, 1);
        g.strokeStyle = alpha(C.purple, 0.35);
        g.lineWidth = 1;
        g.beginPath();
        for (let k = k0; k < q.n; k++) {
          const a = (k - 1) % 512, b = k % 512;
          if ((q.t[b] % PR.span) < (q.t[a] % PR.span)) continue;
          g.moveTo(prX(q.t[a]), yv(q.v[a]));
          g.lineTo(prX(q.t[b]), yv(q.v[b]));
        }
        g.stroke();
        g.strokeStyle = PCOL[i];
        g.lineWidth = 1.35;
        g.beginPath();
        for (let k = k0; k < q.n; k++) {
          const a = (k - 1) % 512, b = k % 512;
          if ((q.t[b] % PR.span) < (q.t[a] % PR.span)) continue;
          g.moveTo(prX(q.t[a]), ym(100 * q.u[a] - 80));
          g.lineTo(prX(q.t[b]), ym(100 * q.u[b] - 80));
        }
        g.stroke();
        // upstroke markers for upstrokes that happened in the new samples
        const tA = q.t[(k0 - 1) % 512];
        g.fillStyle = PCOL[i];
        for (const tu of q.ups) if (tu > tA && tu <= q.t[(q.n - 1) % 512]) g.fillRect(prX(tu) - 0.5, yTop - 3, 1.2, 5);
        PR.done[i] = q.n;
      });
      g.restore();
      prCur.style.transform = `translate(${(L.probes.x + xb).toFixed(2)}px, ${L.probes.y + PR.top}px)`;
    }
    function drawProbesOver() {
      const g = PO.g;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, PO.w, PO.h);
      APP.probes.forEach((q, i) => {
        const y = PR.top + i * PR.rowH;
        const sel = i === APP.selProbe;
        txt(g, q.name, 9, y + 12, `600 9.5px ${FT}`, sel ? C.purple : C.text);
        txt(g, `APD ${q.apd ? nf(q.apd) : '--'}`, 9, y + 23, `8.5px ${FM}`, C.muted);
        txt(g, `DI  ${q.di ? nf(q.di) : '--'}`, 9, y + 33, `8.5px ${FM}`, C.muted);
        const last = q.n ? 100 * q.u[(q.n - 1) % 512] - 80 : -80;
        txt(g, `${last >= 0 ? '+' : ''}${last.toFixed(0)}`, PO.w - 10, y + 15, `600 13px ${FB}`, last > -40 ? C.crimson : C.text, 'right');
        // dominant frequency: 1 / mean cycle length of the last upstrokes
        const ups = q.ups.slice(-5);
        const cls = ups.slice(1).map((t, j) => t - ups[j]);
        const mcl = cls.length ? cls.reduce((s, x) => s + x, 0) / cls.length : null;
        txt(g, mcl ? `${(1000 / mcl).toFixed(2)} Hz` : '-- Hz', PO.w - 10, y + 26, `8px ${FM}`, mcl && mcl < 500 ? C.down : C.muted, 'right');
        txt(g, mcl ? `CL ${nf(mcl)}` : '', PO.w - 10, y + 35, `7.5px ${FM}`, C.muted, 'right');
      });
    }
    // ======================= RESTITUTION =======================
    const BCLCOL = { 600: C.crimson, 500: C.blue, 400: C.teal, 350: C.amber };
    const RC = {};
    function drawResti() {
      const p = P.resti, g = begin(p);
      const R = APP.resti;
      card(g, p.w, p.h, 'RESTITUTION', null, `cable S1–S2 · sweep ${R.sweep + 1}`);
      const x0 = 34, x1 = p.w - 10, y0 = 34, y1 = 168;
      const diMax = 700, apdMin = 100, apdMax = 260;
      const X = (di) => x0 + (di / diMax) * (x1 - x0), Y = (apd) => y1 - ((apd - apdMin) / (apdMax - apdMin)) * (y1 - y0);
      g.fillStyle = '#FAF8F5';
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = C.faint;
      g.lineWidth = 1;
      for (let d = 0; d <= diMax; d += 100) {
        g.beginPath();
        g.moveTo(X(d), y0);
        g.lineTo(X(d), y1);
        g.stroke();
        txt(g, String(d), X(d), y1 + 9, `7.5px ${FM}`, C.muted, 'center');
      }
      for (let a = 100; a <= apdMax; a += 25) {
        g.beginPath();
        g.moveTo(x0, Y(a));
        g.lineTo(x1, Y(a));
        g.stroke();
        txt(g, String(a), x0 - 3, Y(a) + 3, `7.5px ${FM}`, C.muted, 'right');
      }
      txt(g, 'DI ms', x1, y1 + 18, `7.5px ${FM}`, C.muted, 'right');
      g.save();
      g.translate(9, (y0 + y1) / 2);
      g.rotate(-Math.PI / 2);
      txt(g, 'APD ms', 0, 0, `7.5px ${FM}`, C.muted, 'center');
      g.restore();
      // the scatter is append-only: new points are added to a cached layer
      if (!RC.c) {
        RC.c = document.createElement('canvas');
        RC.c.width = Math.round(p.w * DPR);
        RC.c.height = Math.round(p.h * DPR);
        RC.g = RC.c.getContext('2d');
        RC.g.setTransform(DPR, 0, 0, DPR, 0, 0);
        RC.n = 0;
      }
      if (R.points.length < RC.n) {
        RC.g.clearRect(0, 0, p.w, p.h);
        RC.n = 0;
      }
      for (; RC.n < R.points.length; RC.n++) {
        const pt = R.points[RC.n];
        if (pt.block) continue;
        RC.g.fillStyle = alpha(BCLCOL[pt.bcl] || C.muted, 0.7);
        RC.g.fillRect(X(pt.di) - 1.2, Y(pt.apd) - 1.2, 2.4, 2.4);
      }
      g.drawImage(RC.c, 0, 0, p.w, p.h);
      // fit
      const f = R.fit;
      let slope = null;
      if (f) {
        g.strokeStyle = C.crimson;
        g.lineWidth = 1.4;
        g.beginPath();
        for (let d = 20; d <= diMax; d += 5) {
          const a = f.A - f.B * Math.exp(-d / f.tau);
          d === 20 ? g.moveTo(X(d), Y(a)) : g.lineTo(X(d), Y(a));
        }
        g.stroke();
      }
      // live 2D probe points
      const live = R.live.filter((q) => H.t - q.t < 20000);
      for (const q of live) {
        const age = (H.t - q.t) / 20000;
        g.fillStyle = q.key === 'BZ' ? alpha(C.purple, 1 - age * 0.8) : alpha(C.navy, 1 - age * 0.8);
        const x = X(q.di), y = Y(q.apd);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        g.beginPath();
        g.moveTo(x, y - 3.5);
        g.lineTo(x + 3.5, y);
        g.lineTo(x, y + 3.5);
        g.lineTo(x - 3.5, y);
        g.fill();
      }
      const sel = APP.probes[APP.selProbe];
      if (f && sel && sel.di) {
        slope = (f.B / f.tau) * Math.exp(-sel.di / f.tau);
        R.slope = slope;
        const xd = X(clamp(sel.di, 0, diMax));
        g.strokeStyle = alpha(C.purple, 0.6);
        g.setLineDash([2, 2]);
        g.beginPath();
        g.moveTo(xd, y0);
        g.lineTo(xd, y1);
        g.stroke();
        g.setLineDash([]);
      }
      // legend and readouts
      let lx = x0 + 4;
      for (const b of [600, 500, 400, 350]) {
        g.fillStyle = BCLCOL[b];
        g.fillRect(lx, y0 + 5, 5, 5);
        txt(g, String(b), lx + 7, y0 + 10, `7.5px ${FM}`, C.text);
        lx += 32;
      }
      txt(g, `S2 ${R.s2} @ BCL ${R.bcl}`, x1 - 3, y0 + 10, `7.5px ${FM}`, C.muted, 'right');
      if (f) txt(g, `APD = ${f.A.toFixed(0)} − ${f.B.toFixed(0)}·e^(−DI/${f.tau.toFixed(0)})`, x1 - 3, y1 - 16, `8px ${FM}`, C.crimson, 'right');
      txt(g, `slope @ DI ${sel && sel.di ? nf(sel.di) : '--'} = ${slope !== null ? slope.toFixed(2) : '--'}`, x1 - 3, y1 - 5, `8.5px ${FM}`, slope !== null && slope > 1 ? C.warn : C.text, 'right');
      // phase portrait u-v of the selected probe
      const py0 = y1 + 26, py1 = p.h - 22, px0 = 34, px1 = p.w - 10;
      g.letterSpacing = '0.6px';
      txt(g, `PHASE PORTRAIT · ${sel ? sel.name : ''}`, 10, py0 - 4, `600 7.5px ${FT}`, C.muted);
      g.letterSpacing = '0px';
      g.fillStyle = '#FAF8F5';
      g.fillRect(px0, py0, px1 - px0, py1 - py0);
      const U = (u) => px0 + clamp(u / 1.05, 0, 1) * (px1 - px0), V = (v) => py1 - clamp(v / 2.6, 0, 1) * (py1 - py0);
      g.strokeStyle = C.faint;
      for (const u of [0.25, 0.5, 0.75, 1]) {
        g.beginPath();
        g.moveTo(U(u), py0);
        g.lineTo(U(u), py1);
        g.stroke();
      }
      for (const v of [0.5, 1, 1.5, 2, 2.5]) {
        g.beginPath();
        g.moveTo(px0, V(v));
        g.lineTo(px1, V(v));
        g.stroke();
        txt(g, v.toFixed(1), px0 - 3, V(v) + 3, `7px ${FM}`, C.muted, 'right');
      }
      for (const uu of [0, 0.25, 0.5, 0.75, 1]) txt(g, uu.toFixed(uu % 0.5 ? 2 : 1), U(uu), py1 + 9, `7px ${FM}`, C.muted, 'center');
      txt(g, 'u', px1, py1 + 17, `7.5px ${FM}`, C.muted, 'right');
      txt(g, 'v', px0 - 14, py0 + 6, `7.5px ${FM}`, C.muted);
      if (sel) {
        const n = Math.min(sel.n, 512);
        g.lineWidth = 1.3;
        for (let band = 0; band < 6; band++) {
          g.strokeStyle = alpha(C.purple, 0.15 + 0.85 * (band / 5));
          g.beginPath();
          for (let k = sel.n - n + 1; k < sel.n; k++) {
            const a = (k - 1) % 512, b = k % 512;
            const age = (H.t - sel.t[b]) / 3000;
            if (age > 1 || Math.min(5, Math.floor((1 - age) * 6)) !== band) continue;
            g.moveTo(U(sel.u[a]), V(sel.v[a]));
            g.lineTo(U(sel.u[b]), V(sel.v[b]));
          }
          g.stroke();
        }
        const j = (sel.n - 1) % 512;
        g.fillStyle = C.purple;
        g.beginPath();
        g.arc(U(sel.u[j]), V(sel.v[j]), 3, 0, Math.PI * 2);
        g.fill();
      }
      // (u*, v*) centre
      g.strokeStyle = C.text;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(U(0.5) - 4, V(1));
      g.lineTo(U(0.5) + 4, V(1));
      g.moveTo(U(0.5), V(1) - 4);
      g.lineTo(U(0.5), V(1) + 4);
      g.stroke();
      txt(g, '(u*, v*)', U(0.5) + 6, V(1) - 3, `7.5px ${FM}`, C.text);
    }

    // ======================= BEAT TABLE =======================
    function drawTable() {
      const p = P.table, g = begin(p);
      card(g, p.w, p.h, 'BEAT TABLE', null, 'Pan–Tompkins · lead II');
      const cols = [['#', 20, 'r'], ['RHYTHM', 52, 'l'], ['RR', 30, 'r'], ['HR', 26, 'r'], ['PR', 28, 'r'], ['QRS', 28, 'r'], ['QT', 28, 'r'], ['QTc', 30, 'r'], ['AX', 30, 'r'], ['TAT', 30, 'r']];
      let x = 8;
      const xs = cols.map(([, w]) => {
        const a = x;
        x += w;
        return a;
      });
      const hy = 37;
      cols.forEach(([lab, w, al], i) => {
        g.letterSpacing = '0.5px';
        txt(g, lab, al === 'r' ? xs[i] + w - 2 : xs[i] + 2, hy, `600 7.5px ${FT}`, C.muted, al === 'r' ? 'right' : 'left');
        g.letterSpacing = '0px';
      });
      g.fillStyle = C.faint;
      g.fillRect(8, hy + 4, p.w - 16, 1);
      const lh = 12.2;
      const sumTop = p.h - 58;
      const maxRows = Math.floor((sumTop - hy - 10) / lh);
      const rows = APP.table.slice(-maxRows);
      rows.forEach((r, k) => {
        const y = hy + 15 + k * lh;
        if (k === rows.length - 1) {
          g.fillStyle = alpha(rhythmCol(r.rhythm), 0.09);
          g.fillRect(6, y - 9, p.w - 12, lh);
        }
        const cells = [
          [String(r.n), C.muted], [r.rhythm === 'POST-SHOCK' ? 'POST' : r.rhythm, rhythmCol(r.rhythm)], [r.rr ? nf(r.rr) : '--', C.text], [r.hr ? nf(r.hr) : '--', colHR(r.hr)],
          [r.pr ? nf(r.pr) : '--', colPR(r.pr)], [qrsTxt(r), colQRS(r.qrs)], [r.qt ? nf(r.qt) : '--', C.text], [r.qtc ? nf(r.qtc) : '--', colQTc(r.qtc)],
          [sgnAx(r.axis), C.text], [r.tat ? nf(r.tat) : '--', C.text],
        ];
        cells.forEach(([s, col], i) => {
          const [, w, al] = cols[i];
          txt(g, s, al === 'r' ? xs[i] + w - 2 : xs[i] + 2, y, `${i === 1 ? '600 ' : ''}9px ${FM}`, col, al === 'r' ? 'right' : 'left');
        });
      });
      // summaries
      g.fillStyle = C.faint;
      g.fillRect(8, sumTop, p.w - 16, 1);
      const s2t = APP.proto.s2 ? APP.proto.s2.t : 1e12;
      const shT = APP.proto.shocks.length ? APP.proto.shocks[0].t0 : 1e12;
      const sinus = APP.table.filter((r) => r.rhythm === 'SINUS' && r.t < s2t);
      const post = APP.table.filter((r) => r.rhythm === 'SINUS' && r.t > shT);
      const vt = APP.table.filter((r) => r.rhythm === 'VT');
      const m = (a, f) => {
        const v = a.map(f).filter((x) => x !== null && x !== undefined && isFinite(x));
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
      };
      const line = (y, lab, col, arr) => {
        txt(g, lab, xs[0] + 2, y, `600 8.5px ${FT}`, col);
        const mrr = m(arr, (r) => r.rr);
        const allLB = arr.length && arr.every((r) => r.qrsLB);
        const vals = [nf(mrr), mrr ? nf(60000 / Math.round(mrr)) : '--', arr === vt ? '--' : nf(m(arr, (r) => r.pr)), allLB ? '>200' : nf(m(arr, (r) => r.qrs)), nf(m(arr, (r) => r.qt)), nf(m(arr, (r) => r.qtc)), sgnAx(circMean(arr.map((r) => r.axis).filter((a) => a !== null && isFinite(a)))), nf(m(arr, (r) => r.tat))];
        vals.forEach((s, i) => {
          const [, w] = cols[i + 2];
          txt(g, arr.length ? s : '--', xs[i + 2] + w - 2, y, `9px ${FM}`, col, 'right');
        });
      };
      line(sumTop + 12, `SINUS pre-S2 (${sinus.length})`, C.up, sinus);
      line(sumTop + 24, `VT (${vt.length})`, C.down, vt);
      line(sumTop + 36, `SINUS post (${post.length})`, C.up, post);
      const st = APP.proto.sinusBack;
      txt(g, 'SHOCK → SINUS', xs[0] + 2, sumTop + 50, `600 8.5px ${FT}`, C.active);
      txt(g, st !== null && st !== undefined ? `${nf(st)} ms` : APP.proto.shocks.length ? 'waiting for a P-QRS' : 'shock not yet delivered', p.w - 10, sumTop + 50, `9px ${FM}`, st !== null && st !== undefined ? C.active : C.muted, 'right');
    }

    // ======================= GL (hero field + maps) =======================
    // crop of the maps to the bounding square of the heart
    {
      let x0 = N, x1 = 0, y0 = N, y1 = 0;
      for (let i = 0; i < N * N; i++) {
        if (A.type[i] === RE.T.OUT) continue;
        const x = i % N, y = (i / N) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const s = Math.max(x1 - x0, y1 - y0) + 12;
      APP.mapCrop = { x: (x0 + x1) / 2 - s / 2, y: (y0 + y1) / 2 - s / 2, s };
    }
    function drawGL() {
      const gl = APP.S.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(244 / 255, 241 / 255, 236 / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const toLocal = (r) => ({ x: r.x - APP.GLR.x, y: r.y - APP.GLR.y, w: r.w, h: r.h });
      APP.view.hero(toLocal(APP.FIELD), DPR, { tref: APP.tref, iso: true, flash: APP.flash, isoSpan: APP.isoSpan, crop: APP.heroCrop, modCL: APP.latMod || 0, tnow: H.t });
      const crop = APP.mapCrop;
      for (let i = 0; i < 3; i++) APP.view.map(toLocal(SQ[i]), DPR, i, { tref: APP.tref, span: APP.isoSpan, tnow: H.t, crop, modCL: APP.latMod || 0 });
      // magnified scar circuit (smooth phase)
      APP.view.map(toLocal(INSET), DPR, 3, { tref: 0, span: 1, tnow: H.t, crop: INSET_CROP, modCL: 0 });
    }

    let f = 0;
    const TB = { n: -1 };
    return {
      draw(now) {
        f++;
        APP.uiLast = {};
        const T = (name, fn) => {
          if (window.__SKIP && window.__SKIP.includes(name)) return;
          const t0 = jsNow();
          fn();
          (APP.uiLast = APP.uiLast || {})[name] = Math.round(jsNow() - t0);
          const pp = (APP.uiProf = APP.uiProf || {});
          pp[name] = +((pp[name] || 0) * 0.95 + (jsNow() - t0) * 0.05).toFixed(3);
        };
        if (f === 1) {
          drawHeroStatic();
          drawHeader(now);
          drawMaps(now);
          drawResti();
          drawWork();
          drawTable();
          drawControls(now);
        }
        T('gl', drawGL);
        if (f % 2 === 0) T('hero', () => drawHero(now));
        T('ecg', () => drawECG(now));
        T('probes', drawProbesSweep);
        if (f % 6 === 1) T('probesOver', drawProbesOver);
        if (f % 4 === 0) T('header', () => drawHeader(now));
        if (f % 4 === 0) {
          T('hists', computeHists);
          T('maps', () => drawMaps(now));
        } else if (f % 4 === 2) T('resti', drawResti);
        if (APP.log.length !== LOGV.n || LOGV.off > 0) T('log', drawLog);
        if (f % 15 === 5) T('work', drawWork);
        if (APP.table.length !== TB.n || f % 30 === 7) {
          TB.n = APP.table.length;
          T('table', drawTable);
        }
        if (f % 15 === 11) T('controls', () => drawControls(now));
      },
    };
  };
})();

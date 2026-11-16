// Engine Room: the screen. Twelve canvases on the 1920 x 1080 stage, each sized by devicePixelRatio and redrawn at its
// own rhythm from requestAnimationFrame. Everything shown comes from the engine (core.js) or the kit.
'use strict';
const C = {
  bg: '#120E0B', surf: '#1B1611', bar: '#211A14', line: '#3A2F25', line2: '#2B231C', text: '#F0E6D2', mute: '#9C8C76', faint: '#6B5F50',
  gold: '#F3D27A', copper: '#C8743E', cream: '#E8D3A7', steel: '#7FA7C4', green: '#9DC07A', purple: '#B98AC9',
  up: '#86D46B', down: '#E8504A', warn: '#FF9A3C', active: '#4FD1E8', maple: '#E6CDA0', walnut: '#A8744C', ivory: '#F4EAD5', ebony: '#2A211A',
};
const FONT = {
  title: '600 11px "Bahnschrift SemiCondensed", Bahnschrift, sans-serif',
  bahn: (px, w = 600) => `${w} ${px}px "Bahnschrift SemiCondensed", Bahnschrift, sans-serif`,
  bahnW: (px, w = 600) => `${w} ${px}px Bahnschrift, sans-serif`,
  mono: (px) => `${px}px "Cascadia Mono", Consolas, monospace`,
  ui: (px) => `${px}px "Segoe UI Variable Small", "Segoe UI", sans-serif`,
};
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
function fmtInt(n) {
  n = Math.round(n);
  const s = String(Math.abs(n));
  let out = '';
  for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) out += ','; out += s[i]; }
  return (n < 0 ? '−' : '') + out;
}
function fmtCp(v) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  if (Math.abs(v) >= E.MATE_BOUND) { const n = Math.ceil((E.MATE - Math.abs(v)) / 2); return (v > 0 ? '#' : '#−') + n; }
  return (v > 0 ? '+' : v < 0 ? '−' : '') + (Math.abs(v) / 100).toFixed(2);
}
const wp = (cp) => 1 / (1 + Math.pow(10, -clamp(cp, -3000, 3000) / 400));
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------------------------------------------
// panels
const stage = document.getElementById('stage');
const PANELS = {};
const DPR = Math.max(1, window.devicePixelRatio || 1);
function makePanel(name, x, y, w, h, every, phase, draw) {
  const cv = document.createElement('canvas');
  cv.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  cv.width = Math.round(w * DPR); cv.height = Math.round(h * DPR);
  stage.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const P = { name, x, y, w, h, cv, ctx, every, phase, draw, f: '' };
  PANELS[name] = P;
  return P;
}
// text helpers with a font cache per context
function font(c, f) { if (c._f !== f) { c.font = f; c._f = f; } }
function tx(c, s, x, y, f, col, al = 'left') {
  font(c, f);
  if (c.textAlign !== al) c.textAlign = al;
  c.fillStyle = col;
  c.fillText(s, x, y);
}
function tw(c, s, f) { font(c, f); return c.measureText(s).width; }
function frame(P, title, right, accent = C.gold) {
  const c = P.ctx;
  c.fillStyle = C.surf;
  c.fillRect(0, 0, P.w, P.h);
  c.fillStyle = C.bar;
  c.fillRect(0, 0, P.w, 20);
  c.fillStyle = accent;
  c.fillRect(8, 7, 3, 7);
  c.letterSpacing = '1.2px';
  tx(c, title, 16, 14, FONT.title, C.cream);
  c.letterSpacing = '0px';
  if (right) tx(c, right, P.w - 8, 14, FONT.mono(9), C.mute, 'right');
  c.strokeStyle = C.line;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, 20.5); c.lineTo(P.w, 20.5);
  c.stroke();
  c.strokeRect(0.5, 0.5, P.w - 1, P.h - 1);
}
function hline(c, x0, x1, y, col = C.line2) { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, Math.round(y) + 0.5); c.lineTo(x1, Math.round(y) + 0.5); c.stroke(); }
function vline(c, x, y0, y1, col = C.line2) { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(x) + 0.5, y0); c.lineTo(Math.round(x) + 0.5, y1); c.stroke(); }
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function check(c, x, y, s, col) {
  c.strokeStyle = col; c.lineWidth = 1.6; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(x, y + s * 0.55); c.lineTo(x + s * 0.38, y + s * 0.9); c.lineTo(x + s, y + s * 0.1); c.stroke();
  c.lineCap = 'butt';
}
const scoreCol = (v) => (v > 15 ? C.up : v < -15 ? C.down : C.cream);
const TYPE_COL = [C.gold, C.copper, C.steel];
const JOB_COL = { pv: C.gold, scout: C.steel, research: C.warn, exact: C.cream, abort: '#5A4F44', quick: C.purple, perft: C.green, id: C.gold };
const VERDICT = {
  '!!': { col: C.active, name: 'brilliant' }, '!': { col: C.up, name: 'only move' }, '?!': { col: C.gold, name: 'inaccuracy' },
  '?': { col: C.warn, name: 'mistake' }, '??': { col: C.down, name: 'blunder' },
};
const T_ = () => S.think;
const nowS = () => S.now;

// per-ply caches for the board panel
const plyCache = new Map();
function plyInfo(ply) {
  let v = plyCache.get(ply);
  if (v) return v;
  const e = at(ply);
  v = { att: e.attackMap(), ev: e.evalBreakdown(), side: e.side, check: e.inCheck() };
  plyCache.set(ply, v);
  return v;
}

// ===================================================================================================
// TOP BAR
function drawTop(P) {
  const c = P.ctx, T = T_();
  c.fillStyle = C.surf; c.fillRect(0, 0, P.w, P.h);
  c.strokeStyle = C.line; c.strokeRect(0.5, 0.5, P.w - 1, P.h - 1);
  c.letterSpacing = '1.6px';
  tx(c, 'CLAUDE STUDIO', 12, 20, FONT.bahnW(10, 600), C.mute);
  let x = 12 + tw(c, 'CLAUDE STUDIO', FONT.bahnW(10, 600)) + 6;
  tx(c, '· 001', x, 20, FONT.bahnW(10, 600), C.gold);
  x += tw(c, '· 001', FONT.bahnW(10, 600)) + 18;
  c.letterSpacing = '2.4px';
  tx(c, 'ENGINE ROOM', x, 22, FONT.bahn(18, 700), C.text);
  x += tw(c, 'ENGINE ROOM', FONT.bahn(18, 700)) + 14;
  c.letterSpacing = '0px';
  vline(c, x, 8, 24, C.line);
  x += 14;
  tx(c, 'The Game of the Century', x, 20.5, FONT.bahn(13, 400), C.cream);
  x += tw(c, 'The Game of the Century', FONT.bahn(13, 400)) + 12;
  tx(c, 'D. Byrne – R. Fischer · New York 1956 · 0–1', x, 20.5, FONT.ui(11), C.mute);
  // chips, right to left
  const chips = [];
  const clock = new Date();
  const hh = String(clock.getHours()).padStart(2, '0'), mm = String(clock.getMinutes()).padStart(2, '0'), ss = String(clock.getSeconds()).padStart(2, '0');
  chips.push({ l: 'LOCAL', v: `${hh}:${mm}:${ss}`, col: C.cream });
  chips.push({ l: 'PERFT', v: S.perftOK === null ? 'running' : S.perftOK ? '3/3' : 'FAIL', col: S.perftOK === false ? C.down : C.up, ok: S.perftOK });
  chips.push({ l: 'WORKERS', v: `${nThreads()} / ${STUDIO.system.threads || 16} threads`, col: C.text });
  chips.push({ l: 'NPS', v: '', parts: [[fmtCount(S.nps), C.active], [' deep ' + fmtCount(S.npsDeep), C.cream], [' bg ' + fmtCount(S.npsBg), C.purple]] });
  chips.push({ l: 'NODES', v: fmtCount(S.nodes), col: C.text });
  const depth = T ? T.completed : 0, sel = T ? T.sel : 0;
  chips.push({ l: 'DEPTH', v: `${depth} \u2192 ${T && T.phase === 'split' ? T.depth : depth} \u00b7 sel ${sel}`, col: C.gold });
  const el = T ? Math.min(OPT.movetime, S.now - T.start) : 0;
  chips.push({ l: 'THINK', v: `${(el / 1000).toFixed(1)}/${(T ? T.opt.movetime / 1000 : 7).toFixed(1)} s`, col: C.text, prog: T ? el / T.opt.movetime : 0 });
  const side = T ? T.side : 0;
  chips.push({ l: 'TO MOVE', v: side ? 'Black' : 'White', col: C.text, disc: side });
  chips.push({ l: 'PLY', v: `${T ? T.ply : 0}/82`, col: C.text });
  let rx = P.w - 8;
  for (const ch of chips) {
    c.letterSpacing = '0.6px';
    const lw = tw(c, ch.l, FONT.ui(8.5));
    c.letterSpacing = '0px';
    const vw = ch.parts ? ch.parts.reduce((s2, [t, , f2]) => s2 + tw(c, t, f2 || (t === ch.parts[0][0] ? FONT.mono(11) : FONT.mono(9))), 0) : tw(c, ch.v, FONT.mono(11));
    const extra = (ch.disc !== undefined ? 12 : 0) + (ch.ok ? 12 : 0);
    const w = Math.ceil(lw + vw + extra + 18);
    const x0 = rx - w;
    c.fillStyle = '#171310';
    rrect(c, x0 + 0.5, 5.5, w - 1, 21, 3);
    c.fill();
    c.strokeStyle = C.line; c.stroke();
    c.letterSpacing = '0.6px';
    tx(c, ch.l, x0 + 7, 19.5, FONT.ui(8.5), C.mute);
    c.letterSpacing = '0px';
    let vx = x0 + 7 + lw + 5;
    if (ch.disc !== undefined) {
      c.beginPath(); c.arc(vx + 4, 16, 4, 0, TAU);
      c.fillStyle = ch.disc ? C.ebony : C.ivory; c.fill(); c.strokeStyle = C.mute; c.stroke();
      vx += 12;
    }
    if (ch.ok) { check(c, vx, 11, 8, C.up); vx += 12; }
    if (ch.parts) {
      ch.parts.forEach(([t, col2], k) => { const f2 = k === 0 ? FONT.mono(11) : FONT.mono(9); tx(c, t, vx, 20, f2, col2); vx += tw(c, t, f2); });
    } else tx(c, ch.v, vx, 20, FONT.mono(11), ch.col);
    if (ch.prog !== undefined) {
      c.fillStyle = C.line; c.fillRect(x0 + 7, 23, w - 14, 1.5);
      c.fillStyle = C.gold; c.fillRect(x0 + 7, 23, (w - 14) * clamp(ch.prog, 0, 1), 1.5);
    }
    rx = x0 - 6;
  }
}

// ===================================================================================================
// BOARD
const BOARD = { x: 36, y: 26, sq: 64 };
let boardTex = null;
function makeBoardTexture() {
  const s = BOARD.sq * 8;
  const cv = document.createElement('canvas');
  cv.width = Math.round(s * DPR); cv.height = Math.round(s * DPR);
  const c = cv.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rnd = STUDIO.rng(1956);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const light = (r + f) % 2 === 1;
    const x = f * BOARD.sq, y = (7 - r) * BOARD.sq;
    c.fillStyle = light ? C.maple : C.walnut;
    c.fillRect(x, y, BOARD.sq, BOARD.sq);
    // wood grain: soft wavy lines along the square
    c.save();
    c.beginPath(); c.rect(x, y, BOARD.sq, BOARD.sq); c.clip();
    const vertical = (r + f) % 2 === 0;
    for (let k = 0; k < 9; k++) {
      const o = rnd() * BOARD.sq, amp = 1 + rnd() * 2.5, ph = rnd() * 6;
      c.strokeStyle = light ? `rgba(160,120,70,${0.06 + rnd() * 0.07})` : `rgba(60,35,18,${0.08 + rnd() * 0.1})`;
      c.lineWidth = 0.6 + rnd() * 1.2;
      c.beginPath();
      for (let t = 0; t <= BOARD.sq; t += 4) {
        const a = o + Math.sin(t / 9 + ph) * amp;
        if (vertical) { if (t === 0) c.moveTo(x + a, y + t); else c.lineTo(x + a, y + t); }
        else { if (t === 0) c.moveTo(x + t, y + a); else c.lineTo(x + t, y + a); }
      }
      c.stroke();
    }
    c.restore();
  }
  // coordinates in the corner squares
  for (let f = 0; f < 8; f++) {
    const light = f % 2 === 1;
    tx(c, 'abcdefgh'[f], f * BOARD.sq + BOARD.sq - 4, s - 4, FONT.bahn(10, 600), light ? C.walnut : C.maple, 'right');
  }
  for (let r = 0; r < 8; r++) {
    const light = r % 2 === 1;
    tx(c, String(r + 1), 3, (7 - r) * BOARD.sq + 11, FONT.bahn(10, 600), light ? C.walnut : C.maple, 'left');
  }
  return cv;
}
const sqXY = (sq) => [BOARD.x + (sq & 7) * BOARD.sq, BOARD.y + (7 - (sq >> 4)) * BOARD.sq];
function arrow(c, from, to, col, alpha, width, dashed, num) {
  const [fx, fy] = sqXY(from), [tx2, ty2] = sqXY(to);
  const h = BOARD.sq / 2;
  const x0 = fx + h, y0 = fy + h, x1 = tx2 + h, y1 = ty2 + h;
  const df = Math.abs((to & 7) - (from & 7)), dr = Math.abs((to >> 4) - (from >> 4));
  const knight = (df === 1 && dr === 2) || (df === 2 && dr === 1);
  const pts = knight ? (dr === 2 ? [[x0, y0], [x0, y1], [x1, y1]] : [[x0, y0], [x1, y0], [x1, y1]]) : [[x0, y0], [x1, y1]];
  const [ax, ay] = pts[pts.length - 2];
  const ang = Math.atan2(y1 - ay, x1 - ax);
  const head = 15;
  const ex = x1 - Math.cos(ang) * (head - 2), ey = y1 - Math.sin(ang) * (head - 2);
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = col; c.fillStyle = col;
  c.lineWidth = width; c.lineCap = dashed ? 'butt' : 'round'; c.lineJoin = 'round';
  if (dashed) c.setLineDash([7, 5]);
  c.beginPath();
  c.moveTo(pts[0][0] + Math.cos(Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])) * 10, pts[0][1] + Math.sin(Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0])) * 10);
  for (let i = 1; i < pts.length - 1; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.lineTo(ex, ey);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x1 - Math.cos(ang - 0.42) * head, y1 - Math.sin(ang - 0.42) * head);
  c.lineTo(x1 - Math.cos(ang + 0.42) * head, y1 - Math.sin(ang + 0.42) * head);
  c.closePath();
  c.fill();
  if (num) {
    c.beginPath(); c.arc(x0, y0, 7.5, 0, TAU);
    c.fillStyle = '#1B1611'; c.fill();
    c.lineWidth = 1.2; c.stroke();
    c.globalAlpha = Math.min(1, alpha + 0.25);
    tx(c, String(num), x0, y0 + 3.5, FONT.mono(10), col, 'center');
  }
  c.restore();
}
const evalBar = { wp: 0.5 };
function drawBoard(P) {
  const c = P.ctx, T = T_();
  const ply = T ? T.ply : 0;
  frame(P, 'POSITION', T ? `${ply ? 'after ' + moveLabel(ply - 1) + G.sans[ply - 1] : 'start'} · ${T.side ? 'Black' : 'White'} to move` : '', C.cream);
  if (!boardTex) boardTex = makeBoardTexture();
  const B = BOARD, s = B.sq * 8;
  c.drawImage(boardTex, B.x, B.y, s, s);
  c.strokeStyle = '#0B0806'; c.lineWidth = 2; c.strokeRect(B.x - 1, B.y - 1, s + 2, s + 2);
  // last move tint
  const anim = S.anim && S.now - S.anim.t0 < S.anim.dur ? S.anim : null;
  const showPly = anim ? anim.from : ply;
  if (showPly > 0) {
    const m = G.moves[showPly - 1];
    for (const q of [m & 127, (m >> 7) & 127]) { const [x, y] = sqXY(q); c.fillStyle = 'rgba(243,210,122,0.33)'; c.fillRect(x, y, B.sq, B.sq); }
  }
  const info = plyInfo(showPly);
  // overlay: attack balance or search heat
  if (OPT.overlay === 2) {
    const h = new Float32Array(64);
    let mx = 1;
    for (let f = 0; f < 64; f++) for (let t = 0; t < 64; t++) { h[t] += S.hist[f * 64 + t]; }
    for (let t = 0; t < 64; t++) mx = Math.max(mx, h[t]);
    for (let t = 0; t < 64; t++) {
      const v = Math.log1p(h[t]) / Math.log1p(mx);
      const sq = ((t >> 3) << 4) | (t & 7);
      const [x, y] = sqXY(sq);
      c.fillStyle = `rgba(200,116,62,${(v * 0.45).toFixed(3)})`;
      c.fillRect(x, y, B.sq, B.sq);
    }
  }
  const board = G.boards[showPly];
  // king in check glow
  if (info.check) {
    for (let q = 0; q < 128; q++) if (!(q & 0x88) && board[q] === (6 | (info.side << 3))) {
      const [x, y] = sqXY(q);
      const g = c.createRadialGradient(x + 32, y + 32, 4, x + 32, y + 32, 40);
      g.addColorStop(0, 'rgba(232,80,74,0.75)'); g.addColorStop(1, 'rgba(232,80,74,0)');
      c.fillStyle = g; c.fillRect(x, y, B.sq, B.sq);
    }
  }
  // pieces
  let movingFrom = -1, movingTo = -1, ap = 0;
  if (anim) { const m = G.moves[anim.from]; movingFrom = m & 127; movingTo = (m >> 7) & 127; ap = clamp((S.now - anim.t0) / anim.dur, 0, 1); ap = ap * ap * (3 - 2 * ap); }
  for (let q = 0; q < 128; q++) {
    if (q & 0x88) continue;
    const p = board[q];
    if (!p || q === movingFrom) continue;
    const [x, y] = sqXY(q);
    PIECES.draw(c, p, x + 4, y + 3, 56, q === movingTo ? 1 - ap : 1);
  }
  if (anim) {
    const [x0, y0] = sqXY(movingFrom), [x1, y1] = sqXY(movingTo);
    PIECES.draw(c, board[movingFrom], lerp(x0, x1, ap) + 4, lerp(y0, y1, ap) + 3, 56, 1);
  }
  // attack balance digits
  if (OPT.overlay === 1) {
    for (let i = 0; i < 64; i++) {
      const d = info.att.w[i] - info.att.b[i];
      if (!d) continue;
      const sq = ((i >> 3) << 4) | (i & 7);
      const [x, y] = sqXY(sq);
      const s2 = (d > 0 ? '+' : '−') + Math.abs(d);
      c.fillStyle = 'rgba(18,14,11,0.62)';
      c.fillRect(x + B.sq - 17, y + 2, 15, 10);
      tx(c, s2, x + B.sq - 3.5, y + 10, FONT.mono(8.5), d > 0 ? C.up : C.down, 'right');
    }
  }
  // arrows: the move played in the game (dashed ivory) and the engine's PV (numbered, fading)
  if (T && !anim) {
    const pv = T.best ? T.pv : [];
    const played = G.moves[ply];
    if (played) arrow(c, played & 127, (played >> 7) & 127, C.ivory, 0.85, 3, true, 0);
    const pulse = 0.85 + 0.15 * Math.sin(S.now / 300);
    for (let i = Math.min(4, pv.length) - 1; i >= 0; i--) {
      const m = pv[i];
      arrow(c, m & 127, (m >> 7) & 127, C.gold, [0.92 * pulse, 0.62, 0.42, 0.28][i], [6, 5, 4.5, 4][i], false, i + 1);
    }
  }
  // eval bar (White's win probability)
  const cpW = T && T.best ? (T.side ? -T.bestScore : T.bestScore) : whiteCp(ply) || 0;
  evalBar.wp = lerp(evalBar.wp, wp(cpW), 0.08);
  const ex = 12, ew = 16, ey = B.y, eh = s;
  c.fillStyle = C.ebony; c.fillRect(ex, ey, ew, eh);
  const split = ey + eh * (1 - evalBar.wp);
  const g = c.createLinearGradient(ex, 0, ex + ew, 0);
  g.addColorStop(0, '#FFF8E8'); g.addColorStop(1, '#D8C39E');
  c.fillStyle = g; c.fillRect(ex, split, ew, ey + eh - split);
  for (const pw of [100, 300, 1000]) for (const sg of [1, -1]) { const yy = ey + eh * (1 - wp(sg * pw)); hline(c, ex, ex + 4, yy, '#7A6A58'); }
  hline(c, ex, ex + ew, ey + eh / 2, C.copper);
  c.strokeStyle = C.line; c.strokeRect(ex - 0.5, ey - 0.5, ew + 1, eh + 1);
  const lab = fmtCp(cpW).replace('#', 'M');
  c.save();
  c.translate(ex + ew / 2, cpW >= 0 ? ey + eh - 6 : ey + 6);
  c.rotate(-Math.PI / 2);
  tx(c, lab, 0, 3, FONT.mono(9), cpW >= 0 ? C.ebony : C.ivory, cpW >= 0 ? 'left' : 'right');
  c.restore();
  // line 1: PV in SAN
  const yl1 = 556, yl2 = 576, yl3 = 594;
  tx(c, 'PV', 12, yl1, FONT.bahn(10, 700), C.mute);
  if (T && T.pvSan && T.pvSan.length) {
    let x = 36;
    let n = ply;
    for (let i = 0; i < T.pvSan.length && x < 520; i++, n++) {
      const pre = n % 2 === 0 ? moveNo(n) + '.' : i === 0 ? moveNo(n) + '…' : '';
      const s2 = pre + T.pvSan[i];
      const col = i === 0 ? C.gold : i < 4 ? C.cream : C.mute;
      if (x + tw(c, s2, FONT.mono(10)) > 482) break;
      tx(c, s2, x, yl1, FONT.mono(10), col);
      x += tw(c, s2, FONT.mono(10)) + 6;
    }
    tx(c, `d${T.completed}  ${fmtCp(T.bestScore)}`, 548, yl1, FONT.mono(9), C.mute, 'right');
  }
  // line 2: static eval breakdown (White-relative)
  const ev = info.ev;
  tx(c, 'STATIC', 12, yl2, FONT.bahn(10, 700), C.mute);
  let x = 56;
  const items = [['mat', ev.material], ['pst mg', ev.pstMg], ['eg', ev.pstEg], ['phase', null], ['pair', ev.pair], ['tempo', ev.tempo], ['tapered', ev.total]];
  for (const [k, v] of items) {
    tx(c, k, x, yl2, FONT.ui(9.5), C.faint);
    x += tw(c, k, FONT.ui(9.5)) + 4;
    const s2 = v === null ? `${ev.phase}/24` : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
    tx(c, s2, x, yl2, FONT.mono(10), v === null ? C.cream : k === 'tapered' ? scoreCol(v) : C.cream);
    x += tw(c, s2, FONT.mono(10)) + 9;
  }
  tx(c, 'white pov', 548, yl2, FONT.ui(8.5), C.faint, 'right');
  // line 3: captured pieces and material
  const cnt = new Int8Array(16);
  for (let q = 0; q < 128; q++) if (!(q & 0x88) && board[q]) cnt[board[q]]++;
  const init = [0, 8, 2, 2, 2, 1, 1];
  tx(c, 'TAKEN', 12, yl3, FONT.bahn(10, 700), C.mute);
  let cx = 56;
  let matW = 0, matB = 0;
  const val = [0, 1, 3, 3, 5, 9, 0];
  for (const side of [0, 1]) {
    for (let t = 5; t >= 1; t--) {
      const lost = Math.max(0, init[t] - cnt[t | (side << 3)]);
      if (side === 0) matB += lost * val[t]; else matW += lost * val[t];
      for (let k = 0; k < lost; k++) { PIECES.draw(c, t | (side << 3), cx, yl3 - 12, 15, 1); cx += 9; }
    }
    cx += 14;
  }
  const diff = matW - matB;
  tx(c, diff ? `material ${diff > 0 ? 'White' : 'Black'} +${Math.abs(diff)}` : 'material level', 548, yl3, FONT.mono(9.5), diff ? C.cream : C.mute, 'right');
}

// ===================================================================================================
// UCI OPTIONS (interactive canvas controls)
const CTRL = [
  { k: 'threads', name: 'Threads', kind: 'spin', min: 1, max: 15, step: 1, fmt: (v) => '' },
  { k: 'hash', name: 'Hash', kind: 'slider', min: 4, max: 128, step: 4, fmt: (v) => v + ' MB', log: true },
  { k: 'movetime', name: 'MoveTime', kind: 'slider', min: 1000, max: 20000, step: 500, fmt: (v) => (v / 1000).toFixed(1) + ' s' },
  { k: 'aspDelta', name: 'Aspiration δ', kind: 'slider', min: 10, max: 200, step: 5, fmt: (v) => v + ' cp' },
  { k: 'nullBase', name: 'Null-move R', kind: 'knob', min: 2, max: 4, step: 1, fmt: (v) => v + '+d/6' },
  { k: 'lmrDiv', name: 'LMR divisor', kind: 'slidertoggle', min: 1.5, max: 3.5, step: 0.05, tk: 'lmrOn', fmt: (v) => v.toFixed(2) },
  { k: 'futMargin', name: 'Futility margin', kind: 'slider', min: 0, max: 300, step: 10, fmt: (v) => v + ' cp' },
  { k: 'checkExt', name: 'Check extension', kind: 'toggle', fmt: (v) => (v ? 'on' : 'off') },
  { k: 'seePrune', name: 'QSearch SEE prune', kind: 'toggle', fmt: (v) => (v ? 'on' : 'off') },
  { k: 'multipv', name: 'MultiPV', kind: 'spin', min: 1, max: 5, step: 1, fmt: (v) => '1–5' },
  { k: 'quickDepth', name: 'Quick-pass depth', kind: 'spin', min: 4, max: 10, step: 1, fmt: (v) => '4–10' },
  { k: 'overlay', name: 'Board overlay', kind: 'select', opts: ['none', 'attack balance', 'search heat'], fmt: (v) => ['none', 'attack balance', 'search heat'][v] },
  { k: 'treePlies', name: 'Tree plies', kind: 'spin', min: 2, max: 5, step: 1, fmt: (v) => '2–5' },
];
const OPTL = { x0: 10, colW: 182, y0: 26, rowH: 16.4, lab: 86, wid: 50 };
function ctrlRect(i) {
  const col = Math.floor(i / 5), row = i % 5;
  return { x: OPTL.x0 + col * OPTL.colW, y: OPTL.y0 + row * OPTL.rowH, w: OPTL.colW - 8, h: OPTL.rowH };
}
function drawOptions(P) {
  const c = P.ctx, T = T_();
  frame(P, 'UCI OPTIONS', 'setoption · applied from the next think', C.steel);
  for (let i = 0; i < CTRL.length; i++) {
    const k = CTRL[i], r = ctrlRect(i), v = OPT[k.k];
    const cy = r.y + r.h / 2;
    tx(c, k.name, r.x, cy + 3.5, FONT.ui(9), C.mute);
    const wx = r.x + OPTL.lab, ww = OPTL.wid;
    const pending = T && T.opt[k.k] !== v;
    if (k.kind === 'slider' || k.kind === 'slidertoggle') {
      const sw = k.kind === 'slidertoggle' ? ww - 20 : ww;
      const f = k.log ? Math.log(v / k.min) / Math.log(k.max / k.min) : (v - k.min) / (k.max - k.min);
      c.fillStyle = C.line; c.fillRect(wx, cy - 1, sw, 2);
      c.fillStyle = hexA(C.gold, 0.85); c.fillRect(wx, cy - 1, sw * f, 2);
      // live ghost: think clock on MoveTime, hashfull on Hash, current window on Aspiration
      if (k.k === 'movetime' && T) { const g = clamp((S.now - T.start) / k.max, 0, 1); c.fillStyle = C.active; c.fillRect(wx + sw * g - 0.5, cy - 4, 1.5, 8); }
      if (k.k === 'hash') { const hf = avgHashfull() / 1000; c.fillStyle = hexA(C.copper, 0.9); c.fillRect(wx, cy + 2.5, sw * f * hf, 1.5); }
      if (k.k === 'aspDelta' && T && T.asp) { const d2 = clamp(T.asp.delta, k.min, k.max * 2); const g = clamp((d2 - k.min) / (k.max - k.min), 0, 1); c.fillStyle = T.asp.fails ? C.warn : C.active; c.fillRect(wx + sw * g - 0.5, cy - 4, 1.5, 8); }
      c.fillStyle = C.cream; rrect(c, wx + sw * f - 2.5, cy - 5, 5, 10, 1.5); c.fill();
      if (k.kind === 'slidertoggle') drawToggle(c, wx + sw + 4, cy - 4.5, OPT[k.tk]);
    } else if (k.kind === 'toggle') {
      drawToggle(c, wx, cy - 4.5, v);
      const live = k.k === 'checkExt' ? S.st.checkExt : S.st.seePruned;
      tx(c, fmtCount(live), wx + 24, cy + 3.5, FONT.mono(8.5), C.faint);
    } else if (k.kind === 'spin') {
      c.strokeStyle = C.line; rrect(c, wx + 0.5, cy - 6.5, ww - 1, 13, 2); c.stroke();
      tx(c, '‹', wx + 5, cy + 3.5, FONT.mono(10), C.mute, 'center');
      tx(c, '›', wx + ww - 5, cy + 3.5, FONT.mono(10), C.mute, 'center');
      tx(c, String(v), wx + ww / 2, cy + 3.5, FONT.mono(10), C.text, 'center');
      if (k.k === 'threads') {
        // one LED per worker, brightness = its share of the last chunk budget
        for (let w = 0; w < 15; w++) {
          const on = w < OPT.threads && W[w];
          c.fillStyle = on ? hexA(W[w].col, clamp(W[w].used / BUDGET, 0.2, 1)) : '#2A221B';
          c.fillRect(wx + ww + 4 + (w % 8) * 3.4, cy - 4 + Math.floor(w / 8) * 4.5, 2.4, 3);
        }
      }
    } else if (k.kind === 'knob') {
      const kx = wx + 9, f = (v - k.min) / (k.max - k.min);
      c.beginPath(); c.arc(kx, cy, 6.5, 0.75 * Math.PI, 2.25 * Math.PI); c.strokeStyle = C.line; c.lineWidth = 2; c.stroke();
      c.beginPath(); c.arc(kx, cy, 6.5, 0.75 * Math.PI, (0.75 + 1.5 * f) * Math.PI); c.strokeStyle = C.gold; c.stroke();
      c.lineWidth = 1;
      c.beginPath(); c.arc(kx, cy, 4, 0, TAU); c.fillStyle = '#2A221B'; c.fill();
      const a = (0.75 + 1.5 * f) * Math.PI;
      c.beginPath(); c.moveTo(kx, cy); c.lineTo(kx + Math.cos(a) * 4.5, cy + Math.sin(a) * 4.5); c.strokeStyle = C.cream; c.lineWidth = 1.4; c.stroke(); c.lineWidth = 1;
      const nc = S.st.nullTried ? (100 * S.st.nullCuts / S.st.nullTried).toFixed(0) + '%' : '';
      tx(c, nc, wx + 20, cy + 3.5, FONT.mono(8.5), C.faint);
    } else if (k.kind === 'select') {
      const sw2 = r.x + r.w - wx;
      c.strokeStyle = C.line; rrect(c, wx + 0.5, cy - 6.5, sw2 - 1, 13, 2); c.stroke();
      tx(c, k.fmt(v), wx + 5, cy + 3.5, FONT.ui(9.5), C.text);
      c.fillStyle = C.mute; c.beginPath(); c.moveTo(wx + sw2 - 11, cy - 1.5); c.lineTo(wx + sw2 - 5, cy - 1.5); c.lineTo(wx + sw2 - 8, cy + 2.5); c.fill();
    }
    if (k.kind !== 'select') tx(c, k.fmt(v), r.x + r.w, cy + 3.5, FONT.mono(9), pending ? C.warn : k.kind === 'spin' ? C.faint : C.cream, 'right');
  }
  // perft strip
  const y = 112;
  hline(c, 8, P.w - 8, y - 6, C.line2);
  tx(c, 'PERFT', 10, y + 8, FONT.bahn(10, 700), C.mute);
  // each cell: name, depth, count, a fixed slot for the check mark, then time and rate right-aligned at the cell end
  const cells = [[48, 200], [206, 384], [390, 552]];
  S.perft.forEach((p, i) => {
    const x0 = cells[i][0], x1 = cells[i][1];
    let x = x0;
    const done = p.ok !== null;
    tx(c, p.name, x, y + 8, FONT.ui(8.5), C.mute);
    x += tw(c, p.name, FONT.ui(8.5)) + 3;
    tx(c, 'd' + p.depth, x, y + 8, FONT.mono(8.5), C.faint);
    x += tw(c, 'd' + p.depth, FONT.mono(8.5)) + 3;
    const cnt = fmtInt(done ? p.final || p.got.at(-1) || 0 : p.got.at(-1) || 0);
    tx(c, cnt, x, y + 8, FONT.mono(8.5), done ? C.text : C.mute);
    x += tw(c, cnt, FONT.mono(8.5)) + 3;
    if (p.ok) check(c, x, y + 0.5, 7, C.up);
    else if (p.ok === false) tx(c, '✗', x, y + 8, FONT.mono(9), C.down);
    x += 11;
    const rate = p.ms ? (p.makes / p.ms / 1000).toFixed(1) + 'M/s' : '';
    const time = p.ms ? Math.round(p.ms) + 'ms' : '';
    const f = FONT.mono(7.5);
    const rw = tw(c, rate, f), tw2 = tw(c, time, f);
    tx(c, rate, x1, y + 8, f, C.faint, 'right');
    tx(c, time, x1 - rw - 4, y + 8, f, C.faint, 'right');
    if (i < 2) vline(c, x1 + 3, y - 1, y + 10, C.line2);
  });
}
function drawToggle(c, x, y, on) {
  rrect(c, x + 0.5, y + 0.5, 17, 9, 4.5);
  c.fillStyle = on ? hexA(C.gold, 0.85) : '#2A221B'; c.fill();
  c.strokeStyle = on ? C.gold : C.line; c.stroke();
  c.beginPath(); c.arc(on ? x + 13 : x + 5, y + 5, 3.3, 0, TAU); c.fillStyle = on ? C.ebony : C.mute; c.fill();
}
function optionsInput(P) {
  let drag = null;
  const local = (ev) => {
    const r = P.cv.getBoundingClientRect();
    return [(ev.clientX - r.left) * (P.w / r.width), (ev.clientY - r.top) * (P.h / r.height)];
  };
  const setFrom = (i, x) => {
    const k = CTRL[i], r = ctrlRect(i);
    const wx = r.x + OPTL.lab, sw = k.kind === 'slidertoggle' ? OPTL.wid - 20 : OPTL.wid;
    let f = clamp((x - wx) / sw, 0, 1);
    let v = k.log ? k.min * Math.pow(k.max / k.min, f) : k.min + f * (k.max - k.min);
    v = Math.round(v / k.step) * k.step;
    OPT[k.k] = +clamp(v, k.min, k.max).toFixed(2);
  };
  P.cv.addEventListener('pointerdown', (ev) => {
    const [x, y] = local(ev);
    for (let i = 0; i < CTRL.length; i++) {
      const k = CTRL[i], r = ctrlRect(i);
      if (y < r.y || y > r.y + r.h || x < r.x || x > r.x + r.w) continue;
      const wx = r.x + OPTL.lab;
      if (k.kind === 'slider' || (k.kind === 'slidertoggle' && x < wx + OPTL.wid - 20)) { drag = i; setFrom(i, x); }
      else if (k.kind === 'slidertoggle') OPT[k.tk] = !OPT[k.tk];
      else if (k.kind === 'toggle') OPT[k.k] = !OPT[k.k];
      else if (k.kind === 'spin') { const d = x < wx + OPTL.wid / 2 ? -1 : 1; OPT[k.k] = clamp(OPT[k.k] + d * k.step, k.min, k.max); }
      else if (k.kind === 'knob') OPT[k.k] = OPT[k.k] >= k.max ? k.min : OPT[k.k] + 1;
      else if (k.kind === 'select') OPT[k.k] = (OPT[k.k] + 1) % k.opts.length;
      if (k.k === 'threads') ensureWorkers();
      P.dirty = true;
    }
  });
  addEventListener('pointermove', (ev) => { if (drag !== null) { setFrom(drag, local(ev)[0]); P.dirty = true; } });
  addEventListener('pointerup', () => { drag = null; });
}
function ensureWorkers() { while (W.length < OPT.threads) makeWorker(W.length); }

// ===================================================================================================
// SEARCH TREE (hero)
const TREE = { cx: 396, cy: 382, R: [0, 80, 165, 245, 320, 372] };
let ringTex = null;
function makeRings(P) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(P.w * DPR); cv.height = Math.round(P.h * DPR);
  const c = cv.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const rnd = STUDIO.rng(1956);
  const { cx, cy } = TREE;
  // walnut cross-section: soft heartwood glow, many thin wobbly growth rings, then the 4 ply rings
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, 345);
  g.addColorStop(0, 'rgba(120,80,48,0.20)'); g.addColorStop(0.55, 'rgba(70,48,30,0.12)'); g.addColorStop(1, 'rgba(40,28,20,0.0)');
  c.fillStyle = g; c.beginPath(); c.arc(cx, cy, 345, 0, TAU); c.fill();
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let r = 14; r < 340; r += 3 + rnd() * 6) {
    const amp = 0.6 + r * 0.008;
    c.strokeStyle = `rgba(168,116,76,${(0.05 + rnd() * 0.06).toFixed(3)})`;
    c.lineWidth = 0.6 + rnd() * 0.8;
    c.beginPath();
    for (let a = 0; a <= TAU + 0.01; a += 0.04) {
      const rr = r + Math.sin(a * 3 + ph[0] + r * 0.01) * amp + Math.sin(a * 7 + ph[1]) * amp * 0.4 + Math.sin(a * 13 + ph[2] + r * 0.03) * 0.3;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  }
  // medullary rays
  for (let k = 0; k < 90; k++) {
    const a = rnd() * TAU, r0 = 30 + rnd() * 150, r1 = r0 + 40 + rnd() * 150;
    c.strokeStyle = `rgba(200,150,100,${(0.025 + rnd() * 0.03).toFixed(3)})`;
    c.lineWidth = 0.5;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
  }
  return cv;
}
function plyR(ply) {
  const n = Math.max(4, OPT.treePlies);
  const k = n === 5 ? 0.86 : 1;
  return TREE.R[ply] * k;
}
function effNodes(n) {
  let s = 0;
  for (const k of n.kids) s += effNodes(k);
  n.eff = Math.max(n.nodes, s);
  return n.eff;
}
function layoutTree(n, a0, a1) {
  n.ta = (a0 + a1) / 2;
  n.tspan = a1 - a0;
  const kids = n.vis;
  if (!kids || !kids.length) return;
  let sum = 0;
  for (const k of kids) { k.w = Math.sqrt(k.eff + 1); sum += k.w; }
  const gap = n.ply === 0 ? 0.004 : 0;
  const usable = (a1 - a0) - gap * kids.length;
  let a = a0;
  for (const k of kids) {
    const sp = usable * (k.w / sum);
    layoutTree(k, a + gap / 2, a + gap / 2 + sp);
    a += sp + gap;
  }
}
// visible subset: every child at plies 1-2, the heaviest children at plies 3-5, plus worker paths and the PV
const VIS_LIM = [0, 999, 14, 5, 3, 3];
const DOT_CAP = [0, 99, 6.5, 4.0, 2.7, 2.4];
function computeVisible(T) {
  const tr = T.tree, plies = OPT.treePlies;
  const force = new Set();
  for (const w of W) if (w.path) for (const n of w.path) force.add(n);
  if (T.best) { let n = tr.root; for (let i = 0; i < Math.min(plies, T.pv.length); i++) { n = n.map.get(T.pv[i]); if (!n) break; force.add(n); } }
  let count = 0;
  const S2 = { cnt: [0, 0, 0, 0, 0, 0], cut: [0, 0, 0, 0, 0, 0], typed: [0, 0, 0, 0, 0, 0], sub: [0, 0, 0, 0, 0, 0] };
  const all = [tr.root];
  while (all.length) {
    const n = all.pop();
    if (n.ply) { S2.cnt[n.ply]++; if (n.type >= 0) S2.typed[n.ply]++; if (n.type === 1) S2.cut[n.ply]++; S2.sub[n.ply] += n.nodes; }
    for (const k of n.kids) all.push(k);
  }
  tr.stats = S2;
  const st = [tr.root];
  while (st.length) {
    const n = st.pop();
    if (n.ply >= plies || !n.kids.length) { n.vis = null; n.hidden = 0; continue; }
    const lim = VIS_LIM[n.ply + 1];
    let vis;
    if (n.kids.length <= lim) vis = n.kids.slice();
    else {
      const sorted = n.kids.slice().sort((x, y) => y.eff - x.eff);
      const keep = new Set(sorted.slice(0, lim));
      for (const k of n.kids) if (force.has(k)) keep.add(k);
      vis = n.kids.filter((k) => keep.has(k));
    }
    n.vis = vis;
    n.hidden = n.kids.length - vis.length;
    count += vis.length;
    for (const k of vis) st.push(k);
  }
  T.tree.visCount = count;
}
function treeUpdate(T, dt) {
  const tr = T.tree;
  // worker stacks create the nodes they are in
  const plies = OPT.treePlies;
  for (let i = 0; i < nThreads(); i++) {
    const w = W[i];
    w.path = null;
    if (w.thinkOf !== T.id || !w.stack || !w.stack.length || w.perft) continue;
    const path = [];
    let n = tr.root;
    for (let k = 0; k < Math.min(plies, w.stack.length); k++) {
      const m = w.stack[k];
      if (!m) break;
      n = treeNode(T, n, m);
      path.push(n);
    }
    w.path = path;
    w.depthNow = w.stack.length;
  }
  if (!tr.visAt || S.frame - tr.visAt >= 6 || tr.visPlies !== plies) { computeVisible(T); tr.visAt = S.frame; tr.visPlies = plies; }
  else {
    // keep worker paths visible between recomputations
    for (const w of W) if (w.path) for (const n of w.path) { const p = n.parent; if (p.vis && !p.vis.includes(n)) { p.vis.push(n); p.vis.sort((x, y) => p.kids.indexOf(x) - p.kids.indexOf(y)); } }
  }
  layoutTree(tr.root, -Math.PI / 2, -Math.PI / 2 + TAU);
  const k = 1 - Math.exp(-dt / 140);
  const stack = [tr.root];
  while (stack.length) {
    const n = stack.pop();
    n.a += (n.ta - n.a) * k;
    n.span = n.span === undefined ? n.tspan : n.span + (n.tspan - n.span) * k;
    if (n.vis) for (const c2 of n.vis) stack.push(c2);
  }
}
function drawTree(P, dt) {
  const c = P.ctx, T = T_();
  const tr = T ? T.tree : null;
  let nDeep = 0, nBg = 0;
  for (let i = 0; i < nThreads(); i++) { const w = W[i]; if (w.knps >= 50) nDeep++; else if ((w.bgKnps || 0) >= 50) nBg++; }
  frame(P, 'SEARCH TREE', T ? `think ${T.ply}/82 · ${fmtInt(tr.visCount || 0)} drawn of ${fmtInt(tr.count)} nodes · plies 1–${OPT.treePlies} · ${nDeep} workers here${nBg ? ' · ' + nBg + ' on background' : ''}` : '', C.gold);
  if (!ringTex) ringTex = makeRings(P);
  c.drawImage(ringTex, 0, 0, P.w, P.h);
  if (!T) return;
  treeUpdate(T, dt);
  const { cx, cy } = TREE;
  const plies = OPT.treePlies;
  // ply rings
  for (let p = 1; p <= plies; p++) {
    const r = plyR(p);
    c.beginPath(); c.arc(cx, cy, r, 0, TAU);
    c.strokeStyle = 'rgba(232,211,167,0.16)'; c.lineWidth = 1; c.stroke();
  }
  const now = S.now;
  const nodes = [];
  const stack = [tr.root];
  while (stack.length) {
    const n = stack.pop();
    if (n.ply > 0) {
      const age = clamp((now - n.born) / 320, 0, 1);
      const e = age * (2 - age);
      const rp = plyR(n.ply - 1), rk = plyR(n.ply);
      n.rr = rp + (rk - rp) * e;
      n.ca = Math.cos(n.a); n.sa = Math.sin(n.a);
      n.x = cx + n.ca * n.rr; n.y = cy + n.sa * n.rr;
      n.df = S.frame;
      nodes.push(n);
    } else { n.x = cx; n.y = cy; n.rr = 0; n.ca = 1; n.sa = 0; n.df = S.frame; }
    if (n.vis) for (const k of n.vis) stack.push(k);
  }
  // edges by type and weight bucket
  const buckets = new Map();
  for (const n of nodes) {
    const lg = Math.log10(n.eff + 1);
    const wb = lg < 2 ? 0 : lg < 3.5 ? 1 : lg < 5 ? 2 : 3;
    const key = (n.type + 1) * 4 + wb;
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(n);
  }
  const typeCol = (t) => (t < 0 ? C.faint : TYPE_COL[t]);
  for (const [key, arr] of buckets) {
    const t = Math.floor(key / 4) - 1, wb = key % 4;
    c.strokeStyle = hexA(typeCol(t), [0.22, 0.34, 0.5, 0.7][wb]);
    c.lineWidth = [0.6, 0.85, 1.2, 1.8][wb];
    c.beginPath();
    for (const n of arr) {
      const p = n.parent;
      const rm = (p.rr + n.rr) / 2;
      c.moveTo(p.x, p.y);
      if (n.ply >= 3) c.quadraticCurveTo(cx + n.ca * rm, cy + n.sa * rm, n.x, n.y);
      else c.bezierCurveTo(cx + p.ca * rm, cy + p.sa * rm, cx + n.ca * rm, cy + n.sa * rm, n.x, n.y);
    }
    c.stroke();
  }
  // pruned siblings at CUT nodes: a fan of faint ticks just outside the node, one tick per ~2.4 px of pruned moves
  c.strokeStyle = 'rgba(200,116,62,0.34)';
  c.lineWidth = 3.4;
  c.setLineDash([0.7, 1.7]);
  c.beginPath();
  for (const n of nodes) {
    if (n.type !== 1) continue;
    const pr = n.legal - n.cut - 1;
    if (pr <= 0) continue;
    const r = n.rr + 6.5;
    const half = Math.min(n.span * 0.45, (pr * 2.4) / r / 2, 0.08);
    c.moveTo(cx + Math.cos(n.a - half) * r, cy + Math.sin(n.a - half) * r);
    c.arc(cx, cy, r, n.a - half, n.a + half);
  }
  c.stroke();
  c.setLineDash([]);
  // PV vein: the current best line through the tree
  const vein = [];
  if (T.best) {
    let n = tr.root;
    for (let i = 0; i < Math.min(plies, T.pv.length); i++) { n = n.map.get(T.pv[i]); if (!n || n.df !== S.frame) break; vein.push(n); }
  }
  if (vein.length) {
    c.save();
    c.lineCap = 'round';
    for (const [w, a] of [[9, 0.08], [5, 0.16], [2.2, 0.9]]) {
      c.strokeStyle = a > 0.5 ? '#FBE7AE' : hexA(C.gold, a);
      c.lineWidth = w;
      c.beginPath();
      let p = tr.root;
      for (const n of vein) {
        const rm = (p.rr + n.rr) / 2;
        c.moveTo(p.x, p.y);
        c.bezierCurveTo(cx + Math.cos(p.a) * rm, cy + Math.sin(p.a) * rm, cx + Math.cos(n.a) * rm, cy + Math.sin(n.a) * rm, n.x, n.y);
        p = n;
      }
      c.stroke();
    }
    c.restore();
  }
  // dots
  const dotB = [[], [], [], []];
  for (const n of nodes) dotB[n.type + 1].push(n);
  for (let t = -1; t < 3; t++) {
    c.fillStyle = hexA(typeCol(t), 0.85);
    c.beginPath();
    for (const n of dotB[t + 1]) {
      const r = n.eff > 0 ? 1.5 + 1.2 * Math.log10(n.eff) : 1.5;
      const rr = Math.min(r, DOT_CAP[n.ply]);
      c.moveTo(n.x + rr, n.y);
      c.arc(n.x, n.y, rr, 0, TAU);
    }
    c.fill();
  }
  // ply-1 dots get a dark rim
  c.strokeStyle = 'rgba(18,14,11,0.9)'; c.lineWidth = 1.2;
  c.beginPath();
  for (const n of tr.root.kids) { const r = n.eff > 0 ? 1.5 + 1.2 * Math.log10(n.eff) : 1.5; c.moveTo(n.x + r, n.y); c.arc(n.x, n.y, r, 0, TAU); }
  c.stroke();
  // worker paths with glowing heads
  for (let i = 0; i < nThreads(); i++) {
    const w = W[i];
    if (!w.path || !w.path.length) continue;
    const cut = w.path.findIndex((n) => n.df !== S.frame);
    if (cut === 0) continue;
    if (cut > 0) w.path = w.path.slice(0, cut);
    c.strokeStyle = hexA(w.col, 0.85);
    c.lineWidth = 1.6;
    c.beginPath();
    let p = tr.root;
    for (const n of w.path) {
      const rm = (p.rr + n.rr) / 2;
      c.moveTo(p.x, p.y);
      c.bezierCurveTo(cx + Math.cos(p.a) * rm, cy + Math.sin(p.a) * rm, cx + Math.cos(n.a) * rm, cy + Math.sin(n.a) * rm, n.x, n.y);
      p = n;
    }
    c.stroke();
    const h = w.path[w.path.length - 1];
    // deeper than the drawn plies: a spike outward, 2.5 px per extra ply
    const extra = Math.max(0, (w.depthNow || 0) - w.path.length);
    if (extra > 0 && w.path.length === plies) {
      const ca = Math.cos(h.a), sa = Math.sin(h.a);
      const r1 = h.rr + Math.min(46, extra * 2.6);
      const gl = c.createLinearGradient(cx + ca * h.rr, cy + sa * h.rr, cx + ca * r1, cy + sa * r1);
      gl.addColorStop(0, hexA(w.col, 0.9)); gl.addColorStop(1, hexA(w.col, 0));
      c.strokeStyle = gl; c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx + ca * h.rr, cy + sa * h.rr); c.lineTo(cx + ca * r1, cy + sa * r1); c.stroke();
    }
    const g = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, 11);
    g.addColorStop(0, hexA(w.col, 0.95)); g.addColorStop(0.35, hexA(w.col, 0.45)); g.addColorStop(1, hexA(w.col, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(h.x, h.y, 11, 0, TAU); c.fill();
    c.fillStyle = '#FFFFFF';
    c.beginPath(); c.arc(h.x, h.y, 1.8, 0, TAU); c.fill();
  }
  // workers on the background pass (another position of the game): violet dots circling outside the last ring
  for (let i = 0; i < nThreads(); i++) {
    const w = W[i];
    if (w.knps >= 50 || (w.bgKnps || 0) < 50) continue;
    const a = S.now / 2600 + i * (TAU / 8);
    const r = plyR(plies) + 7;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const g = c.createRadialGradient(x, y, 0, x, y, 8);
    g.addColorStop(0, hexA(C.purple, 0.95)); g.addColorStop(1, hexA(C.purple, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 8, 0, TAU); c.fill();
    c.fillStyle = w.col; c.beginPath(); c.arc(x, y, 2, 0, TAU); c.fill();
  }
  // ring labels
  for (let p = 1; p <= plies; p++) {
    const r = plyR(p);
    const s2 = `ply ${p} \u00b7 ${fmtInt(tr.perPly[p] || 0)}`;
    const x = cx + 4, y = cy - r - 3;
    const w2 = tw(c, s2, FONT.mono(8.5)) + 8;
    c.fillStyle = 'rgba(18,14,11,0.92)';
    rrect(c, x - 2, y - 9, w2, 12, 3); c.fill();
    c.strokeStyle = 'rgba(232,211,167,0.22)'; c.lineWidth = 1; c.stroke();
    tx(c, s2, x + 2, y, FONT.mono(8.5), C.cream);
  }
  // centre: best move so far
  const cg = c.createRadialGradient(cx, cy, 0, cx, cy, 52);
  cg.addColorStop(0, 'rgba(18,14,11,0.96)'); cg.addColorStop(0.75, 'rgba(18,14,11,0.85)'); cg.addColorStop(1, 'rgba(18,14,11,0)');
  c.fillStyle = cg; c.beginPath(); c.arc(cx, cy, 52, 0, TAU); c.fill();
  tx(c, `${moveLabel(T.ply)}`, cx, cy - 19, FONT.mono(9), C.mute, 'center');
  tx(c, T.best ? T.best.san : '…', cx, cy + 5, FONT.bahn(22, 700), C.gold, 'center');
  tx(c, T.best ? fmtCp(T.bestScore) + '  d' + T.completed : '', cx, cy + 21, FONT.mono(9.5), T.best ? scoreCol(T.bestScore) : C.mute, 'center');
  drawTreeLabels(c, T, tr);
  if (!insetCv) {
    insetCv = document.createElement('canvas');
    insetCv.width = Math.round(P.w * DPR); insetCv.height = Math.round(P.h * DPR);
    insetCtx = insetCv.getContext('2d');
    insetCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  if (S.frame % 4 === 0 || insetAt === 0) {
    insetCtx.clearRect(0, 0, P.w, P.h);
    drawTreeInsets(insetCtx, P, T, tr);
    insetAt = S.frame;
  }
  c.drawImage(insetCv, 0, 0, P.w, P.h);
}
let insetCv = null, insetCtx = null, insetAt = 0;
const INSET = { w: 176, h: 104 };
function insetRects(P) {
  return [[8, 28], [P.w - 8 - INSET.w, 28], [8, P.h - 8 - INSET.h], [P.w - 8 - INSET.w, P.h - 8 - INSET.h]].map(([x, y]) => ({ x, y, w: INSET.w, h: INSET.h }));
}
function drawTreeLabels(c, T, tr) {
  const { cx, cy } = TREE;
  const plies = OPT.treePlies;
  const R = plyR(plies) + 12;
  const boxes = insetRects(PANELS.tree).map((r) => ({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 }));
  boxes.push({ x: 0, y: 0, w: PANELS.tree.w, h: 24 });
  for (let p = 1; p <= plies; p++) boxes.push({ x: cx + 2, y: cy - plyR(p) - 12, w: 74, h: 11 });
  const bestNode = T.best ? T.best.node : null;
  const kids = [...tr.root.kids].sort((a, b) => (b === bestNode) - (a === bestNode) || b.eff - a.eff);
  let placed = 0;
  for (const n of kids) {
    if (placed >= 14 || n.eff <= 0) break;
    const mv = n.mv;
    const best = T.best && mv === T.best;
    const sc = mv ? rootView(mv, T).s : '';
    const l1 = n.san, l2 = `${sc} ${fmtCount(n.eff)}`;
    const w = Math.max(tw(c, l1, FONT.bahn(12, 700)), tw(c, l2, FONT.mono(8.5))) + 6;
    const h = 24;
    // the sector's angle first, then nearby angles inside the sector (the best move tries harder)
    const tries = best ? [0, 0.04, -0.04, 0.08, -0.08, 0.13, -0.13, 0.2, -0.2, 0.3, -0.3] : [0, 0.03, -0.03];
    let box = null, ca = 0, sa = 0;
    for (const da of tries) {
      const a2 = n.a + clamp(da, -n.span / 2, n.span / 2);
      ca = Math.cos(a2); sa = Math.sin(a2);
      const ax = cx + ca * R, ay = cy + sa * R;
      let x = ca > 0.35 ? ax : ca < -0.35 ? ax - w : ax - w / 2;
      let y = sa > 0.35 ? ay : sa < -0.35 ? ay - h : ay - h / 2;
      x = clamp(x, 4, PANELS.tree.w - w - 4); y = clamp(y, 24, PANELS.tree.h - h - 4);
      const bx = { x, y, w, h };
      if (!boxes.some((b) => !(bx.x + bx.w < b.x || b.x + b.w < bx.x || bx.y + bx.h < b.y || b.y + b.h < bx.y))) { box = bx; break; }
    }
    if (!box) continue;
    const { x, y } = box;
    boxes.push(box);
    placed++;
    c.strokeStyle = best ? hexA(C.gold, 0.7) : 'rgba(156,140,118,0.35)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx + ca * (plyR(plies) + 3), cy + sa * (plyR(plies) + 3)); c.lineTo(cx + ca * (R - 2), cy + sa * (R - 2)); c.stroke();
    const al = ca > 0.35 ? 'left' : ca < -0.35 ? 'right' : 'center';
    const tx0 = al === 'left' ? x + 3 : al === 'right' ? x + w - 3 : x + w / 2;
    c.lineWidth = 3; c.strokeStyle = 'rgba(27,22,17,0.9)';
    font(c, FONT.bahn(12, 700)); c.textAlign = al; c.strokeText(l1, tx0, y + 10);
    tx(c, l1, tx0, y + 10, FONT.bahn(12, 700), best ? C.gold : mv && mv.played ? C.ivory : C.cream, al);
    font(c, FONT.mono(8.5)); c.strokeText(l2, tx0, y + 21);
    tx(c, l2, tx0, y + 21, FONT.mono(8.5), best ? C.gold : C.mute, al);
  }
}
function insetFrame(c, r, title) {
  c.fillStyle = 'rgba(23,19,15,0.92)';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.strokeStyle = C.line; c.lineWidth = 1;
  c.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  c.letterSpacing = '1px';
  tx(c, title, r.x + 7, r.y + 12, FONT.bahn(9.5, 700), C.mute);
  c.letterSpacing = '0px';
}
function drawTreeInsets(c, P, T, tr) {
  const [a, b, d, e] = insetRects(P);
  // TL: nodes per ply and cut rate
  insetFrame(c, a, 'NODES PER PLY · CUT RATE');
  const ts = tr.stats || { cnt: [0, 0, 0, 0, 0, 0], cut: [0, 0, 0, 0, 0, 0], typed: [0, 0, 0, 0, 0, 0], sub: [0, 0, 0, 0, 0, 0] };
  const { cnt, cut, typed, sub } = ts;
  for (let p = 1; p <= 4; p++) {
    const y = a.y + 22 + (p - 1) * 19;
    tx(c, 'p' + p, a.x + 7, y + 7, FONT.mono(9), C.mute);
    tx(c, fmtInt(cnt[p]), a.x + 50, y + 7, FONT.mono(9), C.text, 'right');
    const rate = typed[p] ? cut[p] / typed[p] : 0;
    c.fillStyle = C.line2; c.fillRect(a.x + 56, y, 80, 8);
    c.fillStyle = hexA(C.copper, 0.9); c.fillRect(a.x + 56, y, 80 * rate, 8);
    tx(c, (100 * rate).toFixed(0) + '%', a.x + a.w - 7, y + 7, FONT.mono(9), C.copper, 'right');
    tx(c, fmtCount(sub[p]) + ' nodes', a.x + 56, y + 16, FONT.mono(7.5), C.faint);
  }
  // TR: aspiration gauge
  insetFrame(c, b, 'ASPIRATION α/β');
  const asp = T.asp || { lo: -E.INF, hi: E.INF, fails: 0, delta: 25, center: 0 };
  const centre = asp.center !== undefined ? asp.center : T.best ? T.bestScore : 0;
  const gx = b.x + 10, gw = b.w - 20, gy = b.y + 38;
  const span = clamp(asp.delta * 6, 240, 1600);
  const toX = (v) => gx + gw * clamp((v - centre + span / 2) / span, 0, 1);
  c.fillStyle = C.line2; c.fillRect(gx, gy - 3, gw, 6);
  const lo = asp.lo <= -E.INF ? centre - span : asp.lo, hi = asp.hi >= E.INF ? centre + span : asp.hi;
  c.fillStyle = hexA(asp.fails ? C.warn : C.active, 0.55);
  c.fillRect(toX(lo), gy - 3, Math.max(1.5, toX(hi) - toX(lo)), 6);
  vline(c, toX(centre), gy - 7, gy + 7, C.gold);
  if (T.alphaS > -E.INF) vline(c, toX(T.alphaS), gy - 6, gy + 6, C.steel);
  if (T.alpha > -E.INF) { c.fillStyle = C.up; c.beginPath(); c.moveTo(toX(T.alpha), gy - 4); c.lineTo(toX(T.alpha) - 3, gy - 9); c.lineTo(toX(T.alpha) + 3, gy - 9); c.fill(); }
  tx(c, asp.lo <= -E.INF ? '−∞' : fmtCp(asp.lo), gx, gy + 16, FONT.mono(8.5), C.mute);
  tx(c, asp.hi >= E.INF ? '+∞' : fmtCp(asp.hi), gx + gw, gy + 16, FONT.mono(8.5), C.mute, 'right');
  tx(c, `c ${fmtCp(centre)} \u00b7 \u03b4 ${asp.delta}`, gx + gw / 2, gy + 16, FONT.mono(8.5), asp.fails ? C.warn : C.active, 'center');
  const row = (y, l, v, col) => { tx(c, l, b.x + 7, y, FONT.ui(9), C.mute); tx(c, v, b.x + b.w - 7, y, FONT.mono(9), col, 'right'); };
  const searching = T.phase === 'split' ? T.depth : T.completed;
  row(b.y + 72, 'done \u00b7 searching \u00b7 sel', `${T.completed} \u00b7 ${searching} \u00b7 ${T.sel}`, C.gold);
  row(b.y + 84, 'fails this depth', asp.open ? 'open (mate)' : String(asp.fails || 0), asp.fails ? C.warn : C.text);
  row(b.y + 96, '\u03b1s scout bound', T.alphaS > -E.INF ? fmtCp(T.alphaS) : '\u2014', C.steel);
  // BL: node types
  insetFrame(c, d, 'NODE TYPES · PRUNED');
  const tot = Math.max(1, tr.pv + tr.cut + tr.all);
  const rows = [['PV', tr.pv, C.gold], ['CUT', tr.cut, C.copper], ['ALL', tr.all, C.steel]];
  rows.forEach(([l, v, col], i) => {
    const y = d.y + 25 + i * 14;
    c.fillStyle = col; c.fillRect(d.x + 7, y - 6, 6, 6);
    tx(c, l, d.x + 17, y, FONT.mono(9), C.text);
    tx(c, fmtInt(v), d.x + 80, y, FONT.mono(9), col, 'right');
    c.fillStyle = C.line2; c.fillRect(d.x + 88, y - 6, 80, 6);
    c.fillStyle = hexA(col, 0.85); c.fillRect(d.x + 88, y - 6, 80 * v / tot, 6);
  });
  tx(c, 'pruned siblings', d.x + 7, d.y + 76, FONT.ui(9), C.mute);
  tx(c, fmtInt(tr.pruned), d.x + d.w - 7, d.y + 76, FONT.mono(10), C.copper, 'right');
  tx(c, 'first-move cut', d.x + 7, d.y + 92, FONT.ui(9), C.mute);
  tx(c, S.st.cuts ? (100 * S.st.firstCuts / S.st.cuts).toFixed(1) + '%' : '–', d.x + d.w - 7, d.y + 92, FONT.mono(10), C.up, 'right');
  // BR: best move by depth
  insetFrame(c, e, 'BEST MOVE BY DEPTH');
  const list = T.bestByDepth.slice(-7);
  list.forEach((x, i) => {
    const y = e.y + 25 + i * 11.4;
    tx(c, 'd' + x.d, e.x + 7, y, FONT.mono(9), C.mute);
    tx(c, x.san, e.x + 36, y, FONT.mono(9.5), x.changed ? C.up : C.text);
    tx(c, fmtCp(x.score), e.x + e.w - 7, y, FONT.mono(9), scoreCol(x.score), 'right');
    if (x.changed && i > 0) { c.fillStyle = C.up; c.fillRect(e.x + 31, y - 6, 2, 7); }
  });
}

// ===================================================================================================
// ENGINE OUTPUT
const LOG = { shown: 0, scroll: 0 };
const LCOL = [22, 40, 54, 100, 168, 222, 248, 280];
function drawOutput(P, dt) {
  const c = P.ctx;
  frame(P, 'ENGINE OUTPUT · UCI', `${fmtInt(S.logTotal || 0)} lines`, C.active);
  const hy = 32;
  const heads = ['dep', 'sel', 'pv', 'score', 'nodes', 'nps', 'hash', 'time'];
  heads.forEach((h, i) => tx(c, h, LCOL[i] + 8, hy, FONT.mono(8.5), C.faint, 'right'));
  tx(c, 'pv (SAN)', 296, hy, FONT.mono(8.5), C.faint);
  hline(c, 8, P.w - 8, hy + 4, C.line2);
  const lh = 11;
  const top = hy + 8, bottom = P.h - 5;
  const n = Math.floor((bottom - top) / lh);
  if (LOG.shown !== S.log.length) { LOG.scroll += (S.log.length - LOG.shown) * lh; LOG.shown = S.log.length; }
  LOG.scroll = Math.max(0, LOG.scroll - LOG.scroll * (1 - Math.exp(-dt / 70)) - 0.2);
  if (LOG.scroll > lh * 6) LOG.scroll = lh * 6;
  c.save();
  c.beginPath(); c.rect(1, top, P.w - 2, bottom - top); c.clip();
  const lines = S.log.slice(-(n + 7));
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const y = bottom - (lines.length - 1 - i) * lh - 3 + LOG.scroll;
    if (y < top - 2 || y > bottom + lh) continue;
    drawLogLine(c, L, y, P.w);
  }
  c.restore();
}
function drawLogLine(c, L, y, W2) {
  const k = L.kind;
  if (k === 'pos') {
    hline(c, 8, W2 - 8, y - 9, C.line2);
    let x = 8;
    for (const [s, col] of L.cells) { tx(c, s, x, y, FONT.mono(9), col === 'mute' ? C.faint : C.cream); x += tw(c, s, FONT.mono(9)); }
    return;
  }
  if (k === 'best') {
    c.fillStyle = 'rgba(243,210,122,0.07)'; c.fillRect(4, y - 8.5, W2 - 8, 11);
    let x = 8;
    for (const [s, col] of L.cells) { tx(c, s, x, y, FONT.mono(9), col === 'best' ? C.gold : col === 'mute' ? C.mute : C.cream); x += tw(c, s, FONT.mono(9)); }
    return;
  }
  const cells = L.cells;
  const dim = k === 'multi' || k === 'stat';
  if (k === 'new') { c.fillStyle = 'rgba(134,212,107,0.10)'; c.fillRect(4, y - 8.5, W2 - 8, 11); c.fillStyle = C.up; c.fillRect(4, y - 8.5, 2, 11); }
  if (k === 'fail') { c.fillStyle = 'rgba(255,154,60,0.08)'; c.fillRect(4, y - 8.5, W2 - 8, 11); }
  for (let i = 0; i < 8; i++) {
    let [v, kind] = cells[i];
    let col = C.text;
    if (kind === 'nodes') { v = fmtInt(v); col = C.text; }
    else if (kind === 'nps') { v = String(Math.round(v)); col = C.active; }
    else if (kind === 'score') { col = v.startsWith('#') ? C.purple : v.startsWith('-') ? C.down : C.up; v = v.startsWith('#') ? 'mate ' + v.slice(1) : 'cp ' + v.replace('+', ''); }
    else if (v === '') continue;
    else if (kind === 'warn') col = C.warn;
    else if (kind === 'mute') col = C.mute;
    if (dim) col = hexA(col === C.text ? C.mute : col, 0.75);
    tx(c, String(v), LCOL[i] + 8, y, FONT.mono(9), col, 'right');
  }
  const [pv, pk] = cells[8];
  const col = pk === 'warn' ? C.warn : pk === 'pv' ? (k === 'new' ? C.up : C.cream) : pk === 'cur' ? C.faint : C.mute;
  let s = pv;
  const maxW = W2 - 8 - 296;
  while (s.length > 4 && tw(c, s, FONT.mono(9)) > maxW) s = s.slice(0, s.lastIndexOf(' '));
  tx(c, s, 296, y, FONT.mono(9), col);
}

// ===================================================================================================
// ROOT MOVES
const ROOT = { y: new Map() };
// what a root row shows: the exact score of the depth being searched; else the exact score of the last resolved
// depth (dimmed); else the bound found at this depth; else the last depth's bound (dimmed)
// what a root move shows, in every panel: the best move carries the score of the last resolved depth (the one the
// tree centre, the PV and the iteration table show); other moves the exact score of the depth being searched, else
// the last depth's exact score (dimmed), else the bound found at this depth, else the last depth's bound (dimmed).
// k is the sort key: an upper bound ranks 10 cp below its value, so it never outranks an equal exact score.
function rootView(m, T) {
  if (T && m === T.best && T.completed) return { v: T.bestScore, k: T.bestScore + 0.5, s: fmtCp(T.bestScore), col: scoreCol(T.bestScore), dim: false };
  if (m.exact) return { v: m.score, k: m.score, s: fmtCp(m.score), col: scoreCol(m.score), dim: false };
  if (m.prevExact !== null && m.prevExact !== undefined) return { v: m.prevExact, k: m.prevExact - 0.25, s: fmtCp(m.prevExact), col: hexA(scoreCol(m.prevExact), 0.5), dim: true };
  if (m.lb > -E.INF) return { v: m.lb, k: m.lb, s: '≥' + fmtCp(m.lb), col: C.warn, dim: false };
  if (m.ub < E.INF) return { v: m.ub, k: m.ub - 10, s: '≤' + fmtCp(m.ub), col: C.mute, dim: false };
  if (m.prevUb !== undefined && m.prevUb < E.INF) return { v: m.prevUb, k: m.prevUb - 10.25, s: '≤' + fmtCp(m.prevUb), col: C.faint, dim: true };
  if (m.prevLb !== undefined && m.prevLb > -E.INF) return { v: m.prevLb, k: m.prevLb - 0.25, s: '≥' + fmtCp(m.prevLb), col: C.faint, dim: true };
  return { v: -99999, k: -99999, s: '—', col: C.faint, dim: true };
}
// columns of a root-move row (x from the column's left edge)
const RC = { rank: 12, move: 16, score: 92, bar: 97, barW: 42, pct: 163, badge: 171.5, job: 180, played: 197, d: 254 };
function drawRoot(P, dt) {
  const c = P.ctx, T = T_();
  const searching = T ? (T.phase === 'split' ? T.depth : T.completed) : 0;
  frame(P, 'ROOT MOVES', T ? `searching d${searching} · ${T.moves.length} legal · α ${T.alpha > -E.INF ? fmtCp(T.alpha) : 'pending'} · αs ${T.alphaS > -E.INF ? fmtCp(T.alphaS) : '—'} · dim = d${T.completed}` : '', C.steel);
  if (!T) return;
  const rows = [...T.moves];
  const view = new Map(rows.map((m) => [m, rootView(m, T)]));
  if (!T.order0) T.order0 = new Map(T.moves.map((m, i) => [m, i]));
  rows.sort((a, b) => view.get(b).k - view.get(a).k || (b === T.best) - (a === T.best) || T.order0.get(a) - T.order0.get(b));
  const colW = 262, hy = 32, rh = 10.2;
  const perCol = Math.floor((P.h - hy - 8) / rh);
  const maxNodes = Math.max(1, ...rows.map((m) => m.nodes));
  const totNodes = Math.max(1, rows.reduce((s, m) => s + m.nodes, 0));
  // few legal moves: the second column lists the replies of the PV split instead
  const replyMode = rows.length <= perCol && T.lastSplit;
  for (let col = 0; col < 2; col++) {
    const x0 = 8 + col * (colW + 4);
    const heads = col === 1 && replyMode
      ? [['#', 12, 'right'], ['replies to ' + T.lastSplit.mv.san, 16, 'left'], [T.lastSplit.done ? 'resolved' : T.lastSplit.phase === 'first' ? 'first reply' : T.lastSplit.running + ' running', 98, 'left'], ['w', 182, 'center'], ['job', 192, 'left'], ['d', 254, 'right']]
      : [['#', RC.rank, 'right'], ['move', RC.move, 'left'], ['score ↓', RC.score, 'right'], ['nodes', RC.bar, 'left'], ['w', RC.badge, 'center'], ['job', RC.job, 'left'], ['Δ', RC.played + 8, 'center'], ['d', RC.d, 'right']];
    for (const [h, x, al] of heads) tx(c, h, x0 + x, hy, FONT.mono(8.5), C.faint, al);
    hline(c, x0, x0 + colW - 4, hy + 4, C.line2);
  }
  if (replyMode) drawReplies(c, T, T.lastSplit, 8 + colW + 4, hy, rh, perCol, colW);
  vline(c, 8 + colW, hy - 8, P.h - 6, C.line2);
  const total = rows.length;
  const showN = Math.min(total, perCol * 2);
  const cpl = T.playedScore !== null && T.playedScore !== undefined && T.best ? Math.max(0, T.bestScore - T.playedScore) : null;
  for (let i = 0; i < showN; i++) {
    const m = rows[i];
    const last = i === showN - 1 && total > showN;
    const col = Math.floor(i / perCol), r = i % perCol;
    const x0 = 8 + col * (colW + 4);
    const y = hy + 13 + r * rh;
    const prevY = ROOT.y.get(m);
    if (prevY !== undefined && prevY !== y) m.flash = S.now;
    ROOT.y.set(m, y);
    const fl = m.flash ? clamp(1 - (S.now - m.flash) / 500, 0, 1) : 0;
    if (fl > 0) { c.fillStyle = hexA(C.active, 0.16 * fl); c.fillRect(x0, y - 8, colW - 4, rh); }
    if (last) { tx(c, `+ ${total - showN + 1} more`, x0 + 16, y, FONT.mono(9), C.faint); continue; }
    if (m === T.best) { c.fillStyle = 'rgba(243,210,122,0.09)'; c.fillRect(x0, y - 8, colW - 4, rh); }
    if (m.played) { c.strokeStyle = hexA(C.ivory, 0.55); c.setLineDash([2, 2]); c.strokeRect(x0 + 0.5, y - 8.5, colW - 5, rh); c.setLineDash([]); }
    tx(c, String(i + 1), x0 + RC.rank, y, FONT.mono(9), C.faint, 'right');
    tx(c, m.san, x0 + RC.move, y, FONT.mono(9.5), m === T.best ? C.gold : m.played ? C.ivory : C.text);
    const vw = view.get(m);
    tx(c, vw.s, x0 + RC.score, y, FONT.mono(9), vw.col, 'right');
    // log-scale node bar
    const bx = x0 + RC.bar, bw = RC.barW;
    const f = m.nodes > 0 ? Math.log10(m.nodes) / Math.log10(maxNodes) : 0;
    c.fillStyle = C.line2; c.fillRect(bx, y - 6, bw, 6);
    c.fillStyle = hexA(m === T.best ? C.gold : C.steel, 0.75); c.fillRect(bx, y - 6, bw * clamp(f, 0, 1), 6);
    tx(c, (100 * m.nodes / totNodes).toFixed(1) + '%', x0 + RC.pct, y, FONT.mono(8), C.mute, 'right');
    // worker badge: bright while a worker is on the move, otherwise its last worker dimmed
    const job = m.job || m.mpvJob;
    const running = job && (job.composite || job.worker >= 0);
    const wi = job && !job.composite && job.worker >= 0 ? job.worker : m.owner;
    if (job && job.composite) {
      c.fillStyle = C.gold;
      c.fillRect(x0 + RC.badge - 7.5, y - 7, 15, 8);
      const nw = new Set(job.reps.filter((r) => r.job && r.job.worker >= 0).map((r) => r.job.worker)).size;
      tx(c, '×' + Math.max(1, nw), x0 + RC.badge, y - 0.5, FONT.mono(7.5), C.ebony, 'center');
    } else if (wi >= 0 && W[wi]) {
      c.fillStyle = hexA(W[wi].col, running ? 1 : 0.35);
      c.fillRect(x0 + RC.badge - 4.5, y - 7, 9, 8);
      tx(c, String(wi + 1), x0 + RC.badge, y - 0.5, FONT.mono(7.5), C.ebony, 'center');
      if (running) { c.strokeStyle = W[wi].col; c.strokeRect(x0 + RC.badge - 6, y - 8.5, 12, 11); }
    }
    const type = job ? job.type : m.type;
    const tl = { pv: 'PV', scout: 'SC', research: 'RS', exact: 'EX', ID: 'ID' }[type] || '';
    tx(c, tl, x0 + RC.job, y, FONT.mono(8.5), running ? JOB_COL[type] || C.text : C.faint);
    // the move played in the game: its own slot with the CPL of the last resolved depth
    if (m.played) {
      const lab = cpl !== null ? 'Δ' + cpl : 'Δ—';
      const lw2 = tw(c, lab, FONT.mono(7.5)) + 6;
      c.fillStyle = C.ivory; rrect(c, x0 + RC.played, y - 7.5, lw2, 8.5, 2); c.fill();
      tx(c, lab, x0 + RC.played + lw2 / 2, y - 0.8, FONT.mono(7.5), C.ebony, 'center');
    }
    // depth: this iteration's depth once the move is resolved in it, else the depth it was last resolved at (dimmed)
    const resolvedNow = T.phase === 'split' && !m.job && (m.exact || (T.alpha > -E.INF && m.ub <= T.alpha));
    const dd = resolvedNow ? T.depth : m.depth;
    tx(c, dd ? 'd' + dd : '', x0 + RC.d, y, FONT.mono(8.5), resolvedNow ? C.text : C.faint, 'right');
  }
}

function drawReplies(c, T, comp, x0, hy, rh, perCol, colW) {
  // replies being searched first (the PV's own first reply on top), then the resolved ones, lowest (strongest) first
  const rv = (r) => (r.exact ? r.score : r.ub < E.INF ? r.ub : r.lb > -E.INF ? r.lb + 0.5 : 99999);
  const reps = [...comp.reps].sort((a, b) => (b.job ? 1 : 0) - (a.job ? 1 : 0) || (a.job && b.job ? a.idx - b.idx : rv(a) - rv(b)) || a.idx - b.idx);
  const n = Math.min(reps.length, perCol);
  for (let i = 0; i < n; i++) {
    const rep = reps[i];
    const y = hy + 13 + i * rh;
    if (i === n - 1 && reps.length > n) { tx(c, `+ ${reps.length - n + 1} more`, x0 + 16, y, FONT.mono(9), C.faint); break; }
    tx(c, String(i + 1), x0 + 12, y, FONT.mono(9), C.faint, 'right');
    tx(c, rep.san, x0 + 16, y, FONT.mono(9.5), rep.idx === 0 ? C.gold : C.text);
    let sc = '', col = C.mute;
    if (rep.exact) { sc = fmtCp(rep.score); col = scoreCol(rep.score); }
    else if (rep.ub < E.INF) { sc = '≤' + fmtCp(rep.ub); col = C.warn; }
    else if (rep.lb > -E.INF) { sc = '≥' + fmtCp(rep.lb); col = C.mute; }
    else if (rep.job) { sc = 'running'; col = C.active; }
    else { sc = '—'; col = C.faint; }
    tx(c, sc, x0 + 92, y, FONT.mono(9), col, 'right');
    const j = rep.job;
    const bw = 54;
    c.fillStyle = C.line2; c.fillRect(x0 + 98, y - 6, bw, 6);
    if (j) { const p = clamp((S.now - (j.start || S.now)) / 2000, 0.05, 1); c.fillStyle = hexA(JOB_COL[j.type] || C.steel, 0.8); c.fillRect(x0 + 98, y - 6, bw * p, 6); }
    else if (rep.lb > -E.INF || rep.ub < E.INF) { c.fillStyle = hexA(C.steel, 0.45); c.fillRect(x0 + 98, y - 6, bw, 6); }
    if (j && j.worker >= 0 && W[j.worker]) {
      c.fillStyle = W[j.worker].col; c.fillRect(x0 + 178, y - 7, 9, 8);
      tx(c, String(j.worker + 1), x0 + 182.5, y - 0.5, FONT.mono(7.5), C.ebony, 'center');
    }
    const tl = j ? ({ pv: 'PV', scout: 'SC', research: 'RS' }[j.type] || '') + (j.reduced ? '−' : '') : rep.tries ? 'ok' : '';
    tx(c, tl, x0 + 192, y, FONT.mono(8.5), j ? JOB_COL[j.type] || C.text : C.faint);
    tx(c, 'd' + (j ? j.depth + 2 : comp.gd + 2), x0 + 254, y, FONT.mono(8.5), C.mute, 'right');
  }
}

// ===================================================================================================
// WORKER LANES
function drawLanes(P) {
  const c = P.ctx, T = T_();
  const busy = S.deep.busyOffered ? (100 * S.deep.busyUsed / S.deep.busyOffered).toFixed(1) : '–';
  frame(P, 'WORKERS · ROOT SPLIT', `busy ${busy}% · ${fmtInt(jobSeq - 1)} jobs`, C.copper);
  const gx = 30, gw = 300, top = 28, lh = 13.4, span = 8000;
  const t1 = S.now, t0 = t1 - span;
  const toX = (t) => gx + gw * (t - t0) / span;
  const n = nThreads();
  for (let i = 0; i < 8; i++) {
    const y = top + i * lh;
    c.fillStyle = i % 2 ? '#1E1813' : '#1A1511';
    c.fillRect(gx, y, gw, lh - 1);
  }
  // iteration boundaries
  for (const m of S.iterMarks) {
    if (m.t < t0) continue;
    const x = toX(m.t);
    vline(c, x, top - 2, top + 8 * lh, 'rgba(232,211,167,0.22)');
  }
  // axis: seconds, and the depth at each iteration boundary
  let lastLab = -99;
  for (const m of S.iterMarks) {
    if (m.t < t0 || m.d < 5) continue;
    const x = toX(m.t);
    if (x - lastLab < 16 || x > gx + gw - 30) continue;
    tx(c, 'd' + m.d, x + 1, P.h - 4, FONT.mono(7.5), C.mute);
    lastLab = x;
  }
  tx(c, '−8 s', gx, P.h - 4, FONT.mono(7.5), C.faint, 'left');
  tx(c, 'now', gx + gw, P.h - 4, FONT.mono(7.5), C.faint, 'right');
  c.save();
  c.beginPath(); c.rect(gx, top, gw, 8 * lh); c.clip();
  for (const b of S.lanes) {
    if (b.end < t0 || b.w >= 8) continue;
    const x0 = toX(b.start), x1 = Math.max(x0 + 1, toX(b.end));
    const y = top + b.w * lh + 1.5;
    c.fillStyle = hexA(JOB_COL[b.type] || C.steel, b.spec ? 0.5 : 0.82);
    c.fillRect(x0, y, x1 - x0 - 0.5, lh - 4);
    if (x1 - x0 > 22) tx(c, b.san, x0 + 2, y + 7.6, FONT.mono(7.5), C.ebony);
  }
  // background pass (the worker's idle budget) as a violet band at the foot of the lane
  for (let i = 0; i < Math.min(8, n); i++) {
    const sp = W[i].bgSpans;
    if (!sp) continue;
    c.fillStyle = hexA(C.purple, 0.85);
    for (const [s0, s1] of sp) {
      if (s1 < t0) continue;
      const x0 = toX(Math.max(s0, t0)), x1 = toX(s1);
      c.fillRect(x0, top + i * lh + lh - 3.5, Math.max(1, x1 - x0), 2);
    }
  }
  // running jobs grow to now
  for (let i = 0; i < Math.min(8, n); i++) {
    const w = W[i];
    const j = jobs.get(w.cur);
    if (!j) continue;
    const x0 = toX(Math.max(w.curStart, t0)), x1 = toX(t1);
    const y = top + i * lh + 1.5;
    const col = JOB_COL[j.type || j.kind] || C.steel;
    c.fillStyle = hexA(col, j.spec ? 0.45 : 0.7);
    c.fillRect(x0, y, Math.max(1, x1 - x0), lh - 4);
    c.fillStyle = '#FFF4D8'; c.fillRect(x1 - 1.5, y, 1.5, lh - 4);
    if (x1 - x0 > 22) tx(c, j.mv ? j.mv.san + (j.san2 ? '·' + j.san2 : '') : j.kind, x0 + 2, y + 7.6, FONT.mono(7.5), C.ebony);
  }
  c.restore();
  // stats per worker
  const sx = 338;
  const heads = [['knps', 382], ['nodes', 430], ['busy', 462], ['TT\u2030', 494], ['job', 498]];
  for (const [h, x] of heads) tx(c, h, sx + (x - 338), top - 1.5, FONT.mono(7.5), C.faint, h === 'job' ? 'left' : 'right');
  for (let i = 0; i < 8; i++) {
    const w = W[i];
    const y = top + i * lh + 9.5;
    tx(c, 'W' + (i + 1), 8, y, FONT.mono(9), w ? w.col : C.faint);
    if (!w || i >= n) continue;
    if (w.knps < 50 && (w.bgKnps || 0) >= 50) tx(c, 'bg ' + fmtInt(w.bgKnps), 382, y, FONT.mono(9), C.purple, 'right');
    else tx(c, fmtInt(w.knps), 382, y, FONT.mono(9), C.active, 'right');
    tx(c, fmtCount(w.nodes), 430, y, FONT.mono(9), C.text, 'right');
    const b = w.busyOffered ? 100 * w.busyUsed / w.busyOffered : 0;
    tx(c, b.toFixed(0) + '%', 462, y, FONT.mono(9), b > 85 ? C.up : b > 60 ? C.text : C.warn, 'right');
    tx(c, String(w.hashfull), 494, y, FONT.mono(9), C.copper, 'right');
    const j = jobs.get(w.cur) || jobs.get(w.jobs[0]);
    const jl = w.perft ? 'perft' : j ? ({ pv: 'PV', scout: 'SC', research: 'RS', exact: 'EX' }[j.type] || j.kind) + (j.spec ? '+' : '') : w.bgJob && w.usedBg ? 'bg' : '';
    tx(c, jl, 500, y, FONT.mono(8), j ? JOB_COL[j.type] || C.text : w.bgJob ? C.purple : C.faint);
  }
  vline(c, 334, top - 8, top + 8 * lh, C.line2);
}

// ===================================================================================================
// MOVE ORDERING & HASH
let histImg = null, histCv = null, ttCv = null;
function drawOrdering(P) {
  const c = P.ctx, T = T_();
  frame(P, 'MOVE ORDERING · HASH', 'history Σ workers · log scale', C.purple);
  // history heatmap 64 x 64 (from x to)
  if (!histCv) { histCv = document.createElement('canvas'); histCv.width = 64; histCv.height = 64; histImg = histCv.getContext('2d').createImageData(64, 64); }
  const H = S.hist;
  let mx = 1;
  for (let i = 0; i < 4096; i++) if (H[i] > mx) mx = H[i];
  const lm = Math.log1p(mx);
  const d = histImg.data;
  for (let i = 0; i < 4096; i++) {
    const v = H[i] > 0 ? Math.log1p(H[i]) / lm : 0;
    // walnut -> copper -> gold -> cream
    const r = v < 0.5 ? lerp(30, 200, v * 2) : lerp(200, 250, (v - 0.5) * 2);
    const g = v < 0.5 ? lerp(24, 116, v * 2) : lerp(116, 228, (v - 0.5) * 2);
    const b = v < 0.5 ? lerp(19, 62, v * 2) : lerp(62, 170, (v - 0.5) * 2);
    const from = i >> 6, to = i & 63;
    const px = (63 - (to >> 3)) * 64 * 0 + ((7 - (from >> 3)) * 8 + (from & 7)) * 64 + ((7 - (to >> 3)) * 8 + (to & 7));
    d[px * 4] = r; d[px * 4 + 1] = g; d[px * 4 + 2] = b; d[px * 4 + 3] = 255;
  }
  histCv.getContext('2d').putImageData(histImg, 0, 0);
  const hx = 22, hy = 26, hs = 116;
  c.imageSmoothingEnabled = false;
  c.drawImage(histCv, hx, hy, hs, hs);
  c.imageSmoothingEnabled = true;
  c.strokeStyle = C.line; c.strokeRect(hx - 0.5, hy - 0.5, hs + 1, hs + 1);
  c.save(); c.translate(12, hy + hs / 2); c.rotate(-Math.PI / 2); tx(c, 'from a8 → h1', 0, 3, FONT.ui(8), C.faint, 'center'); c.restore();
  tx(c, 'to a8 → h1', hx + hs / 2, hy + hs + 0, FONT.ui(8), C.faint, 'center');
  // killers for plies 1-8 (from worker 1, or the first worker with data)
  const kx = 150;
  tx(c, 'KILLERS', kx, 33, FONT.bahn(9.5, 700), C.mute);
  const kw = W.find((w) => w.killers && w.killers.length && w.killers.some((x) => x)) || W[0];
  const sqn = (q) => 'abcdefgh'[q & 7] + ((q >> 4) + 1);
  const mvs = (m) => (m ? sqn(m & 127) + sqn((m >> 7) & 127) : '\u2014');
  for (let p = 0; p < 8; p++) {
    const y = 46 + p * 12.4;
    tx(c, String(p + 1), kx, y, FONT.mono(8.5), C.faint);
    const k1 = kw && kw.killers ? kw.killers[p * 2] : 0, k2 = kw && kw.killers ? kw.killers[p * 2 + 1] : 0;
    tx(c, mvs(k1), kx + 12, y, FONT.mono(9), k1 ? C.cream : C.faint);
    tx(c, mvs(k2), kx + 48, y, FONT.mono(9), k2 ? C.mute : C.faint);
  }
  // TT occupancy by age: one row per worker, one column per age (thinks ago), cell = share of slots
  const tx0 = 240, ty0 = 26, cw = 7.6, chh = 10.5;
  tx(c, 'TT BY AGE', tx0, 33, FONT.bahn(9.5, 700), C.mute);
  for (let i = 0; i < 8; i++) {
    const w = W[i];
    const y = ty0 + 12 + i * (chh + 2);
    tx(c, String(i + 1), tx0, y + 8, FONT.mono(8), w ? w.col : C.faint);
    for (let a = 0; a < 17; a++) {
      const v = w && w.occ ? w.occ[a] : 0;
      const f = a < 16 ? Math.sqrt(clamp(v / 0.25, 0, 1)) : clamp(v, 0, 1);
      if (a < 16) {
        const r = lerp(30, a === 0 ? 243 : 200, f), g = lerp(24, a === 0 ? 210 : 116, f), b2 = lerp(19, a === 0 ? 122 : 62, f);
        c.fillStyle = `rgb(${r | 0},${g | 0},${b2 | 0})`;
      } else c.fillStyle = `rgba(127,167,196,${(0.15 + 0.6 * f).toFixed(3)})`;
      c.fillRect(tx0 + 10 + a * cw + (a === 16 ? 3 : 0), y, cw - 1, chh);
    }
  }
  tx(c, 'now', tx0 + 10, 144, FONT.ui(8), C.gold);
  tx(c, '→ 15 thinks ago', tx0 + 10 + 16 * cw - 1, 144, FONT.ui(8), C.faint, 'right');
  tx(c, '∅', tx0 + 10 + 16 * cw + 3 + cw / 2, 144, FONT.ui(8), C.steel, 'center');
  // stats
  const sx = 404;
  const st = S.st;
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
  const rows = [
    ['TT hit', pct(st.hits, st.probes), C.active],
    ['hashfull', avgHashfull() + '‰', C.copper],
    ['first-move cut', pct(st.firstCuts, st.cuts), C.up],
    ['null-move cut', pct(st.nullCuts, st.nullTried), C.text],
    ['LMR re-search', pct(st.lmrRe, st.lmrTried), C.text],
    ['q-node share', pct(S.qnodes, S.nodes), C.text],
    ['futility prunes', fmtCount(st.fut), C.text],
    ['check ext.', fmtCount(st.checkExt), C.text],
    ['SEE pruned', fmtCount(st.seePruned), C.text],
  ];
  vline(c, sx - 8, 26, P.h - 6, C.line2);
  rows.forEach(([l, v, col], i) => {
    const y = 34 + i * 12.6;
    tx(c, l, sx, y, FONT.ui(9.5), C.mute);
    tx(c, v, P.w - 8, y, FONT.mono(9.5), col, 'right');
  });
}

// ===================================================================================================
// GAME RECORD
function drawRecord(P) {
  const c = P.ctx, T = T_();
  frame(P, 'GAME RECORD · ENGINE VERDICTS', `deep from 14.Bxe7 · background d${S.bg.depth || 10} · ${S.bg.done} done · quick d7`, C.green);
  const cur = T ? T.ply : 0;
  const colW = 272, top = 34, rh = 10.6;
  for (let col = 0; col < 2; col++) {
    const x0 = 8 + col * (colW + 8);
    for (let r = 0; r < 21; r++) {
      const mn = col * 21 + r + 1;
      if (mn > 41) break;
      const y = top + r * rh;
      if (r % 2 === 0) { c.fillStyle = 'rgba(255,240,210,0.018)'; c.fillRect(x0, y - 8, colW, rh); }
      tx(c, String(mn), x0 + 16, y, FONT.mono(9), C.faint, 'right');
      for (let s = 0; s < 2; s++) {
        const ply = (mn - 1) * 2 + s;
        if (ply >= G.plies) continue;
        const hx = x0 + 22 + s * 125;
        const a = S.analysis[ply];
        const future = ply > cur;
        c.globalAlpha = future ? 0.5 : 1;
        if (ply === cur) {
          const pulse = 0.55 + 0.45 * Math.sin(S.now / 220);
          c.fillStyle = hexA(C.gold, 0.12); c.fillRect(hx - 2, y - 8.5, 122, rh);
          c.strokeStyle = hexA(C.gold, pulse); c.strokeRect(hx - 2.5, y - 9, 123, rh + 1);
        }
        const san = G.sans[ply];
        tx(c, san, hx, y, FONT.mono(9.5), ply === cur ? C.gold : C.text);
        let x = hx + tw(c, san, FONT.mono(9.5)) + 2;
        if (a && a.cls) {
          if (a.glyph) { tx(c, a.glyph, x, y, FONT.bahn(10, 700), VERDICT[a.glyph].col); x += tw(c, a.glyph, FONT.bahn(10, 700)) + 3; }
          else x += 3;
          if (a.cpl > 10) tx(c, String(a.cpl), x, y - 0.5, FONT.mono(7.5), a.cpl >= 100 ? (VERDICT[a.glyph] || {}).col || C.mute : C.faint);
          x += 15;
          if (a.best && a.best !== G.moves[ply] && a.cpl > 10) {
            const alt = a.bestSan + ' ' + fmtCp(a.score);
            tx(c, alt, x, y, FONT.mono(8), C.mute);
          }
          tx(c, 'd' + a.depth, hx + 117, y, FONT.mono(7.5), a.src === 'deep' ? C.gold : a.src === 'bg' ? C.purple : C.faint, 'right');
        }
        c.globalAlpha = 1;
      }
    }
    vline(c, x0 + 22 + 121, top - 8, top + 20 * rh + 2, 'rgba(58,47,37,0.6)');
  }
  vline(c, 8 + colW + 4, 26, top + 21 * rh - 6, C.line2);
  // footer: ACPL and verdict counts per side
  const fy = P.h - 9;
  hline(c, 8, P.w - 8, fy - 12, C.line2);
  const acc = [{ s: 0, n: 0, g: {} }, { s: 0, n: 0, g: {} }];
  for (let p = 0; p < G.plies; p++) {
    const a = S.analysis[p];
    if (!a || a.cpl === undefined) continue;
    const side = p % 2;
    acc[side].s += a.cpl; acc[side].n++;
    if (a.glyph) acc[side].g[a.glyph] = (acc[side].g[a.glyph] || 0) + 1;
  }
  let x = 10;
  for (const side of [0, 1]) {
    const A = acc[side];
    tx(c, side ? 'Fischer' : 'Byrne', x, fy, FONT.bahn(10.5, 700), side ? C.cream : C.text);
    x += tw(c, side ? 'Fischer' : 'Byrne', FONT.bahn(10.5, 700)) + 6;
    tx(c, 'ACPL', x, fy, FONT.ui(9), C.mute); x += 24;
    const ac = A.n ? (A.s / A.n).toFixed(0) : '–';
    tx(c, ac, x, fy, FONT.mono(10), C.gold); x += tw(c, ac, FONT.mono(10)) + 8;
    for (const g of ['!!', '!', '?!', '?', '??']) {
      tx(c, g, x, fy, FONT.bahn(10, 700), VERDICT[g].col); x += tw(c, g, FONT.bahn(10, 700)) + 2;
      tx(c, String(A.g[g] || 0), x, fy, FONT.mono(9.5), C.text); x += 14;
    }
    x += 16;
  }
}

// ===================================================================================================
// EVAL GRAPH
function drawEvalGraph(P) {
  const c = P.ctx, T = T_();
  frame(P, 'EVALUATION · WHITE-RELATIVE 2·Wp − 1', 'quick d7 dotted · background dashed · deep solid · markers = verdicts', C.maple);
  const x0 = 34, x1 = P.w - 10, y0 = 26, y1 = 100, ym = (y0 + y1) / 2;
  const X = (p) => x0 + (x1 - x0) * p / 82;
  const Y = (cp) => ym - (y1 - y0) / 2 * (2 * wp(cp) - 1);
  // grid: +-1, +-3, +-10 pawns
  for (const pw of [100, 300, 1000]) for (const sg of [1, -1]) {
    const y = Y(sg * pw);
    hline(c, x0, x1, y, 'rgba(58,47,37,0.55)');
    tx(c, (sg > 0 ? '+' : '−') + pw / 100, x0 - 4, y + 3, FONT.mono(8), C.faint, 'right');
  }
  hline(c, x0, x1, ym, C.line);
  tx(c, '0', x0 - 4, ym + 3, FONT.mono(8), C.mute, 'right');
  for (let p = 0; p <= 82; p += 10) { vline(c, X(p), y0, y1, 'rgba(58,47,37,0.35)'); tx(c, String(p), X(p), P.h - 3, FONT.mono(7.5), C.faint, 'center'); }
  const pts = [];
  for (let p = 0; p <= 82; p++) { const v = whiteCp(p); if (v !== null) pts.push([p, v, S.analysis[p].src]); }
  if (pts.length > 1) {
    // fills
    for (const [sign, col] of [[1, 'rgba(230,205,160,0.42)'], [-1, 'rgba(168,116,76,0.55)']]) {
      c.save();
      c.beginPath();
      if (sign > 0) c.rect(x0, y0 - 2, x1 - x0, ym - y0 + 2); else c.rect(x0, ym, x1 - x0, y1 - ym + 2);
      c.clip();
      c.beginPath();
      c.moveTo(X(pts[0][0]), ym);
      for (const [p, v] of pts) c.lineTo(X(p), Y(v));
      c.lineTo(X(pts[pts.length - 1][0]), ym);
      c.closePath();
      c.fillStyle = col; c.fill();
      c.restore();
    }
    // line: dotted for quick, solid for deep
    for (let i = 1; i < pts.length; i++) {
      const [pa, va, sa] = pts[i - 1], [pb, vb, sb] = pts[i];
      const deep = sa === 'deep' && sb === 'deep';
      const bg = !deep && sa !== 'quick' && sb !== 'quick';
      c.strokeStyle = deep ? C.gold : bg ? C.purple : C.cream;
      c.lineWidth = deep ? 1.8 : bg ? 1.3 : 1;
      c.setLineDash(deep ? [] : bg ? [4, 2] : [1.5, 2.5]);
      c.beginPath(); c.moveTo(X(pa), Y(va)); c.lineTo(X(pb), Y(vb)); c.stroke();
    }
    c.setLineDash([]);
    // verdict markers on the curve (at the position after the move)
    for (let p = 0; p < 82; p++) {
      const a = S.analysis[p];
      if (!a || !a.glyph) continue;
      const v = whiteCp(p + 1);
      if (v === null) continue;
      const x = X(p + 1), y = Y(v);
      c.fillStyle = VERDICT[a.glyph].col;
      c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y); c.closePath(); c.fill();
      c.strokeStyle = C.ebony; c.lineWidth = 1; c.stroke();
      if (a.glyph === '!!' || a.glyph === '??') tx(c, a.glyph, x, y - 6, FONT.bahn(9, 700), VERDICT[a.glyph].col, 'center');
    }
  }
  // depth bars under the plot
  for (let p = 0; p <= 82; p++) {
    const a = S.analysis[p];
    if (!a || !a.depth) continue;
    const h = Math.min(14, a.depth * 0.85);
    c.fillStyle = a.src === 'deep' ? hexA(C.gold, 0.8) : a.src === 'bg' ? hexA(C.purple, 0.75) : hexA(C.mute, 0.45);
    c.fillRect(X(p) - 2, 117 - h, 4, h);
  }
  tx(c, 'depth', x0 - 4, 116, FONT.ui(7.5), C.faint, 'right');
  // analysis cursor
  if (T) {
    const x = X(T.ply);
    const pulse = 0.5 + 0.5 * Math.sin(S.now / 200);
    c.strokeStyle = hexA(C.active, 0.7); c.setLineDash([3, 2]);
    c.beginPath(); c.moveTo(x + 0.5, y0 - 4); c.lineTo(x + 0.5, 118); c.stroke(); c.setLineDash([]);
    const v = T.best ? (T.side ? -T.bestScore : T.bestScore) : whiteCp(T.ply) || 0;
    c.fillStyle = hexA(C.active, 0.3 + 0.4 * pulse); c.beginPath(); c.arc(x, Y(v), 6, 0, TAU); c.fill();
    c.fillStyle = C.active; c.beginPath(); c.arc(x, Y(v), 2.5, 0, TAU); c.fill();
    tx(c, `${moveLabel(T.ply)}${G.sans[T.ply] || ''}`, x + 6, y0 + 6, FONT.mono(8.5), C.active);
  }
}

// ===================================================================================================
// ITERATIONS
function drawIterations(P) {
  const c = P.ctx, T = T_();
  const last = T && T.iters.length ? T.iters[T.iters.length - 1] : null;
  frame(P, 'ITERATIVE DEEPENING', T ? `${moveNo(T.ply)}${T.side ? '\u2026' : '.'} ${T.side ? 'Black' : 'White'} to move \u00b7 best ${T.best ? T.best.san : '\u2014'} \u00b7 EBF ${last && last.ebf ? last.ebf.toFixed(2) : '\u2014'} \u00b7 ${((S.now - T.start) / 1000).toFixed(1)} / ${(T.opt.movetime / 1000).toFixed(1)} s` : '', C.cream);
  if (!T) return;
  const cols = [['d', 18, 'right'], ['time ms', 62, 'right'], ['nodes \u03a3', 132, 'right'], ['knps', 176, 'right'], ['EBF', 208, 'right'], ['score', 252, 'right'], ['fails', 280, 'right'], ['best', 290, 'left'], ['pv', 338, 'left']];
  const hy = 32;
  for (const [h, x, al] of cols) tx(c, h, x, hy, FONT.mono(8.5), C.faint, al);
  hline(c, 8, 520, hy + 4, C.line2);
  const rh = 10;
  const maxRows = Math.floor((P.h - hy - 8) / rh);
  const rows = T.iters.slice(-(maxRows - 1));
  let y = hy + 13;
  for (const it of rows) {
    tx(c, String(it.d), 18, y, FONT.mono(9), C.gold, 'right');
    tx(c, fmtInt(it.t), 62, y, FONT.mono(9), C.text, 'right');
    tx(c, fmtInt(it.cum), 132, y, FONT.mono(9), C.text, 'right');
    tx(c, fmtInt(it.knps), 176, y, FONT.mono(9), C.active, 'right');
    tx(c, it.ebf ? it.ebf.toFixed(2) : '–', 208, y, FONT.mono(9), C.mute, 'right');
    tx(c, fmtCp(it.score), 252, y, FONT.mono(9), scoreCol(it.score), 'right');
    tx(c, String(it.fails), 280, y, FONT.mono(9), it.fails ? C.warn : C.faint, 'right');
    tx(c, it.best, 290, y, FONT.mono(9), it.changed ? C.up : C.text);
    let pv = it.pv.join(' ');
    while (pv.length > 4 && tw(c, pv, FONT.mono(9)) > 180) pv = pv.slice(0, pv.lastIndexOf(' '));
    tx(c, pv, 338, y, FONT.mono(9), C.mute);
    y += rh;
  }
  // active row
  if (!T.done && T.phase === 'split') {
    const pulse = 0.5 + 0.5 * Math.sin(S.now / 160);
    c.fillStyle = hexA(C.active, 0.06 + 0.08 * pulse); c.fillRect(8, y - 8, 512, rh);
    c.fillStyle = hexA(C.active, 0.5 + 0.5 * pulse); c.fillRect(8, y - 8, 2, rh);
    const ms = Math.max(1, S.now - T.start);
    const nodesIt = T.live || 0;
    const resolved = T.moves.filter((m) => !m.job && (m.exact || (T.alpha > -E.INF && m.ub <= T.alpha))).length;
    tx(c, String(T.depth), 18, y, FONT.mono(9), C.active, 'right');
    tx(c, fmtInt(ms), 62, y, FONT.mono(9), C.active, 'right');
    tx(c, fmtInt(nodesIt), 132, y, FONT.mono(9), C.active, 'right');
    tx(c, fmtInt(ms > 0 ? nodesIt / ms : 0), 176, y, FONT.mono(9), C.active, 'right');
    tx(c, `${resolved}/${T.moves.length} moves resolved`, 290, y, FONT.mono(9), C.active);
    tx(c, T.alpha > -E.INF ? fmtCp(T.alpha) : '\u2014', 252, y, FONT.mono(9), T.alpha > -E.INF ? C.active : C.faint, 'right');
    tx(c, String(T.iterFails), 280, y, FONT.mono(9), T.iterFails ? C.warn : C.faint, 'right');
  }
  // mini charts
  const its = T.iters;
  const ch = [{ x: 532, title: 'log\u2081\u2080 nodes \u03a3 by depth' }, { x: 662, title: 'score / depth' }];
  for (const k of ch) {
    const x0 = k.x, w = 122, y0 = 30, h = 92;
    c.fillStyle = '#17130F'; c.fillRect(x0, y0, w, h);
    c.strokeStyle = C.line2; c.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    tx(c, k.title, x0 + 5, y0 + 10, FONT.ui(8.5), C.mute);
  }
  if (its.length > 1) {
    const dmax = Math.max(8, its[its.length - 1].d + 1);
    const X = (d, x0) => x0 + 6 + (110) * (d - 1) / (dmax - 1);
    // nodes per depth (log)
    const lmax = Math.max(...its.map((i) => Math.log10(Math.max(1, i.cum))));
    const Yn = (v) => 30 + 88 - 70 * (Math.log10(Math.max(1, v)) / Math.max(1, lmax));
    c.fillStyle = hexA(C.steel, 0.35);
    for (const it of its) { const x = X(it.d, 532); c.fillRect(x - 2, Yn(it.cum), 4, 30 + 88 - Yn(it.cum)); }
    c.strokeStyle = C.steel; c.lineWidth = 1.3;
    c.beginPath(); its.forEach((it, i) => { const x = X(it.d, 532), y = Yn(it.cum); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
    tx(c, fmtCount(its[its.length - 1].cum), 532 + 117, 52, FONT.mono(8.5), C.steel, 'right');
    // score by depth
    const sc = its.map((i) => clamp(i.score, -600, 600));
    const smin = Math.min(...sc) - 20, smax = Math.max(...sc) + 20;
    const Ys = (v) => 30 + 84 - 66 * (clamp(v, -600, 600) - smin) / Math.max(1, smax - smin);
    if (smin < 0 && smax > 0) hline(c, 662, 784, Ys(0), C.line);
    c.strokeStyle = C.gold; c.lineWidth = 1.3;
    c.beginPath(); its.forEach((it, i) => { const x = X(it.d, 662), y = Ys(it.score); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
    for (const it of its) if (it.changed) {
      const x = X(it.d, 662), y = Ys(it.score);
      c.fillStyle = C.up; c.beginPath(); c.moveTo(x, y - 3.5); c.lineTo(x + 3.5, y); c.lineTo(x, y + 3.5); c.lineTo(x - 3.5, y); c.fill();
    }
    const lastC = [...its].reverse().find((i) => i.changed);
    if (lastC) tx(c, lastC.best, X(lastC.d, 662) + 5, Ys(lastC.score) - 4, FONT.mono(8.5), C.up);
    tx(c, fmtCp(its[its.length - 1].score), 662 + 117, 52, FONT.mono(8.5), C.gold, 'right');
  }
}

// ===================================================================================================
// MACHINE
function drawMachine(P) {
  const c = P.ctx;
  const sys = STUDIO.system;
  frame(P, 'MACHINE', `${(sys.cpu || '').replace('AMD ', '').replace(' with Radeon Graphics', '')} · ${sys.cores || 8}C/${sys.threads || 16}T · ${sys.ramGB || 15.3} GB`, C.warn);
  const hist = STUDIO.history(30);
  const m = STUDIO.metrics();
  const nT = sys.threads || 16;
  const gx = 8, gy = 26, cw = 128, chh = 36, gap = 2.67;
  for (let i = 0; i < 16; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x = gx + col * (cw + gap), y = gy + row * (chh + 3);
    c.fillStyle = '#17130F'; c.fillRect(x, y, cw, chh);
    c.strokeStyle = C.line2; c.strokeRect(x + 0.5, y + 0.5, cw - 1, chh - 1);
    const cur = m.cpu && m.cpu[i] !== undefined ? m.cpu[i] : null;
    const hot = cur !== null && cur > 85;
    const colr = hot ? C.copper : C.steel;
    // sparkline
    if (hist.length > 1) {
      const t1 = hist[hist.length - 1].t, t0 = t1 - 30;
      c.beginPath();
      let first = true;
      for (const s of hist) {
        const v = s.cpu && s.cpu[i] !== undefined ? s.cpu[i] : 0;
        const px = x + 2 + (cw - 4) * (s.t - t0) / 30, py = y + chh - 3 - (chh - 16) * v / 100;
        if (first) { c.moveTo(px, y + chh - 2); c.lineTo(px, py); first = false; } else c.lineTo(px, py);
      }
      c.lineTo(x + cw - 2, y + chh - 2);
      c.closePath();
      c.fillStyle = hexA(colr, 0.22); c.fill();
      c.beginPath();
      first = true;
      for (const s of hist) {
        const v = s.cpu && s.cpu[i] !== undefined ? s.cpu[i] : 0;
        const px = x + 2 + (cw - 4) * (s.t - t0) / 30, py = y + chh - 3 - (chh - 16) * v / 100;
        if (first) { c.moveTo(px, py); first = false; } else c.lineTo(px, py);
      }
      c.strokeStyle = colr; c.lineWidth = 1; c.stroke();
    }
    tx(c, 'T' + String(i).padStart(2, '0'), x + 5, y + 11, FONT.mono(8.5), C.mute);
    tx(c, cur === null ? '—' : cur.toFixed(0) + '%', x + cw - 5, y + 11, FONT.mono(9.5), hot ? C.gold : C.text, 'right');
  }
  // bottom modules
  const by = gy + 4 * (chh + 3) + 4;
  const bh = P.h - by - 8;
  const mods = [{ x: 8, w: 128, t: 'RAM' }, { x: 138.7, w: 128, t: 'GPU' }, { x: 269.3, w: 128, t: 'DISK' }, { x: 400, w: 128, t: 'PAGE' }];
  for (const md of mods) {
    c.fillStyle = '#17130F'; c.fillRect(md.x, by, md.w, bh);
    c.strokeStyle = C.line2; c.strokeRect(md.x + 0.5, by + 0.5, md.w - 1, bh - 1);
    c.letterSpacing = '1px';
    tx(c, md.t, md.x + 6, by + 12, FONT.bahn(9.5, 700), C.mute);
    c.letterSpacing = '0px';
  }
  const spark = (x, y, w, h, vals, max, col, fill = true) => {
    if (vals.length < 2) return;
    c.beginPath();
    vals.forEach((v, i) => { const px = x + w * i / (vals.length - 1), py = y + h - h * clamp(v / max, 0, 1); if (i) c.lineTo(px, py); else c.moveTo(px, py); });
    c.strokeStyle = col; c.lineWidth = 1; c.stroke();
    if (fill) { c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath(); c.fillStyle = hexA(col, 0.18); c.fill(); }
  };
  // RAM
  const ramT = m.ramTotal || sys.ramGB || 15.3, ramU = m.ramUsed || 0;
  tx(c, `${ramU.toFixed(1)} / ${ramT.toFixed(1)} GB`, mods[0].x + mods[0].w - 6, by + 12, FONT.mono(9), C.text, 'right');
  c.fillStyle = C.line2; c.fillRect(mods[0].x + 6, by + 18, 116, 5);
  c.fillStyle = hexA(C.purple, 0.85); c.fillRect(mods[0].x + 6, by + 18, 116 * ramU / ramT, 5);
  spark(mods[0].x + 6, by + 28, 116, bh - 34, hist.map((s) => s.ramUsed || 0), ramT, C.purple);
  // GPU
  const gpu = m.gpu;
  tx(c, gpu === null || gpu === undefined ? '—' : gpu.toFixed(0) + '%', mods[1].x + mods[1].w - 6, by + 12, FONT.mono(9), C.text, 'right');
  spark(mods[1].x + 6, by + 20, 116, bh - 26, hist.map((s) => s.gpu || 0), 100, C.green);
  // DISK
  const dr = m.diskR, dw = m.diskW;
  tx(c, dr === null || dr === undefined ? 'R —' : `R ${dr.toFixed(1)}`, mods[2].x + 50, by + 12, FONT.mono(9), C.steel);
  tx(c, dw === null || dw === undefined ? 'W —' : `W ${dw.toFixed(1)}`, mods[2].x + mods[2].w - 6, by + 12, FONT.mono(9), C.copper, 'right');
  const dmax = Math.max(1, ...hist.map((s) => Math.max(s.diskR || 0, s.diskW || 0)));
  spark(mods[2].x + 6, by + 20, 116, bh - 34, hist.map((s) => s.diskR || 0), dmax, C.steel);
  spark(mods[2].x + 6, by + 20, 116, bh - 34, hist.map((s) => s.diskW || 0), dmax, C.copper, false);
  tx(c, 'MB/s', mods[2].x + 6, by + bh - 4, FONT.ui(8), C.faint);
  // PAGE: fps, frame-time histogram with the 16.7 ms line, heap and TT memory
  const pf = STUDIO.perf();
  const md = mods[3];
  tx(c, `${pf.fps} fps`, md.x + md.w - 6, by + 12, FONT.mono(9), pf.fps >= 55 ? C.up : C.warn, 'right');
  const hx = md.x + 6, hy2 = by + 18, hw = 116, hh = bh - 55;
  const bins = FRAMES.bins, bmax = Math.max(1, ...bins), bw2 = hw / bins.length;
  for (let i = 0; i < bins.length; i++) {
    const h = bins[i] > 0 ? Math.max(1, hh * Math.sqrt(bins[i] / bmax)) : 0;
    c.fillStyle = i + 1 > 16.7 ? hexA(C.warn, 0.8) : hexA(C.active, 0.75);
    c.fillRect(hx + i * bw2, hy2 + hh - h, bw2 - 0.8, h);
  }
  const lx = hx + 16.7 * bw2;
  vline(c, lx, hy2 - 2, hy2 + hh + 1, C.gold);
  tx(c, '16.7', lx - 2, hy2 + 5, FONT.mono(7.5), C.gold, 'right');
  tx(c, '0', hx, hy2 + hh + 9, FONT.mono(7.5), C.faint);
  tx(c, 'JS ms / frame', hx + hw / 2, hy2 + hh + 9, FONT.mono(7.5), C.faint, 'center');
  tx(c, `${bins.length}`, hx + hw, hy2 + hh + 9, FONT.mono(7.5), C.faint, 'right');
  tx(c, `\u0394t ${pf.frameMs} \u00b7 JS ${FRAMES.avg.toFixed(1)} ms`, hx, by + bh - 15, FONT.mono(8.5), C.text);
  const ttMB = nThreads() * (S.think ? S.think.opt.hash : OPT.hash);
  const heap = performance.memory && performance.memory.usedJSHeapSize ? performance.memory.usedJSHeapSize / 1048576 : pf.heapMB;
  tx(c, `heap ${heap ? heap.toFixed(0) : 0} MB \u00b7 TT ${ttMB} MB`, hx, by + bh - 4, FONT.mono(8.5), C.mute);
}
// JavaScript time of each frame (core + all panels), 1 ms bins over 0-24 ms, decaying so it follows the run
const FRAMES = { bins: new Array(24).fill(0), avg: 0 };
const RealClock = typeof Object.getPrototypeOf(Date).now === 'function' ? Object.getPrototypeOf(Date) : null;
const jsClock = () => (STUDIO.mode === 'render' && RealClock ? RealClock.now() : performance.now());
function frameCost(ms) {
  if (S.frame < 10) return; // the first frames build fonts and caches
  const b = clamp(Math.floor(ms), 0, FRAMES.bins.length - 1);
  FRAMES.bins[b]++;
  FRAMES.avg = FRAMES.avg ? FRAMES.avg * 0.98 + ms * 0.02 : ms;
  if (S.frame % 600 === 0) for (let i = 0; i < FRAMES.bins.length; i++) FRAMES.bins[i] *= 0.5;
}
function frameSample() {}

// ===================================================================================================
// setup and per-frame
function uiStart() {
  makePanel('top', 8, 8, 1904, 32, 3, 0, drawTop);
  makePanel('board', 8, 48, 560, 600, 2, 1, drawBoard);
  const op = makePanel('options', 8, 656, 560, 132, 6, 4, drawOptions);
  makePanel('tree', 576, 48, 792, 740, 1, 0, drawTree);
  makePanel('output', 1376, 48, 536, 200, 3, 1, drawOutput);
  makePanel('root', 1376, 256, 536, 220, 3, 2, drawRoot);
  makePanel('lanes', 1376, 484, 536, 148, 2, 0, drawLanes);
  makePanel('ordering', 1376, 640, 536, 148, 6, 5, drawOrdering);
  makePanel('record', 8, 796, 560, 276, 6, 3, drawRecord);
  makePanel('evalgraph', 576, 796, 792, 132, 4, 2, drawEvalGraph);
  makePanel('iterations', 576, 936, 792, 136, 3, 0, drawIterations);
  makePanel('machine', 1376, 796, 536, 276, 6, 1, drawMachine);
  optionsInput(op);
  boardTex = makeBoardTexture();
  ringTex = makeRings(PANELS.tree);
  for (const name in PANELS) { const P = PANELS[name]; P.draw(P, 16.7); }
}
let lastNow = 0;
function uiFrame(now) {
  const dt = lastNow ? Math.min(100, now - lastNow) : 16.7;
  lastNow = now;
  frameSample(dt);
  if (S.frame % 30 === 7) aggregateSnaps();
  if (S.anim && S.now - S.anim.t0 < S.anim.dur + 40) PANELS.board.dirty = true;
  if (LOG.scroll > 0.5 || LOG.shown !== S.log.length) PANELS.output.dirty = true;
  for (const name in PANELS) {
    const P = PANELS[name];
    if (P.dirty || (S.frame + P.phase) % P.every === 0) {
      const el = P.last ? now - P.last : dt;
      P.last = now;
      P.dirty = false;
      P.draw(P, el);
    }
  }
}
function aggregateSnaps() {
  const H = S.hist;
  H.fill(0);
  for (const w of W) if (w.hist) for (let i = 0; i < 4096; i++) H[i] += w.hist[i];
}

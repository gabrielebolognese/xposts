// Engine Room: the page side of the engine. Replays the game through the engine's own move generator, runs the
// perft self-test, the depth-7 quick pass and the deep pass (root split over the workers), all metered by frames:
// every frame each worker gets one chunk with a fixed node budget, and every reply is registered with STUDIO.wait.
'use strict';
EngineModule(window);
const E = window.Engine;
const INF = E.INF, MATE_BOUND = E.MATE_BOUND;
const clampN = (x, a, b) => (x < a ? a : x > b ? b : x);

const GAME_TEXT = '1.Nf3 Nf6 2.c4 g6 3.Nc3 Bg7 4.d4 O-O 5.Bf4 d5 6.Qb3 dxc4 7.Qxc4 c6 8.e4 Nbd7 9.Rd1 Nb6 10.Qc5 Bg4 11.Bg5 Na4 ' +
  '12.Qa3 Nxc3 13.bxc3 Nxe4 14.Bxe7 Qb6 15.Bc4 Nxc3 16.Bc5 Rfe8+ 17.Kf1 Be6 18.Bxb6 Bxc4+ 19.Kg1 Ne2+ 20.Kf1 Nxd4+ 21.Kg1 Ne2+ ' +
  '22.Kf1 Nc3+ 23.Kg1 axb6 24.Qb4 Ra4 25.Qxb6 Nxd1 26.h3 Rxa2 27.Kh2 Nxf2 28.Re1 Rxe1 29.Qd8+ Bf8 30.Nxe1 Bd5 31.Nf3 Ne4 ' +
  '32.Qb8 b5 33.h4 h5 34.Ne5 Kg7 35.Kg1 Bc5+ 36.Kf1 Ng3+ 37.Ke1 Bb4+ 38.Kd1 Bb3+ 39.Kc1 Ne2+ 40.Kb1 Nc3+ 41.Kc1 Rc2#';

const BUDGET = 15000;         // search nodes per worker per frame
const PERFT_BUDGET = 60000;   // perft make() calls per frame
const QUICK_CAP = 250000;     // node cap of one quick-pass position
const DEEP_AT = 3000;         // ms after load: the deep pass starts (once the quick pass is done)
const DEEP_START = 27;        // the deep pass starts after 14.Bxe7
const BE6_PLY = 33;           // position after 17.Kf1, Black to move
const SPEC_AHEAD = 4;         // idle workers may start up to this many depths ahead (the PV move is pipelined)
const BG_DEPTH = 10;          // background pass: depth for the positions the deep pass does not reach
const BG_CAP = 1500000;       // node cap of one background position

const OPT = {
  threads: 8, hash: 32, movetime: 7000, aspDelta: 25, nullBase: 3, lmrDiv: 2.25, lmrOn: true, futMargin: 100,
  checkExt: true, seePrune: true, multipv: 3, quickDepth: 7, overlay: 1, treePlies: 4,
};

// ---------------------------------------------------------------------------------------------------
// The game, replayed by matching every SAN move against the engine's own legal moves
const G = (() => {
  const e = E.createEngine();
  e.setFEN(E.START);
  const sans = GAME_TEXT.split(/\s+/).map((s) => s.replace(/^\d+\./, ''));
  const moves = [], fens = [e.getFEN()], legal = [], sanList = [], boards = [new Int8Array(e.board)], checks = [false];
  let ok = true;
  for (const s of sans) {
    const lm = e.legalMoves();
    legal.push(lm.length);
    const m = e.parseSAN(s);
    if (!m) { ok = false; break; }
    sanList.push(e.toSAN(m, lm));
    moves.push(m);
    e.makeMove(m);
    fens.push(e.getFEN());
    boards.push(new Int8Array(e.board));
    checks.push(e.inCheck());
  }
  legal.push(e.legalMoves().length);
  return { e, moves, fens, sans: sanList, legal, boards, checks, ok, plies: moves.length };
})();
// a scratch engine positioned at a ply
const scratch = E.createEngine();
function at(ply) {
  scratch.setFEN(E.START);
  scratch.countNodes = false;
  for (let i = 0; i < ply; i++) scratch.makeMove(G.moves[i]);
  return scratch;
}
function sanAt(ply, m) { const e = at(ply); return e.toSAN(m); }
function pvSan(ply, pv, max) { const e = at(ply); return e.pvToSAN(pv, max); }
const moveNo = (ply) => (ply >> 1) + 1;
const moveLabel = (ply) => moveNo(ply) + (ply % 2 ? '...' : '.');

// ---------------------------------------------------------------------------------------------------
// Workers
const WCOL = ['#4FD1E8', '#9DC07A', '#B98AC9', '#FF9A3C', '#7FA7C4', '#E8D3A7', '#E07A6A', '#D4C65A',
  '#5FB8A8', '#C9A0E0', '#A0C8F0', '#F0B080', '#88D0A0', '#D8A0B0', '#B0B8D0'];
const W = [];
const inbox = [];
let workerURL = null;
function makeWorker(i) {
  if (!workerURL) {
    const src = `(${EngineModule.toString()})(self);\n(${WorkerMain.toString()})(self);\n`;
    workerURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  const w = new Worker(workerURL);
  const rec = {
    i, w, col: WCOL[i], busy: false, jobs: [], resolve: null, nodes: 0, q: 0, used: 0, knps: 0, sel: 0, stack: [], cur: -1,
    busyUsed: 0, busyOffered: 0, hashfull: 0, hist: null, killers: [], occ: null, lastMs: 0, maxMs: 0, sumMs: 0, nMs: 0,
    perft: false, curStart: 0,
  };
  w.onmessage = (ev) => { inbox[i] = ev.data; rec.busy = false; if (rec.resolve) { const r = rec.resolve; rec.resolve = null; r(); } };
  w.onerror = (e) => console.error('worker', i, e.message);
  w.postMessage({ t: 'init', id: i, game: G.moves, hash: OPT.hash });
  W.push(rec);
  return rec;
}

// ---------------------------------------------------------------------------------------------------
// Shared state read by the UI
const S = {
  t0: 0, now: 0, frame: 0,
  nodes: 0, qnodes: 0, searchNodes: 0, npsWin: [], nps: 0, npsPeak: 0, bgWin: [], npsBg: 0, npsDeep: 0,
  st: { probes: 0, hits: 0, cuts: 0, firstCuts: 0, nullTried: 0, nullCuts: 0, lmrTried: 0, lmrRe: 0, fut: 0, checkExt: 0, seePruned: 0, deltaPruned: 0 },
  perft: [], perftOK: null,
  quick: { total: G.plies, done: 0, start: 0, end: 0 },
  bg: { done: 0, nodes: 0, depth: 0, cap: 0, pass: 0 },
  analysis: [],       // per position: {src, depth, score (stm), best, bestSan, pv, played, cpl, cls, glyph, only}
  deep: { active: false, ply: DEEP_START, startT: 0, busyUsed: 0, busyOffered: 0 },
  think: null, thinkId: 0, lastThink: null,
  log: [], lanes: [], iterMarks: [],
  depthMax: 0, seldepthMax: 0, be6: { foundDepth: 0, cand: 0, eval: null, done: false, bestByDepth: [] },
  boardPly: 0, anim: null, // move animation on the board
  hist: new Float32Array(4096), killers: [], occ: [],
};
for (let p = 0; p <= G.plies; p++) S.analysis.push(null);
const ST_KEYS = ['probes', 'hits', 'cuts', 'firstCuts', 'nullTried', 'nullCuts', 'lmrTried', 'lmrRe', 'fut', 'checkExt', 'seePruned', 'deltaPruned'];

// ---------------------------------------------------------------------------------------------------
// Jobs
let jobSeq = 1;
const jobs = new Map();
const pending = [];   // jobs waiting for a worker: {id, kind, prio, ...}
const bgPending = []; // background positions, handed to a worker one at a time (it runs them only when idle)
const cancels = [];   // per worker, ids to cancel with the next message
function addJob(j) { j.id = jobSeq++; jobs.set(j.id, j); pending.push(j); return j; }
function cancelJob(j) {
  if (j.worker >= 0) { (cancels[j.worker] ||= []).push(j.id); const w = W[j.worker]; w.jobs = w.jobs.filter((x) => x !== j.id); }
  const k = pending.indexOf(j);
  if (k >= 0) pending.splice(k, 1);
  j.cancelled = true;
  jobs.delete(j.id);
}

// ---------------------------------------------------------------------------------------------------
// Perft self-test (worker 0) and the quick pass (the others)
const PERFT_SUITE = [
  { name: 'start', fen: E.START, exp: [20, 400, 8902, 197281, 4865609] },
  { name: 'Kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', exp: [48, 2039, 97862, 4085603] },
  { name: 'pos3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', exp: [14, 191, 2812, 43238, 674624] },
];
function initJobs() {
  for (const s of PERFT_SUITE) {
    const row = { name: s.name, depth: s.exp.length, exp: s.exp.at(-1), got: [], ok: null, makes: 0, ms: 0, start: 0, end: 0, prog: 0 };
    S.perft.push(row);
    s.exp.forEach((x, k) => addJob({ kind: 'perft', fen: s.fen, depth: k + 1, expect: x, row, prio: -1, only: 0, worker: -1 }));
  }
  for (let p = 0; p < G.plies; p++) addJob({ kind: 'quick', ply: p, depth: OPT.quickDepth, cap: QUICK_CAP, played: G.moves[p], prio: 5 + p / 100, worker: -1 });
}

// ---------------------------------------------------------------------------------------------------
// Analysis bookkeeping: verdicts, CPL, glyphs
function classify(ply) {
  const a = S.analysis[ply];
  if (!a || a.played === undefined) return;
  a.cpl = Math.min(1000, Math.max(0, a.score - a.played));
  const c = a.cpl;
  a.cls = c <= 10 ? 'best' : c < 20 ? 'excellent' : c < 50 ? 'good' : c < 100 ? 'inaccuracy' : c < 300 ? 'mistake' : 'blunder';
  a.glyph = c <= 10 ? '' : c < 50 ? '' : c < 100 ? '?!' : c < 300 ? '?' : '??';
  if (c <= 10) {
    const sac = sacrifice(ply);
    a.sac = sac.give;
    if (sac.give >= 300 && sac.net <= -300 && a.score >= -30 && a.score <= 300 && (a.found || 0) >= 4) a.glyph = '!!';
    else if (a.only) a.glyph = '!';
  }
}
// material the move gives up (by SEE) compared with the mover's safest alternative: for every legal move,
// M = value captured by the move - the opponent's best capture gain afterwards (SEE). A sacrifice gives up at least
// 300 more than the safest alternative (give = max M - M(played)) and leaves the mover at least 300 down (net = M)
const sacCache = new Map();
function sacrifice(ply) {
  if (sacCache.has(ply)) return sacCache.get(ply);
  const e = at(ply);
  const moves = e.legalMoves();
  let best = -1e9, played = 0;
  for (const m of moves) {
    const to = (m >> 7) & 127;
    const vic = m & E.F_EP ? 1 : e.board[to] & 7;
    const promo = (m >> 14) & 7;
    const capV = (m & E.F_CAP ? E.SEE_VAL[vic] : 0) + (promo ? E.SEE_VAL[promo] - E.SEE_VAL[1] : 0);
    e.makeMove(m);
    const opp = e.legalMoves().length ? Math.max(0, e.bestCaptureSEE()) : 0;
    e.unmakeMove();
    const M = capV - opp;
    if (M > best) best = M;
    if (m === G.moves[ply]) played = M;
  }
  const v = { give: moves.length > 1 ? best - played : 0, net: played };
  sacCache.set(ply, v);
  return v;
}
function whiteCp(ply) {
  const a = S.analysis[ply];
  if (!a) return null;
  return ply % 2 ? -a.score : a.score;
}
function finalPosition() {
  // position 82: White is mated
  S.analysis[G.plies] = { src: 'mate', depth: 0, score: -E.MATE, best: 0, bestSan: '', pv: [], mate: true };
}

// ---------------------------------------------------------------------------------------------------
// Logging (engine output panel)
function thinkNodes() { const T = S.think; return T ? T.live || 0 : 0; }
function thinkNps() { const T = S.think; return T && S.now > T.start ? Math.round((T.live || 0) * 1000 / (S.now - T.start)) : 0; }
function logLine(kind, cells) { S.logTotal = (S.logTotal || 0) + 1; S.log.push({ kind, cells, t: S.now }); if (S.log.length > 400) S.log.splice(0, S.log.length - 400); }

// ---------------------------------------------------------------------------------------------------
// The tree of the current think (plies <= treePlies)
function newTree(T) {
  const root = { m: 0, ply: 0, parent: null, kids: [], map: new Map(), nodes: 0, eff: 0, sumKids: 0, score: 0, type: -1, cut: -1, legal: 0,
    a: 0, ta: 0, span: Math.PI * 2, r: 0, born: S.now, act: -1, actT: 0, san: '' };
  T.tree = { root, count: 0, perPly: [0, 0, 0, 0, 0, 0], pv: 0, cut: 0, all: 0, pruned: 0 };
  for (const mv of T.moves) { const n = treeNode(T, root, mv.m); n.san = mv.san; n.mv = mv; mv.node = n; }
}
function treeNode(T, parent, m) {
  let n = parent.map.get(m);
  if (n) return n;
  n = { m, ply: parent.ply + 1, parent, kids: [], map: new Map(), nodes: 0, eff: 0, sumKids: 0, score: 0, type: -1, cut: -1, legal: 0,
    a: parent.a, ta: parent.a, span: 0, r: 0, born: S.now, act: -1, actT: 0 };
  parent.map.set(m, n);
  parent.kids.push(n);
  T.tree.count++;
  T.tree.perPly[n.ply]++;
  return n;
}
// eff = max(own subtree count, sum of the children's eff), kept up to date incrementally
function effUp(n) {
  for (;;) {
    const e = n.nodes > n.sumKids ? n.nodes : n.sumKids;
    const d = e - n.eff;
    if (!d) return;
    n.eff = e;
    const p = n.parent;
    if (!p) return;
    p.sumKids += d;
    n = p;
  }
}
function applyDeltas(T, flat) {
  const tr = T.tree;
  for (let k = 0; k < flat.length; k += 11) {
    const ply = flat[k];
    if (ply > OPT.treePlies && ply > 4) continue;
    let n = tr.root;
    for (let i = 0; i < ply; i++) n = treeNode(T, n, flat[k + 1 + i]);
    n.nodes += flat[k + 6];
    effUp(n);
    n.score = flat[k + 7];
    const type = flat[k + 8];
    if (n.type !== type) {
      if (n.type === 0) tr.pv--; else if (n.type === 1) { tr.cut--; tr.pruned -= Math.max(0, n.legal - n.cut - 1); } else if (n.type === 2) tr.all--;
      if (type === 0) tr.pv++; else if (type === 1) tr.cut++; else if (type === 2) tr.all++;
      n.type = type;
    } else if (type === 1) tr.pruned -= Math.max(0, n.legal - n.cut - 1);
    n.cut = flat[k + 9];
    n.legal = flat[k + 10];
    if (type === 1) tr.pruned += Math.max(0, n.legal - n.cut - 1);
  }
}

// ---------------------------------------------------------------------------------------------------
// Deep think: root split coordinator
function startThink(ply) {
  const e = at(ply);
  const lm = e.legalMoves();
  const T = {
    id: ++S.thinkId, ply, start: S.now, end: S.now + OPT.movetime, side: ply % 2, opt: { ...OPT },
    moves: lm.map((m) => ({ m, san: e.toSAN(m, lm), nodes: 0, iterNodes: 0, prevNodes: 0, score: null, lb: -INF, ub: INF, exact: false,
      depth: 0, owner: -1, prevOwner: -1, type: '', job: null, prevVal: -INF, prevBound: 0, played: m === G.moves[ply], pv: [m], lastExact: null, specs: new Map(), specJobs: new Map() })),
    depth: 0, completed: 0, iters: [], phase: 'id', best: null, bestScore: 0, pv: [], pvSan: [], alpha: -INF, alphaS: -INF,
    asp: { lo: -INF, hi: INF, delta: OPT.aspDelta, fails: 0 }, iterStart: S.now, iterNodes: 0, iterFails: 0, nodes: 0, sel: 0,
    playedScore: null, bestByDepth: [], done: false, specAsp: new Map(), specPV: new Map(), specAlphaS: new Map(), specNodes: new Map(), splitOwner: new Map(),
  };
  T.playedMv = T.moves.find((x) => x.played) || null;
  newTree(T);
  S.think = T;
  S.boardPly = ply;
  logLine('pos', [['position', 'mute'], [` startpos moves … ${moveLabel(ply - 1)}${G.sans[ply - 1] || ''}`, 'text'], ['  go movetime ' + OPT.movetime, 'mute']]);
  if (!lm.length) { T.phase = 'done'; return; }
  addJob({ kind: 'id', think: T.id, ply, depthMax: 4, prio: 0, worker: -1, T });
}
function rootOrder(T) {
  T.moves.sort((a, b) => (b === T.best) - (a === T.best) || b.prevNodes - a.prevNodes || b.prevVal - a.prevVal);
}
function moveJob(T, mv, type, alpha, beta, prio, depth) {
  const d = depth || T.depth;
  const spec = d > T.depth;
  const j = addJob({ kind: 'move', think: T.id, ply: T.ply, m: mv.m, depth: d, alpha, beta, type, prio, worker: -1, T, mv,
    pref: mv.owner >= 0 ? mv.owner : mv.prevOwner, spec, front: prio <= 1.5 });
  if (spec) mv.specJobs.set(d, j); else mv.job = j;
  return j;
}
function newBounds() { return { lb: -INF, ub: INF, exact: false, score: null, pv: null, nodes: 0 }; }
function startIteration(T, d) {
  T.liveAtIter = T.live || 0;
  T.depth = d; T.iterStart = S.now; T.iterNodes = T.specNodes.get(d) || 0; T.specNodes.delete(d); T.iterFails = 0; T.phase = 'split';
  rootOrder(T);
  const prev = T.bestScore, delta = T.opt.aspDelta;
  const vals = T.moves.map((x) => x.prevVal).sort((a, b) => b - a);
  const sK = vals[Math.min(T.opt.multipv, vals.length) - 1];
  T.alphaS = Math.max(-INF + 1, Math.min(sK, prev) - delta);
  T.asp = { lo: Math.max(-INF, prev - delta), hi: Math.min(INF, prev + delta), delta, fails: 0, center: prev, open: false };
  if (Math.abs(prev) >= MATE_BOUND) T.asp = { lo: -INF, hi: INF, delta, fails: 0, center: prev, open: true };
  T.pvMove = T.moves[0];
  const sa = T.specAsp.get(d);
  if (sa && T.specPV.get(d) === T.pvMove) {
    const spj = T.pvMove.specJobs.get(d);
    if (sa.open || (sa.lo < prev && prev < sa.hi)) { T.asp = { ...sa }; T.iterFails = sa.fails; }
    else if (spj && spj.type === 'pv') { cancelJob(spj); T.pvMove.specJobs.delete(d); }
  }
  T.specAsp.delete(d); T.specPV.delete(d); T.specAlphaS.delete(d);
  const mpvN = Math.max(0, Math.min(T.opt.multipv, T.moves.length) - 1);
  // the next best moves by the best evidence of the last depth: an exact score, else a lower bound, else the
  // fail-soft upper bound (a scout's returned value, a fair estimate)
  const mpvVal = (m) => (m.prevExact !== null && m.prevExact !== undefined ? m.prevExact
    : m.prevLb !== undefined && m.prevLb > -INF ? m.prevLb : m.prevUb !== undefined && m.prevUb < INF ? m.prevUb - 1 : m.prevVal - 1);
  const mpv = T.moves.filter((m) => m !== T.pvMove).sort((a, b) => mpvVal(b) - mpvVal(a)).slice(0, mpvN);
  for (const m of T.moves) m.mpv = mpv.includes(m);
  for (const mv of T.moves) {
    const s = mv.specs.get(d);
    mv.lb = s ? s.lb : -INF; mv.ub = s ? s.ub : INF; mv.exact = s ? s.exact : false;
    if (s && s.exact) { mv.score = s.score; mv.pv = s.pv; }
    mv.iterNodes = s ? s.nodes : 0;
    mv.tries = 0;
    mv.job = mv.specJobs.get(d) || null;
    mv.specs.delete(d); mv.specJobs.delete(d);
  }
  // 2. PV job with the aspiration window; 3. every other move at once as a null-window scout at alphaS
  if (!T.pvMove.job && !T.pvMove.exact) pvJob(T, T.pvMove);
  for (let k = 1; k < T.moves.length; k++) {
    const mv = T.moves[k];
    if (mv.mpv && !mv.mpvJob) { mv.mpvTries = 0; mpvJob(T, mv, mv.prevExact); }
    if (mv.job || mv.exact) continue;
    if (mv.lb === -INF && mv.ub === INF) moveJob(T, mv, 'scout', T.alphaS, T.alphaS + 1, 2 + k / 1000);
  }
  S.iterMarks.push({ t: S.now, d });
  if (S.iterMarks.length > 200) S.iterMarks.shift();
}
// PV job: aspiration window, widened (delta doubled) when the known bounds fall outside it; open after 3 fails
// MultiPV lines 2..K: an exact-window search per move and depth that runs beside the root split without holding the
// iteration back (the move is still resolved by its scout); its info line is printed when it returns
function mpvJob(T, mv, center) {
  const tries = mv.mpvTries || 0;
  let lo = -INF, hi = INF;
  if (center !== null && center !== undefined && Math.abs(center) < MATE_BOUND && tries < 3) {
    const wd = T.opt.aspDelta * Math.pow(2, tries);
    lo = center - wd; hi = center + wd;
  }
  const j = addJob({ kind: 'move', think: T.id, ply: T.ply, m: mv.m, depth: T.depth, alpha: lo, beta: hi, type: 'exact', prio: 3.5, worker: -1, T, mv,
    pref: mv.owner >= 0 ? mv.owner : mv.prevOwner, spec: false, mpv: true, front: false, center });
  mv.mpvJob = j;
  return j;
}
function onMpvResult(T, j, r) {
  const mv = j.mv;
  mv.mpvJob = null;
  mv.nodes += r.nodes; T.nodes += r.nodes;
  if (r.sel > T.sel) T.sel = r.sel;
  const v = r.score;
  if (v > j.alpha && v < j.beta) {
    mv.mpvScore = v; mv.mpvDepth = j.depth; mv.mpvPv = r.pv;
    if (j.depth === T.depth && !mv.exact) { mv.lb = mv.ub = v; mv.exact = true; mv.score = v; mv.pv = r.pv; mv.lastExact = v; }
    // its rank among the exact scores of that depth
    // rank among every score known at that depth (exact scores, MultiPV results, the best move's last score)
    const ov = (o) => (o.mpvDepth === j.depth ? o.mpvScore : j.depth === T.depth && o.exact ? o.score : o === T.best ? T.bestScore : -INF);
    const k = 1 + T.moves.filter((o) => o !== mv && ov(o) > v).length;
    if (j.depth < T.completed) return; // a late result of an older depth is not printed after newer lines
    logLine('multi', [['' + j.depth, 'num'], ['' + T.sel, 'num'], ['' + Math.min(k, T.opt.multipv), 'mute'], [fmtScore(v), 'score'], [thinkNodes(), 'nodes'],
      [thinkNps(), 'nps'], [avgHashfull(), 'num'], [Math.round(S.now - T.start), 'num'], [pvSan(T.ply, r.pv, 6).join(' '), 'pv2']]);
    return;
  }
  // outside its window: widen around the score found, at the current depth, while the move is still a MultiPV move
  if (j.depth !== T.depth || !mv.mpv) return;
  mv.mpvTries = (mv.mpvTries || 0) + 1;
  mpvJob(T, mv, v);
}
function pvJob(T, mv) {
  const a = T.asp;
  if (mv.ub < INF && mv.ub <= a.lo) { a.fails++; T.iterFails++; a.delta *= 2; a.lo = a.fails >= 3 || a.open ? -INF : Math.max(-INF, mv.ub - a.delta); }
  if (mv.lb > -INF && mv.lb >= a.hi) { a.fails++; T.iterFails++; a.delta *= 2; a.hi = a.fails >= 3 || a.open ? INF : Math.min(INF, mv.lb + a.delta); }
  if (T.depth >= SPLIT_MIN_DEPTH) pvSplit(T, mv, a.lo, a.hi);
  else moveJob(T, mv, 'pv', a.lo, a.hi, 0);
}
function applyBounds(b, j, r) {
  const v = r.score;
  if (v <= j.alpha) { b.ub = v; if (b.lb > v) b.lb = -INF; }
  else if (v >= j.beta) { b.lb = v; if (b.ub < v) b.ub = INF; }
  else { b.lb = b.ub = v; }
  b.exact = b.lb === b.ub;
  if (b.exact) { b.score = v; b.pv = r.pv; }
}
function onMoveResult(T, j, r) {
  const mv = j.mv;
  mv.nodes += r.nodes; T.nodes += r.nodes;
  if (r.sel > T.sel) T.sel = r.sel;
  mv.owner = j.worker;
  const v = r.score;
  const low = v <= j.alpha, high = v >= j.beta;
  if (j.depth > T.depth) {
    // speculative result for a later depth: kept as its bounds until that iteration starts
    mv.specJobs.delete(j.depth);
    let s = mv.specs.get(j.depth);
    if (!s) mv.specs.set(j.depth, (s = newBounds()));
    applyBounds(s, j, r);
    s.nodes += r.nodes;
    T.specNodes.set(j.depth, (T.specNodes.get(j.depth) || 0) + r.nodes);
    const a = T.specAsp.get(j.depth);
    if (j.type === 'pv' && a && (low || high)) {
      a.fails++; a.delta *= 2;
      if (low) a.lo = a.fails >= 3 || a.open ? -INF : Math.max(-INF, v - a.delta); else a.hi = a.fails >= 3 || a.open ? INF : Math.min(INF, v + a.delta);
    }
    return;
  }
  if (j.depth !== T.depth) return;
  mv.job = null;
  mv.iterNodes += r.nodes; T.iterNodes += r.nodes;
  mv.type = j.type;
  mv.tries = (mv.tries || 0) + 1;
  if (mv.exact && mv.mpv && j.type === 'scout') { /* keep the exact MultiPV score */ }
  else if (mv.tries > 6 && j.type !== 'pv') { mv.lb = mv.ub = r.score; mv.exact = true; mv.score = r.score; mv.pv = r.pv; }
  else applyBounds(mv, j, r);
  if (mv.exact) mv.lastExact = v;
  if (j.type === 'pv' && (low || high)) {
    logLine('fail', [['' + T.depth, 'num'], ['' + T.sel, 'num'], ['1', 'mute'], [(low ? '≤' : '≥') + fmtScore(v), 'warn'], [thinkNodes(), 'nodes'],
      [thinkNps(), 'nps'], [avgHashfull(), 'num'], [Math.round(S.now - T.start), 'num'], [(low ? 'upperbound ' : 'lowerbound ') + mv.san, 'warn']]);
  }
}
function idleWorkers() {
  let n = 0;
  for (let i = 0; i < nThreads(); i++) if (!W[i].perft && queueEst(W[i]) < 1.5 * BUDGET) n++;
  for (const j of pending) if (j.kind === 'move' || j.kind === 'move2') n--;
  return n;
}
function advance(T) {
  if (T.phase !== 'split') return;
  let alpha = -INF, bestMv = null;
  for (const mv of T.moves) if (mv.exact && mv.score > alpha) { alpha = mv.score; bestMv = mv; }
  T.alpha = alpha;
  let all = true;
  for (const mv of T.moves) {
    if (mv.job) { all = false; continue; }
    if (mv.exact) continue;
    if (alpha > -INF && mv.ub <= alpha) {
      // 6. the move played in the game always gets an exact score
      if (mv.played) { moveJob(T, mv, 'exact', -INF, mv.ub + 1, 1.5); all = false; }
      continue;
    }
    all = false;
    if (mv === T.pvMove) pvJob(T, mv);
    else if (mv.lb > -INF && mv.lb > alpha) {
      // 5. a scout above alpha gets a full-window re-search for an exact score
      const lo = alpha > -INF ? alpha : Math.min(T.alphaS, mv.lb - 1);
      moveJob(T, mv, 'research', lo, INF, 1);
    } else if (alpha > -INF) {
      // 4. a scout below alphaS is resolved once alpha >= alphaS, otherwise re-scouted at alpha
      moveJob(T, mv, 'scout', alpha, alpha + 1, 3);
    }
  }
  if (all) { completeIteration(T, bestMv, alpha); return; }
  const pj = T.pvMove && T.pvMove.job;
  if (pj && pj.composite && !pj.done && pj.phase === 'first') advanceSplit(T, pj);
  speculate(T, alpha, bestMv);
}
// 8. idle workers do not wait for the slowest root move: they start the next depths (up to 2 ahead) on moves whose
// result at the depth before is known or very likely (exact, or below the scout bound)
function specView(T, mv, s) {
  if (s - 1 === T.depth) return mv;
  return mv.specs.get(s - 1) || null;
}
function speculate(T, alpha, bestMv) {
  let idle = idleWorkers();
  if (idle <= 0) return;
  const delta = T.opt.aspDelta;
  for (let s = T.depth + 1; s <= T.depth + SPEC_AHEAD && s <= 48 && idle > 0; s++) {
    let lead, center;
    if (s - 1 === T.depth) { lead = bestMv || T.pvMove; center = alpha > -INF ? alpha : T.bestScore; }
    else {
      lead = T.specPV.get(s - 1);
      if (!lead) break;
      let best = -INF;
      for (const mv of T.moves) { const b = mv.specs.get(s - 1); if (b && b.exact && b.score > best) { best = b.score; lead = mv; } }
      if (best === -INF) {
        // the depth before is still running: pipeline on its window centre (the score has been stable)
        const b = lead.specs.get(s - 1), pa = T.specAsp.get(s - 1);
        center = b && b.exact ? b.score : pa ? pa.center : T.bestScore;
      } else center = best;
    }
    if (!T.specAlphaS.has(s)) {
      const vals = T.moves.map((x) => { const b = specView(T, x, s); return b ? (b.exact ? b.score : b.ub < INF ? b.ub : x.prevVal) : x.prevVal; }).sort((a, b) => b - a);
      const sK = vals[Math.min(T.opt.multipv, vals.length) - 1];
      T.specAlphaS.set(s, Math.max(-INF + 1, Math.min(sK, center) - delta));
    }
    const aS = T.specAlphaS.get(s);
    const lowRef = s - 1 === T.depth ? Math.max(alpha, T.alphaS) : T.specAlphaS.get(s - 1);
    if (!T.specPV.has(s)) {
      T.specPV.set(s, lead);
      const big = Math.abs(center) >= MATE_BOUND;
      const a = { lo: big ? -INF : center - delta, hi: big ? INF : center + delta, delta, fails: 0, center, open: big };
      T.specAsp.set(s, a);
      if (!lead.specJobs.has(s) && !lead.specs.has(s)) { moveJob(T, lead, 'pv', a.lo, a.hi, 6 + (s - T.depth), s); idle--; }
    }
    for (const mv of T.moves) {
      if (idle <= 0) break;
      if (mv === lead || mv.specs.has(s) || mv.specJobs.has(s)) continue;
      const b = specView(T, mv, s);
      if (!b) continue;
      const likely = b.exact || (b.ub < INF && b.ub <= lowRef) || (alpha > -INF && s - 1 === T.depth && b.ub <= alpha);
      if (!likely) continue;
      moveJob(T, mv, 'scout', aS, aS + 1, 7 + (s - T.depth) * 2 + T.moves.indexOf(mv) / 1000, s);
      idle--;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// PV split: the PV move's own replies are searched in parallel once the first reply has set the bound
// (young brothers wait). Scores are from the root side; the move's score is the minimum over its replies.
const SPLIT_MIN_DEPTH = 6;
function pvSplit(T, mv, lo, hi) {
  const d = T.depth;
  const e = at(T.ply);
  e.makeMove(mv.m);
  const lm = e.legalMoves();
  const chk = e.inCheck();
  const first = mv.pv && mv.pv.length > 1 ? mv.pv[1] : 0;
  const reps = lm.map((r) => ({ r, san: '', lb: -INF, ub: INF, exact: false, score: null, job: null, pv: null,
    ord: (r === first ? 1e6 : 0) + (r & E.F_CAP ? 1000 + E.SEE_VAL[e.board[(r >> 7) & 127] & 7] : 0) + ((r >> 14) & 7) * 100 }));
  for (const rep of reps) { rep.san = e.toSAN(rep.r, lm); rep.quiet = !(rep.r & E.F_CAP) && !((rep.r >> 14) & 7) && !rep.san.includes('+'); rep.full = false; }
  e.unmakeMove();
  reps.sort((a, b) => b.ord - a.ord);
  reps.forEach((rep, i) => { rep.idx = i; });
  if (!reps.length) {
    // the move mates or stalemates: no search needed
    onMoveResult(T, { mv, depth: d, alpha: lo, beta: hi, type: 'pv', worker: mv.owner }, { score: chk ? E.MATE - 1 : 0, pv: [mv.m], nodes: 0, sel: 1 });
    return null;
  }
  const comp = { composite: true, kind: 'split', type: 'pv', T, mv, depth: d, alpha: lo, beta: hi, gd: d - 2 + (chk && T.opt.checkExt ? 1 : 0),
    reps, phase: 'first', betaMin: hi, nodes: 0, sel: 0, worker: -1, running: 0, done: false };
  mv.job = comp;
  T.lastSplit = comp;
  splitJob(T, comp, reps[0], lo, hi, 'pv', 0);
  return comp;
}
function splitJob(T, comp, rep, a, b, type, prio) {
  const key = comp.mv.m + ',' + rep.r;
  const pref = T.splitOwner.has(key) ? T.splitOwner.get(key) : comp.mv.owner;
  let depth = comp.gd, reduced = false;
  if (type === 'scout' && T.opt.lmrOn && !rep.full && rep.quiet && rep.idx >= 3 && comp.depth - 1 >= 3) {
    const d1 = comp.depth - 1;
    let r = Math.floor(0.75 + Math.log(d1) * Math.log(rep.idx) / T.opt.lmrDiv);
    r = Math.min(r, d1 - 2);
    if (r > 0) { depth = comp.gd - r; reduced = true; }
  }
  const j = addJob({ kind: 'move2', think: T.id, ply: T.ply, m: comp.mv.m, m2: rep.r, depth, alpha: a, beta: b, type, prio, worker: -1,
    T, mv: comp.mv, comp, rep, pref, front: true, san2: rep.san, reduced });
  rep.job = j;
  comp.running++;
  return j;
}
function onSplitResult(T, j, r) {
  const comp = j.comp, rep = j.rep;
  rep.job = null;
  comp.running--;
  comp.nodes += r.nodes;
  T.splitOwner.set(comp.mv.m + ',' + rep.r, j.worker);
  if (r.sel > comp.sel) comp.sel = r.sel;
  comp.worker = j.worker;
  if (comp.done) return;
  rep.tries = (rep.tries || 0) + 1;
  if (j.reduced) {
    // a reduced scout that stays at or above betaMin is accepted (as LMR does); otherwise search it at full depth
    if (r.score >= j.beta) { rep.lb = Math.max(rep.lb, r.score); if (rep.ub < rep.lb) rep.ub = INF; rep.exact = false; }
    else rep.full = true;
  } else if (rep.tries > 4) { rep.lb = rep.ub = r.score; rep.exact = true; rep.score = r.score; rep.pv = r.pv; }
  else applyBounds(rep, j, r);
  advanceSplit(T, comp);
}
function advanceSplit(T, comp) {
  const lo = comp.alpha, hi = comp.beta;
  let U = INF, Urep = null;
  for (const rep of comp.reps) if (rep.ub < U) { U = rep.ub; Urep = rep; }
  if (U <= lo) return finishSplit(T, comp, U, Urep);
  if (comp.phase === 'first') {
    if (comp.reps[0].job) {
      // young brothers wait, unless workers are idle: then they scout the other replies at the expected score
      let idle = idleWorkers();
      if (idle <= 0) return;
      const g = clampN(T.bestScore, lo + 1, hi);
      for (const rep of comp.reps) {
        if (idle <= 0) break;
        if (rep === comp.reps[0] || rep.job || rep.lb > -INF || rep.ub < INF) continue;
        splitJob(T, comp, rep, g - 1, g, 'scout', 2.5);
        idle--;
      }
      return;
    }
    comp.phase = 'split';
  }
  comp.betaMin = Math.min(hi, U);
  let all = true;
  for (const rep of comp.reps) {
    if (rep.job) { all = false; continue; }
    if (rep.lb >= comp.betaMin) continue;
    if (rep === Urep && rep.exact) continue;
    all = false;
    if (rep === Urep) splitJob(T, comp, rep, lo, Math.min(hi, rep.ub + 1), 'research', 1);
    else if (rep.ub < comp.betaMin) splitJob(T, comp, rep, lo, comp.betaMin, 'research', 1);
    else splitJob(T, comp, rep, comp.betaMin - 1, comp.betaMin, 'scout', 2);
  }
  if (!all) return;
  if (U < hi) return finishSplit(T, comp, U, Urep);
  let L = INF;
  for (const rep of comp.reps) L = Math.min(L, rep.lb);
  finishSplit(T, comp, L, null);
}
function finishSplit(T, comp, v, rep) {
  comp.done = true;
  for (const r2 of comp.reps) if (r2.job) { cancelJob(r2.job); r2.job = null; }
  comp.mv.job = null;
  // the move's own tree node (searched on the page, not by a worker): node type from the child's side
  const n = comp.mv.node;
  if (n && T.tree) {
    const tr = T.tree;
    const type = v <= comp.alpha ? 1 : v >= comp.beta ? 2 : 0;
    if (n.type === 0) tr.pv--; else if (n.type === 1) tr.cut--; else if (n.type === 2) tr.all--;
    if (type === 0) tr.pv++; else if (type === 1) tr.cut++; else tr.all++;
    n.type = type; n.score = -v; n.legal = comp.reps.length; n.cut = type === 1 ? 0 : -1;
  }
  const pv = rep && rep.pv ? rep.pv : [comp.mv.m];
  onMoveResult(T, { mv: comp.mv, depth: comp.depth, alpha: comp.alpha, beta: comp.beta, type: 'pv', worker: comp.worker },
    { score: v, pv, nodes: comp.nodes, sel: comp.sel });
}
function completeIteration(T, bestMv, alpha) {
  const d = T.depth;
  const prevIter = T.iters.at(-1);
  const changed = !T.best || T.best !== bestMv;
  T.best = bestMv; T.bestScore = alpha; T.completed = d;
  T.pv = bestMv.pv; T.pvSan = pvSan(T.ply, T.pv, 16);
  if (T.playedMv) T.playedScore = T.playedMv.exact ? T.playedMv.score : T.playedMv.ub;
  const it = iterRow(T, d, T.live || 0, S.now - T.start, alpha, T.iterFails, bestMv, changed, T.iterNodes);
  T.iters.push(it);
  T.bestByDepth.push({ d, san: bestMv.san, score: alpha, changed });
  for (const mv of T.moves) {
    mv.prevExact = mv.exact ? mv.score : null;
    mv.prevLb = mv.lb; mv.prevUb = mv.ub;
    mv.prevVal = mv.exact ? mv.score : mv.ub;
    mv.prevBound = mv.exact ? 0 : 2;
    mv.prevNodes = mv.iterNodes;
    mv.prevOwner = mv.owner;
    mv.depth = d;
  }
  if (d > S.depthMax) S.depthMax = d;
  if (T.sel > S.seldepthMax) S.seldepthMax = T.sel;
  // info lines: MultiPV exact scores
  const ex = T.moves.filter((x) => x.exact).sort((a, b) => b.score - a.score).slice(0, T.opt.multipv);
  ex.forEach((mv, k) => {
    const pv = mv === bestMv ? T.pvSan.slice(0, 8) : pvSan(T.ply, mv.pv, 6);
    logLine(k === 0 && changed && d > 1 ? 'new' : k === 0 ? 'info' : 'multi', [['' + d, 'num'], ['' + T.sel, 'num'], ['' + (k + 1), 'mute'],
      [fmtScore(mv.score), 'score'], [thinkNodes(), 'nodes'], [thinkNps(), 'nps'], [avgHashfull(), 'num'], [Math.round(S.now - T.start), 'num'], [pv.join(' '), k === 0 ? 'pv' : 'pv2']]);
  });
  if (T.ply === BE6_PLY) {
    const isBe6 = bestMv.m === G.moves[BE6_PLY];
    if (isBe6 && !S.be6.cand) S.be6.cand = d;
    if (!isBe6) S.be6.cand = 0;
    if (T.playedMv && T.playedMv.exact) S.be6.eval = T.playedMv.score;
    S.be6.bestByDepth = T.bestByDepth;
  }
  if (d >= 48) { T.phase = 'idle'; return; }
  startIteration(T, d + 1);
}
// one row of the iteration table: cumulative nodes and time of this think when depth d was resolved (the UCI scope),
// and the nodes searched for depth d itself by all workers (speculative and split jobs included), used for the EBF
function iterRow(T, d, cum, t, score, fails, bestMv, changed, dnodes) {
  const prevIter = T.iters.at(-1);
  t = Math.max(1, t);
  const dn = Math.max(1, dnodes);
  return { d, t, cum, dn, knps: cum / t, ebf: prevIter && prevIter.cum ? cum / prevIter.cum : 0, score, fails, best: bestMv.san,
    pv: T.pvSan.slice(0, 6), changed, sel: T.sel };
}
function onIDResult(T, j, r) {
  const base = Math.max(0, (T.live || 0) - r.nodes);
  let acc = 0;
  for (const x of r.depths) {
    const mvBest = T.moves.find((m) => m.m === x.best);
    T.depth = x.d;
    for (const [m, score, bound, nodes] of x.rm) {
      const mv = T.moves.find((q) => q.m === m);
      mv.iterNodes = nodes; mv.nodes += nodes; mv.owner = j.worker; mv.type = 'ID';
      mv.exact = bound === 0; mv.score = score; mv.lb = bound === 2 ? -INF : score; mv.ub = bound === 1 ? INF : score;
      if (mv.exact) mv.lastExact = score;
    }
    T.iterNodes = x.nodes; T.nodes += x.nodes;
    T.sel = Math.max(T.sel, x.sel);
    mvBest.pv = x.pv; mvBest.exact = true; mvBest.score = x.score;
    acc += x.nodes;
    completeIterationID(T, mvBest, x.score, acc / r.nodes, base + acc, x.nodes);
  }
  startIteration(T, 5);
}
function completeIterationID(T, bestMv, score, frac, cum, dnodes) {
  const d = T.depth;
  const changed = !T.best || T.best !== bestMv;
  T.best = bestMv; T.bestScore = score; T.completed = d;
  T.pv = bestMv.pv; T.pvSan = pvSan(T.ply, T.pv, 16);
  if (T.playedMv) T.playedScore = T.playedMv.exact ? T.playedMv.score : T.playedMv.ub;
  const it = iterRow(T, d, cum, Math.max(1, (S.now - T.start) * frac), score, 0, bestMv, changed, dnodes);
  T.iters.push(it);
  T.bestByDepth.push({ d, san: bestMv.san, score, changed });
  for (const mv of T.moves) {
    mv.prevExact = mv.exact ? mv.score : null; mv.prevLb = mv.lb; mv.prevUb = mv.ub;
    mv.prevVal = mv.exact ? mv.score : mv.ub; mv.prevNodes = mv.iterNodes; mv.prevOwner = mv.owner; mv.depth = d;
  }
  logLine(changed && d > 1 ? 'new' : 'info', [['' + d, 'num'], ['' + T.sel, 'num'], ['1', 'mute'], [fmtScore(score), 'score'], [cum, 'nodes'],
    [Math.round(cum * 1000 / it.t), 'nps'], [avgHashfull(), 'num'], [Math.round(it.t), 'num'], [T.pvSan.slice(0, 8).join(' '), 'pv']]);
  if (T.ply === BE6_PLY) {
    const isBe6 = bestMv.m === G.moves[BE6_PLY];
    if (isBe6 && !S.be6.cand) S.be6.cand = d;
    if (!isBe6) S.be6.cand = 0;
    S.be6.bestByDepth = T.bestByDepth;
  }
}
function finishThink(T) {
  for (const w of W) { const j = jobs.get(w.cur); if (j && j.T === T) { j.start = Math.max(j.start || 0, w.curStart); laneAdd(j, w, true); } }
  for (const j of [...jobs.values()]) if (j.T === T) cancelJob(j);
  for (const mv of T.moves) { mv.job = null; mv.mpvJob = null; mv.specJobs.clear(); }
  T.done = true;
  T.phase = 'done';
  T.finishedAt = S.now;
  // incomplete last iteration is discarded: the result is the last fully resolved depth
  if (T.best) {
    const ponder = T.pvSan[1] || '';
    logLine('best', [['bestmove ', 'mute'], [T.best.san, 'best'], [ponder ? '  ponder ' : '', 'mute'], [ponder, 'text'],
      [`   d${T.completed}  ${fmtScore(T.bestScore)}  ${fmtCount(T.live || 0)} nodes`, 'mute']]);
    let found = T.completed;
    for (let k = T.bestByDepth.length - 1; k >= 0 && T.bestByDepth[k].san === T.best.san; k--) found = T.bestByDepth[k].d;
    const a = { src: 'deep', depth: T.completed, score: T.bestScore, best: T.best.m, bestSan: T.best.san, pv: T.pv, pvSan: T.pvSan,
      played: T.playedScore !== null ? T.playedScore : T.bestScore, only: false, nodes: T.live || T.nodes, sel: T.sel, found };
    const others = T.moves.filter((x) => x !== T.best);
    const second = others.length ? Math.max(...others.map((x) => (x.exact ? x.score : x.ub))) : -INF;
    a.only = others.length > 0 && second <= T.bestScore - 150 && Math.abs(T.bestScore) < MATE_BOUND;
    S.analysis[T.ply] = a;
    classify(T.ply);
    if (T.ply === BE6_PLY) {
      S.be6.foundDepth = S.be6.cand;
      S.be6.done = true;
      if (T.playedScore !== null) S.be6.eval = T.playedScore;
    }
  }
  S.lastThink = T;
}

function fmtScore(v) {
  if (v === null || v === undefined) return '';
  if (Math.abs(v) >= MATE_BOUND) { const n = Math.ceil((E.MATE - Math.abs(v)) / 2); return (v > 0 ? '#' : '#-') + n; }
  return (v >= 0 ? '+' : '') + v;
}
function fmtCount(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return '' + Math.round(n);
}
// workers in use: the current think's Threads option (changes apply from the next think)
function nThreads() { return Math.min(S.think ? S.think.opt.threads : OPT.threads, W.length); }
// hashfull of the current think: current-age entries over all workers (a worker not yet in this think counts 0),
// so within one think the value only grows
function avgHashfull() {
  const T = S.think, n = nThreads();
  let s = 0;
  for (let i = 0; i < n; i++) if (!T || W[i].hfThink === T.id) s += W[i].hashfull;
  const v = n ? Math.round(s / n) : 0;
  if (!T) return v;
  T.hf = Math.max(T.hf || 0, v);
  return T.hf;
}

// ---------------------------------------------------------------------------------------------------
// Per-frame: process replies, schedule, dispatch
function processInbox() {
  let usedFrame = 0, bgFrame = 0;
  const T0 = S.think;
  for (let i = 0; i < W.length; i++) {
    const r = inbox[i];
    if (!r) { const w0 = W[i]; if (!w0.busy) { w0.knps *= 0.9; w0.bgKnps = (w0.bgKnps || 0) * 0.9; w0.used = 0; w0.usedMain = 0; w0.usedBg = 0; } continue; }
    inbox[i] = null;
    const w = W[i];
    w.used = r.used;
    w.usedMain = r.usedMain === undefined ? r.used : r.usedMain;
    w.usedBg = r.usedBg || 0;
    if (w.usedBg > 0) {
      const sp = w.bgSpans || (w.bgSpans = []);
      const last = sp[sp.length - 1];
      if (last && S.now - last[1] < 40) last[1] = S.now; else sp.push([S.now - 16.7, S.now]);
      if (sp.length > 200) sp.shift();
    }
    w.lastMs = r.ms; w.maxMs = Math.max(w.maxMs, r.ms); w.sumMs += r.ms; w.nMs++;
    const isPerft = w.perft;
    if (!isPerft) {
      w.nodes += r.used; w.q += r.q;
      S.searchNodes += r.used; S.qnodes += r.q;
      usedFrame += r.used;
      bgFrame += r.usedBg || 0;
      for (let k = 0; k < ST_KEYS.length; k++) S.st[ST_KEYS[k]] += r.st[k];
    }
    w.knps = w.knps * 0.9 + ((r.usedMain === undefined ? r.used : r.usedMain) * 60 / 1000) * 0.1;
    w.bgKnps = (w.bgKnps || 0) * 0.9 + ((r.usedBg || 0) * 60 / 1000) * 0.1;
    w.repliedAt = S.frame;
    if (r.hist) { w.hist = r.hist; w.killers = r.killers; w.occ = r.occ; }
    if (r.hashfull !== undefined) { w.hashfull = r.hashfull; w.hfThink = r.think; }
    w.sel = r.sel;
    w.stack = r.stack;
    if (T0 && w.thinkOf === T0.id && r.sel > T0.sel) T0.sel = r.sel;
    if (w.cur !== r.job) { w.cur = r.job; w.curStart = S.now - 16.7; }
    const T = S.think;
    if (T && w.thinkOf === T.id) { T.live = (T.live || 0) + (r.usedMain === undefined ? r.used : r.usedMain); if (r.deltas.length) applyDeltas(T, r.deltas); }
    for (const res of r.results) {
      w.jobs = w.jobs.filter((x) => x !== res.id);
      const j = jobs.get(res.id);
      if (!j) continue;
      jobs.delete(res.id);
      j.done = true;
      j.end = S.now;
      onResult(j, res, w);
    }
    if (w.perft && !w.jobs.some((id) => jobs.get(id) && jobs.get(id).kind === 'perft')) w.perft = false;
  }
  S.npsWin.push(usedFrame);
  if (S.npsWin.length > 60) S.npsWin.shift();
  let s = 0;
  for (const x of S.npsWin) s += x;
  S.nps = Math.round(s * (60 / S.npsWin.length));
  S.bgWin.push(bgFrame);
  if (S.bgWin.length > 60) S.bgWin.shift();
  let sb = 0;
  for (const x of S.bgWin) sb += x;
  S.npsBg = Math.round(sb * (60 / S.bgWin.length));
  S.npsDeep = Math.max(0, S.nps - S.npsBg);
  if (S.npsWin.length === 60 && S.nps > S.npsPeak) S.npsPeak = S.nps;
  S.nodes = S.searchNodes;
}
function laneAdd(j, w, aborted) {
  const T = j.T;
  const start = Math.max(j.start || S.now - 16.7, w.laneT || 0);
  w.laneT = S.now;
  S.lanes.push({ w: w.i, start, end: S.now, spec: !!j.spec, type: aborted ? 'abort' : j.type || j.kind, san: j.mv ? j.mv.san + (j.san2 ? '·' + j.san2 : '') : j.kind === 'quick' ? moveLabel(j.ply) + G.sans[j.ply] : j.kind === 'perft' ? 'perft' : 'd1-4', think: T ? T.id : 0 });
  if (S.lanes.length > 1500) S.lanes.splice(0, S.lanes.length - 1500);
}
function onResult(j, r, w) {
  if (j.kind !== 'bg') laneAdd(j, w, false);
  if (j.kind === 'perft') {
    const row = j.row;
    row.got.push(r.count);
    row.makes += r.makes;
    if (!row.start) row.start = j.start || S.now;
    row.end = S.now;
    row.ms = row.end - row.start;
    row.okDepths = (row.okDepths || 0) + (r.count === j.expect ? 1 : 0);
    if (r.count !== j.expect) row.ok = false;
    else if (row.got.length === row.depth && row.ok !== false) row.ok = true;
    if (row.got.length === row.depth) row.final = r.count;
    if (S.perft.every((x) => x.ok !== null)) S.perftOK = S.perft.every((x) => x.ok);
    return;
  }
  if (j.kind === 'bg') {
    w.bgJob = null;
    S.bg.done++;
    S.bg.nodes += r.nodes;
    const prev = S.analysis[j.ply];
    if (!r.none && (!prev || (prev.src !== 'deep' && (prev.depth || 0) <= r.depth))) {
      const e = at(j.ply);
      S.analysis[j.ply] = { src: 'bg', depth: r.depth, score: r.score, best: r.best, bestSan: e.toSAN(r.best), pv: r.pv, played: r.played, only: r.only, nodes: r.nodes, found: r.found };
      classify(j.ply);
    }
    return;
  }
  if (j.kind === 'quick') {
    S.quick.done++;
    if (!r.none) {
      const e = at(j.ply);
      const best = r.best;
      S.analysis[j.ply] = { src: 'quick', depth: r.depth, score: r.score, best, bestSan: e.toSAN(best), pv: r.pv, played: r.played, only: r.only, nodes: r.nodes, found: r.found };
      classify(j.ply);
    }
    if (S.quick.done === S.quick.total) { S.quick.end = S.now; finalPosition(); }
    return;
  }
  const T = j.T;
  if (!T || T.done || j.cancelled) return;
  if (j.kind === 'id') onIDResult(T, j, r);
  else if (j.kind === 'move2') onSplitResult(T, j, r);
  else if (j.mpv) onMpvResult(T, j, r);
  else onMoveResult(T, j, r);
}
function pickJob(w) {
  if (!pending.length) return null;
  pending.sort((a, b) => a.prio - b.prio);
  // perft only on worker 0; critical re-searches go back to the worker that searched the move (warm TT) if it can take them
  let best = -1;
  const hasPerft = pending.some((x) => x.kind === 'perft');
  for (let k = 0; k < pending.length && k < 16; k++) {
    const j = pending[k];
    if (j.kind === 'perft' && w.i !== 0) continue;
    if (j.kind !== 'perft' && w.i === 0 && hasPerft) continue;
    if (j.front && j.pref >= 0 && j.pref !== w.i && j.pref < nThreads()) {
      const o = W[j.pref];
      if (!o.perft && !o.busy && queueEst(o) < 2 * BUDGET) continue;
    }
    if (best < 0) best = k;
    if (j.pref === w.i && j.prio <= pending[best].prio + 2.5) { best = k; break; }
  }
  if (best < 0) return null;
  return pending.splice(best, 1)[0];
}
function jobEst(j) {
  if (j.kind === 'move2') return Math.max(500, (j.mv.prevNodes || 4000) * (j.type === 'pv' ? 0.6 : 0.06));
  if (j.kind !== 'move') return BUDGET * 4;
  const mv = j.mv;
  const base = j.spec ? mv.iterNodes : mv.prevNodes;
  return Math.max(500, base * (j.type === 'scout' ? 1.5 : 2.5));
}
function queueEst(w) {
  let s = 0;
  for (const id of w.jobs) { const j = jobs.get(id); if (j) s += j.est; }
  return s;
}
function dispatch() {
  const T = S.think;
  const n = nThreads();
  for (let i = 0; i < n; i++) {
    const w = W[i];
    if (w.busy) continue;
    const add = [];
    let est = queueEst(w);
    while ((w.jobs.length + add.length === 0) || (est < 2 * BUDGET && w.jobs.length + add.length < 12)) {
      const j = pickJob(w);
      if (!j) break;
      const solo = j.kind === 'quick' || j.kind === 'perft' || j.kind === 'id';
      if (solo && w.jobs.length + add.length > 0) { pending.push(j); break; }
      j.worker = i;
      j.start = S.now;
      j.est = jobEst(j);
      est += j.est;
      add.push(j);
      if (j.kind === 'perft') w.perft = true;
      if (solo) break;
    }
    for (const j of add) {
      w.jobs.push(j.id);
      if (j.kind === 'move' && !j.spec && j.T && j.type !== 'pv') j.T.lastSent = j.mv;
    }
    let bgAdd = null;
    if (S.deep.active && !bgPending.length) refillBackground();
    if (S.deep.active && !w.bgJob && bgPending.length && !w.perft) {
      const ply = bgPending.shift();
      w.bgJob = { id: jobSeq++, kind: 'bg', ply, depth: S.bg.depth, cap: S.bg.cap, played: G.moves[ply], start: S.now };
      jobs.set(w.bgJob.id, w.bgJob);
      bgAdd = [stripJob(w.bgJob)];
    }
    if (!w.jobs.length && !w.bgJob) { if (S.deep.active) { S.deep.busyOffered += BUDGET; w.busyOffered += BUDGET; } continue; }
    if (!w.jobs.length && S.deep.active) { S.deep.busyOffered += BUDGET; w.busyOffered += BUDGET; }
    const first = jobs.get(w.jobs[0]);
    const budget = first && first.kind === 'perft' ? PERFT_BUDGET : BUDGET;
    const msg = { t: 'run', budget, jobs: add.map(stripJob), cancel: cancels[i] || [] };
    if (bgAdd) msg.bg = bgAdd;
    cancels[i] = [];
    if (T && w.thinkOf !== T.id && add.some((j) => j.T === T)) { msg.opt = workerOpt(T.opt); w.thinkOf = T.id; w.stack = []; w.path = null; }
    if ((S.frame + i * 4) % 30 === 0) msg.snap = true;
    w.busy = true;
    if (S.deep.active && budget === BUDGET && w.jobs.length) { S.deep.busyOffered += BUDGET; w.busyOffered += BUDGET; w.pendingUsedCount = true; }
    STUDIO.wait(new Promise((res) => { w.resolve = res; }));
    w.w.postMessage(msg);
  }
}
// background passes, each two plies deeper: the end of the game first (the deep pass reaches it last), then the
// opening; positions already analysed by the deep pass are skipped
function refillBackground() {
  if (S.bg.pass >= 6 || bgPending.length) return;
  const busy = new Set(W.filter((w) => w.bgJob).map((w) => w.bgJob.ply));
  S.bg.depth = BG_DEPTH + 2 * S.bg.pass;
  S.bg.cap = BG_CAP * Math.pow(4, S.bg.pass);
  S.bg.pass++;
  const order = [];
  for (let p = 40; p < G.plies; p++) order.push(p);
  for (let p = 0; p < DEEP_START; p++) order.push(p);
  for (let p = DEEP_START; p < 40; p++) order.push(p);
  for (const p of order) { const a = S.analysis[p]; if ((!a || a.src !== 'deep') && !busy.has(p)) bgPending.push(p); }
}
function stripJob(j) {
  const o = { id: j.id, kind: j.kind };
  for (const k of ['fen', 'depth', 'ply', 'cap', 'played', 'think', 'depthMax', 'm', 'm2', 'alpha', 'beta', 'front']) if (j[k] !== undefined) o[k] = j[k];
  return o;
}
function workerOpt(o) {
  return { hash: o.hash, nullBase: o.nullBase, lmrOn: o.lmrOn, lmrDiv: o.lmrDiv, futMargin: o.futMargin, checkExt: o.checkExt, seePrune: o.seePrune, treePlies: Math.max(4, o.treePlies) };
}

function schedule() {
  // quick pass done -> deep pass starts
  if (!S.deep.active && S.quick.done === S.quick.total && S.now - S.t0 >= DEEP_AT) {
    S.deep.active = true;
    S.deep.startT = S.now;
    refillBackground();
    startThink(DEEP_START);
  }
  const T = S.think;
  if (!T) return;
  if (!T.done && S.now >= T.end) {
    finishThink(T);
    let next = T.ply + 1;
    if (next >= G.plies) next = 0;
    S.anim = { from: T.ply, to: T.ply + 1, t0: S.now, dur: 260 };
    startThink(next);
    return;
  }
  if (!T.done) advance(T);
  // UCI: currmove for the root move most recently sent to a worker, with its rank in the root order, at most every
  // 500 ms and only when it changed; a status line (nodes, nps, hashfull, time) each time the think passes 5M nodes
  if (!T.done && T.depth >= 5) {
    if (S.frame % 30 === 15 && T.lastSent && T.lastSent !== T.lastCurr) {
      const cm = T.lastSent, k = T.moves.indexOf(cm) + 1;
      T.lastCurr = cm;
      logLine('stat', [['' + T.depth, 'num'], ['' + T.sel, 'num'], ['', 'mute'], ['', 'mute'], [thinkNodes(), 'nodes'], [thinkNps(), 'nps'],
        [avgHashfull(), 'num'], [Math.round(S.now - T.start), 'num'], [`currmove ${cm.san} currmovenumber ${k}`, 'cur']]);
    }
    if (!T.nextStat) T.nextStat = 5e6;
    if ((T.live || 0) >= T.nextStat) {
      T.nextStat += 5e6;
      logLine('stat', [['' + T.depth, 'num'], ['' + T.sel, 'num'], ['', 'mute'], ['', 'mute'], [thinkNodes(), 'nodes'], [thinkNps(), 'nps'],
        [avgHashfull(), 'num'], [Math.round(S.now - T.start), 'num'], ['', 'cur']]);
    }
  }
}

// busy accounting uses the used nodes of the replies
function accountBusy() {
  if (!S.deep.active) return;
  for (let i = 0; i < nThreads(); i++) {
    const w = W[i];
    if (w.pendingUsedCount && !w.busy) { S.deep.busyUsed += Math.min(BUDGET, w.usedMain); w.busyUsed += Math.min(BUDGET, w.usedMain); w.pendingUsedCount = false; }
  }
}

function report() {
  const cuts = S.st.cuts;
  STUDIO.report({
    nodes_total: S.searchNodes,
    nps_peak: S.npsPeak,
    depth_max: S.depthMax,
    seldepth_max: S.seldepthMax,
    be6_found_depth: S.be6.done ? S.be6.foundDepth : S.be6.cand,
    be6_eval_cp: S.be6.eval,
    cutoff_first_pct: cuts ? +(100 * S.st.firstCuts / cuts).toFixed(1) : 0,
    workers_busy_pct: S.deep.busyOffered ? +(100 * S.deep.busyUsed / S.deep.busyOffered).toFixed(1) : 0,
  });
}

const CORE = { S, G, W, OPT, E, at, sanAt, pvSan, moveLabel, moveNo, fmtScore, fmtCount, whiteCp, avgHashfull, jobs, pending, BUDGET, PERFT_BUDGET, WCOL, DEEP_START, BE6_PLY };
function coreStart() {
  if (!G.ok) console.error('game replay failed');
  for (let i = 0; i < OPT.threads; i++) makeWorker(i);
  initJobs();
}
function coreFrame(now) {
  S.now = now;
  S.frame++;
  processInbox();
  accountBusy();
  schedule();
  dispatch();
  if (S.frame % 60 === 0) report();
}

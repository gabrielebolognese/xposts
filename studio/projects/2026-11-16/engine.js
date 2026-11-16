// Engine Room: the chess engine. One source, used by the page (SAN, attack maps, SEE, static eval) and by every
// Web Worker (search, perft), which receive it through a Blob URL built from EngineModule.toString().
// 0x88 board, piece lists, incremental Zobrist (two 32-bit halves) and incremental PeSTO eval.
// The search and perft are generators: they pause every time the node budget of the current chunk is spent, so the
// page can meter the work frame by frame, and resume exactly where they stopped.
function EngineModule(G) {
  'use strict';
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 0, BLACK = 1;
  const INF = 32767, MATE = 32000, MATE_BOUND = 31000;
  const MAXPLY = 96;
  const F_CAP = 1 << 17, F_EP = 1 << 18, F_CASTLE = 1 << 19, F_DOUBLE = 1 << 20;
  const EXACT = 0, LOWER = 1, UPPER = 2;
  const PV_NODE = 0, CUT_NODE = 1, ALL_NODE = 2;

  const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
  const KING_D = [1, -1, 16, -16, 15, 17, -15, -17];
  const DIAG_D = [15, 17, -15, -17];
  const ORTH_D = [1, -1, 16, -16];
  const PHASE_INC = [0, 0, 1, 1, 2, 4, 0, 0];
  const SEE_VAL = [0, 100, 320, 330, 500, 950, 20000, 0];
  const ORDER_VAL = [0, 1, 3, 3, 5, 9, 20, 0];
  const PIECE_CH = ' PNBRQK';

  // ---- Zobrist keys: two 32-bit halves from xorshift32 ----
  let zs = 0x2545F491;
  const xs32 = () => { zs ^= zs << 13; zs ^= zs >>> 17; zs ^= zs << 5; return zs | 0; };
  const ZPL = new Int32Array(16 * 128), ZPH = new Int32Array(16 * 128);
  for (let i = 0; i < 16 * 128; i++) { ZPL[i] = xs32(); ZPH[i] = xs32(); }
  const ZCL = new Int32Array(16), ZCH = new Int32Array(16);
  for (let i = 0; i < 16; i++) { ZCL[i] = xs32(); ZCH[i] = xs32(); }
  const ZEL = new Int32Array(128), ZEH = new Int32Array(128);
  for (let i = 0; i < 128; i++) { ZEL[i] = xs32(); ZEH[i] = xs32(); }
  const ZSL = xs32(), ZSH = xs32();

  // ---- PeSTO (Chess Programming Wiki), tables from White's view, index 0 = a8 ----
  const MG_VAL = [0, 82, 337, 365, 477, 1025, 0], EG_VAL = [0, 94, 281, 297, 512, 936, 0];
  const PST_MG = [null,
    [0, 0, 0, 0, 0, 0, 0, 0, 98, 134, 61, 95, 68, 126, 34, -11, -6, 7, 26, 31, 65, 56, 25, -20, -14, 13, 6, 21, 23, 12, 17, -23,
      -27, -2, -5, 12, 17, 6, 10, -25, -26, -4, -4, -10, 3, 3, 33, -12, -35, -1, -20, -23, -15, 24, 38, -22, 0, 0, 0, 0, 0, 0, 0, 0],
    [-167, -89, -34, -49, 61, -97, -15, -107, -73, -41, 72, 36, 23, 62, 7, -17, -47, 60, 37, 65, 84, 129, 73, 44, -9, 17, 19, 53, 37, 69, 18, 22,
      -13, 4, 16, 13, 28, 19, 21, -8, -23, -9, 12, 10, 19, 17, 25, -16, -29, -53, -12, -3, -1, 18, -14, -19, -105, -21, -58, -33, -17, -28, -19, -23],
    [-29, 4, -82, -37, -25, -42, 7, -8, -26, 16, -18, -13, 30, 59, 18, -47, -16, 37, 43, 40, 35, 50, 37, -2, -4, 5, 19, 50, 37, 37, 7, -2,
      -6, 13, 13, 26, 34, 12, 10, 4, 0, 15, 15, 15, 14, 27, 18, 10, 4, 15, 16, 0, 7, 21, 33, 1, -33, -3, -14, -21, -13, -12, -39, -21],
    [32, 42, 32, 51, 63, 9, 31, 43, 27, 32, 58, 62, 80, 67, 26, 44, -5, 19, 26, 36, 17, 45, 61, 16, -24, -11, 7, 26, 24, 35, -8, -20,
      -36, -26, -12, -1, 9, -7, 6, -23, -45, -25, -16, -17, 3, 0, -5, -33, -44, -16, -20, -9, -1, 11, -6, -71, -19, -13, 1, 17, 16, 7, -37, -26],
    [-28, 0, 29, 12, 59, 44, 43, 45, -24, -39, -5, 1, -16, 57, 28, 54, -13, -17, 7, 8, 29, 56, 47, 57, -27, -27, -16, -16, -1, 17, -2, 1,
      -9, -26, -9, -10, -2, -4, 3, -3, -14, 2, -11, -2, -5, 2, 14, 5, -35, -8, 11, 2, 8, 15, -3, 1, -1, -18, -9, 10, -15, -25, -31, -50],
    [-65, 23, 16, -15, -56, -34, 2, 13, 29, -1, -20, -7, -8, -4, -38, -29, -9, 24, 2, -16, -20, 6, 22, -22, -17, -20, -12, -27, -30, -25, -14, -36,
      -49, -1, -27, -39, -46, -44, -33, -51, -14, -14, -22, -46, -44, -30, -15, -27, 1, 7, -8, -64, -43, -16, 9, 8, -15, 36, 12, -54, 8, -28, 24, 14]];
  const PST_EG = [null,
    [0, 0, 0, 0, 0, 0, 0, 0, 178, 173, 158, 134, 147, 132, 165, 187, 94, 100, 85, 67, 56, 53, 82, 84, 32, 24, 13, 5, -2, 4, 17, 17,
      13, 9, -3, -7, -7, -8, 3, -1, 4, 7, -6, 1, 0, -5, -1, -8, 13, 8, 8, 10, 13, 0, 2, -7, 0, 0, 0, 0, 0, 0, 0, 0],
    [-58, -38, -13, -28, -31, -27, -63, -99, -25, -8, -25, -2, -9, -25, -24, -52, -24, -20, 10, 9, -1, -9, -19, -41, -17, 3, 22, 22, 22, 11, 8, -18,
      -18, -6, 16, 25, 16, 17, 4, -18, -23, -3, -1, 15, 10, -3, -20, -22, -42, -20, -10, -5, -2, -20, -23, -44, -29, -51, -23, -15, -22, -18, -50, -64],
    [-14, -21, -11, -8, -7, -9, -17, -24, -8, -4, 7, -12, -3, -13, -4, -14, 2, -8, 0, -1, -2, 6, 0, 4, -3, 9, 12, 9, 14, 10, 3, 2,
      -6, 3, 13, 19, 7, 10, -3, -9, -12, -3, 8, 10, 13, 3, -7, -15, -14, -18, -7, -1, 4, -9, -15, -27, -23, -9, -23, -5, -9, -16, -5, -17],
    [13, 10, 18, 15, 12, 12, 8, 5, 11, 13, 13, 11, -3, 3, 8, 3, 7, 7, 7, 5, 4, -3, -5, -3, 4, 3, 13, 1, 2, 1, -1, 2,
      3, 5, 8, 4, -5, -6, -8, -11, -4, 0, -5, -1, -7, -12, -8, -16, -6, -6, 0, 2, -9, -9, -11, -3, -9, 2, 3, -1, -5, -13, 4, -20],
    [-9, 22, 22, 27, 27, 19, 10, 20, -17, 20, 32, 41, 58, 25, 30, 0, -20, 6, 9, 49, 47, 35, 19, 9, 3, 22, 24, 45, 57, 40, 57, 36,
      -18, 28, 19, 47, 31, 34, 39, 23, -16, -27, 15, 6, 9, 17, 10, 5, -22, -23, -30, -16, -16, -23, -36, -32, -33, -28, -22, -43, -5, -32, -20, -41],
    [-74, -35, -18, -18, -11, 15, 4, -17, -12, 17, 14, 17, 17, 38, 23, 11, 10, 17, 23, 15, 20, 45, 44, 13, -8, 22, 24, 27, 26, 33, 26, 3,
      -18, -4, 21, 24, 27, 23, 9, -11, -19, -3, 11, 21, 23, 16, 7, -9, -27, -11, 4, 13, 14, 4, -5, -17, -53, -34, -21, -11, -28, -14, -24, -43]];
  // MG/EG[piece * 128 + sq]: material + PST for that piece on that 0x88 square
  const MG = new Int32Array(16 * 128), EG = new Int32Array(16 * 128);
  const PSTM = new Int32Array(16 * 128), PSTE = new Int32Array(16 * 128); // PST only, for the breakdown on screen
  for (let t = 1; t <= 6; t++) {
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const r = sq >> 4, f = sq & 7;
      const wi = (7 - r) * 8 + f, bi = r * 8 + f;
      PSTM[t * 128 + sq] = PST_MG[t][wi]; PSTE[t * 128 + sq] = PST_EG[t][wi];
      PSTM[(t + 8) * 128 + sq] = PST_MG[t][bi]; PSTE[(t + 8) * 128 + sq] = PST_EG[t][bi];
      MG[t * 128 + sq] = MG_VAL[t] + PST_MG[t][wi]; EG[t * 128 + sq] = EG_VAL[t] + PST_EG[t][wi];
      MG[(t + 8) * 128 + sq] = MG_VAL[t] + PST_MG[t][bi]; EG[(t + 8) * 128 + sq] = EG_VAL[t] + PST_EG[t][bi];
    }
  }
  const CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[0] = 15 & ~2; CASTLE_MASK[7] = 15 & ~1; CASTLE_MASK[4] = 15 & ~3;
  CASTLE_MASK[112] = 15 & ~8; CASTLE_MASK[119] = 15 & ~4; CASTLE_MASK[116] = 15 & ~12;

  const sqName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
  const sqFromName = (s) => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 16;
  const sq64 = (sq) => (sq >> 4) * 8 + (sq & 7);

  // LMR table, rebuilt when the divisor changes
  const LMR = new Int8Array(64 * 64);
  function buildLMR(div) {
    for (let d = 1; d < 64; d++) for (let i = 1; i < 64; i++) LMR[d * 64 + i] = Math.floor(0.75 + Math.log(d) * Math.log(i) / div);
  }
  buildLMR(2.25);

  // =====================================================================================================
  function createEngine() {
    const board = new Int8Array(128);
    const plist = new Int8Array(32), pcount = new Int8Array(2), pidx = new Int8Array(128);
    const count = new Int8Array(16);
    const kingSq = new Int8Array(2);
    let side = WHITE, castle = 0, ep = -1, halfmove = 0, fullmove = 1;
    let hashLo = 0, hashHi = 0, mgW = 0, mgB = 0, egW = 0, egB = 0, phase = 0;
    let sp = 0;
    const STK = 1024;
    const stMove = new Int32Array(STK), stCap = new Int8Array(STK), stCapIdx = new Int8Array(STK), stCastle = new Int8Array(STK);
    const stEp = new Int8Array(STK), stHalf = new Int16Array(STK), stHL = new Int32Array(STK), stHH = new Int32Array(STK);
    const stMgW = new Int32Array(STK), stMgB = new Int32Array(STK), stEgW = new Int32Array(STK), stEgB = new Int32Array(STK), stPh = new Int8Array(STK);
    const posLo = new Int32Array(STK + 1), posHi = new Int32Array(STK + 1);
    const moveBuf = new Int32Array(MAXPLY * 256 + 512), scoreBuf = new Int32Array(MAXPLY * 256 + 512);
    let nodes = 0, qnodes = 0;
    let countNodes = true;

    function addPiece(p, sq) {
      const c = p >> 3;
      board[sq] = p;
      pidx[sq] = pcount[c];
      plist[c * 16 + pcount[c]++] = sq;
      count[p]++;
      if ((p & 7) === KING) kingSq[c] = sq;
    }
    function recompute() {
      hashLo = 0; hashHi = 0; mgW = mgB = egW = egB = 0; phase = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) continue;
        const p = board[sq];
        if (!p) continue;
        hashLo ^= ZPL[p * 128 + sq]; hashHi ^= ZPH[p * 128 + sq];
        if (p < 8) { mgW += MG[p * 128 + sq]; egW += EG[p * 128 + sq]; } else { mgB += MG[p * 128 + sq]; egB += EG[p * 128 + sq]; }
        phase += PHASE_INC[p & 7];
      }
      hashLo ^= ZCL[castle]; hashHi ^= ZCH[castle];
      if (ep >= 0) { hashLo ^= ZEL[ep]; hashHi ^= ZEH[ep]; }
      if (side === BLACK) { hashLo ^= ZSL; hashHi ^= ZSH; }
    }
    function setFEN(fen) {
      board.fill(0); pcount.fill(0); count.fill(0); pidx.fill(0); plist.fill(0);
      const parts = fen.trim().split(/\s+/);
      let r = 7, f = 0;
      for (const ch of parts[0]) {
        if (ch === '/') { r--; f = 0; continue; }
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const lo = ch.toLowerCase();
        const t = ' pnbrqk'.indexOf(lo);
        addPiece(t | (ch === lo ? 8 : 0), r * 16 + f);
        f++;
      }
      side = parts[1] === 'b' ? BLACK : WHITE;
      castle = 0;
      const c = parts[2] || '-';
      if (c.includes('K')) castle |= 1; if (c.includes('Q')) castle |= 2; if (c.includes('k')) castle |= 4; if (c.includes('q')) castle |= 8;
      ep = parts[3] && parts[3] !== '-' ? sqFromName(parts[3]) : -1;
      halfmove = +(parts[4] || 0); fullmove = +(parts[5] || 1);
      sp = 0;
      recompute();
      posLo[0] = hashLo; posHi[0] = hashHi;
    }
    function getFEN() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let e = 0;
        for (let f = 0; f < 8; f++) {
          const p = board[r * 16 + f];
          if (!p) { e++; continue; }
          if (e) { s += e; e = 0; }
          const ch = PIECE_CH[p & 7];
          s += p & 8 ? ch.toLowerCase() : ch;
        }
        if (e) s += e;
        if (r) s += '/';
      }
      let c = (castle & 1 ? 'K' : '') + (castle & 2 ? 'Q' : '') + (castle & 4 ? 'k' : '') + (castle & 8 ? 'q' : '');
      return `${s} ${side ? 'b' : 'w'} ${c || '-'} ${ep >= 0 ? sqName(ep) : '-'} ${halfmove} ${fullmove}`;
    }

    // ---- attacks ----
    function attacked(sq, by) {
      let s;
      if (by === WHITE) {
        s = sq - 15; if (!(s & 0x88) && board[s] === 1) return true;
        s = sq - 17; if (!(s & 0x88) && board[s] === 1) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && board[s] === 9) return true;
        s = sq + 17; if (!(s & 0x88) && board[s] === 9) return true;
      }
      const c8 = by << 3;
      const kn = KNIGHT | c8, kg = KING | c8, bi = BISHOP | c8, ro = ROOK | c8, qu = QUEEN | c8;
      for (let i = 0; i < 8; i++) {
        s = sq + KNIGHT_D[i];
        if (!(s & 0x88) && board[s] === kn) return true;
      }
      for (let i = 0; i < 8; i++) {
        s = sq + KING_D[i];
        if (!(s & 0x88) && board[s] === kg) return true;
      }
      for (let i = 0; i < 4; i++) {
        const d = DIAG_D[i];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = board[s];
          if (p) { if (p === bi || p === qu) return true; break; }
          s += d;
        }
      }
      for (let i = 0; i < 4; i++) {
        const d = ORTH_D[i];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = board[s];
          if (p) { if (p === ro || p === qu) return true; break; }
          s += d;
        }
      }
      return false;
    }
    const inCheck = () => attacked(kingSq[side], side ^ 1);

    // ---- make / unmake ----
    function makeMove(m) {
      if (countNodes) nodes++;
      const from = m & 127, to = (m >> 7) & 127;
      const p = board[from];
      const us = side, them = us ^ 1;
      stMove[sp] = m; stCastle[sp] = castle; stEp[sp] = ep; stHalf[sp] = halfmove;
      stHL[sp] = hashLo; stHH[sp] = hashHi; stMgW[sp] = mgW; stMgB[sp] = mgB; stEgW[sp] = egW; stEgB[sp] = egB; stPh[sp] = phase;
      let hl = hashLo, hh = hashHi;
      if (ep >= 0) { hl ^= ZEL[ep]; hh ^= ZEH[ep]; }
      let capSq = to;
      if (m & F_EP) capSq = us === WHITE ? to - 16 : to + 16;
      const cap = board[capSq];
      stCap[sp] = cap;
      if (cap) {
        const k = cap * 128 + capSq;
        hl ^= ZPL[k]; hh ^= ZPH[k];
        if (them === WHITE) { mgW -= MG[k]; egW -= EG[k]; } else { mgB -= MG[k]; egB -= EG[k]; }
        phase -= PHASE_INC[cap & 7];
        count[cap]--;
        const idx = pidx[capSq];
        stCapIdx[sp] = idx;
        const n = --pcount[them];
        const last = plist[them * 16 + n];
        plist[them * 16 + idx] = last; pidx[last] = idx;
        board[capSq] = 0;
        halfmove = 0;
      } else halfmove = (p & 7) === PAWN ? 0 : halfmove + 1;
      let np = p;
      const promo = (m >> 14) & 7;
      if (promo) { np = promo | (us << 3); phase += PHASE_INC[promo]; count[p]--; count[np]++; }
      const kf = p * 128 + from, kt = np * 128 + to;
      hl ^= ZPL[kf] ^ ZPL[kt]; hh ^= ZPH[kf] ^ ZPH[kt];
      if (us === WHITE) { mgW += MG[kt] - MG[kf]; egW += EG[kt] - EG[kf]; } else { mgB += MG[kt] - MG[kf]; egB += EG[kt] - EG[kf]; }
      board[from] = 0; board[to] = np;
      const pi = pidx[from];
      plist[us * 16 + pi] = to; pidx[to] = pi;
      if ((p & 7) === KING) {
        kingSq[us] = to;
        if (m & F_CASTLE) {
          let rf, rt;
          if ((to & 7) === 6) { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
          const rp = board[rf];
          const a = rp * 128 + rf, b = rp * 128 + rt;
          hl ^= ZPL[a] ^ ZPL[b]; hh ^= ZPH[a] ^ ZPH[b];
          if (us === WHITE) { mgW += MG[b] - MG[a]; egW += EG[b] - EG[a]; } else { mgB += MG[b] - MG[a]; egB += EG[b] - EG[a]; }
          board[rf] = 0; board[rt] = rp;
          const ri = pidx[rf];
          plist[us * 16 + ri] = rt; pidx[rt] = ri;
        }
      }
      const nc = castle & CASTLE_MASK[from] & CASTLE_MASK[to];
      if (nc !== castle) { hl ^= ZCL[castle] ^ ZCL[nc]; hh ^= ZCH[castle] ^ ZCH[nc]; castle = nc; }
      ep = -1;
      if (m & F_DOUBLE) {
        const ep8 = them === WHITE ? 1 : 9;
        if ((!((to - 1) & 0x88) && board[to - 1] === ep8) || (!((to + 1) & 0x88) && board[to + 1] === ep8)) {
          ep = (from + to) >> 1;
          hl ^= ZEL[ep]; hh ^= ZEH[ep];
        }
      }
      side = them;
      hl ^= ZSL; hh ^= ZSH;
      hashLo = hl; hashHi = hh;
      sp++;
      posLo[sp] = hl; posHi[sp] = hh;
    }
    function unmakeMove() {
      sp--;
      const m = stMove[sp];
      const from = m & 127, to = (m >> 7) & 127;
      side ^= 1;
      const us = side, them = us ^ 1;
      let p = board[to];
      if ((m >> 14) & 7) { count[p]--; p = PAWN | (us << 3); count[p]++; }
      board[to] = 0; board[from] = p;
      const pi = pidx[to];
      plist[us * 16 + pi] = from; pidx[from] = pi;
      if ((p & 7) === KING) {
        kingSq[us] = from;
        if (m & F_CASTLE) {
          let rf, rt;
          if ((to & 7) === 6) { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
          const rp = board[rt];
          board[rt] = 0; board[rf] = rp;
          const ri = pidx[rt];
          plist[us * 16 + ri] = rf; pidx[rf] = ri;
        }
      }
      const cap = stCap[sp];
      if (cap) {
        const capSq = m & F_EP ? (us === WHITE ? to - 16 : to + 16) : to;
        board[capSq] = cap;
        const idx = stCapIdx[sp];
        const n = pcount[them]++;
        const moved = plist[them * 16 + idx];
        plist[them * 16 + n] = moved; pidx[moved] = n;
        plist[them * 16 + idx] = capSq; pidx[capSq] = idx;
        count[cap]++;
      }
      castle = stCastle[sp]; ep = stEp[sp]; halfmove = stHalf[sp];
      hashLo = stHL[sp]; hashHi = stHH[sp]; mgW = stMgW[sp]; mgB = stMgB[sp]; egW = stEgW[sp]; egB = stEgB[sp]; phase = stPh[sp];
    }
    function makeNull() {
      stMove[sp] = 0; stEp[sp] = ep; stHalf[sp] = halfmove; stHL[sp] = hashLo; stHH[sp] = hashHi;
      if (ep >= 0) { hashLo ^= ZEL[ep]; hashHi ^= ZEH[ep]; }
      ep = -1; halfmove = 0;
      side ^= 1; hashLo ^= ZSL; hashHi ^= ZSH;
      sp++;
      posLo[sp] = hashLo; posHi[sp] = hashHi;
    }
    function unmakeNull() {
      sp--;
      side ^= 1;
      ep = stEp[sp]; halfmove = stHalf[sp]; hashLo = stHL[sp]; hashHi = stHH[sp];
    }
    function isRepetition() {
      const lim = sp - halfmove;
      for (let i = sp - 4; i >= lim && i >= 0; i -= 2) if (posLo[i] === hashLo && posHi[i] === hashHi) return true;
      return false;
    }

    // ---- move generation (pseudo-legal) into moveBuf from index n; returns the new end ----
    function gen(n, capsOnly) {
      const us = side, them = us ^ 1;
      const base = us * 16, cnt = pcount[us];
      for (let i = 0; i < cnt; i++) {
        const from = plist[base + i];
        const p = board[from];
        const t = p & 7;
        if (t === PAWN) {
          const fwd = us === WHITE ? 16 : -16;
          const r = from >> 4;
          const promoRank = us === WHITE ? 6 : 1;
          for (let k = -1; k <= 1; k += 2) {
            const to = from + fwd + k;
            if (to & 0x88) continue;
            const q = board[to];
            if (q && (q >> 3) === them) {
              const mv = from | (to << 7) | F_CAP;
              if (r === promoRank) {
                moveBuf[n++] = mv | (QUEEN << 14);
                if (!capsOnly) { moveBuf[n++] = mv | (KNIGHT << 14); moveBuf[n++] = mv | (ROOK << 14); moveBuf[n++] = mv | (BISHOP << 14); }
              } else moveBuf[n++] = mv;
            } else if (to === ep) moveBuf[n++] = from | (to << 7) | F_CAP | F_EP;
          }
          const to = from + fwd;
          if (!board[to]) {
            if (r === promoRank) {
              const mv = from | (to << 7);
              moveBuf[n++] = mv | (QUEEN << 14);
              if (!capsOnly) { moveBuf[n++] = mv | (KNIGHT << 14); moveBuf[n++] = mv | (ROOK << 14); moveBuf[n++] = mv | (BISHOP << 14); }
            } else if (!capsOnly) {
              moveBuf[n++] = from | (to << 7);
              if (r === (us === WHITE ? 1 : 6) && !board[to + fwd]) moveBuf[n++] = from | ((to + fwd) << 7) | F_DOUBLE;
            }
          }
        } else if (t === KNIGHT || t === KING) {
          const D = t === KNIGHT ? KNIGHT_D : KING_D;
          for (let k = 0; k < 8; k++) {
            const to = from + D[k];
            if (to & 0x88) continue;
            const q = board[to];
            if (!q) { if (!capsOnly) moveBuf[n++] = from | (to << 7); }
            else if ((q >> 3) === them) moveBuf[n++] = from | (to << 7) | F_CAP;
          }
          if (t === KING && !capsOnly) {
            if (us === WHITE) {
              if ((castle & 1) && !board[5] && !board[6] && board[7] === ROOK && !attacked(4, BLACK) && !attacked(5, BLACK)) moveBuf[n++] = 4 | (6 << 7) | F_CASTLE;
              if ((castle & 2) && !board[3] && !board[2] && !board[1] && board[0] === ROOK && !attacked(4, BLACK) && !attacked(3, BLACK)) moveBuf[n++] = 4 | (2 << 7) | F_CASTLE;
            } else {
              if ((castle & 4) && !board[117] && !board[118] && board[119] === (ROOK | 8) && !attacked(116, WHITE) && !attacked(117, WHITE)) moveBuf[n++] = 116 | (118 << 7) | F_CASTLE;
              if ((castle & 8) && !board[115] && !board[114] && !board[113] && board[112] === (ROOK | 8) && !attacked(116, WHITE) && !attacked(115, WHITE)) moveBuf[n++] = 116 | (114 << 7) | F_CASTLE;
            }
          }
        } else {
          const k0 = t === BISHOP ? 4 : 0, k1 = t === ROOK ? 4 : 8;
          for (let k = k0; k < k1; k++) {
            const d = KING_D[k];
            let to = from + d;
            while (!(to & 0x88)) {
              const q = board[to];
              if (!q) { if (!capsOnly) moveBuf[n++] = from | (to << 7); }
              else { if ((q >> 3) === them) moveBuf[n++] = from | (to << 7) | F_CAP; break; }
              to += d;
            }
          }
        }
      }
      return n;
    }
    function legalMoves() {
      const out = [];
      const end = gen(MAXPLY * 256, false);
      const keep = countNodes; countNodes = false;
      for (let i = MAXPLY * 256; i < end; i++) {
        const m = moveBuf[i];
        makeMove(m);
        if (!attacked(kingSq[side ^ 1], side)) out.push(m);
        unmakeMove();
      }
      countNodes = keep;
      return out;
    }

    // ---- evaluation ----
    function evaluate() {
      const ph = phase > 24 ? 24 : phase;
      let e = (((mgW - mgB) * ph + (egW - egB) * (24 - ph)) / 24) | 0;
      if (count[BISHOP] >= 2) e += 30;
      if (count[BISHOP | 8] >= 2) e -= 30;
      return (side === WHITE ? e : -e) + 10;
    }
    function evalBreakdown() {
      let mat = 0, pm = 0, pe = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) continue;
        const p = board[sq];
        if (!p) continue;
        const sg = p < 8 ? 1 : -1, t = p & 7;
        mat += sg * MG_VAL[t];
        pm += sg * PSTM[p * 128 + sq]; pe += sg * PSTE[p * 128 + sq];
      }
      const ph = phase > 24 ? 24 : phase;
      const tap = (((mgW - mgB) * ph + (egW - egB) * (24 - ph)) / 24) | 0;
      const pair = (count[BISHOP] >= 2 ? 30 : 0) - (count[BISHOP | 8] >= 2 ? 30 : 0);
      return { material: mat, pstMg: pm, pstEg: pe, mg: mgW - mgB, eg: egW - egB, phase: ph, rawPhase: phase,
        pair, tempo: side === WHITE ? 10 : -10, total: tap + pair + (side === WHITE ? 10 : -10) };
    }
    function hasNonPawn(c) {
      const o = c << 3;
      return count[KNIGHT | o] + count[BISHOP | o] + count[ROOK | o] + count[QUEEN | o] > 0;
    }

    // ---- static exchange evaluation ----
    const seeRestore = new Int8Array(40), seeRestoreP = new Int8Array(40);
    function leastAttacker(sq, by) {
      // returns square of the least valuable attacker of sq for side 'by', or -1
      const c8 = by << 3;
      let s;
      if (by === WHITE) {
        s = sq - 15; if (!(s & 0x88) && board[s] === 1) return s;
        s = sq - 17; if (!(s & 0x88) && board[s] === 1) return s;
      } else {
        s = sq + 15; if (!(s & 0x88) && board[s] === 9) return s;
        s = sq + 17; if (!(s & 0x88) && board[s] === 9) return s;
      }
      const kn = KNIGHT | c8;
      for (let i = 0; i < 8; i++) { s = sq + KNIGHT_D[i]; if (!(s & 0x88) && board[s] === kn) return s; }
      let bestSq = -1, bestV = 99;
      for (let k = 0; k < 8; k++) {
        const d = KING_D[k];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = board[s];
          if (p) {
            if ((p >> 3) === by) {
              const t = p & 7;
              if ((t === QUEEN || (k < 4 ? t === ROOK : t === BISHOP)) && ORDER_VAL[t] < bestV) { bestV = ORDER_VAL[t]; bestSq = s; }
            }
            break;
          }
          s += d;
        }
      }
      if (bestSq >= 0) return bestSq;
      const kg = KING | c8;
      for (let i = 0; i < 8; i++) { s = sq + KING_D[i]; if (!(s & 0x88) && board[s] === kg) return s; }
      return -1;
    }
    const seeGain = new Int32Array(40);
    function see(m) {
      const from = m & 127, to = (m >> 7) & 127;
      let nr = 0;
      let victim = m & F_EP ? PAWN : board[to] & 7;
      if (m & F_EP) { const cs = side === WHITE ? to - 16 : to + 16; seeRestore[nr] = cs; seeRestoreP[nr++] = board[cs]; board[cs] = 0; }
      let attackerP = board[from];
      const promo = (m >> 14) & 7;
      seeGain[0] = SEE_VAL[victim] + (promo ? SEE_VAL[promo] - SEE_VAL[PAWN] : 0);
      let onSq = promo ? promo : attackerP & 7;
      seeRestore[nr] = from; seeRestoreP[nr++] = board[from]; board[from] = 0;
      seeRestore[nr] = to; seeRestoreP[nr++] = board[to];
      let s = side ^ 1, d = 0;
      for (;;) {
        const a = leastAttacker(to, s);
        if (a < 0) break;
        d++;
        seeGain[d] = SEE_VAL[onSq] - seeGain[d - 1];
        if (Math.max(-seeGain[d - 1], seeGain[d]) < 0) break;
        onSq = board[a] & 7;
        seeRestore[nr] = a; seeRestoreP[nr++] = board[a]; board[a] = 0;
        s ^= 1;
        if (nr >= 38) break;
      }
      while (--d > 0) seeGain[d - 1] = -Math.max(-seeGain[d - 1], seeGain[d]);
      for (let i = nr - 1; i >= 0; i--) board[seeRestore[i]] = seeRestoreP[i];
      return seeGain[0];
    }
    // SEE of the best capture available to the side to move (for '!!' detection on the page)
    function bestCaptureSEE() {
      let best = -99999;
      const moves = legalMoves();
      for (const m of moves) if (m & F_CAP) { const v = see(m); if (v > best) best = v; }
      return best === -99999 ? 0 : best;
    }

    // ---- SAN ----
    function toSAN(m, moves) {
      const from = m & 127, to = (m >> 7) & 127;
      const p = board[from] & 7;
      let s;
      if (m & F_CASTLE) s = (to & 7) === 6 ? 'O-O' : 'O-O-O';
      else {
        const cap = m & F_CAP;
        if (p === PAWN) {
          s = cap ? 'abcdefgh'[from & 7] + 'x' + sqName(to) : sqName(to);
          const pr = (m >> 14) & 7;
          if (pr) s += '=' + PIECE_CH[pr];
        } else {
          s = PIECE_CH[p];
          const all = moves || legalMoves();
          let amb = false, sameF = false, sameR = false;
          for (const o of all) {
            if (o === m) continue;
            const of = o & 127;
            if (((o >> 7) & 127) === to && (board[of] & 7) === p && of !== from) {
              amb = true;
              if ((of & 7) === (from & 7)) sameF = true;
              if ((of >> 4) === (from >> 4)) sameR = true;
            }
          }
          if (amb) s += !sameF ? 'abcdefgh'[from & 7] : !sameR ? String((from >> 4) + 1) : sqName(from);
          s += (cap ? 'x' : '') + sqName(to);
        }
      }
      const keep = countNodes; countNodes = false;
      makeMove(m);
      if (inCheck()) s += legalMoves().length ? '+' : '#';
      unmakeMove();
      countNodes = keep;
      return s;
    }
    function parseSAN(san) {
      const clean = san.replace(/[+#!?]/g, '');
      const moves = legalMoves();
      for (const m of moves) if (toSAN(m, moves).replace(/[+#]/g, '') === clean) return m;
      return 0;
    }
    function pvToSAN(pv, max = 99) {
      const out = [];
      let made = 0;
      const keep = countNodes; countNodes = false;
      for (const m of pv) {
        if (made >= max) break;
        const lm = legalMoves();
        if (!lm.includes(m)) break;
        out.push(toSAN(m, lm));
        makeMove(m); made++;
      }
      while (made--) unmakeMove();
      countNodes = keep;
      return out;
    }
    // attack counts per square for both sides (64-entry arrays, a1 = 0)
    function attackMap() {
      const w = new Int8Array(64), b = new Int8Array(64);
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) continue;
        const p = board[sq];
        if (!p) continue;
        const arr = p < 8 ? w : b, t = p & 7;
        const hit = (s) => { if (!(s & 0x88)) arr[sq64(s)]++; };
        if (t === PAWN) { const f = p < 8 ? 16 : -16; hit(sq + f - 1); hit(sq + f + 1); }
        else if (t === KNIGHT) for (const d of KNIGHT_D) hit(sq + d);
        else if (t === KING) for (const d of KING_D) hit(sq + d);
        else {
          const k0 = t === BISHOP ? 4 : 0, k1 = t === ROOK ? 4 : 8;
          for (let k = k0; k < k1; k++) {
            const d = KING_D[k];
            let s = sq + d;
            while (!(s & 0x88)) { arr[sq64(s)]++; if (board[s]) break; s += d; }
          }
        }
      }
      return { w, b };
    }

    // =================================================================================================
    // Search state (only used inside workers)
    let tt = null, ttMask = 0, ttAge = 0;
    const killers = new Int32Array(MAXPLY * 2);
    const history = new Int32Array(2 * 128 * 128);
    const pvTab = new Int32Array(MAXPLY * MAXPLY), pvLen = new Int32Array(MAXPLY);
    const quietBuf = new Int32Array(MAXPLY * 64);
    const opt = { nullBase: 3, lmrOn: true, lmrDiv: 2.25, futMargin: 100, checkExt: true, seePrune: true, treePlies: 4 };
    const st = { probes: 0, hits: 0, cuts: 0, firstCuts: 0, nullTried: 0, nullCuts: 0, lmrTried: 0, lmrRe: 0, fut: 0, checkExt: 0, seePruned: 0, deltaPruned: 0 };
    let stopAt = 0;       // nodes value at which the current chunk pauses
    let seldepth = 0;
    let rootSp = 0;       // stack index of the think root
    let nullDepth = 0;    // > 0 inside a null-move subtree (no tree deltas there)
    let deltas = null;    // Map of tree deltas for this chunk
    let treeOn = true;

    function setHash(mb) {
      const entries = 1 << Math.floor(Math.log2((mb * 1048576) / 16));
      if (tt && ttMask + 1 === entries) return;
      tt = new Int32Array(entries * 4);
      ttMask = entries - 1;
    }
    function newSearch() { ttAge = (ttAge + 1) & 63; killers.fill(0); for (let i = 0; i < history.length; i++) history[i] >>= 2; }
    function clearAll() { if (tt) tt.fill(0); killers.fill(0); history.fill(0); ttAge = 0; }
    function hashfull() {
      if (!tt) return 0;
      let n = 0;
      for (let i = 0; i < 1000; i++) if (tt[i * 4] !== 0 && ((tt[i * 4 + 2] >> 10) & 63) === ttAge) n++;
      return n;
    }
    function ttStore(depth, bound, score, move, ply) {
      const i = (hashLo & ttMask) << 2;
      const d0 = tt[i + 2];
      const sd = d0 & 255, sa = (d0 >> 10) & 63;
      const same = tt[i] === hashHi;
      if (same ? (depth >= sd - 1 || bound === EXACT || sa !== ttAge) : (sa !== ttAge || depth >= sd || tt[i] === 0)) {
        if (score > MATE_BOUND) score += ply; else if (score < -MATE_BOUND) score -= ply;
        tt[i] = hashHi;
        if (move || !same) tt[i + 1] = move;
        tt[i + 2] = (depth & 255) | (bound << 8) | (ttAge << 10);
        tt[i + 3] = score;
      }
    }
    function ttMoveFor() {
      const i = (hashLo & ttMask) << 2;
      return tt[i] === hashHi ? tt[i + 1] : 0;
    }

    function scoreMoves(s, e, ttMove, ply) {
      const us = side;
      const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
      const hb = us * 16384;
      for (let i = s; i < e; i++) {
        const m = moveBuf[i];
        let sc;
        if (m === ttMove) sc = 30000000;
        else if (m & F_CAP) {
          const att = board[m & 127] & 7;
          const vic = m & F_EP ? PAWN : board[(m >> 7) & 127] & 7;
          const mvv = 16 * ORDER_VAL[vic] - ORDER_VAL[att];
          if (ORDER_VAL[att] <= ORDER_VAL[vic] || see(m) >= 0) sc = 20000000 + mvv * 1000 + ((m >> 14) & 7);
          else sc = -20000000 + mvv;
        } else if ((m >> 14) & 7) sc = 19000000 + ((m >> 14) & 7);
        else if (m === k1) sc = 18000000;
        else if (m === k2) sc = 17000000;
        else sc = history[hb + ((m & 127) << 7) + ((m >> 7) & 127)];
        scoreBuf[i] = sc;
      }
    }
    function pick(i, e) {
      let bi = i, bs = scoreBuf[i];
      for (let j = i + 1; j < e; j++) if (scoreBuf[j] > bs) { bs = scoreBuf[j]; bi = j; }
      if (bi !== i) {
        const t = moveBuf[i]; moveBuf[i] = moveBuf[bi]; moveBuf[bi] = t;
        const u = scoreBuf[i]; scoreBuf[i] = scoreBuf[bi]; scoreBuf[bi] = u;
      }
      return moveBuf[i];
    }

    function qsearch(alpha, beta, ply) {
      if (ply > seldepth) seldepth = ply;
      if (ply >= MAXPLY - 2) return evaluate();
      const us = side;
      const chk = attacked(kingSq[us], us ^ 1);
      let best = -INF;
      if (!chk) {
        best = evaluate();
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
      }
      const s = ply * 256;
      const e = gen(s, !chk);
      // MVV-LVA ordering (evasions: captures first)
      for (let i = s; i < e; i++) {
        const m = moveBuf[i];
        if (m & F_CAP) {
          const vic = m & F_EP ? PAWN : board[(m >> 7) & 127] & 7;
          scoreBuf[i] = 1000 + 16 * ORDER_VAL[vic] - ORDER_VAL[board[m & 127] & 7] + ((m >> 14) & 7) * 20;
        } else scoreBuf[i] = ((m >> 14) & 7) * 20;
      }
      const stand = best;
      let legal = 0;
      for (let i = s; i < e; i++) {
        const m = pick(i, e);
        if (!chk) {
          const promo = (m >> 14) & 7;
          if (m & F_CAP) {
            const vic = m & F_EP ? PAWN : board[(m >> 7) & 127] & 7;
            if (!promo && stand + SEE_VAL[vic] + 200 < alpha) { st.deltaPruned++; continue; }
            if (opt.seePrune && ORDER_VAL[board[m & 127] & 7] > ORDER_VAL[vic] && see(m) < 0) { st.seePruned++; continue; }
          }
        }
        makeMove(m);
        if (attacked(kingSq[us], us ^ 1)) { unmakeMove(); continue; }
        qnodes++;
        legal++;
        const v = -qsearch(-beta, -alpha, ply + 1);
        unmakeMove();
        if (v > best) {
          best = v;
          if (v > alpha) { alpha = v; if (v >= beta) return v; }
        }
      }
      if (chk && legal === 0) return -(MATE - ply);
      return best;
    }

    function recordDelta(ply, nodesAdded, score, type, cutIdx, legal) {
      let key = '';
      for (let i = 0; i < ply; i++) key += stMove[rootSp + i] + ',';
      let d = deltas.get(key);
      if (!d) {
        d = [ply, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < ply; i++) d[1 + i] = stMove[rootSp + i];
        deltas.set(key, d);
      }
      d[6] += nodesAdded; d[7] = score; d[8] = type; d[9] = cutIdx; d[10] = legal;
    }

    function* search(depth, alpha, beta, ply, canNull) {
      if (nodes >= stopAt) yield 0;
      pvLen[ply] = ply;
      const pvNode = beta - alpha > 1;
      const us = side, them = us ^ 1;
      if (ply > seldepth) seldepth = ply;
      if (halfmove >= 100 || isRepetition()) return 0;
      const chk = attacked(kingSq[us], them);
      if (chk && opt.checkExt) { depth++; st.checkExt++; }
      if (depth <= 0) return qsearch(alpha, beta, ply);
      if (ply >= MAXPLY - 4) return evaluate();
      const n0 = nodes;
      const alpha0 = alpha;
      let ttMove = 0;
      st.probes++;
      const ti = (hashLo & ttMask) << 2;
      if (tt[ti] === hashHi) {
        st.hits++;
        ttMove = tt[ti + 1];
        const data = tt[ti + 2];
        if (!pvNode && (data & 255) >= depth) {
          let s = tt[ti + 3];
          if (s > MATE_BOUND) s -= ply; else if (s < -MATE_BOUND) s += ply;
          const b = (data >> 8) & 3;
          if (b === EXACT || (b === LOWER && s >= beta) || (b === UPPER && s <= alpha)) return s;
        }
      }
      const stat = chk ? -INF : evaluate();
      if (canNull && !chk && !pvNode && depth >= 3 && stat >= beta && hasNonPawn(us)) {
        const R = opt.nullBase + ((depth / 6) | 0);
        st.nullTried++;
        makeNull(); nullDepth++;
        const v = -(yield* search(depth - 1 - R, -beta, -beta + 1, ply + 1, false));
        nullDepth--; unmakeNull();
        if (v >= beta) { st.nullCuts++; return v >= MATE_BOUND ? beta : v; }
      }
      const s0 = ply * 256;
      const e0 = gen(s0, false);
      scoreMoves(s0, e0, ttMove, ply);
      let best = -INF, bestMove = 0, legal = 0, cutIdx = -1, nq = 0;
      const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
      const qb = ply * 64;
      let i = s0;
      for (; i < e0; i++) {
        const m = pick(i, e0);
        makeMove(m);
        if (attacked(kingSq[us], them)) { unmakeMove(); continue; }
        legal++;
        const quiet = !(m & F_CAP) && !((m >> 14) & 7);
        const gives = attacked(kingSq[them], us);
        if (depth <= 2 && quiet && !chk && !gives && legal > 1 && !pvNode && stat + opt.futMargin * depth <= alpha) {
          unmakeMove();
          st.fut++;
          const fv = stat + opt.futMargin * depth;
          if (fv > best) best = fv;
          continue;
        }
        let v;
        if (legal === 1) v = -(yield* search(depth - 1, -beta, -alpha, ply + 1, true));
        else {
          let r = 0;
          const idx = legal - 1;
          if (opt.lmrOn && quiet && depth >= 3 && idx >= 3 && !chk && !gives && m !== k1 && m !== k2) {
            r = LMR[(depth < 63 ? depth : 63) * 64 + (idx < 63 ? idx : 63)];
            if (r > depth - 2) r = depth - 2;
          }
          if (r > 0) {
            st.lmrTried++;
            v = -(yield* search(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true));
            if (v > alpha) { st.lmrRe++; v = -(yield* search(depth - 1, -alpha - 1, -alpha, ply + 1, true)); }
          } else v = -(yield* search(depth - 1, -alpha - 1, -alpha, ply + 1, true));
          if (v > alpha && v < beta) v = -(yield* search(depth - 1, -beta, -alpha, ply + 1, true));
        }
        unmakeMove();
        if (v > best) {
          best = v;
          bestMove = m;
          if (v > alpha) {
            alpha = v;
            if (pvNode) {
              const o = ply * MAXPLY, c = (ply + 1) * MAXPLY;
              pvTab[o + ply] = m;
              const L = pvLen[ply + 1];
              for (let j = ply + 1; j < L; j++) pvTab[o + j] = pvTab[c + j];
              pvLen[ply] = L > ply + 1 ? L : ply + 1;
            }
            if (v >= beta) {
              st.cuts++;
              if (legal === 1) st.firstCuts++;
              cutIdx = legal - 1;
              if (quiet) {
                if (m !== k1) { killers[ply * 2 + 1] = k1; killers[ply * 2] = m; }
                const b = depth * depth;
                const hb = us * 16384;
                let hi = hb + ((m & 127) << 7) + ((m >> 7) & 127);
                history[hi] += b - ((history[hi] * b) >> 14);
                for (let j = 0; j < nq; j++) {
                  const q = quietBuf[qb + j];
                  hi = hb + ((q & 127) << 7) + ((q >> 7) & 127);
                  history[hi] += -b - ((history[hi] * b) >> 14);
                }
              }
              break;
            }
          }
        }
        if (quiet && nq < 64) quietBuf[qb + nq++] = m;
      }
      let legalTotal = legal;
      if (treeOn && ply <= opt.treePlies && nullDepth === 0 && deltas) {
        if (cutIdx >= 0) {
          const keep = countNodes; countNodes = false;
          for (let j = i + 1; j < e0; j++) { makeMove(moveBuf[j]); if (!attacked(kingSq[us], them)) legalTotal++; unmakeMove(); }
          countNodes = keep;
        }
      }
      if (legal === 0) {
        best = chk ? -(MATE - ply) : 0;
      }
      if (legal > 0) ttStore(depth, best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER, best, bestMove, ply);
      if (treeOn && ply <= opt.treePlies && nullDepth === 0 && deltas) {
        recordDelta(ply, nodes - n0, best, best >= beta ? CUT_NODE : best > alpha0 ? PV_NODE : ALL_NODE, cutIdx, legalTotal);
      }
      return best;
    }

    // ---- root search over a list of root moves (one worker): depths 1-4 of a deep think, and the quick pass ----
    // rm: array of {m, score, nodes}; returns {score, best, pv}
    function* rootSearch(depth, alpha, beta, rm) {
      const us = side, them = us ^ 1;
      const alpha0 = alpha;
      let best = -INF, bestMove = 0;
      pvLen[0] = 0;
      const n0 = nodes;
      for (let k = 0; k < rm.length; k++) {
        const r = rm[k];
        const nb = nodes;
        makeMove(r.m);
        let v;
        if (k === 0) v = -(yield* search(depth - 1, -beta, -alpha, 1, true));
        else {
          v = -(yield* search(depth - 1, -alpha - 1, -alpha, 1, true));
          if (v > alpha && v < beta) v = -(yield* search(depth - 1, -beta, -alpha, 1, true));
        }
        unmakeMove();
        r.nodes = nodes - nb;
        r.score = v;
        r.bound = v <= alpha ? UPPER : v >= beta ? LOWER : EXACT;
        if (v > best) {
          best = v; bestMove = r.m;
          if (v > alpha) {
            alpha = v;
            pvTab[0] = r.m;
            const L = pvLen[1];
            for (let j = 1; j < L; j++) pvTab[j] = pvTab[MAXPLY + j];
            pvLen[0] = L > 1 ? L : 1;
            if (v >= beta) break;
          }
        }
      }
      if (treeOn && deltas) {
        // root node itself is ply 0: not drawn as a node, its children are
      }
      ttStore(depth, best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER, best, bestMove, 0);
      const pv = [];
      for (let j = 0; j < pvLen[0]; j++) pv.push(pvTab[j]);
      return { score: best, best: bestMove, pv, nodes: nodes - n0 };
    }

    // ---- single root move: the unit of the parallel root split ----
    function* moveSearch(m, depth, alpha, beta) {
      const n0 = nodes;
      pvLen[1] = 1;
      makeMove(m);
      const v = -(yield* search(depth - 1, -beta, -alpha, 1, true));
      unmakeMove();
      const pv = [m];
      for (let j = 1; j < pvLen[1]; j++) pv.push(pvTab[MAXPLY + j]);
      return { score: v, pv, nodes: nodes - n0 };
    }

    // ---- a root move and one reply: the unit of the PV split (score from the root side, ply 2) ----
    function* moveSearch2(m, m2, depth, alpha, beta) {
      const n0 = nodes;
      pvLen[2] = 2;
      makeMove(m);
      makeMove(m2);
      const v = yield* search(depth, alpha, beta, 2, true);
      unmakeMove();
      unmakeMove();
      const pv = [m, m2];
      for (let j = 2; j < pvLen[2]; j++) pv.push(pvTab[2 * MAXPLY + j]);
      return { score: v, pv, nodes: nodes - n0 };
    }

    // ---- perft as a generator (pauses at the budget, exact count) ----
    const perftBuf = new Int32Array(16 * 256);
    function perftLeaf(depth, ply) {
      // plain recursion for the last plies
      const s = ply * 256;
      const e = gen(s, false);
      const us = side, them = us ^ 1;
      let c = 0;
      for (let i = s; i < e; i++) {
        const m = moveBuf[i];
        makeMove(m);
        if (!attacked(kingSq[us], them)) c += depth === 1 ? 1 : perftLeaf(depth - 1, ply + 1);
        unmakeMove();
      }
      return c;
    }
    function* perft(depth, ply) {
      if (depth <= 2) return perftLeaf(depth, ply);
      const s = ply * 256;
      const e = gen(s, false);
      for (let i = s; i < e; i++) perftBuf[i] = moveBuf[i];
      const us = side, them = us ^ 1;
      let c = 0;
      for (let i = s; i < e; i++) {
        if (nodes >= stopAt) yield 0;
        const m = perftBuf[i];
        makeMove(m);
        if (!attacked(kingSq[us], them)) c += depth === 3 ? perftLeaf(2, ply + 1) : yield* perft(depth - 1, ply + 1);
        unmakeMove();
      }
      return c;
    }

    return {
      setFEN, getFEN, legalMoves, makeMove, unmakeMove, toSAN, parseSAN, pvToSAN, evaluate, evalBreakdown, see, bestCaptureSEE,
      attackMap, inCheck, attacked, gen,
      get board() { return board; }, get side() { return side; }, get castle() { return castle; }, get ep() { return ep; },
      get hashLo() { return hashLo; }, get hashHi() { return hashHi; }, get sp() { return sp; }, get phase() { return phase; },
      get nodes() { return nodes; }, set nodes(v) { nodes = v; }, get qnodes() { return qnodes; }, set qnodes(v) { qnodes = v; },
      get stopAt() { return stopAt; }, set stopAt(v) { stopAt = v; },
      get seldepth() { return seldepth; }, set seldepth(v) { seldepth = v; },
      get rootSp() { return rootSp; }, set rootSp(v) { rootSp = v; },
      get deltas() { return deltas; }, set deltas(v) { deltas = v; },
      get treeOn() { return treeOn; }, set treeOn(v) { treeOn = v; },
      get countNodes() { return countNodes; }, set countNodes(v) { countNodes = v; },
      stackMoves(from, to) { const out = []; for (let i = from; i < to && i < sp; i++) out.push(stMove[i]); return out; },
      reset() { nullDepth = 0; seldepth = 0; },
      opt, st, setHash, newSearch, clearAll, hashfull, search, rootSearch, moveSearch, moveSearch2, perft, perftLeaf, ttMoveFor,
      killers, history, get tt() { return tt; }, get ttAge() { return ttAge; }, get ttMask() { return ttMask; },
      buildLMR,
    };
  }

  G.Engine = {
    createEngine, sqName, sqFromName, sq64, buildLMR,
    PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK, INF, MATE, MATE_BOUND, MAXPLY,
    F_CAP, F_EP, F_CASTLE, F_DOUBLE, EXACT, LOWER, UPPER, PV_NODE, CUT_NODE, ALL_NODE, MG_VAL, EG_VAL, SEE_VAL,
    START: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  };
}
// =====================================================================================================
// The worker side: a job queue run in chunks of a node budget sent by the page every frame. Each worker has its own
// engine and its own private transposition table; workers share no memory.
function WorkerMain(S) {
  'use strict';
  const E = S.Engine;
  const e = E.createEngine();
  let eb = null; // background engine (own board, own 8 MB TT): only runs when the root split has nothing for this worker
  let bgQueue = [], bgCur = null;
  let wid = 0, game = [], queue = [], cur = null, think = -1, chunkEnd = 0;
  const ST_KEYS = ['probes', 'hits', 'cuts', 'firstCuts', 'nullTried', 'nullCuts', 'lmrTried', 'lmrRe', 'fut', 'checkExt', 'seePruned', 'deltaPruned'];
  const stLast = new Float64Array(ST_KEYS.length);

  function setup(ply, en = e) {
    en.setFEN(E.START);
    const cn = en.countNodes;
    en.countNodes = false;
    for (let i = 0; i < ply; i++) en.makeMove(game[i]);
    en.countNodes = cn;
    en.reset();
    en.rootSp = en.sp;
  }
  // runs gen until it finishes ({ok, value}) or the node cap is hit ({ok: false}); pauses at chunk ends
  function* capped(gen, capEnd, en = e) {
    for (;;) {
      en.stopAt = Math.min(en === e ? chunkEnd : en.chunkEnd, capEnd);
      const r = gen.next();
      if (r.done) return { ok: true, value: r.value };
      if (en.nodes >= capEnd) return { ok: false };
      yield 0;
    }
  }
  function orderRoot(rm, best) {
    rm.sort((a, b) => (b.m === best) - (a.m === best) || b.nodes - a.nodes || b.stat - a.stat);
  }
  function rootList(en = e) {
    return en.legalMoves().map((m) => ({ m, score: 0, nodes: 0, bound: 0, stat: (m & E.F_CAP ? 1000 : 0) + ((m >> 14) & 7) * 100 }));
  }
  const snapRM = (rm) => rm.map((r) => [r.m, r.score, r.bound, r.nodes]);

  function* jobPerft(j) {
    e.setFEN(j.fen);
    const n0 = e.nodes;
    const g = e.perft(j.depth, 0);
    let r;
    for (;;) { e.stopAt = chunkEnd; r = g.next(); if (r.done) break; yield 0; }
    return { count: r.value, makes: e.nodes - n0 };
  }
  function* jobID(j) {
    // depths 1..depthMax of a deep think on one worker: full root search, results per depth
    setup(j.ply);
    e.treeOn = true;
    const rm = rootList();
    const out = [];
    for (let d = 1; d <= j.depthMax; d++) {
      const n0 = e.nodes;
      const r = yield* e.rootSearch(d, -E.INF, E.INF, rm);
      orderRoot(rm, r.best);
      out.push({ d, score: r.score, best: r.best, pv: r.pv, nodes: e.nodes - n0, sel: e.seldepth, rm: snapRM(rm) });
    }
    return { depths: out };
  }
  function* jobMove(j) {
    setup(j.ply);
    e.treeOn = true;
    const r = yield* e.moveSearch(j.m, j.depth, j.alpha, j.beta);
    return { score: r.score, pv: r.pv, sel: e.seldepth };
  }
  function* jobMove2(j) {
    setup(j.ply);
    e.treeOn = true;
    const r = yield* e.moveSearch2(j.m, j.m2, j.depth, j.alpha, j.beta);
    return { score: r.score, pv: r.pv, sel: e.seldepth };
  }
  function* jobQuick(j, en = e) {
    // quick pass (and background pass): iterative deepening to j.depth (node-capped), the played move's exact score,
    // an only-move test
    setup(j.ply, en);
    en.treeOn = false;
    en.newSearch();
    const capEnd = en.nodes + j.cap;
    const rm = rootList(en);
    if (!rm.length) return { none: true };
    let done = null, found = 0;
    for (let d = 1; d <= j.depth; d++) {
      let lo = -E.INF, hi = E.INF, delta = 25, fails = 0;
      if (done && d >= 4) { lo = done.score - delta; hi = done.score + delta; }
      let res = null;
      for (;;) {
        const c = yield* capped(en.rootSearch(d, lo, hi, rm), capEnd, en);
        if (!c.ok) break;
        const r = c.value;
        if (r.score <= lo && lo > -E.INF) { fails++; delta *= 2; lo = fails >= 3 ? -E.INF : r.score - delta; continue; }
        if (r.score >= hi && hi < E.INF) { fails++; delta *= 2; hi = fails >= 3 ? E.INF : r.score + delta; continue; }
        res = r;
        break;
      }
      if (!res) { setup(j.ply, en); break; }
      orderRoot(rm, res.best);
      found = done && done.best === res.best ? found : d;
      done = { d, score: res.score, best: res.best, pv: res.pv };
    }
    if (!done) done = { d: 0, score: 0, best: rm[0].m, pv: [rm[0].m] };
    const D = Math.max(1, done.d);
    let played = done.score;
    if (j.played && j.played !== done.best) {
      const r = yield* en.moveSearch(j.played, D, -E.INF, done.score + 1);
      played = r.score;
    }
    // only move: does any other move reach best - 150? (null-window scouts at depth D - 1)
    let only = rm.length > 1 && Math.abs(done.score) < E.MATE_BOUND;
    const t = done.score - 150;
    if (only) {
      for (const r of rm) {
        if (r.m === done.best) continue;
        const v = (yield* en.moveSearch(r.m, Math.max(1, D - 1), t - 1, t)).score;
        if (v >= t) { only = false; break; }
      }
    }
    return { depth: done.d, score: done.score, best: done.best, pv: done.pv, played, only, legal: rm.length, found };
  }

  function start(j) {
    if (j.think !== undefined && j.think !== think) { think = j.think; e.newSearch(); }
    e.seldepth = 0;
    const g = j.kind === 'perft' ? jobPerft(j) : j.kind === 'id' ? jobID(j) : j.kind === 'move' ? jobMove(j) : j.kind === 'move2' ? jobMove2(j) : jobQuick(j);
    return { job: j, gen: g, n0: e.nodes };
  }

  S.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.t === 'init') { wid = msg.id; game = msg.game; e.setHash(msg.hash); return; }
    if (msg.t !== 'run') return;
    const t0 = performance.now();
    if (msg.opt) {
      const o = msg.opt;
      if (o.hash) e.setHash(o.hash);
      if (o.lmrDiv && o.lmrDiv !== e.opt.lmrDiv) e.buildLMR(o.lmrDiv);
      Object.assign(e.opt, o);
    }
    if (msg.cancel && msg.cancel.length) {
      if (cur && msg.cancel.includes(cur.job.id)) cur = null;
      queue = queue.filter((j) => !msg.cancel.includes(j.id));
    }
    if (msg.jobs) for (const j of msg.jobs) { if (j.front) queue.unshift(j); else queue.push(j); }
    if (msg.bg) for (const j of msg.bg) bgQueue.push(j);
    const n0 = e.nodes, q0 = e.qnodes;
    chunkEnd = n0 + msg.budget;
    e.deltas = new Map();
    const results = [];
    let sel = 0;
    while (e.nodes < chunkEnd) {
      if (!cur) {
        if (!queue.length) break;
        cur = start(queue.shift());
      }
      e.stopAt = chunkEnd;
      const r = cur.gen.next();
      if (e.seldepth > sel) sel = e.seldepth;
      if (r.done) {
        results.push({ id: cur.job.id, kind: cur.job.kind, nodes: e.nodes - cur.n0, ...r.value });
        cur = null;
      } else break;
    }
    const usedMain = e.nodes - n0;
    // background pass in the rest of the budget
    let usedBg = 0, qBg = 0;
    if (!cur && !queue.length && (bgCur || bgQueue.length) && usedMain < msg.budget) {
      if (!eb) { eb = E.createEngine(); eb.setHash(8); }
      const b0 = eb.nodes, bq0 = eb.qnodes;
      eb.chunkEnd = b0 + (msg.budget - usedMain);
      while (eb.nodes < eb.chunkEnd) {
        if (!bgCur) {
          if (!bgQueue.length) break;
          const j = bgQueue.shift();
          bgCur = { job: j, gen: jobQuick(j, eb), n0: eb.nodes };
        }
        eb.stopAt = eb.chunkEnd;
        const r = bgCur.gen.next();
        if (r.done) { results.push({ id: bgCur.job.id, kind: 'bg', nodes: eb.nodes - bgCur.n0, ...r.value }); bgCur = null; }
        else break;
      }
      usedBg = eb.nodes - b0;
      qBg = eb.qnodes - bq0;
    }
    const st = [];
    for (let i = 0; i < ST_KEYS.length; i++) { const v = e.st[ST_KEYS[i]] + (eb ? eb.st[ST_KEYS[i]] : 0); st.push(v - stLast[i]); stLast[i] = v; }
    const flat = [];
    for (const d of e.deltas.values()) for (let i = 0; i < 11; i++) flat.push(d[i]);
    const reply = {
      id: wid, used: usedMain + usedBg, usedMain, usedBg, bgJob: bgCur ? bgCur.job.id : -1, q: e.qnodes - q0 + qBg, st, results, deltas: flat, sel,
      job: cur ? cur.job.id : -1, stack: cur && cur.job.kind !== 'perft' ? e.stackMoves(e.rootSp, e.rootSp + 14) : [], ms: 0,
      hashfull: e.hashfull(), think,
    };
    if (msg.snap) {
      const h = new Int16Array(4096);
      const H = e.history;
      for (let f = 0; f < 64; f++) for (let t = 0; t < 64; t++) {
        const F = ((f >> 3) << 4) | (f & 7), T = ((t >> 3) << 4) | (t & 7);
        h[f * 64 + t] = Math.min(32767, Math.max(Math.abs(H[(F << 7) + T]), Math.abs(H[16384 + (F << 7) + T])));
      }
      reply.hist = h;
      reply.killers = Array.from(e.killers.subarray(2, 18));
      // TT occupancy by age: share of 8,192 sampled slots whose entry is 0..15 thinks old (index 16 = empty)
      const tt = e.tt, n = e.ttMask + 1, age = e.ttAge, samp = 8192, step = Math.max(1, Math.floor(n / samp));
      const hist = new Uint32Array(17);
      for (let k = 0; k < samp; k++) {
        const i = ((k * step) & e.ttMask) * 4;
        if (tt[i] === 0) { hist[16]++; continue; }
        const d = (age - ((tt[i + 2] >> 10) & 63) + 64) & 63;
        if (d < 16) hist[d]++; else hist[15]++;
      }
      const occ = new Float32Array(17);
      for (let k = 0; k < 17; k++) occ[k] = hist[k] / samp;
      reply.occ = occ;
    }
    reply.ms = performance.now() - t0;
    S.postMessage(reply);
  };
}

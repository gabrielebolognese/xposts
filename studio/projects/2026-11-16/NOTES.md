# Engine Room: The Game of the Century (Claude Studio 001)

Everything on screen is computed live by a chess engine written from scratch in plain JS (no libraries, no images,
no glyph fonts), searching the Byrne vs Fischer game (New York 1956) with 8 Web Workers.

## What runs

- **Engine** (`engine.js`, one source used by the page and by every worker through a Blob URL built from the
  function source): 0x88 `Int8Array(128)` board with piece lists, incremental Zobrist keys (two 32-bit halves from
  xorshift32), incremental PeSTO tapered eval (CPW tables, phase = N+B+2R+4Q, +30 bishop pair, +10 tempo), pseudo-legal
  generation with castling, en passant and promotions, SEE, SAN.
- **Correctness checks at load**: perft on worker 0, start d1-5 (4,865,609), Kiwipete d1-4 (4,085,603), position 3
  d1-5 (674,624), all exact. The game is replayed by matching each SAN move against the engine's own legal moves.
- **Search** (each worker): iterative deepening, fail-soft PVS, 16-byte TT entries (key, move, depth|bound|age,
  score with mate-ply adjustment), check extension, null move R = 3 + d/6, LMR r = floor(0.75 + ln d ln i / 2.25)
  with re-search, futility at d <= 2 (100 cp/ply), quiescence with stand-pat, MVV-LVA, SEE < 0 pruning and delta 200,
  killers, history with gravity, repetition and 50-move draws.
- **Parallel root split** (coordinator on the page, private TT per worker, no shared memory): depths 1-4 on one
  worker; from depth 5 the best move runs as the PV job with an aspiration window (25 cp, doubled per fail, open after
  3), every other move goes out at once as a null-window scout at (3rd-best previous score - 25). Scouts below alpha
  are resolved, scouts above get full-window re-searches, the move played in the game always gets an exact score, an
  iteration ends when every root move is resolved. Re-searches go back to the worker that just searched the move
  (warm TT). Two additions to the brief, because a pure root split leaves workers idle whenever one move dominates
  (and this game is full of checks with 3 to 7 legal moves): (1) from depth 6 the PV move is itself split one level
  deeper, young-brothers-wait style: its first reply sets the bound, then all other replies go out in parallel as
  null-window scouts (late quiet ones reduced, as LMR does) with re-searches where needed; workers that would idle
  during the wait scout the other replies at the expected score; (2) idle workers do not
  wait for the slowest root move: they start the next depths (up to 4 ahead) on moves already resolved, and the PV
  move itself is pipelined (its next depth starts on the window centre of the running one without waiting for it);
  those results become bounds when that depth starts. This keeps all eight workers on the current think even in the
  forced positions (18...Bxc4+, 19...Ne2+), where a plain root split left five of them idle. Search instability (a scout and its re-search disagreeing) is
  capped: after a few contradicting results for the same move the latest score is taken as exact.
- **Background pass**: each worker also has a second engine (own board, own 8 MB TT) that runs only in the part of
  a frame's budget the root split leaves unused (a job finished early, or a position with one or two legal moves).
  It re-analyses the positions the deep pass does not reach, end of the game first, at depth 10, then 12, 14; a
  result never replaces a deeper one. It shows as a violet band at the foot of each worker lane, violet depth labels
  in the record and a dashed violet line in the eval graph.
- **What the panels count**: the UCI log, the iteration table and the top-bar NPS all use one scope, the nodes of
  the current think's deep search by all workers (cumulative, like UCI `nodes`/`time`); background work is shown
  apart (BG NPS chip, violet lane bands). The iteration table's EBF is N(d)/N(d-1) on those cumulative node counts. Hashfull is the current think's entries over all eight tables (a worker that
  has not joined the think yet counts zero), so it only grows during a think. The aspiration inset shows the window of
  the current depth, centred on the previous iteration's score, with every widening counted (a speculative PV window
  is kept only if it contains that score, otherwise it is cancelled and restarted as prev +- 25).
- **MultiPV 3**: each depth, the 2nd and 3rd moves of the last depth get exact-window searches (aspiration around
  their last score, widened on fails) beside the root split; they do not hold the iteration back, and their exact
  scores feed the UCI lines `pv 2` / `pv 3` and the root table. The UCI log also prints `currmove` for the root move
  last sent to a worker with its real rank (at most every 500 ms) and a status line every 5M nodes.
- **Root-move table**: each row shows the exact score of the depth being searched; until it has one, the exact score
  of the last resolved depth (dimmed, so MultiPV moves and the played move keep their exact scores); otherwise the
  current bound, then the last bound. The best move always shows the last resolved depth's score, the same number as
  the tree centre, its tree label, the PV line and the iteration table. Rows are sorted by that number, an upper bound
  ranking below an exact score of the same value. The d column shows the current depth once a move is resolved in it
  (the old depth dimmed otherwise). The played move has its own Δ (CPL) column.
- **Metered by frames** (so the video shows exactly what a live run shows): every frame each worker gets one chunk
  of 15,000 nodes (60,000 for perft); the search and perft are generators that pause at the budget and resume. Replies
  are registered with `STUDIO.wait` and processed in worker order. All speeds are nodes per second of the frame clock.
- **Schedule**: at load worker 0 runs perft while the others run the quick pass (all 82 positions at depth 7, node
  capped, plus the played move's exact score and an only-move test). At 3.0 s the deep pass starts after 14.Bxe7 with
  exactly 7.0 s per position (UCI `go movetime` semantics: it searches for the whole movetime; the unfinished last
  iteration is discarded, the result is the last fully resolved depth). The think on 17...Be6 runs from 45 s to 52 s
  after load, i.e. video seconds 15-22.

## Headline numbers (STUDIO.report)

Values from the deterministic preview render at the last video frame (the recording replays the same frames):
nodes_total 577,254,980 · nps_peak 7,209,287 · depth_max 17 · seldepth_max 37 · be6_found_depth 5 ·
be6_eval_cp +111 (the last completed iteration of the 7 s think on 17...Be6; best from depth 5 on) ·
cutoff_first_pct 89.6 · workers_busy_pct 86.4.

- `nodes_total`: make() calls (including quiescence) of the quick, deep and background passes, summed over workers.
- `nps_peak`: highest sum over workers in a 1 s window of the frame clock (all passes; the top bar splits it into the
  deep pass, NPS, and the background pass, BG NPS).
- `depth_max` / `seldepth_max`: deepest fully resolved iteration of any deep think / deepest ply reached.
- `be6_found_depth`: iteration at which 17...Be6 became and stayed best in the position after 17.Kf1.
- `be6_eval_cp`: exact score of 17...Be6 at the last completed depth, Black's view, centipawns.
- `cutoff_first_pct`: beta cutoffs on the first move / all beta cutoffs.
- `workers_busy_pct`: root-split nodes used / nodes offered over all worker frames of the deep pass (background work
  is not counted, so this stays the load balance of the root split itself).

## Simplified or changed

- '!!' needs a real, non-obvious sacrifice: CPL <= 10; the move leaves its side at least 300 cp down by SEE (captured
  value minus the opponent's best SEE capture afterwards) and gives up at least 300 cp more than the mover's safest
  alternative; the engine only settles on it from depth 4 on; and the mover is neither losing (score >= -0.30) nor
  already winning (<= +3.00). This marks exactly 11...Na4, 15...Nxc3 and 17...Be6. The brief's plain rule (opponent's
  best capture >= 300) marked forced moves like 17.Kf1 and Byrne's 15.Bc4 and 16.Bc5 as brilliant, because pieces
  hang all over this game.
- The tree keeps every node at plies 1-4 but draws all of plies 1-2 and only the heaviest children at plies 3-4
  (plus worker paths and the PV), about 2,000-3,000 dots; outer-ring dots are capped in size to stay distinct.
- The PAGE histogram shows this page's JavaScript time per frame (core + panels) in 1 ms bins with the 16.7 ms line;
  the recorder freezes performance.now inside a frame, so there it is measured with the real clock. Textures and the
  first draw of every panel happen at load, so no single frame is long (worst measured frame about 30 ms, the
  average about 10 ms).
- The top bar's NPS is all workers, split into the deep search and the background pass; the worker column shows a
  worker's background rate in violet ("bg 640") when it is on the background pass, and the tree marks such workers
  with violet dots outside the last ring.
- Quick-pass "only move" test runs at depth - 1.
- Root split efficiency still drops in positions with one or two legal moves (19.Kg1, 20.Kf1), where the idle
  budget goes to the background pass; over the deep pass busy is about 86%. A
  recursive split along the whole PV was tried and was not faster than the one-level split, so it was dropped.
- When a position has few legal moves, the second column of the root-move table lists the PV move's replies from
  the split (bounds, worker, job type) instead of staying empty.

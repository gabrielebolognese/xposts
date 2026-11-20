# Every Gate: a RISC-V core paints a Mandelbrot (Claude Studio 004)

A 5-stage pipelined RV32I + MUL/MULH CPU, written as a gate-level netlist by small HDL-style JS functions. Every gate is simulated on every clock cycle while the core runs a fixed-point Mandelbrot program, assembled in the page. A separate ISA model checks every retired instruction in lockstep. Six workers deliberately break gates (stuck-at faults) to measure fault coverage. There are no libraries: the page uses hand-written WebGL2 for the die, canvas 2D for everything else, Web Workers, and a hand-assembled WebAssembly SIMD function.

## What is built and simulated

- **Netlist (hdl.js)**: the primitives are NOT, AND2, OR2, NAND2, NOR2, XOR2, XNOR2, MUX2 and positive-edge DFFs. Enables and synchronous resets are MUX2/AND gates in front of the DFF. The builder folds constants, hashes structure (the same gate is never built twice) and sweeps dead logic, as a synthesizer would. Result: **12,440 logic cells + 1,560 DFFs = 14,000 cells (an exact count, not rounded), 29,812 NAND2-equivalents** (weights INV 0.67, NAND/NOR 1, AND/OR 1.33, XOR/XNOR 2, MUX2 2.33, DFF 5.0; the brief gave no DFF weight).
- **Blocks**:
  - IF: PC register, a PC+4 incrementer (a Kogge-Stone adder folded down by the constant), and a next-PC mux with the priority EX redirect > stall > ID redirect > PC+4.
  - IF/ID register.
  - ID: full decoder; an I/S/B/U/J immediate generator; a 31×32 DFF register file (x0 hardwired) with a 5→32 write decoder, two 32:1 MUX2 read trees and a WB→ID bypass. The hazard unit stalls on load-use, or on any RAW hazard when forwarding is off. BTFN prediction redirects backward branches and JAL from ID through a dedicated KS32 target adder.
  - ID/EX register.
  - EX: forwarding muxes (EX/MEM first, then MEM/WB); a KS32 add/sub; SLT/SLTU from the sign and carry; logic ops; and a 5-level log shifter (SLL by bit reversal, SRA by sign fill). The multiplier is a 32×32 Baugh-Wooley array: 1,024 partial-product gates, a Dadda tree (8 stages, 900 full adders and 30 half adders) and a 64-bit Kogge-Stone final adder. A branch comparator sits on the ALU subtractor. Mispredicts and JALR flush IF/ID and ID/EX.
  - EX/MEM register; MEM: byte enables, store lane replication, and load alignment with sign/zero extension.
  - MEM/WB register; WB mux.
  - The ROM (16 KiB) and RAM (64 KiB, framebuffer at 0x0001_8000) are behavioral arrays at the netlist ports. The UART is a store-byte to 0x2000_0000.
- **Simulation**: gates are levelized (logic depth up to 49) and compiled into straight-line JS functions, one per level slice of at most 560 statements so V8 optimizes every one. The functions close over one fixed Int32Array, so V8 drops the bounds checks. One cycle: DFF Q←D, drive the memory read ports from flop outputs (imem[PC.Q], dmem[EXMEM.res.Q]), evaluate every gate in level order, then commit the store seen on the bus. Each net is a 32-bit word (32 machines in parallel; the fault workers use all 32 lanes).
- **Toggles**: exact, every cycle, per net. The state is copied into WebAssembly memory and a hand-assembled SIMD function (wasmtog.js, the bytes are generated in JS) XORs it against the previous cycle, 4 nets per instruction. That made toggle counting about 7× cheaper than a JS loop (about 4 µs instead of 28 µs per cycle in Chrome). The floorplan lights every cell by its toggle rate, and the cells that switched in the last 2 cycles of each chunk flash white.
- **Golden model (golden.js)**: an RV32I+MUL/MULH interpreter written straight from the ISA. Each instruction leaving WB is compared on pc, rd, write data and the store address, byte enables and data. A divergence would be counted and logged.
- **Verification**:
  - At boot the sim worker runs a randomized ISA self-test on the same compiled netlist: 16 random programs with every instruction class, dense RAW and load-use hazards, branches, loops and JAL/JALR, under all forwarding and predictor settings, in lockstep. Result on screen: **16/16 programs, 20,367 instructions, 0 divergences**.
  - Offline, 105 random programs (272k instructions) passed the same way.
  - The random test found one real bug during the build: SLT/SLTI did not set the subtract control. The Mandelbrot never uses SLT, so only the random test could have caught it. It was fixed.
- **Program (prog.js)**: a Mandelbrot in Q4.28, assembled in the page by a two-pass assembler (asm.js). The fixed multiply is (MULH<<4)|(MUL>>>28). The loop iterates while |z|²<4, with a |zr|,|zi|<2 guard so the squares cannot overflow Q4.28, up to MAXIT=32. Pixels are 48×32 bytes in RAM. After each row it prints `r=NN it=NNNNN`; after each frame it prints `f=N it=NNNNN cs=XXXXXXXX` (a byte checksum), then multiplies the pixel step by 1/zoom (×2 per frame) around −0.743643887 + 0.131825904i. The program uses every load/store width (SB, SH, LBU, LHU, LW, SW), JAL/JALR calls and leaf routines.
- **Fault simulation (6 workers)**: the universe is SA0 and SA1 on every cell output (gates and DFFs): 28,000 faults. Batches draw 31 faults without replacement from a seeded permutation. Lane 0 is the good machine; faults are forced right after their level evaluates. The primary outputs (imem addr, dmem addr, wdata, byte enables, we, retire-valid) are compared with lane 0 every cycle. A differing lane is detected and dropped. Memory read data comes from lane 0. Each test runs 4,096 cycles of the program from reset. Coverage is detected/simulated, with a 95% Wilson interval; per-module coverage and the detection-latency histogram are on screen, and undetected faults are red ticks on the floorplan.
- **Metering**: everything is metered by animation frames. The sim follows a frame-indexed schedule: 3,000 cycles per frame until cycle 330,000, then the clock target / 60 per frame (24 kHz = 400 cycles). Each fault worker gets a frame-metered budget of 40-88 cycles per frame (mean 64), drawn from a seeded generator so the render is deterministic. It reports the real cycles completed every frame. The six workers start 11 frames apart, and with the varying budgets their 4,096-cycle tests drift apart naturally. The fault panel shows the measured faults per second against the page clock. Every reply is registered with STUDIO.wait. Speeds (sim Hz, gate evals/s) are counted against the page clock.

## Parameters (on screen, all live)

Clock target 24 kHz (1-60), forwarding on/off, predictor BTFN/not-taken, MAXIT 32 (written into program RAM, next frame), zoom ×2.0 per frame (written into RAM), golden lockstep on/off (the model keeps stepping when off), fault model SA0/SA1, fault workers 6 (1-12), test length 4096, process V 0.90 V · C 1.2 fF · f 500 MHz, heat decay 0.92.

The controls work in a live run (click or drag). Each row also shows a live readout: measured clock, forwards per instruction, branch accuracy, MAXIT read back from RAM, the next frame's width, instructions checked, fault universe, batches issued, estimated power and the heat half-life. Forwarding off and not-taken prediction were both verified in lockstep (IPC 0.525 and 0.922).

## Headline numbers (STUDIO.report, values at the end of the 52 s render)

| key | value | meaning |
| --- | --- | --- |
| gate_count | 12,440 logic cells + 1,560 DFFs (29,812 NAND2-eq) | all simulated every cycle |
| sim_hz | 24,000 | gate-level clock against the page clock (paced by the clock target, so it reads exactly 24.00 in the render); gate evals 298.6 M/s. Beside it, 'cap' is the measured capacity: cycles per second of the sim worker's own compute time, about 55-65 kHz. The live run on this laptop holds 24.0 kHz at 60 fps |
| instret | about 2.15 M by the end of the video | instructions retired by the gate-level core, each checked |
| lockstep_divergences | 0 | of every retired instruction (plus 0 in the boot self-test) |
| ipc | 0.955 | CPI 1.047, after load-use stalls (about 1.9 k) and flushes |
| branch_accuracy | 98.5% | BTFN, conditional branches resolved in EX |
| fault_coverage | about 82.1% (95% Wilson 81.5-82.8%) | about 14 k of the 28 k faults sampled by the end of the video |
| crit_path_levels | 49 | idex → fwd mux (10) → Baugh-Wooley PP (1) → Dadda (24) → KS64 (12) → result mux (2) → EX/MEM |
| isa_selftest | 16/16 programs, 20,367 instructions, 0 divergences | random instruction streams at boot |

Other measured numbers on screen: toggles per cycle about 2,200 (α about 16%), estimated dynamic power about 0.54 mW (½·toggles·C·V²·f, labelled est.), per-module toggles, α, µW, depth and coverage, forward counts, flushes, stalls, and the dynamic depth (the deepest level that toggled in the last cycle).

Averaging windows are labelled on screen:
- Toggles, α and power in the floorplan header, the hierarchy table and the process control come from one shared 1 s window (the last 60 chunks). It is refreshed 4 times a second, and every panel that shows it redraws on that same frame, so the three always agree.
- The analyzer's toggle count is the single cycle at its trigger (@T).
- The counters, register file and retire trace are redrawn every frame from the same chunk.

## Timeline in the video

The warm-up ends with frame 1 done (thumbnail plus its checksum line) and frame 2 about 45% painted. Frame 2 finishes about 25 s into the video, while the camera is on the framebuffer, and frame 3 then paints through the rest.

## Honest notes and simplifications

- **Result muxing**: ALU / MUL / MULH / PC+4 are muxed in EX, so EX/MEM carries one result and forwarding needs no extra mux. The WB mux selects result or load. The brief put all four in WB.
- **Trace port**: EX/MEM and MEM/WB carry the PC as a trace port for the lockstep checker, like RISC-V's RVFI. These flops only reach the trace, not the fault-sim outputs, which is one reason the pipeline registers show lower coverage.
- **Hierarchy glue row**: the core has one cell placed directly in the top module (the reset inverter). The table lists it as 'glue', so the children add up exactly to the core totals.
- **Fault coverage per module**: the regfile is about 57% and the IF unit about 45%, because a 4,096-cycle test from reset touches few registers and never exercises the upper PC bits. The multiplier is 98-99%.
- **Pipeline diagram**: the last 16 cycles with 12 instruction rows at 9 px on a 10 px pitch. A 24-cycle version needed 7 px rows to fill its diagonal, which is unreadable at 1080p, so readability won over the brief's 24.
- **CPU threads**: the browser cannot see which OS thread runs which worker. Each tile is tagged by load rank over the last 3 s: the busiest is tagged sim, the next main, then W1-W6, and the rest os. The panel subtitle says it is a load-rank heuristic. The ms/frame row under the grid is measured: every worker's compute time per frame, timed inside the worker. The frame-time trace uses the kit's recorded live numbers in the video.
- **Waveforms**: the core runs 400 cycles per display frame, so a 256-cycle window cannot scroll smoothly. The logic analyzer shows triggered captures, 4 per second, rotating through flush↑, mem_we↑, bp_taken↑ and free run, with a zoom pane of 7 cycles around the trigger.
- **Floorplan**: placement is bit-sliced: rows are bit index, columns follow logic level within each module, and control logic sits in a strip below. Rulers are in placement sites (one site = one cell pitch), not physical units. Empty sites show as dim dots.
  - The empty parts of the control strip carry live readouts, each inside its bus's span with a leader: PC redirect (target, flushes, mispredict rate), write-back (register, value, retired count) and the multiplier's operands and high product this cycle.
  - Module names step aside where the critical path crosses the name row.
  - The probe callout is collision-tested against every fixed label.
- **Framebuffer**: pixels not painted yet in the current frame show the previous frame at 10% brightness under a dim dot grid. The live tile in the FRAMES strip is tagged PAINTING.
- **Frame cost**: panels join the first paint one per frame, and fonts, canvases and cached layers are warmed at init. The logic analyzer draws its 2 px/cycle overview lanes as plain rects. Result in the controlled-clock render: the worst frame of the whole run is about 26 ms (the first paint, 0.15 s after load, long before the 30 s warm-up ends). In the recorded window frames stay at or under about 16 ms of JS, averaging about 5 ms.

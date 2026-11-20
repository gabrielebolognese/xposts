// Every Gate: the program the gate-level core runs. A Mandelbrot in Q4.28 fixed point, written in RV32IM assembly and
// assembled in-page. Fixed multiply: (MULH(x,y) << 4) | (MUL(x,y) >>> 28). After each row it prints "r=NN it=NNNNN",
// after each frame "f=N it=NNNNN cs=XXXXXXXX", then scales the pixel step by 1/zoom from the view block in RAM.
(function (G) {
  'use strict';
  const Q = 268435456; // 2^28
  const VIEW = { cx: -0.743643887, cy: 0.131825904, width0: 2.88, W: 48, H: 32 };
  const PARAM = { base: 0x10000, CX: 0, CY: 4, DX: 8, IZ: 12, MAXIT: 16, FRAME: 20, DX0: 24, MINDX: 28 };
  const FB = 0x18000;

  function source(opt) {
    const q = (v) => Math.round(v * Q) | 0;
    const dx0 = q(VIEW.width0 / VIEW.W);
    return `
# ---------------- Every Gate: Mandelbrot on a gate-level RV32IM core ----------------
.equ UART,  0x20000000
.equ FB,    ${FB}
.equ W,     ${VIEW.W}
.equ H,     ${VIEW.H}
.equ FOUR,  0x40000000          # 4.0 in Q4.28
.equ TWO,   0x20000000          # 2.0 in Q4.28

.text
_start:
    li    s11, UART
    la    s0, params
    la    a0, banner
    call  puts
frame:
    lw    s1, 8(s0)             # dx: pixel step
    lw    s2, 16(s0)            # maxit
    lw    t0, 0(s0)             # cx
    li    t1, W/2
    mul   t2, s1, t1
    sub   s3, t0, t2            # x0 = cx - (W/2) dx
    lw    t0, 4(s0)             # cy
    li    t1, H/2
    mul   t2, s1, t1
    add   s4, t0, t2            # ci = cy + (H/2) dx  (top row)
    li    s5, FB
    li    s6, 0                 # row
    li    s9, FOUR
    li    s10, TWO
row:
    li    s7, 0                 # col
    li    s8, 0                 # iterations in this row
    mv    a4, s3                # cr = x0
col:
    li    a2, 0                 # zr
    li    a3, 0                 # zi
    li    a5, 0                 # n
iter:
    add   t0, a2, s10           # |zr| < 2 ?
    bgeu  t0, s9, esc
    add   t0, a3, s10           # |zi| < 2 ?
    bgeu  t0, s9, esc
    mulh  t1, a2, a2            # zr^2
    mul   t2, a2, a2
    slli  t1, t1, 4
    srli  t2, t2, 28
    or    t3, t1, t2
    mulh  t1, a3, a3            # zi^2
    mul   t2, a3, a3
    slli  t1, t1, 4
    srli  t2, t2, 28
    or    t4, t1, t2
    add   t5, t3, t4            # |z|^2
    bgeu  t5, s9, esc           # >= 4.0: escaped
    mulh  t1, a2, a3            # 2 zr zi
    mul   t2, a2, a3
    slli  t1, t1, 5
    srli  t2, t2, 27
    or    t1, t1, t2
    add   a3, t1, s4            # zi = 2 zr zi + ci
    sub   a2, t3, t4
    add   a2, a2, a4            # zr = zr^2 - zi^2 + cr
    addi  a5, a5, 1
    blt   a5, s2, iter          # backward: predicted taken
esc:
    sb    a5, 0(s5)             # iteration count -> framebuffer
    addi  s5, s5, 1
    add   s8, s8, a5
    add   a4, a4, s1            # cr += dx
    addi  s7, s7, 1
    li    t0, W
    blt   s7, t0, col
    slli  t0, s6, 1             # row total -> halfword table
    add   t0, t0, s0
    sh    s8, rowit-params(t0)
    li    t0, 'r'
    sb    t0, 0(s11)
    li    t0, '='
    sb    t0, 0(s11)
    mv    a0, s6
    li    a1, 2
    call  pdec
    la    a0, s_it
    call  puts
    mv    a0, s8
    li    a1, 5
    call  pdec
    li    t0, 10
    sb    t0, 0(s11)
    sub   s4, s4, s1            # ci -= dx
    addi  s6, s6, 1
    li    t0, H
    blt   s6, t0, row
# ---- frame done: checksum, totals, zoom ----
    li    a0, FB
    li    t1, W*H
    li    a1, 0
cks:
    lbu   t0, 0(a0)
    xor   a1, a1, t0
    slli  t2, a1, 5
    add   a1, a1, t2            # cs = (cs ^ b) * 33
    addi  a0, a0, 1
    addi  t1, t1, -1
    bnez  t1, cks
    mv    s3, a1
    li    s8, 0
    li    t2, 0
tot:
    slli  t3, t2, 1
    add   t3, t3, s0
    lhu   t3, rowit-params(t3)
    add   s8, s8, t3
    addi  t2, t2, 1
    li    t4, H
    blt   t2, t4, tot
    lw    t0, 20(s0)            # frame += 1
    addi  t0, t0, 1
    sw    t0, 20(s0)
    la    a0, s_f
    call  puts
    lw    a0, 20(s0)
    li    a1, 2
    call  pdec
    la    a0, s_it
    call  puts
    mv    a0, s8
    li    a1, 5
    call  pdec
    la    a0, s_cs
    call  puts
    mv    a0, s3
    call  phex
    li    t0, 10
    sb    t0, 0(s11)
    lw    t0, 12(s0)            # dx = dx * (1/zoom)
    mulh  t1, s1, t0
    mul   t2, s1, t0
    slli  t1, t1, 4
    srli  t2, t2, 28
    or    s1, t1, t2
    lw    t0, 28(s0)            # out of Q4.28 precision: back to the first view
    bge   s1, t0, keep
    lw    s1, 24(s0)
keep:
    sw    s1, 8(s0)
    j     frame

# ---- puts(a0): zero-terminated string to the UART ----
puts:
    lbu   t0, 0(a0)
    beqz  t0, puts_end
    sb    t0, 0(s11)
    addi  a0, a0, 1
    j     puts
puts_end:
    ret

# ---- pdec(a0 value, a1 digits): decimal by repeated subtraction of powers of ten ----
pdec:
    la    t0, pow10
    li    t1, 5
    sub   t1, t1, a1
    slli  t1, t1, 2
    add   t0, t0, t1
pd_digit:
    lw    t2, 0(t0)
    li    t3, '0'
pd_sub:
    bltu  a0, t2, pd_put
    sub   a0, a0, t2
    addi  t3, t3, 1
    j     pd_sub
pd_put:
    sb    t3, 0(s11)
    addi  t0, t0, 4
    addi  a1, a1, -1
    bnez  a1, pd_digit
    ret

# ---- phex(a0): 8 hex digits ----
phex:
    la    t0, hexd
    li    t1, 28
ph_loop:
    srl   t2, a0, t1
    andi  t2, t2, 15
    add   t2, t2, t0
    lbu   t2, 0(t2)
    sb    t2, 0(s11)
    addi  t1, t1, -4
    bgez  t1, ph_loop
    ret

.data
params:
    .word ${q(VIEW.cx)}         # cx  = ${VIEW.cx}
    .word ${q(VIEW.cy)}         # cy  = ${VIEW.cy}
    .word ${dx0}                # dx  (pixel step)
    .word ${q(1 / opt.zoom)}    # 1/zoom
    .word ${opt.maxit}          # maxit
    .word 0                     # frame
    .word ${dx0}                # dx of the first view
    .word 48                    # smallest dx before Q4.28 runs out
banner:
    .asciz "RV32IM gate-level core: Mandelbrot Q4.28 48x32\\n"
s_it:
    .asciz " it="
s_f:
    .asciz "f="
s_cs:
    .asciz " cs="
hexd:
    .ascii "0123456789abcdef"
    .align 2
pow10:
    .word 10000, 1000, 100, 10, 1
rowit:
    .space 64
`;
  }

  function build(opt = {}) {
    opt = Object.assign({ maxit: 32, zoom: 2.0 }, opt);
    const src = source(opt);
    const out = G.ASM.assemble(src, { textBase: 0, dataBase: 0x10000 });
    const rom = new Int32Array(4096);
    rom.set(new Int32Array(out.text.buffer, 0, out.text.length));
    const ram = new Uint8Array(65536);
    for (const [a, v] of out.data) ram[a - 0x10000] = v;
    return { src, rom, ram, sym: out.sym, listing: out.listing, nWords: out.text.length, opt };
  }

  G.PROG = { build, VIEW, PARAM, FB, Q };
})(typeof self !== 'undefined' ? self : globalThis);

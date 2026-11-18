# Reentry: a heart stops and restarts (Claude Studio 002)

A post-infarct heart slice simulated cell by cell on the GPU. A sinus rhythm runs through atria, AV node and a
Purkinje tree. One premature beat (S2) at the scar border starts a reentrant ventricular tachycardia around the scar.
A uniform shock ends it and sinus rhythm returns. The 12-lead ECG is computed from the tissue's own currents and
measured from the signal. No libraries: raw WebGL2, canvas 2D and one Web Worker.

## What is simulated

- **Tissue model**: monodomain Aliev-Panfilov (k 8, a 0.15, eps0 0.002, mu1 0.2, mu2 0.3), forward Euler, dt 0.02
  (0.258 ms with t_ms = 12.9 t), dx 0.30, so D·dt/dx² = 0.222 (stable up to 0.25). Vm = 100u - 80 mV.
  The Laplacian is in flux form with harmonic-mean face conductances, so scar and the outside are no-flux.
- **Grid**: 512 × 512 = 262,144 cells, of which **23,754 are excitable tissue**. The rest is blood, fibrous annulus,
  dense scar and outside, held at zero. The GPU only rasterises texel runs that contain tissue, so the cells updated
  are the excitable ones (not 260,000). State is packed two cells per RGBA32F texel, ping-pong. Each draw does two
  Euler steps (fragment computes its 2-ring stencil). 30 substeps per frame (playback 0.46× real time), 15 draws.
- **Measured speed**: the solver pass is timed on the GPU itself (EXT_disjoint_timer_query_webgl2 around the 30
  substeps plus the 3 ECG reductions, so it is conservative): about 1.2-2.2 ms per frame on the Radeon iGPU, i.e.
  roughly 300-500 M cell updates per second of GPU time (the header and cell_updates_per_s show this smoothed value; it
  varies with GPU load). The recording only needs 42.8 M updates per second delivered (23,754 × 30 × 60, shown as
  "delivered @60fps"). A live run holds 60 fps with about 2-4 ms of JavaScript per frame; one-off costs (first draw
  of every panel, lazy shader compilation, the first GPU sync) are paid at load, so no frame exceeds ~33 ms.
- **Anatomy** (procedural four-chamber long-axis slice): RA/LA walls 8 cells, LV wall 26, septum 27, RV wall 13.
  A fibrous AV annulus isolates atria from ventricles except the AV node bridge (D 0.08) into an insulated His
  pocket. Anterolateral LV infarct: a dense scar island (D 0) in mid-wall with a 3-cell border zone (D 0.25,
  recovery × 1.2).
- **Transmural heterogeneity**: h goes from 1.0 (endo) to 1.35 (epi), RV half as strong, atria 1.5.
- **Conduction system** (event driven on the CPU, coupled both ways): His-Purkinje tree of 157 segments (with the atrial tracts) and 64 live
  Purkinje-muscle junctions (PMJ) along LV and RV endocardium, fascicles crossing the cavities (false tendons, the
  moderator band). CV 8 cells/ms, refractory 300 ms, His bundle conduction 26 ms. A junction injects a stimulus disc
  (r 3, amplitude 2.5, 12.9 ms) only if the local tissue is not refractory (v < 0.6). Tissue that excites a junction
  first sends a retrograde impulse up the tree. That impulse is concealed: it makes the tree refractory but does not
  re-enter the muscle. So during VT the sinus impulses block in the tree, and AV dissociation emerges (the log prints
  "His impulse blocked: tree refractory", and the atrial probes keep 833 ms while the LV probes run at 434 ms).
- **Protocol** (logged exactly as delivered): sinus 72 bpm. S2 at the border zone, coupling interval 320 ms after the
  last sinus activation at that site (the measured vulnerable window is about 300-340 ms). Unidirectional block gives
  a one-way circuit round the scar. A cross-field S2 fallback exists but is never needed (the log would say so).
  Shock: uniform current 3.0 on every excitable cell for 12.9 ms. Phase singularities are checked 150 ms later
  (a second shock at 1.5× if any survived; it never does). The shock resets the SA pacemaker.
- **Pseudo-ECG**: Phi_e = -Σ grad(u)·grad(1/r_e) on the 256² grid (2 × 2 averages of u). By summation by parts this is
  Σ u·W_e with W_e = div_h(mask·grad_h(1/r_e)), the exact discrete adjoint of the gradient. The GPU reduces it for 9
  electrodes (RA, LA, LL on an Einthoven triangle; V1-V6 on a smooth elliptical arc in the heart's own tilted frame,
  24 cells outside the ventricles and 90 cells above the slice plane, i.e. on the anterior chest). That gives 3 samples
  per frame (387.6 Hz, sim time). Then the Wilson terminal and the 12 leads, a 0.5-40 Hz biquad band pass for the
  paper display, and one gain frozen during prewarm so that the sinus R in II reads 1.20 mV. The paper prints limb
  leads at 10 mm/mV and chest leads at half standard, 5 mm/mV (with a half-height calibration mark), as clinical
  machines do when precordial voltages are large (V1 S wave about 5 mV, V6 R about 3 mV); S2 and shock markers run
  through all 12-lead rows, so every row visibly shows the same instant as the rhythm strip.
- **ECG measurements** (from the signal only; intervals are measured on the unfiltered leads, because the 0.5 Hz
  high-pass of the display leaves a slow tail after V1's large S wave that would fake a long QT): Pan-Tompkins
  (derivative, square, 150 ms integration, adaptive levels, P/T-wave slope check, search-back, re-learning after a
  pause, refractory 330 ms, detection blanked for the shock artefact). The stimulator's S2 is a stimulus marker for the
  ECG pipeline, as in an EP recording system: the table and log get an explicit "S2 capture, CI 320 ms" row (the S2
  complex and the first reentrant complexes carry only 2-13 % of the sinus detection energy), intervals restart at the
  stimulus and the detector re-learns from the post-stimulus window. VT is declared after 3 consecutive wide (QRS >
  120 ms), fast (> 120 bpm), AV-dissociated beats and the log quotes their median rate; the header HR is the median of
  the last 3 RR intervals. The fiducial is aligned by 8-lead
  cross-correlation with the previous beat, so RR is exact in sinus and in monomorphic VT. QRS on/off come from the
  spatial velocity of 8 leads (10% of the complex peak). T end is global (RMS of 8 leads back within 10% of the T
  amplitude, TP-segment baseline). QTc is Bazett. P onset in II gives PR. The axis is atan2((2/√3)·aVF, I) from net QRS
  areas; for complexes without an isoelectric segment (VT) the area is taken over 80 ms centred on the template-aligned
  fiducial with a cycle-mean baseline, so the VT axis is stable (about −150°); summaries use a circular mean.
  Rhythm labels follow the brief (sinus / VT / post-shock), with AV association = a consistent PR on 3 beats.
  HR is shown as 60000 / the displayed (rounded) RR.
- **Maps** (GPU, updated in the last substep of each frame with MRT): LAT, repolarisation time, APD, DI, cycle
  length. Phase theta = atan2(v - 1, u - 0.5). Phase singularities are plaquettes with ±2π winding, compacted in
  16 × 16 blocks and tracked by nearest neighbour. An anchored rotor is detected as the winding number of the phase
  along a loop of 96 border-zone cells round the scar (topological charge ±1); its on-screen rotation (CW/CCW) and period come from the wavefront position on that loop. The hero is cropped to the heart and electrodes (about 1.4 px per cell) with an instrument column on the left; a 172 × 216 px inset at 3.2× ("SCAR CIRCUIT") renders the phase θ of the whole scar circuit at full resolution, with the circuit path, rotation arrows, the wavefront comet and 2 s phase-singularity trails. Probes report APD, DI and dominant frequency (1 / mean cycle length): 1.20 Hz in the atria vs 2.30 Hz in the ventricles during VT. Sinus LAT maps are per-beat snapshots.
  During VT, LAT is shown modulo the cycle length. Sinus LAT and APD maps are smoothed over a 5 × 5 / 3 × 3
  neighbourhood; grey (n/a on the colour bar) means not activated in the beat. TAT: earliest to latest activation of
  the beat; during VT, the 2nd-98th percentile spread of activation phases within one cycle (about 415 ms, i.e. the
  circuit activates continuously). CV histogram: values above 0.8 cells/ms (Purkinje breakthroughs) go to a hatched
  overflow bin.
- **Restitution lab** (Web Worker, metered by frames): a 400-cell cable with the same equations runs S1-S2 (10 × S1
  at 600, 500, 400, 350 ms, S2 swept down to block). An exponential fit APD = A - B·e^(-DI/tau) is made at BCL 600, and
  its slope is shown at the border-zone probe's current DI. The 2D probes' own APD/DI points are overlaid.

## Headline numbers (STUDIO.report, deterministic render)

| key | value | meaning |
| --- | --- | --- |
| sinus_hr_bpm | 72 | Pan-Tompkins RR before S2 (833 ms) |
| vt_hr_bpm | 138 | median RR of VT beats (433 ms) |
| qrs_ms | 101 sinus / >200 VT | spatial-velocity QRS on the unfiltered leads; see the note on VT QRS below |
| qtc_ms | 306 | Bazett QTc of the last sinus beat before S2 (QT ≈ 279 ms) |
| phase_singularities_peak | 2 | max simultaneous PS during VT (free tips at initiation + the anchored rotor) |
| shock_to_sinus_ms | 1,038 | shock to the onset of the first post-shock QRS with a normal P-QRS |
| cell_updates_per_s | ~300-500 M | cell updates per second of GPU time (timer query, varies run to run); 42.8 M/s delivered |
| pr_ms | 190 | P onset to QRS onset, sinus |

Also reported: vt_cycle_ms 436, cell_updates_delivered_per_s 42,757,200, gpu_solver_ms_per_frame, s2_ci_ms 320, excitable_cells 23,754, grid_cells 262,144, substeps_per_frame 30.
The recorded rotor lasted 12.3 s of simulated time (27 s of video).

## Hard parts, simplifications, honest caveats

- **Scale**: the slice holds several wavelengths (CV ≈ 0.36 cells/ms, wavelength ≈ 66 cells), so the heart is huge
  relative to conduction. This forced three additions:
  - fast atrial tracts (internodal and Bachmann, CV 8 cells/ms), otherwise the P wave would last over a second;
  - junctions 6 cells into the wall;
  - a 26-cell LV wall, which keeps the sinus QRS near 100 ms.
- **VT QRS has no isoelectric baseline**: in VT several wavefronts are always in flight, so the ECG is a continuous
  sine-wave VT with no measurable QRS end. Such complexes are reported as QRS '>200 ms' (warn colour), never as a
  number tied to the RR; qrs_vt_ms in the report says the same.
- **The brief's eps formula changed**: with eps0·h(x) alone the epicardial APD barely moves (the mu1·v/(u+mu2) term
  dominates), so the T wave would be inverted. h(x) multiplies the whole recovery rate instead.
- **Stimulus strength**: the brief's 0.5 on a 6-cell disc is below threshold in 2D. SA, junction and S2 discs use
  radius 3 (about 2× threshold, the EP-lab convention).
- **S2 and timing**: S2 coupling is 320 ms, not 290: the vulnerable window of this model is 300-340 ms. The S2 lands
  11.3 s into the video. Its time also sets the sinus phase, chosen so that the first frame catches a ventricular
  activation. The shock lands at 38 s.
- **Model QT**: the model's APD at 72 bpm is about 210 ms, so the QT is short for a human (QTc ≈ 306 ms).
- **ECG pipeline**: Pan-Tompkins runs on the 8 independent leads summed (lead II alone gives unstable fiducials on
  the rounded VT complexes). The precordial pattern (deep S in V1-V2, late transition with a tall R only in V6, a
  'poor R-wave progression' typical of anterolateral infarction) comes out of the model and the electrode arc.
- **Readback**: one readback every second frame. 61 KB holds 6 ECG samples, the gathered cells of both frames, PS
  blocks and a map slice. It is read one frame late through two pixel-pack buffers. In ANGLE every readPixels drains
  the GPU pipeline, so this keeps the frame under the budget. The extra latency is absorbed by the His conduction
  delay.
- **Purkinje coupling**: a junction's tissue state is up to 3 frames old, so its refractoriness check uses data up to
  23 ms stale.

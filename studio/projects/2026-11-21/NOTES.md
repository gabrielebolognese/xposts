# Photon Ring: Sgr A*, ray by ray (Claude Studio 005)

A spinning Kerr black hole with Sgr A*'s mass and distance (M = 4.297e6 M☉, D = 8.277 kpc, so 5.124 µas and 21.17 s per M), ray-traced on the GPU. Each pixel is an exact null geodesic, integrated backward from the observer in a WebGL2 fragment shader. The geodesics light a Page–Thorne thin disk with a hot spot, which feeds a light curve, a centroid loop, a spectrum and an Fe Kα line. A virtual EHT with the real 2017 stations observes the image through the night. The shadow is checked against Bardeen's analytic critical curve by fp64 bisection in two workers. There are no libraries: raw WebGL2, canvas 2D and 7 Web Workers.

## What is simulated, and how

- **Tracer (fragment shader, fp32)**: observer at r0 = 1000 M, i = 72°, a = 0.94. Pixel → Bardeen (α, β), with λ = −α sin i and η = (α² − a²)cos² i + β². The integration is RK4 in Mino time on (r, θ, v_r, v_θ, φ, t), with the second-order equations d²r/dσ² = R′/2 and d²θ/dσ² = Θ′/2, so turning points need no sign logic.
  - Map: 1760 × 1440 = 2,534,400 geodesics over α ±20 M, β ±16.4 M. It is written to MRT float textures: (r_hit, φ_hit, t_hit, g), (n, λ, r_min, steps) and (null residual, …).
  - Termination: r < r+(1 + 1e-3) is captured. r > 1050 M going out is escaped, and the escape direction samples a procedural star field, so the stars are lensed too. At each sign change of cos θ the hit is interpolated to the equator: r_isco ≤ r ≤ r_out hits the disk, otherwise the crossing count n goes up by one.
- **Things that turned out hard (and what was changed from the brief)**:
  1. The pure second-order radial equation loses the null constraint by a factor (r0/r)⁴ on the way in: errors made at r = 1000 swamp R near the hole, and in fp32 the rays bounced off nothing at r ≈ 50. Fix: re-project v_r ← sign(v_r)√R wherever R > 0.1 P² (far from radial turning points). Turning points are still handled by the second-order equation.
  2. Rays that pass near the poles (small |λ|) jump the λ²cot²θ barrier in one step and come out with garbage φ. That drew a column of wrong pixels at α ≈ 0. The step is dσ = h·f(r)/(|v_r|/r + |v_θ| + √|λ²cosθ/sin³θ| + ½|λ|cot²θ + 0.3|v_θ|·max(0, 1/sinθ − 5)). The extra terms are zero near the equator and only shorten steps near the poles.
  3. Beyond r = 60 M the step grows linearly up to 3h at 180 M (f(r) = clamp(r/60, 1, 3)). Against an h = 0.004 fp64 reference this changes no ray's fate or crossing order (2,500-ray grid), moves relative light-travel delays by 0.01 M rms, and saves 25% of the steps.
  Result: 133 RK4 steps per ray on average (r_out = 18 M; 120.6 at 24 M), max 426.
- **Tile budget**: the map is static for fixed (a, i), so after the full trace at load it is re-traced continuously in 32 × 32 tiles. That is what the top-bar pass/tile counter and the cyan cursor on the hero's left edge show.
  - The budget is balanced on work, not tiles. Each tile's RK4 step count is measured at load (2,475 tiles, 46k–227k steps each). Every frame takes tiles until it reaches 8 tiles' worth of mean work (about 1.0 M RK4 steps).
  - **On average 8,192 rays per frame, 491,520 rays/s at 60 fps.** The live figure swings between about 360k and 780k as the sweep moves (unused work carries over to the next frame, so the mean is exact): escaping rays at the top and bottom are cheap, rays near the photon ring are dear. RK4 steps/s stays near 60 M.
  - The brief's 40,960 rays per frame does not fit this integrated Radeon next to shading, readbacks and page compositing: measured 0.35–0.7 ms of GPU per 1,024 rays.
- **GPU statistics and readbacks**:
  - Every traced ray is scattered as a point into a small float target with additive / max blending. That gives the steps histogram, capture/escape/disk fractions, max residual, t_hit and g range, and mean g.
  - All readbacks share one PBO per 4-frame cycle, fetched with a single getBufferSubData 3 frames later. Each cycle carries the 4 frames of statistics. Even cycles add the 128² live image; odd cycles add its order-fraction target or the EHT crop. No single copy exceeds about 300 KB.
  - In Chrome each getBufferSubData is a synchronous round trip that queues behind all pending GPU work. So the copy is done between frames:
    - Live: in a timeout after the frame, once the fence has signalled.
    - Render: inside the promise the recorder waits for, after a per-frame fence has drained the GPU. Same fixed lag, so the recording stays deterministic.
  - The DFTs, ring fit and model blur run in the EHT workers.
  - Measured live (headless Chrome on this laptop, 40 s): 58–60 fps, about 4–4.5 ms of JavaScript per frame on average, worst about 13–21 ms.
  - Controlled-clock render: p50 4 ms, p99 about 9 ms; the first frame's draws are done at load.
  - The 2D panels rasterise on the CPU live (willReadFrequently), so the iGPU stays free for the ray tracer, and on the GPU in render mode.
- **Shading per frame**: I = g⁴ F̂(r) [1 + 0.35 N] + spot.
  - N is two-layer cross-faded flow noise in the co-rotating frame, so each layer shears at the local Ω(r) for 0.4 of an orbit. Δt = t_hit − min t_hit (the light-travel delay).
  - Hot spot: a Gaussian with σ = 0.6 M at r_s = 7 M, phase Ω(r_s)(t_obs − Δt), peak 12 × max F̂. It was born 3.4 orbits before the sim clock zero, UT 03:10:00.
  - Doppler and gravitational shifts can be toggled. Gravitational only uses the ZAMO emitter, α_lapse/(1 − ωλ). Doppler only uses a flat-space emitter with the same Ω.
  - **r_out = 18 M, not the brief's 24 M**: at 24 M the disk ellipse ran past the traced field (α ±20 M) and was cut by the hero's edges. At 18 M the whole disk fits inside the frame with a margin, and the black hole keeps its full on-screen scale.
  - The outer edge is antialiased without a taper band, using r_hit as a distance field. Disk pixels get coverage (r_out − r)/|∇r| + ½, with the gradient taken from disk neighbours only. Sky pixels on the rim take the remaining coverage from their disk neighbour. So there is no starless dark halo and no stair steps.
  - The hairline between the near side and the n = 1 image is real: rays that pass just outside r_out and escape.
- **Tone curve**: log I runs linearly from 2.9 dex below the brightest disk pixel (0) to that pixel (0.85). Above it, the hot spot's headroom rolls off softly to 1 (knee at 0 dex, +1 dex at 0.98), so the spot keeps its delay-sheared structure near the beaming peak. The colorbar is ticked +1, 0, −1, −2.
- **Redshift**: g = r^¾ √(r^{3/2} − 3r^{1/2} + 2a) / (r^{3/2} + a − λ). g ranges 0.147–1.330 over the visible disk, so the g⁴ boost on the approaching side is up to 3.13×.
- **Readbacks**:
  - 128² float render of the live image (2 × 2 taps per texel), every 8 frames: light curve, centroid and the spot's ⟨g⟩. Every 16 frames a second target gives the flux per order n and the hero annotation anchors.
  - The light-curve history (150 sim-min) is back-filled at load from the same geodesic map at past times, on the same 256² sample lattice, so the join is seamless.
  - A 256² wide-field trace (±30 M, so the whole disk to r_out is included) feeds the spectrum worker.
- **Spectrum** (worker): L_ν = 4π r_g² Σ dA g³ B_ν(ν/g, T(r)), with T from Page–Thorne at ṁ = 0.01 L_Edd and η = 0.181. The Newtonian curve uses the same T(r), g = 1, and cos i projected rings.
  - Result: L = 3.52e35 W (isotropic equivalent at 72°), νL_ν peak 9.87e15 Hz, T_max 1.65e5 K.
  - The magenta curve is the hot spot's live contribution: blackbody shape at the spot temperature, scaled to its observed g⁴ flux.
- **Fe Kα** (worker): E = 6.40 g keV, weight g⁴ r^−q (q = 3), bilinear 6 × 6 sub-pixel sampling, smoothed to a 140 eV FWHM resolution.
  - **The range is 3–9 keV, not 3–8**: at i = 72° the blue horn sits at 6.4 · g_max ≈ 8.0–8.5 keV and would be cut off. The magenta marker is the spot's own line, 6.4⟨g⟩_spot, which sweeps red to blue every orbit.
  - Red wing: measured on a separate 0.5–9.5 keV profile, as the lowest energy where it reaches 5% of its peak (3.78 keV here). If it falls below the plotted window it is shown at the left edge with an arrow.
- **Critical curve check** (2 workers, fp64, same step rule): 180 polar directions about the analytic curve's centre, bisected to 1e-6 M between captured and escaped. The analytic radius only seeds the bracket ±10%; the bracket is verified before bisecting. Each worker gets 6,000 RK4 steps per frame, so one curve takes about 2 s.
  - Current curve: d = 51.167 µas (area-equivalent), mean |Δr|/r = 1.96e-4 %.
  - Spin sweep: 24 spins at i = 72°, then 24 at i = 17° (the low inclination EHT favours). Measured d sits 0.005 µas below analytic for every spin. That is the area deficit of a 180-gon, not integration error: the radial deviation stays at 1–2e-4 %.
  - Probes: 64 pixels traced in fp64 on the CPU against the GPU's fp32 map. 64/64 same fate, rms Δr_hit 9.6e-6 M over 24 disk hits.
  - Null-constraint residual |v_r² − R|/(R + 1): the drift per step, measured before v_r is re-projected, over disk rays.
    - RMS about 2.7e-3, max about 1.1e-1 in fp32; the fp64 probes' max is 1.0e-2.
    - The worst rays are at radial turning points, where R + 1 ≈ 1, so it is an absolute error in v_r².
  - The integrator panel shows rolling statistics for the rays traced in the last second (the tiles under the cursor): steps per ray, max steps, fate fractions and a bright histogram over the pass histogram. The current tiles' bin pulses.
  - On the hero, a cyan outline marks the 32 × 32 tiles being re-traced, with a "re-trace tile N/2,475" tag.
- **Virtual EHT**: the brief's 2017 station coordinates, with geodetic (WGS84) normals for elevation. Sgr A* is at RA 17h45m40.04s, Dec −29.0078°, λ = 1.3035 mm, and Greenwich hour angle H = GMST − RA, with the u, v formulas from the brief. A baseline counts while both stations are above 10°. Samples are taken every 5 sim-min, conjugates included.
  - **Date**: the brief gives UT 03:10 but no date. The night of **2026-08-23/24** puts UT 03:10 in the dense part of the track, with 55–58% of the night's samples already taken (the brief's ~55%). The night runs from 16:40 UT, when PV rises, to about 10:15 UT, when Hawaii sets. 21 baselines are up from the start of the video.
  - **230 GHz image**: a thermal thin disk at this accretion rate emits in the UV, not at 230 GHz. So the EHT observes an optically thin equatorial image on the same geodesics: I_ν = g³ r^−q (the line's q = 3), plus the hot spot and the same flow noise. It covers a 96 × 96 crop (±80 µas), re-rendered every 16 frames.
  - Four workers DFT it, chunked per frame: |V| at every sample, a 64 × 36 polar grid of the full-uv model, and the uniform-weight dirty image and dirty beam (cell 0.25 Gλ). The beam's half-maximum ellipse is about 23 × 13 µas.
  - **This image is a Doppler-boosted crescent, not a ring.** The amplitude of every sampled visibility falls monotonically, with no null, and the panel says so. The bin means of the data follow the model's ⟨|V|⟩ curve.
  - **vis_null_glambda comes from the data**: the sampled visibilities are phase-centred on the black hole (the virtual array has perfect phases). So the 0.4 Gλ bin means of Re V estimate the circularly averaged visibility.
    - A ring model J0(πdρ)·exp(−(πwρ)²/4 ln 2) is fitted to those bin means, weighted by sample count, on a grid in d and w, in an EHT worker every time new samples arrive. The null is the ring's first zero, 0.7655/d.
    - Result: d ≈ 37.8 µas, w ≈ 19 µas, null ≈ 4.2 Gλ (R² ≈ 0.87). The full-uv model's circular average nulls at 3.55 Gλ; this is shown as "model" next to the fit.
  - **What I tested and rejected**: a sub-Keplerian emitter (Ω between the ZAMO and Keplerian rates), an optically thin hot flow integrated along each geodesic, and an m-ring fit to the complex data. None gives a genuine ring at i = 72°: the image stays elongated and the m-ring fit runs to the edge of its grid. So the panel shows the crescent honestly instead of forcing a ring.
  - Dirty image: re-imaged with every new 5-min epoch and cross-faded over 0.9 s. For 1.8 s a Δ image of what the newest visibilities changed is overlaid (cyan adds flux, magenta removes it), with a "+N vis · Δ image" tag. The cyan line is the half-maximum contour of the model convolved with the beam (what the array should recover), not the shadow edge.
  - uv plane: older parts of the night fade. The last 10 sim-min of each track are drawn bright and thick, new samples get a decaying ring, and active baselines have larger pulsing heads.
  - The visibility panel marks where a ring the size of the shadow (51 µas) would null (3.09 Gλ), next to the fitted crescent's 4.2 Gλ. It notes that the crescent's light comes from inside the critical curve.
- **Hero annotations**: the dashed cyan contour is the hot spot's orbit, r = r_s, drawn from the geodesic map (|r_hit − r_s| under one pixel's derivative). It shows how lensing lifts the far half of a circle over the shadow. The annotation anchors come from the live readback, so they follow the physics if a or i change.
  - The brightest disk texel (hot spot excluded) marks the approaching side.
  - The first disk texel above the critical curve marks the lensed far side.
  - The lowest texel whose light is mostly n ≥ 1 marks the secondary image of the disk's underside.
- The centroid loop uses a fixed ±15 µas range that can only expand, so the loop never jumps in size. The hero's centroid label is sized from measureText every frame and flips to the left when it would cross the shadow.
- **Geodesics panel**: 64 CPU-traced rays (fp64, h = 0.03). 44 come from the vertical midline (α = 0), drawn in the meridional x–z plane. 20 come from the horizontal midline (β = 0), drawn top-down in the equatorial plane, where frame dragging shows. Pulses run along each path.
- **Clock and metering**: 1 s real = 120 s sim. Workers get fixed work per frame (RK4 steps, DFT points, dirty-image rows), the next chunk only after their reply, and every reply goes through STUDIO.wait. Readbacks are polled on a fixed frame lag in render mode, so the recording is deterministic.

## Headline numbers (STUDIO.report)

| key | value | meaning |
| --- | --- | --- |
| shadow_diam_uas | 51.167 | area-equivalent diameter of the bisected critical curve (EHT measured the ring at 51.8 ± 2.3 µas) |
| shadow_err_pct | 1.96e-4 | mean radial deviation, ray-traced vs Bardeen's analytic curve, % |
| isco_r_M | 2.0236 | prograde ISCO at a = 0.94, the disk's inner edge |
| spot_period_min | 43.13 | 2π(r_s^1.5 + a) GM/c³ at r_s = 7 M. The light curve's measured peak-to-peak is 43.1 min (GRAVITY flares: ~45 min) |
| flux_n1_pct | 1.3–1.9 (varies with the hot spot) | share of the image flux from rays that crossed the equator at least once (n ≥ 1). It is small for a thin disk seen at 72° |
| vis_null_glambda | ~4.2 | first null of the ring fitted to the sampled, phase-centred 230 GHz visibilities (the ring_fit_uas key, ≈ 37.8 µas). The full-uv model gives 3.55 Gλ. The amplitudes alone show no null, because the image is a crescent |
| g_max | 1.3296 | maximum redshift factor over the visible disk |
| rays_per_sec | ~360k–780k (mean 491,520) | geodesics integrated per second by the shader, against the frame clock. The budget is balanced on RK4 steps (about 60 M steps/s), so the ray count follows the cost of the region being re-traced |

Other numbers on screen: r+ 1.341, r_ph± 1.425 / 3.946, η = 0.181, T_max 1.65e5 K, Ṁ 3.3e19 kg/s (5.3e-4 M☉/yr), hot-spot modulation ~85%, centroid loop ~16 µas, light-travel delays 0–116 M (0–41 min), 133 RK4 steps per ray on average.

## Simplifications

- The disk is geometrically thin and opaque, with emission from both faces. There is no emission inside the ISCO.
- The hot spot is a co-rotating Gaussian with no shear or cooling.
- The hot spot's spectrum is modelled as a separate blackbody at its peak temperature, scaled to its observed flux.
- The EHT has no thermal noise, gains, scattering or closure quantities, and no CLEAN: the dirty image is the plain inverse transform with uniform weights.

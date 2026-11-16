# Claude Studio: build tonight's project

You are Claude Code, building project {{NUMBER}} of Claude Studio, a daily series on X: "pushing Claude to the edge". You work alone, overnight, in this folder (studio/projects/{{ID}}). A recording of what you build is posted tomorrow, so it has to be genuinely excellent: the kind of screen people stop scrolling for. Take your time; you have hours. Quality matters far more than speed.

## The brief
{{BRIEF}}

## Files
- Write index.html in this folder (split into more .js or .css files here if that helps). Never touch anything outside this folder.
- Load the kit first, in the head: <script src="../../kit/studio-kit.js"></script>
- Put everything inside <div id="stage">, designed for exactly 1920x1080 pixels. The kit scales the stage to the window (live) or moves the recording camera over it.
- {{LIBRARIES}}
- No network: no CDN, no web fonts, no fetch except what the kit does itself. Fonts: only "Cascadia Mono", "Cascadia Code", "Consolas", "Lucida Console", "Segoe UI Variable", "Segoe UI", "Bahnschrift".

## How the recording works (follow these or the video breaks)
- The recorder replays the page frame by frame with a controlled clock. Animate ONLY from requestAnimationFrame, with time from its timestamp or performance.now(). No CSS animations, no CSS transitions, no Web Animations API, no setTimeout-driven motion that skips requestAnimationFrame.
- Size every canvas by devicePixelRatio (canvas.width = 1920 * devicePixelRatio for a full-stage canvas, then scale the context), so it stays sharp when recorded at 2x and when the camera zooms in up to 2x.
- Use STUDIO.rng(seed) for randomness, not Math.random, so every run starts the same.
- Web Workers are welcome for heavy computation (their real CPU load shows in the resource charts), but meter their progress by frames, not by real time: in requestAnimationFrame, give each idle worker a fixed amount of work (a node or step budget sized to finish within one frame on this laptop), send the next chunk only after its reply, and register each reply with STUDIO.wait(promise). The recorder waits for registered work before capturing a frame, so the video shows exactly the progression a live run shows. Count speeds (nodes per second and the like) against the frame clock (performance.now), never against real time measured inside a worker.
- Keep one frame under 12 ms of JavaScript on this laptop ({{SYSTEM}}; integrated GPU), so the live view runs at 60 fps. The screenshot tool prints frameMs.

## The kit (window.STUDIO)
{{KIT}}

## What makes it excellent
- Real: every number on screen is computed by the simulation or measured by the kit. No random numbers dressed up as data.
- Mid-work: the first frame already looks deep into the run. Prewarm the simulation at load (run it forward instantly) so trees are grown, curves have history, logs are full. No boot sequence, no intro, no empty state, no loading text.
- Dense and clean: the "organized mess". Tiny labels and numbers everywhere (10 to 12 px is fine for secondary text), but an exact grid: aligned edges, consistent 1 px lines, consistent spacing, nothing overlapping, nothing clipped, no empty areas.
- Alive: something moves in every region all the time, at different rhythms: fast counters, slower charts, the hero evolving.
- Coloured numbers by meaning, from the palette (up, down, warn, active). Everything else in the palette's text and muted tones.
- The resource panel: CPU per thread, RAM, GPU, disk, FPS and frame time from the kit, drawn in this project's own style. GPU, disk and network can be null: show a dash.
- The parameter controls from the brief, visible (sliders, knobs, toggles), styled to the design. They may stay untouched.
- Call STUDIO.report({...}) with the headline numbers ({{HEADLINE}}) every second or so; the post quotes them.
- No emojis, no lorem ipsum, no fake brand names or logos.

## Look at your own work, many times
Run the screenshot tool and READ the images it writes, then fix what you see. Do this at least 4 times, and keep going until a demanding designer would post it as is:
  node ../../tools/shot.mjs . --at 2,15,35 --view 0.25,0.3,1.8 --view 0.75,0.7,1.8
It runs the page with the controlled clock (warm-up first), saves shots/*.png (the --view images are zoomed camera views, to check the tiny text up close) and prints page errors and frameMs. Check every time: no errors, frameMs.avg under 12, nothing overlapping or clipped, no empty or dead regions, text readable when zoomed, the layout matches the brief, and the screen looks extremely complex but clean.

## When you are done
Write NOTES.md (short): what is simulated and how, the parameters, what each headline number means, and anything that turned out hard or that you had to simplify. The post writer reads it. Then reply with one line: done.

// Claude Studio kit: the plumbing every studio project loads. It draws nothing: each project designs its own screen.
//
// Live mode (opened with: bash studio/open.sh <project>): real clock, real resource numbers from the local studio server.
// Render mode (the recorder): a controlled clock (performance.now, requestAnimationFrame and timers only move when the
// recorder says so) and the resource numbers recorded during the live run, so every frame is captured perfectly
// whatever the PC's speed.
//
// API for projects (window.STUDIO):
//   STUDIO.mode                 'live' or 'render'
//   STUDIO.ready                promise: system specs and resource history are loaded
//   STUDIO.system               {cpu, cores, threads, ramGB, gpu, gpuMB, os}
//   STUDIO.metrics()            latest sample {t, cpu: [% per thread], cpuTotal, ramUsed, ramTotal, gpu, diskR, diskW, net}
//                               (GB for RAM, % for CPU and GPU, MB/s for disk and network; gpu, disk, net can be null)
//   STUDIO.history(seconds)     samples of the last N seconds, oldest first (charts start full, never empty)
//   STUDIO.perf()               {fps, frameMs, heapMB, frames} of this page
//   STUDIO.rng(seed)            seeded random generator: () => number in [0, 1)
//   STUDIO.report(obj)          headline numbers of the run (nodes searched, particles, epochs...), used in the post
//   STUDIO.wait(promise)        registers this frame's asynchronous work (a Web Worker's reply): the recorder waits
//                               for it before capturing the frame, so the video shows what a live run shows
//   STUDIO.warmup               seconds the recorder runs the page before the first recorded frame
// The page puts everything inside <div id="stage"> sized 1920x1080; the kit scales it to the window (live) or moves
// the camera over it (render).
(() => {
  const R = window.__STUDIO_RENDER__ || null;
  const W = 1920, H = 1080;
  const state = { samples: [], perf: { fps: 60, frameMs: 16.7, heapMB: 0, frames: 0 }, report: {} };
  const empty = { t: 0, cpu: [], cpuTotal: 0, ramUsed: 0, ramTotal: 0, gpu: null, diskR: null, diskW: null, net: null };
  const sec = () => performance.now() / 1000;

  const STUDIO = {
    mode: R ? 'render' : 'live',
    system: R ? R.system : { cpu: '', cores: 0, threads: 0, ramGB: 0, gpu: '', gpuMB: 0, os: '' },
    warmup: R ? R.warmup : 0,
    metrics() {
      if (R) return sampleAt(sec());
      return state.samples.at(-1) || empty;
    },
    history(seconds = 60) {
      if (R) {
        const now = sec();
        return R.samples.filter((s) => s.t <= now && s.t >= now - seconds);
      }
      const last = state.samples.at(-1);
      return last ? state.samples.filter((s) => s.t >= last.t - seconds) : [];
    },
    perf() {
      if (R) return perfAt(sec());
      return state.perf;
    },
    rng(seed = 1) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    report(obj) {
      Object.assign(state.report, obj);
    },
    wait(promise) {
      const p = Promise.resolve(promise);
      const tracked = p.finally(() => pending.delete(tracked));
      pending.add(tracked);
      return p;
    },
    ready: null,
  };
  // Work registered before the call; at most 10 s, so a reply that never comes cannot hang the recorder
  const pending = new Set();
  window.__STUDIO_SETTLE__ = () => pending.size
    ? Promise.race([Promise.allSettled([...pending]), new Promise((r) => (window.__STUDIO_REAL_TIMEOUT__ || setTimeout)(r, 10000))])
    : null;

  // Render mode: recorded samples, t in seconds of the live run's page clock
  function sampleAt(t) {
    const s = R.samples;
    if (!s.length) return empty;
    let i = s.findIndex((x) => x.t > t);
    if (i === -1) return s.at(-1);
    if (i === 0) return s[0];
    return s[i - 1];
  }
  function perfAt(t) {
    const p = R.perf;
    if (!p || !p.length) return state.perf;
    let best = p[0];
    for (const x of p) if (x.t <= t) best = x;
    return { ...best, frames: Math.round(t * 60) };
  }

  // Live mode: poll the studio server, measure this page's frame rate, send perf and report back for the recorder
  if (!R) {
    const t0 = Date.now();
    const toPage = (s) => ({ ...s, t: (s.t - t0) / 1000 });
    STUDIO.ready = fetch('/studio/state').then((r) => r.json()).then((d) => {
      STUDIO.system = d.system;
      state.samples = d.history.map(toPage);
    }).catch(() => {});
    setInterval(() => {
      fetch('/studio/metrics').then((r) => r.json()).then((s) => {
        if (!s) return;
        const x = toPage(s);
        if (!state.samples.length || x.t > state.samples.at(-1).t) state.samples.push(x);
        if (state.samples.length > 2400) state.samples.splice(0, state.samples.length - 2400);
      }).catch(() => {});
    }, 250);
    let last = performance.now(), acc = 0, n = 0;
    const loop = (now) => {
      const dt = now - last;
      last = now;
      acc += dt;
      n += 1;
      state.perf.frames += 1;
      if (acc >= 500) {
        state.perf.fps = Math.round((n * 1000) / acc);
        state.perf.frameMs = +(acc / n).toFixed(1);
        state.perf.heapMB = performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0;
        acc = 0;
        n = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => {
      fetch('/studio/page', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t: sec(), perf: state.perf, report: state.report }) }).catch(() => {});
    }, 1000);
  } else {
    STUDIO.ready = Promise.resolve();
    window.__STUDIO_REPORT__ = () => state.report;
  }

  // Stage: fit to the window (live), camera moves over it (render)
  function stage() {
    return document.getElementById('stage');
  }
  function fit() {
    const el = stage();
    if (!el || R) return;
    const k = Math.min(innerWidth / W, innerHeight / H);
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
  }
  window.__STUDIO_CAMERA__ = (cx, cy, zoom) => {
    const el = stage();
    if (!el) return;
    const z = Math.max(1, zoom);
    const tx = Math.min(0, Math.max(W - W * z, W / 2 - cx * W * z));
    const ty = Math.min(0, Math.max(H - H * z, H / 2 - cy * H * z));
    el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
  };
  addEventListener('resize', fit);
  addEventListener('DOMContentLoaded', () => {
    const el = stage();
    if (el) Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: W + 'px', height: H + 'px', overflow: 'hidden' });
    document.documentElement.style.overflow = 'hidden';
    fit();
  });

  window.STUDIO = STUDIO;
})();

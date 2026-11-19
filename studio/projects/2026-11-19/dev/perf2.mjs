// find heavy frames in render mode (dev only)
import { launch, openRender, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const render = { system: server.system, samples: previewSamples(server.system, 120), perf: [], warmup: 35 };
const { page } = await openRender(browser, server.url('2026-11-19'), render, +(process.argv[2] || 1));
const spikes = await page.evaluate(async (N) => {
  const out = [];
  const RD = Object.getPrototypeOf(Date);
  for (let j = 0; j < N; j++) {
    window.__PROF = {};
    const m = window.__STUDIO_ADVANCE__(1000 / 60);
    const w = window.__STUDIO_SETTLE__ && window.__STUDIO_SETTLE__();
    let tw = 0;
    if (w) { const t0 = RD.now(); await w; tw = RD.now() - t0; }
    if (m > 20) out.push({ j, ms: m, t: window.APP ? APP.t : 0, phase: window.APP ? APP.phase : '', prof: Object.fromEntries(Object.entries(window.__PROF).filter(([k, v]) => v.sum > 2).map(([k, v]) => [k, v.sum])) });
  }
  return out;
}, 60 * 90);
for (const s of spikes) console.log(JSON.stringify(s));
await browser.close();
server.close();

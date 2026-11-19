// per-frame JS cost in render mode (dev only)
import path from 'node:path';
import { launch, openRender, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const render = { system: server.system, samples: previewSamples(server.system, 120), perf: [], warmup: 35 };
const { page, errors } = await openRender(browser, server.url('2026-11-19'), render, +(process.argv[2] || 1));
await page.evaluate(() => (window.__PROF = {}));
const ms = await page.evaluate(async () => {
  const out = [];
  for (let j = 0; j < 60 * 50; j++) {
    const m = window.__STUDIO_ADVANCE__(1000 / 60);
    const w = window.__STUDIO_SETTLE__ && window.__STUDIO_SETTLE__();
    if (w) await w;
    out.push(m);
  }
  return out;
});
const after = ms.slice(60 * 6);
const sorted = [...after].sort((a, b) => a - b);
const q = (p) => sorted[Math.floor(p * (sorted.length - 1))];
console.log('frames', after.length, 'avg', (after.reduce((a, b) => a + b, 0) / after.length).toFixed(2), 'p50', q(0.5), 'p90', q(0.9), 'p99', q(0.99), 'max', sorted.at(-1));
console.log('over 12ms:', after.filter((x) => x > 12).length, 'over 16:', after.filter((x) => x > 16).length);
console.log('first 10', ms.slice(0, 10).join(' '));
console.log("errors", errors.slice(0, 5));
const pr = await page.evaluate(() => window.__PROF);
for (const [k, v] of Object.entries(pr)) console.log(k.padEnd(12), "n", v.n, "avg", (v.sum / v.n).toFixed(2), "max", v.max);
await browser.close();
server.close();

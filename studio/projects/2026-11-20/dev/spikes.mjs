// render-mode frame cost per frame: where do the slow frames happen?
import path from 'node:path';
import { launch, openRender, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const project = path.basename(path.resolve(import.meta.dirname, '..'));
const server = await startServer();
const browser = await launch();
const render = { system: server.system, samples: previewSamples(server.system, 90), perf: [], warmup: 30 };
const { page, errors } = await openRender(browser, server.url(project), render, 1);
const out = await page.evaluate(async () => {
  const slow = [];
  for (let f = 0; f < 60 * 50; f++) {
    const m = window.__STUDIO_ADVANCE__(1000 / 60);
    const w = window.__STUDIO_SETTLE__ && window.__STUDIO_SETTLE__();
    if (w) await w;
    if (m > 14) slow.push([f, +(f / 60).toFixed(2), m]);
  }
  return slow;
});
console.log(JSON.stringify(out));
console.log('errors', errors.slice(0, 3));
await browser.close(); server.close(); process.exit(0);

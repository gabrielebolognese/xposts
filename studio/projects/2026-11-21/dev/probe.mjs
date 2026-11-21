// dev: load the page in render mode, run frames, print APP diagnostics
import path from 'node:path';
import { launch, openRender, run, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const secs = Number(process.argv[2] || 3);
const expr = process.argv[3] || 'JSON.stringify({gpu: APP.S.gpuMs, timer: !!APP.S.timer, js: APP.jsMs, pass: APP.passDone, prewarm: APP.prewarmMs})';
const server = await startServer();
const browser = await launch();
try {
  const render = { system: server.system, samples: previewSamples(server.system, 120), perf: [], warmup: 25 };
  const { page, errors } = await openRender(browser, server.url(path.basename(path.resolve('.'))), render, 1);
  const chunks=[]; const rps=[]; for (let i=0;i<secs;i++){ const r = await run(page, 1); chunks.push(r.avg+'/'+r.max); rps.push(await page.evaluate('APP.raysPerSec()')); }
  console.log('rps', Math.min(...rps.slice(2)), Math.max(...rps.slice(2)), rps.join(' '));
  console.log('per-second avg/max ms:', chunks.join(' '));
  console.log(await page.evaluate(expr));
  console.log('errors', errors.slice(0, 10));
} finally { await browser.close(); server.close(); }

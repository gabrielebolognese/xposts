import path from 'node:path';
import { launch, openRender, run, camera, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const project = path.basename(path.resolve(import.meta.dirname, '..'));
const server = await startServer();
const browser = await launch();
const render = { system: server.system, samples: previewSamples(server.system, 75), perf: [], warmup: 30 };
const { page } = await openRender(browser, server.url(project), render, 1);
const r0 = await run(page, 30); console.log('warmup', r0);
let t = 0;
for (const s of [2, 15, 35]) {
  const r = await run(page, s - t); t = s; console.log('to', s, r);
  await camera(page, { cx: 0.5, cy: 0.5, zoom: 1 }); await page.screenshot({ path: 'dev/tmp.png' });
  await camera(page, { cx: 0.25, cy: 0.3, zoom: 1.8 }); await page.screenshot({ path: 'dev/tmp.png' });
  const r2 = await run(page, 0.1); console.log('after shot', r2);
}
await browser.close(); server.close(); process.exit(0);

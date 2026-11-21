import { launch, openRender, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer(); const browser = await launch();
try {
  const render = { system: server.system, samples: previewSamples(server.system, 30), perf: [], warmup: 1 };
  const { page, errors } = await openRender(browser, server.url('2026-11-21') + 'dev/' + (process.argv[2] || 'bench.html'), render, 1);
  console.log(await page.evaluate('BENCH()'));
  console.log('errors', errors.slice(0, 5));
} finally { await browser.close(); server.close(); }

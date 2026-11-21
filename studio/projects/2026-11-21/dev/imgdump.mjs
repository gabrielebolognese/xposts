// dev: evaluate an expression returning {name: dataURL} and write PNGs to dev/out
import fs from 'node:fs';
import path from 'node:path';
import { launch, openRender, run, previewSamples } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const expr = fs.readFileSync(process.argv[2], 'utf8');
const server = await startServer(); const browser = await launch();
try {
  const render = { system: server.system, samples: previewSamples(server.system, 60), perf: [], warmup: 25 };
  const { page, errors } = await openRender(browser, server.url('2026-11-21'), render, 1);
  await run(page, Number(process.argv[3] || 2));
  const out = await page.evaluate(expr);
  fs.mkdirSync('dev/out', { recursive: true });
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string' && v.startsWith('data:image/png')) fs.writeFileSync(path.join('dev/out', k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
    else console.log(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  console.log('errors', errors.slice(0, 5));
} finally { await browser.close(); server.close(); }

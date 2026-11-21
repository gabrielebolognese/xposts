// dev: live-mode run (real clock) for N seconds, prints page fps / frame stats every 2 s
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const secs = Number(process.argv[2] || 16);
const server = await startServer(); const browser = await launch();
try {
  const pre = process.argv[3] || '';
  if (pre) { const pg0 = await browser.newPage(); await pg0.close(); }
  const page0 = await browser.newPage();
  if (pre) await page0.evaluateOnNewDocument(pre);
  await page0.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errors = []; page0.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page0.goto(server.url('2026-11-21'), { waitUntil: 'load', timeout: 60000 });
  const page = page0;
  for (let t = 0; t < secs; t += 10) {
    await new Promise((r) => setTimeout(r, 10000));
    console.log(t + 2, await page.evaluate(() => JSON.stringify({ perf: STUDIO.perf(), js: APP.jsHist.slice(-120).reduce((a, b) => a + b, 0) / 120, jsMax: Math.max(...APP.jsHist.slice(-120)), rps: APP.raysPerSec(), sweep: APP.sweep.length, frame: APP.frame, sec: Object.fromEntries(Object.entries(APP.sec).map(([k,v])=>[k,+(v/APP.frame).toFixed(2)])), pan: Object.fromEntries(Object.entries(PANELS.cost).map(([k,v])=>[k,+(v.ms/APP.frame).toFixed(2)])), gpu: GLX.gpu, ps: GLX.ps })));
  }
  console.log('errors', errors.slice(0, 5));
} finally { await browser.close(); server.close(); }

// late live-mode diagnostics (dev only)
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page } = await openLive(browser, server.url('2026-11-19'));
const nomc = process.argv[2] === 'nomc';
if (nomc) await page.evaluate(() => { const f = () => { if (APP.mc) APP.mc.ready = false; requestAnimationFrame(f); }; requestAnimationFrame(f); });
for (const t of [20, 40, 60, 80]) {
  await new Promise((r) => setTimeout(r, t === 20 ? 15000 : 15000));
  const r = await page.evaluate(async () => {
    window.__PROF = {};
    const iv = []; let last = performance.now(); let busy = 0;
    await new Promise((res) => { let n = 0; const f = (tt) => { iv.push(tt - last); last = tt; if (++n < 120) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const P = window.__PROF; let js = 0; for (const v of Object.values(P)) js += v.sum;
    return { iv: (iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(1), jsPerFrame: (js / 120).toFixed(2), clock: UI.clock(APP.clock), hist: APP.hist.length, diffMs: APP.diffMs };
  });
  console.log(nomc ? 'nomc' : 'all', JSON.stringify(r));
}
await browser.close();
server.close();

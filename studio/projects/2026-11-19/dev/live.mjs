// live-mode check (dev only): real clock, real workers
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
await new Promise((r) => setTimeout(r, 2000));
const { page, errors } = await openLive(browser, server.url('2026-11-19'));
const t0 = Date.now();
for (let i = 0; i < 9; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = await page.evaluate(() => ({ phase: APP.phase, t: APP.t, clock: window.UI ? UI.clock(APP.clock) : '', fps: STUDIO.perf().fps, ms: STUDIO.perf().frameMs, gens: APP.mc.gen, solves: APP.solves }));
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(st));
}
await page.screenshot({ path: 'dev/live.png' });
console.log('errors', errors.slice(0, 5));
console.log('report', JSON.stringify(server.page.report));
await browser.close();
server.close();

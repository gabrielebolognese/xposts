// live A/B on track drawing (dev only)
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page } = await openLive(browser, server.url('2026-11-19'));
const iv = async () => page.evaluate(async () => {
  const a = []; let last = performance.now();
  await new Promise((res) => { let n = 0; const f = (t) => { a.push(t - last); last = t; if (++n < 240) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  return (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
});
await new Promise((r) => setTimeout(r, 30000));
for (let k = 0; k < 4; k++) {
  await page.evaluate(() => (window.__NOTRACKS = false));
  console.log('tracks on ', await iv());
  await page.evaluate(() => (window.__NOTRACKS = true));
  console.log('tracks off', await iv());
}
await browser.close();
server.close();

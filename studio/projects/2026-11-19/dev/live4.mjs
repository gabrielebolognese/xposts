// live-mode fps vs MC cadence (dev only)
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page } = await openLive(browser, server.url('2026-11-19'));
const sample = async (label) => {
  await page.evaluate(() => {
    window.__IV = []; let last = performance.now(); window.__stopIV = false; window.__g0 = APP.mc.gen;
    const f = (t) => { window.__IV.push(t - last); last = t; if (!window.__stopIV) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await new Promise((r) => setTimeout(r, 6000));
  const r = await page.evaluate(() => { window.__stopIV = true; const iv = window.__IV; return { avg: (iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(1), gensPerS: ((APP.mc.gen - window.__g0) / 6).toFixed(1), ms: Array.from(APP.mc.workerMs).map((x) => x.toFixed(1)).join(','), phase: APP.phase }; });
  console.log(label, JSON.stringify(r));
};
await new Promise((r) => setTimeout(r, 4000));
for (const e of [1, 2, 3, 4]) {
  await page.evaluate((e) => { APP.mcEvery = e; }, e);
  await new Promise((r) => setTimeout(r, 1000));
  await sample('every ' + e);
}
await browser.close();
server.close();

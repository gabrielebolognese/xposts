// live-mode A/B (dev only): interval with and without the MC workers
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page } = await openLive(browser, server.url('2026-11-19'));
const sample = async (label) => {
  await page.evaluate(() => {
    window.__IV = [];
    let last = performance.now();
    window.__stopIV = false;
    const f = (t) => { window.__IV.push(t - last); last = t; if (!window.__stopIV) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await new Promise((r) => setTimeout(r, 5000));
  const r = await page.evaluate(() => { window.__stopIV = true; const iv = window.__IV; return { n: iv.length, avg: (iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(1), phase: APP.phase }; });
  console.log(label, JSON.stringify(r));
};
await new Promise((r) => setTimeout(r, 6000));
await sample('all on      ');
await page.evaluate(() => { APP.mc.ready = false; });
await new Promise((r) => setTimeout(r, 1000));
await sample('no MC       ');
await page.evaluate(() => { APP.diffBusy = true; });
await new Promise((r) => setTimeout(r, 3000));
await sample('no MC no DIFF');
await page.evaluate(() => { APP.f = null; });
await sample('no UI       ');
await browser.close();
server.close();

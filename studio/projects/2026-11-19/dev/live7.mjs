// long tasks with sim time (dev only)
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page } = await openLive(browser, server.url('2026-11-19'));
await page.evaluate(() => {
  window.__LT = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LT.push([Math.round(e.startTime / 100) / 10, Math.round(e.duration), window.APP ? APP.t : 0]); }).observe({ entryTypes: ['longtask'] });
  window.__GAP = [];
  let last = performance.now();
  const f = (t) => { if (t - last > 40) window.__GAP.push([Math.round(t / 100) / 10, Math.round(t - last), APP.t, APP.phase]); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await new Promise((r) => setTimeout(r, 85000));
const r = await page.evaluate(() => ({ lt: window.__LT, gap: window.__GAP }));
console.log('longtasks', JSON.stringify(r.lt));
console.log('frame gaps >40ms', JSON.stringify(r.gap));
await browser.close();
server.close();

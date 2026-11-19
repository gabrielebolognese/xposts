// live-mode frame diagnostics (dev only)
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const server = await startServer();
const browser = await launch();
const { page, errors } = await openLive(browser, server.url('2026-11-19'));
await page.evaluate(() => {
  window.__PROF = {};
  const g = document.createElement('canvas').getContext('webgl2');
  const ext = g.getExtension('WEBGL_debug_renderer_info');
  window.__GPU = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
  window.__IV = [];
  let last = performance.now();
  const f = (t) => { window.__IV.push(t - last); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  window.__LT = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LT.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
});
await new Promise((r) => setTimeout(r, +(process.argv[2] || 25) * 1000));
const r = await page.evaluate(() => {
  const iv = window.__IV.slice(-300);
  const P = window.__PROF;
  const prof = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, (v.sum / v.n).toFixed(2) + '/' + v.max]));
  return { gpu: window.__GPU, ivAvg: (iv.reduce((a, b) => a + b, 0) / iv.length).toFixed(1), lt: window.__LT.slice(-20), ltN: window.__LT.length, prof, phase: APP.phase };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
server.close();

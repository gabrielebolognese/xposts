// live-mode check: real clock, real workers. Prints sim Hz, fps and frame times over time.
import path from 'node:path';
import { launch, openLive } from '../../../tools/capture.mjs';
import { startServer } from '../../../tools/server.mjs';
const project = path.basename(path.resolve(import.meta.dirname, '..'));
const server = await startServer();
const browser = await launch();
const { page, errors } = await openLive(browser, server.url(project));
for (let t = 0; t < 4; t++) {
  await new Promise((r) => setTimeout(r, 5000));
  const r = await page.evaluate(() => ({
    st: APP.selftest && [APP.selftest.ms.toFixed(0), APP.selftest.initMs.toFixed(0), APP.selftest.cycles], hz: Math.round(APP.hz), cyc: APP.sim && APP.sim.cyc, prewarm: APP.prewarm, perf: STUDIO.perf(),
    faults: APP.fault.sim, batches: APP.fault.batches, div: APP.sim && APP.sim.div,
    wms: APP.workMs.toFixed(2), fmax: Math.max(...APP.frameMsHist.slice(-120)).toFixed(1), favg: (APP.frameMsHist.slice(-120).reduce((a, b) => a + b, 0) / 120).toFixed(2),
  }));
  console.log(`t=${(t + 1) * 5}s`, JSON.stringify(r));
}
console.log('errors', errors.slice(0, 5));
await browser.close();
server.close();
process.exit(0);

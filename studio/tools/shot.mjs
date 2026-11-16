// Screenshots of a studio project at given seconds, for the builder to look at its own work and for the critic.
// Usage (from the project folder): node ../../tools/shot.mjs . --at 2,15,40 [--view 0.3,0.4,1.8] [--scale 1]
//   --at     seconds after the warm-up (the moments the video would show)
//   --view   cx,cy,zoom: also capture each moment through this camera (repeatable), to check tiny text up close
// Writes shots/at-<s>s.png (and at-<s>s-view<N>.png) and prints a JSON summary: the files, page errors, and how many
// real milliseconds one frame takes (above 16 ms the page cannot run at 60 fps live).
import fs from 'node:fs';
import path from 'node:path';
import { launch, openRender, run, camera, previewSamples } from './capture.mjs';
import { startServer, STUDIO } from './server.mjs';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const opt = (name) => {
  const out = [];
  args.forEach((a, i) => a === name && args[i + 1] && out.push(args[i + 1]));
  return out;
};
const at = (opt('--at')[0] || '2,15,40').split(',').map(Number).filter((x) => x >= 0).sort((a, b) => a - b);
const views = opt('--view').map((v) => v.split(',').map(Number)).map(([cx, cy, zoom]) => ({ cx, cy, zoom }));
const scale = Number(opt('--scale')[0] || 1);
const project = path.basename(dir);
if (!fs.existsSync(path.join(dir, 'index.html')) || path.dirname(dir) !== path.join(STUDIO, 'projects')) {
  console.error('Usage: node ../../tools/shot.mjs . --at 2,15,40 (run it in a studio project folder with an index.html)');
  process.exit(2);
}
const read = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  } catch {
    return d;
  }
};
const brief = read('brief.json', {});
const metrics = read('metrics.json', null);
const warmup = Number(brief.warmup_seconds) || 20;

const server = await startServer();
const browser = await launch();
const out = { shots: [], errors: [], frameMs: null, warmup, numbers: metrics ? 'measured' : 'preview (made up until the live run)' };
try {
  const render = metrics
    ? { system: metrics.system, samples: metrics.samples, perf: metrics.perf, warmup }
    : { system: server.system, samples: previewSamples(server.system, warmup + Math.max(...at) + 5), perf: [], warmup };
  const { page, errors } = await openRender(browser, server.url(project), render, scale);
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  let t = 0, worst = 0, sum = 0, n = 0;
  const step = async (s) => {
    const r = await run(page, s);
    worst = Math.max(worst, r.max);
    sum += r.avg;
    n += 1;
  };
  await step(warmup);
  for (const s of at) {
    if (s > t) await step(s - t);
    t = s;
    const name = `at-${s}s`;
    await camera(page, { cx: 0.5, cy: 0.5, zoom: 1 });
    const file = path.join(dir, 'shots', `${name}.png`);
    await page.screenshot({ path: file });
    out.shots.push(path.relative(dir, file).replace(/\\/g, '/'));
    for (const [i, v] of views.entries()) {
      await camera(page, v);
      const vf = path.join(dir, 'shots', `${name}-view${i + 1}.png`);
      await page.screenshot({ path: vf });
      out.shots.push(path.relative(dir, vf).replace(/\\/g, '/'));
    }
  }
  await camera(page, { cx: 0.5, cy: 0.5, zoom: 1 });
  out.errors = [...new Set(errors)].slice(0, 20);
  out.frameMs = { avg: n ? +(sum / n).toFixed(2) : 0, max: worst };
  out.report = await page.evaluate(() => (window.__STUDIO_REPORT__ ? window.__STUDIO_REPORT__() : {}));
} catch (e) {
  out.errors.push(String(e.message || e));
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify(out, null, 1));

// Screenshots of a studio project at given seconds, for the builder to look at its own work and for the critic.
// Usage (from the project folder): node ../../tools/shot.mjs . --at 2,15,40 [--view 0.3,0.4,1.8] [--scale 1]
//   --at       seconds after the warm-up (the moments the video would show)
//   --view     cx,cy,zoom: also capture each moment through this camera (repeatable), to check tiny text up close
//   --clip     x,y,w,h: also capture this rectangle of the stage at each moment (repeatable); with --scale 2 it shows
//              the detail the 2x video render has
//   --hero     zoom,cx,cy: after the last moment, zoom the hero through its own zoom (STUDIO.heroView), let it
//              re-render for 1 second and capture the first --clip rectangle (repeatable)
//   --no-frame skip the full frames (only the --view, --clip and --hero images)
// Writes shots/at-<s>s.png (and at-<s>s-view<N>.png, at-<s>s-clip<N>.png, hero<N>.png) and prints a JSON summary: the
// files, page errors, and how many real milliseconds one frame takes.
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
const clips = opt('--clip').map((v) => v.split(',').map(Number)).map(([x, y, width, height]) => ({ x, y, width, height }));
const heroes = opt('--hero').map((v) => v.split(',').map(Number)).map(([zoom, cx, cy]) => ({ zoom, cx, cy }));
const frames = !args.includes('--no-frame');
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
  const save = async (file, clip) => {
    await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
    out.shots.push(path.relative(dir, file).replace(/\\/g, '/'));
  };
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
    if (frames) await save(path.join(dir, 'shots', `${name}.png`));
    for (const [i, c] of clips.entries()) await save(path.join(dir, 'shots', `${name}-clip${i + 1}.png`), c);
    for (const [i, v] of views.entries()) {
      await camera(page, v);
      await save(path.join(dir, 'shots', `${name}-view${i + 1}.png`));
    }
  }
  await camera(page, { cx: 0.5, cy: 0.5, zoom: 1 });
  if (heroes.length && !(await page.evaluate(() => typeof window.__STUDIO_HERO__ === 'function'))) {
    errors.push('the hero has no zoom and pan: the page never called STUDIO.heroView(fn)');
  } else if (heroes.length) {
    for (const [i, v] of heroes.entries()) {
      await page.evaluate((v) => window.__STUDIO_HERO__(v.zoom, v.cx, v.cy), v);
      await step(1); // the hero re-renders at the new view
      await save(path.join(dir, 'shots', `hero${i + 1}.png`), clips[0]);
    }
    await page.evaluate(() => window.__STUDIO_HERO__(1, 0.5, 0.5));
  }
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

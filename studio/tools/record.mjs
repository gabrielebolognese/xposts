// Records a studio project as a video, in two passes:
//   1. live run: the project runs for real in Chrome for --live seconds while this PC's CPU, RAM, GPU, disk and
//      network are sampled; the page's frame rate and headline numbers are logged (metrics.json)
//   2. render: the run is replayed frame by frame with the controlled clock at --scale times the resolution, the camera
//      follows brief.json's keyframes, and ffmpeg encodes 1080p at --fps (video.mp4)
// Usage: node studio/tools/record.mjs <project folder> [--live 90] [--seconds 50] [--fps 60] [--scale 2] [--skip-live]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launch, openLive, openRender, run, cameraAt, W, H } from './capture.mjs';
import { startServer } from './server.mjs';

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || '.');
const num = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const project = path.basename(dir);
const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
const warmup = Number(brief.warmup_seconds) || 20;
const seconds = num('--seconds', Number(brief.video_seconds) || 50);
const fps = num('--fps', 60);
const scale = num('--scale', 2);
const live = num('--live', Math.max(90, warmup + seconds + 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(`[record] ${s}`);

const server = await startServer();
const browser = await launch();
const result = { project, fps, seconds, scale, warmup, live, errors: [] };
try {
  // 1. live run
  let metrics = null;
  const mfile = path.join(dir, 'metrics.json');
  if (args.includes('--skip-live') && fs.existsSync(mfile)) metrics = JSON.parse(fs.readFileSync(mfile, 'utf8'));
  else {
    await sleep(3000); // a few samples before the page starts
    log(`live run: ${live} s with real resource sampling`);
    const { page, errors } = await openLive(browser, server.url(project));
    await sleep(live * 1000);
    const start = server.page.start ?? Date.now() - live * 1000;
    metrics = {
      system: server.system,
      samples: server.sampler.samples.filter((s) => s.t >= start - 60000).map((s) => ({ ...s, t: +((s.t - start) / 1000).toFixed(2) })),
      perf: server.page.perf,
      report: server.page.report,
      live_seconds: live,
      at: new Date().toISOString(),
    };
    result.errors.push(...errors);
    await page.close();
    fs.writeFileSync(mfile, JSON.stringify(metrics));
    const fpsVals = metrics.perf.map((p) => p.fps).filter(Boolean);
    log(`live run done: ${metrics.samples.length} samples, page ${fpsVals.length ? Math.min(...fpsVals) + ' to ' + Math.max(...fpsVals) : '?'} fps`);
  }

  // 2. frame-by-frame render
  const render = { system: metrics.system, samples: metrics.samples, perf: metrics.perf, warmup };
  const { page, errors } = await openRender(browser, server.url(project), render, scale);
  const warm = await run(page, warmup, fps);
  log(`warm-up ${warmup} s done (${warm.avg} ms per frame), rendering ${seconds * fps} frames at ${W * scale}x${H * scale}`);
  const out = path.join(dir, 'video.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-vf', `scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '16', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-profile:v', 'high', '-r', String(fps), '-movflags', '+faststart', out],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let fferr = '';
  ff.stderr.on('data', (d) => (fferr += d));
  const done = new Promise((r) => ff.on('close', r));
  const keys = brief.camera || [];
  const t0 = Date.now();
  let worst = 0, sum = 0;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) {
    const c = cameraAt(keys, i / fps);
    const ms = await page.evaluate(async (step, c) => {
      const m = window.__STUDIO_ADVANCE__(step);
      const wait = window.__STUDIO_SETTLE__ && window.__STUDIO_SETTLE__(); // the frame's worker replies
      if (wait) await wait;
      window.__STUDIO_CAMERA__(c.cx, c.cy, c.zoom);
      return m;
    }, 1000 / fps, c);
    worst = Math.max(worst, ms);
    sum += ms;
    const img = await page.screenshot({ type: 'jpeg', quality: 93, optimizeForSpeed: true });
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((i + 1) % 300 === 0) log(`${i + 1}/${frames} frames (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  ff.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(`ffmpeg failed: ${fferr.slice(0, 300)}`);
  result.errors.push(...errors);
  result.render_seconds = Math.round((Date.now() - t0) / 1000);
  result.frame_ms = { avg: +(sum / frames).toFixed(2), max: worst };
  result.report = { ...metrics.report, ...(await page.evaluate(() => (window.__STUDIO_REPORT__ ? window.__STUDIO_REPORT__() : {}))) };
  result.video = 'video.mp4';
  result.mb = +(fs.statSync(out).size / 1048576).toFixed(1);
  log(`video.mp4: ${seconds} s, ${result.mb} MB, rendered in ${result.render_seconds} s`);
} catch (e) {
  result.errors.push(String(e.message || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  result.errors = [...new Set(result.errors)].slice(0, 20);
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(result, null, 1));
}

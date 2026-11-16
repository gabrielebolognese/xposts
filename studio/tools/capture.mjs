// Shared by shot.mjs and record.mjs: headless Chrome (the installed one, through puppeteer-core) with the controlled
// clock, the recorded resource numbers and the camera.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = process.env.STUDIO_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const VCLOCK = fs.readFileSync(path.join(import.meta.dirname, 'vclock.js'), 'utf8');
export const W = 1920, H = 1080;

export function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
    defaultViewport: null,
  });
}

// A page in live mode (real clock): for the live run
export async function openLive(browser, url) {
  const page = await browser.newPage();
  const errors = watch(page);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  return { page, errors };
}

// A page in render mode: controlled clock, recorded numbers (render = {system, samples, perf, warmup})
export async function openRender(browser, url, render, scale = 1) {
  const page = await browser.newPage();
  const errors = watch(page);
  await page.setViewport({ width: W, height: H, deviceScaleFactor: scale });
  await page.evaluateOnNewDocument(VCLOCK);
  await page.evaluateOnNewDocument(`window.__STUDIO_RENDER__ = ${JSON.stringify(render)};`);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  return { page, errors };
}

function watch(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 400)));
  return errors;
}

export const advance = (page, ms) => page.evaluate((x) => window.__STUDIO_ADVANCE__(x), ms);

// Runs the page forward by seconds at fps without capturing (the warm-up). Returns {avg, max} real ms per frame.
export async function run(page, seconds, fps = 60) {
  const step = 1000 / fps;
  let total = 0, max = 0, n = 0;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i += 30) {
    const k = Math.min(30, frames - i);
    const ms = await page.evaluate((s, k) => {
      let worst = 0, sum = 0;
      for (let j = 0; j < k; j++) {
        const m = window.__STUDIO_ADVANCE__(s);
        sum += m;
        worst = Math.max(worst, m);
      }
      return [sum, worst];
    }, step, k);
    total += ms[0];
    max = Math.max(max, ms[1]);
    n += k;
  }
  return { avg: n ? +(total / n).toFixed(2) : 0, max };
}

// Camera keyframes [{t, cx, cy, zoom}] (t in seconds from the first recorded frame), eased between keyframes
export function cameraAt(keys, t) {
  if (!keys || !keys.length) return { cx: 0.5, cy: 0.5, zoom: 1 };
  const k = [...keys].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const a = k[i - 1], b = k[i];
      const x = (t - a.t) / Math.max(0.001, b.t - a.t);
      const e = x * x * (3 - 2 * x);
      return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, zoom: a.zoom + (b.zoom - a.zoom) * e };
    }
  }
  return k.at(-1);
}
export const camera = (page, c) => page.evaluate((c) => window.__STUDIO_CAMERA__(c.cx, c.cy, c.zoom), c);

// Plausible numbers for previews made before the live run (shot.mjs); the real video always uses measured ones
export function previewSamples(system, seconds) {
  const threads = system.threads || 8;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cpu = Array.from({ length: threads }, () => 20 + rnd() * 30);
  const out = [];
  for (let t = -60; t <= seconds; t += 0.25) {
    for (let i = 0; i < threads; i++) cpu[i] = Math.min(98, Math.max(2, cpu[i] + (rnd() - 0.5) * 12));
    out.push({ t: +t.toFixed(2), cpu: cpu.map((x) => +x.toFixed(1)), cpuTotal: +(cpu.reduce((s, x) => s + x, 0) / threads).toFixed(1),
      ramUsed: +(8 + 0.6 * Math.sin(t / 20) + rnd() * 0.2).toFixed(2), ramTotal: system.ramGB || 16,
      gpu: +(40 + 25 * Math.sin(t / 7) + rnd() * 8).toFixed(1), diskR: +(rnd() * 3).toFixed(2), diskW: +(rnd() * 6).toFixed(2), net: +(rnd() * 0.4).toFixed(3) });
  }
  return out;
}

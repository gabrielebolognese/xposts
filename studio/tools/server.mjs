// Local server for Claude Studio projects: serves studio/ (the kit and the projects) and the real resource numbers
// of this PC. Opening a project: node studio/tools/server.mjs <project> (bash studio/open.sh <project> does this).
//   GET  /studio/state    {system, history: the last minute of samples}
//   GET  /studio/metrics  the latest sample
//   POST /studio/page     the page's frame rate and headline numbers (the recorder logs them)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { exec } from 'node:child_process';
import { startSampler, systemInfo } from './sampler.mjs';

export const STUDIO = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8',
};

export function system() {
  const file = path.join(STUDIO, 'data', 'system.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const info = systemInfo();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(info, null, 1));
    return info;
  }
}

export function startServer({ port = 0 } = {}) {
  const sampler = startSampler();
  const sys = system();
  const page = { start: null, perf: [], report: {} };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (data) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/studio/state') return json({ system: sys, history: sampler.samples.slice(-240) });
    if (url.pathname === '/studio/metrics') return json(sampler.latest());
    if (url.pathname === '/studio/page' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        try {
          const b = JSON.parse(body);
          if (page.start === null) page.start = Date.now() - b.t * 1000;
          page.perf.push({ t: +b.t.toFixed(2), fps: b.perf.fps, frameMs: b.perf.frameMs, heapMB: b.perf.heapMB });
          Object.assign(page.report, b.report);
        } catch {}
        json({ ok: true });
      });
      return;
    }
    const file = path.join(STUDIO, decodeURIComponent(url.pathname).replace(/\/$/, '/index.html'));
    if (!file.startsWith(STUDIO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      resolve({
        port: p,
        url: (project) => `http://127.0.0.1:${p}/projects/${project}/`,
        sampler,
        system: sys,
        page,
        close() {
          sampler.stop();
          server.close();
        },
      });
    });
  });
}

if (path.basename(process.argv[1] ?? '') === 'server.mjs') {
  const project = process.argv[2];
  if (!project || !fs.existsSync(path.join(STUDIO, 'projects', project, 'index.html'))) {
    const all = fs.existsSync(path.join(STUDIO, 'projects')) ? fs.readdirSync(path.join(STUDIO, 'projects')) : [];
    console.error(`Usage: bash studio/open.sh <project>   projects: ${all.join(', ') || '(none yet)'}`);
    process.exit(2);
  }
  const s = await startServer({ port: Number(process.env.STUDIO_PORT) || 3002 });
  const link = s.url(project);
  console.log(`Claude Studio: ${link}  (live: real numbers from this PC). Press Ctrl+C to stop.`);
  if (!process.env.STUDIO_NO_OPEN) exec(`start "" "${link}"`);
}

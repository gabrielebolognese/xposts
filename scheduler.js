import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const ROOT = import.meta.dirname;
const QUEUE = path.join(ROOT, 'queue');
const SLOTS = ['0900', '1100', '1300', '1500']; // Europe/Rome
const TEXT_FROM = 15 * 60 + 30; // text posts: random times from 15:30 to 21:00, Europe/Rome
const TEXT_TO = 21 * 60;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_IMAGE = 5 * 1024 * 1024;
const ADDRESS = 'http://localhost:3000';

// Posts are separated by a line containing only #--#
export function parsePosts(md) {
  return md
    .replace(/\r\n/g, '\n')
    .split(/^[ \t]*#--#[ \t]*$/m)
    .map((p) => p.trim())
    .filter(Boolean);
}

// Europe/Rome wall clock in folder format, e.g. 2026-10-21_0930 (Intl handles DST)
const rome = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function romeTime(ms) {
  const p = Object.fromEntries(rome.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

// Next n free slots at least 15 minutes from now. Names are Rome wall clock, so comparing
// them as strings is enough (the slots never fall in the 02:00-03:00 DST switch hour).
export function freeSlots(n, now = Date.now(), taken = (name) => fs.existsSync(path.join(QUEUE, name))) {
  const min = romeTime(now + 15 * 60000);
  const out = [];
  for (let day = new Date(`${min.slice(0, 10)}T00:00Z`); out.length < n; day.setUTCDate(day.getUTCDate() + 1)) {
    for (const slot of SLOTS) {
      const name = `${day.toISOString().slice(0, 10)}_${slot}`;
      if (out.length < n && name >= min && !taken(name)) out.push(name);
    }
  }
  return out;
}

const minutes = (name) => Number(name.slice(11, 13)) * 60 + Number(name.slice(13, 15));
const folderNames = () =>
  ['queue', 'posted', 'missed'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)) : []));

// Text posts: up to 2 a day at random minutes from 15:30 to 21:00, at least 15 minutes from now and
// 1 hour apart from each other and from posts already in that window (in queue/, posted/ or missed/).
export function textSlots(n, now = Date.now(), existing = folderNames(), rand = Math.random) {
  const min = romeTime(now + 15 * 60000);
  const out = [];
  for (let day = new Date(`${min.slice(0, 10)}T00:00Z`); out.length < n; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const from = date === min.slice(0, 10) ? Math.max(TEXT_FROM, minutes(min)) : TEXT_FROM;
    const used = existing.filter((f) => f.startsWith(`${date}_`)).map(minutes).filter((m) => m >= TEXT_FROM && m <= TEXT_TO);
    while (used.length < 2 && out.length < n) {
      const options = [];
      for (let m = from; m <= TEXT_TO; m++) if (used.every((u) => Math.abs(m - u) >= 60)) options.push(m);
      if (!options.length) break;
      const m = options[Math.floor(rand() * options.length)];
      used.push(m);
      out.push(`${date}_${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`);
    }
  }
  return out.sort();
}

// images: [{ name, size }]. Post N goes with the image whose name starts with the number N.
// textOnly: posts without images, so the images are not checked at all.
export function check(md, images, textOnly = false) {
  const posts = parsePosts(md);
  const errors = [];
  const warnings = [];
  const byNum = new Map();
  if (!posts.length) errors.push('No posts found in the .md file');
  if (!textOnly) {
    for (const img of images) {
      const lead = img.name.match(/^\d+/);
      if (!lead || !MIME[path.extname(img.name).toLowerCase()]) {
        errors.push(`${img.name}: name it with the post number, like 1.png (png, jpg, jpeg, webp, gif)`);
        continue;
      }
      const num = Number(lead[0]);
      if (byNum.has(num)) errors.push(`Two images for post ${num}: ${byNum.get(num).name} and ${img.name}`);
      byNum.set(num, img);
      if (img.size > MAX_IMAGE) errors.push(`${img.name} is over 5 MB`);
    }
    const missing = posts.map((_, i) => i + 1).filter((n) => !byNum.has(n));
    const extra = [...byNum.keys()].sort((a, b) => a - b).filter((n) => n < 1 || n > posts.length);
    if (images.length !== posts.length) errors.push(`${posts.length} posts but ${images.length} images`);
    if (missing.length) errors.push(`No image for post ${missing.join(', ')}`);
    if (extra.length) errors.push(`No post for image ${extra.join(', ')}`);
  }

  const rows = posts.map((text, i) => {
    const chars = [...text].length;
    if (/https?:\/\/|www\./i.test(text)) warnings.push(`Post ${i + 1} contains a link: it costs $0.20 on the X API instead of $0.015`);
    if (chars > 280) warnings.push(`Post ${i + 1} is over 280 characters (${chars})`);
    return { text, chars, image: byNum.get(i + 1)?.name };
  });
  return { posts: rows, errors, warnings };
}

let unpushed = 0; // posts scheduled since the last successful push
let shown = {}; // random text times from the last preview, reused so the scheduled times match the preview

function schedule(md, images, textOnly) {
  const files = images.map((img) => ({ name: img.name, data: Buffer.from(img.data, 'base64') }));
  const { posts, errors } = check(md, files.map((f) => ({ name: f.name, size: f.data.length })), textOnly);
  if (errors.length) return { errors };
  fs.mkdirSync(QUEUE, { recursive: true });
  const stillValid = shown.md === md && shown.slots[0] >= romeTime(Date.now() + 15 * 60000);
  const folders = !textOnly ? freeSlots(posts.length) : stillValid ? shown.slots : textSlots(posts.length);
  posts.forEach((post, i) => {
    const dir = path.join(QUEUE, folders[i]);
    fs.mkdirSync(dir); // throws if it already exists, so nothing is ever overwritten
    fs.writeFileSync(path.join(dir, 'post.txt'), post.text);
    const img = files.find((f) => f.name === post.image);
    if (img) fs.writeFileSync(path.join(dir, `image${path.extname(img.name)}`), img.data);
  });
  unpushed += posts.length;
  return { folders };
}

// Posts in queue/ whose time hasn't come yet (past ones are posted, or being posted, by GitHub)
function upcoming() {
  const now = romeTime(Date.now());
  if (!fs.existsSync(QUEUE)) return [];
  return fs
    .readdirSync(QUEUE)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{4}/.test(name) && name >= now)
    .sort()
    .map((name) => {
      const files = fs.readdirSync(path.join(QUEUE, name));
      const text = files.includes('post.txt') ? fs.readFileSync(path.join(QUEUE, name, 'post.txt'), 'utf8').trim() : '';
      return { name, text, image: files.find((f) => MIME[path.extname(f).toLowerCase()]) };
    });
}

function serve() {
  http
    .createServer(async (req, res) => {
      const json = (body) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(ROOT, 'scheduler.html')));
      }
      // Thumbnails for the Scheduled posts tab: /img/<folder>/<image>, no dots or slashes in the folder part
      const img = req.method === 'GET' && req.url.match(/^\/img\/([\w-]+)\/([\w-]+\.\w+)$/);
      if (img && MIME[path.extname(img[2]).toLowerCase()] && fs.existsSync(path.join(QUEUE, img[1], img[2]))) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(img[2]).toLowerCase()] });
        return res.end(fs.readFileSync(path.join(QUEUE, img[1], img[2])));
      }
      // JSON only: browsers won't send a cross-origin JSON POST without CORS, so other sites can't call this
      if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
        res.writeHead(404);
        return res.end();
      }
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (req.url === '/preview') {
          const result = check(body.md, body.images, body.text);
          const slots = body.text ? textSlots(result.posts.length) : freeSlots(result.posts.length);
          if (body.text) shown = { md: body.md, slots };
          return json({ ...result, slots });
        }
        if (req.url === '/schedule') return json(schedule(body.md, body.images, body.text));
        if (req.url === '/queue') return json(upcoming());
        if (req.url === '/push') {
          const cmd = `git add queue && git commit -m "schedule ${unpushed} posts" && git pull --rebase && git push`;
          return exec(cmd, { cwd: ROOT }, (err, stdout, stderr) => {
            if (!err) unpushed = 0;
            json({ ok: !err, output: stdout + stderr });
          });
        }
        res.writeHead(404);
        res.end();
      } catch (err) {
        json({ error: err.message });
      }
    })
    .listen(3000, 'localhost', () => {
      console.log(`Scheduler running on ${ADDRESS} (Ctrl+C to stop)`);
      const open = { win32: 'start ""', darwin: 'open' }[process.platform] ?? 'xdg-open';
      exec(`${open} ${ADDRESS}`);
    });
}

if (path.basename(process.argv[1] ?? '') === 'scheduler.js') serve();

// Next free auto post slot: one random minute per window per day (Europe/Rome wall clock), at least
// lead_minutes from now. A window is taken when any folder in queue/, posted/ or missed/ that day has a time inside it.
// Usage: node pipeline/bin/next-slot.mjs [--now <epoch ms>]   prints a queue folder name such as 2026-11-09_0947
import fs from 'node:fs';
import path from 'node:path';
import { romeTime } from '../../scheduler.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(-2));
const pad = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;

export function autoSlot(now, existing, windows, lead = 15, rand = Math.random) {
  const min = romeTime(now + lead * 60000);
  const spans = windows.map((w) => w.map((t) => minutes(t.replace(':', ''))));
  const day = new Date(`${min.slice(0, 10)}T00:00Z`);
  for (let i = 0; i < 3660; i++, day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const used = existing.filter((f) => f.startsWith(`${date}_`)).map((f) => minutes(f.slice(11, 15)));
    for (const [a, b] of spans) {
      if (used.some((u) => u >= a && u <= b)) continue;
      const from = date === min.slice(0, 10) ? Math.max(a, minutes(min.slice(11, 15))) : a;
      if (from <= b) return `${date}_${pad(from + Math.floor(rand() * (b - from + 1)))}`;
    }
  }
  throw new Error('no free slot in 10 years');
}

if (path.basename(process.argv[1] ?? '') === 'next-slot.mjs') {
  const config = JSON.parse(fs.readFileSync(process.env.POSTS_CONFIG ?? path.join(ROOT, 'pipeline', 'config.json'), 'utf8'));
  const names = ['queue', 'posted', 'missed']
    .flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)) : []))
    .filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}/.test(n));
  const at = process.argv.indexOf('--now');
  console.log(autoSlot(at > 0 ? Number(process.argv[at + 1]) : Date.now(), names, config.windows, config.lead_minutes));
}

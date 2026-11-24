// Posts one thread right away, outside the schedule: the runner's posting loop runs this for the dashboard's
// "Post thread now" button. THREAD is the thread's parts as base64 JSON: the main post, then each reply. MEDIA (optional)
// is a base64 JSON list of the same length: each part's image file, or null. The ids posted so far go to POST_NOW_OUT
// (a JSON file), so the caller knows how far it got.
import fs from 'node:fs';
import path from 'node:path';
import { chain, quick, xClient } from './post.js';

export function decode(b64) {
  const parts = JSON.parse(Buffer.from(b64 ?? '', 'base64').toString('utf8'));
  if (!Array.isArray(parts) || !parts.length || parts.some((p) => typeof p !== 'string' || !p.trim())) {
    throw new Error('THREAD must be a base64 JSON list of non-empty texts');
  }
  return parts.map((p) => p.trim());
}

export function decodeMedia(b64, count) {
  if (!b64) return [];
  const media = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  if (!Array.isArray(media) || media.length !== count || media.some((m) => m !== null && typeof m !== 'string')) {
    throw new Error('MEDIA must be a base64 JSON list with one file path or null per part');
  }
  return media.map((m) => (m && fs.existsSync(m) ? m : null));
}

if (path.basename(process.argv[1] ?? '') === 'post-now.js') {
  const ids = [];
  const out = process.env.POST_NOW_OUT || 'post-now.json';
  const save = () => fs.writeFileSync(out, JSON.stringify({ ids }) + '\n');
  let parts = [];
  try {
    parts = decode(process.env.THREAD);
    const media = decodeMedia(process.env.MEDIA, parts.length);
    const client = await xClient();
    await chain(client, parts, ids, { save, media, label: process.env.RUN || 'thread', ...(process.env.POSTS_FAKE_X ? { wait: quick } : {}) });
    console.log(`posted now -> https://x.com/i/status/${ids[0]} (${parts.length - 1} replies)`);
  } catch (err) {
    console.error(`failed after ${ids.length} of ${parts.length} parts: ${JSON.stringify(err?.data ?? err?.message ?? String(err))}`);
    if (ids.length) console.error(`what went out: https://x.com/i/status/${ids[0]}`);
    process.exitCode = 1;
  }
}

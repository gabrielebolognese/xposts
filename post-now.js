// Posts one thread right away, outside the schedule (the dashboard's "Post thread now" button starts the post-now
// workflow, which runs this). THREAD is the thread's parts as base64 JSON: the main post, then each reply.
// The ids posted so far go to post-now.json, so the workflow knows whether the main post went out.
import fs from 'node:fs';
import path from 'node:path';
import { chain } from './post.js';

export function decode(b64) {
  const parts = JSON.parse(Buffer.from(b64 ?? '', 'base64').toString('utf8'));
  if (!Array.isArray(parts) || !parts.length || parts.some((p) => typeof p !== 'string' || !p.trim())) {
    throw new Error('THREAD must be a base64 JSON list of non-empty texts');
  }
  return parts.map((p) => p.trim());
}

if (path.basename(process.argv[1] ?? '') === 'post-now.js') {
  const parts = decode(process.env.THREAD);
  const { TwitterApi } = await import('twitter-api-v2');
  const client = new TwitterApi({
    appKey: process.env.X_APP_KEY,
    appSecret: process.env.X_APP_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  }).readWrite;
  const ids = [];
  const save = () => fs.writeFileSync('post-now.json', JSON.stringify({ ids }) + '\n');
  try {
    await chain(client, parts, ids, { save, label: process.env.RUN || 'thread' });
    console.log(`posted now -> https://x.com/i/status/${ids[0]} (${parts.length - 1} replies)`);
  } catch (err) {
    console.error(`failed after ${ids.length} of ${parts.length} parts:`, JSON.stringify(err?.data ?? err?.message ?? String(err)));
    if (ids.length) console.error(`what went out: https://x.com/i/status/${ids[0]}`);
    process.exitCode = 1;
  }
}

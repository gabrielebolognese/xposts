import fs from 'node:fs';
import path from 'node:path';
import { TwitterApi } from 'twitter-api-v2';

const QUEUE = 'queue';
const POSTED = 'posted';
const MISSED = 'missed';
const MAX_LATE_MIN = 180; // a post more than 3h late goes to missed/ instead of being posted
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const client = new TwitterApi({
  appKey: process.env.X_APP_KEY,
  appSecret: process.env.X_APP_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
}).readWrite;

// Folder name format: 2026-10-21_0930 (local time, TZ is set in the workflow)
function dueDate(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:00`) : null;
}

function move(dir, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.renameSync(path.join(QUEUE, dir), path.join(target, dir));
}

async function publish(dir) {
  const full = path.join(QUEUE, dir);
  const files = fs.readdirSync(full).sort();

  const textFile = path.join(full, 'post.txt');
  const text = fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8').trim() : '';
  const images = files.filter((f) => MIME[path.extname(f).toLowerCase()]).slice(0, 4);
  if (!text && images.length === 0) throw new Error('empty post (no post.txt and no image)');

  const mediaIds = [];
  for (const img of images) {
    const ext = path.extname(img).toLowerCase();
    const buf = fs.readFileSync(path.join(full, img));
    let id;
    try {
      // v2 upload endpoint
      id = await client.v2.uploadMedia(buf, {
        media_type: MIME[ext],
        media_category: ext === '.gif' ? 'tweet_gif' : 'tweet_image',
      });
    } catch (err) {
      // fallback: v1.1 upload, which accepts OAuth 1.0a keys
      console.log(`v2 upload failed for ${img}, trying v1.1:`, err?.code ?? err?.message);
      id = await client.v1.uploadMedia(buf, { mimeType: MIME[ext] });
    }
    mediaIds.push(id);
  }

  const payload = {};
  if (text) payload.text = text;
  if (mediaIds.length) payload.media = { media_ids: mediaIds };

  const { data } = await client.v2.tweet(payload);
  return data.id;
}

if (!fs.existsSync(QUEUE)) process.exit(0);

const now = new Date();
const dirs = fs
  .readdirSync(QUEUE, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let failed = false;

for (const dir of dirs) {
  const due = dueDate(dir);
  if (!due) {
    console.log(`skip ${dir}: name must look like 2026-10-21_0930`);
    continue;
  }
  if (due > now) continue;

  const lateMin = (now - due) / 60000;
  if (lateMin > MAX_LATE_MIN) {
    console.log(`missed ${dir} (${Math.round(lateMin)} min late), moved to ${MISSED}/`);
    move(dir, MISSED);
    continue;
  }

  try {
    const id = await publish(dir);
    console.log(`posted ${dir} -> https://x.com/i/status/${id}`);
    move(dir, POSTED);
  } catch (err) {
    failed = true;
    console.error(`failed ${dir}:`, JSON.stringify(err?.data ?? err?.message ?? String(err)));
  }
}

if (failed) process.exitCode = 1;

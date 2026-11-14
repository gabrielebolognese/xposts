import fs from 'node:fs';
import path from 'node:path';

const QUEUE = 'queue';
const POSTED = 'posted';
const MISSED = 'missed';
const MAX_LATE_MIN = 180; // a post more than 3h late goes to missed/ instead of being posted
const RETRY_MS = 30000; // before the one retry of a failed thread part
// Between the parts of a thread: a random 10 to 40 seconds, so the replies do not go out in a burst
export const pause = (rand = Math.random) => 10000 + Math.floor(rand() * 30001);
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Folder name format: 2026-10-21_0930 (local time, TZ is set in the workflow)
function dueDate(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:00`) : null;
}

function move(dir, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.renameSync(path.join(QUEUE, dir), path.join(target, dir));
}

// Thread folders hold reply1.txt, reply2.txt ... next to post.txt; thread.json records the ids posted so far
const replyFiles = (full) =>
  fs.readdirSync(full)
    .filter((f) => /^reply\d+\.txt$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const progressFile = (dir) => path.join(QUEUE, dir, 'thread.json');
export const started = (dir) => fs.existsSync(progressFile(dir));

async function postMain(client, full, text) {
  const files = fs.readdirSync(full).sort();
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

// Posts the folder: a single post, or a thread (the main post, then each reply answering the one before it).
// A thread saves its progress after every part, so a failed run resumes at the next part and never posts twice.
export async function publish(dir, client, wait = sleep) {
  const full = path.join(QUEUE, dir);
  const textFile = path.join(full, 'post.txt');
  const text = fs.existsSync(textFile) ? fs.readFileSync(textFile, 'utf8').trim() : '';
  const replies = replyFiles(full).map((f) => fs.readFileSync(path.join(full, f), 'utf8').trim());
  if (!replies.length) return { id: await postMain(client, full, text), replies: 0 };

  const ids = started(dir) ? JSON.parse(fs.readFileSync(progressFile(dir), 'utf8')).ids : [];
  const save = () => fs.writeFileSync(progressFile(dir), JSON.stringify({ ids }, null, 1) + '\n');
  const once = async (part) => {
    if (part === 0) return postMain(client, full, text);
    const { data } = await client.v2.tweet({ text: replies[part - 1], reply: { in_reply_to_tweet_id: ids.at(-1) } });
    return data.id;
  };
  for (let part = ids.length; part <= replies.length; part++) {
    if (part > 0) await wait(pause());
    let id;
    try {
      id = await once(part);
    } catch (err) {
      console.log(`part ${part} of ${dir} failed, retrying in ${RETRY_MS / 1000} s:`, JSON.stringify(err?.data ?? err?.message));
      await wait(RETRY_MS);
      id = await once(part);
    }
    ids.push(id);
    save();
  }
  return { id: ids[0], replies: replies.length };
}

export async function main(client, now = new Date(), wait = sleep) {
  if (!fs.existsSync(QUEUE)) return false;
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
    if (lateMin > MAX_LATE_MIN && !started(dir)) { // a thread already started is always finished
      console.log(`missed ${dir} (${Math.round(lateMin)} min late), moved to ${MISSED}/`);
      move(dir, MISSED);
      continue;
    }

    try {
      const { id, replies } = await publish(dir, client, wait);
      console.log(`posted ${dir} -> https://x.com/i/status/${id}${replies ? ` (thread, ${replies} replies)` : ''}`);
      move(dir, POSTED);
    } catch (err) {
      failed = true;
      console.error(`failed ${dir}:`, JSON.stringify(err?.data ?? err?.message ?? String(err)));
    }
  }
  return failed;
}

if (path.basename(process.argv[1] ?? '') === 'post.js') {
  const { TwitterApi } = await import('twitter-api-v2'); // loaded here so the tests can import this file without it
  const client = new TwitterApi({
    appKey: process.env.X_APP_KEY,
    appSecret: process.env.X_APP_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  }).readWrite;
  if (await main(client)) process.exitCode = 1;
}

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
  '.mp4': 'video/mp4', // a video: X takes one video or up to 4 images per post
};
const isVideo = (f) => MIME[path.extname(f).toLowerCase()]?.startsWith('video/');
// In a thread folder reply3.png is reply 3's image; every other image or video is the main post's
const isReplyMedia = (f) => /^reply\d+\.[a-z0-9]+$/i.test(f) && Boolean(MIME[path.extname(f).toLowerCase()]);
export function replyMedia(full, n) {
  const f = fs.readdirSync(full).find((x) => isReplyMedia(x) && x.toLowerCase().startsWith(`reply${n}.`));
  return f ? path.join(full, f) : null;
}

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

// Uploads one image or video file and returns its media id
export async function upload(client, file) {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  try {
    // v2 upload endpoint (chunked; for a video it waits until X has processed it)
    return await client.v2.uploadMedia(buf, {
      media_type: MIME[ext],
      media_category: isVideo(file) ? 'tweet_video' : ext === '.gif' ? 'tweet_gif' : 'tweet_image',
    });
  } catch (err) {
    // fallback: v1.1 upload, which accepts OAuth 1.0a keys
    console.log(`v2 upload failed for ${path.basename(file)}, trying v1.1:`, err?.code ?? err?.message);
    return client.v1.uploadMedia(buf, { mimeType: MIME[ext] });
  }
}

async function postMain(client, full, text) {
  const files = fs.readdirSync(full).sort().filter((f) => !isReplyMedia(f));
  const video = files.find(isVideo);
  const images = video ? [video] : files.filter((f) => MIME[path.extname(f).toLowerCase()]).slice(0, 4);
  if (!text && images.length === 0) throw new Error('empty post (no post.txt and no image)');

  const mediaIds = [];
  for (const img of images) mediaIds.push(await upload(client, path.join(full, img)));

  const payload = {};
  if (text) payload.text = text;
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const quoteFile = path.join(full, 'quote.txt'); // the id of a post to quote (the daily article post quotes the X Article)
  if (fs.existsSync(quoteFile)) {
    const quote = fs.readFileSync(quoteFile, 'utf8').trim();
    if (!/^\d{1,25}$/.test(quote)) throw new Error(`quote.txt must hold a post id, not "${quote.slice(0, 40)}"`);
    payload.quote_tweet_id = quote;
  }
  const { data } = await client.v2.tweet(payload);
  return data.id;
}

// Posts parts[ids.length...] as a chain: part 0 on its own (postFirst, or plain text), each next part as a reply to
// the previous id, a random 10 to 40 seconds apart. media[i] is a file attached to part i (or null). A failed part is
// retried once after 30 s. ids grows as parts go out and save() runs after each one, so a caller can resume a chain
// that stopped halfway; only the parts still to post upload their media.
export async function chain(client, parts, ids = [], { save = () => {}, wait = sleep, postFirst = null, label = 'thread', media = [] } = {}) {
  const once = async (part) => {
    if (part === 0 && postFirst) return postFirst();
    const payload = { text: parts[part] };
    if (part > 0) payload.reply = { in_reply_to_tweet_id: ids.at(-1) };
    if (media[part]) payload.media = { media_ids: [await upload(client, media[part])] };
    const { data } = await client.v2.tweet(payload);
    return data.id;
  };
  for (let part = ids.length; part < parts.length; part++) {
    if (part > 0) await wait(pause());
    let id;
    try {
      id = await once(part);
    } catch (err) {
      console.log(`part ${part} of ${label} failed, retrying in ${RETRY_MS / 1000} s:`, JSON.stringify(err?.data ?? err?.message));
      await wait(RETRY_MS);
      id = await once(part);
    }
    ids.push(id);
    save();
  }
  return ids;
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
  const media = [null, ...replies.map((_, i) => replyMedia(full, i + 1))];
  await chain(client, [text, ...replies], ids, { save, wait, postFirst: () => postMain(client, full, text), label: dir, media });
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

// The X client for this PC. The 4 keys come from the .env file next to this script, which only the user writes.
// POSTS_FAKE_X=1 (tests) returns a fake client that prints what it would post and never calls X.
const KEYS = ['X_APP_KEY', 'X_APP_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];
export async function xClient() {
  if (process.env.POSTS_FAKE_X) {
    let n = 0;
    const tweet = async (payload) => {
      n += 1;
      console.log(`FAKE_X ${JSON.stringify(payload)}`);
      return { data: { id: `fake${Date.now()}${n}` } };
    };
    return { v2: { tweet, uploadMedia: async () => 'fakemedia' }, v1: { uploadMedia: async () => 'fakemedia' } };
  }
  try {
    process.loadEnvFile(path.join(import.meta.dirname, '.env'));
  } catch {}
  const missing = KEYS.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`X keys missing (${missing.join(', ')}): put them in the .env file in the x-autopost folder`);
  const { TwitterApi } = await import('twitter-api-v2'); // loaded here so the tests can import this file without it
  return new TwitterApi({
    appKey: process.env.X_APP_KEY,
    appSecret: process.env.X_APP_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  }).readWrite;
}
export const quick = async () => {}; // no pauses with the fake client, so tests stay fast

if (path.basename(process.argv[1] ?? '') === 'post.js') {
  try {
    const client = await xClient();
    if (await main(client, new Date(), process.env.POSTS_FAKE_X ? quick : sleep)) process.exitCode = 1;
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 1;
  }
}

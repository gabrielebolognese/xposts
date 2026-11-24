// node --test pipeline/tests/post.test.mjs   (post.js with a fake X client, in a throwaway queue)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chain, main, pause } from '../../post.js';
import { decodeMedia } from '../../post-now.js';

const noWait = async () => {};
const DUE = '2026-11-14_1300';
const onTime = new Date('2026-11-14T13:05:00');
const late = new Date('2026-11-14T17:00:00'); // 4 hours late

// A fake client: ids are <prefix>1, <prefix>2 ...; calls listed in failOn (by index, retries count) throw
function fakeClient(prefix, failOn = []) {
  const calls = [];
  let n = 0;
  const tweet = async (payload) => {
    const index = calls.push(payload) - 1;
    if (failOn.includes(index)) throw new Error('simulated X error');
    n += 1;
    return { data: { id: `${prefix}${n}` } };
  };
  return { calls, client: { v2: { tweet, uploadMedia: async () => 'media1' }, v1: { uploadMedia: async () => 'media1' } } };
}

function setup(replies) {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'xposts-post-')));
  const dir = path.join('queue', DUE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'post.txt'), 'the hook\n\nthe promise:');
  replies.forEach((r, i) => fs.writeFileSync(path.join(dir, `reply${i + 1}.txt`), r));
  return dir;
}
const progress = (base) => JSON.parse(fs.readFileSync(path.join(base, DUE, 'thread.json'), 'utf8')).ids;

test('a thread: the main post, then each reply answering the one before it, 10 to 40 seconds apart', async () => {
  setup(['1. one', '2. two', '3. three']);
  const { client, calls } = fakeClient('a');
  const waits = [];
  assert.equal(await main(client, onTime, async (ms) => waits.push(ms)), false);
  assert.equal(waits.length, 3);
  assert.ok(waits.every((ms) => ms >= 10000 && ms <= 40000), String(waits));
  assert.deepEqual([pause(() => 0), pause(() => 0.999999)], [10000, 40000]);
  assert.deepEqual(calls, [
    { text: 'the hook\n\nthe promise:' },
    { text: '1. one', reply: { in_reply_to_tweet_id: 'a1' } },
    { text: '2. two', reply: { in_reply_to_tweet_id: 'a2' } },
    { text: '3. three', reply: { in_reply_to_tweet_id: 'a3' } },
  ]);
  assert.deepEqual(progress('posted'), ['a1', 'a2', 'a3', 'a4']);
  assert.ok(!fs.existsSync(path.join('queue', DUE)));
});

test('a reply that fails twice stops the run; the next run resumes there and never reposts', async () => {
  setup(['1. one', '2. two', '3. three']);
  const first = fakeClient('a', [2, 3]); // reply 2 and its retry fail
  assert.equal(await main(first.client, onTime, noWait), true);
  assert.deepEqual(progress('queue'), ['a1', 'a2']);
  const second = fakeClient('b');
  assert.equal(await main(second.client, onTime, noWait), false);
  assert.deepEqual(second.calls, [
    { text: '2. two', reply: { in_reply_to_tweet_id: 'a2' } },
    { text: '3. three', reply: { in_reply_to_tweet_id: 'b1' } },
  ]);
  assert.deepEqual(progress('posted'), ['a1', 'a2', 'b1', 'b2']);
});

test('one failed attempt is retried and the thread goes on', async () => {
  setup(['1. one', '2. two']);
  const { client, calls } = fakeClient('a', [1]); // reply 1 fails once
  assert.equal(await main(client, onTime, noWait), false);
  assert.equal(calls.length, 4);
  assert.deepEqual(progress('posted'), ['a1', 'a2', 'a3']);
});

test('a started thread is finished even when it is late; an unstarted late one goes to missed/', async () => {
  setup(['1. one', '2. two']);
  fs.writeFileSync(path.join('queue', DUE, 'thread.json'), JSON.stringify({ ids: ['a1'] }));
  const { client, calls } = fakeClient('b');
  assert.equal(await main(client, late, noWait), false);
  assert.equal(calls.length, 2);
  assert.ok(fs.existsSync(path.join('posted', DUE)));

  setup(['1. one', '2. two']);
  const other = fakeClient('c');
  await main(other.client, late, noWait);
  assert.equal(other.calls.length, 0);
  assert.ok(fs.existsSync(path.join('missed', DUE)));
});

test('a folder without replies is still one single post', async () => {
  setup([]);
  const { client, calls } = fakeClient('a');
  assert.equal(await main(client, onTime, noWait), false);
  assert.deepEqual(calls, [{ text: 'the hook\n\nthe promise:' }]);
  assert.ok(!fs.existsSync(path.join('posted', DUE, 'thread.json')));
});

test('a folder with a video posts it as the one media item, uploaded as a tweet_video', async () => {
  const dir = setup([]);
  fs.writeFileSync(path.join(dir, 'video.mp4'), 'fake mp4');
  fs.writeFileSync(path.join(dir, 'still.png'), 'fake png');
  const { client, calls } = fakeClient('a');
  const uploads = [];
  client.v2.uploadMedia = async (buf, opts) => (uploads.push(opts), 'vid1');
  assert.equal(await main(client, onTime, noWait), false);
  assert.deepEqual(uploads, [{ media_type: 'video/mp4', media_category: 'tweet_video' }]);
  assert.deepEqual(calls, [{ text: 'the hook\n\nthe promise:', media: { media_ids: ['vid1'] } }]);
  assert.ok(fs.existsSync(path.join('posted', DUE, 'video.mp4')));
});

test('quote.txt makes the post quote that post id (the Friday post quoting the X Article)', async () => {
  const dir = setup([]);
  fs.writeFileSync(path.join(dir, 'quote.txt'), '1900000000000000123\n');
  const { client, calls } = fakeClient('a');
  assert.equal(await main(client, onTime, noWait), false);
  assert.deepEqual(calls, [{ text: 'the hook\n\nthe promise:', quote_tweet_id: '1900000000000000123' }]);
});

test('a quote.txt without a post id fails the post instead of posting without the quote', async () => {
  const dir = setup([]);
  fs.writeFileSync(path.join(dir, 'quote.txt'), 'https://x.com/someone/status/1');
  const { client, calls } = fakeClient('a');
  assert.equal(await main(client, onTime, noWait), true);
  assert.deepEqual(calls, []);
  assert.ok(fs.existsSync(path.join('queue', DUE)));
});

test('thread images: each part carries its own image, and the main post never takes the replies\' images', async () => {
  const dir = setup(['1. one', '2. two', '3. three']);
  for (const f of ['post.png', 'reply1.png', 'reply3.jpg']) fs.writeFileSync(path.join(dir, f), `fake ${f}`);
  const { client, calls } = fakeClient('a');
  const uploaded = [];
  client.v2.uploadMedia = async (buf) => (uploaded.push(buf.toString()), `m${uploaded.length}`);
  assert.equal(await main(client, onTime, noWait), false);
  assert.deepEqual(uploaded, ['fake post.png', 'fake reply1.png', 'fake reply3.jpg']);
  assert.deepEqual(calls, [
    { text: 'the hook\n\nthe promise:', media: { media_ids: ['m1'] } },
    { text: '1. one', reply: { in_reply_to_tweet_id: 'a1' }, media: { media_ids: ['m2'] } },
    { text: '2. two', reply: { in_reply_to_tweet_id: 'a2' } },
    { text: '3. three', reply: { in_reply_to_tweet_id: 'a3' }, media: { media_ids: ['m3'] } },
  ]);
});

test('thread images: a resumed thread uploads only the images of the parts still to post', async () => {
  const dir = setup(['1. one', '2. two']);
  for (const f of ['post.png', 'reply1.png', 'reply2.png']) fs.writeFileSync(path.join(dir, f), `fake ${f}`);
  fs.writeFileSync(path.join(dir, 'thread.json'), JSON.stringify({ ids: ['x1', 'x2'] }));
  const { client, calls } = fakeClient('b');
  const uploaded = [];
  client.v2.uploadMedia = async (buf) => (uploaded.push(buf.toString()), 'm1');
  assert.equal(await main(client, onTime, noWait), false);
  assert.deepEqual(uploaded, ['fake reply2.png']);
  assert.deepEqual(calls, [{ text: '2. two', reply: { in_reply_to_tweet_id: 'x2' }, media: { media_ids: ['m1'] } }]);
});

test('post now: MEDIA gives each part its image (null for none); a list of the wrong length is refused', async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'xposts-now-')));
  fs.writeFileSync('a.png', 'fake a');
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
  const media = decodeMedia(b64([path.resolve('a.png'), null, path.resolve('gone.png')]), 3);
  assert.deepEqual(media, [path.resolve('a.png'), null, null]);
  assert.throws(() => decodeMedia(b64([null]), 2), /one file path or null per part/);
  assert.deepEqual(decodeMedia(undefined, 2), []);
  const { client, calls } = fakeClient('c');
  client.v2.uploadMedia = async () => 'm9';
  await chain(client, ['main', '1. one', '2. two'], [], { wait: noWait, media });
  assert.deepEqual(calls, [
    { text: 'main', media: { media_ids: ['m9'] } },
    { text: '1. one', reply: { in_reply_to_tweet_id: 'c1' } },
    { text: '2. two', reply: { in_reply_to_tweet_id: 'c2' } },
  ]);
});

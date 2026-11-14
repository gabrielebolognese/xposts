// node --test pipeline/tests/post.test.mjs   (post.js with a fake X client, in a throwaway queue)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../post.js';

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

test('a thread: the main post, then each reply answering the one before it', async () => {
  setup(['1. one', '2. two', '3. three']);
  const { client, calls } = fakeClient('a');
  assert.equal(await main(client, onTime, noWait), false);
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

// node --test pipeline/tests/dashboard.test.mjs   (the dashboard's view of the runner files, and post-now's input)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestPost, threads, threadParts } from '../../dashboard.js';
import { decode } from '../../post-now.js';

const draft = { hook: 'the hook', promise: 'the promise:', replies: ['one', 'two', 'three', 'four'] };

function root() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'xposts-dash-'));
  const run = (name, state, files = {}) => {
    const dir = path.join(r, 'pipeline', 'runs', name);
    fs.mkdirSync(dir, { recursive: true });
    const all = { 'state.json': state, 'discovery.json': { name: `${name} tool`, category_name: 'Cat' }, ...files };
    for (const [f, v] of Object.entries(all)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  };
  fs.mkdirSync(path.join(r, 'pipeline', 'data'), { recursive: true });
  return { r, run };
}

test('each run gets its status, slot, score and full thread', () => {
  const { r, run } = root();
  run('2026-11-14_0700_a', { stage: 'hooks', hook: 'picked hook' });
  run('2026-11-14_0800_b', { stage: 'ready' }, { 'draft.json': draft, 'virality.json': { final: 88, classification: 'Excellent', hook_score: 90, thread_score: 84 } });
  run('2026-11-14_0900_c', { stage: 'ready' }, { 'draft.json': draft });
  run('2026-11-14_1000_d', { stage: 'dropped', outcome: 'dropped: virality 50 (Weak): dull' });
  fs.mkdirSync(path.join(r, 'pipeline', 'runs', 'old-long-form'), { recursive: true }); // no discovery.json: not shown
  fs.writeFileSync(path.join(r, 'pipeline', 'data', 'virality.json'), JSON.stringify({
    '2026-11-14_0800_b': { status: 'scheduled', slot: '2026-11-15_0600' },
    '2026-11-14_0900_c': { status: 'waiting', slot: null } }));
  fs.writeFileSync(path.join(r, 'pipeline', 'data', 'posted-now.json'), JSON.stringify([{ run: '2026-11-14_0900_c', at: '2026-11-14T09:30:00Z' }]));

  const t = Object.fromEntries(threads(r).map((x) => [x.run, x]));
  assert.deepEqual(Object.keys(t), ['2026-11-14_1000_d', '2026-11-14_0900_c', '2026-11-14_0800_b', '2026-11-14_0700_a']);
  assert.equal(t['2026-11-14_0700_a'].status, 'making');
  assert.equal(t['2026-11-14_0700_a'].hook, 'picked hook');
  assert.equal(t['2026-11-14_0700_a'].parts, null);
  assert.equal(t['2026-11-14_0800_b'].status, 'scheduled');
  assert.equal(t['2026-11-14_0800_b'].slot, '2026-11-15_0600');
  assert.equal(t['2026-11-14_0800_b'].score, 88);
  assert.deepEqual(t['2026-11-14_0800_b'].parts, ['the hook\n\nthe promise:', '1. one', '2. two', '3. three', '4. four']);
  assert.equal(t['2026-11-14_0900_c'].status, 'posted-now');
  assert.equal(t['2026-11-14_1000_d'].status, 'dropped');
});

test('post now leaves a request for the runner, only while the runner is on', () => {
  const { r, run } = root();
  run('2026-11-14_0800_b', { stage: 'ready' }, { 'draft.json': draft });
  run('2026-11-14_0700_a', { stage: 'hooks' });
  const data = path.join(r, 'pipeline', 'data');
  fs.writeFileSync(path.join(data, 'virality.json'), JSON.stringify({ '2026-11-14_0800_b': { status: 'waiting' } }));
  assert.throws(() => requestPost('2026-11-14_0800_b', r), /runner is not running/);
  fs.writeFileSync(path.join(data, 'poster.json'), JSON.stringify({ at: Date.now() / 1000 }));
  assert.throws(() => requestPost('2026-11-14_0700_a', r), /no finished thread/);
  fs.mkdirSync(path.join(data, 'post-now'), { recursive: true });
  fs.writeFileSync(path.join(data, 'post-now', '2026-11-14_0800_b.failed'), JSON.stringify({ error: 'auth failed' }));
  assert.equal(threads(r).find((t) => t.run === '2026-11-14_0800_b').postError, 'auth failed');
  assert.deepEqual(requestPost('2026-11-14_0800_b', r), { ok: true });
  assert.ok(fs.existsSync(path.join(data, 'post-now', '2026-11-14_0800_b.json')));
  assert.ok(!fs.existsSync(path.join(data, 'post-now', '2026-11-14_0800_b.failed')));
  assert.equal(threads(r).find((t) => t.run === '2026-11-14_0800_b').status, 'posting');
  assert.throws(() => requestPost('2026-11-14_0800_b', r), /already posted or is being posted/);
  fs.writeFileSync(path.join(data, 'posted-now.json'), JSON.stringify([{ run: '2026-11-14_0800_b', url: 'https://x.com/i/status/1' }]));
  fs.rmSync(path.join(data, 'post-now', '2026-11-14_0800_b.json'));
  const t = threads(r).find((x) => x.run === '2026-11-14_0800_b');
  assert.equal(t.status, 'posted-now');
  assert.equal(t.postUrl, 'https://x.com/i/status/1');
});

test('threadParts matches what the runner queues, and post-now decodes it back', () => {
  const parts = threadParts(draft);
  assert.deepEqual(decode(Buffer.from(JSON.stringify(parts)).toString('base64')), parts);
  assert.throws(() => decode(Buffer.from('[]').toString('base64')));
  assert.throws(() => decode(Buffer.from('["ok", ""]').toString('base64')));
});

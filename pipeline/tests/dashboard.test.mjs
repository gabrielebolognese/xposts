// node --test pipeline/tests/dashboard.test.mjs   (the dashboard's view of the runner files, and post-now's input)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { threads, threadParts } from '../../dashboard.js';
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

test('threadParts matches what the runner queues, and post-now decodes it back', () => {
  const parts = threadParts(draft);
  assert.deepEqual(decode(Buffer.from(JSON.stringify(parts)).toString('base64')), parts);
  assert.throws(() => decode(Buffer.from('[]').toString('base64')));
  assert.throws(() => decode(Buffer.from('["ok", ""]').toString('base64')));
});
